/**
 * H1-S2b2b: bounded, explicit dispatch of queued highlight tasks.
 * The caller supplies a runner; this module never opens media or starts HotClip itself.
 */
import { createHash } from 'node:crypto';
import {
  HighlightBatchQueue,
  HighlightBatchQueueError,
  type HighlightBatchTaskV1,
} from './highlight-batch-queue';
import { HotClipSidecarError } from './hotclip-sidecar';

export interface HighlightBatchRunResult {
  candidateIds: string[];
  highlightIds: string[];
}

export type HighlightBatchRunner = (
  task: HighlightBatchTaskV1,
  signal: AbortSignal,
) => Promise<HighlightBatchRunResult>;

export interface HighlightBatchSchedulerOptions {
  queue: HighlightBatchQueue;
  /** 1..4 concurrent recordings. */
  concurrency: number;
  /** 1..5 total attempts per recording, including the first. */
  maxAttempts: number;
  runner: HighlightBatchRunner;
}

export const HIGHLIGHT_BATCH_SCHEDULER_ERROR_CODES = [
  'invalid_configuration',
  'scheduler_busy',
] as const;
export type HighlightBatchSchedulerErrorCode = (typeof HIGHLIGHT_BATCH_SCHEDULER_ERROR_CODES)[number];

const MESSAGES: Readonly<Record<HighlightBatchSchedulerErrorCode, string>> = {
  invalid_configuration: 'Highlight batch scheduler configuration is invalid',
  scheduler_busy: 'Highlight batch scheduler is already dispatching',
};

const HIGHLIGHT_ID_PATTERN = /^hlcv1-[a-f0-9]{64}$/;
const CANDIDATE_ID_DOMAIN = 'lingji-hotclip-candidate-v1';

/** Shared deterministic identity for an upstream candidate inside one durable task. */
export function buildOpaqueCandidateId(taskId: string, upstreamId: string): string {
  return `hcand_${createHash('sha256')
    .update(JSON.stringify([CANDIDATE_ID_DOMAIN, taskId, upstreamId]), 'utf8')
    .digest('hex')}`;
}

class InvalidRunResult extends Error {}

function ownStringArray(value: unknown, maxLength: number, pattern?: RegExp): string[] {
  if (!Array.isArray(value) || value.length > 12 ||
      Reflect.ownKeys(value).length !== value.length + 1) throw new InvalidRunResult();
  const values: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' ||
        descriptor.value.length < 1 || descriptor.value.length > maxLength ||
        (pattern !== undefined && !pattern.test(descriptor.value))) throw new InvalidRunResult();
    values.push(descriptor.value);
  }
  return values;
}

/** Upstream IDs may be source text; persist only task-scoped opaque identifiers. */
function safeRunResult(task: HighlightBatchTaskV1, value: unknown): HighlightBatchRunResult {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidRunResult();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new InvalidRunResult();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || !keys.includes('candidateIds') || !keys.includes('highlightIds')) {
      throw new InvalidRunResult();
    }
    const candidates = Object.getOwnPropertyDescriptor(value, 'candidateIds');
    const highlights = Object.getOwnPropertyDescriptor(value, 'highlightIds');
    if (!candidates || !highlights || !('value' in candidates) || !('value' in highlights)) {
      throw new InvalidRunResult();
    }
    const upstreamIds = ownStringArray(candidates.value, 512);
    const highlightIds = ownStringArray(highlights.value, 71, HIGHLIGHT_ID_PATTERN);
    if (upstreamIds.length !== highlightIds.length) throw new InvalidRunResult();
    const candidateIds = upstreamIds.map((upstreamId) => buildOpaqueCandidateId(task.id, upstreamId));
    return { candidateIds, highlightIds };
  } catch {
    throw new InvalidRunResult();
  }
}

export class HighlightBatchSchedulerError extends Error {
  readonly code: HighlightBatchSchedulerErrorCode;

  constructor(code: HighlightBatchSchedulerErrorCode) {
    super(MESSAGES[code]);
    this.name = 'HighlightBatchSchedulerError';
    this.code = code;
  }
}

export class HighlightBatchSourceError extends Error {
  readonly code: 'source_unavailable' | 'source_hash_mismatch';

  constructor(code: 'source_unavailable' | 'source_hash_mismatch') {
    super(code === 'source_unavailable'
      ? 'Highlight recording source could not be verified'
      : 'Highlight recording source hash no longer matches the queued task');
    this.name = 'HighlightBatchSourceError';
    this.code = code;
  }
}

function safeFailureCode(error: unknown): string {
  if (error instanceof HighlightBatchSourceError) return error.code;
  if (!(error instanceof HotClipSidecarError)) return 'internal_error';
  switch (error.code) {
    case 'executable_missing': return 'sidecar_executable_missing';
    case 'spawn_failed': return 'sidecar_spawn_failed';
    case 'timeout': return 'sidecar_timeout';
    case 'nonzero_exit': return 'sidecar_nonzero_exit';
    case 'output_too_large': return 'sidecar_output_too_large';
    case 'invalid_output': return 'sidecar_invalid_output';
    default: return 'internal_error';
  }
}

/** One scheduler owns dispatch in this process; the queue remains the durable source of truth. */
export class HighlightBatchScheduler {
  private readonly queue: HighlightBatchQueue;
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly runner: HighlightBatchRunner;
  private readonly controllers = new Map<string, AbortController>();
  private activeDrain: Promise<HighlightBatchTaskV1[]> | null = null;

  constructor(options: HighlightBatchSchedulerOptions) {
    if (!options || !(options.queue instanceof HighlightBatchQueue) ||
        !Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4 ||
        !Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 5 ||
        typeof options.runner !== 'function') {
      throw new HighlightBatchSchedulerError('invalid_configuration');
    }
    this.queue = options.queue;
    this.concurrency = options.concurrency;
    this.maxAttempts = options.maxAttempts;
    this.runner = options.runner;
  }

  /** Cancel a queued or running task before aborting a runner, so late callbacks cannot commit. */
  cancel(id: string): HighlightBatchTaskV1 {
    const cancelled = this.queue.cancel(id);
    this.controllers.get(id)?.abort();
    return cancelled;
  }

  /** Run only tasks queued at this call. Failed tasks require an explicit queue.retry(). */
  runQueued(): Promise<HighlightBatchTaskV1[]> {
    if (this.activeDrain) {
      return Promise.reject(new HighlightBatchSchedulerError('scheduler_busy'));
    }
    const execution = Promise.resolve().then(() => this.drain());
    const active = execution.finally(() => { this.activeDrain = null; });
    this.activeDrain = active;
    return active;
  }

  private async drain(): Promise<HighlightBatchTaskV1[]> {
    const queuedIds = this.queue.list().filter((task) => task.state === 'queued').map((task) => task.id);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < queuedIds.length) {
        const id = queuedIds[cursor++];
        if (this.queue.get(id)?.state !== 'queued') continue;
        await this.runOne(id);
      }
    };
    const workers = Array.from({ length: Math.min(this.concurrency, queuedIds.length) }, () => worker());
    const outcomes = await Promise.allSettled(workers);
    const rejected = outcomes.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
    if (rejected) throw rejected.reason;
    return this.queue.list();
  }

  private async runOne(id: string): Promise<void> {
    const task = this.queue.claim(id, this.maxAttempts);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      let result: HighlightBatchRunResult;
      try {
        result = await this.runner(task, controller.signal);
      } catch (error) {
        if (this.queue.get(id)?.state === 'cancelled') return;
        this.queue.fail(id, task.attempt, safeFailureCode(error));
        return;
      }
      if (this.queue.get(id)?.state === 'cancelled') return;
      try {
        this.queue.complete(id, task.attempt, safeRunResult(task, result));
      } catch (error) {
        if (!(error instanceof InvalidRunResult) &&
            (!(error instanceof HighlightBatchQueueError) || error.code !== 'invalid_result')) throw error;
        this.queue.fail(id, task.attempt, 'projection_failed');
      }
    } finally {
      this.controllers.delete(id);
    }
  }
}

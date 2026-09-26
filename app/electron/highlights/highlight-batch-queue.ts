/**
 * H1-S2b1: durable identity and storage for batches of recording highlights.
 * This core never starts HotClip, reads media, or approves a candidate for use.
 * Execution and child-process cancellation belong to the next scheduler slice.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { RecordingV1 } from '../../src/types/production-contracts';
import { HotClipProjectionError, projectHotClipCandidates } from './project-hotclip-candidates';

export const HIGHLIGHT_BATCH_SCHEMA_VERSION = 1 as const;
const TASK_ID_DOMAIN = 'lingji-highlight-batch-task-v1';
const TASK_ID_PATTERN = /^hbatch_[0-9a-f]{64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANDIDATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HIGHLIGHT_ID_PATTERN = /^hlcv1-[0-9a-f]{64}$/;
const MAX_RESULT_IDS = 12;
export const HIGHLIGHT_BATCH_FAILURE_CODES = [
  'source_unavailable',
  'sidecar_executable_missing',
  'sidecar_spawn_failed',
  'sidecar_timeout',
  'sidecar_nonzero_exit',
  'sidecar_output_too_large',
  'sidecar_invalid_output',
  'projection_failed',
  'process_interrupted',
  'internal_error',
] as const;
const ACTIVE_WRITERS = new Set<string>();
const TASK_STATES = ['queued', 'running', 'interrupted', 'completed', 'failed', 'cancelled'] as const;

export type HighlightBatchState = (typeof TASK_STATES)[number];
export interface HighlightProcessingOptions {
  /** null means use the user-configured sidecar default; otherwise 1..12. */
  maxClips: number | null;
}
export interface HighlightBatchInput {
  recording: RecordingV1;
  /** Already observed by the caller. This module does not hash media. */
  observedSourceSha256: string;
  options: { maxClips?: number | null };
}
export interface HighlightBatchTaskV1 {
  id: string;
  recording: RecordingV1;
  sourceSha256: string;
  options: HighlightProcessingOptions;
  state: HighlightBatchState;
  attempt: number;
  /** Reserved for the S2b2 scheduler; empty on enqueue. */
  candidateIds: string[];
  highlightIds: string[];
  lastErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
}
interface HighlightBatchFileV1 {
  schemaVersion: typeof HIGHLIGHT_BATCH_SCHEMA_VERSION;
  updatedAt: number;
  tasks: HighlightBatchTaskV1[];
}
export interface HighlightBatchQueueOptions {
  /** Absolute, caller-owned path outside the repository. */
  storePath: string;
  now: () => number;
}

export const HIGHLIGHT_BATCH_ERROR_CODES = [
  'invalid_store_path',
  'store_busy',
  'store_read_failed',
  'store_corrupt',
  'store_unsupported_version',
  'store_write_failed',
  'store_changed',
  'invalid_batch',
  'invalid_input',
  'invalid_recording',
  'invalid_observed_hash',
  'source_hash_mismatch',
  'invalid_options',
  'duplicate_input',
  'recording_conflict',
  'invalid_clock',
  'closed',
  'task_not_found',
  'invalid_transition',
  'stale_attempt',
  'invalid_attempt_limit',
  'attempt_limit_reached',
  'invalid_result',
  'result_conflict',
  'invalid_error_code',
] as const;
export type HighlightBatchErrorCode = (typeof HIGHLIGHT_BATCH_ERROR_CODES)[number];
const ERROR_MESSAGES: Readonly<Record<HighlightBatchErrorCode, string>> = {
  invalid_store_path: 'Highlight batch store path must be absolute',
  store_busy: 'Highlight batch store already has a live writer',
  store_read_failed: 'Highlight batch store could not be read safely',
  store_corrupt: 'Highlight batch store failed schema validation',
  store_unsupported_version: 'Highlight batch store schema version is unsupported',
  store_write_failed: 'Highlight batch store could not be committed',
  store_changed: 'Highlight batch store changed outside this writer',
  invalid_batch: 'Highlight batch input must be an array',
  invalid_input: 'Highlight batch item is invalid',
  invalid_recording: 'Recording reference failed validation',
  invalid_observed_hash: 'Observed recording hash is invalid',
  source_hash_mismatch: 'Observed recording hash does not match the reference',
  invalid_options: 'Highlight processing options are invalid',
  duplicate_input: 'Highlight batch contains a duplicate task',
  recording_conflict: 'Recording metadata changed for an existing highlight task',
  invalid_clock: 'Highlight batch clock returned an invalid time',
  closed: 'Highlight batch store is closed',
  task_not_found: 'Highlight batch task does not exist',
  invalid_transition: 'Highlight batch task cannot enter the requested state',
  stale_attempt: 'Highlight batch attempt is no longer current',
  invalid_attempt_limit: 'Highlight batch attempt limit must be between one and five',
  attempt_limit_reached: 'Highlight batch attempt limit has been reached',
  invalid_result: 'Highlight batch result identifiers are invalid',
  result_conflict: 'Highlight batch completed result conflicts with the saved result',
  invalid_error_code: 'Highlight batch failure code is invalid',
};

export class HighlightBatchQueueError extends Error {
  readonly code: HighlightBatchErrorCode;

  constructor(code: HighlightBatchErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'HighlightBatchQueueError';
    this.code = code;
  }
}

function fail(code: HighlightBatchErrorCode): never {
  throw new HighlightBatchQueueError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSafeIdArray(value: unknown, pattern: RegExp): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_RESULT_IDS &&
    value.every((id) => typeof id === 'string' && pattern.test(id)) &&
    new Set(value).size === value.length
  );
}

function copyResultIds(value: unknown, pattern: RegExp): string[] {
  if (!Array.isArray(value) || value.length > MAX_RESULT_IDS ||
      Reflect.ownKeys(value).length !== value.length + 1) fail('invalid_result');
  const ids: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) ||
        typeof descriptor.value !== 'string' || !pattern.test(descriptor.value)) fail('invalid_result');
    ids.push(descriptor.value);
  }
  if (new Set(ids).size !== ids.length) fail('invalid_result');
  return ids;
}

function normalizeResult(value: unknown): { candidateIds: string[]; highlightIds: string[] } {
  try {
    if (!isPlainObject(value) || !exactKeys(value, ['candidateIds', 'highlightIds'])) fail('invalid_result');
    const candidates = Object.getOwnPropertyDescriptor(value, 'candidateIds');
    const highlights = Object.getOwnPropertyDescriptor(value, 'highlightIds');
    if (!candidates || !highlights || !('value' in candidates) || !('value' in highlights) ||
        !Array.isArray(candidates.value) || !Array.isArray(highlights.value)) fail('invalid_result');
    const candidateIds = copyResultIds(candidates.value, CANDIDATE_ID_PATTERN);
    const highlightIds = copyResultIds(highlights.value, HIGHLIGHT_ID_PATTERN);
    return { candidateIds, highlightIds };
  } catch {
    fail('invalid_result');
  }
}

function isAttemptLimit(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= 5;
}

function isFailureCode(value: unknown): value is (typeof HIGHLIGHT_BATCH_FAILURE_CODES)[number] {
  return typeof value === 'string' &&
    (HIGHLIGHT_BATCH_FAILURE_CODES as readonly string[]).includes(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeOptions(value: unknown): HighlightProcessingOptions {
  try {
    if (!isPlainObject(value) || Object.keys(value).some((key) => key !== 'maxClips')) {
      fail('invalid_options');
    }
    const maxClips = value.maxClips === undefined ? null : value.maxClips;
    if (maxClips !== null && (!Number.isInteger(maxClips) || (maxClips as number) < 1 || (maxClips as number) > 12)) {
      fail('invalid_options');
    }
    return { maxClips: maxClips as number | null };
  } catch {
    fail('invalid_options');
  }
}

function isCanonicalOptions(value: unknown): value is HighlightProcessingOptions {
  if (!isPlainObject(value) || !exactKeys(value, ['maxClips'])) return false;
  const maxClips = value.maxClips;
  return maxClips === null || (Number.isInteger(maxClips) && (maxClips as number) >= 1 && (maxClips as number) <= 12);
}

function normalizeInput(raw: unknown): Pick<HighlightBatchTaskV1, 'id' | 'recording' | 'sourceSha256' | 'options'> {
  let recording: RecordingV1;
  let observed: string;
  let rawOptions: unknown;
  try {
    if (!isPlainObject(raw) || !exactKeys(raw, ['recording', 'observedSourceSha256', 'options'])) {
      throw new Error('invalid input shape');
    }
    recording = clone(raw.recording) as RecordingV1;
    observed = raw.observedSourceSha256 as string;
    rawOptions = raw.options;
  } catch {
    fail('invalid_input');
  }
  const options = normalizeOptions(rawOptions);

  try {
    projectHotClipCandidates({
      recording,
      observedSourceSha256: observed,
      candidates: [],
      createdAt: '2000-01-01T00:00:00Z',
    });
  } catch (error) {
    if (error instanceof HotClipProjectionError) {
      if (error.code === 'source_hash_mismatch') fail('source_hash_mismatch');
      if (error.code === 'invalid_observed_hash') fail('invalid_observed_hash');
    }
    fail('invalid_recording');
  }

  const sourceSha256 = observed.toLowerCase();
  recording.sourceSha256 = sourceSha256;
  const digest = createHash('sha256')
    .update(JSON.stringify([TASK_ID_DOMAIN, recording.id, sourceSha256, options]), 'utf8')
    .digest('hex');
  return { id: `hbatch_${digest}`, recording, sourceSha256, options };
}

function recordingMetadata(recording: RecordingV1): string {
  return JSON.stringify([
    recording.id, recording.sourceRef, recording.sourceSha256, recording.capturedAt,
    recording.durationMs, recording.mimeType, recording.transcriptRef, recording.importedAt,
  ]);
}

function readRawStore(storePath: string): string | null {
  try {
    const stat = lstatSync(storePath);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('store_read_failed');
    return readFileSync(storePath, 'utf8');
  } catch (error) {
    if (error instanceof HighlightBatchQueueError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    fail('store_read_failed');
  }
}

function parseSnapshot(raw: string | null): HighlightBatchTaskV1[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    fail('store_corrupt');
  }
  try {
    if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, 'schemaVersion')) fail('store_corrupt');
    if (value.schemaVersion !== HIGHLIGHT_BATCH_SCHEMA_VERSION) fail('store_unsupported_version');
    if (!exactKeys(value, ['schemaVersion', 'updatedAt', 'tasks']) || !isTime(value.updatedAt) || !Array.isArray(value.tasks)) {
      fail('store_corrupt');
    }
    const tasks: HighlightBatchTaskV1[] = [];
    const ids = new Set<string>();
    for (const rawTask of value.tasks) {
      if (
        !isPlainObject(rawTask) ||
        !exactKeys(rawTask, [
          'id', 'recording', 'sourceSha256', 'options', 'state', 'attempt',
          'candidateIds', 'highlightIds', 'lastErrorCode', 'createdAt', 'updatedAt',
        ]) ||
        typeof rawTask.id !== 'string' || !TASK_ID_PATTERN.test(rawTask.id) ||
        ids.has(rawTask.id) ||
        typeof rawTask.sourceSha256 !== 'string' || !SHA256_PATTERN.test(rawTask.sourceSha256) ||
        !isCanonicalOptions(rawTask.options) ||
        !TASK_STATES.includes(rawTask.state as HighlightBatchState) ||
        !isTime(rawTask.attempt) ||
        !isSafeIdArray(rawTask.candidateIds, CANDIDATE_ID_PATTERN) ||
        !isSafeIdArray(rawTask.highlightIds, HIGHLIGHT_ID_PATTERN) ||
        (rawTask.options.maxClips !== null &&
          (rawTask.candidateIds.length > rawTask.options.maxClips ||
           rawTask.highlightIds.length > rawTask.options.maxClips)) ||
        (rawTask.lastErrorCode !== null && !isFailureCode(rawTask.lastErrorCode)) ||
        !isTime(rawTask.createdAt) || !isTime(rawTask.updatedAt) || rawTask.updatedAt < rawTask.createdAt ||
        rawTask.updatedAt > value.updatedAt
      ) fail('store_corrupt');
      const verified = normalizeInput({
        recording: rawTask.recording,
        observedSourceSha256: rawTask.sourceSha256,
        options: rawTask.options,
      });
      if (verified.id !== rawTask.id || JSON.stringify(verified.recording) !== JSON.stringify(rawTask.recording)) {
        fail('store_corrupt');
      }
      if (
        (rawTask.state === 'queued' &&
          (rawTask.lastErrorCode !== null || rawTask.candidateIds.length > 0)) ||
        (['running', 'interrupted', 'completed', 'failed'].includes(rawTask.state as string) && rawTask.attempt === 0) ||
        (rawTask.state === 'failed' && rawTask.lastErrorCode === null) ||
        (rawTask.state !== 'failed' && rawTask.state !== 'interrupted' && rawTask.lastErrorCode !== null) ||
        (rawTask.state !== 'completed' &&
          (rawTask.candidateIds.length > 0 || rawTask.highlightIds.length > 0))
      ) fail('store_corrupt');
      ids.add(rawTask.id);
      tasks.push(rawTask as unknown as HighlightBatchTaskV1);
    }
    return tasks;
  } catch (error) {
    if (error instanceof HighlightBatchQueueError && error.code === 'store_unsupported_version') throw error;
    fail('store_corrupt');
  }
}

function writeSnapshot(storePath: string, snapshot: HighlightBatchFileV1): string {
  const bytes = JSON.stringify(snapshot);
  const temporary = `${storePath}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    mkdirSync(dirname(storePath), { recursive: true });
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, bytes, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporary, storePath);
    return bytes;
  } catch {
    return fail('store_write_failed');
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* preserve fixed error */ }
    }
    try { rmSync(temporary, { force: true }); } catch { /* preserve fixed error */ }
  }
}

/** One live writer per resolved path in this process. No cross-process CAS claim. */
export class HighlightBatchQueue {
  private readonly storePath: string;
  private readonly lockKey: string;
  private readonly now: () => number;
  private tasks: HighlightBatchTaskV1[] = [];
  private rawStore: string | null = null;
  private closed = false;

  constructor(options: HighlightBatchQueueOptions) {
    let rawPath: unknown;
    let rawNow: unknown;
    try { rawPath = options.storePath; } catch { fail('invalid_store_path'); }
    if (typeof rawPath !== 'string' || !isAbsolute(rawPath)) fail('invalid_store_path');
    try { rawNow = options.now; } catch { fail('invalid_clock'); }
    if (typeof rawNow !== 'function') fail('invalid_clock');
    this.storePath = resolve(rawPath);
    this.lockKey = process.platform === 'win32' ? this.storePath.toLowerCase() : this.storePath;
    this.now = rawNow as () => number;
    if (ACTIVE_WRITERS.has(this.lockKey)) fail('store_busy');
    ACTIVE_WRITERS.add(this.lockKey);
    try {
      this.rawStore = readRawStore(this.storePath);
      this.tasks = parseSnapshot(this.rawStore);
    } catch (error) {
      ACTIVE_WRITERS.delete(this.lockKey);
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) fail('closed');
  }

  list(): HighlightBatchTaskV1[] {
    this.assertOpen();
    return clone(this.tasks);
  }

  get(id: string): HighlightBatchTaskV1 | null {
    this.assertOpen();
    const task = this.tasks.find((entry) => entry.id === id);
    return task ? clone(task) : null;
  }

  private requiredTask(id: string): HighlightBatchTaskV1 {
    this.assertOpen();
    if (typeof id !== 'string' || !TASK_ID_PATTERN.test(id)) fail('task_not_found');
    const task = this.tasks.find((entry) => entry.id === id);
    if (!task) fail('task_not_found');
    return task;
  }

  private nextTimestamp(): number {
    let timestamp: number;
    try { timestamp = this.now(); } catch { fail('invalid_clock'); }
    if (!isTime(timestamp) || this.tasks.some((task) => task.updatedAt > timestamp)) fail('invalid_clock');
    return timestamp;
  }

  private assertStoreUnchanged(): void {
    if (readRawStore(this.storePath) !== this.rawStore) fail('store_changed');
  }

  private commitTasks(nextTasks: HighlightBatchTaskV1[], timestamp: number): void {
    this.assertStoreUnchanged();
    const nextRaw = writeSnapshot(this.storePath, {
      schemaVersion: HIGHLIGHT_BATCH_SCHEMA_VERSION,
      updatedAt: timestamp,
      tasks: nextTasks,
    });
    this.rawStore = nextRaw;
    this.tasks = nextTasks;
  }

  private transition(task: HighlightBatchTaskV1, patch: Partial<HighlightBatchTaskV1>): HighlightBatchTaskV1 {
    const timestamp = this.nextTimestamp();
    const next = { ...task, ...patch, updatedAt: timestamp };
    const nextTasks = this.tasks.map((entry) => entry.id === task.id ? next : entry);
    this.commitTasks(nextTasks, timestamp);
    return clone(next);
  }

  /** Claim one task. The returned attempt number is the token for terminal callbacks. */
  claim(id: string, maxAttempts: number): HighlightBatchTaskV1 {
    const task = this.requiredTask(id);
    if (!isAttemptLimit(maxAttempts)) fail('invalid_attempt_limit');
    if (task.state !== 'queued') fail('invalid_transition');
    if (task.attempt >= maxAttempts) fail('attempt_limit_reached');
    return this.transition(task, { state: 'running', attempt: task.attempt + 1 });
  }

  /** Commit only identifiers from the currently running attempt; no candidate payload. */
  complete(
    id: string,
    attempt: number,
    result: { candidateIds: string[]; highlightIds: string[] },
  ): HighlightBatchTaskV1 {
    const task = this.requiredTask(id);
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt !== task.attempt) fail('stale_attempt');
    if (task.state !== 'running' && task.state !== 'completed') fail('invalid_transition');
    const normalized = normalizeResult(result);
    if (task.options.maxClips !== null &&
        (normalized.candidateIds.length > task.options.maxClips ||
         normalized.highlightIds.length > task.options.maxClips)) fail('invalid_result');
    if (task.state === 'completed') {
      if (JSON.stringify(task.candidateIds) !== JSON.stringify(normalized.candidateIds) ||
          JSON.stringify(task.highlightIds) !== JSON.stringify(normalized.highlightIds)) fail('result_conflict');
      this.assertStoreUnchanged();
      return clone(task);
    }
    return this.transition(task, { state: 'completed', ...normalized, lastErrorCode: null });
  }

  fail(id: string, attempt: number, errorCode: string): HighlightBatchTaskV1 {
    const task = this.requiredTask(id);
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt !== task.attempt) fail('stale_attempt');
    if (task.state !== 'running') fail('invalid_transition');
    if (!isFailureCode(errorCode)) fail('invalid_error_code');
    return this.transition(task, { state: 'failed', lastErrorCode: errorCode });
  }

  cancel(id: string): HighlightBatchTaskV1 {
    const task = this.requiredTask(id);
    if (task.state === 'cancelled') {
      this.assertStoreUnchanged();
      return clone(task);
    }
    if (task.state !== 'queued' && task.state !== 'running') fail('invalid_transition');
    return this.transition(task, { state: 'cancelled', lastErrorCode: null });
  }

  /** Explicit caller retry only; reopening the queue never starts work by itself. */
  retry(id: string, maxAttempts: number): HighlightBatchTaskV1 {
    const task = this.requiredTask(id);
    if (!isAttemptLimit(maxAttempts)) fail('invalid_attempt_limit');
    if (task.state !== 'failed' && task.state !== 'interrupted') fail('invalid_transition');
    if (task.attempt >= maxAttempts) fail('attempt_limit_reached');
    return this.transition(task, {
      state: 'queued', lastErrorCode: null, candidateIds: [], highlightIds: [],
    });
  }

  enqueueBatch(inputs: readonly HighlightBatchInput[]): HighlightBatchTaskV1[] {
    this.assertOpen();
    let batch: HighlightBatchInput[];
    try {
      if (!Array.isArray(inputs)) fail('invalid_batch');
      batch = Array.from(inputs);
    } catch {
      fail('invalid_batch');
    }
    if (batch.length === 0) return [];
    const normalized = batch.map((input) => normalizeInput(input));
    const seen = new Set<string>();
    for (const entry of normalized) {
      if (seen.has(entry.id)) fail('duplicate_input');
      seen.add(entry.id);
    }

    const byId = new Map(this.tasks.map((task) => [task.id, task]));
    for (const entry of normalized) {
      const existing = byId.get(entry.id);
      if (existing && recordingMetadata(existing.recording) !== recordingMetadata(entry.recording)) {
        fail('recording_conflict');
      }
    }
    const additions = normalized.filter((entry) => !byId.has(entry.id));
    if (additions.length > 0) {
      const timestamp = this.nextTimestamp();
      const nextTasks = [...this.tasks];
      for (const entry of additions) {
        const task: HighlightBatchTaskV1 = {
          ...entry,
          state: 'queued',
          attempt: 0,
          candidateIds: [],
          highlightIds: [],
          lastErrorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        nextTasks.push(task);
        byId.set(task.id, task);
      }
      this.commitTasks(nextTasks, timestamp);
    } else {
      this.assertStoreUnchanged();
    }
    return normalized.map((entry) => clone(byId.get(entry.id)!));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    ACTIVE_WRITERS.delete(this.lockKey);
  }
}

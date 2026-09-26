/** H1-S2c: local candidate artifact receipt and explicit crash reconciliation. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { HighlightV1 } from '../../src/types/production-contracts';
import {
  runHotClipHighlights,
  type HotClipHighlightCandidate,
  type RunHotClipHighlightsOptions,
} from './hotclip-sidecar';
import { projectHotClipCandidates } from './project-hotclip-candidates';
import { HighlightBatchQueue, type HighlightBatchTaskV1 } from './highlight-batch-queue';
import {
  buildOpaqueCandidateId, HighlightBatchSourceError,
  type HighlightBatchRunner,
} from './highlight-batch-scheduler';

const SCHEMA_VERSION = 1;
const TASK_ID_PATTERN = /^hbatch_[a-f0-9]{64}$/;
const CANDIDATE_ID_PATTERN = /^hcand_[a-f0-9]{64}$/;
const ACTIVE_STORES = new Set<string>();
const CANDIDATE_KEYS = [
  'id', 'startSec', 'endSec', 'startMs', 'endMs', 'title', 'hook',
  'score', 'reason', 'recommended', 'reviewNote', 'visualEvidence',
] as const;

type StoredCandidate = Omit<HotClipHighlightCandidate, 'visualEvidence'> & { visualEvidence: null };
interface ArtifactBodyV1 {
  schemaVersion: typeof SCHEMA_VERSION;
  taskId: string;
  attempt: number;
  sourceSha256: string;
  createdAt: string;
  candidates: StoredCandidate[];
}
interface ArtifactFileV1 extends ArtifactBodyV1 {
  contentSha256: string;
}

export interface HighlightArtifactBundle {
  taskId: string;
  attempt: number;
  candidateIds: string[];
  highlightIds: string[];
  highlights: readonly HighlightV1[];
  reviewRequired: true;
}

export const HIGHLIGHT_ARTIFACT_ERROR_CODES = [
  'invalid_root', 'store_busy', 'closed', 'invalid_task', 'invalid_candidate',
  'artifact_read_failed', 'artifact_corrupt', 'artifact_unsupported_version',
  'artifact_conflict', 'artifact_write_failed', 'artifact_missing', 'artifact_mismatch',
] as const;
export type HighlightArtifactErrorCode = (typeof HIGHLIGHT_ARTIFACT_ERROR_CODES)[number];
const ERROR_MESSAGES: Readonly<Record<HighlightArtifactErrorCode, string>> = {
  invalid_root: 'Highlight artifact root must be an absolute local directory',
  store_busy: 'Highlight artifact root already has a live writer',
  closed: 'Highlight artifact store is closed',
  invalid_task: 'Highlight artifact task reference is invalid',
  invalid_candidate: 'Highlight artifact candidate failed validation',
  artifact_read_failed: 'Highlight artifact could not be read safely',
  artifact_corrupt: 'Highlight artifact failed schema or projection validation',
  artifact_unsupported_version: 'Highlight artifact schema version is unsupported',
  artifact_conflict: 'Highlight artifact already has a different receipt',
  artifact_write_failed: 'Highlight artifact could not be committed',
  artifact_missing: 'Completed highlight task has no committed artifact',
  artifact_mismatch: 'Completed highlight task identifiers differ from its artifact',
};

export class HighlightArtifactStoreError extends Error {
  readonly code: HighlightArtifactErrorCode;
  constructor(code: HighlightArtifactErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'HighlightArtifactStoreError';
    this.code = code;
  }
}

function fail(code: HighlightArtifactErrorCode): never {
  throw new HighlightArtifactStoreError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function taskIsValid(task: unknown): task is HighlightBatchTaskV1 {
  if (!isPlainObject(task)) return false;
  return typeof task.id === 'string' && TASK_ID_PATTERN.test(task.id) &&
    typeof task.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(task.sourceSha256) &&
    Number.isSafeInteger(task.attempt) && (task.attempt as number) >= 0 &&
    isPlainObject(task.recording) && task.recording.sourceSha256 === task.sourceSha256;
}

function candidateFields(value: unknown, taskId: string, persisted: boolean): StoredCandidate {
  try {
    if (!isPlainObject(value) || (persisted && !exactKeys(value, CANDIDATE_KEYS))) fail('invalid_candidate');
    const read = (key: (typeof CANDIDATE_KEYS)[number]): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) fail('invalid_candidate');
      return descriptor.value;
    };
    const rawId = read('id');
    if (typeof rawId !== 'string' || rawId.length < 1 || rawId.length > 512 ||
        (persisted && !CANDIDATE_ID_PATTERN.test(rawId))) fail('invalid_candidate');
    const title = read('title');
    const hook = read('hook');
    const reason = read('reason');
    if (typeof title !== 'string' || title.length > 2_048 ||
        typeof hook !== 'string' || hook.length > 2_048 ||
        typeof reason !== 'string' || reason.length > 2_048) fail('invalid_candidate');
    const stored: StoredCandidate = {
      id: persisted ? rawId : buildOpaqueCandidateId(taskId, rawId),
      startSec: read('startSec') as number,
      endSec: read('endSec') as number,
      startMs: read('startMs') as number,
      endMs: read('endMs') as number,
      title, hook, score: read('score') as number, reason,
      recommended: read('recommended') as boolean,
      reviewNote: null,
      visualEvidence: null,
    };
    if (persisted && (read('reviewNote') !== null || read('visualEvidence') !== null)) {
      fail('invalid_candidate');
    }
    return stored;
  } catch {
    fail('invalid_candidate');
  }
}

function sanitizeCandidates(value: unknown, taskId: string, persisted: boolean): StoredCandidate[] {
  try {
    if (!Array.isArray(value) || value.length > 12 ||
        Reflect.ownKeys(value).length !== value.length + 1) fail('invalid_candidate');
    const result: StoredCandidate[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) fail('invalid_candidate');
      result.push(candidateFields(descriptor.value, taskId, persisted));
    }
    return result;
  } catch {
    fail('invalid_candidate');
  }
}

function contentSha256(body: ArtifactBodyV1): string {
  return createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
}

function buildBundle(file: ArtifactBodyV1, task: HighlightBatchTaskV1): HighlightArtifactBundle {
  try {
    const projected = projectHotClipCandidates({
      recording: task.recording,
      observedSourceSha256: task.sourceSha256,
      candidates: file.candidates,
      createdAt: file.createdAt,
    });
    return {
      taskId: task.id,
      attempt: task.attempt,
      candidateIds: projected.map((item) => item.upstreamCandidateId),
      highlightIds: projected.map((item) => item.highlight.id),
      highlights: projected.map((item) => item.highlight),
      reviewRequired: true,
    };
  } catch {
    fail('artifact_corrupt');
  }
}

function parseArtifact(raw: string, task: HighlightBatchTaskV1): HighlightArtifactBundle {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail('artifact_corrupt'); }
  try {
    if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, 'schemaVersion')) {
      fail('artifact_corrupt');
    }
    if (value.schemaVersion !== SCHEMA_VERSION) fail('artifact_unsupported_version');
    if (!exactKeys(value, ['schemaVersion', 'taskId', 'attempt', 'sourceSha256', 'createdAt', 'candidates', 'contentSha256']) ||
        value.taskId !== task.id || value.sourceSha256 !== task.sourceSha256 ||
        !Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1 ||
        (value.attempt as number) > 5 || typeof value.createdAt !== 'string' ||
        typeof value.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentSha256)) fail('artifact_corrupt');
    if (value.attempt !== task.attempt) fail('artifact_conflict');
    const candidates = sanitizeCandidates(value.candidates, task.id, true);
    const body: ArtifactBodyV1 = {
      schemaVersion: SCHEMA_VERSION, taskId: task.id, attempt: task.attempt,
      sourceSha256: task.sourceSha256, createdAt: value.createdAt, candidates,
    };
    if (contentSha256(body) !== value.contentSha256) fail('artifact_corrupt');
    return buildBundle(body, task);
  } catch (error) {
    if (error instanceof HighlightArtifactStoreError &&
        (error.code === 'artifact_unsupported_version' || error.code === 'artifact_conflict')) throw error;
    fail('artifact_corrupt');
  }
}

function readRaw(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('artifact_read_failed');
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof HighlightArtifactStoreError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    fail('artifact_read_failed');
  }
}

function writeRaw(path: string, bytes: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, bytes, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporary, path);
  } catch {
    fail('artifact_write_failed');
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* preserve fixed error */ }
    }
    try { rmSync(temporary, { force: true }); } catch { /* preserve fixed error */ }
  }
}

/** One writer per resolved root in this process. Cross-process atomic CAS is not provided. */
export class HighlightArtifactStore {
  private readonly rootDir: string;
  private readonly lockKey: string;
  private closed = false;

  constructor(options: { rootDir: string }) {
    let root: unknown;
    try { root = options.rootDir; } catch { fail('invalid_root'); }
    if (typeof root !== 'string' || !isAbsolute(root)) fail('invalid_root');
    this.rootDir = resolve(root);
    this.lockKey = process.platform === 'win32' ? this.rootDir.toLowerCase() : this.rootDir;
    if (ACTIVE_STORES.has(this.lockKey)) fail('store_busy');
    try {
      const stat = lstatSync(this.rootDir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_root');
    } catch (error) {
      if (error instanceof HighlightArtifactStoreError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('invalid_root');
    }
    ACTIVE_STORES.add(this.lockKey);
  }

  private assertOpen(): void {
    if (this.closed) fail('closed');
  }

  private assertRootSafe(): void {
    try {
      const stat = lstatSync(this.rootDir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_root');
    } catch (error) {
      if (error instanceof HighlightArtifactStoreError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('invalid_root');
    }
  }

  private pathFor(task: HighlightBatchTaskV1): string {
    this.assertOpen();
    this.assertRootSafe();
    if (!taskIsValid(task)) fail('invalid_task');
    return join(this.rootDir, `${task.id}.json`);
  }

  read(task: HighlightBatchTaskV1): HighlightArtifactBundle | null {
    const raw = readRaw(this.pathFor(task));
    return raw === null ? null : parseArtifact(raw, task);
  }

  commit(task: HighlightBatchTaskV1, candidates: readonly HotClipHighlightCandidate[], createdAt: string): HighlightArtifactBundle {
    const path = this.pathFor(task);
    if (task.state !== 'running' || task.attempt < 1) fail('invalid_task');
    const safeCandidates = sanitizeCandidates(candidates, task.id, false);
    if (task.options.maxClips !== null && safeCandidates.length > task.options.maxClips) fail('invalid_candidate');
    const body: ArtifactBodyV1 = {
      schemaVersion: SCHEMA_VERSION, taskId: task.id, attempt: task.attempt,
      sourceSha256: task.sourceSha256, createdAt, candidates: safeCandidates,
    };
    const bundle = buildBundle(body, task);
    const snapshot: ArtifactFileV1 = { ...body, contentSha256: contentSha256(body) };
    const bytes = JSON.stringify(snapshot);
    const existing = readRaw(path);
    if (existing !== null) {
      parseArtifact(existing, task);
      if (existing !== bytes) fail('artifact_conflict');
      return bundle;
    }
    try {
      mkdirSync(this.rootDir, { recursive: true });
      const stat = lstatSync(this.rootDir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('artifact_write_failed');
    } catch {
      fail('artifact_write_failed');
    }
    if (readRaw(path) !== null) fail('artifact_conflict');
    writeRaw(path, bytes);
    return bundle;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    ACTIVE_STORES.delete(this.lockKey);
  }
}

export interface DurableHotClipRunnerOptions {
  artifacts: HighlightArtifactStore;
  /** Caller supplies an explicitly user-configured executable and authorized local media path. */
  resolveRunOptions: (task: HighlightBatchTaskV1) => Omit<RunHotClipHighlightsOptions, 'signal' | 'maxClips'>;
  /** Must re-observe bytes at the resolved path before starting the sidecar. */
  observeSourceSha256: (task: HighlightBatchTaskV1, videoPath: string, signal: AbortSignal) => Promise<string>;
  createdAt: () => string;
}

/** Sidecar → validated local receipt → queue IDs. The scheduler commits the queue after this returns. */
export function createDurableHotClipRunner(options: DurableHotClipRunnerOptions): HighlightBatchRunner {
  return async (task, signal) => {
    const configured = options.resolveRunOptions(task);
    let observed: string;
    try {
      observed = await options.observeSourceSha256(task, configured.videoPath, signal);
    } catch {
      throw new HighlightBatchSourceError('source_unavailable');
    }
    if (typeof observed !== 'string' || !/^[a-f0-9]{64}$/i.test(observed)) {
      throw new HighlightBatchSourceError('source_unavailable');
    }
    if (observed.toLowerCase() !== task.sourceSha256) {
      throw new HighlightBatchSourceError('source_hash_mismatch');
    }
    const candidates = await runHotClipHighlights({
      ...configured,
      maxClips: task.options.maxClips,
      signal,
    });
    const bundle = options.artifacts.commit(task, candidates, options.createdAt());
    return {
      candidateIds: candidates.map((candidate) => candidate.id),
      highlightIds: bundle.highlightIds,
    };
  };
}

export interface HighlightRecoverySummary {
  queued: number;
  interrupted: number;
  completedFromArtifact: number;
  confirmedCompleted: number;
  orphanedArtifacts: number;
}

/** Call only after the previous process/runner is confirmed dead and the queue writer is owned. */
export function recoverHighlightBatch(
  queue: HighlightBatchQueue,
  artifacts: HighlightArtifactStore,
): HighlightRecoverySummary {
  const entries = queue.list().map((task) => ({ task, bundle: artifacts.read(task) }));
  // Check completed receipts and impossible queued artifacts before changing any queue state.
  for (const { task, bundle } of entries) {
    if (task.state === 'queued' && bundle !== null) fail('artifact_conflict');
    if (task.state === 'completed') {
      if (bundle === null) fail('artifact_missing');
      if (JSON.stringify(task.candidateIds) !== JSON.stringify(bundle.candidateIds) ||
          JSON.stringify(task.highlightIds) !== JSON.stringify(bundle.highlightIds)) fail('artifact_mismatch');
    }
  }
  const summary: HighlightRecoverySummary = {
    queued: 0, interrupted: 0, completedFromArtifact: 0,
    confirmedCompleted: 0, orphanedArtifacts: 0,
  };
  for (const { task, bundle } of entries) {
    if (task.state === 'queued') summary.queued += 1;
    else if (task.state === 'running') {
      if (bundle === null) {
        queue.interrupt(task.id, task.attempt);
        summary.interrupted += 1;
      } else {
        queue.complete(task.id, task.attempt, {
          candidateIds: bundle.candidateIds, highlightIds: bundle.highlightIds,
        });
        summary.completedFromArtifact += 1;
      }
    } else if (task.state === 'completed') {
      queue.complete(task.id, task.attempt, {
        candidateIds: bundle!.candidateIds, highlightIds: bundle!.highlightIds,
      });
      summary.confirmedCompleted += 1;
    } else if (bundle !== null) summary.orphanedArtifacts += 1;
  }
  return summary;
}

/** Explicit local recording import into the durable highlight queue. */
import { randomUUID } from 'node:crypto';
import { extname, isAbsolute, resolve } from 'node:path';
import type { RecordingV1 } from '../../src/types/production-contracts';
import { HighlightBatchQueue, type HighlightBatchTaskV1 } from './highlight-batch-queue';
import { observeAuthorizedLocalSourceSha256 } from './local-source-observer';

const MAX_BATCH_SIZE = 100;
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
};

export type AuthorizedRecordingImportErrorCode = 'invalid_request' | 'source_unavailable';

export class AuthorizedRecordingImportError extends Error {
  readonly code: AuthorizedRecordingImportErrorCode;

  constructor(code: AuthorizedRecordingImportErrorCode) {
    super(code === 'invalid_request'
      ? 'Authorized recording import request is invalid'
      : 'Authorized recording source could not be verified');
    this.name = 'AuthorizedRecordingImportError';
    this.code = code;
  }
}

export interface AuthorizedRecordingImportOptions {
  queue: HighlightBatchQueue;
  /** An explicitly selected directory containing the recording files. */
  mediaRootDir: string;
  videoPaths: readonly string[];
  maxClips?: number | null;
  signal?: AbortSignal;
}

/**
 * Hash every source before writing any task. A repeated path with the same bytes
 * reuses the existing recording identity; changed bytes receive a new identity.
 * Source bytes may still change after import, so the runner must re-observe them.
 */
export async function importAuthorizedRecordings(
  options: AuthorizedRecordingImportOptions,
): Promise<HighlightBatchTaskV1[]> {
  if (!options || !(options.queue instanceof HighlightBatchQueue) ||
      typeof options.mediaRootDir !== 'string' || !isAbsolute(options.mediaRootDir) ||
      !Array.isArray(options.videoPaths) || options.videoPaths.length < 1 ||
      options.videoPaths.length > MAX_BATCH_SIZE) {
    throw new AuthorizedRecordingImportError('invalid_request');
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const rawPath of options.videoPaths) {
    if (typeof rawPath !== 'string' || !isAbsolute(rawPath) ||
        !Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, extname(rawPath).toLowerCase())) {
      throw new AuthorizedRecordingImportError('invalid_request');
    }
    const path = resolve(rawPath);
    const key = process.platform === 'win32' ? path.toLowerCase() : path;
    if (seen.has(key)) throw new AuthorizedRecordingImportError('invalid_request');
    seen.add(key);
    paths.push(path);
  }

  const signal = options.signal ?? new AbortController().signal;
  const existing = options.queue.list();
  const inputs: Array<{
    recording: RecordingV1;
    observedSourceSha256: string;
    options: { maxClips: number | null };
  }> = [];
  for (const videoPath of paths) {
    let sourceSha256: string;
    try {
      sourceSha256 = await observeAuthorizedLocalSourceSha256({
        rootDir: options.mediaRootDir, videoPath, signal,
      });
    } catch {
      throw new AuthorizedRecordingImportError('source_unavailable');
    }
    const previous = existing.find((task) =>
      task.recording.sourceRef === videoPath && task.sourceSha256 === sourceSha256);
    const recording: RecordingV1 = previous?.recording ?? {
      id: randomUUID(),
      sourceRef: videoPath,
      sourceSha256,
      capturedAt: null,
      durationMs: null,
      mimeType: MIME_BY_EXTENSION[extname(videoPath).toLowerCase()],
      transcriptRef: null,
      importedAt: new Date().toISOString(),
    };
    inputs.push({
      recording,
      observedSourceSha256: sourceSha256,
      options: { maxClips: options.maxClips ?? null },
    });
  }
  if (signal.aborted) throw new AuthorizedRecordingImportError('source_unavailable');
  return options.queue.enqueueBatch(inputs);
}

/** Explicit local review → frame-accurate MP4 export, with idempotent provenance receipts. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readVideoDurationMs } from '../media-duration';
import { observeAuthorizedLocalSourceSha256 } from './local-source-observer';
import { ProductHighlightController } from './product-highlight-controller';
import {
  ReviewedClipExportError,
  buildReviewedClipReceipt,
  expectedReviewedClipId,
  listReviewedClipReceipts,
  outputPath,
  partialOutputPath,
  readReviewedClipReceipt,
  receiptPath,
  writeReviewedClipReceipt,
  type ReviewedClipErrorCode,
  type ReviewedClipReceipt,
} from './reviewed-clip-receipts';

export interface ReviewedClipSelection {
  taskId: string;
  highlightId: string;
  startMs: number;
  endMs: number;
}

export interface ReviewedClipBatchRequest {
  mediaRootDir: string;
  reviewConfirmed: true;
  selections: readonly ReviewedClipSelection[];
  concurrency?: 1 | 2;
}

export type ReviewedClipExportResult =
  | {
    status: 'completed'; id: string; taskId: string; highlightId: string;
    outputPath: string; outputSha256: string; outputDurationMs: number; reused: boolean;
  }
  | {
    status: 'failed' | 'cancelled'; id: string | null; taskId: string;
    highlightId: string; code: ReviewedClipErrorCode;
  };

const TASK_RE = /^hbatch_[a-f0-9]{64}$/;
const HIGHLIGHT_RE = /^hlcv1-[a-f0-9]{64}$/;
const MAX_BATCH = 100;
const MAX_CLIP_MS = 30 * 60_000;

function fail(code: ReviewedClipErrorCode): never { throw new ReviewedClipExportError(code); }

function regularFile(path: string): boolean {
  try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink(); }
  catch { return false; }
}

function contained(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function safeObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRequest(raw: unknown): ReviewedClipBatchRequest {
  try {
    if (!safeObject(raw) || raw.reviewConfirmed !== true ||
        typeof raw.mediaRootDir !== 'string' || !isAbsolute(raw.mediaRootDir) ||
        !Array.isArray(raw.selections) || raw.selections.length < 1 ||
        raw.selections.length > MAX_BATCH ||
        (raw.concurrency !== undefined && raw.concurrency !== 1 && raw.concurrency !== 2)) {
      fail(raw && safeObject(raw) && raw.reviewConfirmed !== true ? 'review_required' : 'invalid_request');
    }
    const selections: ReviewedClipSelection[] = [];
    const seen = new Set<string>();
    for (const value of raw.selections) {
      if (!safeObject(value) || typeof value.taskId !== 'string' || !TASK_RE.test(value.taskId) ||
          typeof value.highlightId !== 'string' || !HIGHLIGHT_RE.test(value.highlightId) ||
          typeof value.startMs !== 'number' || !Number.isSafeInteger(value.startMs) || value.startMs < 0 ||
          typeof value.endMs !== 'number' || !Number.isSafeInteger(value.endMs) ||
          value.endMs <= value.startMs || value.endMs - value.startMs > MAX_CLIP_MS) fail('invalid_request');
      const key = `${value.taskId}:${value.highlightId}:${value.startMs}:${value.endMs}`;
      if (seen.has(key)) fail('invalid_request');
      seen.add(key);
      selections.push({
        taskId: value.taskId, highlightId: value.highlightId,
        startMs: value.startMs, endMs: value.endMs,
      });
    }
    return {
      mediaRootDir: resolve(raw.mediaRootDir), reviewConfirmed: true,
      selections, concurrency: (raw.concurrency as 1 | 2 | undefined) ?? 2,
    };
  } catch (error) {
    if (error instanceof ReviewedClipExportError) throw error;
    fail('invalid_request');
  }
}

async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  if (!regularFile(path)) fail('output_conflict');
  const hash = createHash('sha256');
  try {
    for await (const bytes of createReadStream(path)) {
      if (signal?.aborted) fail('cancelled');
      hash.update(bytes);
    }
    if (signal?.aborted) fail('cancelled');
    return hash.digest('hex');
  } catch (error) {
    if (error instanceof ReviewedClipExportError) throw error;
    fail('output_conflict');
  }
}

function exists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    fail('output_conflict');
  }
}

function ensureOutputRoot(root: string): void {
  try {
    mkdirSync(root, { recursive: true });
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('output_conflict');
  } catch (error) {
    if (error instanceof ReviewedClipExportError) throw error;
    fail('output_conflict');
  }
}

function removeUnreceiptedPartial(path: string): void {
  if (!exists(path)) return;
  if (!regularFile(path)) fail('output_conflict');
  try { rmSync(path); } catch { fail('output_conflict'); }
}

function fixedError(error: unknown): ReviewedClipErrorCode {
  return error instanceof ReviewedClipExportError ? error.code : 'internal_error';
}

async function runFfmpeg(executable: string, args: string[], signal: AbortSignal, timeoutMs: number): Promise<void> {
  if (signal.aborted) fail('cancelled');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch { rejectPromise(new ReviewedClipExportError('render_failed')); return; }
    child.stderr?.resume();
    const finish = (error?: ReviewedClipExportError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const onAbort = () => { aborted = true; child.kill(); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', () => finish(new ReviewedClipExportError(aborted ? 'cancelled' : 'render_failed')));
    child.once('close', (code) => finish(
      aborted ? new ReviewedClipExportError('cancelled') :
        timedOut ? new ReviewedClipExportError('render_timeout') :
          code === 0 ? undefined : new ReviewedClipExportError('render_failed'),
    ));
    if (signal.aborted) onAbort();
  });
}

export class ReviewedClipExporter {
  private readonly controller: ProductHighlightController;
  private readonly root: string;
  private readonly ffmpegPath: string | null;
  private readonly ffprobePath: string | null;
  private readonly observeSourceSha256: typeof observeAuthorizedLocalSourceSha256;
  private active: Promise<ReviewedClipExportResult[]> | null = null;
  private activeAbort: AbortController | null = null;
  private stopping = false;

  constructor(options: {
    controller: ProductHighlightController;
    userDataPath: string;
    ffmpegPath: string | null;
    ffprobePath: string | null;
    observeSourceSha256?: typeof observeAuthorizedLocalSourceSha256;
  }) {
    if (!(options?.controller instanceof ProductHighlightController) ||
        typeof options.userDataPath !== 'string' || !isAbsolute(options.userDataPath)) fail('invalid_configuration');
    this.controller = options.controller;
    this.root = join(options.userDataPath, 'highlights-v1', 'reviewed-clips');
    this.ffmpegPath = options.ffmpegPath;
    this.ffprobePath = options.ffprobePath;
    this.observeSourceSha256 = options.observeSourceSha256 ?? observeAuthorizedLocalSourceSha256;
  }

  get hasActiveWork(): boolean { return this.active !== null; }

  list(): ReviewedClipReceipt[] { return listReviewedClipReceipts(this.root); }

  /** Validate a completed output again before handing its path to the editor. */
  async verifiedOutput(id: string): Promise<{ path: string; receipt: ReviewedClipReceipt }> {
    const receipt = readReviewedClipReceipt(receiptPath(this.root, id));
    if (!receipt) fail('output_missing');
    const path = outputPath(this.root, id);
    if (!regularFile(path) || await sha256File(path) !== receipt.outputSha256) fail('output_conflict');
    return { path, receipt };
  }

  async exportBatch(raw: unknown): Promise<ReviewedClipExportResult[]> {
    if (this.stopping) fail('stopped');
    if (this.active) fail('busy');
    const request = normalizeRequest(raw);
    if (!this.ffmpegPath || !this.ffprobePath ||
        !isAbsolute(this.ffmpegPath) || !regularFile(this.ffmpegPath) ||
        !isAbsolute(this.ffprobePath) || !regularFile(this.ffprobePath)) {
      fail('invalid_configuration');
    }
    const abort = new AbortController();
    this.activeAbort = abort;
    const operation = this.runBatch(request, abort.signal);
    const settled = operation.finally(() => {
      if (this.active === settled) this.active = null;
      if (this.activeAbort === abort) this.activeAbort = null;
    });
    this.active = settled;
    return settled;
  }

  cancelActive(): boolean {
    if (!this.activeAbort) return false;
    this.activeAbort.abort();
    return true;
  }

  async stopForShutdown(): Promise<void> {
    this.stopping = true;
    this.activeAbort?.abort();
    if (this.active) await Promise.allSettled([this.active]);
  }

  private async runBatch(request: ReviewedClipBatchRequest, signal: AbortSignal): Promise<ReviewedClipExportResult[]> {
    ensureOutputRoot(this.root);
    const results = new Array<ReviewedClipExportResult>(request.selections.length);
    let next = 0;
    const worker = async () => {
      while (next < request.selections.length) {
        const index = next++;
        const selection = request.selections[index];
        if (signal.aborted) {
          results[index] = { status: 'cancelled', id: null, taskId: selection.taskId,
            highlightId: selection.highlightId, code: 'cancelled' };
          continue;
        }
        try { results[index] = await this.exportOne(request.mediaRootDir, selection, signal); }
        catch (error) {
          const code = fixedError(error);
          results[index] = {
            status: code === 'cancelled' ? 'cancelled' : 'failed', id: null,
            taskId: selection.taskId, highlightId: selection.highlightId, code,
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(request.concurrency ?? 2, request.selections.length) }, worker));
    return results;
  }

  private async exportOne(mediaRootDir: string, selection: ReviewedClipSelection, signal: AbortSignal): Promise<ReviewedClipExportResult> {
    const task = this.controller.list().find((item) => item.id === selection.taskId);
    if (!task || task.state !== 'completed') fail('candidate_not_found');
    const artifact = this.controller.readArtifact(task.id);
    if (!artifact || !artifact.highlights.some((item) => item.id === selection.highlightId)) fail('candidate_not_found');
    const source = task.recording.sourceRef;
    if (!contained(mediaRootDir, source)) fail('source_unavailable');
    if (signal.aborted) fail('cancelled');
    let observed: string;
    try { observed = await this.observeSourceSha256({ rootDir: mediaRootDir, videoPath: source, signal }); }
    catch { fail(signal.aborted ? 'cancelled' : 'source_unavailable'); }
    if (observed !== task.sourceSha256) fail('source_hash_mismatch');
    let sourceDurationMs: number;
    try { sourceDurationMs = await readVideoDurationMs(source, { ffprobePath: this.ffprobePath }); }
    catch { fail('invalid_media'); }
    if (selection.endMs > sourceDurationMs || selection.endMs - selection.startMs < 500) fail('invalid_timecode');
    const id = expectedReviewedClipId({ taskId: task.id, highlightId: selection.highlightId,
      sourceSha256: task.sourceSha256, startMs: selection.startMs, endMs: selection.endMs });
    const final = outputPath(this.root, id);
    const partial = partialOutputPath(this.root, id);
    const receiptFile = receiptPath(this.root, id);
    const previous = readReviewedClipReceipt(receiptFile);
    if (previous) {
      if (previous.taskId !== task.id || previous.highlightId !== selection.highlightId ||
          previous.recordingId !== task.recording.id || previous.sourceSha256 !== task.sourceSha256 ||
          previous.startMs !== selection.startMs || previous.endMs !== selection.endMs) fail('receipt_corrupt');
      if (!exists(final) && regularFile(partial) &&
          await sha256File(partial, signal) === previous.outputSha256) {
        try { renameSync(partial, final); } catch { fail('output_conflict'); }
      }
      if (!regularFile(final) || await sha256File(final, signal) !== previous.outputSha256) fail('output_conflict');
      return { status: 'completed', id, taskId: task.id, highlightId: selection.highlightId,
        outputPath: final, outputSha256: previous.outputSha256,
        outputDurationMs: previous.outputDurationMs, reused: true };
    }
    if (exists(final)) fail('output_conflict');
    removeUnreceiptedPartial(partial);
    const durationMs = selection.endMs - selection.startMs;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-ss', (selection.startMs / 1000).toFixed(3), '-i', source,
      '-t', (durationMs / 1000).toFixed(3),
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', partial,
    ];
    let receiptCommitted = false;
    const reviewedAt = new Date().toISOString();
    try {
      await runFfmpeg(this.ffmpegPath!, args, signal, Math.max(120_000, Math.min(3_600_000, durationMs * 4)));
      if (signal.aborted) fail('cancelled');
      try { observed = await this.observeSourceSha256({ rootDir: mediaRootDir, videoPath: source, signal }); }
      catch { fail(signal.aborted ? 'cancelled' : 'source_unavailable'); }
      if (observed !== task.sourceSha256) fail('source_hash_mismatch');
      let outputDurationMs: number;
      try { outputDurationMs = await readVideoDurationMs(partial, { ffprobePath: this.ffprobePath }); }
      catch { fail('invalid_media'); }
      if (Math.abs(outputDurationMs - durationMs) > 1_000) fail('invalid_media');
      const outputSha256 = await sha256File(partial, signal);
      const receipt = buildReviewedClipReceipt({
        schemaVersion: 1, id, taskId: task.id, highlightId: selection.highlightId,
        recordingId: task.recording.id, sourceSha256: task.sourceSha256,
        startMs: selection.startMs, endMs: selection.endMs, reviewedBy: 'local-owner',
        reviewedAt, renderedAt: new Date().toISOString(), outputSha256, outputDurationMs,
      });
      writeReviewedClipReceipt(receiptFile, receipt);
      receiptCommitted = true;
      if (exists(final)) fail('output_conflict');
      try { renameSync(partial, final); } catch { fail('output_conflict'); }
      return { status: 'completed', id, taskId: task.id, highlightId: selection.highlightId,
        outputPath: final, outputSha256, outputDurationMs, reused: false };
    } finally {
      if (!receiptCommitted) removeUnreceiptedPartial(partial);
    }
  }
}

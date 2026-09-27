/** Immutable local review receipts. Media bytes stay beside these receipts, outside Git. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

export type ReviewedClipErrorCode =
  | 'invalid_request' | 'review_required' | 'busy' | 'stopped' | 'invalid_configuration'
  | 'candidate_not_found' | 'source_unavailable' | 'source_hash_mismatch'
  | 'invalid_media' | 'invalid_timecode' | 'render_failed' | 'render_timeout'
  | 'cancelled' | 'output_conflict' | 'output_missing' | 'receipt_corrupt'
  | 'receipt_write_failed' | 'internal_error';

export class ReviewedClipExportError extends Error {
  readonly code: ReviewedClipErrorCode;
  constructor(code: ReviewedClipErrorCode) {
    super(code);
    this.name = 'ReviewedClipExportError';
    this.code = code;
  }
}

export interface ReviewedClipReceiptBody {
  schemaVersion: 1;
  id: string;
  taskId: string;
  highlightId: string;
  recordingId: string;
  sourceSha256: string;
  startMs: number;
  endMs: number;
  reviewedBy: 'local-owner';
  reviewedAt: string;
  renderedAt: string;
  outputSha256: string;
  outputDurationMs: number;
}

export interface ReviewedClipReceipt extends ReviewedClipReceiptBody {
  contentSha256: string;
}

const BODY_KEYS = [
  'schemaVersion', 'id', 'taskId', 'highlightId', 'recordingId', 'sourceSha256',
  'startMs', 'endMs', 'reviewedBy', 'reviewedAt', 'renderedAt',
  'outputSha256', 'outputDurationMs',
] as const;
const ID_RE = /^hclip_[a-f0-9]{64}$/;
const TASK_RE = /^hbatch_[a-f0-9]{64}$/;
const HIGHLIGHT_RE = /^hlcv1-[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{64}$/;

function fail(code: ReviewedClipErrorCode): never { throw new ReviewedClipExportError(code); }

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function expectedReviewedClipId(value: Pick<ReviewedClipReceiptBody,
  'taskId' | 'highlightId' | 'sourceSha256' | 'startMs' | 'endMs'>): string {
  return `hclip_${createHash('sha256').update(JSON.stringify([
    'lingji-reviewed-clip-v1', value.taskId, value.highlightId,
    value.sourceSha256, value.startMs, value.endMs,
  ]), 'utf8').digest('hex')}`;
}

function isReceipt(value: unknown): value is ReviewedClipReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== BODY_KEYS.length + 1 ||
      !BODY_KEYS.every((key) => Object.prototype.hasOwnProperty.call(raw, key)) ||
      !Object.prototype.hasOwnProperty.call(raw, 'contentSha256')) return false;
  return raw.schemaVersion === 1 &&
    typeof raw.id === 'string' && ID_RE.test(raw.id) &&
    typeof raw.taskId === 'string' && TASK_RE.test(raw.taskId) &&
    typeof raw.highlightId === 'string' && HIGHLIGHT_RE.test(raw.highlightId) &&
    typeof raw.recordingId === 'string' && /^[0-9a-f-]{36}$/i.test(raw.recordingId) &&
    typeof raw.sourceSha256 === 'string' && SHA_RE.test(raw.sourceSha256) &&
    validTime(raw.startMs) && validTime(raw.endMs) && raw.endMs > raw.startMs &&
    raw.reviewedBy === 'local-owner' &&
    typeof raw.reviewedAt === 'string' && !Number.isNaN(Date.parse(raw.reviewedAt)) &&
    typeof raw.renderedAt === 'string' && !Number.isNaN(Date.parse(raw.renderedAt)) &&
    typeof raw.outputSha256 === 'string' && SHA_RE.test(raw.outputSha256) &&
    validTime(raw.outputDurationMs) && raw.outputDurationMs > 0 &&
    typeof raw.contentSha256 === 'string' && SHA_RE.test(raw.contentSha256);
}

export function buildReviewedClipReceipt(body: ReviewedClipReceiptBody): ReviewedClipReceipt {
  const contentSha256 = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
  const receipt = { ...body, contentSha256 };
  if (!isReceipt(receipt)) fail('receipt_corrupt');
  return receipt;
}

export function receiptPath(root: string, id: string): string {
  if (!ID_RE.test(id)) fail('invalid_request');
  return join(root, `${id}.json`);
}

export function outputPath(root: string, id: string): string {
  if (!ID_RE.test(id)) fail('invalid_request');
  return join(root, `${id}.mp4`);
}

export function partialOutputPath(root: string, id: string): string {
  if (!ID_RE.test(id)) fail('invalid_request');
  return join(root, `${id}.part.mp4`);
}

export function readReviewedClipReceipt(path: string): ReviewedClipReceipt | null {
  let raw: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('receipt_corrupt');
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof ReviewedClipExportError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    fail('receipt_corrupt');
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail('receipt_corrupt'); }
  if (!isReceipt(value)) fail('receipt_corrupt');
  if (value.id !== expectedReviewedClipId(value) || basename(path) !== `${value.id}.json`) fail('receipt_corrupt');
  const body = Object.fromEntries(BODY_KEYS.map((key) => [key, value[key]])) as unknown as ReviewedClipReceiptBody;
  if (buildReviewedClipReceipt(body).contentSha256 !== value.contentSha256) fail('receipt_corrupt');
  return value;
}

export function writeReviewedClipReceipt(path: string, receipt: ReviewedClipReceipt): void {
  if (!isReceipt(receipt)) fail('receipt_corrupt');
  if (readReviewedClipReceipt(path)) fail('output_conflict');
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(receipt), 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    if (readReviewedClipReceipt(path)) fail('output_conflict');
    renameSync(temporary, path);
  } catch (error) {
    if (error instanceof ReviewedClipExportError) throw error;
    fail('receipt_write_failed');
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* preserve fixed error */ }
    try { rmSync(temporary, { force: true }); } catch { /* preserve fixed error */ }
  }
}

export function listReviewedClipReceipts(root: string): ReviewedClipReceipt[] {
  let names: string[];
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('receipt_corrupt');
    names = readdirSync(root).filter((name) => ID_RE.test(name.slice(0, -5)) && name.endsWith('.json'));
  } catch (error) {
    if (error instanceof ReviewedClipExportError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    fail('receipt_corrupt');
  }
  if (names.length > 10_000) fail('receipt_corrupt');
  return names.sort().map((name) => {
    const receipt = readReviewedClipReceipt(join(root, name));
    if (!receipt || name !== `${receipt.id}.json`) fail('receipt_corrupt');
    return receipt;
  });
}

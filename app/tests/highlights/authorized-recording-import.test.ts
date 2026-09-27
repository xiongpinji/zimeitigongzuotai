import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HighlightBatchQueue } from '../../electron/highlights/highlight-batch-queue';
import {
  AuthorizedRecordingImportError,
  importAuthorizedRecordings,
} from '../../electron/highlights/authorized-recording-import';

const roots: string[] = [];
const queues: HighlightBatchQueue[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lingji-authorized-import-'));
  roots.push(root);
  const mediaRootDir = join(root, 'media');
  mkdirSync(mediaRootDir);
  const queue = new HighlightBatchQueue({ storePath: join(root, 'queue.json'), now: Date.now });
  queues.push(queue);
  return { root, mediaRootDir, queue };
}

function file(mediaRootDir: string, name: string, bytes: string): string {
  const path = join(mediaRootDir, name);
  writeFileSync(path, bytes, 'utf8');
  return path;
}

async function expectImportError(run: () => Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try { await run(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AuthorizedRecordingImportError);
  expect(caught).toMatchObject({ code });
}

afterEach(() => {
  for (const queue of queues.splice(0)) queue.close();
  for (const root of roots.splice(0)) {
    const checked = resolve(root);
    if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-authorized-import-')) {
      throw new Error('Unsafe authorized recording fixture cleanup');
    }
    rmSync(checked, { recursive: true, force: true });
  }
});

describe('authorized local recording batch import', () => {
  it('hashes two authorized videos and atomically enqueues source-bound tasks', async () => {
    const { root, mediaRootDir, queue } = fixture();
    const first = file(mediaRootDir, 'one.mp4', 'synthetic-video-one');
    const second = file(mediaRootDir, 'two.mov', 'synthetic-video-two');
    const tasks = await importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [first, second], maxClips: 3 });
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.recording.sourceRef)).toEqual([first, second]);
    expect(tasks[0].sourceSha256).toBe(createHash('sha256').update('synthetic-video-one').digest('hex'));
    expect(tasks[1].sourceSha256).toBe(createHash('sha256').update('synthetic-video-two').digest('hex'));
    expect(tasks.every((task) => task.state === 'queued' && task.options.maxClips === 3)).toBe(true);
    const persisted = readFileSync(join(root, 'queue.json'), 'utf8');
    expect(persisted).not.toContain('synthetic-video-one');
    expect(persisted).not.toContain('synthetic-video-two');
  });

  it('reuses the task for a second import and creates a new task after source bytes change', async () => {
    const { mediaRootDir, queue } = fixture();
    const videoPath = file(mediaRootDir, 'source.mp4', 'version-one');
    const first = await importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [videoPath] });
    const repeat = await importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [videoPath] });
    expect(repeat[0].id).toBe(first[0].id);
    expect(queue.list()).toHaveLength(1);
    writeFileSync(videoPath, 'version-two', 'utf8');
    const changed = await importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [videoPath] });
    expect(changed[0].id).not.toBe(first[0].id);
    expect(queue.list()).toHaveLength(2);
  });

  it('rejects the whole batch when a later source is missing', async () => {
    const { root, mediaRootDir, queue } = fixture();
    const valid = file(mediaRootDir, 'good.mp4', 'synthetic-good-video');
    await expectImportError(
      () => importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [valid, join(mediaRootDir, 'missing.mp4')] }),
      'source_unavailable',
    );
    expect(queue.list()).toEqual([]);
    expect(readFileSync(join(root, 'media', 'good.mp4'), 'utf8')).toBe('synthetic-good-video');
  });

  it('rejects paths outside the authorized root and non-video file types', async () => {
    const { root, mediaRootDir, queue } = fixture();
    const outside = join(root, 'outside.mp4');
    writeFileSync(outside, 'outside', 'utf8');
    await expectImportError(
      () => importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [outside] }),
      'source_unavailable',
    );
    const text = file(mediaRootDir, 'notes.txt', 'not a video');
    await expectImportError(
      () => importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [text] }),
      'invalid_request',
    );
    expect(queue.list()).toEqual([]);
  });

  it('rejects duplicate paths, empty batches and cancellation without a partial write', async () => {
    const { mediaRootDir, queue } = fixture();
    const path = file(mediaRootDir, 'a.mp4', 'a');
    await expectImportError(() => importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [path, path] }), 'invalid_request');
    await expectImportError(() => importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [] }), 'invalid_request');
    const controller = new AbortController();
    controller.abort();
    await expectImportError(
      () => importAuthorizedRecordings({ queue, mediaRootDir, videoPaths: [path], signal: controller.signal }),
      'source_unavailable',
    );
    expect(queue.list()).toEqual([]);
  });
});

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
  it('stores an explicitly paired SRT by content hash and gives changed subtitles a new task identity', async () => {
    const { root, mediaRootDir, queue } = fixture();
    const videoPath = file(mediaRootDir, 'session.mp4', 'synthetic-video');
    const subtitlePath = file(mediaRootDir, 'session.srt', '1\n00:00:00,000 --> 00:00:02,000\nFirst\n');
    const subtitleStoreDir = join(root, 'private-subtitles');
    const input = { queue, mediaRootDir, videoPaths: [videoPath], subtitlePaths: [subtitlePath], subtitleStoreDir };
    const [first] = await importAuthorizedRecordings(input);
    const digest = createHash('sha256').update(readFileSync(subtitlePath)).digest('hex');
    expect(first.recording.transcriptRef).toBe(join(subtitleStoreDir, `${digest}.srt`));
    expect(readFileSync(first.recording.transcriptRef!, 'utf8')).toBe(readFileSync(subtitlePath, 'utf8'));
    const [repeat] = await importAuthorizedRecordings(input);
    expect(repeat.id).toBe(first.id);
    writeFileSync(subtitlePath, '1\n00:00:00,000 --> 00:00:02,000\nChanged\n');
    const [changed] = await importAuthorizedRecordings(input);
    expect(changed.id).not.toBe(first.id);
    expect(changed.recording.transcriptRef).not.toBe(first.recording.transcriptRef);
    expect(queue.list()).toHaveLength(2);
  });

  it('rejects an outside or missing SRT without adding any task', async () => {
    const { root, mediaRootDir, queue } = fixture();
    const videoPath = file(mediaRootDir, 'session.mp4', 'synthetic-video');
    const outside = join(root, 'outside.srt');
    writeFileSync(outside, 'outside');
    const subtitleStoreDir = join(root, 'private-subtitles');
    await expectImportError(() => importAuthorizedRecordings({ queue, mediaRootDir,
      videoPaths: [videoPath], subtitlePaths: [outside], subtitleStoreDir }), 'invalid_request');
    await expectImportError(() => importAuthorizedRecordings({ queue, mediaRootDir,
      videoPaths: [videoPath], subtitlePaths: [join(mediaRootDir, 'session.srt')], subtitleStoreDir }), 'source_unavailable');
    expect(queue.list()).toEqual([]);
  });

  it('does not silently repair a tampered content-addressed subtitle receipt on reimport', async () => {
    const { root, mediaRootDir, queue } = fixture();
    const videoPath = file(mediaRootDir, 'session.mp4', 'synthetic-video');
    const subtitlePath = file(mediaRootDir, 'session.srt', '1\n00:00:00,000 --> 00:00:02,000\nFirst\n');
    const input = { queue, mediaRootDir, videoPaths: [videoPath],
      subtitlePaths: [subtitlePath], subtitleStoreDir: join(root, 'private-subtitles') };
    const [task] = await importAuthorizedRecordings(input);
    writeFileSync(task.recording.transcriptRef!, 'tampered');
    await expectImportError(() => importAuthorizedRecordings(input), 'source_unavailable');
    expect(queue.list()).toHaveLength(1);
    expect(readFileSync(task.recording.transcriptRef!, 'utf8')).toBe('tampered');
  });

  it('bounds SRT snapshot size before enqueueing', async () => {
    const { root, mediaRootDir, queue } = fixture();
    const videoPath = file(mediaRootDir, 'session.mp4', 'synthetic-video');
    const subtitlePath = join(mediaRootDir, 'session.srt');
    writeFileSync(subtitlePath, Buffer.alloc(16 * 1024 * 1024 + 1));
    await expectImportError(() => importAuthorizedRecordings({ queue, mediaRootDir,
      videoPaths: [videoPath], subtitlePaths: [subtitlePath],
      subtitleStoreDir: join(root, 'private-subtitles') }), 'source_unavailable');
    expect(queue.list()).toEqual([]);
  });

  it('rejects a subtitle paired to a different recording name', async () => {
    const { root, mediaRootDir, queue } = fixture();
    const videoPath = file(mediaRootDir, 'session.mp4', 'synthetic-video');
    const wrong = file(mediaRootDir, 'other.srt', '1\n00:00:00,000 --> 00:00:02,000\nOther\n');
    await expectImportError(() => importAuthorizedRecordings({ queue, mediaRootDir,
      videoPaths: [videoPath], subtitlePaths: [wrong],
      subtitleStoreDir: join(root, 'private-subtitles') }), 'invalid_request');
    expect(queue.list()).toEqual([]);
  });

  it('rejects missing subtitle array entries instead of treating them as an ASR choice', async () => {
    const { root, mediaRootDir, queue } = fixture();
    const videoPath = file(mediaRootDir, 'session.mp4', 'synthetic-video');
    const subtitleStoreDir = join(root, 'private-subtitles');
    const sparse = new Array<string | null>(1);
    for (const subtitlePaths of [sparse, [undefined] as unknown as (string | null)[]]) {
      await expectImportError(() => importAuthorizedRecordings({ queue, mediaRootDir,
        videoPaths: [videoPath], subtitlePaths, subtitleStoreDir }), 'invalid_request');
    }
    expect(queue.list()).toEqual([]);
  });

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

  it('rechecks a trusted authorization after hashing and before the atomic queue write', async () => {
    const { mediaRootDir, queue } = fixture();
    const path = file(mediaRootDir, 'a.mp4', 'synthetic-video');
    await expectImportError(() => importAuthorizedRecordings({ queue, mediaRootDir,
      videoPaths: [path], beforeEnqueue: async () => false }), 'authorization_expired');
    expect(queue.list()).toEqual([]);
    const tasks = await importAuthorizedRecordings({ queue, mediaRootDir,
      videoPaths: [path], beforeEnqueue: async () => true });
    expect(tasks).toHaveLength(1);
  });
});

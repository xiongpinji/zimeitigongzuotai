import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordingV1 } from '../../src/types/production-contracts';
import {
  HighlightBatchQueue,
  HighlightBatchQueueError,
} from '../../electron/highlights/highlight-batch-queue';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const MARKER = 'SECRET-MEDIA-BODY-VISUAL-EVIDENCE-DO-NOT-PERSIST';
const roots: string[] = [];

function tempStore(): string {
  const root = mkdtempSync(join(tmpdir(), 'lingji-h1s2b-'));
  roots.push(root);
  return join(root, 'batch.json');
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const checked = resolve(root);
    if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-h1s2b-')) {
      throw new Error('unsafe test cleanup path');
    }
    rmSync(checked, { recursive: true, force: true });
  }
});

function recording(id = 'rec-1', hash = HASH_A): RecordingV1 {
  return {
    id,
    sourceRef: `media://${id}`,
    sourceSha256: hash,
    capturedAt: null,
    durationMs: 120_000,
    mimeType: 'video/mp4',
    transcriptRef: null,
    importedAt: '2026-09-26T00:00:00Z',
  };
}

function input(id = 'rec-1', hash = HASH_A, maxClips: number | null = 4) {
  return {
    recording: recording(id, hash),
    observedSourceSha256: hash,
    options: { maxClips },
  };
}

function open(storePath: string) {
  return new HighlightBatchQueue({ storePath, now: () => 1_000 });
}

function expectCode(fn: () => unknown, code: string) {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(HighlightBatchQueueError);
  expect((error as HighlightBatchQueueError).code).toBe(code);
  const safe = error as HighlightBatchQueueError;
  expect(`${safe.name}|${safe.code}|${safe.message}`).not.toContain(MARKER);
}

describe('HighlightBatchQueue durable core（合成录屏，不调用 HotClip）', () => {
  it('相同来源+选项稳定去重；不同来源、哈希或选项获得不同任务，顺序保持', () => {
    const storePath = tempStore();
    const queue = open(storePath);
    const first = queue.enqueueBatch([input('rec-a'), input('rec-b')]);
    expect(first.map((task) => task.recording.id)).toEqual(['rec-a', 'rec-b']);
    expect(first[0].id).toMatch(/^hbatch_[0-9a-f]{64}$/);
    expect(first[0].state).toBe('queued');
    expect(first[0].attempt).toBe(0);
    expect(first[0].candidateIds).toEqual([]);
    expect(first[0].highlightIds).toEqual([]);

    const same = queue.enqueueBatch([input('rec-a', HASH_A.toUpperCase())]);
    expect(same[0].id).toBe(first[0].id);
    expect(queue.list()).toHaveLength(2);
    const variants = queue.enqueueBatch([
      input('rec-a', HASH_B),
      input('rec-a', HASH_A, 5),
    ]);
    expect(new Set([first[0].id, ...variants.map((task) => task.id)]).size).toBe(3);
    expect(queue.list()).toHaveLength(4);
    queue.close();
  });

  it('混合有效和非法录屏或摘要整批拒绝，磁盘与内存都不改变', () => {
    const storePath = tempStore();
    const queue = open(storePath);
    const [original] = queue.enqueueBatch([input()]);
    const before = readFileSync(storePath, 'utf8');
    expectCode(
      () => queue.enqueueBatch([input('rec-valid'), { ...input('rec-bad'), observedSourceSha256: HASH_B }]),
      'source_hash_mismatch',
    );
    expectCode(
      () => queue.enqueueBatch([input('rec-valid'), { ...input('rec-bad'), recording: recording('rec-bad', 'bad-hash') }]),
      'invalid_recording',
    );
    expect(queue.list()).toEqual([original]);
    expect(readFileSync(storePath, 'utf8')).toBe(before);
    queue.close();
  });

  it('非法 maxClips 与重复批项固定拒绝，不写部分任务', () => {
    const storePath = tempStore();
    const queue = open(storePath);
    for (const maxClips of [0, 13, 1.5, Number.NaN]) {
      expectCode(() => queue.enqueueBatch([input('valid'), input('bad', HASH_A, maxClips)]), 'invalid_options');
    }
    expectCode(() => queue.enqueueBatch([input(), input()]), 'duplicate_input');
    expect(queue.list()).toEqual([]);
    queue.close();
  });

  it('输入访问器伪造队列错误也必须归一化，不能泄露消息', () => {
    const queue = open(tempStore());
    const forged = new HighlightBatchQueueError('invalid_input');
    forged.message = MARKER;
    const malicious = { ...input() };
    Object.defineProperty(malicious, 'recording', {
      get() { throw forged; },
    });
    let error: unknown;
    try { queue.enqueueBatch([malicious]); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(HighlightBatchQueueError);
    expect((error as HighlightBatchQueueError).code).toBe('invalid_input');
    expect((error as Error).message).not.toContain(MARKER);
    expect(queue.list()).toEqual([]);
    queue.close();
  });

  it('输入数组索引访问器抛错只返回固定错误，整批无写入', () => {
    const queue = open(tempStore());
    const array = [input()];
    Object.defineProperty(array, '0', { get() { throw new Error(MARKER); } });
    expectCode(() => queue.enqueueBatch(array), 'invalid_batch');
    expect(queue.list()).toEqual([]);
    queue.close();
  });

  it('旧调用签发的错误被篡改后从输入 getter 抛出，必须重新签发固定消息', () => {
    const queue = open(tempStore());
    let issued: HighlightBatchQueueError | null = null;
    try { queue.enqueueBatch([input('bad', 'not-a-hash')]); } catch (error) { issued = error as HighlightBatchQueueError; }
    expect(issued).toBeInstanceOf(HighlightBatchQueueError);
    issued!.message = MARKER;
    const malicious = { ...input() };
    Object.defineProperty(malicious, 'recording', { get() { throw issued; } });
    expectCode(() => queue.enqueueBatch([malicious]), 'invalid_input');
    queue.close();
  });

  it('时钟回拨不能写出下次打不开的快照，原任务和磁盘保持可读', () => {
    const storePath = tempStore();
    const first = new HighlightBatchQueue({ storePath, now: () => 2_000 });
    const [saved] = first.enqueueBatch([input()]);
    first.close();
    const before = readFileSync(storePath, 'utf8');
    const staleClock = new HighlightBatchQueue({ storePath, now: () => 1_000 });
    expectCode(() => staleClock.enqueueBatch([input('rec-2')]), 'invalid_clock');
    expect(staleClock.list()).toEqual([saved]);
    expect(readFileSync(storePath, 'utf8')).toBe(before);
    staleClock.close();
    const reopened = open(storePath);
    expect(reopened.list()).toEqual([saved]);
    reopened.close();
  });

  it('同键但录屏边界元数据变化必须显式冲突，不能暗用旧 durationMs', () => {
    const queue = open(tempStore());
    queue.enqueueBatch([input()]);
    const changed = input();
    changed.recording.durationMs = null;
    expectCode(() => queue.enqueueBatch([changed]), 'recording_conflict');
    expect(queue.list()[0].recording.durationMs).toBe(120_000);
    queue.close();
  });

  it('省略与显式 undefined 的可选 maxClips 归一为同一任务', () => {
    const queue = open(tempStore());
    const omitted = { ...input(), options: {} };
    const explicit = { ...input(), options: { maxClips: undefined } };
    const first = queue.enqueueBatch([omitted])[0];
    expect(queue.enqueueBatch([explicit])[0].id).toBe(first.id);
    queue.close();
  });

  it('构造选项只读一次；非法路径、时钟和批类型以固定码拒绝，关闭后不可继续操作', () => {
    const storePath = tempStore();
    let pathReads = 0;
    const options = { now: () => 1_000 } as { storePath: string; now: () => number };
    Object.defineProperty(options, 'storePath', {
      get() { pathReads += 1; return pathReads === 1 ? storePath : 'relative/unsafe'; },
    });
    const queue = new HighlightBatchQueue(options);
    expect(pathReads).toBe(1);
    expectCode(() => queue.enqueueBatch(null as never), 'invalid_batch');
    queue.close();
    expectCode(() => queue.list(), 'closed');
    expectCode(() => new HighlightBatchQueue({ storePath: 'relative/path', now: () => 0 }), 'invalid_store_path');
    expectCode(() => new HighlightBatchQueue({ storePath, now: null as never }), 'invalid_clock');
  });

  it('重开后同键不重复入队；只持久化安全录屏引用和任务状态，不存视觉载荷', () => {
    const storePath = tempStore();
    const queue = open(storePath);
    const enriched = input();
    Object.defineProperty(enriched, 'visualEvidence', { value: MARKER, enumerable: false });
    const [saved] = queue.enqueueBatch([enriched]);
    queue.close();
    const bytes = readFileSync(storePath, 'utf8');
    expect(bytes).not.toContain(MARKER);
    expect(bytes).toContain('media://rec-1');

    const reopened = open(storePath);
    expect(reopened.get(saved.id)).toEqual(saved);
    expect(reopened.enqueueBatch([input()])[0].id).toBe(saved.id);
    expect(reopened.list()).toHaveLength(1);
    reopened.close();
  });

  it('重开 completed 零候选任务不会自动重跑或覆盖结果；返回值不能改写队列内存', () => {
    const storePath = tempStore();
    const queue = open(storePath);
    const [task] = queue.enqueueBatch([input()]);
    queue.close();
    const snapshot = JSON.parse(readFileSync(storePath, 'utf8'));
    snapshot.tasks[0].state = 'completed';
    snapshot.tasks[0].attempt = 1;
    snapshot.tasks[0].updatedAt = 1_001;
    snapshot.updatedAt = 1_001;
    writeFileSync(storePath, JSON.stringify(snapshot), 'utf8');
    const before = readFileSync(storePath, 'utf8');

    const reopened = open(storePath);
    const [same] = reopened.enqueueBatch([input()]);
    expect(same.id).toBe(task.id);
    expect(same.state).toBe('completed');
    expect(same.attempt).toBe(1);
    expect(readFileSync(storePath, 'utf8')).toBe(before);
    same.state = 'queued';
    expect(reopened.get(task.id)?.state).toBe('completed');
    reopened.close();
  });

  it('外部改写落盘字节后拒绝陈旧写入，内存视图保持原任务', () => {
    const storePath = tempStore();
    const queue = open(storePath);
    const [first] = queue.enqueueBatch([input()]);
    writeFileSync(storePath, '{external change}', 'utf8');
    expectCode(() => queue.enqueueBatch([input('rec-2')]), 'store_changed');
    expect(queue.list()).toEqual([first]);
    expect(readFileSync(storePath, 'utf8')).toBe('{external change}');
    queue.close();
  });

  it('损坏、未来版本、重复 ID 和目录存储均 fail closed', () => {
    const storePath = tempStore();
    writeFileSync(storePath, '{bad json', 'utf8');
    expectCode(() => open(storePath), 'store_corrupt');
    writeFileSync(storePath, JSON.stringify({ schemaVersion: 99, updatedAt: 0, tasks: [] }), 'utf8');
    expectCode(() => open(storePath), 'store_unsupported_version');

    const seed = open(join(dirname(storePath), 'valid.json'));
    seed.enqueueBatch([input('rec-1', HASH_A, null)]);
    seed.close();
    const valid = JSON.parse(readFileSync(join(dirname(storePath), 'valid.json'), 'utf8'));
    writeFileSync(storePath, JSON.stringify({ ...valid, tasks: [valid.tasks[0], valid.tasks[0]] }), 'utf8');
    expectCode(() => open(storePath), 'store_corrupt');
    writeFileSync(storePath, JSON.stringify({ ...valid, tasks: [{ ...valid.tasks[0], options: {} }] }), 'utf8');
    expectCode(() => open(storePath), 'store_corrupt');
    writeFileSync(storePath, JSON.stringify({ ...valid, tasks: [{ ...valid.tasks[0], candidateIds: ['unexpected'] }] }), 'utf8');
    expectCode(() => open(storePath), 'store_corrupt');
    writeFileSync(storePath, JSON.stringify({ ...valid, tasks: [{ ...valid.tasks[0], id: `hbatch_${'f'.repeat(64)}` }] }), 'utf8');
    expectCode(() => open(storePath), 'store_corrupt');
    expectCode(() => open(dirname(storePath)), 'store_read_failed');
  });

  it.skipIf(process.platform === 'win32')('符号链接存储拒绝读取，不跟随到目标文件（Windows 创建需额外权限）', () => {
    const storePath = tempStore();
    const target = join(dirname(storePath), 'target.json');
    writeFileSync(target, JSON.stringify({ schemaVersion: 1, updatedAt: 0, tasks: [] }), 'utf8');
    symlinkSync(target, storePath, 'file');
    expectCode(() => open(storePath), 'store_read_failed');
    expect(readFileSync(target, 'utf8')).toContain('schemaVersion');
  });

  it('同进程相同 storePath 只有一个活写者，close 后才能重开', () => {
    const storePath = tempStore();
    const first = open(storePath);
    expectCode(() => open(storePath), 'store_busy');
    if (process.platform === 'win32') {
      const driveCaseAlias = `${storePath[0].toLowerCase()}${storePath.slice(1)}`;
      expectCode(() => open(driveCaseAlias), 'store_busy');
    }
    first.close();
    const second = open(storePath);
    expect(second.list()).toEqual([]);
    second.close();
  });
});

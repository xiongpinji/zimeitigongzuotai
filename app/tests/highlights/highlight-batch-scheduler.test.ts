import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecordingV1 } from '../../src/types/production-contracts';
import { HighlightBatchQueue } from '../../electron/highlights/highlight-batch-queue';
import { HotClipSidecarError, runHotClipHighlights } from '../../electron/highlights/hotclip-sidecar';
import { HighlightBatchScheduler, HighlightBatchSchedulerError } from '../../electron/highlights/highlight-batch-scheduler';

const HASH = 'a'.repeat(64);
const roots: string[] = [];

function queue(): HighlightBatchQueue {
  const root = mkdtempSync(join(tmpdir(), 'lingji-h1s2b-scheduler-'));
  roots.push(root);
  return new HighlightBatchQueue({ storePath: join(root, 'batch.json'), now: () => 1_000 });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const checked = resolve(root);
    if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-h1s2b-scheduler-')) {
      throw new Error('unsafe scheduler test cleanup path');
    }
    rmSync(checked, { recursive: true, force: true });
  }
});

function input(id: string) {
  const recording: RecordingV1 = {
    id, sourceRef: `media://${id}`, sourceSha256: HASH,
    capturedAt: null, durationMs: 120_000, mimeType: 'video/mp4',
    transcriptRef: null, importedAt: '2026-09-26T00:00:00Z',
  };
  return { recording, observedSourceSha256: HASH, options: { maxClips: 4 } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function waitForPidGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

const EMPTY = { candidateIds: [], highlightIds: [] };

describe('HighlightBatchScheduler（合成录屏与假 runner）', () => {
  it('两个并发槽上限、第三条排队；单录屏失败不阻断其余完成', async () => {
    const store = queue();
    const tasks = store.enqueueBatch([input('rec-a'), input('rec-b'), input('rec-c')]);
    const gates = new Map(['rec-a', 'rec-b', 'rec-c'].map((id) => [id, deferred<typeof EMPTY>()]));
    const starts: string[] = [];
    let active = 0;
    let peak = 0;
    const scheduler = new HighlightBatchScheduler({
      queue: store, concurrency: 2, maxAttempts: 3,
      runner: async (task) => {
        starts.push(task.recording.id);
        active += 1;
        peak = Math.max(peak, active);
        try { return await gates.get(task.recording.id)!.promise; } finally { active -= 1; }
      },
    });
    const draining = scheduler.runQueued();
    await vi.waitFor(() => expect(starts).toEqual(['rec-a', 'rec-b']));
    expect(peak).toBe(2);
    expect(store.get(tasks[2].id)?.state).toBe('queued');
    gates.get('rec-a')!.resolve(EMPTY);
    await vi.waitFor(() => expect(starts).toEqual(['rec-a', 'rec-b', 'rec-c']));
    gates.get('rec-b')!.reject(new HotClipSidecarError('timeout', 'private raw stderr'));
    gates.get('rec-c')!.resolve(EMPTY);
    await draining;
    expect(peak).toBe(2);
    expect(tasks.map((task) => store.get(task.id)?.state)).toEqual(['completed', 'failed', 'completed']);
    expect(store.get(tasks[1].id)?.lastErrorCode).toBe('sidecar_timeout');
    expect(readFileSync(join(roots[0], 'batch.json'), 'utf8')).not.toContain('private raw stderr');
    store.close();
  });

  it('取消先持久化再传播 AbortSignal，迟到完成不能覆盖取消；下一条仍继续', async () => {
    const store = queue();
    const [first, second] = store.enqueueBatch([input('rec-a'), input('rec-b')]);
    const gate = deferred<typeof EMPTY>();
    let signal: AbortSignal | undefined;
    const scheduler = new HighlightBatchScheduler({
      queue: store, concurrency: 1, maxAttempts: 2,
      runner: async (task, abortSignal) => {
        if (task.id === first.id) { signal = abortSignal; return gate.promise; }
        return EMPTY;
      },
    });
    const draining = scheduler.runQueued();
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(scheduler.cancel(first.id).state).toBe('cancelled');
    expect(signal?.aborted).toBe(true);
    gate.resolve(EMPTY);
    await draining;
    expect(store.get(first.id)?.state).toBe('cancelled');
    expect(store.get(second.id)?.state).toBe('completed');
    store.close();
  });

  it('runner 因取消而拒绝时保留 cancelled，剩余任务继续', async () => {
    const store = queue();
    const [first, second] = store.enqueueBatch([input('rec-a'), input('rec-b')]);
    let started = false;
    const scheduler = new HighlightBatchScheduler({
      queue: store, concurrency: 1, maxAttempts: 2,
      runner: async (task, signal) => {
        if (task.id !== first.id) return EMPTY;
        started = true;
        return new Promise<typeof EMPTY>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new HotClipSidecarError('cancelled', 'private abort')), { once: true });
        });
      },
    });
    const draining = scheduler.runQueued();
    await vi.waitFor(() => expect(started).toBe(true));
    scheduler.cancel(first.id);
    await draining;
    expect(store.get(first.id)).toMatchObject({ state: 'cancelled', lastErrorCode: null });
    expect(store.get(second.id)?.state).toBe('completed');
    expect(readFileSync(join(roots[0], 'batch.json'), 'utf8')).not.toContain('private abort');
    store.close();
  });

  it('取消信号贯通真实 sidecar 进程边界并终止合成子进程', async () => {
    const store = queue();
    const [task] = store.enqueueBatch([input('rec-a')]);
    const root = roots[0];
    const script = join(root, 'fake-hotclip.cjs');
    const probe = join(root, 'child.pid');
    writeFileSync(script,
      `require('node:fs').writeFileSync(${JSON.stringify(probe)}, String(process.pid)); setInterval(() => {}, 1000);`,
      'utf8');
    const scheduler = new HighlightBatchScheduler({
      queue: store, concurrency: 1, maxAttempts: 2,
      runner: async (_task, signal) => {
        await runHotClipHighlights({
          executable: process.execPath, argsPrefix: [script], cwd: root,
          videoPath: join(root, 'synthetic.mp4'), timeoutMs: 30_000,
          killGraceMs: 500, signal,
        });
        return EMPTY;
      },
    });
    const draining = scheduler.runQueued();
    await vi.waitFor(() => expect(existsSync(probe)).toBe(true), { timeout: 10_000 });
    const pid = Number(readFileSync(probe, 'utf8'));
    scheduler.cancel(task.id);
    await draining;
    expect(store.get(task.id)?.state).toBe('cancelled');
    expect(await waitForPidGone(pid)).toBe(true);
    store.close();
  }, 45_000);

  it('不自动重试；手工 retry 后进入下一尝试，重叠调度调用拒绝', async () => {
    const store = queue();
    const [task] = store.enqueueBatch([input('rec-a')]);
    const gate = deferred<typeof EMPTY>();
    let calls = 0;
    const scheduler = new HighlightBatchScheduler({
      queue: store, concurrency: 1, maxAttempts: 2,
      runner: async () => {
        calls += 1;
        if (calls === 1) return gate.promise;
        return EMPTY;
      },
    });
    const first = scheduler.runQueued();
    await expect(scheduler.runQueued()).rejects.toMatchObject({ code: 'scheduler_busy' });
    gate.reject(new HotClipSidecarError('timeout', 'private timeout details'));
    await first;
    expect(store.get(task.id)).toMatchObject({ state: 'failed', attempt: 1 });
    await scheduler.runQueued();
    expect(calls).toBe(1);
    store.retry(task.id, 2);
    await scheduler.runQueued();
    expect(store.get(task.id)).toMatchObject({ state: 'completed', attempt: 2 });
    expect(calls).toBe(2);
    store.close();
  });

  it('上游候选 ID 先转不透明稳定标识，磁盘不落其原文', async () => {
    const store = queue();
    const [bad, good] = store.enqueueBatch([input('rec-bad'), input('rec-good')]);
    const scheduler = new HighlightBatchScheduler({
      queue: store, concurrency: 2, maxAttempts: 2,
      runner: async (task) => task.id === bad.id
        ? { candidateIds: ['PRIVATE-MEDIA-BODY'], highlightIds: [`hlcv1-${HASH}`] }
        : EMPTY,
    });
    await scheduler.runQueued();
    expect(store.get(bad.id)?.state).toBe('completed');
    expect(store.get(bad.id)?.candidateIds).toEqual([expect.stringMatching(/^hcand_[a-f0-9]{64}$/)]);
    expect(store.get(good.id)?.state).toBe('completed');
    expect(readFileSync(join(roots[0], 'batch.json'), 'utf8')).not.toContain('PRIVATE-MEDIA-BODY');
    store.close();
  });

  it('相同录屏输入跨独立存储得到相同不透明候选 ID', async () => {
    const candidateIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const store = queue();
      const [task] = store.enqueueBatch([input('same-recording')]);
      const scheduler = new HighlightBatchScheduler({
        queue: store, concurrency: 1, maxAttempts: 2,
        runner: async () => ({ candidateIds: ['upstream-1'], highlightIds: [`hlcv1-${HASH}`] }),
      });
      await scheduler.runQueued();
      candidateIds.push(store.get(task.id)!.candidateIds[0]);
      store.close();
    }
    expect(candidateIds[0]).toBe(candidateIds[1]);
    expect(candidateIds[0]).toMatch(/^hcand_[a-f0-9]{64}$/);
  });

  it('候选与高光 ID 数量不对应时不能假报完成', async () => {
    const store = queue();
    const [task] = store.enqueueBatch([input('rec-a')]);
    const scheduler = new HighlightBatchScheduler({
      queue: store, concurrency: 1, maxAttempts: 2,
      runner: async () => ({ candidateIds: ['upstream-candidate'], highlightIds: [] }),
    });
    await scheduler.runQueued();
    expect(store.get(task.id)).toMatchObject({ state: 'failed', lastErrorCode: 'projection_failed' });
    store.close();
  });

  it('畸形 runner 结果只使当前任务失败，其余任务继续', async () => {
    const store = queue();
    const [bad, good] = store.enqueueBatch([input('rec-bad'), input('rec-good')]);
    const scheduler = new HighlightBatchScheduler({
      queue: store, concurrency: 2, maxAttempts: 2,
      runner: async (task) => task.id === bad.id
        ? { candidateIds: 'PRIVATE-MEDIA-BODY', highlightIds: [] } as never
        : EMPTY,
    });
    await scheduler.runQueued();
    expect(store.get(bad.id)).toMatchObject({ state: 'failed', lastErrorCode: 'projection_failed' });
    expect(store.get(good.id)?.state).toBe('completed');
    expect(readFileSync(join(roots[0], 'batch.json'), 'utf8')).not.toContain('PRIVATE-MEDIA-BODY');
    store.close();
  });

  it('未知 runner 异常只记录固定 internal_error，不落原始消息', async () => {
    const store = queue();
    const [task] = store.enqueueBatch([input('rec-a')]);
    const scheduler = new HighlightBatchScheduler({
      queue: store, concurrency: 1, maxAttempts: 2,
      runner: async () => { throw new Error('PRIVATE-API-TOKEN'); },
    });
    await scheduler.runQueued();
    expect(store.get(task.id)).toMatchObject({ state: 'failed', lastErrorCode: 'internal_error' });
    expect(readFileSync(join(roots[0], 'batch.json'), 'utf8')).not.toContain('PRIVATE-API-TOKEN');
    store.close();
  });

  it('配置和调用错误使用固定码', () => {
    const store = queue();
    expect(() => new HighlightBatchScheduler({
      queue: store, concurrency: 0, maxAttempts: 2, runner: async () => EMPTY,
    })).toThrowError(HighlightBatchSchedulerError);
    store.close();
  });
});

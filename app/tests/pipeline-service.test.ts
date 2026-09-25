import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PipelineService } from '../electron/pipeline';

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-svc-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1,
    createdAt: 'x', updatedAt: 'x',
    timeline: null,
    aiAnalysis: { analysisResult: null, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  return dir;
}

describe('PipelineService', () => {
  let svc: PipelineService;
  let dir: string;
  beforeEach(() => {
    svc = new PipelineService();
    dir = tmpProject();
  });

  it('createTask returns taskId immediately and runs async', async () => {
    let observedHandle = false;
    const { taskId } = await svc.createTask('tts', dir, async (handle) => {
      observedHandle = !!handle;
      handle.update({ phase: 'a', percent: 50 });
      return { audioPath: 'a', srtPath: 'b', durationSec: 1 };
    });
    expect(taskId).toBeTruthy();
    await svc.waitForSettle(taskId);
    const t = svc.getTask(taskId)!;
    expect(observedHandle).toBe(true);
    expect(t.status).toBe('succeeded');
    expect(t.result).toEqual({ audioPath: 'a', srtPath: 'b', durationSec: 1 });
  });

  it('throws task_conflict when same kind already active', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = await svc.createTask('tts', dir, async () => { await gate; });
    await expect(svc.createTask('tts', dir, async () => {})).rejects.toMatchObject({
      code: 'task_conflict',
    });
    release();
    await svc.waitForSettle(first.taskId);
  });

  it('different kinds in same project run concurrently', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const a = await svc.createTask('tts', dir, async () => { await gate; });
    const b = await svc.createTask('export_video', dir, async () => 'ok');
    expect(b.taskId).toBeTruthy();
    release();
    await svc.waitForSettle(a.taskId);
    await svc.waitForSettle(b.taskId);
  });

  it('cancelTask aborts via signal for cancelable kinds', async () => {
    const { taskId } = await svc.createTask('tts', dir, async (h) =>
      new Promise((_resolve, reject) => {
        h.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
    );
    await svc.cancelTask(taskId);
    await svc.waitForSettle(taskId);
    expect(svc.getTask(taskId)!.status).toBe('canceled');
  });

  it('cancelTask throws unknown_task for missing taskId', async () => {
    await expect(svc.cancelTask('nope')).rejects.toMatchObject({ code: 'unknown_task' });
  });

  it('failed run sets status=failed and error', async () => {
    const { taskId } = await svc.createTask('tts', dir, async () => {
      throw new Error('boom');
    });
    await svc.waitForSettle(taskId);
    const t = svc.getTask(taskId)!;
    expect(t.status).toBe('failed');
    expect(t.error?.message).toBe('boom');
  });
});

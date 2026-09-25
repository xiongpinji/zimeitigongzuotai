import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PipelineService } from '../electron/pipeline';
import { buildTaskTools } from '../electron/pipeline/tools/task-tools';

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-tt-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1,
    createdAt: 'x', updatedAt: 'x',
    timeline: null,
    aiAnalysis: { analysisResult: null, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  return dir;
}

describe('task tools', () => {
  let svc: PipelineService;
  let tools: ReturnType<typeof buildTaskTools>;
  let dir: string;
  beforeEach(() => {
    svc = new PipelineService();
    tools = buildTaskTools(svc);
    dir = tmpProject();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('get_task_status returns full task object', async () => {
    const { taskId } = await svc.createTask('tts', dir, async () => 'r');
    await svc.waitForSettle(taskId);
    const t = await tools.getTaskStatus({ taskId });
    expect(t.status).toBe('succeeded');
    expect(t.taskId).toBe(taskId);
  });

  it('get_task_status throws unknown_task for missing id', async () => {
    await expect(tools.getTaskStatus({ taskId: 'nope' })).rejects.toMatchObject({
      code: 'unknown_task',
    });
  });

  it('list_tasks filters by projectPath', async () => {
    const { taskId } = await svc.createTask('tts', dir, async () => 'r');
    await svc.waitForSettle(taskId);
    expect((await tools.listTasks({ projectPath: dir })).length).toBe(1);
    expect((await tools.listTasks({ projectPath: '/nowhere' })).length).toBe(0);
  });

  it('list_tasks without filter returns all', async () => {
    const { taskId } = await svc.createTask('tts', dir, async () => 'r');
    await svc.waitForSettle(taskId);
    expect((await tools.listTasks()).length).toBe(1);
  });

  it('cancel_task aborts a running cancelable task', async () => {
    const { taskId } = await svc.createTask('tts', dir, async (h) =>
      new Promise((_resolve, reject) => {
        h.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('abort'), { name: 'AbortError' })),
        );
      }),
    );
    await tools.cancelTask({ taskId });
    expect(svc.getTask(taskId)!.status).toBe('canceled');
  });

  it('cancel_task throws unknown_task for missing id', async () => {
    await expect(tools.cancelTask({ taskId: 'nope' })).rejects.toMatchObject({
      code: 'unknown_task',
    });
  });
});

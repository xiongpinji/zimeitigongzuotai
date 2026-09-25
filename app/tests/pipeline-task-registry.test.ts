import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskRegistry } from '../electron/pipeline/task-registry';
import type { PipelineTask } from '../electron/pipeline/types';

function makeTask(over: Partial<PipelineTask> = {}): PipelineTask {
  return {
    taskId: 't-' + Math.random().toString(36).slice(2),
    kind: 'tts',
    projectPath: '/tmp/p',
    status: 'pending',
    progress: { phase: 'init', percent: 0 },
    startedAt: Date.now(),
    logs: [],
    ...over,
  };
}

describe('TaskRegistry', () => {
  let reg: TaskRegistry;
  beforeEach(() => {
    reg = new TaskRegistry();
  });

  it('register / get / list', () => {
    const t = makeTask();
    reg.register(t);
    expect(reg.get(t.taskId)).toEqual(t);
    expect(reg.list()).toHaveLength(1);
  });

  it('list filters by projectPath', () => {
    reg.register(makeTask({ projectPath: '/a' }));
    reg.register(makeTask({ projectPath: '/b' }));
    expect(reg.list('/a')).toHaveLength(1);
  });

  it('hasActiveOfKind blocks duplicate concurrent kinds per project', () => {
    reg.register(makeTask({ projectPath: '/a', kind: 'tts', status: 'running' }));
    expect(reg.hasActiveOfKind('/a', 'tts')).toBe(true);
    expect(reg.hasActiveOfKind('/a', 'export_video')).toBe(false);
    expect(reg.hasActiveOfKind('/b', 'tts')).toBe(false);
  });

  it('terminal tasks GC after 24h', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const t = makeTask({ status: 'succeeded', finishedAt: now });
    reg.register(t);
    expect(reg.get(t.taskId)).toBeDefined();
    vi.setSystemTime(now + 24 * 3600_000 + 1);
    reg.gc();
    expect(reg.get(t.taskId)).toBeUndefined();
    vi.useRealTimers();
  });

  it('running tasks are not GCed regardless of age', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const t = makeTask({ status: 'running', startedAt: now });
    reg.register(t);
    vi.setSystemTime(now + 7 * 24 * 3600_000);
    reg.gc();
    expect(reg.get(t.taskId)).toBeDefined();
    vi.useRealTimers();
  });

  it('appendLog truncates to PIPELINE_TASK_LOG_LIMIT', () => {
    const t = makeTask();
    reg.register(t);
    for (let i = 0; i < 250; i++) reg.appendLog(t.taskId, `line-${i}`);
    const loaded = reg.get(t.taskId)!;
    expect(loaded.logs.length).toBe(200);
    expect(loaded.logs[0]).toBe('line-50');
    expect(loaded.logs[199]).toBe('line-249');
  });
});

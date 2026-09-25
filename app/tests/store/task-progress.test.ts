import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTaskProgressStore } from '../../src/store/task-progress';
import type { TaskProgressItem } from '../../src/store/task-progress';

function makeTask(overrides: Partial<TaskProgressItem> = {}): Omit<TaskProgressItem, 'startedAt' | 'status'> {
  return {
    id: `test-${Date.now()}`,
    category: 'ai-write',
    label: 'Test task',
    mode: 'determinate',
    progress: 0,
    phase: null,
    level: 2,
    canCancel: false,
    ...overrides,
  };
}

describe('task-progress store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const { tasks } = useTaskProgressStore.getState();
    tasks.forEach((_, id) => useTaskProgressStore.getState().removeTask(id));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startTask adds a task with active status and startedAt', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'task-1' }));
    const task = useTaskProgressStore.getState().tasks.get('task-1');
    expect(task).toBeDefined();
    expect(task!.status).toBe('active');
    expect(task!.startedAt).toBeGreaterThan(0);
  });

  it('updateTask patches progress and phase', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'task-2' }));
    store.updateTask('task-2', { progress: 50, phase: 'streaming' });
    const task = useTaskProgressStore.getState().tasks.get('task-2');
    expect(task!.progress).toBe(50);
    expect(task!.phase).toBe('streaming');
  });

  it('updateTask can switch category for multi-phase workflows', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'task-2b', category: 'tts' }));
    store.updateTask('task-2b', { category: 'cover', label: '封面图生成' });
    const task = useTaskProgressStore.getState().tasks.get('task-2b');
    expect(task!.category).toBe('cover');
    expect(task!.label).toBe('封面图生成');
  });

  it('completeTask sets completed status and auto-removes after 5s', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'task-3' }));
    store.completeTask('task-3');
    expect(useTaskProgressStore.getState().tasks.get('task-3')!.status).toBe('completed');
    vi.advanceTimersByTime(5000);
    expect(useTaskProgressStore.getState().tasks.has('task-3')).toBe(false);
  });

  it('completeTask stores completionAction', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'task-4' }));
    const handler = vi.fn();
    store.completeTask('task-4', { label: 'Open', handler });
    const task = useTaskProgressStore.getState().tasks.get('task-4');
    expect(task!.completionAction?.label).toBe('Open');
  });

  it('failTask sets error status and auto-removes after 10s', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'task-5' }));
    store.failTask('task-5', 'timeout');
    const task = useTaskProgressStore.getState().tasks.get('task-5');
    expect(task!.status).toBe('error');
    expect(task!.error).toBe('timeout');
    vi.advanceTimersByTime(10000);
    expect(useTaskProgressStore.getState().tasks.has('task-5')).toBe(false);
  });

  it('removeTask deletes the task', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'task-6' }));
    store.removeTask('task-6');
    expect(useTaskProgressStore.getState().tasks.has('task-6')).toBe(false);
  });

  it('activeCount reflects active tasks only', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'a1' }));
    store.startTask(makeTask({ id: 'a2' }));
    store.completeTask('a1');
    expect(useTaskProgressStore.getState().activeCount).toBe(1);
  });

  it('primaryTask returns most recently started active task', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'p1', label: 'First' }));
    store.startTask(makeTask({ id: 'p2', label: 'Second' }));
    expect(useTaskProgressStore.getState().primaryTask?.id).toBe('p2');
  });

  it('primaryTask falls back to most recent completed when no active', () => {
    const store = useTaskProgressStore.getState();
    store.startTask(makeTask({ id: 'f1', label: 'Done' }));
    store.completeTask('f1');
    expect(useTaskProgressStore.getState().primaryTask?.id).toBe('f1');
  });

  it('panelOpen toggles', () => {
    const store = useTaskProgressStore.getState();
    expect(store.panelOpen).toBe(false);
    store.setPanelOpen(true);
    expect(useTaskProgressStore.getState().panelOpen).toBe(true);
  });
});

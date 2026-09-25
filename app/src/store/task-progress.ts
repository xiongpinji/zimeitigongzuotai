import { create } from 'zustand';

export type ProgressMode = 'determinate' | 'indeterminate' | 'streaming';

export type TaskCategory =
  | 'ai-write'
  | 'ai-review'
  | 'ai-analyze'
  | 'import'
  | 'export'
  | 'tts'
  | 'cover'
  | 'io'
  | 'publish';

export interface TaskCompletionAction {
  label: string;
  handler: () => void;
}

export interface TaskProgressItem {
  id: string;
  category: TaskCategory;
  label: string;
  mode: ProgressMode;
  progress: number;
  phase: string | null;
  level: 0 | 1 | 2;
  canCancel: boolean;
  onCancel?: () => void;
  startedAt: number;
  completedAt?: number;
  status: 'active' | 'completed' | 'error';
  error?: string;
  completionAction?: TaskCompletionAction;
  parentId?: string;
}

type StartTaskInput = Omit<TaskProgressItem, 'startedAt' | 'status'>;
type UpdateTaskPatch = Partial<
  Pick<
    TaskProgressItem,
    'progress' | 'phase' | 'mode' | 'label' | 'category' | 'canCancel' | 'onCancel'
  >
>;

interface TaskProgressStore {
  tasks: Map<string, TaskProgressItem>;
  panelOpen: boolean;
  primaryTask: TaskProgressItem | null;
  activeCount: number;

  setPanelOpen: (open: boolean) => void;
  startTask: (task: StartTaskInput) => void;
  startChildTask: (parentId: string, task: StartTaskInput) => void;
  updateTask: (id: string, patch: UpdateTaskPatch) => void;
  completeTask: (id: string, action?: TaskCompletionAction) => void;
  failTask: (id: string, error: string) => void;
  removeTask: (id: string) => void;
}

function derivePrimaryTask(tasks: Map<string, TaskProgressItem>): TaskProgressItem | null {
  // 遍历时记录 index，Map 按插入顺序迭代，index 越大 = 越新插入
  let best: TaskProgressItem | null = null;
  let bestIndex = -1;
  let index = 0;
  for (const t of tasks.values()) {
    if (t.parentId) { index++; continue; }
    if (t.status === 'active') {
      if (
        !best ||
        best.status !== 'active' ||
        t.startedAt > best.startedAt ||
        (t.startedAt === best.startedAt && index > bestIndex)
      ) {
        best = t;
        bestIndex = index;
      }
    } else if (!best || best.status !== 'active') {
      const tTime = t.completedAt ?? t.startedAt;
      const bestTime = best ? (best.completedAt ?? best.startedAt) : -1;
      if (
        !best ||
        tTime > bestTime ||
        (tTime === bestTime && index > bestIndex)
      ) {
        best = t;
        bestIndex = index;
      }
    }
    index++;
  }
  return best;
}

function deriveActiveCount(tasks: Map<string, TaskProgressItem>): number {
  let count = 0;
  for (const t of tasks.values()) {
    if (t.status === 'active' && !t.parentId) count++;
  }
  return count;
}

const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRemoval(id: string, delayMs: number) {
  clearRemovalTimer(id);
  const timer = setTimeout(() => {
    removalTimers.delete(id);
    useTaskProgressStore.getState().removeTask(id);
  }, delayMs);
  removalTimers.set(id, timer);
}

function clearRemovalTimer(id: string) {
  const existing = removalTimers.get(id);
  if (existing) {
    clearTimeout(existing);
    removalTimers.delete(id);
  }
}

export const useTaskProgressStore = create<TaskProgressStore>((set, get) => ({
  tasks: new Map(),
  panelOpen: false,
  primaryTask: null,
  activeCount: 0,

  setPanelOpen: (open) => set({ panelOpen: open }),

  startTask: (input) => {
    const task: TaskProgressItem = {
      ...input,
      startedAt: Date.now(),
      status: 'active',
    };
    const next = new Map(get().tasks);
    next.set(task.id, task);
    set({
      tasks: next,
      primaryTask: derivePrimaryTask(next),
      activeCount: deriveActiveCount(next),
    });
  },

  startChildTask: (parentId, input) => {
    get().startTask({ ...input, parentId, level: 1 });
  },

  updateTask: (id, patch) => {
    const tasks = get().tasks;
    const existing = tasks.get(id);
    if (!existing) return;
    const updated = { ...existing, ...patch };
    const next = new Map(tasks);
    next.set(id, updated);
    set({
      tasks: next,
      primaryTask: derivePrimaryTask(next),
    });
  },

  completeTask: (id, action) => {
    const tasks = get().tasks;
    const existing = tasks.get(id);
    if (!existing) return;
    const next = new Map(tasks);
    next.set(id, {
      ...existing,
      status: 'completed',
      progress: 100,
      completedAt: Date.now(),
      completionAction: action,
    });
    // 父任务完成：把仍 active 的子任务一并收尾
    if (!existing.parentId) {
      for (const child of next.values()) {
        if (child.parentId === id && child.status === 'active') {
          next.set(child.id, {
            ...child,
            status: 'completed',
            progress: 100,
            completedAt: Date.now(),
          });
          scheduleRemoval(child.id, 5000);
        }
      }
    }
    set({
      tasks: next,
      primaryTask: derivePrimaryTask(next),
      activeCount: deriveActiveCount(next),
    });
    scheduleRemoval(id, 5000);
  },

  failTask: (id, error) => {
    const tasks = get().tasks;
    const existing = tasks.get(id);
    if (!existing) return;
    const next = new Map(tasks);
    next.set(id, { ...existing, status: 'error', error, completedAt: Date.now() });
    if (!existing.parentId) {
      for (const child of next.values()) {
        if (child.parentId === id && child.status === 'active') {
          next.set(child.id, {
            ...child,
            status: 'error',
            error,
            completedAt: Date.now(),
          });
          scheduleRemoval(child.id, 10000);
        }
      }
    }
    set({
      tasks: next,
      primaryTask: derivePrimaryTask(next),
      activeCount: deriveActiveCount(next),
    });
    scheduleRemoval(id, 10000);
  },

  removeTask: (id) => {
    clearRemovalTimer(id);
    const next = new Map(get().tasks);
    next.delete(id);
    for (const child of [...next.values()]) {
      if (child.parentId === id) {
        clearRemovalTimer(child.id);
        next.delete(child.id);
      }
    }
    set({
      tasks: next,
      primaryTask: derivePrimaryTask(next),
      activeCount: deriveActiveCount(next),
    });
  },
}));

# Unified Task Progress Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 6+ scattered progress indicators with one unified bottom status bar progress system.

**Architecture:** A new Zustand store (`task-progress.ts`) holds all active task states. Three new UI sub-components render inside the existing `AppStatusBar`: a 2px progress line, a clickable task summary, and a floating detail panel. Existing operations call `startTask/updateTask/completeTask/failTask` instead of managing their own UI.

**Tech Stack:** React 19, Zustand, TypeScript, CSS Modules

**Spec:** [`docs/superpowers/specs/2026-04-11-unified-task-progress-design.md`](../specs/2026-04-11-unified-task-progress-design.md)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/store/task-progress.ts` | Zustand store: task registry, panel state, derived selectors |
| `src/components/StatusBarProgressLine.tsx` | 2px animated progress line at top of status bar |
| `src/components/StatusBarTaskSummary.tsx` | Clickable task summary text in status bar left area |
| `src/components/TaskProgressPanel.tsx` | Floating detail panel above status bar |
| `src/components/TaskProgressPanel.module.css` | Styles for panel + task rows |

### Modified files

| File | What changes |
|------|-------------|
| `src/components/AppStatusBar.tsx` | Add `position: relative`, render 3 new sub-components |
| `src/components/AppStatusBar.module.css` | Add `position: relative` to `.statusBar`, add progress line keyframes |
| `src/pages/ScriptWorkbench.tsx` | Wire AI generate/review/rewrite + import to task-progress store |
| `src/pages/Editor.tsx` | Wire video export to task-progress store, remove ExportProgress |
| `src/hooks/useAIVideoWorkflow.ts` | Wire TTS/analyze/cover workflow steps to task-progress store |

### Deleted files (Phase 4)

| File | Reason |
|------|--------|
| `src/components/agent/AgentProgressBar.tsx` | Replaced by unified system (currently not rendered anywhere) |
| `src/components/agent/AgentProgressBar.module.css` | Paired CSS |
| `src/components/ExportProgress.tsx` | Replaced by unified system |
| `src/components/ExportProgress.module.css` | Paired CSS |

---

## Task 1: Create task-progress Zustand store

**Files:**
- Create: `src/store/task-progress.ts`
- Test: `tests/store/task-progress.test.ts`

- [ ] **Step 1: Write the store test file**

```typescript
// tests/store/task-progress.test.ts
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
    // 清空 store
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/task-progress.test.ts`
Expected: FAIL — module `../../src/store/task-progress` not found

- [ ] **Step 3: Implement the store**

```typescript
// src/store/task-progress.ts
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
  | 'io';

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
}

type StartTaskInput = Omit<TaskProgressItem, 'startedAt' | 'status'>;
type UpdateTaskPatch = Partial<Pick<TaskProgressItem, 'progress' | 'phase' | 'mode' | 'label'>>;

interface TaskProgressStore {
  tasks: Map<string, TaskProgressItem>;
  panelOpen: boolean;
  primaryTask: TaskProgressItem | null;
  activeCount: number;

  setPanelOpen: (open: boolean) => void;
  startTask: (task: StartTaskInput) => void;
  updateTask: (id: string, patch: UpdateTaskPatch) => void;
  completeTask: (id: string, action?: TaskCompletionAction) => void;
  failTask: (id: string, error: string) => void;
  removeTask: (id: string) => void;
}

function derivePrimaryTask(tasks: Map<string, TaskProgressItem>): TaskProgressItem | null {
  let best: TaskProgressItem | null = null;
  for (const t of tasks.values()) {
    if (t.status === 'active') {
      if (!best || best.status !== 'active' || t.startedAt > best.startedAt) {
        best = t;
      }
    } else if (!best || best.status !== 'active') {
      if (!best || (t.completedAt ?? t.startedAt) > (best.completedAt ?? best.startedAt)) {
        best = t;
      }
    }
  }
  return best;
}

function deriveActiveCount(tasks: Map<string, TaskProgressItem>): number {
  let count = 0;
  for (const t of tasks.values()) {
    if (t.status === 'active') count++;
  }
  return count;
}

// 延迟移除计时器
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
    const updated: TaskProgressItem = {
      ...existing,
      status: 'completed',
      progress: 100,
      completedAt: Date.now(),
      completionAction: action,
    };
    const next = new Map(tasks);
    next.set(id, updated);
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
    const updated: TaskProgressItem = {
      ...existing,
      status: 'error',
      error,
      completedAt: Date.now(),
    };
    const next = new Map(tasks);
    next.set(id, updated);
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
    set({
      tasks: next,
      primaryTask: derivePrimaryTask(next),
      activeCount: deriveActiveCount(next),
    });
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/store/task-progress.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/task-progress.ts tests/store/task-progress.test.ts
git commit -m "feat(store): 统一任务进度 store（task-progress）"
```

---

## Task 2: StatusBarProgressLine component

**Files:**
- Create: `src/components/StatusBarProgressLine.tsx`
- Modify: `src/components/AppStatusBar.module.css`

- [ ] **Step 1: Add CSS keyframes and progress line styles to AppStatusBar.module.css**

Append to end of `src/components/AppStatusBar.module.css`:

```css
/* 统一进度线 */
.progressLine {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 1;
  pointer-events: none;
}

.progressFillLine {
  height: 100%;
  transition: width 0.3s ease;
}

.progressFillLine[data-mode="indeterminate"],
.progressFillLine[data-mode="streaming"] {
  width: 35% !important;
  animation: indeterminateSweep 1.2s ease-in-out infinite;
}

@keyframes indeterminateSweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(388%); }
}
```

Also add `position: relative; overflow: hidden;` to `.statusBar`:

In `.statusBar` (line 1-14), add after `user-select: none;`:

```css
  position: relative;
  overflow: hidden;
```

- [ ] **Step 2: Create the StatusBarProgressLine component**

```typescript
// src/components/StatusBarProgressLine.tsx
import { useTaskProgressStore } from '../store/task-progress';
import type { TaskCategory } from '../store/task-progress';
import styles from './AppStatusBar.module.css';

const CATEGORY_COLORS: Record<TaskCategory, string> = {
  'ai-write': '#a78bfa',
  'ai-review': '#34d399',
  'ai-analyze': '#60a5fa',
  'import': '#fbbf24',
  'export': '#0A84FF',
  'tts': '#f472b6',
  'cover': '#c084fc',
  'io': '#9ca3af',
};

export function StatusBarProgressLine() {
  const primaryTask = useTaskProgressStore((s) => s.primaryTask);

  if (!primaryTask || primaryTask.status !== 'active') return null;

  const color = CATEGORY_COLORS[primaryTask.category] ?? '#9ca3af';
  const isDeterminate = primaryTask.mode === 'determinate';

  return (
    <div className={styles.progressLine}>
      <div
        className={styles.progressFillLine}
        data-mode={primaryTask.mode}
        style={{
          width: isDeterminate ? `${primaryTask.progress}%` : undefined,
          background: primaryTask.mode === 'streaming'
            ? `linear-gradient(90deg, transparent, ${color}, transparent)`
            : color,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/StatusBarProgressLine.tsx src/components/AppStatusBar.module.css
git commit -m "feat(ui): StatusBarProgressLine 2px 进度线组件"
```

---

## Task 3: StatusBarTaskSummary component

**Files:**
- Create: `src/components/StatusBarTaskSummary.tsx`

- [ ] **Step 1: Create the StatusBarTaskSummary component**

```typescript
// src/components/StatusBarTaskSummary.tsx
import { useTaskProgressStore } from '../store/task-progress';
import type { TaskCategory } from '../store/task-progress';

const CATEGORY_ICONS: Record<TaskCategory, string> = {
  'ai-write': '🤖',
  'ai-review': '🔍',
  'ai-analyze': '🧠',
  'import': '📥',
  'export': '🎬',
  'tts': '🎙️',
  'cover': '🖼️',
  'io': '📁',
};

export function StatusBarTaskSummary() {
  const primaryTask = useTaskProgressStore((s) => s.primaryTask);
  const activeCount = useTaskProgressStore((s) => s.activeCount);
  const panelOpen = useTaskProgressStore((s) => s.panelOpen);
  const setPanelOpen = useTaskProgressStore((s) => s.setPanelOpen);

  if (!primaryTask) return null;

  const icon = CATEGORY_ICONS[primaryTask.category] ?? '📁';

  let text: string;
  if (primaryTask.status === 'completed') {
    text = `✅ ${primaryTask.label} 完成`;
  } else if (primaryTask.status === 'error') {
    text = `❌ ${primaryTask.label} 失败`;
  } else if (activeCount > 1) {
    const pct = primaryTask.mode === 'determinate' ? ` ${primaryTask.progress}%` : '';
    text = `${icon} ${primaryTask.label}${pct} · +${activeCount - 1}`;
  } else {
    const pct = primaryTask.mode === 'determinate' ? ` ${primaryTask.progress}%` : '';
    text = `${icon} ${primaryTask.label}${pct}`;
  }

  return (
    <span
      onClick={() => setPanelOpen(!panelOpen)}
      style={{ cursor: 'pointer', transition: 'color 0.15s' }}
      title="点击查看任务详情"
    >
      {text}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/StatusBarTaskSummary.tsx
git commit -m "feat(ui): StatusBarTaskSummary 状态栏任务摘要组件"
```

---

## Task 4: TaskProgressPanel floating detail panel

**Files:**
- Create: `src/components/TaskProgressPanel.tsx`
- Create: `src/components/TaskProgressPanel.module.css`

- [ ] **Step 1: Create the panel CSS**

```css
/* src/components/TaskProgressPanel.module.css */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 99;
}

.panel {
  position: absolute;
  bottom: 30px;
  left: 0;
  right: 0;
  background: var(--color-panel-elevated, #2C2C2E);
  border: 1px solid var(--color-separator, #38383A);
  border-radius: 8px 8px 0 0;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
  padding: 6px 0;
  max-height: 240px;
  overflow-y: auto;
  z-index: 100;
}

.taskRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  font-size: 11px;
}

.taskRow:hover {
  background: rgba(255, 255, 255, 0.04);
}

.taskIcon {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-size: 12px;
}

.taskLabel {
  font-weight: 600;
  color: var(--color-text-primary, #FFFFFF);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.taskPhase {
  color: var(--color-text-tertiary, #EBEBF550);
  font-size: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.taskBar {
  width: 80px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  flex-shrink: 0;
}

.taskBarFill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.taskPct {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary, #EBEBF550);
  width: 28px;
  text-align: right;
  flex-shrink: 0;
}

.cancelBtn {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--color-danger, #FF453A);
  font-size: 10px;
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 3px;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.cancelBtn:hover {
  opacity: 1;
  background: rgba(255, 69, 58, 0.1);
}

.actionBtn {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--color-separator, #38383A);
  color: var(--color-text-secondary, #EBEBF599);
  font-size: 10px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}

.actionBtn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary, #FFFFFF);
}

.errorText {
  font-size: 10px;
  color: var(--color-danger, #FF453A);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
```

- [ ] **Step 2: Create the TaskProgressPanel component**

```typescript
// src/components/TaskProgressPanel.tsx
import { useTaskProgressStore } from '../store/task-progress';
import type { TaskCategory, TaskProgressItem } from '../store/task-progress';
import styles from './TaskProgressPanel.module.css';

const CATEGORY_ICONS: Record<TaskCategory, string> = {
  'ai-write': '🤖',
  'ai-review': '🔍',
  'ai-analyze': '🧠',
  'import': '📥',
  'export': '🎬',
  'tts': '🎙️',
  'cover': '🖼️',
  'io': '📁',
};

const CATEGORY_COLORS: Record<TaskCategory, string> = {
  'ai-write': '#a78bfa',
  'ai-review': '#34d399',
  'ai-analyze': '#60a5fa',
  'import': '#fbbf24',
  'export': '#0A84FF',
  'tts': '#f472b6',
  'cover': '#c084fc',
  'io': '#9ca3af',
};

function TaskRow({ task }: { task: TaskProgressItem }) {
  const removeTask = useTaskProgressStore((s) => s.removeTask);
  const icon = CATEGORY_ICONS[task.category] ?? '📁';
  const color = CATEGORY_COLORS[task.category] ?? '#9ca3af';

  const barColor =
    task.status === 'completed'
      ? 'var(--color-success, #32D74B)'
      : task.status === 'error'
        ? 'var(--color-danger, #FF453A)'
        : color;

  const barWidth = task.status === 'completed' ? 100 : task.progress;

  return (
    <div className={styles.taskRow}>
      <span className={styles.taskIcon}>{
        task.status === 'completed' ? '✅' : task.status === 'error' ? '❌' : icon
      }</span>
      <span className={styles.taskLabel}>{task.label}{task.status === 'completed' ? ' 完成' : ''}</span>

      {task.status === 'error' && task.error && (
        <span className={styles.errorText} title={task.error}>{task.error}</span>
      )}
      {task.status === 'active' && task.phase && (
        <span className={styles.taskPhase}>{task.phase}</span>
      )}

      <div className={styles.taskBar}>
        <div
          className={styles.taskBarFill}
          style={{ width: `${barWidth}%`, background: barColor }}
        />
      </div>

      {task.status === 'active' && task.mode === 'determinate' && (
        <span className={styles.taskPct}>{task.progress}%</span>
      )}
      {task.status !== 'active' && <span className={styles.taskPct} />}

      {task.status === 'active' && task.canCancel && task.onCancel && (
        <button className={styles.cancelBtn} onClick={task.onCancel} title="取消">⏹</button>
      )}
      {task.status === 'completed' && task.completionAction && (
        <button className={styles.actionBtn} onClick={task.completionAction.handler}>
          {task.completionAction.label}
        </button>
      )}
      {task.status === 'error' && (
        <button className={styles.actionBtn} onClick={() => removeTask(task.id)}>关闭</button>
      )}
    </div>
  );
}

export function TaskProgressPanel() {
  const panelOpen = useTaskProgressStore((s) => s.panelOpen);
  const setPanelOpen = useTaskProgressStore((s) => s.setPanelOpen);
  const tasks = useTaskProgressStore((s) => s.tasks);

  if (!panelOpen || tasks.size === 0) return null;

  // 按 startedAt 倒序排列
  const sorted = Array.from(tasks.values()).sort((a, b) => b.startedAt - a.startedAt);

  return (
    <>
      <div className={styles.overlay} onClick={() => setPanelOpen(false)} />
      <div className={styles.panel}>
        {sorted.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/TaskProgressPanel.tsx src/components/TaskProgressPanel.module.css
git commit -m "feat(ui): TaskProgressPanel 浮动进度详情面板"
```

---

## Task 5: Integrate into AppStatusBar

**Files:**
- Modify: `src/components/AppStatusBar.tsx:184-196`
- Modify: `src/components/AppStatusBar.module.css:1-14`

- [ ] **Step 1: Add `position: relative` and `overflow: hidden` to `.statusBar` CSS**

In `src/components/AppStatusBar.module.css`, edit `.statusBar`:

```css
.statusBar {
  height: 28px;
  flex-shrink: 0;
  border-top: 1px solid var(--color-border-subtle, #38383A);
  background: var(--color-panel-bg, #1C1C1E);
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-tertiary, #EBEBF550);
  user-select: none;
  -webkit-app-region: no-drag;
  position: relative;
  overflow: hidden;
}
```

- [ ] **Step 2: Render new components in AppStatusBar**

In `src/components/AppStatusBar.tsx`, add imports and render:

Add imports at top:
```typescript
import { StatusBarProgressLine } from './StatusBarProgressLine';
import { StatusBarTaskSummary } from './StatusBarTaskSummary';
import { TaskProgressPanel } from './TaskProgressPanel';
```

Replace the `AppStatusBar` function body (lines 184-196):
```typescript
export function AppStatusBar() {
  return (
    <div className={styles.statusBar}>
      <StatusBarProgressLine />
      <TaskProgressPanel />
      <div className={styles.left}>
        <WorkbenchStatsIndicator />
        <StatusBarTaskSummary />
      </div>
      <div className={styles.right}>
        <ContextWindowIndicator />
        <ConnectionIndicator />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify dev server renders correctly**

Run: `npm run dev`
Expected: AppStatusBar renders at 28px as before; no visible progress line (no active tasks); no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppStatusBar.tsx src/components/AppStatusBar.module.css
git commit -m "feat(ui): 集成统一进度组件到 AppStatusBar"
```

---

## Task 6: Wire AI generate/review/rewrite in ScriptWorkbench

**Files:**
- Modify: `src/pages/ScriptWorkbench.tsx:766-772` (generate start)
- Modify: `src/pages/ScriptWorkbench.tsx:860-868` (generate complete)
- Modify: `src/pages/ScriptWorkbench.tsx:984-990` (review start)
- Modify: `src/pages/ScriptWorkbench.tsx:1046-1060` (review complete, approximate)

- [ ] **Step 1: Import task-progress store in ScriptWorkbench**

Add at the top of `src/pages/ScriptWorkbench.tsx`:
```typescript
import { useTaskProgressStore } from '../store/task-progress';
```

- [ ] **Step 2: Wire AI generate — startTask at operation start**

In `runInternalGenerateScript`, after `state.setAgentOperation(...)` (around line 766-772), add:

```typescript
        useTaskProgressStore.getState().startTask({
          id: streamId,
          category: 'ai-write',
          label: operationType === 'rewrite' ? 'AI 重写稿件' : 'AI 生成稿件',
          mode: 'streaming',
          progress: 0,
          phase: '准备中',
          level: 2,
          canCancel,
          onCancel: canInterrupt ? () => window.agentAPI?.cancelTurn() : undefined,
        });
```

- [ ] **Step 3: Wire AI generate — update phase on streaming start**

Find where `state.setActiveStream({ ...phase: 'streaming' })` is called during generate (around line 810-820 area, where the LLM stream starts). After that line, add:

```typescript
          useTaskProgressStore.getState().updateTask(streamId, { phase: '写入中' });
```

- [ ] **Step 4: Wire AI generate — completeTask on success**

In the generate completion block (around line 860-868, after `finalState.stopAgentOperation()`), add:

```typescript
        useTaskProgressStore.getState().completeTask(streamId);
```

- [ ] **Step 5: Wire AI generate — failTask on error**

In the generate catch block (find `catch (err)` after runInternalGenerateScript try block), add:

```typescript
        useTaskProgressStore.getState().failTask(streamId, String(err));
```

- [ ] **Step 6: Wire AI review — startTask**

In `runInternalReviewScript`, after `state.setAgentOperation(...)` (line 984-990), add:

```typescript
      const reviewTaskId = `ai-review-${Date.now()}`;
      useTaskProgressStore.getState().startTask({
        id: reviewTaskId,
        category: 'ai-review',
        label: 'AI 审稿',
        mode: 'determinate',
        progress: 0,
        phase: '等待响应',
        level: 2,
        canCancel: true,
        onCancel: () => window.agentAPI?.cancelTurn(),
      });
```

- [ ] **Step 7: Wire AI review — update phase on annotating**

In the ReviewCursorAnimator `onPhaseChange` callback (around line 1016-1023), update the task:

After `s.setActiveStream({ phase: 'finalizing' });` (inside `if (phase === 'annotating')`), add:

```typescript
            useTaskProgressStore.getState().updateTask(reviewTaskId, { phase: '标注中', progress: 70 });
```

- [ ] **Step 8: Wire AI review — completeTask on success**

In the review success path (after the annotation animation completes and `stopAgentOperation()` is called), add:

```typescript
      useTaskProgressStore.getState().completeTask(reviewTaskId);
```

- [ ] **Step 9: Wire AI review — failTask on error**

In the review catch block, add:

```typescript
      useTaskProgressStore.getState().failTask(reviewTaskId, String(err));
```

- [ ] **Step 10: Verify in dev server**

Run: `npm run dev`
- Open script workbench
- Trigger AI generate → should see purple progress line at bottom + "🤖 AI 生成稿件" text
- Editor typewriter animation should still work as before
- On completion, status shows "✅ ... 完成" for 3s then disappears

- [ ] **Step 11: Commit**

```bash
git add src/pages/ScriptWorkbench.tsx
git commit -m "feat(progress): 写稿工作台 AI 生成/审稿接入统一进度系统"
```

---

## Task 7: Wire Douyin video import

**Files:**
- Modify: `src/pages/ScriptWorkbench.tsx:599-628` (waitForVideoImport polling)

- [ ] **Step 1: Add task-progress calls to import polling**

In `waitForVideoImport` function (around line 599), at the start of the function before the polling loop begins, add:

```typescript
    const importTaskId = `import-douyin-${Date.now()}`;
    useTaskProgressStore.getState().startTask({
      id: importTaskId,
      category: 'import',
      label: '抖音视频导入',
      mode: 'determinate',
      progress: 0,
      phase: '下载中',
      level: 2,
      canCancel: false,
    });
```

- [ ] **Step 2: Update progress inside the polling loop**

Inside the polling loop where status updates are received, add after updating local state:

```typescript
      const phaseLabels: Record<string, string> = {
        downloading: '下载中',
        extracting_audio: '提取音频',
        transcribing: '转录字幕',
        syncing: '同步到项目',
      };
      useTaskProgressStore.getState().updateTask(importTaskId, {
        progress: status.progress ?? 0,
        phase: phaseLabels[status.step] ?? status.step,
      });
```

- [ ] **Step 3: Complete/fail on finish**

At the success path (when status is `'done'`):
```typescript
      useTaskProgressStore.getState().completeTask(importTaskId);
```

At the error path:
```typescript
      useTaskProgressStore.getState().failTask(importTaskId, status.error ?? '导入失败');
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/ScriptWorkbench.tsx
git commit -m "feat(progress): 抖音视频导入接入统一进度系统"
```

---

## Task 8: Wire video export in Editor

**Files:**
- Modify: `src/pages/Editor.tsx:212-218` (render progress listener)
- Modify: `src/pages/Editor.tsx:493-514` (handleConfirmExport)
- Modify: `src/pages/Editor.tsx:714-724` (remove ExportProgress JSX)

- [ ] **Step 1: Import task-progress store in Editor**

Add at top of `src/pages/Editor.tsx`:
```typescript
import { useTaskProgressStore } from '../store/task-progress';
```

- [ ] **Step 2: Wire handleConfirmExport to task-progress**

In `handleConfirmExport` (line 493-514), replace the export logic:

```typescript
  const handleConfirmExport = useCallback(async ({ outputPath: savePath, exportConfig }: {
    outputPath: string;
    exportConfig: ExportConfig;
  }) => {
    setIsExportSettingsOpen(false);
    setOutputPath(savePath);
    setIsExporting(true);
    setExportProgress(0);
    setExportError(null);

    const exportTaskId = `export-video-${Date.now()}`;
    useTaskProgressStore.getState().startTask({
      id: exportTaskId,
      category: 'export',
      label: '视频导出',
      mode: 'determinate',
      progress: 0,
      phase: 'bundling',
      level: 2,
      canCancel: false,
    });

    try {
      await window.electronAPI.renderVideo({
        timeline: JSON.stringify(timeline),
        outputPath: savePath,
        exportConfig,
      });
      setExportProgress(1);
      useTaskProgressStore.getState().completeTask(exportTaskId, {
        label: '在 Finder 中显示',
        handler: () => window.electronAPI.showItemInFolder(savePath),
      });
    } catch (error) {
      console.error('导出失败:', error);
      const errMsg = '导出失败，请查看控制台日志后重试。';
      setExportError(errMsg);
      useTaskProgressStore.getState().failTask(exportTaskId, errMsg);
    }
  }, [timeline]);
```

- [ ] **Step 3: Wire render-progress listener to task-progress**

In the `onRenderProgress` effect (line 212-218), add task update:

```typescript
  useEffect(() => {
    const cleanup = window.electronAPI.onRenderProgress((progress) => {
      setExportProgress(progress);
      // 更新统一进度系统：找到活跃的 export 任务
      const tasks = useTaskProgressStore.getState().tasks;
      for (const [id, task] of tasks) {
        if (task.category === 'export' && task.status === 'active') {
          useTaskProgressStore.getState().updateTask(id, {
            progress: Math.round(progress * 100),
            phase: progress < 0.1 ? 'bundling' : 'rendering',
          });
          break;
        }
      }
    });
    return cleanup;
  }, []);
```

- [ ] **Step 4: Remove ExportProgress JSX rendering**

Delete the `<ExportProgress ... />` block (lines 714-724). The ExportProgress component is no longer needed since the unified status bar handles it.

Also remove the import at line 7:
```typescript
// DELETE: import { ExportProgress } from '../components/ExportProgress';
```

- [ ] **Step 5: Verify in dev server**

Run: `npm run dev`
- Open editor, trigger export → system blue progress line at bottom
- Click status bar summary → floating panel shows export progress
- On completion → panel shows "✅ 视频导出完成" with "在 Finder 中显示" button
- Verify user can continue editing during export (not modal-blocked)

- [ ] **Step 6: Commit**

```bash
git add src/pages/Editor.tsx
git commit -m "feat(progress): 视频导出接入统一进度系统，移除 ExportProgress 模态"
```

---

## Task 9: Wire AI video workflow (TTS / analyze / cover)

**Files:**
- Modify: `src/hooks/useAIVideoWorkflow.ts:152-162` (TTS start)
- Modify: `src/hooks/useAIVideoWorkflow.ts:232-256` (analyze + cover)
- Modify: `src/hooks/useAIVideoWorkflow.ts:354-360` (done)

- [ ] **Step 1: Import task-progress store in useAIVideoWorkflow**

Add at top of `src/hooks/useAIVideoWorkflow.ts`:
```typescript
import { useTaskProgressStore } from '../store/task-progress';
```

- [ ] **Step 2: Start a workflow task at TTS phase**

Right after `setWorkflow({ step: 'tts_generating', ... })` (around line 153-159), add:

```typescript
        const workflowTaskId = `ai-workflow-${Date.now()}`;
        useTaskProgressStore.getState().startTask({
          id: workflowTaskId,
          category: 'tts',
          label: 'TTS 语音合成',
          mode: 'determinate',
          progress: 0,
          phase: '生成语音',
          level: 2,
          canCancel: true,
          onCancel: () => cancelRef.current?.(),
        });
```

- [ ] **Step 3: Update task on TTS progress**

In the `onTTSProgress` callback (line 161-163), add:
```typescript
          useTaskProgressStore.getState().updateTask(workflowTaskId, { progress: pct });
```

- [ ] **Step 4: Switch task on analyze phase**

After `setWorkflow({ step: 'ai_analyzing', ... })` (around line 233-239), add:
```typescript
        useTaskProgressStore.getState().updateTask(workflowTaskId, {
          label: 'AI 内容分析',
          phase: '分析中',
          progress: 12,
        });
        // 切换 category（需先 complete 旧任务再 start 新的，或直接 update label）
```

- [ ] **Step 5: Switch task on cover phase**

After `setWorkflow({ step: 'cover_generating', ... })` (around line 250-256), add:
```typescript
        useTaskProgressStore.getState().updateTask(workflowTaskId, {
          label: '封面图生成',
          phase: '生成中',
          progress: 36,
        });
```

- [ ] **Step 6: Complete task on workflow done**

After `setWorkflow({ step: 'done', ... })` (around line 354-360), add:
```typescript
        useTaskProgressStore.getState().completeTask(workflowTaskId);
```

- [ ] **Step 7: Fail task on workflow error**

In each catch block where `setWorkflow({ step: 'error', ... })` is called, add:
```typescript
        useTaskProgressStore.getState().failTask(workflowTaskId, errorMessage);
```

Note: `workflowTaskId` needs to be accessible in the error paths. Hoist the variable declaration to the top of the `start` callback function scope.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useAIVideoWorkflow.ts
git commit -m "feat(progress): AI 视频工作流接入统一进度系统"
```

---

## Task 10: Cleanup deprecated components

**Files:**
- Delete: `src/components/agent/AgentProgressBar.tsx`
- Delete: `src/components/agent/AgentProgressBar.module.css`
- Delete: `src/components/ExportProgress.tsx`
- Delete: `src/components/ExportProgress.module.css`

- [ ] **Step 1: Verify no remaining imports of AgentProgressBar**

Run: `grep -r "AgentProgressBar" src/`
Expected: Only the files themselves (no imports from other files, since exploration confirmed it's not rendered anywhere).

- [ ] **Step 2: Verify no remaining imports of ExportProgress**

Run: `grep -r "ExportProgress" src/`
Expected: Only `src/components/ExportProgress.tsx` and its CSS (the import in Editor.tsx was removed in Task 8).

- [ ] **Step 3: Delete deprecated files**

```bash
rm src/components/agent/AgentProgressBar.tsx
rm src/components/agent/AgentProgressBar.module.css
rm src/components/ExportProgress.tsx
rm src/components/ExportProgress.module.css
```

- [ ] **Step 4: Run type check to verify no breakage**

Run: `npx tsc --noEmit`
Expected: No errors related to removed components.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass. No tests reference the deleted components.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: 移除已废弃的 AgentProgressBar 和 ExportProgress 组件"
```

---

## Task 11: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass including new `task-progress.test.ts`.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run dev server and test all paths**

Run: `npm run dev`

Manual verification checklist:
1. No active tasks → status bar is clean 28px, no progress line visible
2. Trigger AI script generation → purple 2px line appears, summary shows "🤖 AI 生成稿件"
3. Editor typewriter animation still works during generation
4. Click summary → floating panel opens with task detail
5. Click outside panel → panel closes
6. Generation completes → "✅ ... 完成" shows 3 seconds then disappears
7. Trigger AI review → green progress line, "🔍 AI 审稿"
8. Review cursor/breathing animation still works
9. Trigger video export → blue progress line + percentage
10. Export non-blocking (can still interact with editor)
11. Export completes → panel shows "在 Finder 中显示" button
12. Start Douyin import → amber progress line with phase labels

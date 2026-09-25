# AI 卡片生成嵌套进度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 卡片生成在底部统一进度系统里以"父任务 + 每段卡片子任务"的嵌套树呈现，用户能直观看到每个阶段与每张卡片（含生成内容/生成图片子状态）的进度。

**Architecture:** 给 `task-progress` store 增加通用 `parentId` 父子模型（顶层任务驱动底部条，子任务只在展开面板嵌套显示）；`ai-analysis.ts` 把原本只走 telemetry 的卡片生命周期事件通过 IPC 进度通道发出；共享的 `analyze-progress-bridge` 把卡片事件映射成子任务；`AIPanel` 与一键流水线两个入口复用同一映射。

**Tech Stack:** TypeScript, Zustand, React 19, Electron IPC, Vitest。

**Spec:** `docs/superpowers/specs/2026-06-04-card-generation-nested-progress-design.md`

---

## 共享契约（所有 Task 必须一致）

为避免类型/命名漂移，先固定跨 Task 共享的标识与类型：

**卡片进度事件类型**（Task 2 在 `src/lib/ai-analysis.ts` 定义并 export，Task 3/5 复用）：

```ts
export type AnalyzeCardSubStage =
  | 'start'              // 生成内容中（motion 卡的 TSX 生成也算此态）
  | 'generating-image'  // 图片卡：内容已出，调图像 provider
  | 'done'
  | 'failed';

export interface AnalyzeCardProgress {
  segmentIndex: number;
  segmentId: string;
  title?: string;
  visualType?: string;
  status: AnalyzeCardSubStage;
  error?: string;
}
```

> 注：spec 5.1 提到的 `motion-fix` 子状态依赖"分析期是否编译/autofix TSX"，本计划**不实现**（motion 校验在 `generateCardForSegment` 内部，提取需深度穿线，超出本次范围）。motion 卡只发 `start → done/failed`。

**子任务 id 规则**（Task 1/3/5 一致）：`${parentId}::card::${segmentIndex}`

**子任务字段约定**（Task 3/5 创建子任务时）：`category: 'ai-analyze'`、`level: 1`、`parentId`、`mode: 'indeterminate'`、`canCancel: false`、`label: 卡片#<index+1>[ title]`。

**子状态 → phase 文案**：`start → '生成内容…'`、`generating-image → '生成图片…'`。

---

## 执行波次（并行）

- **Wave 1（并行，文件互不相交）：** Task 1（store）、Task 2（后端+IPC）、Task 3（bridge）。
- **Wave 2：** Task 4（UI，依赖 Task 1 的 `parentId` 字段）。
- **Wave 3：** Task 5（接线，依赖 1+2+3）、Task 6（集成验证）。

---

## Task 1: Store 父子任务模型（Stream A）

**Files:**
- Modify: `src/store/task-progress.ts`
- Test: `tests/task-progress-nesting.test.ts` (Create)

- [ ] **Step 1: 写失败测试**

Create `tests/task-progress-nesting.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskProgressStore } from '../src/store/task-progress';

function reset() {
  useTaskProgressStore.setState({
    tasks: new Map(),
    panelOpen: false,
    primaryTask: null,
    activeCount: 0,
  });
}

const base = {
  category: 'ai-analyze' as const,
  label: 'x',
  mode: 'determinate' as const,
  progress: 0,
  phase: null,
  level: 0 as const,
  canCancel: false,
};

describe('task-progress 父子模型', () => {
  beforeEach(reset);

  it('子任务不参与 primaryTask 选取', () => {
    const s = useTaskProgressStore.getState();
    s.startTask({ ...base, id: 'parent' });
    s.startChildTask('parent', { ...base, id: 'parent::card::0', label: '卡片#1' });
    expect(useTaskProgressStore.getState().primaryTask?.id).toBe('parent');
  });

  it('activeCount 只数顶层活动任务', () => {
    const s = useTaskProgressStore.getState();
    s.startTask({ ...base, id: 'parent' });
    s.startChildTask('parent', { ...base, id: 'parent::card::0' });
    s.startChildTask('parent', { ...base, id: 'parent::card::1' });
    expect(useTaskProgressStore.getState().activeCount).toBe(1);
  });

  it('父任务 completeTask 级联收尾活动子任务', () => {
    const s = useTaskProgressStore.getState();
    s.startTask({ ...base, id: 'parent' });
    s.startChildTask('parent', { ...base, id: 'parent::card::0' });
    s.completeTask('parent');
    const tasks = useTaskProgressStore.getState().tasks;
    expect(tasks.get('parent')!.status).toBe('completed');
    expect(tasks.get('parent::card::0')!.status).toBe('completed');
  });

  it('父任务 failTask 把活动子任务标记 error、保留已成功子任务', () => {
    const s = useTaskProgressStore.getState();
    s.startTask({ ...base, id: 'parent' });
    s.startChildTask('parent', { ...base, id: 'parent::card::0' });
    s.startChildTask('parent', { ...base, id: 'parent::card::1' });
    s.completeTask('parent::card::0');
    s.failTask('parent', 'boom');
    const tasks = useTaskProgressStore.getState().tasks;
    expect(tasks.get('parent::card::0')!.status).toBe('completed');
    expect(tasks.get('parent::card::1')!.status).toBe('error');
  });

  it('removeTask 父任务连带移除子任务', () => {
    const s = useTaskProgressStore.getState();
    s.startTask({ ...base, id: 'parent' });
    s.startChildTask('parent', { ...base, id: 'parent::card::0' });
    s.removeTask('parent');
    const tasks = useTaskProgressStore.getState().tasks;
    expect(tasks.has('parent')).toBe(false);
    expect(tasks.has('parent::card::0')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/task-progress-nesting.test.ts`
Expected: FAIL（`startChildTask is not a function`）

- [ ] **Step 3: 实现 store 改动**

In `src/store/task-progress.ts`:

3a. 给 `TaskProgressItem` 接口加字段（在 `completionAction?` 行后）：

```ts
  parentId?: string;
```

3b. `StartTaskInput` 改为允许 `parentId`：把
```ts
type StartTaskInput = Omit<TaskProgressItem, 'startedAt' | 'status'>;
```
保持不变即可（`parentId` 已在接口里、是可选项，自动包含）。

3c. `derivePrimaryTask` 顶部跳过子任务——在 `for (const t of tasks.values()) {` 之后第一行加：

```ts
    if (t.parentId) { index++; continue; }
```

3d. `deriveActiveCount` 只数顶层：

```ts
function deriveActiveCount(tasks: Map<string, TaskProgressItem>): number {
  let count = 0;
  for (const t of tasks.values()) {
    if (t.status === 'active' && !t.parentId) count++;
  }
  return count;
}
```

3e. `TaskProgressStore` 接口加方法签名（在 `startTask` 下方）：

```ts
  startChildTask: (parentId: string, task: StartTaskInput) => void;
```

3f. 在 `create<TaskProgressStore>` 里 `startTask` 实现下方加 `startChildTask`：

```ts
  startChildTask: (parentId, input) => {
    get().startTask({ ...input, parentId, level: 1 });
  },
```

3g. `completeTask` 级联——在它构造 `updated` 之后、`set(...)` 之前，把活动子任务一并标记完成。改写 `completeTask`：

```ts
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
```

3h. `failTask` 级联——把仍 active 的子任务标 error（已完成的保留）。改写 `failTask`：

```ts
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
```

3i. `removeTask` 级联删除子任务。改写 `removeTask`：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/task-progress-nesting.test.ts`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/store/task-progress.ts tests/task-progress-nesting.test.ts
git commit -m "feat(progress): task-progress 支持父子任务嵌套模型"
```

---

## Task 2: 后端卡片进度事件 + IPC 类型（Stream B）

**Files:**
- Modify: `src/lib/ai-analysis.ts`（类型 + runOne emit）
- Modify: `electron/preload.ts:268-289`（onAnalyzeProgress 类型补 card）
- Modify: `src/lib/electron-api.ts:387-395`（onAnalyzeProgress 类型补 card）
- Test: `tests/ai-analysis-card-progress.test.ts` (Create)

> `electron/main.ts:735` 是 `webContents.send('analyze-progress', progress)` 整对象透传，自动带上 `card`，无需改动。

- [ ] **Step 1: 写失败测试**

Create `tests/ai-analysis-card-progress.test.ts`。该测试只校验"事件映射"这一纯逻辑——把 runOne 的卡片生命周期翻译成 onProgress.card。为避免依赖真实 LLM，测试一个我们将抽出的纯函数 `buildCardProgress`：

```ts
import { describe, it, expect } from 'vitest';
import { buildCardProgress } from '../src/lib/ai-analysis';

describe('buildCardProgress', () => {
  it('start 事件携带段信息', () => {
    expect(
      buildCardProgress({ segmentIndex: 2, segmentId: 's2', title: '三国', visualType: 'motion', status: 'start' }),
    ).toEqual({
      phase: 'cards',
      percent: 30,
      card: { segmentIndex: 2, segmentId: 's2', title: '三国', visualType: 'motion', status: 'start' },
    });
  });

  it('done 事件透传 status', () => {
    const p = buildCardProgress({ segmentIndex: 0, segmentId: 's0', status: 'done' });
    expect(p.card?.status).toBe('done');
    expect(p.phase).toBe('cards');
  });

  it('failed 事件带 error', () => {
    const p = buildCardProgress({ segmentIndex: 1, segmentId: 's1', status: 'failed', error: 'boom' });
    expect(p.card?.error).toBe('boom');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/ai-analysis-card-progress.test.ts`
Expected: FAIL（`buildCardProgress` 未导出）

- [ ] **Step 3: 实现类型 + 纯函数 + emit**

3a. 在 `src/lib/ai-analysis.ts` 的 `AnalyzeSrtProgress` 接口（约 :37-43）改为：

```ts
export type AnalyzeCardSubStage = 'start' | 'generating-image' | 'done' | 'failed';

export interface AnalyzeCardProgress {
  segmentIndex: number;
  segmentId: string;
  title?: string;
  visualType?: string;
  status: AnalyzeCardSubStage;
  error?: string;
}

export interface AnalyzeSrtProgress {
  phase: 'planning' | 'cards' | 'done';
  percent: number;
  message?: string;
  cardIndex?: number;
  cardTotal?: number;
  card?: AnalyzeCardProgress;
}
```

3b. 在同文件、`analyzeSrt` 函数之外（顶层）加纯函数（供测试与 emit 复用）：

```ts
/** 把卡片生命周期事件包装成 cards 阶段进度（父进度百分比沿用 30，子任务靠 card 字段驱动）。 */
export function buildCardProgress(card: AnalyzeCardProgress): AnalyzeSrtProgress {
  return { phase: 'cards', percent: 30, card };
}
```

3c. 在 `runOne`（约 :1356-1442）的生命周期点追加 `onProgress?.(buildCardProgress(...))`，与现有 telemetry 并列：

- `card.start` 之后（约 :1369 后）加：
```ts
      onProgress?.(buildCardProgress({
        segmentIndex: i,
        segmentId: segment.id,
        title: segment.title,
        visualType,
        status: 'start',
      }));
```

- `card.image.start`（约 :1394）之后加：
```ts
          onProgress?.(buildCardProgress({
            segmentIndex: i,
            segmentId: segment.id,
            title: segment.title,
            visualType,
            status: 'generating-image',
          }));
```

- 成功 `card.end ok`（约 :1410）之后加：
```ts
        onProgress?.(buildCardProgress({
          segmentIndex: i,
          segmentId: segment.id,
          title: segment.title,
          visualType,
          status: 'done',
        }));
```

- 失败 `card.end`（约 :1427）之后加：
```ts
        onProgress?.(buildCardProgress({
          segmentIndex: i,
          segmentId: segment.id,
          title: segment.title,
          visualType,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }));
```

> 现有循环末尾的 `onProgress?.({ phase:'cards', percent, ... })`（约 :1435）**保留不动**——它驱动父任务百分比。

3d. `electron/preload.ts` `onAnalyzeProgress`（:268-289）的回调入参与 handler 入参类型，补 `card?` 字段。两处对象类型都加：

```ts
    card?: {
      segmentIndex: number;
      segmentId: string;
      title?: string;
      visualType?: string;
      status: 'start' | 'generating-image' | 'done' | 'failed';
      error?: string;
    };
```

3e. `src/lib/electron-api.ts` `onAnalyzeProgress`（:387-395）回调入参类型同样补上面那段 `card?` 字段。

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run: `npx vitest run tests/ai-analysis-card-progress.test.ts tests/ai-analysis.test.ts`
Expected: PASS（新测试绿，既有 ai-analysis 测试不回归）

- [ ] **Step 5: 提交**

```bash
git add src/lib/ai-analysis.ts electron/preload.ts src/lib/electron-api.ts tests/ai-analysis-card-progress.test.ts
git commit -m "feat(analyze): 卡片生命周期通过 IPC 进度上报（含 IPC 类型三件套）"
```

---

## Task 3: 进度桥卡片→子任务映射（Stream C）

**Files:**
- Modify: `src/lib/analyze-progress-bridge.ts`
- Test: `tests/analyze-progress-bridge.test.ts`（Modify，追加 describe）

- [ ] **Step 1: 写失败测试**

在 `tests/analyze-progress-bridge.test.ts` 末尾追加：

```ts
import { applyCardEvent, cardChildTaskId } from '../src/lib/analyze-progress-bridge';

describe('applyCardEvent 卡片→子任务映射', () => {
  function makeDeps() {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        startTask: (input: { id: string }) => calls.push(`start:${input.id}`),
        updateTask: (id: string) => calls.push(`update:${id}`),
        completeTask: (id: string) => calls.push(`complete:${id}`),
        failTask: (id: string, e: string) => calls.push(`fail:${id}:${e}`),
        hasTask: (id: string) => calls.some((c) => c.startsWith(`start:${id}`)),
      },
    };
  }

  it('start 创建子任务', () => {
    const { calls, deps } = makeDeps();
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', title: 'A', status: 'start' }, deps);
    expect(calls).toContain(`start:${cardChildTaskId('P', 0)}`);
  });

  it('generating-image 在已存在时走 update', () => {
    const { calls, deps } = makeDeps();
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', status: 'start' }, deps);
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', status: 'generating-image' }, deps);
    expect(calls).toContain(`update:${cardChildTaskId('P', 0)}`);
  });

  it('done → completeTask；failed → failTask', () => {
    const { calls, deps } = makeDeps();
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', status: 'start' }, deps);
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', status: 'done' }, deps);
    applyCardEvent('P', { segmentIndex: 1, segmentId: 's1', status: 'failed', error: 'x' }, deps);
    expect(calls).toContain(`complete:${cardChildTaskId('P', 0)}`);
    expect(calls).toContain(`fail:${cardChildTaskId('P', 1)}:x`);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/analyze-progress-bridge.test.ts`
Expected: FAIL（`applyCardEvent` / `cardChildTaskId` 未导出）

- [ ] **Step 3: 实现 bridge 扩展**

3a. `src/lib/analyze-progress-bridge.ts` 顶部 `AnalyzeProgressLike` 接口补 `card?`（与 Task 2 的 `AnalyzeCardProgress` 同形，本文件独立声明避免跨 import electron 侧）：

```ts
export type AnalyzeCardSubStage = 'start' | 'generating-image' | 'done' | 'failed';

export interface AnalyzeCardProgressLike {
  segmentIndex: number;
  segmentId: string;
  title?: string;
  visualType?: string;
  status: AnalyzeCardSubStage;
  error?: string;
}
```

并在 `AnalyzeProgressLike` 接口加：`card?: AnalyzeCardProgressLike;`

3b. 文件内新增子任务映射工具（顶层 export）：

```ts
const CARD_SUBSTAGE_PHASE: Record<AnalyzeCardSubStage, string> = {
  start: '生成内容…',
  'generating-image': '生成图片…',
  done: '完成',
  failed: '失败',
};

export function cardChildTaskId(parentId: string, segmentIndex: number): string {
  return `${parentId}::card::${segmentIndex}`;
}

export interface CardChildTaskDeps {
  startTask: (input: {
    id: string;
    parentId: string;
    category: 'ai-analyze';
    label: string;
    mode: 'indeterminate';
    progress: number;
    phase: string;
    level: 1;
    canCancel: false;
  }) => void;
  updateTask: (id: string, patch: { phase: string }) => void;
  completeTask: (id: string) => void;
  failTask: (id: string, error: string) => void;
  /** 子任务是否已创建（用于幂等：并发事件可能乱序）。 */
  hasTask: (id: string) => boolean;
}

/** 把单个卡片生命周期事件落到对应子任务（按 segmentIndex 幂等路由）。 */
export function applyCardEvent(
  parentId: string,
  card: AnalyzeCardProgressLike,
  deps: CardChildTaskDeps,
): void {
  const id = cardChildTaskId(parentId, card.segmentIndex);
  const label = `卡片#${card.segmentIndex + 1}${card.title ? ` ${card.title}` : ''}`;
  if (card.status === 'done') {
    deps.completeTask(id);
    return;
  }
  if (card.status === 'failed') {
    deps.failTask(id, card.error || '卡片生成失败');
    return;
  }
  // start / generating-image
  if (!deps.hasTask(id)) {
    deps.startTask({
      id,
      parentId,
      category: 'ai-analyze',
      label,
      mode: 'indeterminate',
      progress: 0,
      phase: CARD_SUBSTAGE_PHASE[card.status],
      level: 1,
      canCancel: false,
    });
  } else {
    deps.updateTask(id, { phase: CARD_SUBSTAGE_PHASE[card.status] });
  }
}
```

3c. 在 `createAnalyzeProgressBridge` 的 `deps.subscribe` 回调里，收到带 `card` 的事件时调用 `applyCardEvent`。给 `AnalyzeProgressBridgeDeps` 增加可选 `cardTasks?: CardChildTaskDeps`，并在 subscribe 回调开头加：

```ts
    if (progress.card && deps.cardTasks) {
      applyCardEvent(taskId, progress.card, deps.cardTasks);
      // card 事件不驱动父任务百分比，处理完直接返回，避免覆盖父 phase 文案
      return;
    }
```

（放在现有 `if (progress.phase !== 'planning' && inPlanning)` 判断之前。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/analyze-progress-bridge.test.ts`
Expected: PASS（原有用例 + 新增 3 用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/lib/analyze-progress-bridge.ts tests/analyze-progress-bridge.test.ts
git commit -m "feat(bridge): 卡片事件映射为父任务下的子任务"
```

---

## Task 4: 嵌套面板渲染（Stream D，依赖 Task 1）

**Files:**
- Modify: `src/components/TaskProgressPanel.tsx`
- Modify: `src/components/TaskProgressPanel.module.css`（加子行紧凑样式）

> 本任务以 `npm run build` 类型通过为主验证（组件无独立单测约定）；逻辑很薄。

- [ ] **Step 1: 改 `TaskProgressPanel` 分组渲染**

把 `TaskProgressPanel` 函数体（:88-107）改为顶层任务 + 其子任务的嵌套渲染：

```tsx
export function TaskProgressPanel() {
  const panelOpen = useTaskProgressStore((s) => s.panelOpen);
  const setPanelOpen = useTaskProgressStore((s) => s.setPanelOpen);
  const tasks = useTaskProgressStore((s) => s.tasks);

  if (!panelOpen || tasks.size === 0) return null;

  const all = Array.from(tasks.values());
  const topLevel = all
    .filter((t) => !t.parentId)
    .sort((a, b) => b.startedAt - a.startedAt);
  const childrenOf = (parentId: string) =>
    all
      .filter((t) => t.parentId === parentId)
      .sort((a, b) => a.startedAt - b.startedAt);

  return (
    <>
      <div className={styles.overlay} onClick={() => setPanelOpen(false)} />
      <div className={styles.panel}>
        {topLevel.map((task) => (
          <div key={task.id}>
            <TaskRow task={task} />
            {childrenOf(task.id).map((child) => (
              <CardChildRow key={child.id} task={child} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: 新增紧凑子行组件 `CardChildRow`**

在 `TaskProgressPanel.tsx` 的 `TaskRow` 之后加：

```tsx
function CardChildRow({ task }: { task: TaskProgressItem }) {
  const dot =
    task.status === 'completed' ? '✓'
      : task.status === 'error' ? '✗'
      : '◉';
  const dotClass =
    task.status === 'completed' ? styles.childDotDone
      : task.status === 'error' ? styles.childDotError
      : styles.childDotActive;
  return (
    <div className={styles.childRow}>
      <span className={`${styles.childDot} ${dotClass}`}>{dot}</span>
      <span className={styles.childLabel}>{task.label}</span>
      {task.status === 'active' && task.phase && (
        <span className={styles.taskPhase}>{task.phase}</span>
      )}
      {task.status === 'error' && task.error && (
        <span className={styles.errorText} title={task.error}>{task.error}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 加 CSS（`TaskProgressPanel.module.css` 末尾）**

```css
.childRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0 2px 24px;
  font-size: 12px;
  color: var(--color-text-secondary, #8e8e93);
}
.childDot { width: 14px; text-align: center; }
.childDotActive { color: var(--color-system-blue, #0A84FF); }
.childDotDone { color: var(--color-success, #32D74B); }
.childDotError { color: var(--color-danger, #FF453A); }
.childLabel { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 4: 类型检查（确保 import 了 `TaskProgressItem`，文件顶部已 import）**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i TaskProgressPanel || echo "no TaskProgressPanel type errors"`
Expected: `no TaskProgressPanel type errors`

- [ ] **Step 5: 提交**

```bash
git add src/components/TaskProgressPanel.tsx src/components/TaskProgressPanel.module.css
git commit -m "feat(progress): TaskProgressPanel 嵌套渲染卡片子任务"
```

---

## Task 5: 两入口接线（Stream E，依赖 1+2+3）

**Files:**
- Modify: `src/components/AIPanel.tsx:367-370`
- Modify: `src/hooks/useAIVideoWorkflow.ts:797-801`

- [ ] **Step 1: AIPanel 给桥注入子任务依赖**

把 `AIPanel.tsx:367-370` 的 `createAnalyzeProgressBridge` 调用改为带 `cardTasks`：

```ts
    const progressBridge = createAnalyzeProgressBridge(analyzeTaskId, {
      subscribe: (callback) => window.electronAPI.onAnalyzeProgress(callback),
      updateTask: (id, patch) => useTaskProgressStore.getState().updateTask(id, patch),
      cardTasks: {
        startTask: (input) => useTaskProgressStore.getState().startTask(input),
        updateTask: (id, patch) => useTaskProgressStore.getState().updateTask(id, patch),
        completeTask: (id) => useTaskProgressStore.getState().completeTask(id),
        failTask: (id, error) => useTaskProgressStore.getState().failTask(id, error),
        hasTask: (id) => useTaskProgressStore.getState().tasks.has(id),
      },
    });
```

> `createAnalyzeProgressBridge` 的 `subscribe` 回调入参类型来自 `electron-api`（Task 2 已补 `card?`），与 `AnalyzeProgressLike` 结构兼容。若 TS 报 `card` 不匹配，在 `subscribe` 处对回调做一次 `as AnalyzeProgressLike` 收敛。

- [ ] **Step 2: useAIVideoWorkflow 在 analyze 回调里落子任务**

把 `useAIVideoWorkflow.ts:797-801` 的 `onAnalyzeProgress` 回调改为同时处理 `card`：

```ts
        const cleanupAnalyzeProgress = window.electronAPI.onAnalyzeProgress((progress) => {
          if (isStaleRun()) return;
          if (progress.card) {
            applyCardEvent(workflowTaskId, progress.card, {
              startTask: (input) => useTaskProgressStore.getState().startTask(input),
              updateTask: (id, patch) => useTaskProgressStore.getState().updateTask(id, patch),
              completeTask: (id) => useTaskProgressStore.getState().completeTask(id),
              failTask: (id, error) => useTaskProgressStore.getState().failTask(id, error),
              hasTask: (id) => useTaskProgressStore.getState().tasks.has(id),
            });
            return; // card 事件不参与 3 轨合成百分比
          }
          analyzePercent = progress.percent;
          refreshCombinedProgress();
        });
```

并在文件顶部 import：

```ts
import { applyCardEvent } from '../lib/analyze-progress-bridge';
```

> 子任务挂在 `workflowTaskId` 下；3 轨合成数学（`refreshCombinedProgress`）完全不受影响——这是 spec 的"不动已验证数学"约束。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "AIPanel|useAIVideoWorkflow" || echo "no wiring type errors"`
Expected: `no wiring type errors`

- [ ] **Step 4: 提交**

```bash
git add src/components/AIPanel.tsx src/hooks/useAIVideoWorkflow.ts
git commit -m "feat(progress): AIPanel 与一键流水线接入卡片子任务展示"
```

---

## Task 6: 集成验证

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全绿（含新增 task-progress-nesting / ai-analysis-card-progress / analyze-progress-bridge 用例）

- [ ] **Step 2: 构建（类型 + 编译）**

Run: `npm run build`
Expected: 成功，无 TS 报错

- [ ] **Step 3: 提交（若有 lockfile/产物外的必要改动）**

```bash
git status   # 确认无意外改动 dist/ 等产物目录
```

- [ ] **Step 4: 手动验收要点（记录，非脚本）**

- 编辑器 AIPanel 触发分析：底部条显示父任务"内容卡片分析"，展开面板见 planning 后逐段出现"卡片#N"，含"生成内容…/生成图片…"，成功 ✓ / 失败 ✗。
- 一键流水线：底部条总进度照旧推进，展开面板 analyze 阶段同样见卡片子任务，且总百分比节奏与改前一致。

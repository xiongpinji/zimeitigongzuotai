# 脚本工作台 Agent 驱动重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将脚本工作台从强制 4 步线性流程重构为 Agent 驱动 + 虚拟光标实时可视化协作模式。

**Architecture:** 移除所有 Step 组件和步骤状态机，改为显式的工作区状态机。写入类操作（生成 / 重写）走主进程 `write stream` 拦截链路，由渲染进程播放动画后 ACK 提交；审查类操作走独立的 `ReviewPayload` 结果协议，在渲染进程本地回放为扫描动画和标注。`ScriptEditor` 自己拥有 CodeMirror 扩展装配权，父组件只传状态和回调。

**Tech Stack:** React 18, Zustand, CodeMirror 6, Electron IPC, TypeScript, diff-match-patch

**Spec:** `docs/superpowers/specs/2026-04-07-script-workbench-agent-driven-redesign.md`

---

## 实施前置约束

以下约束用于消除本轮评审里的 P0 / P1 风险，后续所有 Task 都必须遵守：

1. **写入流和审查流必须分离**
   - `generate / rewrite / custom write` 走 `fs/write_text_file` + diff + streaming。
   - `review` 不走 diff，不写 `script.md`，必须返回结构化 `ReviewPayload`。

2. **写盘必须由 Renderer ACK 驱动**
   - 主进程收到 Agent 写文件请求后，只能先创建 pending stream。
   - 只有在渲染进程回传 `full / partial / abort` ACK 后，主进程才能决定写盘或回滚。

3. **禁止再用文本长度代替工作区状态**
   - `originalText.length > 0` / `scriptText.length > 0` 只能作为展示信息，不能作为流程状态唯一依据。
   - 计划中必须引入显式的 `WorkspaceFilesState` + `ReviewState`。

4. **ScriptEditor 是 CodeMirror 扩展唯一装配点**
   - 父组件不得传 `virtualCursorExtension` / `readOnlyGuard` 实例。
   - 父组件只传 `readOnly`、`editorViewRef` 和事件回调。

5. **快捷操作必须区分 UI Action 与 Agent Prompt**
   - `导入文稿`、`新建空白`、`复制口播稿`、`全部接受` 是本地 UI action。
   - `生成口播稿`、`AI 审查`、`重新生成`、`重新审查` 才是 Agent prompt。

6. **标注必须绑定文档版本**
   - 每条标注至少包含 `startOffset/endOffset + quotedText + docVersion`。
   - 文本改动后旧标注转 `stale`，不能继续参与“全部接受”。

## Phase 1: 状态管理与持久化

### Task 1: Script Store 重构 — 移除步骤状态，新增工作区 / 审查 / 流式会话状态

**Files:**
- Modify: `src/store/script.ts`
- Test: `tests/script-store.test.ts`

- [ ] **Step 1: 更新 ScriptState 接口，移除 `currentStep`，引入显式工作流状态**

在 `src/store/script.ts` 中：

1. 移除 `ScriptStep` 类型和所有引用。
2. 从 `ScriptState` 接口中移除：
   - `currentStep`
   - `drawerVisible`
   - `drawerContent`
3. 新增字段：

```typescript
workspaceFiles: WorkspaceFilesState;
agentOperation: AgentOperationState;
editorAgent: EditorAgentState;
reviewState: ReviewState;
scriptDocVersion: number;
activeStream: ActiveStreamState;
```

4. 在 `Annotation` 接口中新增：

```typescript
quotedText: string;
docVersion: number;
stale?: boolean;
```

5. 在文件顶部新增类型定义并导出：

```typescript
export type ReviewState = 'idle' | 'pending' | 'issues' | 'clean' | 'stale';

export interface WorkspaceFilesState {
  hasOriginalFile: boolean;
  hasScriptFile: boolean;
}

export interface AgentOperationState {
  isOperating: boolean;
  operationType: 'generate' | 'review' | 'rewrite' | 'custom' | null;
  progress: number;
  canInterrupt: boolean;
}

export interface EditorAgentState {
  readOnly: boolean;
  virtualCursorPos: number | null;
  streamingActive: boolean;
}

export interface ActiveStreamState {
  streamId: string | null;
  filePath: string | null;
  phase: 'idle' | 'playing' | 'awaiting_commit' | 'stopped';
}
```

- [ ] **Step 2: 更新 ScriptActions 接口**

移除：
- `setCurrentStep`
- `openDrawer`
- `closeDrawer`

新增：

```typescript
setWorkspaceFiles: (state: Partial<WorkspaceFilesState>) => void;
setAgentOperation: (state: Partial<AgentOperationState>) => void;
setEditorAgent: (state: Partial<EditorAgentState>) => void;
setReviewState: (state: ReviewState) => void;
bumpScriptDocVersion: () => void;
setActiveStream: (state: Partial<ActiveStreamState>) => void;
markReviewStale: () => void;
startAgentOperation: (type: AgentOperationState['operationType']) => void;
stopAgentOperation: (options?: { resetStream?: boolean }) => void;
clearActiveStream: () => void;
```

- [ ] **Step 3: 更新 store 初始值和 action 实现**

新增初始值：

```typescript
workspaceFiles: {
  hasOriginalFile: false,
  hasScriptFile: false,
},
agentOperation: {
  isOperating: false,
  operationType: null,
  progress: 0,
  canInterrupt: true,
},
editorAgent: {
  readOnly: false,
  virtualCursorPos: null,
  streamingActive: false,
},
reviewState: 'idle',
scriptDocVersion: 0,
activeStream: {
  streamId: null,
  filePath: null,
  phase: 'idle',
},
```

新增 action：

```typescript
setWorkspaceFiles: (partial) =>
  set((s) => ({ workspaceFiles: { ...s.workspaceFiles, ...partial } })),

setReviewState: (reviewState) => set({ reviewState }),

bumpScriptDocVersion: () =>
  set((s) => ({ scriptDocVersion: s.scriptDocVersion + 1 })),

setActiveStream: (partial) =>
  set((s) => ({ activeStream: { ...s.activeStream, ...partial } })),

markReviewStale: () => set({ reviewState: 'stale' }),

startAgentOperation: (type) =>
  set({
    agentOperation: {
      isOperating: true,
      operationType: type,
      progress: 0,
      canInterrupt: true,
    },
    editorAgent: {
      readOnly: true,
      virtualCursorPos: null,
      streamingActive: type !== 'review',
    },
  }),

stopAgentOperation: (options) =>
  set((s) => ({
    agentOperation: {
      isOperating: false,
      operationType: null,
      progress: 0,
      canInterrupt: true,
    },
    editorAgent: { readOnly: false, virtualCursorPos: null, streamingActive: false },
    activeStream: options?.resetStream === false
      ? s.activeStream
      : { streamId: null, filePath: null, phase: 'idle' },
  })),

clearActiveStream: () =>
  set({
    activeStream: { streamId: null, filePath: null, phase: 'idle' },
  }),
```

- [ ] **Step 4: 补充 docVersion / stale 规则**

补充以下实现约束：

1. 所有真正修改 `script.md` 内容的入口都必须显式调用 `bumpScriptDocVersion()`。
2. 以下场景必须 bump：
   - 用户直接编辑 `script.md`
   - 接受单条标注
   - 全部接受
   - Agent 重写完成
   - write stream 的 `full` 或 `partial` commit
3. 当 `scriptDocVersion` 变化且仍有 `pending` 标注时，自动执行 `markReviewStale()`。

- [ ] **Step 5: 更新 auto-save hook**

修改 `subscribe`：不再监听 `currentStep`，改为监听：

```typescript
state.reviewState
state.scriptDocVersion
state.selectedTemplate
state.annotations
```

- [ ] **Step 6: 更新 restoreState action**

`restoreState` 参数中移除 `currentStep`，新增：

```typescript
workspaceFiles: WorkspaceFilesState;
reviewState: ReviewState;
scriptDocVersion: number;
```

- [ ] **Step 7: 更新测试**

在 `tests/script-store.test.ts` 中：
1. 删除所有 `currentStep` / drawer 相关测试。
2. 新增：

```typescript
describe('agent operation state', () => {
  it('startAgentOperation sets operating state and editor readOnly', () => {
    useScriptStore.getState().startAgentOperation('generate');
    const state = useScriptStore.getState();
    expect(state.agentOperation.isOperating).toBe(true);
    expect(state.agentOperation.operationType).toBe('generate');
    expect(state.editorAgent.readOnly).toBe(true);
  });

  it('stopAgentOperation can preserve stopped stream for interrupted UI', () => {
    useScriptStore.getState().startAgentOperation('review');
    useScriptStore.getState().setActiveStream({
      streamId: 'stream-1',
      filePath: 'script.md',
      phase: 'stopped',
    });
    useScriptStore.getState().stopAgentOperation({ resetStream: false });
    const state = useScriptStore.getState();
    expect(state.agentOperation.isOperating).toBe(false);
    expect(state.activeStream.phase).toBe('stopped');
  });

  it('clearActiveStream resets stream state', () => {
    useScriptStore.getState().setActiveStream({
      streamId: 'stream-1',
      filePath: 'script.md',
      phase: 'awaiting_commit',
    });
    useScriptStore.getState().clearActiveStream();
    const state = useScriptStore.getState();
    expect(state.activeStream.phase).toBe('idle');
  });

  it('markReviewStale transitions reviewState to stale', () => {
    useScriptStore.setState({ reviewState: 'issues' });
    useScriptStore.getState().markReviewStale();
    expect(useScriptStore.getState().reviewState).toBe('stale');
  });

  it('bumpScriptDocVersion increments doc version', () => {
    useScriptStore.setState({ scriptDocVersion: 2 });
    useScriptStore.getState().bumpScriptDocVersion();
    expect(useScriptStore.getState().scriptDocVersion).toBe(3);
  });
});
```

- [ ] **Step 8: 运行测试验证**

Run: `npx vitest run tests/script-store.test.ts`
Expected: All tests pass

- [ ] **Step 9: 导出新类型**

确保 `WorkspaceFilesState`、`ReviewState`、`AgentOperationState`、`EditorAgentState`、`ActiveStreamState` 被 export，供其他模块使用。

- [ ] **Step 10: Commit**

```bash
git add src/store/script.ts tests/script-store.test.ts
git commit -m "refactor(script-store): 引入工作区状态机和流式会话状态"
```

---

### Task 2: 持久化 v2 迁移

**Files:**
- Modify: `src/lib/script-persistence.ts`
- Test: `tests/script-persistence.test.ts`

- [ ] **Step 1: 先写 v1 → v2 迁移映射表，再写测试**

先在计划实现中固定映射规则，禁止再使用 `currentStep >= 3` 这类粗糙判断：

| v1 `currentStep` | v2 `reviewState` | 备注 |
|---|---|---|
| `0 / 1 / 2` | `idle` | 尚未完成 AI 审查 |
| `3` 且存在 pending annotations | `issues` | 已进入审查阶段并发现问题 |
| `3` 且无 annotations | `idle` | 旧数据无法证明审查已落标注，保守回退 |
| `4` 且存在 pending annotations | `issues` | 已到确认阶段但仍有未处理问题 |
| `4` 且 annotations 全部 accepted / dismissed | `clean` | 审查已处理完成 |

然后在 `tests/script-persistence.test.ts` 新增：

```typescript
describe('v1 → v2 migration', () => {
  it('step 3 without annotations migrates to idle', () => {
    const result = migratePersistedState({
      version: 1,
      currentStep: 3,
      templateId: 'news-broadcast',
      annotations: [],
    });
    expect(result.reviewState).toBe('idle');
  });

  it('step 3 with pending annotations migrates to issues', () => {
    const result = migratePersistedState({
      version: 1,
      currentStep: 3,
      templateId: 'news-broadcast',
      annotations: [{ id: '1', status: 'pending' }],
    });
    expect(result.reviewState).toBe('issues');
  });

  it('step 4 with fully resolved annotations migrates to clean', () => {
    const result = migratePersistedState({
      version: 1,
      currentStep: 4,
      templateId: 'news-broadcast',
      annotations: [{ id: '1', status: 'accepted' }],
    });
    expect(result.reviewState).toBe('clean');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/script-persistence.test.ts`
Expected: FAIL — `migratePersistedState` 未定义或接口不匹配

- [ ] **Step 3: 实现 v2 PersistedScriptState 和迁移逻辑**

在 `src/lib/script-persistence.ts` 中：

1. 更新接口：

```typescript
interface PersistedScriptState {
  version: 2;
  templateId: string;
  annotations: Annotation[];
  reviewState: ReviewState;
  lastReviewedDocVersion: number;
  createdAt: string;
  updatedAt: string;
  lastOperation?: string;
}
```

2. 新增：

```typescript
function deriveReviewStateFromV1(
  currentStep: number,
  annotations: Annotation[],
): ReviewState {
  const pending = annotations.some((a) => a.status === 'pending');
  const resolved = annotations.length > 0 && annotations.every((a) => a.status !== 'pending');

  if (currentStep === 4 && resolved) return 'clean';
  if ((currentStep === 3 || currentStep === 4) && pending) return 'issues';
  return 'idle';
}

export function migratePersistedState(raw: Record<string, unknown>): PersistedScriptState {
  if (raw.version === 2) return raw as PersistedScriptState;

  const annotations = Array.isArray(raw.annotations) ? (raw.annotations as Annotation[]) : [];
  const reviewState = deriveReviewStateFromV1((raw.currentStep as number) ?? 0, annotations);

  return {
    version: 2,
    templateId: (raw.templateId as string) ?? 'news-broadcast',
    annotations,
    reviewState,
    lastReviewedDocVersion: reviewState === 'idle' ? 0 : 1,
    createdAt: (raw.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (raw.updatedAt as string) ?? new Date().toISOString(),
  };
}
```

3. 更新 `createPersistedScriptState`，输出 `reviewState + lastReviewedDocVersion`。
4. 更新 `loadScriptState`，加载时统一走 `migratePersistedState`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/script-persistence.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/script-persistence.ts tests/script-persistence.test.ts
git commit -m "feat(persistence): script-state.json v1→v2 迁移到 reviewState"
```

---

### Task 2A: ReviewPayload 协议与解析

**Files:**
- Create: `src/lib/script-review-payload.ts`
- Test: `tests/script-review-payload.test.ts`

- [ ] **Step 1: 定义 ReviewPayload 类型和 fenced block 协议**

在 `src/lib/script-review-payload.ts` 中定义：

```typescript
export interface ReviewFinding {
  id: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  issue: string;
  suggestion: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ReviewPayload {
  version: 1;
  filePath: 'script.md';
  docVersion: number;
  summary: {
    total: number;
    error: number;
    warning: number;
    info: number;
  };
  findings: ReviewFinding[];
}
```

约定 Agent 在审查结束时返回：

````markdown
```script-review
{ ...ReviewPayload JSON... }
```
````

- [ ] **Step 2: 先写解析测试**

在 `tests/script-review-payload.test.ts` 中覆盖：
- 正常提取 fenced block
- 无 fenced block 返回 `null`
- 非法 JSON 返回 `null`
- `findings` 缺少必填字段返回 `null`

- [ ] **Step 3: 实现解析器**

```typescript
export function parseReviewPayload(text: string): ReviewPayload | null
```

解析器只接受第一个 `script-review` fenced block，且必须校验：
- `version === 1`
- `filePath === 'script.md'`
- `docVersion` 为数字
- `findings` 为数组且包含 `quotedText`

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/script-review-payload.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/script-review-payload.ts tests/script-review-payload.test.ts
git commit -m "feat(review): 新增 ReviewPayload 协议和解析器"
```

---

## Phase 2: 编辑器扩展（核心体验）

### Task 3: VirtualCursor — CodeMirror 虚拟光标装饰

**Files:**
- Create: `src/lib/virtual-cursor.ts`
- Test: `tests/virtual-cursor.test.ts`

- [ ] **Step 1: 写虚拟光标位置更新测试**

```typescript
// tests/virtual-cursor.test.ts
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  virtualCursorField,
  setVirtualCursor,
  clearVirtualCursor,
} from '../src/lib/virtual-cursor';

describe('VirtualCursor', () => {
  function createView(doc = 'Hello World') {
    return new EditorView({
      state: EditorState.create({ doc, extensions: [virtualCursorField] }),
    });
  }

  it('initially has no virtual cursor', () => {
    const view = createView();
    expect(view.state.field(virtualCursorField)).toBe(null);
    view.destroy();
  });

  it('setVirtualCursor places cursor at position', () => {
    const view = createView();
    view.dispatch({ effects: setVirtualCursor.of(5) });
    expect(view.state.field(virtualCursorField)).toBe(5);
    view.destroy();
  });

  it('clearVirtualCursor removes cursor', () => {
    const view = createView();
    view.dispatch({ effects: setVirtualCursor.of(5) });
    view.dispatch({ effects: clearVirtualCursor.of(null) });
    expect(view.state.field(virtualCursorField)).toBe(null);
    view.destroy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/virtual-cursor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 VirtualCursor StateField 和 Effects**

```typescript
// src/lib/virtual-cursor.ts
import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';

export const setVirtualCursor = StateEffect.define<number>();
export const clearVirtualCursor = StateEffect.define<null>();

export const virtualCursorField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setVirtualCursor)) return effect.value;
      if (effect.is(clearVirtualCursor)) return null;
    }
    // 如果文档发生变化且光标存在，映射位置
    if (value !== null && tr.docChanged) {
      return tr.changes.mapPos(value);
    }
    return value;
  },
});

class VirtualCursorWidget extends WidgetType {
  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-virtual-cursor';

    const cursor = document.createElement('span');
    cursor.className = 'cm-virtual-cursor-line';

    const label = document.createElement('span');
    label.className = 'cm-virtual-cursor-label';
    label.textContent = '🤖';

    wrapper.appendChild(label);
    wrapper.appendChild(cursor);
    return wrapper;
  }

  eq(): boolean {
    return true;
  }
}

const virtualCursorDecoration = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_, tr) {
    const pos = tr.state.field(virtualCursorField);
    if (pos === null) return Decoration.none;
    const clampedPos = Math.min(pos, tr.state.doc.length);
    return Decoration.set([
      Decoration.widget({ widget: new VirtualCursorWidget(), side: 1 }).range(clampedPos),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// CSS 样式 — 通过 EditorView.theme 提供
const virtualCursorTheme = EditorView.baseTheme({
  '.cm-virtual-cursor': {
    position: 'relative',
    display: 'inline',
  },
  '.cm-virtual-cursor-line': {
    display: 'inline-block',
    width: '2px',
    height: '1.2em',
    backgroundColor: '#a78bfa',
    verticalAlign: 'text-bottom',
    animation: 'cm-vc-blink 1s step-end infinite',
  },
  '.cm-virtual-cursor-label': {
    position: 'absolute',
    top: '-1.4em',
    left: '-4px',
    fontSize: '10px',
    lineHeight: '1',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  '@keyframes cm-vc-blink': {
    '50%': { opacity: '0' },
  },
});

/** 完整的虚拟光标扩展，包含 StateField + 装饰 + 主题 */
export const virtualCursorExtension = [
  virtualCursorField,
  virtualCursorDecoration,
  virtualCursorTheme,
];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/virtual-cursor.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/virtual-cursor.ts tests/virtual-cursor.test.ts
git commit -m "feat(editor): VirtualCursor CodeMirror 扩展 — 虚拟光标装饰"
```

---

### Task 4: EditorReadOnlyGuard — Agent 操作时编辑器只读控制

**Files:**
- Create: `src/lib/editor-readonly-guard.ts`

- [ ] **Step 1: 实现 ReadOnlyGuard**

```typescript
// src/lib/editor-readonly-guard.ts
import { Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * 通过 Compartment 动态切换编辑器只读状态。
 * 使用方式：
 *   extensions 中加入 readOnlyGuard.extension
 *   切换只读：view.dispatch({ effects: readOnlyGuard.reconfigure(true) })
 */
export function createReadOnlyGuard() {
  const compartment = new Compartment();

  return {
    extension: compartment.of(EditorView.editable.of(true)),

    reconfigure(readOnly: boolean) {
      return compartment.reconfigure(EditorView.editable.of(!readOnly));
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/editor-readonly-guard.ts
git commit -m "feat(editor): EditorReadOnlyGuard 动态只读切换"
```

---

### Task 5: StreamingEditor — 写入流播放控制器

**Files:**
- Create: `src/lib/streaming-editor.ts`
- Test: `tests/streaming-editor.test.ts`

- [ ] **Step 1: 定义接口**

```typescript
// src/lib/streaming-editor.ts
import type { EditorView } from '@codemirror/view';
import { setVirtualCursor, clearVirtualCursor } from './virtual-cursor';

export interface StreamingEditOperation {
  type: 'insert' | 'delete' | 'replace';
  offset: number;
  length?: number;
  text?: string;
}

export interface AnimationFrame {
  cursorPosition: number;
  operation: StreamingEditOperation;
  delayMs: number;
}

export type StreamingSpeed = 'fast' | 'normal' | 'detailed';

export interface StreamingEditorOptions {
  speed?: StreamingSpeed;
  onProgress?: (percent: number) => void;
  onComplete?: () => void;
  onStopped?: (committedContent: string) => void;
}
```

- [ ] **Step 2: 写核心测试**

```typescript
// tests/streaming-editor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingEditor } from '../src/lib/streaming-editor';
import type { AnimationFrame } from '../src/lib/streaming-editor';

// Mock EditorView
function createMockView(initialDoc = '') {
  let doc = initialDoc;
  return {
    state: { doc: { length: doc.length, toString: () => doc } },
    dispatch: vi.fn((spec: any) => {
      if (spec.changes) {
        // 简化的 change 应用
        const { from, to, insert } = spec.changes;
        doc = doc.slice(0, from) + (insert || '') + doc.slice(to ?? from);
      }
    }),
    destroy: vi.fn(),
  };
}

describe('StreamingEditor', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('plays frames sequentially and calls onComplete', async () => {
    const mockView = createMockView('');
    const onComplete = vi.fn();
    const onProgress = vi.fn();
    const controller = new StreamingEditor(mockView as any, {
      onComplete,
      onProgress,
    });

    const frames: AnimationFrame[] = [
      { cursorPosition: 0, operation: { type: 'insert', offset: 0, text: 'Hello' }, delayMs: 100 },
      { cursorPosition: 5, operation: { type: 'insert', offset: 5, text: ' World' }, delayMs: 100 },
    ];

    controller.start(frames);
    expect(controller.isPlaying).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(onProgress).toHaveBeenCalledWith(50);

    await vi.advanceTimersByTimeAsync(100);
    expect(onProgress).toHaveBeenCalledWith(100);
    expect(onComplete).toHaveBeenCalled();
    expect(controller.isPlaying).toBe(false);
  });

  it('stop() halts playback and returns committed content', async () => {
    const mockView = createMockView('');
    const onStopped = vi.fn();
    const controller = new StreamingEditor(mockView as any, { onStopped });

    const frames: AnimationFrame[] = [
      { cursorPosition: 0, operation: { type: 'insert', offset: 0, text: 'A' }, delayMs: 50 },
      { cursorPosition: 1, operation: { type: 'insert', offset: 1, text: 'B' }, delayMs: 50 },
      { cursorPosition: 2, operation: { type: 'insert', offset: 2, text: 'C' }, delayMs: 50 },
    ];

    controller.start(frames);
    await vi.advanceTimersByTimeAsync(50); // 第一帧执行
    controller.stop();
    expect(onStopped).toHaveBeenCalled();
    expect(onStopped).toHaveBeenCalledWith('A');
    expect(controller.isPlaying).toBe(false);

    // 继续推进时间，不应再有 dispatch
    const callCount = mockView.dispatch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(mockView.dispatch.mock.calls.length).toBe(callCount);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/streaming-editor.test.ts`
Expected: FAIL — `StreamingEditor` not found

- [ ] **Step 4: 实现 StreamingEditor 控制器**

```typescript
// src/lib/streaming-editor.ts（接续 Step 1 的接口定义）

const SPEED_MULTIPLIER: Record<StreamingSpeed, number> = {
  fast: 0.3,
  normal: 1,
  detailed: 2,
};

export class StreamingEditor {
  private view: EditorView;
  private frames: AnimationFrame[] = [];
  private currentIndex = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private options: Required<StreamingEditorOptions>;
  private _isPlaying = false;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  constructor(view: EditorView, options: StreamingEditorOptions = {}) {
    this.view = view;
    this.options = {
      speed: options.speed ?? 'normal',
      onProgress: options.onProgress ?? (() => {}),
      onComplete: options.onComplete ?? (() => {}),
      onStopped: options.onStopped ?? (() => {}),
    };
  }

  start(frames: AnimationFrame[]): void {
    this.frames = frames;
    this.currentIndex = 0;
    this._isPlaying = true;
    this.scheduleNext();
  }

  stop(): void {
    this.cancelTimer();
    this._isPlaying = false;
    this.view.dispatch({ effects: clearVirtualCursor.of(null) });
    this.options.onStopped(this.view.state.doc.toString());
  }

  setSpeed(speed: StreamingSpeed): void {
    this.options.speed = speed;
  }

  private scheduleNext(): void {
    if (this.currentIndex >= this.frames.length) {
      this._isPlaying = false;
      this.view.dispatch({ effects: clearVirtualCursor.of(null) });
      this.options.onComplete();
      return;
    }

    const frame = this.frames[this.currentIndex];
    const delay = frame.delayMs * SPEED_MULTIPLIER[this.options.speed];

    this.timerId = setTimeout(() => {
      this.applyFrame(frame);
      this.currentIndex++;
      this.options.onProgress(
        Math.round((this.currentIndex / this.frames.length) * 100),
      );
      this.scheduleNext();
    }, delay);
  }

  private applyFrame(frame: AnimationFrame): void {
    const { operation } = frame;
    const changes = this.operationToChange(operation);

    this.view.dispatch({
      changes,
      effects: setVirtualCursor.of(frame.cursorPosition),
      scrollIntoView: true,
    });
  }

  private operationToChange(op: StreamingEditOperation) {
    switch (op.type) {
      case 'insert':
        return { from: op.offset, insert: op.text ?? '' };
      case 'delete':
        return { from: op.offset, to: op.offset + (op.length ?? 0) };
      case 'replace':
        return { from: op.offset, to: op.offset + (op.length ?? 0), insert: op.text ?? '' };
    }
  }

  private cancelTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/streaming-editor.test.ts`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/streaming-editor.ts tests/streaming-editor.test.ts
git commit -m "feat(editor): StreamingEditor 流式写入控制器"
```

---

### Task 5A: ReviewPlaybackController — 审查结果本地回放

**Files:**
- Create: `src/lib/review-playback.ts`
- Test: `tests/review-playback.test.ts`

- [ ] **Step 1: 定义回放控制器接口**

```typescript
import type { EditorView } from '@codemirror/view';
import type { ReviewPayload } from './script-review-payload';

export interface ReviewPlaybackOptions {
  onProgress?: (percent: number, found: number) => void;
  onFinding?: (findingId: string) => void;
  onComplete?: () => void;
}

export class ReviewPlaybackController {
  constructor(
    private view: EditorView,
    private applyFinding: (payload: ReviewPayload['findings'][number]) => void,
    private options: ReviewPlaybackOptions = {},
  ) {}

  start(payload: ReviewPayload): void {}
  stop(): void {}
}
```

- [ ] **Step 2: 先写测试**

测试覆盖：
- 按 `startOffset` 顺序回放 finding
- 每回放一条 finding 都会调用 `applyFinding`
- `stop()` 后不再继续调度

- [ ] **Step 3: 实现本地扫描回放**

实现要求：
- 审查回放不写磁盘
- 每条 finding 先移动虚拟光标，再调用 `applyFinding`
- `onProgress(percent, found)` 实时汇报当前扫描进度

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/review-playback.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/review-playback.ts tests/review-playback.test.ts
git commit -m "feat(review): 新增审查结果本地回放控制器"
```

---

### Task 6: diff → AnimationFrame 转换器

**Files:**
- Create: `src/lib/diff-to-frames.ts`
- Test: `tests/diff-to-frames.test.ts`

- [ ] **Step 1: 安装 diff-match-patch**

```bash
npm install diff-match-patch
npm install -D @types/diff-match-patch
```

- [ ] **Step 2: 写转换测试**

```typescript
// tests/diff-to-frames.test.ts
import { describe, it, expect } from 'vitest';
import { diffToFrames } from '../src/lib/diff-to-frames';

describe('diffToFrames', () => {
  it('empty file → new content produces insert frames', () => {
    const frames = diffToFrames('', 'Hello World');
    expect(frames.length).toBeGreaterThan(0);
    // 所有帧都应该是 insert
    for (const f of frames) {
      expect(f.operation.type).toBe('insert');
    }
    // 连接所有 insert 文本应等于目标内容
    const combined = frames.map((f) => f.operation.text).join('');
    expect(combined).toBe('Hello World');
  });

  it('partial replace produces correct frames', () => {
    const frames = diffToFrames('Hello World', 'Hello CodeMirror');
    // 至少包含一个 delete 或 replace 和一个 insert
    const types = new Set(frames.map((f) => f.operation.type));
    expect(types.size).toBeGreaterThanOrEqual(1);
  });

  it('respects chunkSize for insert splitting', () => {
    const longText = 'A'.repeat(100);
    const frames = diffToFrames('', longText, { chunkSize: 20 });
    // 100 字按 20 字分块应产生 5 帧
    expect(frames.length).toBe(5);
  });

  it('identical content produces no frames', () => {
    const frames = diffToFrames('same', 'same');
    expect(frames.length).toBe(0);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/diff-to-frames.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现转换器**

```typescript
// src/lib/diff-to-frames.ts
import DiffMatchPatch from 'diff-match-patch';
import type { AnimationFrame, StreamingEditOperation } from './streaming-editor';

export interface DiffToFramesOptions {
  chunkSize?: number;        // insert 文本分块大小，默认 15
  baseDelayMs?: number;      // 每帧基础延迟，默认 30
}

const DEFAULT_OPTIONS: Required<DiffToFramesOptions> = {
  chunkSize: 15,
  baseDelayMs: 30,
};

export function diffToFrames(
  before: string,
  after: string,
  options?: DiffToFramesOptions,
): AnimationFrame[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(before, after);
  dmp.diff_cleanupSemantic(diffs);

  const frames: AnimationFrame[] = [];
  let cursorPos = 0;

  for (const [op, text] of diffs) {
    if (op === 0) {
      // EQUAL — 光标前进，无操作
      cursorPos += text.length;
    } else if (op === -1) {
      // DELETE
      frames.push({
        cursorPosition: cursorPos,
        operation: { type: 'delete', offset: cursorPos, length: text.length },
        delayMs: opts.baseDelayMs,
      });
      // cursorPos 不变，因为删除后后续内容前移
    } else if (op === 1) {
      // INSERT — 按 chunkSize 分块
      for (let i = 0; i < text.length; i += opts.chunkSize) {
        const chunk = text.slice(i, i + opts.chunkSize);
        frames.push({
          cursorPosition: cursorPos + chunk.length,
          operation: { type: 'insert', offset: cursorPos, text: chunk },
          delayMs: opts.baseDelayMs,
        });
        cursorPos += chunk.length;
      }
    }
  }

  return frames;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/diff-to-frames.test.ts`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/diff-to-frames.ts tests/diff-to-frames.test.ts package.json package-lock.json
git commit -m "feat(editor): diff→AnimationFrame 转换器"
```

---

## Phase 3: Agent 拦截层与 IPC

### Task 7: AgentWriteInterceptor — 主进程写入流拦截层

**Files:**
- Create: `electron/acp/operation-interceptor.ts`
- Test: `tests/acp-operation-interceptor.test.ts`

- [ ] **Step 1: 先定义 stream contract**

在 `electron/acp/operation-interceptor.ts` 中定义：

```typescript
export interface PendingWriteStream {
  streamId: string;
  filePath: string;
  beforeSnapshot: string | null;
  finalContent: string;
  operationType: 'generate' | 'rewrite' | 'custom';
  fileExistsBefore: boolean;
  frames: StreamingFrame[];
  resolve: (result: WriteResult) => void;
  reject: (error: Error) => void;
}
```

拦截层职责：
- 只处理 `script.md` / `original.md` 的写入流
- 负责 `streamId`、`beforeSnapshot`、`finalContent`
- 不直接写盘
- 等待 renderer ACK 后再提交

- [ ] **Step 2: 实现 `beginWriteStream()` / `commitWriteStream()`**

核心接口：

```typescript
beginWriteStream(
  filePath: string,
  before: string | null,
  after: string,
  operationType: 'generate' | 'rewrite' | 'custom',
): PendingWriteStream
commitWriteStream(streamId: string, mode: 'full' | 'partial' | 'abort', committedContent?: string): Promise<void>
```

实现要求：
- `beginWriteStream()` 只计算 diff + 缓存 pending stream + 发 `agent:write-stream-start`
- 当 `before === null` 时，必须标记 `fileExistsBefore = false`，供 renderer 渲染 `ephemeral node`
- `commitWriteStream()` 根据模式处理：
  - `full`：写入 `finalContent`
  - `partial`：写入 `committedContent`
  - `abort`：不写盘，恢复 `beforeSnapshot`

- [ ] **Step 3: 先写测试**

在 `tests/acp-operation-interceptor.test.ts` 中覆盖：
- begin 只创建 pending stream，不立刻写盘
- begin 在 `before = null` 时正确标记 `fileExistsBefore = false`
- full commit 写入最终内容
- partial commit 写入部分内容
- abort 不写盘且清理 pending stream

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/acp-operation-interceptor.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add electron/acp/operation-interceptor.ts tests/acp-operation-interceptor.test.ts
git commit -m "feat(acp): 新增 write stream 拦截与提交控制"
```

---

### Task 8: 修改 FileSystemRuntime 与 SessionManager，接入 ACK 提交流

**Files:**
- Modify: `electron/acp/fs-runtime.ts`
- Modify: `electron/acp/session.ts`
- Test: `tests/acp-fs-runtime.test.ts`

- [ ] **Step 1: 修改 FileSystemRuntime 构造函数**

将构造函数改为：

```typescript
constructor(
  private projectDir: string,
  private interceptor?: AgentOperationInterceptor,
) {}
```

- [ ] **Step 2: 让 `writeTextFile()` 等待提交结果，而不是立即写盘**

实现规则：
- 若没有 interceptor：保持现有同步写盘逻辑
- 若有 interceptor 且目标文件属于脚本工作台可编辑文件：
  1. 读取 `before`
  2. 调用 `beginWriteStream()`
  3. 返回一个 `await`，直到 `commitWriteStream()` 完成

- [ ] **Step 3: 显式修改 `SessionManager.connect()` 注入 interceptor**

当前 `SessionManager.connect()` 里是：

```typescript
this.fsRuntime = new FileSystemRuntime(projectDir);
```

必须改为显式接收 `interceptor` 参数或 setter，保证 Phase 3 真正接线。不要只在 `ipc.ts` 中创建实例。

- [ ] **Step 4: 更新测试**

在 `tests/acp-fs-runtime.test.ts` 中新增：
- 有 interceptor 时不会在 `writeTextFile()` 调用当下立刻写盘
- 触发 full / partial commit 后文件内容正确

- [ ] **Step 5: 运行测试**

Run: `npx vitest run tests/acp-fs-runtime.test.ts`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add electron/acp/fs-runtime.ts electron/acp/session.ts tests/acp-fs-runtime.test.ts
git commit -m "feat(acp): FileSystemRuntime 接入 ACK 提交流和 session 真实接线"
```

---

### Task 9: IPC 通道注册与 Preload / AgentAPI 桥接

**Files:**
- Modify: `electron/acp/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/lib/agent-api.ts`

- [ ] **Step 1: 在主进程注册写入流 IPC**

新增：
- `agent:write-stream-start`（Main → Renderer）
- `agent:write-stream-complete`（Main → Renderer）
- `agent:commit-write-stream`（Renderer → Main）

- [ ] **Step 2: 在 preload.ts 中暴露监听和 ACK API**

新增：

```typescript
onWriteStreamStart(handler: (payload: {
  streamId: string;
  filePath: string;
  frames: StreamingFrame[];
  operationType: 'generate' | 'rewrite' | 'custom';
  fileExistsBefore: boolean;
}) => void)
onWriteStreamComplete(handler: (payload: {
  streamId: string;
  filePath: string;
  commitMode: 'full' | 'partial' | 'abort';
}) => void)
commitWriteStream(streamId: string, mode: 'full' | 'partial' | 'abort', committedContent?: string)
```

- [ ] **Step 3: 在 `src/lib/agent-api.ts` 中更新类型声明**

注意：`AgentAPI` 类型定义不在 `src/lib/electron-api.ts`，而在 `src/lib/agent-api.ts`。这里必须改对文件。

- [ ] **Step 4: Commit**

```bash
git add electron/acp/ipc.ts electron/preload.ts src/lib/agent-api.ts
git commit -m "feat(ipc): 写入流 start/commit IPC 与 AgentAPI 桥接"
```

---

## Phase 4: UI 组件

### Task 10: AgentQuickActions — 快捷操作组件

**Files:**
- Create: `src/components/agent/AgentQuickActions.tsx`
- Modify: `src/components/agent/AgentSidebar.tsx`

- [ ] **Step 1: 实现 AgentQuickActions**

```tsx
// src/components/agent/AgentQuickActions.tsx
import { useScriptStore } from '../../store/script';
import { useAgentStore } from '../../store/agent';
import styles from './AgentQuickActions.module.css';

/** 根据文件状态自适应快捷操作按钮 */
export function AgentQuickActions() {
  const {
    workspaceFiles,
    annotations,
    reviewState,
    agentOperation,
    activeStream,
    startAgentOperation,
    setReviewState,
  } = useScriptStore();
  const { status, sidebarOpen } = useAgentStore();

  if (!sidebarOpen || status !== 'connected') return null;

  const hasActionableAnnotations = annotations.some(
    (a) => a.status === 'pending' && !a.stale,
  );
  const isOperating = agentOperation.isOperating;

  const sendAgentPrompt = (action: Extract<ActionDef, { kind: 'prompt' }>) => {
    if (isOperating) return;
    if (action.operationType === 'review') {
      setReviewState('pending');
    }
    startAgentOperation(action.operationType);
    window.agentAPI?.sendPrompt([{ type: 'text', text: action.prompt }]);
  };

  const actions = deriveActions({
    workspaceFiles,
    hasActionableAnnotations,
    reviewState,
    isOperating,
    activeStream,
  });

  return (
    <div className={styles.quickActions}>
      <div className={styles.label}>⚡ 快捷操作</div>
      <div className={styles.buttons}>
        {actions.map((action) => (
          <button
            key={action.id}
            className={`${styles.btn} ${action.primary ? styles.primary : ''}`}
            disabled={isOperating}
            onClick={() => {
              if (action.kind === 'ui') {
                action.run();
              } else {
                sendAgentPrompt(action);
              }
            }}
            title={action.tooltip}
          >
            {action.label}
          </button>
        ))}
        {isOperating && (
          <button
            className={styles.stopBtn}
            onClick={() => window.agentAPI?.cancelTurn()}
          >
            ⏹ 停止
          </button>
        )}
      </div>
    </div>
  );
}

interface BaseActionDef {
  id: string;
  label: string;
  primary?: boolean;
  tooltip: string;
}

type ActionDef =
  | (BaseActionDef & {
      kind: 'prompt';
      prompt: string;
      operationType: 'generate' | 'review' | 'rewrite' | 'custom';
    })
  | (BaseActionDef & { kind: 'ui'; run: () => void });

function deriveActions(ctx: {
  workspaceFiles: WorkspaceFilesState;
  hasActionableAnnotations: boolean;
  reviewState: ReviewState;
  isOperating: boolean;
  activeStream: ActiveStreamState;
}): ActionDef[] {
  if (!ctx.workspaceFiles.hasOriginalFile && !ctx.workspaceFiles.hasScriptFile) {
    return [
      { id: 'import', kind: 'ui', label: '📄 导入文稿', run: handleImportText, tooltip: '导入原始文稿', primary: true },
      { id: 'blank', kind: 'ui', label: '📝 新建空白', run: handleCreateBlank, tooltip: '创建空白 original.md' },
    ];
  }
  if (ctx.workspaceFiles.hasOriginalFile && !ctx.workspaceFiles.hasScriptFile) {
    return [
      { id: 'generate', kind: 'prompt', label: '✨ 生成口播稿', prompt: '请根据 original.md 生成口播稿，结果直接写入 script.md。若存在未结束的写入流，请等待本轮完成后再写入。', operationType: 'generate', primary: true, tooltip: '基于原稿生成口播稿' },
    ];
  }
  if (ctx.isOperating) {
    return [];
  }
  if (ctx.workspaceFiles.hasScriptFile && ctx.activeStream.phase === 'stopped') {
    return [
      { id: 'continue', kind: 'ui', label: '继续编辑', run: focusScriptEditor, primary: true, tooltip: '保留已提交内容并继续手动编辑' },
      { id: 'regenerate', kind: 'prompt', label: '重新生成', prompt: '请重新生成 script.md 口播稿，覆盖当前内容。', operationType: 'rewrite', tooltip: '重新生成口播稿' },
      { id: 're-review', kind: 'prompt', label: '重新审查', prompt: '请重新审查 script.md。不要写文件，只在最终回复中输出一个 `script-review` 代码块，内容为合法 ReviewPayload JSON。', operationType: 'review', tooltip: '重新审查' },
    ];
  }
  if (ctx.workspaceFiles.hasScriptFile && ctx.reviewState === 'idle') {
    return [
      { id: 'review', kind: 'prompt', label: '🔍 AI 审查', prompt: '请审查 script.md。不要改写 script.md，也不要写文件。请只在最终回复中输出一个 `script-review` 代码块，内容为合法 ReviewPayload JSON。', operationType: 'review', primary: true, tooltip: 'AI 审查口播稿' },
      { id: 'regenerate', kind: 'prompt', label: '重新生成', prompt: '请重新生成 script.md 口播稿，覆盖当前内容。', operationType: 'rewrite', tooltip: '重新生成口播稿' },
    ];
  }
  if (ctx.hasActionableAnnotations && ctx.reviewState === 'issues') {
    return [
      { id: 'accept-all', kind: 'ui', label: '✅ 全部接受', run: acceptAllAnnotations, primary: true, tooltip: '接受所有建议' },
      { id: 're-review', kind: 'prompt', label: '重新审查', prompt: '请重新审查 script.md。不要写文件，只在最终回复中输出一个 `script-review` 代码块，内容为合法 ReviewPayload JSON。', operationType: 'review', tooltip: '重新审查' },
    ];
  }
  if (ctx.reviewState === 'stale') {
    return [
      { id: 're-review', kind: 'prompt', label: '重新审查', prompt: '请重新审查 script.md。不要写文件，只在最终回复中输出一个 `script-review` 代码块，内容为合法 ReviewPayload JSON。', operationType: 'review', primary: true, tooltip: '重新审查' },
      { id: 'regenerate', kind: 'prompt', label: '重新生成', prompt: '请重新生成 script.md 口播稿，覆盖当前内容。', operationType: 'rewrite', tooltip: '重新生成' },
    ];
  }
  return [
    { id: 'copy', kind: 'ui', label: '📋 复制口播稿', run: copyScriptText, tooltip: '复制口播稿内容', primary: true },
    { id: 'regenerate', kind: 'prompt', label: '重新生成', prompt: '请重新生成 script.md 口播稿，覆盖当前内容。', operationType: 'rewrite', tooltip: '重新生成' },
    { id: 're-review', kind: 'prompt', label: '重新审查', prompt: '请重新审查 script.md。不要写文件，只在最终回复中输出一个 `script-review` 代码块，内容为合法 ReviewPayload JSON。', operationType: 'review', tooltip: '重新审查' },
  ];
}
```

实现要求补充：
- `handleImportText`、`handleCreateBlank`、`acceptAllAnnotations`、`copyScriptText` 由父层注入或本地 hooks 提供，不允许空 prompt 占位。
- `focusScriptEditor` 需要在 interrupted 场景下把焦点切回 `ScriptEditor`，不经过 Agent。
- QuickActions 的状态判断必须依赖 `workspaceFiles + reviewState`，不能再用文本长度。
- `全部接受` 只允许处理 `pending && !stale` 的标注；`reviewState = stale` 时必须隐藏该按钮。

- [ ] **Step 2: 创建样式文件**

```css
/* src/components/agent/AgentQuickActions.module.css */
.quickActions {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #333);
  background: var(--bg-secondary, #1a2a3a);
}
.label {
  font-size: 11px;
  color: var(--text-tertiary, #7fb8e0);
  margin-bottom: 6px;
}
.buttons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.btn {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  border: none;
  cursor: pointer;
  background: var(--bg-tertiary, #2a2a4e);
  color: var(--text-secondary, #aaa);
  transition: opacity 0.15s;
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.primary {
  background: var(--accent-primary, #3498db);
  color: #fff;
}
.stopBtn {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  border: 1px solid #e74c3c;
  cursor: pointer;
  background: transparent;
  color: #e74c3c;
}
```

- [ ] **Step 3: 将 AgentQuickActions 插入 AgentSidebar**

修改 `src/components/agent/AgentSidebar.tsx`（line 158），在 `<AgentHeader />` 之后插入：

```tsx
import { AgentQuickActions } from './AgentQuickActions';

// 在 JSX 中（line 158-159 之间）：
<AgentHeader />
<AgentQuickActions />
<MessageList />
```

- [ ] **Step 4: Commit**

```bash
git add src/components/agent/AgentQuickActions.tsx src/components/agent/AgentQuickActions.module.css src/components/agent/AgentSidebar.tsx
git commit -m "feat(agent): AgentQuickActions 快捷操作组件"
```

---

### Task 11: AnnotationCard — Grammarly 式悬浮操作卡片

**Files:**
- Create: `src/components/script/AnnotationCard.tsx`
- Create: `src/components/script/AnnotationCard.module.css`

- [ ] **Step 1: 实现 AnnotationCard**

```tsx
// src/components/script/AnnotationCard.tsx
import type { Annotation } from '../../store/script';
import styles from './AnnotationCard.module.css';

const SEVERITY_CONFIG = {
  error:   { icon: '🔴', label: '错误', color: '#e74c3c' },
  warning: { icon: '🟡', label: '警告', color: '#e67e22' },
  info:    { icon: '🔵', label: '建议', color: '#3498db' },
} as const;

interface AnnotationCardProps {
  annotation: Annotation;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onAIRewrite: (id: string) => void;
  style?: React.CSSProperties;
}

export function AnnotationCard({
  annotation,
  onAccept,
  onDismiss,
  onAIRewrite,
  style,
}: AnnotationCardProps) {
  const config = SEVERITY_CONFIG[annotation.severity];

  return (
    <div className={styles.card} style={style}>
      <div className={styles.header} style={{ color: config.color }}>
        <span>{config.icon}</span>
        <span className={styles.title}>{annotation.issue}</span>
      </div>

      {annotation.suggestion && (
        <div className={styles.suggestion}>
          <span className={styles.suggestionIcon}>💡</span>
          <span>{annotation.suggestion}</span>
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.acceptBtn}
          onClick={() => onAccept(annotation.id)}
        >
          ✓ 接受建议
        </button>
        <button
          className={styles.dismissBtn}
          onClick={() => onDismiss(annotation.id)}
        >
          忽略
        </button>
        <button
          className={styles.rewriteBtn}
          onClick={() => onAIRewrite(annotation.id)}
        >
          AI 重写
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建样式文件**

```css
/* src/components/script/AnnotationCard.module.css */
.card {
  background: var(--bg-secondary, #2a2a4e);
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  padding: 10px;
  max-width: 340px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 100;
}
.header {
  font-weight: bold;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.title { flex: 1; }
.suggestion {
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--bg-tertiary, #1a2a3a);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-secondary, #7fb8e0);
  display: flex;
  gap: 4px;
}
.suggestionIcon { flex-shrink: 0; }
.actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.actions button {
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 11px;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
}
.acceptBtn {
  background: #2ecc71;
  color: #fff;
}
.dismissBtn {
  background: var(--bg-tertiary, #555);
  color: var(--text-secondary, #aaa);
}
.rewriteBtn {
  background: #3498db;
  color: #fff;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/script/AnnotationCard.tsx src/components/script/AnnotationCard.module.css
git commit -m "feat(script): AnnotationCard Grammarly 式悬浮操作卡片"
```

---

### Task 12: AgentProgressBar — 操作进度指示

**Files:**
- Create: `src/components/agent/AgentProgressBar.tsx`
- Create: `src/components/agent/AgentProgressBar.module.css`

- [ ] **Step 1: 实现 AgentProgressBar**

```tsx
// src/components/agent/AgentProgressBar.tsx
import { useScriptStore } from '../../store/script';
import styles from './AgentProgressBar.module.css';

const OP_LABELS: Record<string, string> = {
  generate: '生成中',
  review: '审查中',
  rewrite: '重写中',
  custom: '处理中',
};

export function AgentProgressBar() {
  const { agentOperation } = useScriptStore();

  if (!agentOperation.isOperating) return null;

  const label = OP_LABELS[agentOperation.operationType ?? 'custom'] ?? '处理中';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.icon}>🤖</span>
        <span className={styles.label}>{label}</span>
        <span className={styles.percent}>{agentOperation.progress}%</span>
      </div>
      <div className={styles.track}>
        <div
          className={styles.bar}
          style={{ width: `${agentOperation.progress}%` }}
        />
      </div>
      {agentOperation.canInterrupt && (
        <button
          className={styles.stopBtn}
          onClick={() => window.agentAPI?.cancelTurn()}
        >
          ⏹ 停止
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建样式文件**

```css
/* src/components/agent/AgentProgressBar.module.css */
.container {
  padding: 8px 12px;
  background: rgba(124, 58, 237, 0.1);
  border: 1px solid rgba(124, 58, 237, 0.25);
  border-radius: 6px;
  margin: 8px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.icon { font-size: 12px; }
.label {
  font-size: 11px;
  font-weight: bold;
  color: #a78bfa;
  flex: 1;
}
.percent {
  font-size: 10px;
  color: #888;
}
.track {
  height: 4px;
  background: #333;
  border-radius: 3px;
  overflow: hidden;
}
.bar {
  height: 100%;
  background: #7c3aed;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.stopBtn {
  margin-top: 6px;
  padding: 2px 8px;
  border: 1px solid #e74c3c;
  border-radius: 4px;
  background: transparent;
  color: #e74c3c;
  font-size: 10px;
  cursor: pointer;
  width: 100%;
}
```

- [ ] **Step 3: 将 AgentProgressBar 插入 AgentSidebar**

在 `AgentSidebar.tsx` 的 `<AgentQuickActions />` 之后、`<MessageList />` 之前插入：

```tsx
import { AgentProgressBar } from './AgentProgressBar';

<AgentQuickActions />
<AgentProgressBar />
<MessageList />
```

- [ ] **Step 4: Commit**

```bash
git add src/components/agent/AgentProgressBar.tsx src/components/agent/AgentProgressBar.module.css src/components/agent/AgentSidebar.tsx
git commit -m "feat(agent): AgentProgressBar 操作进度指示"
```

---

## Phase 5: 集成与清理

### Task 13: 移除旧 Step 组件

**Files:**
- Delete: `src/components/script/StepIndicator.tsx`
- Delete: `src/components/script/StepReviewOriginal.tsx`
- Delete: `src/components/script/StepGenerate.tsx`
- Delete: `src/components/script/StepAIReview.tsx`
- Delete: `src/components/script/StepConfirm.tsx`
- Delete: `src/components/script/StepDrawer.tsx`
- Modify: `src/components/script/OperationBar.tsx`

- [ ] **Step 1: 删除旧 Step 组件文件**

```bash
rm src/components/script/StepIndicator.tsx
rm src/components/script/StepReviewOriginal.tsx
rm src/components/script/StepGenerate.tsx
rm src/components/script/StepAIReview.tsx
rm src/components/script/StepConfirm.tsx
rm src/components/script/StepDrawer.tsx
```

- [ ] **Step 2: 简化 OperationBar**

`src/components/script/OperationBar.tsx` 大幅简化：

1. 移除 Props：`currentStep`、`onPrev`、`onNext`、`onStepClick`、`canGoNext`、`onOpenTemplateDrawer`、`onOpenAnnotationsDrawer`、`generating`、`reviewing`
2. 移除 `StepIndicator` 引用
3. 移除步骤条渲染
4. 移除上一步/下一步按钮
5. 保留：`onBack`、`onSave`、统计信息展示

简化后的 OperationBar 仅包含：
- 返回按钮
- 文件统计信息（字数、标注数）
- 保存按钮

```tsx
interface OperationBarProps {
  originalStats: OriginalStats;
  scriptStats: GeneratedScriptStats;
  annotationSummary: AnnotationSummary;
  onBack: () => void;
  onSave: () => void;
}
```

- [ ] **Step 3: 运行 TypeScript 类型检查确认无断引用**

```bash
npx tsc --noEmit 2>&1 | head -40
```

修复所有由移除引起的类型错误。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(script): 移除旧 Step 组件和步骤导航逻辑"
```

---

### Task 14: ScriptWorkbench 重构 — 接入 Agent 操作流

**Files:**
- Modify: `src/pages/ScriptWorkbench.tsx`
- Modify: `src/pages/ScriptWorkbench.module.css`

- [ ] **Step 1: 移除步骤相关代码**

在 `ScriptWorkbench.tsx` 中：

1. 从 store destructuring 中移除：`currentStep`、`setCurrentStep`、`drawerVisible`、`drawerContent`、`openDrawer`、`closeDrawer`
2. 移除函数：`handlePreviousStep`（lines 447-464）、`handleNextStep`（lines 466-483）、`handleStepClick`（lines 485-492）
3. 移除 `normalizePersistedStep` 和 `getPreferredOpenFile` 辅助函数
4. 移除 `StepDrawer` 组件引用和渲染
5. 用 `workspaceFiles + reviewState` 取代 `normalizePersistedStep` / `getPreferredOpenFile`

- [ ] **Step 2: 新增 write stream 事件监听和 ACK 提交**

在 `ScriptWorkbench` 内部新增：
- 从 store 额外解构：`setActiveStream`、`setAgentOperation`、`startAgentOperation`、`stopAgentOperation`、`clearActiveStream`、`bumpScriptDocVersion`

```tsx
const editorViewRef = useRef<EditorView | null>(null);
const streamingRef = useRef<StreamingEditor | null>(null);

useEffect(() => {
  const offStart = window.agentAPI?.onWriteStreamStart((data) => {
    setOpenedFile(data.filePath);
    setActiveStream({
      streamId: data.streamId,
      filePath: data.filePath,
      phase: 'playing',
    });
    startAgentOperation(data.operationType);

    if (!editorViewRef.current) {
      void window.agentAPI.commitWriteStream(data.streamId, 'abort');
      stopAgentOperation();
      return;
    }
    const controller = new StreamingEditor(editorViewRef.current, {
      onProgress: (percent) => setAgentOperation({ progress: percent }),
      onComplete: async () => {
        setActiveStream({ phase: 'awaiting_commit' });
        await window.agentAPI.commitWriteStream(data.streamId, 'full');
      },
      onStopped: async (committedContent) => {
        setActiveStream({ phase: 'stopped' });
        await window.agentAPI.commitWriteStream(
          data.streamId,
          'partial',
          committedContent,
        );
      },
    });
    streamingRef.current = controller;
    controller.start(data.frames);
  });

  const offComplete = window.agentAPI?.onWriteStreamComplete((result) => {
    stopAgentOperation({ resetStream: result.commitMode !== 'partial' });
    if (result.commitMode !== 'partial') {
      clearActiveStream();
    }
    if (result.filePath.endsWith('script.md') && result.commitMode !== 'abort') {
      bumpScriptDocVersion();
    }
    void refreshFileTree(projectDir!);
  });

  return () => {
    offStart?.();
    offComplete?.();
  };
}, [projectDir]);
```

- [ ] **Step 3: 新增 ReviewPayload 解析和本地回放**

在 `ScriptWorkbench` 中监听 Agent 对话完成后的最后一条 assistant message：
- 从 store 额外解构：`setReviewState`、`stopAgentOperation`、`setAgentOperation`

```tsx
const messages = useAgentStore((s) => s.messages);

useEffect(() => {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return;
  if (useScriptStore.getState().agentOperation.operationType !== 'review') return;

  const combinedText = last.blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const payload = parseReviewPayload(combinedText);
  if (!payload) {
    stopAgentOperation();
    setReviewState('idle');
    return;
  }

  if (payload.docVersion !== useScriptStore.getState().scriptDocVersion) {
    useScriptStore.getState().markReviewStale();
    stopAgentOperation();
    return;
  }

  if (!editorViewRef.current) {
    stopAgentOperation();
    setReviewState('idle');
    return;
  }

  const controller = new ReviewPlaybackController(
    editorViewRef.current,
    (finding) => appendReviewFinding(finding),
    {
      onProgress: (percent) => setAgentOperation({ progress: percent }),
      onComplete: () => {
        setReviewState(payload.findings.length > 0 ? 'issues' : 'clean');
        stopAgentOperation();
      },
    },
  );

  startAgentOperation('review');
  controller.start(payload);
}, [messages]);
```

补充实现约束：
1. `onWriteStreamStart` 的 payload 必须使用 Task 9 中新增的 `operationType + fileExistsBefore`。
2. 如果 `editorViewRef.current` 尚未就绪，必须显式 `abort` 当前 stream，不能直接 `return` 导致主进程永久等待 ACK。
3. `onWriteStreamComplete` 必须根据 `commitMode` 区分：
   - `full`：清空 `activeStream`，刷新文件树
   - `partial`：保留 `activeStream.phase = 'stopped'`，供 QuickActions 渲染 interrupted 状态
   - `abort`：清空 `activeStream`，移除可能存在的 ephemeral node
4. 对 `script.md` 的 `full / partial` commit 完成后，必须 bump `scriptDocVersion`。
5. 审查消息若未解析出合法 `ReviewPayload`，或回放时编辑器尚未就绪，必须结束 review operation 并回退为 `reviewState = idle`，不能让界面永久停留在“审查中”。

- [ ] **Step 4: 更新 hydrateProjectDirectory**

加载项目时：
- 从磁盘文件推导 `workspaceFiles`
- 从 v2 状态中读取 `reviewState`
- `openedFile` 的优先级改为：`script.md` 存在则开 `script.md`，否则开 `original.md`

- [ ] **Step 5: 新增只读状态指示**

在编辑器区域上方，当 `editorAgent.readOnly` 为 true 时显示状态条：

```tsx
{editorAgent.readOnly && (
  <div className={styles.agentTypingIndicator}>
    🤖 Agent 正在输入...
  </div>
)}
```

- [ ] **Step 6: 更新 CSS**

在 `ScriptWorkbench.module.css` 中：
1. 移除步骤相关样式
2. 新增 `.agentTypingIndicator` 样式：

```css
.agentTypingIndicator {
  position: absolute;
  top: 8px;
  right: 12px;
  background: rgba(124, 58, 237, 0.2);
  border: 1px solid rgba(124, 58, 237, 0.4);
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 11px;
  color: #a78bfa;
  z-index: 10;
  pointer-events: none;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/ScriptWorkbench.tsx src/pages/ScriptWorkbench.module.css
git commit -m "refactor(workbench): 移除步骤流程，接入 Agent 流式编辑事件流"
```

---

### Task 15: ScriptEditor 集成虚拟光标和只读锁

**Files:**
- Modify: `src/ui/components/script-editor.tsx`

- [ ] **Step 1: 新增 props**

在 `ScriptEditorProps` 中新增：

```typescript
interface ScriptEditorProps {
  // ...existing props
  readOnly?: boolean;
  editorViewRef?: React.MutableRefObject<EditorView | null>;
}
```

- [ ] **Step 2: 明确边界：扩展装配全部留在 `ScriptEditor` 内部**

不要再从父组件传 `virtualCursorExtension` 或 `readOnlyGuard` 实例。父组件只传：
- `readOnly`
- `editorViewRef`
- `onAIRewrite`
- `annotations`

- [ ] **Step 3: 集成虚拟光标扩展**

在 CodeMirror `extensions` 数组（line 198-213）中新增：

```typescript
import { virtualCursorExtension } from '../../lib/virtual-cursor';
import { createReadOnlyGuard } from '../../lib/editor-readonly-guard';

// 在组件内：
const readOnlyGuard = useRef(createReadOnlyGuard());

// extensions 数组中添加：
...virtualCursorExtension,
readOnlyGuard.current.extension,
```

- [ ] **Step 4: 只读状态同步**

新增 effect 响应 `readOnly` prop 变化：

```typescript
useEffect(() => {
  if (viewRef.current) {
    viewRef.current.dispatch({
      effects: readOnlyGuard.current.reconfigure(readOnly ?? false),
    });
  }
}, [readOnly]);
```

- [ ] **Step 5: 暴露 EditorView ref**

在 EditorView 创建后，同步到外部 ref：

```typescript
useEffect(() => {
  // 创建 EditorView 后...
  if (editorViewRef) {
    editorViewRef.current = view;
  }
  viewRef.current = view;
  // ...
}, []);
```

- [ ] **Step 6: 添加输入拦截提示**

为了匹配 spec 中“尝试输入时显示提示”，新增外层 keydown 捕获：

```typescript
EditorView.domEventHandlers({
  keydown: (event) => {
    if (!readOnly) return false;
    showReadonlyHint();
    event.preventDefault();
    return true;
  },
})
```

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/script-editor.tsx
git commit -m "feat(editor): ScriptEditor 集成虚拟光标和只读锁"
```

---

### Task 16: AnnotationCard 集成到编辑器

**Files:**
- Modify: `src/ui/components/script-editor.tsx` (或相关的 annotation 模块)

- [ ] **Step 1: 替换现有 AnnotationPopover**

将现有的 `AnnotationPopover`（script-editor.tsx lines 33-162）替换为新的 `AnnotationCard`：

1. 在点击标注高亮时，弹出 `AnnotationCard` 而非旧的 popover
2. 新增 `onAIRewrite` 回调 prop：

```typescript
interface ScriptEditorProps {
  // ...existing
  onAIRewrite?: (annotationId: string) => void;
}
```

3. 在 `onAIRewrite` 被调用时，向 Agent 发送指令：

```typescript
const handleAIRewrite = (id: string) => {
  const annotation = annotations?.find((a) => a.id === id);
  if (annotation) {
    window.agentAPI?.sendPrompt([{
      type: 'text',
      text: `请重写 script.md 中 docVersion=${annotation.docVersion} 的以下内容：「${annotation.quotedText}」。问题：${annotation.issue}。结果直接写回 script.md。`,
    }]);
  }
};
```

4. 接受建议时，不要用 `scriptText.replace(annotation.originalText, ...)` 这种全局替换；必须按 `startOffset/endOffset` 倒序应用，并校验 `quotedText`。

- [ ] **Step 2: Commit**

```bash
git add src/ui/components/script-editor.tsx src/components/script/AnnotationCard.tsx
git commit -m "feat(editor): 集成 AnnotationCard 替换旧 popover"
```

---

### Task 17: FileTreePanel 文件创建动画

**Files:**
- Modify: `src/components/script/FileTreePanel.tsx`
- Modify: `src/components/script/FileTreePanel.module.css`

- [ ] **Step 1: 基于 `activeStream` 注入 ephemeral node，而不是做 `fileEntries` 差分**

在 `FileTreePanel` 中不要再用“比较前后 `fileEntries`”来推断新增文件。改为直接读取 `useScriptStore().activeStream`，在目标文件还未真正落盘时注入一个仅用于展示的临时节点：

```tsx
type DisplayFileEntry = FileEntry & {
  ephemeral?: boolean;
  statusLabel?: string;
};

const activeStream = useScriptStore((s) => s.activeStream);

const displayEntries = useMemo<DisplayFileEntry[]>(() => {
  const targetPath = activeStream.filePath;
  if (!targetPath || activeStream.phase === 'idle') {
    return fileEntries;
  }
  const alreadyExists = fileEntries.some((entry) => entry.path === targetPath);
  if (alreadyExists) {
    return fileEntries;
  }

  return [
    ...fileEntries,
    {
      name: targetPath.split('/').pop() ?? targetPath,
      path: targetPath,
      type: 'file',
      ephemeral: true,
      statusLabel: activeStream.phase === 'stopped' ? '已中断' : '创建中...',
    },
  ];
}, [fileEntries, activeStream]);
```

- [ ] **Step 2: 在 TreeNode 中区分真实文件节点和 ephemeral node**

在文件节点渲染中：
- `entry.ephemeral === true` 时使用虚线边框和弱高亮底色
- `statusLabel = 创建中... / 已中断` 时渲染右侧状态文案
- 真正刷新出磁盘文件后，临时节点自然消失，真实节点接管位置
- 遍历数据源从 `fileEntries` 改为 `displayEntries`

```tsx
<div
  className={`${styles.fileItem} ${entry.ephemeral ? styles.fileEphemeral : ''}`}
>
  <span>{entry.name}</span>
  {entry.statusLabel ? (
    <span className={styles.fileStatus}>{entry.statusLabel}</span>
  ) : null}
</div>
```

- [ ] **Step 3: CSS 动画与临时状态样式**

在 `FileTreePanel.module.css` 中新增：

```css
.fileEphemeral {
  animation: fileAppear 0.5s ease-out;
  border: 1px dashed rgba(46, 204, 113, 0.4);
  background: rgba(46, 204, 113, 0.08);
}
.fileStatus {
  margin-left: auto;
  font-size: 10px;
  color: rgba(127, 184, 224, 0.85);
}
@keyframes fileAppear {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/script/FileTreePanel.tsx src/components/script/FileTreePanel.module.css
git commit -m "feat(file-tree): 新增文件出现动画"
```

---

### Task 18: 更新测试 & 最终验证

**Files:**
- Modify: `tests/script-workbench.test.tsx`
- Modify: `tests/script-shell-components.test.tsx`

- [ ] **Step 1: 更新 ScriptWorkbench 测试**

修改 `tests/script-workbench.test.tsx`：
1. 移除所有引用 `currentStep`、`StepIndicator`、`handleNextStep`、`handlePreviousStep` 的测试
2. 移除引用 `StepDrawer`、`StepGenerate`、`StepAIReview`、`StepConfirm` 的测试
3. 新增 `onWriteStreamStart → commitWriteStream('full')` 的链路测试
4. 新增 `StreamingEditor.onStopped → commitWriteStream('partial')` 的链路测试
5. 新增 review assistant message 解析成功后进入 `issues / clean` 的测试
6. 新增 review assistant message 缺少合法 payload 时会正确退出 review operation 的测试
7. 新增 `docVersion` 不匹配时标注转 `stale` 的测试

- [ ] **Step 2: 更新 shell 组件测试**

修改 `tests/script-shell-components.test.tsx`：
1. 移除引用已删除组件的测试
2. 新增 `AgentQuickActions` 渲染测试
3. 新增 `AgentProgressBar` 渲染测试
4. 新增 `reviewState = stale` 时只显示「重新审查 / 重新生成」的测试
5. 新增 `activeStream.phase = 'stopped'` 时显示「继续编辑」的测试
6. 新增 FileTreePanel 对 `ephemeral node` 的渲染测试

- [ ] **Step 3: 运行全部测试**

```bash
npx vitest run
```
Expected: All tests pass

- [ ] **Step 4: 运行 TypeScript 类型检查**

```bash
npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 5: 运行 lint**

```bash
npx eslint src/ --ext .ts,.tsx
```
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test: 适配 Agent 驱动重构更新测试"
```

---

### Task 19: Agent 侧边栏自动展开与上下文提示

**Files:**
- Modify: `src/components/agent/AgentSidebar.tsx`
- Modify: `src/pages/ScriptWorkbench.tsx`

- [ ] **Step 1: 导入文稿后自动展开 Agent 侧边栏**

在 `ScriptWorkbench.tsx` 的导入/创建文件处理中，添加自动展开逻辑：

```typescript
const { setSidebarOpen } = useAgentStore();

// 在导入文稿成功后：
setSidebarOpen(true);
```

- [ ] **Step 2: Agent 连接后发送上下文提示**

在 `AgentSidebar.tsx` 的 auto-connect hook 中，连接成功后发送初始上下文消息（作为 system-level 提示，不显示在对话中）。

在 `AgentSidebar.tsx` 中，当检测到 `workspaceFiles.hasOriginalFile === true` 且 Agent 对话为空时，自动显示引导文本：

```typescript
if (messages.length === 0 && workspaceFiles.hasOriginalFile) {
  // 显示引导消息
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/agent/AgentSidebar.tsx src/pages/ScriptWorkbench.tsx
git commit -m "feat(agent): 导入文稿后自动展开侧边栏并显示引导"
```

---

### Task 20: 最终集成验证

- [ ] **Step 1: 全量构建验证**

```bash
npm run build
```
Expected: Build succeeds with no errors

- [ ] **Step 2: 手动冒烟测试清单**

以下场景需要手动验证：

1. **空白状态**：打开工作台 → 看到 EmptyGuide → 选择目录 → Agent 侧边栏展开
2. **导入原稿**：导入文本文件 → original.md 出现在文件树 → Agent 快捷按钮显示「生成口播稿」
3. **生成口播稿**：点击「生成口播稿」→ 虚拟光标出现 → 文件树先出现 `script.md / 创建中...` 临时节点 → full commit 后转为真实文件节点
4. **打断生成**：Agent 工作时点击停止 → 触发 partial commit → 已写内容保留 → 快捷按钮显示「继续编辑 / 重新生成 / 重新审查」
5. **AI 审查**：点击「AI 审查」→ 编辑器只读 → assistant 最终回复返回 `script-review` 代码块 → 虚拟光标扫描 → 标注出现 → 点击标注弹出操作卡片
6. **审查格式异常兜底**：故意让 Agent 返回非 `ReviewPayload` 文本 → UI 不得永久停留在“审查中”
7. **接受建议**：点击「接受建议」→ 文字替换 → 标注消失 → `scriptDocVersion` 增长
8. **stale 标注**：审查完成后手动改动正文 → 原标注转为 stale → 快捷按钮只保留「重新审查 / 重新生成」
9. **AI 重写**：点击「AI 重写」→ Agent 接收指令 → 虚拟光标定位重写 → 完成后旧标注失效
10. **持久化**：关闭应用重新打开 → 状态正确恢复（v2 格式，含 `reviewState + lastReviewedDocVersion`）
11. **v1 兼容**：用旧格式的 script-state.json 打开 → 正确迁移到 v2

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "feat(script-workbench): Agent 驱动重构完成 — 虚拟光标流式编辑"
```

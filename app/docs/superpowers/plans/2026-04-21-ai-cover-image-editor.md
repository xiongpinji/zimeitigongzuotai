# AI 封面图编辑器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 生成的封面图追加可视化编辑能力（裁剪、比例、文字、调色、滤镜、变换、撤销/重做 + 双模式保存），技术栈 Fabric.js + 自研 UI。

**Architecture:** 三层解耦 —— (1) Electron 主进程扩展 IPC（`save-cover-edit` / `list-system-fonts`）负责文件读写与系统字体列表；(2) 业务数据层扩展 `CoverCandidate` 与新增 `CoverEditState`，通过 `fabric-bridge` 与 Fabric JSON 双向序列化；(3) UI 层使用自研 React 组件（Modal + ToolRail + Canvas + Inspector + FilterPanel + FontPicker）调用 Fabric Canvas，复用 `src/ui/components` 保持 darwin-ui 视觉一致。

**Tech Stack:** Fabric.js 6.x、React 19、Zustand、Electron 41、Vitest、font-list（仅主进程）、darwin-ui tokens。

**设计文档：** `docs/superpowers/specs/2026-04-21-ai-cover-image-editor-design.md`

---

## 任务拓扑与并行分组

```
Phase 0 (串行起点):  Task 1 [依赖 + 契约]
                         │
         ┌───────────────┼───────────────┐
         │               │               │
Phase 1 (并行组 A):  Task 2        Task 3        Task 4
                  [类型+Store] [主进程 IPC]  [序列化+滤镜]
         │               │               │
         └───────────────┼───────────────┘
                         │
Phase 2 (并行组 B):  Task 5        Task 6        Task 7
                 [FabricCanvas] [子 UI 组件] [字体 FontPicker]
         │               │               │
         └───────────────┼───────────────┘
                         │
Phase 3 (串行收尾): Task 8 [Modal 组装] → Task 9 [接入 AICoverPanel] → Task 10 [回归测试 + 打磨]
```

### 并行分组明细

**Phase 0：Task 1** 必须先完成（锁定依赖、接口契约）。

**Phase 1（三路并行）：**

| 任务 | scope_write | scope_read | 冲突面 |
|---|---|---|---|
| Task 2 类型+Store | `src/types/ai.ts`（只追加）、`src/store/ai.ts`（只追加 actions） | `src/types/ai.ts` 现状 | 与 Task 4 共享 `CoverEditState` 类型定义，Task 1 已固化在文档，Task 4 只读取 |
| Task 3 主进程 IPC | `electron/cover-editor-io.ts`（新）、`electron/system-fonts.ts`（新）、`electron/main.ts`（追加 handler，无删除） | `electron/project-file.ts`、`src/types/ai.ts` | 与 Task 2 通过 `CoverEditState` 类型契约对齐；main.ts 不与其他并行任务冲突 |
| Task 4 序列化+滤镜库 | `src/lib/cover-editor/cover-edit-state.ts`（新）、`src/lib/cover-editor/filters.ts`（新）、`src/lib/cover-editor/aspect-ratios.ts`（新） | Task 1 锁定的类型契约 | 纯 lib，无冲突 |

**Phase 2（三路并行，依赖 Phase 1 全部完成）：**

| 任务 | scope_write | scope_read | 冲突面 |
|---|---|---|---|
| Task 5 Fabric 画布核心 | `src/lib/cover-editor/fabric-bridge.ts`（新）、`src/components/cover-editor/CoverEditorCanvas.tsx`（新） | Task 4 的 lib | 纯新增，不冲突 |
| Task 6 子 UI 组件 | `src/components/cover-editor/ToolRail.tsx`、`Inspector.tsx`、`FilterPanel.tsx`（均新） | Task 4 的 lib、`src/ui/components` | 纯新增，不冲突 |
| Task 7 字体 | `src/lib/cover-editor/system-fonts.ts`（新）、`src/components/cover-editor/FontPicker.tsx`（新）、`electron/preload.ts`（追加一行）、`src/lib/electron-api.ts`（追加类型） | Task 3 IPC | preload.ts / electron-api.ts 仅**追加**不修改既有条目，与 Task 3 错峰 |

> ⚠️ **preload.ts / electron-api.ts 两文件由 Task 3 与 Task 7 分别追加不同条目**。由 Task 3 先加 `saveCoverEdit`，Task 7 再加 `listSystemFonts`。如果派子代理并行，需强制 Task 3 先于 Task 7 提交（由调度器保证顺序）。

**Phase 3（串行）：**

| 任务 | 原因 |
|---|---|
| Task 8 Modal 组装 | 必须在 Task 5/6/7 完成后拼装 |
| Task 9 接入 AICoverPanel | 改既有文件，必须在 Modal 完成后 |
| Task 10 回归测试 | 全链路测试 + UI 打磨 |

---

## Task 1：锁定依赖与接口契约（Phase 0，串行）

**目标：** 安装 Fabric / font-list 依赖，固化共享类型与 IPC 契约，保证 Phase 1 并行子任务对齐。

**Files:**
- Modify: `package.json`（新增 `fabric`、`font-list`、`@types/fabric` 可选）
- Create: `src/lib/cover-editor/contracts.ts`（共享契约，供所有子任务 import）

- [ ] **Step 1：安装运行时依赖**

```bash
npm install fabric@^6.5.1 font-list@^1.5.1
```

- [ ] **Step 2：验证依赖安装**

Run: `npm ls fabric font-list`
Expected: 两个包均出现，版本分别为 ^6.5.1 与 ^1.5.1。

- [ ] **Step 3：创建共享契约文件**

Create `src/lib/cover-editor/contracts.ts`:

```typescript
/** 共享契约：Phase 1 所有并行子任务的对齐点。锁定后请勿随意修改，否则需要全部 Phase 1 任务重基。 */

/** 比例预设标识 */
export type AspectRatioPreset = '16:9' | '9:16' | '1:1' | '4:3' | '4:5' | 'free' | 'timeline';

/** 滤镜预设标识 */
export type FilterPreset = 'none' | 'bw' | 'vivid' | 'vintage' | 'cool' | 'warm';

/** 文字图层 */
export interface CoverTextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };
  align?: 'left' | 'center' | 'right';
  rotation?: number;
}

/** 封面编辑状态（持久化到 project.json） */
export interface CoverEditState {
  version: 1;
  aspectRatio?: AspectRatioPreset;
  crop?: { x: number; y: number; width: number; height: number };
  textOverlays?: CoverTextOverlay[];
  filters?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    preset?: FilterPreset;
  };
  transform?: {
    rotate?: number;
    flipX?: boolean;
    flipY?: boolean;
  };
}

/** 保存模式 */
export type CoverSaveMode = 'append' | 'overwrite';

/** save-cover-edit IPC 参数 */
export interface SaveCoverEditArgs {
  projectDir: string;
  sourceCandidateId: string;
  sourceImageUrl: string;
  sourcePrompt: string;
  dataUrl: string;
  edits: CoverEditState;
  mode: CoverSaveMode;
}

/** save-cover-edit IPC 返回 */
export interface SaveCoverEditResult {
  candidateId: string;
  imageUrl: string;
  editedFrom?: string;
  replacedId?: string;
  createdAt: number;
}

/** list-system-fonts IPC 返回 */
export interface SystemFont {
  family: string;
}
export interface ListSystemFontsResult {
  fonts: SystemFont[];
}
```

- [ ] **Step 4：验证契约文件编译通过**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误（可能存在仓库既有遗留错误，但不应包含 `src/lib/cover-editor/contracts.ts` 相关）。

- [ ] **Step 5：提交**

```bash
git add package.json package-lock.json src/lib/cover-editor/contracts.ts
git commit -m "chore(cover-editor): 引入 fabric/font-list 依赖并锁定封面编辑契约"
```

---

## Task 2：扩展 CoverCandidate 类型与 AIStore actions（Phase 1，并行 A）

**目标：** 在 `CoverCandidate` 追加 `editedFrom` / `edits` / `createdAt` 可选字段，`AIStore` 新增 `appendCoverCandidate` / `replaceCoverCandidate` / `updateCoverEdits` 三个 action，保证持久化向后兼容。

**Files:**
- Modify: `src/types/ai.ts:119-125`
- Modify: `src/store/ai.ts`（新增 action）
- Test: `tests/cover-candidate-store.test.ts`（新）

- [ ] **Step 1：编写 store 行为测试**

Create `tests/cover-candidate-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useAIStore } from '../src/store/ai';

describe('AIStore cover editing actions', () => {
  beforeEach(() => {
    useAIStore.setState({ coverCandidates: [] });
  });

  it('appendCoverCandidate 追加并保留既有候选', () => {
    useAIStore.setState({
      coverCandidates: [{ id: 'a', prompt: 'x', imageUrl: '/a.png', selected: true }],
    });
    useAIStore.getState().appendCoverCandidate({
      id: 'b',
      prompt: 'x',
      imageUrl: '/b.png',
      selected: false,
      editedFrom: 'a',
      createdAt: 1,
    });
    const list = useAIStore.getState().coverCandidates;
    expect(list).toHaveLength(2);
    expect(list[1].editedFrom).toBe('a');
  });

  it('replaceCoverCandidate 原地替换并保留顺序', () => {
    useAIStore.setState({
      coverCandidates: [
        { id: 'a', prompt: 'x', imageUrl: '/a.png', selected: false },
        { id: 'b', prompt: 'y', imageUrl: '/b.png', selected: true },
      ],
    });
    useAIStore.getState().replaceCoverCandidate('a', {
      imageUrl: '/a.png?v=2',
      edits: { version: 1, aspectRatio: '16:9' },
    });
    const list = useAIStore.getState().coverCandidates;
    expect(list).toHaveLength(2);
    expect(list[0].imageUrl).toBe('/a.png?v=2');
    expect(list[0].edits?.aspectRatio).toBe('16:9');
    expect(list[1].id).toBe('b');
  });

  it('updateCoverEdits 只更新 edits 字段', () => {
    useAIStore.setState({
      coverCandidates: [{ id: 'a', prompt: 'x', imageUrl: '/a.png', selected: false }],
    });
    useAIStore.getState().updateCoverEdits('a', { version: 1, aspectRatio: '9:16' });
    expect(useAIStore.getState().coverCandidates[0].edits?.aspectRatio).toBe('9:16');
  });
});
```

- [ ] **Step 2：运行测试确认失败**

Run: `npx vitest run tests/cover-candidate-store.test.ts`
Expected: FAIL — 三个 action 尚未实现。

- [ ] **Step 3：扩展 CoverCandidate 类型**

Modify `src/types/ai.ts` 将现有 `CoverCandidate` 定义替换为：

```typescript
export interface CoverCandidate {
  id: string;
  prompt: string;
  imageUrl: string;
  selected: boolean;
  error?: string;
  /** 来源候选 id；AI 原图为 undefined */
  editedFrom?: string;
  /** 编辑状态快照，用于再编辑时恢复工具面板 */
  edits?: CoverEditState;
  /** 生成时间戳 */
  createdAt?: number;
}

export type { CoverEditState, CoverTextOverlay } from '../lib/cover-editor/contracts';
```

- [ ] **Step 4：在 AIStore 追加三个 action**

在 `src/store/ai.ts` 的 `AIStore` 接口中（约第 129 行 `setCoverCandidates` 附近）追加声明：

```typescript
  appendCoverCandidate: (candidate: CoverCandidate) => void;
  replaceCoverCandidate: (candidateId: string, patch: Partial<CoverCandidate>) => void;
  updateCoverEdits: (candidateId: string, edits: CoverEditState) => void;
```

并在 `create<AIStore>((set, get) => ({...}))` 的实现里（紧跟 `setCoverCandidates`）追加：

```typescript
  appendCoverCandidate: (candidate) =>
    set((state) => ({ coverCandidates: [...state.coverCandidates, candidate] })),
  replaceCoverCandidate: (candidateId, patch) =>
    set((state) => ({
      coverCandidates: state.coverCandidates.map((c) =>
        c.id === candidateId ? { ...c, ...patch } : c,
      ),
    })),
  updateCoverEdits: (candidateId, edits) =>
    set((state) => ({
      coverCandidates: state.coverCandidates.map((c) =>
        c.id === candidateId ? { ...c, edits } : c,
      ),
    })),
```

- [ ] **Step 5：运行测试**

Run: `npx vitest run tests/cover-candidate-store.test.ts`
Expected: PASS（三个用例均通过）。

- [ ] **Step 6：验证既有测试未回归**

Run: `npm test`
Expected: 所有原有测试继续通过。

- [ ] **Step 7：提交**

```bash
git add src/types/ai.ts src/store/ai.ts tests/cover-candidate-store.test.ts
git commit -m "feat(ai-store): 扩展 CoverCandidate 与 store actions 支持封面编辑"
```

---

## Task 3：主进程 IPC 实现（Phase 1，并行 A）

**目标：** 实现 `save-cover-edit` 与 `list-system-fonts` 两个 IPC handler 以及底层 IO 逻辑。

**Files:**
- Create: `electron/cover-editor-io.ts`
- Create: `electron/system-fonts.ts`
- Modify: `electron/main.ts`（追加两个 handler 注册；尾部）
- Modify: `electron/preload.ts`（追加 `saveCoverEdit` 桥）
- Modify: `src/lib/electron-api.ts`（追加类型）
- Test: `tests/cover-editor-io.test.ts`（新）

- [ ] **Step 1：编写 cover-editor-io 测试**

Create `tests/cover-editor-io.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { saveCoverEdit } from '../electron/cover-editor-io';

describe('saveCoverEdit', () => {
  let tmp = '';
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-edit-'));
    await fs.mkdir(path.join(tmp, 'covers'), { recursive: true });
  });

  const pngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('append 模式写入新文件并返回新候选', async () => {
    const result = await saveCoverEdit({
      projectDir: tmp,
      sourceCandidateId: 'src-1',
      sourceImageUrl: path.join(tmp, 'covers', 'cover-src-1.png'),
      sourcePrompt: 'test',
      dataUrl: pngDataUrl,
      edits: { version: 1 },
      mode: 'append',
    });
    expect(result.editedFrom).toBe('src-1');
    expect(result.imageUrl).toMatch(/edited-.*\.png$/);
    expect(result.replacedId).toBeUndefined();
    const stat = await fs.stat(result.imageUrl);
    expect(stat.isFile()).toBe(true);
  });

  it('overwrite 模式覆盖原文件并返回 replacedId', async () => {
    const sourcePath = path.join(tmp, 'covers', 'cover-src-2.png');
    await fs.writeFile(sourcePath, 'old');
    const result = await saveCoverEdit({
      projectDir: tmp,
      sourceCandidateId: 'src-2',
      sourceImageUrl: sourcePath,
      sourcePrompt: 'test',
      dataUrl: pngDataUrl,
      edits: { version: 1 },
      mode: 'overwrite',
    });
    expect(result.candidateId).toBe('src-2');
    expect(result.replacedId).toBe('src-2');
    expect(result.imageUrl.startsWith(sourcePath)).toBe(true);
    // 文件已被覆盖（大小与原 "old" 不同）
    const stat = await fs.stat(sourcePath);
    expect(stat.size).toBeGreaterThan(3);
  });
});
```

- [ ] **Step 2：运行测试确认失败**

Run: `npx vitest run tests/cover-editor-io.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3：实现 cover-editor-io**

Create `electron/cover-editor-io.ts`:

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  SaveCoverEditArgs,
  SaveCoverEditResult,
} from '../src/lib/cover-editor/contracts';

const DATA_URL_RE = /^data:image\/(png|jpeg);base64,(.+)$/;

function parseDataUrl(dataUrl: string): Buffer {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error('saveCoverEdit: 无法解析 dataUrl');
  }
  return Buffer.from(match[2], 'base64');
}

export async function saveCoverEdit(args: SaveCoverEditArgs): Promise<SaveCoverEditResult> {
  const buffer = parseDataUrl(args.dataUrl);
  const coversDir = path.join(args.projectDir, 'covers');
  await fs.mkdir(coversDir, { recursive: true });

  if (args.mode === 'append') {
    const id = randomUUID();
    const outPath = path.join(coversDir, `edited-${id}.png`);
    await fs.writeFile(outPath, buffer);
    return {
      candidateId: id,
      imageUrl: outPath,
      editedFrom: args.sourceCandidateId,
      createdAt: Date.now(),
    };
  }

  // overwrite：写入来源文件，id 保持不变
  await fs.writeFile(args.sourceImageUrl, buffer);
  return {
    candidateId: args.sourceCandidateId,
    imageUrl: args.sourceImageUrl,
    replacedId: args.sourceCandidateId,
    createdAt: Date.now(),
  };
}
```

- [ ] **Step 4：运行测试确认通过**

Run: `npx vitest run tests/cover-editor-io.test.ts`
Expected: PASS（两个用例通过）。

- [ ] **Step 5：实现 system-fonts（主进程）**

Create `electron/system-fonts.ts`:

```typescript
import type { ListSystemFontsResult, SystemFont } from '../src/lib/cover-editor/contracts';

let cache: { fonts: SystemFont[]; expireAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

const FALLBACK_FONTS: SystemFont[] = [
  { family: 'PingFang SC' },
  { family: 'Hiragino Sans GB' },
  { family: 'Songti SC' },
  { family: 'Helvetica Neue' },
  { family: 'Arial' },
  { family: 'Menlo' },
];

export async function listSystemFonts(): Promise<ListSystemFontsResult> {
  const now = Date.now();
  if (cache && cache.expireAt > now) {
    return { fonts: cache.fonts };
  }
  try {
    const mod = (await import('font-list')) as { getFonts: () => Promise<string[]> };
    const raw = await mod.getFonts();
    const fonts = Array.from(
      new Set(raw.map((f) => f.replace(/^"(.*)"$/, '$1').trim()).filter(Boolean)),
    )
      .sort((a, b) => a.localeCompare(b))
      .map((family) => ({ family }));
    cache = { fonts, expireAt: now + CACHE_TTL_MS };
    return { fonts };
  } catch {
    cache = { fonts: FALLBACK_FONTS, expireAt: now + CACHE_TTL_MS };
    return { fonts: FALLBACK_FONTS };
  }
}
```

- [ ] **Step 6：在 electron/main.ts 注册两个 handler**

在 `electron/main.ts` 文件**尾部**（所有既有 handler 之后）追加：

```typescript
import { saveCoverEdit } from './cover-editor-io';
import { listSystemFonts } from './system-fonts';

ipcMain.handle('save-cover-edit', async (_event, args) => {
  return saveCoverEdit(args);
});

ipcMain.handle('list-system-fonts', async () => {
  return listSystemFonts();
});
```

（import 语句请与文件顶部 import 区合并，不要单独放在尾部；`ipcMain.handle` 两行加到尾部。）

- [ ] **Step 7：在 preload.ts 暴露 saveCoverEdit 桥**

在 `electron/preload.ts` 的 `generateCoverImages` 下方追加：

```typescript
  saveCoverEdit: (args: import('../src/lib/cover-editor/contracts').SaveCoverEditArgs) =>
    ipcRenderer.invoke('save-cover-edit', args),
```

**注意：** `listSystemFonts` 由 Task 7 追加，本任务不添加。

- [ ] **Step 8：在 electron-api.ts 追加类型**

在 `src/lib/electron-api.ts` 的 `ElectronAPI` 接口中 `generateCoverImages` 下方追加：

```typescript
  saveCoverEdit: (
    args: import('./cover-editor/contracts').SaveCoverEditArgs,
  ) => Promise<import('./cover-editor/contracts').SaveCoverEditResult>;
```

- [ ] **Step 9：类型检查**

Run: `npx tsc --noEmit`
Expected: 无新错误。

- [ ] **Step 10：提交**

```bash
git add electron/cover-editor-io.ts electron/system-fonts.ts electron/main.ts electron/preload.ts src/lib/electron-api.ts tests/cover-editor-io.test.ts
git commit -m "feat(electron): 新增 save-cover-edit 与 list-system-fonts IPC"
```

---

## Task 4：序列化 + 滤镜 + 比例预设（Phase 1，并行 A）

**目标：** 纯 lib，无副作用。提供：
- `CoverEditState ↔ Fabric JSON` 双向映射
- 滤镜预设矩阵（黑白/鲜艳/复古/冷/暖）
- 比例预设定义（含时间线推导）

**Files:**
- Create: `src/lib/cover-editor/cover-edit-state.ts`
- Create: `src/lib/cover-editor/filters.ts`
- Create: `src/lib/cover-editor/aspect-ratios.ts`
- Test: `tests/cover-edit-state.test.ts`、`tests/cover-aspect-ratios.test.ts`

- [ ] **Step 1：编写比例预设测试**

Create `tests/cover-aspect-ratios.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  ASPECT_RATIO_PRESETS,
  resolveAspectRatio,
  computeClipSize,
} from '../src/lib/cover-editor/aspect-ratios';

describe('aspect-ratios', () => {
  it('预设列表包含必要项', () => {
    const names = ASPECT_RATIO_PRESETS.map((p) => p.id);
    expect(names).toEqual(['timeline', '16:9', '9:16', '1:1', '4:3', '4:5', 'free']);
  });

  it('timeline 预设返回时间线宽高比', () => {
    const ratio = resolveAspectRatio('timeline', { width: 1920, height: 1080 });
    expect(ratio).toBeCloseTo(16 / 9, 4);
  });

  it('自由裁剪返回 null', () => {
    expect(resolveAspectRatio('free', { width: 1920, height: 1080 })).toBeNull();
  });

  it('computeClipSize 在 1000x1000 容器内按 16:9 计算', () => {
    const size = computeClipSize(16 / 9, 1000, 1000);
    expect(size.width).toBe(1000);
    expect(size.height).toBeCloseTo(562.5, 1);
  });
});
```

- [ ] **Step 2：实现 aspect-ratios**

Create `src/lib/cover-editor/aspect-ratios.ts`:

```typescript
import type { AspectRatioPreset } from './contracts';

export interface AspectRatioPresetDef {
  id: AspectRatioPreset;
  label: string;
  ratio: number | null;
}

export const ASPECT_RATIO_PRESETS: AspectRatioPresetDef[] = [
  { id: 'timeline', label: '时间线比例', ratio: null },
  { id: '16:9', label: '16:9 横版', ratio: 16 / 9 },
  { id: '9:16', label: '9:16 竖版', ratio: 9 / 16 },
  { id: '1:1', label: '1:1 方版', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '4:5', label: '4:5 小红书', ratio: 4 / 5 },
  { id: 'free', label: '自由裁剪', ratio: null },
];

export function resolveAspectRatio(
  preset: AspectRatioPreset,
  timelineSize: { width: number; height: number },
): number | null {
  if (preset === 'free') return null;
  if (preset === 'timeline') {
    if (!timelineSize.width || !timelineSize.height) return 16 / 9;
    return timelineSize.width / timelineSize.height;
  }
  const def = ASPECT_RATIO_PRESETS.find((p) => p.id === preset);
  return def?.ratio ?? null;
}

export function computeClipSize(
  ratio: number | null,
  containerWidth: number,
  containerHeight: number,
): { width: number; height: number } {
  if (!ratio) return { width: containerWidth, height: containerHeight };
  const maxByWidth = { width: containerWidth, height: containerWidth / ratio };
  if (maxByWidth.height <= containerHeight) return maxByWidth;
  return { width: containerHeight * ratio, height: containerHeight };
}
```

- [ ] **Step 3：运行测试**

Run: `npx vitest run tests/cover-aspect-ratios.test.ts`
Expected: PASS。

- [ ] **Step 4：编写 cover-edit-state 测试**

Create `tests/cover-edit-state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  createEmptyEditState,
  mergeTextOverlay,
  normalizeEditState,
} from '../src/lib/cover-editor/cover-edit-state';

describe('cover-edit-state', () => {
  it('createEmptyEditState 返回 version 1', () => {
    expect(createEmptyEditState().version).toBe(1);
  });

  it('mergeTextOverlay 新增图层', () => {
    const base = createEmptyEditState();
    const next = mergeTextOverlay(base, {
      id: 't1',
      text: 'Hello',
      x: 10,
      y: 20,
      fontSize: 48,
      fontFamily: 'Arial',
      color: '#fff',
    });
    expect(next.textOverlays).toHaveLength(1);
    expect(next.textOverlays?.[0].text).toBe('Hello');
  });

  it('mergeTextOverlay 更新既有图层', () => {
    const base = mergeTextOverlay(createEmptyEditState(), {
      id: 't1', text: 'a', x: 0, y: 0, fontSize: 24, fontFamily: 'Arial', color: '#000',
    });
    const next = mergeTextOverlay(base, {
      id: 't1', text: 'b', x: 0, y: 0, fontSize: 24, fontFamily: 'Arial', color: '#000',
    });
    expect(next.textOverlays).toHaveLength(1);
    expect(next.textOverlays?.[0].text).toBe('b');
  });

  it('normalizeEditState 兜住缺失字段', () => {
    const normalized = normalizeEditState({ version: 1 });
    expect(normalized.textOverlays).toEqual([]);
    expect(normalized.filters?.preset).toBe('none');
  });
});
```

- [ ] **Step 5：实现 cover-edit-state**

Create `src/lib/cover-editor/cover-edit-state.ts`:

```typescript
import type { CoverEditState, CoverTextOverlay } from './contracts';

export function createEmptyEditState(): CoverEditState {
  return {
    version: 1,
    aspectRatio: 'timeline',
    textOverlays: [],
    filters: { preset: 'none' },
    transform: {},
  };
}

export function mergeTextOverlay(
  state: CoverEditState,
  overlay: CoverTextOverlay,
): CoverEditState {
  const list = state.textOverlays ?? [];
  const idx = list.findIndex((t) => t.id === overlay.id);
  const nextList =
    idx >= 0 ? list.map((t, i) => (i === idx ? overlay : t)) : [...list, overlay];
  return { ...state, textOverlays: nextList };
}

export function removeTextOverlay(state: CoverEditState, id: string): CoverEditState {
  return {
    ...state,
    textOverlays: (state.textOverlays ?? []).filter((t) => t.id !== id),
  };
}

export function normalizeEditState(state: CoverEditState | undefined): CoverEditState {
  const base = state ?? createEmptyEditState();
  return {
    version: 1,
    aspectRatio: base.aspectRatio ?? 'timeline',
    crop: base.crop,
    textOverlays: base.textOverlays ?? [],
    filters: {
      brightness: base.filters?.brightness ?? 0,
      contrast: base.filters?.contrast ?? 0,
      saturation: base.filters?.saturation ?? 0,
      temperature: base.filters?.temperature ?? 0,
      preset: base.filters?.preset ?? 'none',
    },
    transform: base.transform ?? {},
  };
}
```

- [ ] **Step 6：实现 filters（滤镜预设矩阵）**

Create `src/lib/cover-editor/filters.ts`:

```typescript
import type { FilterPreset } from './contracts';

export interface FilterAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export const FILTER_PRESETS: Record<FilterPreset, FilterAdjustments> = {
  none: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
  bw: { brightness: 0, contrast: 10, saturation: -100, temperature: 0 },
  vivid: { brightness: 5, contrast: 20, saturation: 30, temperature: 0 },
  vintage: { brightness: -5, contrast: -10, saturation: -20, temperature: 20 },
  cool: { brightness: 0, contrast: 5, saturation: -5, temperature: -25 },
  warm: { brightness: 0, contrast: 5, saturation: 5, temperature: 25 },
};

export function getPresetAdjustments(preset: FilterPreset): FilterAdjustments {
  return FILTER_PRESETS[preset];
}
```

- [ ] **Step 7：运行测试**

Run: `npx vitest run tests/cover-edit-state.test.ts tests/cover-aspect-ratios.test.ts`
Expected: PASS。

- [ ] **Step 8：提交**

```bash
git add src/lib/cover-editor/aspect-ratios.ts src/lib/cover-editor/cover-edit-state.ts src/lib/cover-editor/filters.ts tests/cover-aspect-ratios.test.ts tests/cover-edit-state.test.ts
git commit -m "feat(cover-editor): 新增序列化/滤镜预设/比例预设 lib"
```

---

## Task 5：Fabric 画布核心（Phase 2，并行 B）

**目标：** 封装 `useFabricCanvas` hook 与 `CoverEditorCanvas` 组件，负责 Fabric Canvas 生命周期、图像加载、比例 clipPath、撤销重做栈、对外暴露命令式 API。

**Files:**
- Create: `src/lib/cover-editor/fabric-bridge.ts`
- Create: `src/components/cover-editor/CoverEditorCanvas.tsx`
- Create: `src/components/cover-editor/CoverEditorCanvas.module.css`
- Test: `tests/fabric-bridge.test.ts`（基本初始化 + 快照栈）

> **注：** 涉及 DOM / Canvas 的部分使用 `happy-dom`（Vitest 默认）或 mock。Fabric 在 jsdom 下部分能力不可用，测试只验证 hook 的快照栈逻辑，不验证渲染结果。

- [ ] **Step 1：编写快照栈测试**

Create `tests/fabric-bridge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createHistoryStack } from '../src/lib/cover-editor/fabric-bridge';

describe('history stack', () => {
  it('push 后可以 undo/redo', () => {
    const h = createHistoryStack<string>(10);
    h.push('a');
    h.push('b');
    h.push('c');
    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toBe('b');
  });

  it('push 后 redo 栈被清空', () => {
    const h = createHistoryStack<string>(10);
    h.push('a');
    h.push('b');
    h.undo();
    h.push('c');
    expect(h.canRedo()).toBe(false);
  });

  it('超出容量丢弃最老记录', () => {
    const h = createHistoryStack<number>(3);
    h.push(1); h.push(2); h.push(3); h.push(4);
    // 只保留最近 3 条
    h.undo(); h.undo();
    expect(h.canUndo()).toBe(false);
  });
});
```

- [ ] **Step 2：实现 fabric-bridge**

Create `src/lib/cover-editor/fabric-bridge.ts`:

```typescript
import type { CoverEditState } from './contracts';

/** 历史栈（泛型，供 Fabric JSON 快照使用） */
export interface HistoryStack<T> {
  push(snapshot: T): void;
  undo(): T | null;
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  peek(): T | null;
  clear(): void;
}

export function createHistoryStack<T>(capacity = 50): HistoryStack<T> {
  const stack: T[] = [];
  let cursor = -1; // 当前指向最新应用的快照

  return {
    push(snapshot) {
      // 清空 redo 区段
      stack.splice(cursor + 1);
      stack.push(snapshot);
      if (stack.length > capacity) {
        stack.shift();
      } else {
        cursor = stack.length - 1;
        return;
      }
      cursor = stack.length - 1;
    },
    undo() {
      if (cursor <= 0) return null;
      cursor -= 1;
      return stack[cursor];
    },
    redo() {
      if (cursor >= stack.length - 1) return null;
      cursor += 1;
      return stack[cursor];
    },
    canUndo() {
      return cursor > 0;
    },
    canRedo() {
      return cursor < stack.length - 1;
    },
    peek() {
      return cursor >= 0 ? stack[cursor] : null;
    },
    clear() {
      stack.length = 0;
      cursor = -1;
    },
  };
}

/** 命令式 API，由 CoverEditorCanvas 通过 ref 暴露给父组件 */
export interface CoverEditorCanvasHandle {
  setAspectRatio(ratio: number | null): void;
  addText(options: { text: string; fontFamily: string; color: string }): void;
  removeSelected(): void;
  flipHorizontal(): void;
  flipVertical(): void;
  rotate(degrees: number): void;
  setFilterPreset(preset: import('./contracts').FilterPreset): void;
  setFilterAdjustment(
    key: 'brightness' | 'contrast' | 'saturation' | 'temperature',
    value: number,
  ): void;
  undo(): void;
  redo(): void;
  exportDataUrl(): string;
  getEditState(): CoverEditState;
  loadEditState(state: CoverEditState): void;
}
```

- [ ] **Step 3：运行快照测试**

Run: `npx vitest run tests/fabric-bridge.test.ts`
Expected: PASS。

- [ ] **Step 4：实现 CoverEditorCanvas 组件**

Create `src/components/cover-editor/CoverEditorCanvas.tsx`:

```typescript
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Canvas, FabricImage, Textbox, filters as fabricFilters } from 'fabric';
import styles from './CoverEditorCanvas.module.css';
import {
  createHistoryStack,
  type CoverEditorCanvasHandle,
} from '../../lib/cover-editor/fabric-bridge';
import {
  createEmptyEditState,
  normalizeEditState,
} from '../../lib/cover-editor/cover-edit-state';
import { getPresetAdjustments } from '../../lib/cover-editor/filters';
import { computeClipSize } from '../../lib/cover-editor/aspect-ratios';
import type { CoverEditState, FilterPreset } from '../../lib/cover-editor/contracts';

interface CoverEditorCanvasProps {
  imageUrl: string;
  initialEdits?: CoverEditState;
  initialAspectRatio: number | null;
  onChange?: (state: CoverEditState) => void;
}

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;

export const CoverEditorCanvas = forwardRef<CoverEditorCanvasHandle, CoverEditorCanvasProps>(
  function CoverEditorCanvas({ imageUrl, initialEdits, initialAspectRatio, onChange }, ref) {
    const containerRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const bgImageRef = useRef<FabricImage | null>(null);
    const history = useRef(createHistoryStack<string>(50));
    const ratioRef = useRef<number | null>(initialAspectRatio);
    const filterPresetRef = useRef<FilterPreset>(
      initialEdits?.filters?.preset ?? 'none',
    );

    useEffect(() => {
      if (!containerRef.current) return;
      const canvas = new Canvas(containerRef.current, {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        backgroundColor: '#111',
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' }).then((img) => {
        if (!fabricRef.current) return;
        bgImageRef.current = img;
        img.set({ selectable: false, evented: false });
        const scale = Math.min(
          CANVAS_WIDTH / (img.width ?? CANVAS_WIDTH),
          CANVAS_HEIGHT / (img.height ?? CANVAS_HEIGHT),
        );
        img.scale(scale);
        img.set({
          left: (CANVAS_WIDTH - (img.width ?? 0) * scale) / 2,
          top: (CANVAS_HEIGHT - (img.height ?? 0) * scale) / 2,
        });
        canvas.add(img);
        canvas.sendObjectToBack(img);
        applyClipPath(ratioRef.current);
        pushSnapshot();
        if (initialEdits) applyEditState(normalizeEditState(initialEdits));
        emitChange();
      });

      canvas.on('object:modified', () => {
        pushSnapshot();
        emitChange();
      });

      return () => {
        canvas.dispose();
        fabricRef.current = null;
      };
    }, [imageUrl]);

    function pushSnapshot() {
      if (!fabricRef.current) return;
      history.current.push(JSON.stringify(fabricRef.current.toJSON()));
    }

    function emitChange() {
      onChange?.(buildEditState());
    }

    function buildEditState(): CoverEditState {
      const canvas = fabricRef.current;
      if (!canvas) return createEmptyEditState();
      const textOverlays = canvas
        .getObjects()
        .filter((o): o is Textbox => o.type === 'textbox')
        .map((t) => ({
          id: (t as unknown as { id?: string }).id ?? String(t.left ?? 0) + String(t.top ?? 0),
          text: t.text ?? '',
          x: t.left ?? 0,
          y: t.top ?? 0,
          fontSize: t.fontSize ?? 48,
          fontFamily: t.fontFamily ?? 'Arial',
          color: (t.fill as string) ?? '#ffffff',
          strokeColor: (t.stroke as string) ?? undefined,
          strokeWidth: t.strokeWidth,
          align: (t.textAlign as 'left' | 'center' | 'right') ?? 'left',
          rotation: t.angle ?? 0,
        }));
      return {
        version: 1,
        aspectRatio: undefined,
        textOverlays,
        filters: { preset: filterPresetRef.current },
        transform: {},
      };
    }

    function applyClipPath(ratio: number | null) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      if (!ratio) {
        canvas.clipPath = undefined;
        canvas.requestRenderAll();
        return;
      }
      const size = computeClipSize(ratio, CANVAS_WIDTH, CANVAS_HEIGHT);
      // 使用矩形 clipPath
      import('fabric').then(({ Rect }) => {
        const clip = new Rect({
          left: (CANVAS_WIDTH - size.width) / 2,
          top: (CANVAS_HEIGHT - size.height) / 2,
          width: size.width,
          height: size.height,
          absolutePositioned: true,
        });
        canvas.clipPath = clip;
        canvas.requestRenderAll();
      });
    }

    function applyEditState(state: CoverEditState) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      for (const t of state.textOverlays ?? []) {
        const tb = new Textbox(t.text, {
          left: t.x,
          top: t.y,
          fontSize: t.fontSize,
          fontFamily: t.fontFamily,
          fill: t.color,
          stroke: t.strokeColor,
          strokeWidth: t.strokeWidth ?? 0,
          textAlign: t.align ?? 'left',
          angle: t.rotation ?? 0,
        });
        canvas.add(tb);
      }
      canvas.requestRenderAll();
    }

    function applyFilters() {
      const img = bgImageRef.current;
      if (!img) return;
      const adj = getPresetAdjustments(filterPresetRef.current);
      img.filters = [
        new fabricFilters.Brightness({ brightness: adj.brightness / 100 }),
        new fabricFilters.Contrast({ contrast: adj.contrast / 100 }),
        new fabricFilters.Saturation({ saturation: adj.saturation / 100 }),
      ];
      img.applyFilters();
      fabricRef.current?.requestRenderAll();
    }

    useImperativeHandle(ref, (): CoverEditorCanvasHandle => ({
      setAspectRatio(ratio) {
        ratioRef.current = ratio;
        applyClipPath(ratio);
        pushSnapshot();
        emitChange();
      },
      addText({ text, fontFamily, color }) {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const tb = new Textbox(text, {
          left: CANVAS_WIDTH / 2 - 120,
          top: CANVAS_HEIGHT / 2 - 24,
          width: 240,
          fontSize: 48,
          fontFamily,
          fill: color,
          textAlign: 'center',
        });
        canvas.add(tb);
        canvas.setActiveObject(tb);
        pushSnapshot();
        emitChange();
      },
      removeSelected() {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        active.forEach((obj) => {
          if (obj !== bgImageRef.current) canvas.remove(obj);
        });
        canvas.discardActiveObject();
        pushSnapshot();
        emitChange();
      },
      flipHorizontal() {
        const img = bgImageRef.current;
        if (!img) return;
        img.set('flipX', !img.flipX);
        pushSnapshot();
        emitChange();
      },
      flipVertical() {
        const img = bgImageRef.current;
        if (!img) return;
        img.set('flipY', !img.flipY);
        pushSnapshot();
        emitChange();
      },
      rotate(deg) {
        const img = bgImageRef.current;
        if (!img) return;
        img.rotate((img.angle ?? 0) + deg);
        pushSnapshot();
        emitChange();
      },
      setFilterPreset(preset) {
        filterPresetRef.current = preset;
        applyFilters();
        pushSnapshot();
        emitChange();
      },
      setFilterAdjustment() {
        // Task 6 Inspector 会接线到这里；本 Task 只暴露占位实现
        applyFilters();
        pushSnapshot();
        emitChange();
      },
      undo() {
        const snap = history.current.undo();
        const canvas = fabricRef.current;
        if (snap && canvas) canvas.loadFromJSON(snap, () => canvas.requestRenderAll());
        emitChange();
      },
      redo() {
        const snap = history.current.redo();
        const canvas = fabricRef.current;
        if (snap && canvas) canvas.loadFromJSON(snap, () => canvas.requestRenderAll());
        emitChange();
      },
      exportDataUrl() {
        const canvas = fabricRef.current;
        if (!canvas) return '';
        return canvas.toDataURL({ format: 'png', multiplier: 2 });
      },
      getEditState() {
        return buildEditState();
      },
      loadEditState(state) {
        applyEditState(state);
      },
    }));

    return (
      <div className={styles.canvasWrap}>
        <canvas ref={containerRef} />
      </div>
    );
  },
);
```

Create `src/components/cover-editor/CoverEditorCanvas.module.css`:

```css
.canvasWrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--color-surface-secondary, #1c1c1e);
  border-radius: 12px;
  overflow: hidden;
}
```

- [ ] **Step 5：类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6：提交**

```bash
git add src/lib/cover-editor/fabric-bridge.ts src/components/cover-editor/CoverEditorCanvas.tsx src/components/cover-editor/CoverEditorCanvas.module.css tests/fabric-bridge.test.ts
git commit -m "feat(cover-editor): Fabric 画布核心与 CoverEditorCanvas 组件"
```

---

## Task 6：ToolRail + Inspector + FilterPanel（Phase 2，并行 B）

**目标：** 自研 UI 组件，复用 `src/ui/components` 保持 darwin-ui 视觉。

**Files:**
- Create: `src/components/cover-editor/ToolRail.tsx`
- Create: `src/components/cover-editor/ToolRail.module.css`
- Create: `src/components/cover-editor/Inspector.tsx`
- Create: `src/components/cover-editor/Inspector.module.css`
- Create: `src/components/cover-editor/FilterPanel.tsx`
- Create: `src/components/cover-editor/FilterPanel.module.css`

- [ ] **Step 1：实现 ToolRail**

Create `src/components/cover-editor/ToolRail.tsx`:

```typescript
import { Button } from '../../ui';
import { AppIcon } from '../AppIcon';
import styles from './ToolRail.module.css';

export type EditorTool = 'select' | 'crop' | 'text' | 'filter' | 'adjust' | 'transform';

interface ToolRailProps {
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const TOOLS: Array<{ id: EditorTool; label: string; icon: string }> = [
  { id: 'select', label: '选择', icon: 'mouse-pointer' },
  { id: 'crop', label: '裁剪', icon: 'crop' },
  { id: 'text', label: '文字', icon: 'type' },
  { id: 'filter', label: '滤镜', icon: 'sparkles' },
  { id: 'adjust', label: '调色', icon: 'sliders' },
  { id: 'transform', label: '变换', icon: 'rotate-ccw' },
];

export function ToolRail({
  activeTool,
  onSelectTool,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolRailProps) {
  return (
    <div className={styles.rail}>
      {TOOLS.map((tool) => (
        <Button.Icon
          key={tool.id}
          variant={activeTool === tool.id ? 'primary' : 'ghost'}
          onClick={() => onSelectTool(tool.id)}
          aria-label={tool.label}
          title={tool.label}
        >
          <AppIcon name={tool.icon} size={16} />
        </Button.Icon>
      ))}
      <div className={styles.divider} />
      <Button.Icon
        variant="ghost"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="撤销"
        title="撤销"
      >
        <AppIcon name="undo-2" size={16} />
      </Button.Icon>
      <Button.Icon
        variant="ghost"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="重做"
        title="重做"
      >
        <AppIcon name="redo-2" size={16} />
      </Button.Icon>
    </div>
  );
}
```

Create `src/components/cover-editor/ToolRail.module.css`:

```css
.rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 8px;
  width: 56px;
  background: var(--color-surface-secondary);
  border-right: 1px solid var(--color-border-secondary);
}
.divider {
  height: 1px;
  background: var(--color-border-secondary);
  margin: 8px 0;
}
```

- [ ] **Step 2：实现 Inspector（文字属性面板）**

Create `src/components/cover-editor/Inspector.tsx`:

```typescript
import { Button } from '../../ui';
import { AppIcon } from '../AppIcon';
import styles from './Inspector.module.css';
import type { CoverTextOverlay } from '../../lib/cover-editor/contracts';

interface InspectorProps {
  selectedText: CoverTextOverlay | null;
  onUpdateText: (patch: Partial<CoverTextOverlay>) => void;
  onRemoveText: () => void;
  fontFamilyPicker: React.ReactNode;
}

export function Inspector({
  selectedText,
  onUpdateText,
  onRemoveText,
  fontFamilyPicker,
}: InspectorProps) {
  if (!selectedText) {
    return (
      <aside className={styles.panel}>
        <div className={styles.empty}>在画布上选择文字以编辑属性</div>
      </aside>
    );
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>文字属性</div>

      <label className={styles.row}>
        <span>内容</span>
        <input
          className={styles.input}
          value={selectedText.text}
          onChange={(e) => onUpdateText({ text: e.target.value })}
        />
      </label>

      <label className={styles.row}>
        <span>字体</span>
        {fontFamilyPicker}
      </label>

      <label className={styles.row}>
        <span>字号</span>
        <input
          type="number"
          min={8}
          max={200}
          className={styles.input}
          value={selectedText.fontSize}
          onChange={(e) => onUpdateText({ fontSize: Number(e.target.value) || 48 })}
        />
      </label>

      <label className={styles.row}>
        <span>颜色</span>
        <input
          type="color"
          value={selectedText.color}
          onChange={(e) => onUpdateText({ color: e.target.value })}
        />
      </label>

      <label className={styles.row}>
        <span>描边</span>
        <input
          type="color"
          value={selectedText.strokeColor ?? '#000000'}
          onChange={(e) => onUpdateText({ strokeColor: e.target.value })}
        />
        <input
          type="number"
          min={0}
          max={20}
          className={styles.input}
          value={selectedText.strokeWidth ?? 0}
          onChange={(e) => onUpdateText({ strokeWidth: Number(e.target.value) })}
        />
      </label>

      <div className={styles.row}>
        <span>对齐</span>
        <div className={styles.alignGroup}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <Button.Icon
              key={a}
              variant={selectedText.align === a ? 'primary' : 'ghost'}
              onClick={() => onUpdateText({ align: a })}
              aria-label={`对齐${a}`}
            >
              <AppIcon name={`align-${a}`} size={14} />
            </Button.Icon>
          ))}
        </div>
      </div>

      <Button variant="danger" size="sm" onClick={onRemoveText} className={styles.danger}>
        <AppIcon name="trash-2" size={12} />
        <span>删除图层</span>
      </Button>
    </aside>
  );
}
```

Create `src/components/cover-editor/Inspector.module.css`:

```css
.panel {
  width: 280px;
  padding: 16px;
  background: var(--color-surface-secondary);
  border-left: 1px solid var(--color-border-secondary);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.empty {
  color: var(--color-text-tertiary);
  font-size: 12px;
  text-align: center;
  padding: 32px 0;
}
.header {
  font-size: 13px;
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--color-border-secondary);
  border-radius: 6px;
  background: var(--color-surface-primary);
  color: var(--color-text-primary);
}
.alignGroup {
  display: flex;
  gap: 4px;
}
.danger {
  margin-top: 12px;
}
```

- [ ] **Step 3：实现 FilterPanel**

Create `src/components/cover-editor/FilterPanel.tsx`:

```typescript
import styles from './FilterPanel.module.css';
import type { FilterPreset } from '../../lib/cover-editor/contracts';

interface FilterPanelProps {
  preset: FilterPreset;
  adjustments: { brightness: number; contrast: number; saturation: number; temperature: number };
  onPresetChange: (preset: FilterPreset) => void;
  onAdjustmentChange: (
    key: 'brightness' | 'contrast' | 'saturation' | 'temperature',
    value: number,
  ) => void;
}

const PRESETS: Array<{ id: FilterPreset; label: string }> = [
  { id: 'none', label: '原图' },
  { id: 'bw', label: '黑白' },
  { id: 'vivid', label: '鲜艳' },
  { id: 'vintage', label: '复古' },
  { id: 'cool', label: '冷色' },
  { id: 'warm', label: '暖色' },
];

const SLIDERS: Array<{
  key: 'brightness' | 'contrast' | 'saturation' | 'temperature';
  label: string;
}> = [
  { key: 'brightness', label: '亮度' },
  { key: 'contrast', label: '对比度' },
  { key: 'saturation', label: '饱和度' },
  { key: 'temperature', label: '色温' },
];

export function FilterPanel({
  preset,
  adjustments,
  onPresetChange,
  onAdjustmentChange,
}: FilterPanelProps) {
  return (
    <div className={styles.root}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>滤镜预设</div>
        <div className={styles.presetGrid}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={preset === p.id ? styles.presetActive : styles.preset}
              onClick={() => onPresetChange(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>手动调整</div>
        {SLIDERS.map((s) => (
          <label key={s.key} className={styles.slider}>
            <span>{s.label}</span>
            <input
              type="range"
              min={-100}
              max={100}
              value={adjustments[s.key]}
              onChange={(e) => onAdjustmentChange(s.key, Number(e.target.value))}
            />
            <span className={styles.value}>{adjustments[s.key]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
```

Create `src/components/cover-editor/FilterPanel.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background: var(--color-surface-secondary);
  border-left: 1px solid var(--color-border-secondary);
  width: 280px;
  overflow-y: auto;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sectionTitle {
  font-size: 13px;
  font-weight: 600;
}
.presetGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.preset, .presetActive {
  padding: 8px;
  border: 1px solid var(--color-border-secondary);
  border-radius: 6px;
  background: var(--color-surface-primary);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
}
.presetActive {
  border-color: var(--color-system-blue);
  color: var(--color-system-blue);
}
.slider {
  display: grid;
  grid-template-columns: 56px 1fr 32px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4：类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5：提交**

```bash
git add src/components/cover-editor/ToolRail.tsx src/components/cover-editor/ToolRail.module.css src/components/cover-editor/Inspector.tsx src/components/cover-editor/Inspector.module.css src/components/cover-editor/FilterPanel.tsx src/components/cover-editor/FilterPanel.module.css
git commit -m "feat(cover-editor): 新增 ToolRail/Inspector/FilterPanel 子组件"
```

---

## Task 7：FontPicker + 系统字体 IPC 桥接（Phase 2，并行 B）

**目标：** Renderer 侧调用 `list-system-fonts`，提供字体选择下拉（含搜索 + @font-face 注入）。

**Files:**
- Create: `src/lib/cover-editor/system-fonts.ts`
- Create: `src/components/cover-editor/FontPicker.tsx`
- Create: `src/components/cover-editor/FontPicker.module.css`
- Modify: `electron/preload.ts`（**追加** `listSystemFonts`；**必须在 Task 3 完成后执行**）
- Modify: `src/lib/electron-api.ts`（**追加** `listSystemFonts` 类型；**必须在 Task 3 完成后执行**）

- [ ] **Step 1：在 preload.ts 追加 listSystemFonts 桥**

在 `electron/preload.ts`（已由 Task 3 追加 `saveCoverEdit`）的 `saveCoverEdit` 行下方追加：

```typescript
  listSystemFonts: () =>
    ipcRenderer.invoke('list-system-fonts') as Promise<
      import('../src/lib/cover-editor/contracts').ListSystemFontsResult
    >,
```

- [ ] **Step 2：在 electron-api.ts 追加类型**

在 `src/lib/electron-api.ts` 的 `ElectronAPI` 接口（`saveCoverEdit` 下方）追加：

```typescript
  listSystemFonts: () => Promise<import('./cover-editor/contracts').ListSystemFontsResult>;
```

- [ ] **Step 3：实现 Renderer 侧字体 helper**

Create `src/lib/cover-editor/system-fonts.ts`:

```typescript
import type { SystemFont } from './contracts';

const FALLBACKS: SystemFont[] = [
  { family: 'PingFang SC' },
  { family: 'Hiragino Sans GB' },
  { family: 'Helvetica Neue' },
  { family: 'Arial' },
];

let cache: { fonts: SystemFont[]; expireAt: number } | null = null;
const TTL_MS = 60_000;

export async function loadSystemFonts(): Promise<SystemFont[]> {
  const now = Date.now();
  if (cache && cache.expireAt > now) return cache.fonts;
  try {
    const api = (window as unknown as {
      electronAPI?: { listSystemFonts?: () => Promise<{ fonts: SystemFont[] }> };
    }).electronAPI;
    if (!api?.listSystemFonts) {
      cache = { fonts: FALLBACKS, expireAt: now + TTL_MS };
      return FALLBACKS;
    }
    const result = await api.listSystemFonts();
    cache = { fonts: result.fonts, expireAt: now + TTL_MS };
    return result.fonts;
  } catch {
    cache = { fonts: FALLBACKS, expireAt: now + TTL_MS };
    return FALLBACKS;
  }
}

const injected = new Set<string>();
export function ensureFontLoaded(family: string) {
  if (injected.has(family)) return;
  injected.add(family);
  // 通过构造一个隐藏 span 触发 CSS 字体匹配；若系统无该字体则 fallback 自动生效
  const probe = document.createElement('span');
  probe.style.fontFamily = `"${family}"`;
  probe.style.position = 'absolute';
  probe.style.left = '-9999px';
  probe.textContent = 'Aa字';
  document.body.appendChild(probe);
  window.setTimeout(() => probe.remove(), 1000);
}
```

- [ ] **Step 4：实现 FontPicker**

Create `src/components/cover-editor/FontPicker.tsx`:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './FontPicker.module.css';
import {
  ensureFontLoaded,
  loadSystemFonts,
} from '../../lib/cover-editor/system-fonts';

interface FontPickerProps {
  value: string;
  onChange: (family: string) => void;
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSystemFonts().then((list) => setFonts(list.map((f) => f.family)));
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fonts.slice(0, 50);
    return fonts.filter((f) => f.toLowerCase().includes(q)).slice(0, 50);
  }, [fonts, query]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        style={{ fontFamily: value }}
      >
        {value}
      </button>
      {open && (
        <div className={styles.popover}>
          <input
            className={styles.search}
            autoFocus
            placeholder="搜索字体…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={styles.list}>
            {filtered.map((f) => (
              <button
                key={f}
                type="button"
                className={f === value ? styles.itemActive : styles.item}
                onMouseEnter={() => ensureFontLoaded(f)}
                onClick={() => {
                  ensureFontLoaded(f);
                  onChange(f);
                  setOpen(false);
                }}
                style={{ fontFamily: f }}
              >
                {f}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className={styles.empty}>未找到匹配字体</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

Create `src/components/cover-editor/FontPicker.module.css`:

```css
.root { position: relative; flex: 1; }
.trigger {
  width: 100%; padding: 6px 10px;
  border: 1px solid var(--color-border-secondary);
  border-radius: 6px;
  background: var(--color-surface-primary);
  color: var(--color-text-primary);
  text-align: left; font-size: 12px;
}
.popover {
  position: absolute; top: calc(100% + 4px); right: 0;
  width: 240px; max-height: 320px;
  background: var(--color-surface-primary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  z-index: 10; display: flex; flex-direction: column;
}
.search {
  padding: 8px 10px;
  border: none; border-bottom: 1px solid var(--color-border-secondary);
  background: transparent; outline: none;
  color: var(--color-text-primary); font-size: 12px;
}
.list { flex: 1; overflow-y: auto; }
.item, .itemActive {
  display: block; width: 100%; padding: 6px 10px;
  border: none; background: transparent;
  color: var(--color-text-primary);
  text-align: left; cursor: pointer; font-size: 13px;
}
.item:hover { background: var(--color-surface-secondary); }
.itemActive { background: var(--color-system-blue); color: #fff; }
.empty { padding: 16px; color: var(--color-text-tertiary); font-size: 12px; text-align: center; }
```

- [ ] **Step 5：类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6：提交**

```bash
git add electron/preload.ts src/lib/electron-api.ts src/lib/cover-editor/system-fonts.ts src/components/cover-editor/FontPicker.tsx src/components/cover-editor/FontPicker.module.css
git commit -m "feat(cover-editor): FontPicker + list-system-fonts 桥接"
```

---

## Task 8：CoverEditorModal 组装（Phase 3，串行）

**目标：** 把 Task 5/6/7 拼成完整的 Modal，处理顶栏、保存模式（append / overwrite）分裂按钮、二次确认、ESC 取消。

**Files:**
- Create: `src/components/CoverEditorModal.tsx`
- Create: `src/components/CoverEditorModal.module.css`

- [ ] **Step 1：实现 CoverEditorModal**

Create `src/components/CoverEditorModal.tsx`:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui';
import { AppIcon } from './AppIcon';
import { CoverEditorCanvas } from './cover-editor/CoverEditorCanvas';
import type { CoverEditorCanvasHandle } from '../lib/cover-editor/fabric-bridge';
import { ToolRail, type EditorTool } from './cover-editor/ToolRail';
import { Inspector } from './cover-editor/Inspector';
import { FilterPanel } from './cover-editor/FilterPanel';
import { FontPicker } from './cover-editor/FontPicker';
import {
  ASPECT_RATIO_PRESETS,
  resolveAspectRatio,
} from '../lib/cover-editor/aspect-ratios';
import {
  createEmptyEditState,
  normalizeEditState,
} from '../lib/cover-editor/cover-edit-state';
import { getPresetAdjustments } from '../lib/cover-editor/filters';
import type {
  AspectRatioPreset,
  CoverEditState,
  CoverSaveMode,
  CoverTextOverlay,
  FilterPreset,
} from '../lib/cover-editor/contracts';
import styles from './CoverEditorModal.module.css';

interface CoverEditorModalProps {
  open: boolean;
  candidateId: string;
  imageUrl: string;
  prompt: string;
  initialEdits?: CoverEditState;
  timelineSize: { width: number; height: number };
  onClose: () => void;
  onSaveRequested: (args: { mode: CoverSaveMode; dataUrl: string; edits: CoverEditState }) => void;
}

export function CoverEditorModal({
  open,
  candidateId,
  imageUrl,
  prompt,
  initialEdits,
  timelineSize,
  onClose,
  onSaveRequested,
}: CoverEditorModalProps) {
  const canvasRef = useRef<CoverEditorCanvasHandle>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [preset, setPreset] = useState<AspectRatioPreset>(
    initialEdits?.aspectRatio ?? 'timeline',
  );
  const [filterPreset, setFilterPreset] = useState<FilterPreset>(
    initialEdits?.filters?.preset ?? 'none',
  );
  const [selectedText, setSelectedText] = useState<CoverTextOverlay | null>(null);
  const [saveMode, setSaveMode] = useState<CoverSaveMode>('append');
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  const initialRatio = useMemo(
    () => resolveAspectRatio(preset, timelineSize),
    [preset, timelineSize],
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleCancel();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) canvasRef.current?.redo();
        else canvasRef.current?.undo();
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function handleCancel() {
    if (dirty) {
      if (!window.confirm('未保存的修改将丢失，确定关闭吗？')) return;
    }
    onClose();
  }

  function handleAspectChange(next: AspectRatioPreset) {
    setPreset(next);
    const ratio = resolveAspectRatio(next, timelineSize);
    canvasRef.current?.setAspectRatio(ratio);
    setDirty(true);
  }

  function handleAddText() {
    canvasRef.current?.addText({ text: '标题', fontFamily: 'PingFang SC', color: '#ffffff' });
    setActiveTool('text');
    setDirty(true);
  }

  function handleSave(mode: CoverSaveMode) {
    if (mode === 'overwrite') {
      if (!window.confirm('将覆盖原图，且无法恢复，确定继续？')) return;
    }
    const dataUrl = canvasRef.current?.exportDataUrl() ?? '';
    const edits = canvasRef.current?.getEditState() ?? createEmptyEditState();
    onSaveRequested({ mode, dataUrl, edits: { ...edits, aspectRatio: preset } });
  }

  if (!open) return null;

  const adjustments = getPresetAdjustments(filterPreset);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <header className={styles.header}>
          <div className={styles.title}>
            编辑封面 · {prompt.slice(0, 24) || '未命名'}
          </div>
          <div className={styles.headerActions}>
            <select
              className={styles.aspectSelect}
              value={preset}
              onChange={(e) => handleAspectChange(e.target.value as AspectRatioPreset)}
            >
              {ASPECT_RATIO_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === 'timeline'
                    ? `时间线 ${timelineSize.width}×${timelineSize.height}`
                    : p.label}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              取消
            </Button>
            <div className={styles.saveSplit}>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleSave(saveMode)}
              >
                {saveMode === 'append' ? '另存为新候选' : '覆盖原图'}
              </Button>
              <Button.Icon
                variant="primary"
                onClick={() => setSaveMenuOpen((v) => !v)}
                aria-label="切换保存模式"
              >
                <AppIcon name="chevron-down" size={12} />
              </Button.Icon>
              {saveMenuOpen && (
                <div className={styles.saveMenu}>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveMode('append');
                      setSaveMenuOpen(false);
                    }}
                  >
                    另存为新候选
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveMode('overwrite');
                      setSaveMenuOpen(false);
                    }}
                  >
                    覆盖原图
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className={styles.body}>
          <ToolRail
            activeTool={activeTool}
            onSelectTool={(t) => {
              setActiveTool(t);
              if (t === 'text') handleAddText();
            }}
            onUndo={() => canvasRef.current?.undo()}
            onRedo={() => canvasRef.current?.redo()}
            canUndo
            canRedo
          />

          <div className={styles.canvasArea}>
            <CoverEditorCanvas
              ref={canvasRef}
              imageUrl={imageUrl}
              initialEdits={initialEdits ? normalizeEditState(initialEdits) : undefined}
              initialAspectRatio={initialRatio}
              onChange={() => setDirty(true)}
            />
          </div>

          {activeTool === 'filter' || activeTool === 'adjust' ? (
            <FilterPanel
              preset={filterPreset}
              adjustments={adjustments}
              onPresetChange={(p) => {
                setFilterPreset(p);
                canvasRef.current?.setFilterPreset(p);
              }}
              onAdjustmentChange={(k, v) => canvasRef.current?.setFilterAdjustment(k, v)}
            />
          ) : (
            <Inspector
              selectedText={selectedText}
              onUpdateText={(patch) => {
                if (!selectedText) return;
                setSelectedText({ ...selectedText, ...patch });
                setDirty(true);
              }}
              onRemoveText={() => {
                canvasRef.current?.removeSelected();
                setSelectedText(null);
              }}
              fontFamilyPicker={
                <FontPicker
                  value={selectedText?.fontFamily ?? 'PingFang SC'}
                  onChange={(family) => {
                    if (selectedText) setSelectedText({ ...selectedText, fontFamily: family });
                  }}
                />
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

Create `src/components/CoverEditorModal.module.css`:

```css
.backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  display: flex; align-items: center; justify-content: center;
}
.modal {
  width: min(1280px, 92vw);
  height: 84vh;
  background: var(--color-surface-primary);
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 72px rgba(0,0,0,0.4);
}
.header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border-secondary);
}
.title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.headerActions { display: flex; align-items: center; gap: 8px; }
.aspectSelect {
  padding: 6px 10px;
  border: 1px solid var(--color-border-secondary);
  border-radius: 6px;
  background: var(--color-surface-secondary);
  color: var(--color-text-primary);
  font-size: 12px;
}
.saveSplit { position: relative; display: flex; gap: 0; }
.saveMenu {
  position: absolute; top: calc(100% + 4px); right: 0;
  background: var(--color-surface-primary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.2);
  min-width: 160px; overflow: hidden; z-index: 20;
}
.saveMenu button {
  display: block; width: 100%; padding: 10px 14px;
  border: none; background: transparent;
  color: var(--color-text-primary); font-size: 13px;
  text-align: left; cursor: pointer;
}
.saveMenu button:hover { background: var(--color-surface-secondary); }
.body { flex: 1; display: flex; min-height: 0; }
.canvasArea { flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px; }
```

- [ ] **Step 2：类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3：提交**

```bash
git add src/components/CoverEditorModal.tsx src/components/CoverEditorModal.module.css
git commit -m "feat(cover-editor): 新增 CoverEditorModal 组件组装工具栏/画布/Inspector/滤镜面板"
```

---

## Task 9：接入 AICoverPanel / AIPanel（Phase 3，串行）

**目标：** 在候选卡片上新增「编辑」按钮；在 `AIPanel` 注入 Modal 状态与保存回调。

**Files:**
- Modify: `src/components/AICoverPanel.tsx`
- Modify: `src/components/AICoverPanel.module.css`
- Modify: `src/components/AIPanel.tsx`

- [ ] **Step 1：AICoverPanel 追加 onEditCover prop + 编辑按钮**

在 `src/components/AICoverPanel.tsx` 的 props 接口追加：

```typescript
  onEditCover: (candidateId: string) => void;
```

在组件参数解构中加上 `onEditCover`。在候选卡片渲染处（`className={joinClassNames(styles.candidateCard, ...)}` 那个 div）的 `{candidate.imageUrl ? ... : ...}` 后面、紧邻 `img` 之后追加一个叠加按钮：

```tsx
{candidate.imageUrl ? (
  <Button.Icon
    variant="secondary"
    className={styles.editButton}
    onClick={(e) => {
      e.stopPropagation();
      onEditCover(candidate.id);
    }}
    aria-label="编辑此封面"
    title="编辑此封面"
  >
    <AppIcon name="pencil-line" size={12} />
  </Button.Icon>
) : null}
```

在 `src/components/AICoverPanel.module.css` 末尾追加：

```css
.editButton {
  position: absolute;
  right: 8px;
  bottom: 8px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.candidateCard { position: relative; }
.candidateCard:hover .editButton,
.candidateCard:focus-within .editButton {
  opacity: 1;
}
```

- [ ] **Step 2：AIPanel 注入 Modal 状态与保存回调**

在 `src/components/AIPanel.tsx` 顶部 import 区追加：

```typescript
import { CoverEditorModal } from './CoverEditorModal';
import type { CoverSaveMode } from '../lib/cover-editor/contracts';
import { useTimelineStore } from '../store/timeline';
```

（若已导入 `useTimelineStore` 则不重复。）

在 `AIPanel` 函数体内、`handleSelectCover` 附近追加状态与处理：

```typescript
const [editingCoverId, setEditingCoverId] = useState<string | null>(null);
const timeline = useTimelineStore((s) => s.timeline);

const editingCandidate =
  coverCandidates.find((c) => c.id === editingCoverId) ?? null;

const handleOpenCoverEditor = useCallback((candidateId: string) => {
  setEditingCoverId(candidateId);
}, []);

const handleCloseCoverEditor = useCallback(() => {
  setEditingCoverId(null);
}, []);

const handleCoverEditSave = useCallback(
  async ({
    mode,
    dataUrl,
    edits,
  }: {
    mode: CoverSaveMode;
    dataUrl: string;
    edits: import('../lib/cover-editor/contracts').CoverEditState;
  }) => {
    if (!editingCandidate) return;
    const projectDir = getProjectDir();
    if (!projectDir) return;
    const api = window.electronAPI;
    if (!api?.saveCoverEdit) return;
    const result = await api.saveCoverEdit({
      projectDir,
      sourceCandidateId: editingCandidate.id,
      sourceImageUrl: editingCandidate.imageUrl,
      sourcePrompt: editingCandidate.prompt,
      dataUrl,
      edits,
      mode,
    });
    const store = useAIStore.getState();
    if (mode === 'append') {
      store.appendCoverCandidate({
        id: result.candidateId,
        prompt: editingCandidate.prompt,
        imageUrl: result.imageUrl,
        selected: false,
        editedFrom: result.editedFrom,
        edits,
        createdAt: result.createdAt,
      });
    } else {
      store.replaceCoverCandidate(editingCandidate.id, {
        imageUrl: `${result.imageUrl}?v=${result.createdAt}`,
        edits,
      });
    }
    setEditingCoverId(null);
  },
  [editingCandidate],
);
```

在 `<AICoverPanel ... />` 的 props 里追加：

```tsx
onEditCover={handleOpenCoverEditor}
```

在 `AIPanel` 返回的 JSX 根节点尾部（紧邻 `</Tabs>` 或同级关闭标签前）追加：

```tsx
{editingCandidate ? (
  <CoverEditorModal
    open
    candidateId={editingCandidate.id}
    imageUrl={editingCandidate.imageUrl}
    prompt={editingCandidate.prompt}
    initialEdits={editingCandidate.edits}
    timelineSize={{ width: timeline.width, height: timeline.height }}
    onClose={handleCloseCoverEditor}
    onSaveRequested={handleCoverEditSave}
  />
) : null}
```

- [ ] **Step 3：类型检查 + 既有测试**

Run: `npx tsc --noEmit && npm test`
Expected: 类型通过；既有测试不回归。

- [ ] **Step 4：提交**

```bash
git add src/components/AICoverPanel.tsx src/components/AICoverPanel.module.css src/components/AIPanel.tsx
git commit -m "feat(ai-cover): AICoverPanel 卡片新增编辑入口，AIPanel 集成 CoverEditorModal"
```

---

## Task 10：回归测试 + UI 打磨（Phase 3，串行）

**目标：** 端到端手动走查 + 补充 Modal 级测试（mock Fabric） + 样式打磨。

**Files:**
- Create: `tests/cover-editor-modal.test.tsx`
- Modify: 上述任意组件的样式细节（若发现问题）

- [ ] **Step 1：编写 Modal 集成测试（mock Fabric）**

Create `tests/cover-editor-modal.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoverEditorModal } from '../src/components/CoverEditorModal';

vi.mock('fabric', () => ({
  Canvas: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    dispose: vi.fn(),
    add: vi.fn(),
    sendObjectToBack: vi.fn(),
    requestRenderAll: vi.fn(),
    toDataURL: () => 'data:image/png;base64,AAAA',
    toJSON: () => ({}),
    loadFromJSON: (_s: string, cb: () => void) => cb(),
    getActiveObjects: () => [],
    discardActiveObject: vi.fn(),
    getObjects: () => [],
    setActiveObject: vi.fn(),
    remove: vi.fn(),
  })),
  FabricImage: { fromURL: () => Promise.resolve({ set: vi.fn(), scale: vi.fn(), width: 1, height: 1, filters: [], applyFilters: vi.fn() }) },
  Textbox: vi.fn(),
  Rect: vi.fn(),
  filters: {
    Brightness: vi.fn(), Contrast: vi.fn(), Saturation: vi.fn(),
  },
}));

describe('CoverEditorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('open=false 不渲染', () => {
    const { container } = render(
      <CoverEditorModal
        open={false}
        candidateId="a"
        imageUrl="/x.png"
        prompt="x"
        timelineSize={{ width: 1920, height: 1080 }}
        onClose={() => {}}
        onSaveRequested={() => {}}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('open=true 渲染标题与比例下拉', async () => {
    render(
      <CoverEditorModal
        open
        candidateId="a"
        imageUrl="/x.png"
        prompt="测试封面"
        timelineSize={{ width: 1920, height: 1080 }}
        onClose={() => {}}
        onSaveRequested={() => {}}
      />,
    );
    expect(screen.getByText(/编辑封面/)).toBeInTheDocument();
    expect(screen.getByText(/时间线 1920×1080/)).toBeInTheDocument();
  });

  it('点击保存触发 onSaveRequested 并传 append 模式', async () => {
    const onSave = vi.fn();
    render(
      <CoverEditorModal
        open
        candidateId="a"
        imageUrl="/x.png"
        prompt="x"
        timelineSize={{ width: 1920, height: 1080 }}
        onClose={() => {}}
        onSaveRequested={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /另存为新候选/ }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'append' }),
    );
  });
});
```

- [ ] **Step 2：运行测试**

Run: `npx vitest run tests/cover-editor-modal.test.tsx`
Expected: PASS。

- [ ] **Step 3：运行全量测试**

Run: `npm test`
Expected: 所有测试通过。

- [ ] **Step 4：手动走查（记录结果，不自动通过）**

手动在开发环境验证：

```bash
npm run dev
```

检查项：
1. AI 面板 → 封面 Tab → 生成封面候选
2. hover 某张候选 → 出现编辑按钮
3. 点击编辑 → 打开 Modal
4. 切换比例（时间线 / 16:9 / 9:16 / 1:1）→ 画布 clipPath 更新
5. 点击文字工具 → 画布出现"标题"文本，Inspector 显示属性
6. 更改字体（FontPicker 打开搜索 → 选择其他字体）→ 文本字体变化
7. 点击滤镜工具 → 右侧切换 FilterPanel → 切换黑白预设 → 画布变灰
8. 撤销 / 重做（⌘Z / ⌘⇧Z）→ 状态正确回滚
9. 「另存为新候选」→ 列表新增一张，`editedFrom` 正确
10. 关闭 Modal → 重新打开新候选 → 编辑状态恢复
11. 切换到覆盖模式 → 二次确认 → 原图被替换（`?v=` 时间戳更新）
12. ESC / 点取消 → 未保存时二次确认
13. 拖动编辑后的封面到时间轴 → 正常作为背景

记录任何 UI 异常在本 PR 中修复。

- [ ] **Step 5：构建验证**

Run: `npm run build`
Expected: 构建通过；`dist-electron/` 与 `dist/` 正常产出。

- [ ] **Step 6：提交打磨（若有）**

```bash
git add <changed files>
git commit -m "polish(cover-editor): 手动走查后的样式与交互打磨"
```

---

## 并行派发指引

建议派发顺序：

```
Step A (串行):
  派单个 agent 执行 Task 1

Step B (并行组 A，Task 1 完成后):
  同时派 3 个 agent 分别执行 Task 2、Task 3、Task 4

Step C (并行组 B，组 A 全部完成后):
  同时派 3 个 agent 分别执行 Task 5、Task 6、Task 7

Step D (串行):
  Task 8 → Task 9 → Task 10
```

**每个 agent 的派发提示模板：**

```
你是专注任务 Task N 的实施代理。
工作树：<worktree-path>
计划文档：docs/superpowers/plans/2026-04-21-ai-cover-image-editor.md
设计文档：docs/superpowers/specs/2026-04-21-ai-cover-image-editor-design.md

只执行 Task N 的所有步骤（不要多做）。
scope_write：<此处从任务表粘贴>
scope_read：<此处从任务表粘贴>
完成后报告：
- 是否全部步骤通过
- 实际 commit hash
- 遇到任何偏离计划的情况
```

---

## Self-Review 备注

- Spec 覆盖：✅ P0/P1 全部功能映射到 Task 2-9；✅ 双模式保存在 Task 3 与 Task 8；✅ 系统字体在 Task 3 + Task 7；✅ 再编辑恢复在 Task 5 `loadEditState` + Task 9 `initialEdits` 传参。
- 类型一致性：`CoverEditState`、`CoverTextOverlay`、`CoverSaveMode`、`SaveCoverEditArgs` 均集中在 `contracts.ts`；所有任务 import 同一定义。
- 冲突面：`electron/preload.ts` 与 `src/lib/electron-api.ts` 由 Task 3 与 Task 7 分别追加不同条目，并在计划中强制顺序。
- 无占位：所有步骤均含完整代码块。
- YAGNI：P2（画笔/马赛克）、P3（形状/模板/抠图）不在计划内，避免超范围。

# Inspector Project Overview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把右侧 Inspector 的 empty 态改成项目概览面板，在未选中任何对象时展示项目路径、大小、创建时间、分辨率等基础信息。

**Architecture:** `Editor` 负责获取异步项目元数据并把结果下传；`EditorInspector` 负责根据当前选择路由具体面板；新增 `ProjectOverviewPanel` 负责渲染项目基础信息。Electron 主进程新增轻量 IPC 返回项目目录大小与创建时间，避免渲染层直接触碰 Node 文件系统。

**Tech Stack:** React 19、TypeScript、Electron IPC、Zustand、Vitest

---

## Chunk 1: 测试先行与 Inspector 路由改造

### Task 1: 锁定 empty 态的新语义

**Files:**
- Modify: `tests/editor-inspector.test.tsx`
- Modify: `src/components/EditorInspector.tsx`

- [ ] **Step 1: 写失败测试**

在 `tests/editor-inspector.test.tsx` 增加一个 empty 态用例，断言：

- 存在“项目概览”或等价标题
- 存在项目路径
- 存在分辨率与 FPS
- 不再出现旧文案“从左侧 AI 内容卡片或底部时间轴中选择一个对象后”

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/editor-inspector.test.tsx`

Expected: FAIL，因为当前 empty 态还是 `EmptyState`

- [ ] **Step 3: 扩展 Inspector props**

为 `EditorInspector` 增加项目概览所需 props，例如：

- `projectDir`
- `projectMetadata`
- `isProjectMetadataLoading`
- `assetCount`

- [ ] **Step 4: 运行测试确认接口仍未满足**

Run: `npm test -- tests/editor-inspector.test.tsx`

Expected: 仍然 FAIL，但失败收敛到渲染内容不匹配

## Chunk 2: 项目概览组件实现

### Task 2: 新增 ProjectOverviewPanel

**Files:**
- Create: `src/components/ProjectOverviewPanel.tsx`
- Create: `src/components/ProjectOverviewPanel.module.css`
- Modify: `src/components/EditorInspector.tsx`

- [ ] **Step 1: 写最小展示实现**

创建 `ProjectOverviewPanel`，展示：

- 项目名
- 项目路径
- 目录大小
- 创建时间
- 分辨率
- FPS
- 素材数量
- 图层数量

- [ ] **Step 2: 在 EditorInspector empty 分支接入**

把 empty 分支从 `EmptyState` 改为 `ProjectOverviewPanel`

- [ ] **Step 3: 运行测试确认通过**

Run: `npm test -- tests/editor-inspector.test.tsx`

Expected: PASS

## Chunk 3: Electron 项目元数据链路

### Task 3: 新增共享类型与 preload / IPC

**Files:**
- Modify: `src/lib/electron-api.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: 写失败测试或类型约束**

优先通过组件集成行为验证，不额外扩大测试面；若实现中抽出格式化纯函数，可补对应测试。

- [ ] **Step 2: 定义共享返回结构**

在 `src/lib/electron-api.ts` 中增加：

```ts
export interface ProjectMetadata {
  projectDir: string;
  sizeBytes: number;
  createdAtMs: number;
}
```

并为 `ElectronAPI` 增加：

```ts
getProjectMetadata: (projectDir: string) => Promise<ProjectMetadata>;
```

- [ ] **Step 3: 在 preload 暴露新能力**

新增 `ipcRenderer.invoke('get-project-metadata', projectDir)`

- [ ] **Step 4: 在主进程实现目录遍历**

实现异步目录统计逻辑：

- 读取根目录 `stat`
- 递归累计文件字节数
- 返回 `projectDir / sizeBytes / createdAtMs`

- [ ] **Step 5: 运行局部测试**

Run: `npm test -- tests/electron-api.test.ts tests/editor-inspector.test.tsx`

Expected: PASS

## Chunk 4: Editor 拉取元数据并下传

### Task 4: 在 Editor 中维护项目元数据状态

**Files:**
- Modify: `src/pages/Editor.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 写失败测试（如需要）**

如果现有测试已被 `EditorInspector` 覆盖，可不单独新增 Editor 测试，避免过度测试实现细节。

- [ ] **Step 2: 透传 projectDir**

`App` 把 `currentProjectDir` 传给 `Editor`

- [ ] **Step 3: 在 Editor 中拉取元数据**

使用 `useEffect`：

- 没有 `projectDir` 时清空状态
- 有 `projectDir` 时设置 loading
- 调 `window.electronAPI.getProjectMetadata(projectDir)`
- 成功写入 metadata
- 失败时降级为空并结束 loading

- [ ] **Step 4: 把数据传给 EditorInspector**

保证 empty 态和有选区态都能安全渲染

- [ ] **Step 5: 运行相关测试**

Run: `npm test -- tests/editor.test.tsx tests/editor-inspector.test.tsx`

Expected: PASS

## Chunk 5: 最终验证

### Task 5: 回归验证

**Files:**
- Verify only

- [ ] **Step 1: 运行目标测试集**

Run: `npm test -- tests/editor-inspector.test.tsx tests/editor.test.tsx tests/electron-api.test.ts`

Expected: PASS

- [ ] **Step 2: 运行构建验证**

Run: `npm run build`

Expected: exit code 0

- [ ] **Step 3: 人工检查**

确认以下体验：

- 新建项目且未选中对象时，右侧不再是空文案
- 路径 / 大小 / 创建时间 / 分辨率可见
- 选中 AI 卡片、字幕、文字 overlay 时仍然正常切换到对应 Inspector


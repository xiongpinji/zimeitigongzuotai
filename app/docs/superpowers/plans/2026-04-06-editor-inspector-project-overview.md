# Editor Inspector Project Overview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将右侧 Inspector 在未选中对象时改为项目概览面板，展示项目路径、目录大小、创建时间、分辨率等基础信息。

**Architecture:** 保持 `EditorInspector` 现有选择态路由不变，仅替换 `empty` 分支为项目概览内容。项目路径、分辨率、FPS、overlay 数从前端现有状态读取；目录大小和创建时间通过新增 Electron 只读 IPC 获取。实现按 TDD 执行，先覆盖 `EditorInspector` empty 态渲染，再补 IPC 与组件逻辑。

**Tech Stack:** React 19、TypeScript、Zustand、Electron、Vitest

---

## Chunk 1: 测试与项目元数据链路

### Task 1: 为 Inspector empty 态写失败测试

**Files:**
- Modify: `tests/editor-inspector.test.tsx`

- [ ] **Step 1: 写 empty 态失败测试**

添加一个 `selection={{ type: 'empty' }}` 的渲染用例，断言页面出现“项目概览”、项目路径、目录大小、创建时间、分辨率、FPS、overlay 数。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/editor-inspector.test.tsx`
Expected: FAIL，原因是当前 empty 态仍渲染空状态文案，未渲染项目概览字段。

### Task 2: 新增项目目录元数据 IPC

**Files:**
- Modify: `src/lib/electron-api.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

- [ ] **Step 3: 补充前端 API 类型**

在 `src/lib/electron-api.ts` 中新增 `ProjectMeta` 类型和 `getProjectMeta(projectDir)` API 声明。

- [ ] **Step 4: 补充 preload 转发**

在 `electron/preload.ts` 中桥接 `ipcRenderer.invoke('get-project-meta', projectDir)`。

- [ ] **Step 5: 实现主进程 IPC**

在 `electron/main.ts` 中新增 `ipcMain.handle('get-project-meta', ...)`：
- 校验目录存在
- 读取根目录 `stat.birthtimeMs`
- 递归统计目录总字节数
- 返回 `projectName`、`projectPath`、`createdAt`、`sizeBytes`

- [ ] **Step 6: 运行测试，确认仍因 UI 未实现而失败**

Run: `npm test -- tests/editor-inspector.test.tsx`
Expected: 仍 FAIL，但不应出现新增类型或导入错误。

## Chunk 2: Inspector UI 实现

### Task 3: 实现项目概览面板

**Files:**
- Modify: `src/components/EditorInspector.tsx`
- Modify: `src/components/EditorInspector.module.css`

- [ ] **Step 7: 实现 empty 态项目概览渲染**

在 `EditorInspector` 中：
- 安全读取当前项目路径
- 在客户端通过 `window.electronAPI?.getProjectMeta` 拉取项目目录信息
- 将 empty 态替换为项目概览内容
- 对缺失值使用 `--`

- [ ] **Step 8: 实现格式化辅助逻辑**

在组件内或局部辅助函数中补齐：
- 字节数转 `KB/MB/GB`
- 时间转本地可读时间
- 分辨率组合显示

- [ ] **Step 9: 调整样式**

新增信息列表、标题、说明、键值对、路径换行等样式，移除 empty 态居中空盒依赖。

- [ ] **Step 10: 运行测试确认通过**

Run: `npm test -- tests/editor-inspector.test.tsx`
Expected: PASS

## Chunk 3: 回归验证

### Task 4: 运行相关回归测试

**Files:**
- Test: `tests/editor-inspector.test.tsx`
- Test: `tests/editor.test.tsx`

- [ ] **Step 11: 运行关联测试**

Run: `npm test -- tests/editor-inspector.test.tsx tests/editor.test.tsx`
Expected: PASS

- [ ] **Step 12: 检查实现范围**

确认仅影响：
- `empty` 态 Inspector
- 项目元数据读取链路

确认未影响：
- AI card Inspector
- Subtitle Inspector
- Text Inspector

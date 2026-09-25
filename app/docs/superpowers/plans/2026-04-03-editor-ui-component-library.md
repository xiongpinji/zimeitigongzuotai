# Editor UI Component Library Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为编辑器 UI 建立基础组件库与 design tokens，并完成第一轮高收益替换，降低后续新增功能的实现成本。

**Architecture:** 采用 `src/ui/*` 作为新的基础组件层，使用 `CSS Modules + CSS Variables` 管理编辑器 UI 的基础视觉与交互状态；`src/components/*` 保持业务编排职责，逐步迁移为消费 `src/ui/*`。`src/remotion/*` 保持现状，不纳入本轮改造。

**Tech Stack:** React 19, TypeScript, Vite, Electron, Vitest, CSS Modules

---

## Chunk 1: 建立组件库基础层

### Task 1: 创建 UI styles 入口与 token 文件

**Files:**
- Create: `src/ui/styles/tokens.css`
- Create: `src/ui/styles/base.css`
- Modify: `src/main.tsx`
- Test: `tests/editor.test.tsx`

- [ ] Step 1: 在 `src/ui/styles/tokens.css` 中定义首批 token
- [ ] Step 2: 在 `src/ui/styles/base.css` 中加入基础 body、button、focus-visible 样式
- [ ] Step 3: 在 `src/main.tsx` 引入上述 CSS 文件
- [ ] Step 4: 运行 `npm test -- tests/editor.test.tsx`
- [ ] Step 5: 确认应用入口仍可正常渲染

### Task 2: 建立 UI 导出边界

**Files:**
- Create: `src/ui/index.ts`
- Create: `src/ui/primitives/index.ts`

- [ ] Step 1: 新建 `src/ui/index.ts` 作为统一出口
- [ ] Step 2: 新建 `src/ui/primitives/index.ts` 作为 primitives barrel
- [ ] Step 3: 仅暴露真正稳定的基础组件接口

## Chunk 2: 实现第一批 primitives

### Task 3: 实现 Button 与 IconButton

**Files:**
- Create: `src/ui/primitives/Button.tsx`
- Create: `src/ui/primitives/Button.module.css`
- Create: `src/ui/primitives/IconButton.tsx`
- Create: `src/ui/primitives/IconButton.module.css`
- Test: `tests/toolbar.test.tsx`
- Test: `tests/ai-cover-panel.test.tsx`

- [ ] Step 1: 设计 `Button` props：`variant`、`size`、`loading`、`disabled`
- [ ] Step 2: 在 CSS Modules 中实现 `primary | secondary | danger | tint | ghost`
- [ ] Step 3: 设计 `IconButton` props：`variant`、`size`、`aria-label`
- [ ] Step 4: 为 hover、focus-visible、disabled、loading 写清样式状态
- [ ] Step 5: 运行 `npm test -- tests/toolbar.test.tsx tests/ai-cover-panel.test.tsx`

### Task 4: 实现 Input、Textarea、Field

**Files:**
- Create: `src/ui/primitives/Input.tsx`
- Create: `src/ui/primitives/Input.module.css`
- Create: `src/ui/primitives/Textarea.tsx`
- Create: `src/ui/primitives/Textarea.module.css`
- Create: `src/ui/primitives/Field.tsx`
- Create: `src/ui/primitives/Field.module.css`
- Test: `tests/ai-settings-modal.test.tsx`
- Test: `tests/ai-card-edit-modal.test.tsx`

- [ ] Step 1: 实现 `Input` 和 `Textarea` 的基础样式壳层
- [ ] Step 2: 实现 `Field`，支持 `label`、`hint`、`error`
- [ ] Step 3: 保证输入组件支持完整键盘 focus 状态
- [ ] Step 4: 运行 `npm test -- tests/ai-settings-modal.test.tsx tests/ai-card-edit-modal.test.tsx`

### Task 5: 实现 Badge、EmptyState、ProgressBar

**Files:**
- Create: `src/ui/primitives/Badge.tsx`
- Create: `src/ui/primitives/Badge.module.css`
- Create: `src/ui/primitives/EmptyState.tsx`
- Create: `src/ui/primitives/EmptyState.module.css`
- Create: `src/ui/primitives/ProgressBar.tsx`
- Create: `src/ui/primitives/ProgressBar.module.css`
- Test: `tests/export-progress.test.tsx`
- Test: `tests/ai-panel.test.tsx`

- [ ] Step 1: 为 `Badge` 定义 `variant` 与 `shape`
- [ ] Step 2: 为 `EmptyState` 提供 `title`、`description`、`actions` 插槽
- [ ] Step 3: 为 `ProgressBar` 提供 `value`、`tone`
- [ ] Step 4: 运行 `npm test -- tests/export-progress.test.tsx tests/ai-panel.test.tsx`

### Task 6: 实现 ModalShell

**Files:**
- Create: `src/ui/primitives/ModalShell.tsx`
- Create: `src/ui/primitives/ModalShell.module.css`
- Test: `tests/ai-settings-modal.test.tsx`
- Test: `tests/ai-card-edit-modal.test.tsx`
- Test: `tests/export-settings-modal.test.tsx`
- Test: `tests/export-progress.test.tsx`

- [ ] Step 1: 抽象 overlay、container、header、body、footer 结构
- [ ] Step 2: 提供 `size`、`zIndex`、`title`、`eyebrow`、`footer` 等 props
- [ ] Step 3: 保留 `createPortal` 能力，避免影响现有 modal 行为
- [ ] Step 4: 运行 `npm test -- tests/ai-settings-modal.test.tsx tests/ai-card-edit-modal.test.tsx tests/export-settings-modal.test.tsx tests/export-progress.test.tsx`

## Chunk 3: 替换四个 modal

### Task 7: 迁移 AISettingsModal

**Files:**
- Modify: `src/components/AISettingsModal.tsx`
- Test: `tests/ai-settings-modal.test.tsx`

- [ ] Step 1: 用 `ModalShell` 替换原 overlay 与容器结构
- [ ] Step 2: 用 `Field` + `Input` 替换内部字段
- [ ] Step 3: 用统一 `Button` 替换取消 / 保存按钮
- [ ] Step 4: 运行 `npm test -- tests/ai-settings-modal.test.tsx`

### Task 8: 迁移 AICardEditModal

**Files:**
- Modify: `src/components/AICardEditModal.tsx`
- Test: `tests/ai-card-edit-modal.test.tsx`

- [ ] Step 1: 用 `ModalShell` 重构外层结构
- [ ] Step 2: 用 `Field`、`Input`、`Textarea` 替换表单输入区
- [ ] Step 3: 把卡片类型和展示方式的 pill 行为迁移到 `Button` / `Badge` 组合
- [ ] Step 4: 运行 `npm test -- tests/ai-card-edit-modal.test.tsx`

### Task 9: 迁移 ExportSettingsModal 与 ExportProgress

**Files:**
- Modify: `src/components/ExportSettingsModal.tsx`
- Modify: `src/components/ExportProgress.tsx`
- Test: `tests/export-settings-modal.test.tsx`
- Test: `tests/export-progress.test.tsx`

- [ ] Step 1: 用 `ModalShell` 统一导出相关 modal 壳层
- [ ] Step 2: 用 `Button`、`Badge`、`ProgressBar` 替换重复结构
- [ ] Step 3: 运行 `npm test -- tests/export-settings-modal.test.tsx tests/export-progress.test.tsx`

## Chunk 4: 引入 pattern 组件并迁移高频交互区

### Task 10: 实现 PanelHeader、TabBar、SearchField、ActionBar

**Files:**
- Create: `src/ui/patterns/PanelHeader.tsx`
- Create: `src/ui/patterns/PanelHeader.module.css`
- Create: `src/ui/patterns/TabBar.tsx`
- Create: `src/ui/patterns/TabBar.module.css`
- Create: `src/ui/patterns/SearchField.tsx`
- Create: `src/ui/patterns/SearchField.module.css`
- Create: `src/ui/patterns/ActionBar.tsx`
- Create: `src/ui/patterns/ActionBar.module.css`
- Create: `src/ui/patterns/index.ts`

- [ ] Step 1: 为面板头部抽出统一布局和图标操作区
- [ ] Step 2: 为 tab 切换抽出统一样式和 active 态
- [ ] Step 3: 为搜索输入抽出统一外观
- [ ] Step 4: 为批量操作条抽出统一布局

### Task 11: 迁移 AIPanel 与 AICoverPanel

**Files:**
- Modify: `src/components/AIPanel.tsx`
- Modify: `src/components/AICoverPanel.tsx`
- Test: `tests/ai-panel.test.tsx`
- Test: `tests/ai-cover-panel.test.tsx`

- [ ] Step 1: 用 `PanelHeader`、`TabBar`、`Button`、`IconButton` 替换头部与 tab
- [ ] Step 2: 用 `EmptyState`、`Badge`、`Field`、`Textarea` 迁移提示词区与状态区
- [ ] Step 3: 清理重复样式常量，尽量保留业务逻辑不变
- [ ] Step 4: 运行 `npm test -- tests/ai-panel.test.tsx tests/ai-cover-panel.test.tsx`

### Task 12: 迁移 AssetPanel、AICardList、AssetCard

**Files:**
- Modify: `src/components/AssetPanel.tsx`
- Modify: `src/components/AICardList.tsx`
- Modify: `src/components/AssetCard.tsx`
- Test: `tests/asset-panel.test.tsx`
- Test: `tests/ai-card-list.test.tsx`

- [ ] Step 1: 用 `SearchField`、`Badge`、`IconButton` 迁移素材筛选区
- [ ] Step 2: 用 `Badge`、`Button`、`IconButton` 迁移卡片列表项状态表达
- [ ] Step 3: 运行 `npm test -- tests/asset-panel.test.tsx tests/ai-card-list.test.tsx`

## Chunk 5: 页面级整理与最终验证

### Task 13: 迁移 Toolbar、PreviewPanel、页面接入层

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/components/PreviewPanel.tsx`
- Modify: `src/pages/Editor.tsx`
- Modify: `src/pages/Setup.tsx`
- Test: `tests/toolbar.test.tsx`
- Test: `tests/preview-panel.test.tsx`
- Test: `tests/editor.test.tsx`

- [ ] Step 1: 用 `Button`、`Badge`、`PanelHeader` 思路统一页面级按钮与状态展示
- [ ] Step 2: 确保页面级入口已消费 `src/ui/*`
- [ ] Step 3: 运行 `npm test -- tests/toolbar.test.tsx tests/preview-panel.test.tsx tests/editor.test.tsx`

### Task 14: 回归验证与清理

**Files:**
- Modify: `src/components/*`
- Modify: `src/ui/*`
- Test: `tests/*.test.tsx`

- [ ] Step 1: 删除已无引用的重复样式常量
- [ ] Step 2: 执行 `npm test`
- [ ] Step 3: 执行 `npm run build`
- [ ] Step 4: 手动检查 modal、按钮、输入框、tab、空状态、导出流程
- [ ] Step 5: 总结剩余 inline style 与下一阶段可继续抽取的模式

## 交付完成定义

- [ ] `src/ui/*` 已建立稳定边界
- [ ] 4 个 modal 完成统一壳层替换
- [ ] 编辑器侧已具备统一 hover / focus-visible / disabled 状态
- [ ] 新增功能可以优先使用组件库 primitives / patterns 拼装
- [ ] 测试与构建均通过

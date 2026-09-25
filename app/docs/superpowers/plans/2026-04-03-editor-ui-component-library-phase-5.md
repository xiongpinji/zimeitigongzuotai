# Editor UI Component Library Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans 或同等级执行流程落实本计划，并在完成后补充验证结果。

**Goal:** 把 AI 助手区域中样式密集、交互频繁的列表与编辑面板收敛到 CSS Modules 与复用模式组件，继续压缩 inline style 面积，为后续新增 AI 功能留出稳定扩展点。

**Architecture:** 本轮聚焦 `AICoverPanel`、`AICardList`、`AICardEditModal` 与 `AIPanel` 外壳层。保留 AI 分析、持久化、时间线同步与封面生成逻辑不变，只迁移视觉壳层、选择器、提示与编辑器布局。

**Tech Stack:** React 19, TypeScript, Vite, Vitest, CSS Modules

---

## Chunk 1: 收敛 AI 子组件样式边界

### Task 1: 迁移 AICoverPanel

**Files:**
- Create: `src/components/AICoverPanel.module.css`
- Modify: `src/components/AICoverPanel.tsx`
- Test: `tests/ai-cover-panel.test.tsx`

- [ ] Step 1: 将提示词展示、候选封面网格、拖拽卡片样式迁入 CSS Modules
- [ ] Step 2: 保持提示词编辑、重生成和设为背景逻辑不变
- [ ] Step 3: 验证候选封面仍可拖拽并保留选中态

### Task 2: 迁移 AICardList

**Files:**
- Create: `src/components/AICardList.module.css`
- Modify: `src/components/AICardList.tsx`
- Test: `tests/ai-card-list.test.tsx`

- [ ] Step 1: 将卡片列表、类型标记、选择按钮和上轨状态展示迁入 CSS Modules
- [ ] Step 2: 复用 `SurfaceCard`、`Badge`、`IconButton` 等基础组件
- [ ] Step 3: 验证启用/删除/编辑入口不回归

### Task 3: 迁移 AICardEditModal

**Files:**
- Create: `src/components/AICardEditModal.module.css`
- Modify: `src/components/AICardEditModal.tsx`
- Create: `src/ui/patterns/PillGroup.tsx`
- Create: `src/ui/patterns/PillGroup.module.css`
- Modify: `src/ui/patterns/index.ts`
- Test: `tests/ai-card-edit-modal.test.tsx`

- [ ] Step 1: 将编辑表单、预览舞台和位置标签迁入 CSS Modules
- [ ] Step 2: 抽出 `PillGroup` 作为可复用选择器模式，替代局部按钮组
- [ ] Step 3: 验证编辑模态框中的预览与重生成 loading 态不变

## Chunk 2: 收敛 AIPanel 外壳与状态反馈

### Task 4: 迁移 AIPanel shell

**Files:**
- Create: `src/components/AIPanel.module.css`
- Modify: `src/components/AIPanel.tsx`
- Test: `tests/ai-panel.test.tsx`

- [ ] Step 1: 将 AI 助手外壳、空态、分析态、覆盖层和底部动作条迁入 CSS Modules
- [ ] Step 2: 将 `HoverHint` 改为 CSS hover/focus 驱动，减少本地状态与 inline style
- [ ] Step 3: 保持 AI 分析、选择、删除、应用到时间线逻辑不变

## Chunk 3: 最终验证

### Task 5: 回归验证与下一阶段记录

**Files:**
- Modify: `src/components/*`
- Modify: `src/ui/patterns/*`
- Test: `tests/*.test.tsx`

- [ ] Step 1: 执行 `npm test -- tests/ai-cover-panel.test.tsx tests/ai-card-list.test.tsx tests/ai-card-edit-modal.test.tsx tests/ai-panel.test.tsx`
- [ ] Step 2: 执行 `npm test`
- [ ] Step 3: 执行 `npm run build`
- [ ] Step 4: 执行 `git diff --check`
- [ ] Step 5: 记录下一轮优先目标，建议继续处理 `AISettingsModal` 与 `WebCardPreview`

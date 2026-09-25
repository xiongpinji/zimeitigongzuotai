# Editor UI Component Library Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 继续把编辑器壳层与素材库高频视觉结构收敛到组件库和 CSS Modules，降低后续功能迭代时的页面重复样式成本。

**Architecture:** 本轮优先覆盖编辑器工作区壳层、工具栏、素材缩略图和素材卡片系统。对 `Timeline` 主逻辑保持只读和局部包裹，不做高风险行为重构；重点通过新增基础占位组件和页面级样式边界来扩展 `src/ui/*` 的复用能力。

**Tech Stack:** React 19, TypeScript, Vite, Vitest, CSS Modules

---

## Chunk 1: 扩展可复用素材视觉基础件

### Task 1: 新增 MediaPlaceholder 并接入 AssetThumbnail

**Files:**
- Create: `src/ui/primitives/MediaPlaceholder.tsx`
- Create: `src/ui/primitives/MediaPlaceholder.module.css`
- Modify: `src/ui/primitives/index.ts`
- Modify: `src/components/AssetThumbnail.tsx`
- Create: `src/components/AssetThumbnail.module.css`
- Modify: `tests/ui-primitives.test.tsx`

- [ ] Step 1: 新增 `MediaPlaceholder` 支持 `audio | srt | generic`
- [ ] Step 2: 用 `MediaPlaceholder` 重写 `AssetThumbnail` 的占位渲染逻辑
- [ ] Step 3: 把图片和视频预览样式迁到 CSS Modules
- [ ] Step 4: 扩展基础测试覆盖新 primitive

## Chunk 2: 迁移素材卡片系统与编辑器壳层

### Task 2: 迁移 AssetCard 与 AssetPanel

**Files:**
- Create: `src/components/AssetCard.module.css`
- Create: `src/components/AssetPanel.module.css`
- Modify: `src/components/AssetCard.tsx`
- Modify: `src/components/AssetPanel.tsx`
- Test: `tests/asset-panel.test.tsx`

- [ ] Step 1: 把素材卡片缩略图外壳、状态徽标、文案区迁到 CSS Modules
- [ ] Step 2: 把素材库容器、筛选条、空状态包裹迁到 CSS Modules
- [ ] Step 3: 保持拖拽和删除逻辑不变
- [ ] Step 4: 运行素材面板相关测试

### Task 3: 迁移 Toolbar 与 Editor 壳层

**Files:**
- Create: `src/components/Toolbar.module.css`
- Create: `src/pages/Editor.module.css`
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/pages/Editor.tsx`
- Modify: `tests/editor.test.tsx`
- Test: `tests/toolbar.test.tsx`
- Test: `tests/editor.test.tsx`

- [ ] Step 1: 把 toolbar 的标题栏壳层和状态芯片迁到 CSS Modules
- [ ] Step 2: 把 editor 工作区、右侧面板壳层、时间线包裹迁到 CSS Modules
- [ ] Step 3: 用更语义化的标记更新 editor 测试，避免依赖具体 inline style 字符串
- [ ] Step 4: 运行工具栏和编辑器测试

## Chunk 3: 最终验证

### Task 4: 回归验证与剩余风险记录

**Files:**
- Modify: `src/components/*`
- Modify: `src/pages/*`
- Modify: `src/ui/*`
- Test: `tests/*.test.tsx`

- [ ] Step 1: 执行 `npm test -- tests/ui-primitives.test.tsx tests/asset-panel.test.tsx tests/toolbar.test.tsx tests/editor.test.tsx`
- [ ] Step 2: 执行 `npm test`
- [ ] Step 3: 执行 `npm run build`
- [ ] Step 4: 记录剩余高复杂度区域（如 Timeline 主体、OverlayBlock）

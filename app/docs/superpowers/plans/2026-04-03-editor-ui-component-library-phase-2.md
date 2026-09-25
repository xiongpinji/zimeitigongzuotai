# Editor UI Component Library Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 继续把编辑器页面壳层中的高频基础结构沉到组件库，并完成导入页、预览区、导出配置区的第二轮迁移。

**Architecture:** 在 `src/ui/*` 中补齐页面级表面容器、选择卡片、拖拽导入卡片等通用模式；业务页面通过 CSS Modules 消费这些模式，减少高频入口页的 inline style 与视觉重复。`Timeline` 主逻辑暂不重构，避免把第二阶段扩成高风险行为改造。

**Tech Stack:** React 19, TypeScript, Vite, Vitest, CSS Modules

---

## Chunk 1: 扩展页面级基础模式

### Task 1: 新增 SurfaceCard、SelectionCard、FileDropCard

**Files:**
- Create: `src/ui/primitives/SurfaceCard.tsx`
- Create: `src/ui/primitives/SurfaceCard.module.css`
- Create: `src/ui/patterns/SelectionCard.tsx`
- Create: `src/ui/patterns/SelectionCard.module.css`
- Create: `src/ui/patterns/FileDropCard.tsx`
- Create: `src/ui/patterns/FileDropCard.module.css`
- Modify: `src/ui/primitives/index.ts`
- Modify: `src/ui/patterns/index.ts`
- Modify: `tests/ui-primitives.test.tsx`

- [ ] Step 1: 为页面级容器新增 `SurfaceCard`
- [ ] Step 2: 为导出选项新增 `SelectionCard`
- [ ] Step 3: 为导入页拖拽卡片新增 `FileDropCard`
- [ ] Step 4: 更新 barrel 导出
- [ ] Step 5: 扩展 UI 基础测试

## Chunk 2: 迁移页面壳层

### Task 2: 迁移 Setup 页

**Files:**
- Create: `src/pages/Setup.module.css`
- Modify: `src/pages/Setup.tsx`
- Create: `tests/setup.test.tsx`

- [ ] Step 1: 用 `SurfaceCard` 和 `FileDropCard` 替换导入页的重复容器
- [ ] Step 2: 把布局样式迁到 CSS Modules
- [ ] Step 3: 补上 Setup 渲染回归测试

### Task 3: 迁移 PreviewPanel、ExportSettingsModal、ExportProgress

**Files:**
- Create: `src/components/PreviewPanel.module.css`
- Create: `src/components/ExportSettingsModal.module.css`
- Create: `src/components/ExportProgress.module.css`
- Modify: `src/components/PreviewPanel.tsx`
- Modify: `src/components/ExportSettingsModal.tsx`
- Modify: `src/components/ExportProgress.tsx`
- Test: `tests/preview-panel.test.tsx`
- Test: `tests/export-settings-modal.test.tsx`
- Test: `tests/export-progress.test.tsx`

- [ ] Step 1: 用 `SurfaceCard` 重构预览区和导出区的表面容器
- [ ] Step 2: 用 `SelectionCard` 替换导出配置中的选择项
- [ ] Step 3: 把剩余局部视觉样式迁到 CSS Modules
- [ ] Step 4: 运行相关组件测试

## Chunk 3: 最终验证

### Task 4: 回归验证与收尾

**Files:**
- Modify: `src/ui/*`
- Modify: `src/components/*`
- Modify: `src/pages/*`
- Test: `tests/*.test.tsx`

- [ ] Step 1: 执行 `npm test -- tests/ui-primitives.test.tsx tests/setup.test.tsx tests/preview-panel.test.tsx tests/export-settings-modal.test.tsx tests/export-progress.test.tsx`
- [ ] Step 2: 执行 `npm test`
- [ ] Step 3: 执行 `npm run build`
- [ ] Step 4: 记录剩余高风险区域（如 Timeline）供下一阶段使用

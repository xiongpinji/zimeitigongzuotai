# AI Assistant Design Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让编辑器左侧 `AI 助手` 面板在 `内容卡片` 与 `封面` 两个子标签下都贴合 `design.pen` 的目标状态，同时保留现有 AI 数据流与交互能力。

**Architecture:** 保留现有 store、事件处理和业务逻辑，只重构 `Editor` 左栏外壳以及 `AIPanel / AICardList / AICoverPanel` 的展示层结构。通过先补回归测试、再做最小视图层改造的方式，确保设计对齐时不破坏既有功能。

**Tech Stack:** React 19、TypeScript、CSS Modules、Vitest、react-dom/server

---

## Chunk 1: 回归测试先行

### Task 1: 锁定 AI 左栏的设计对齐断言

**Files:**
- Modify: `tests/ai-panel.test.tsx`
- Modify: `tests/ai-card-list.test.tsx`
- Modify: `tests/ai-cover-panel.test.tsx`
- Modify: `tests/editor.test.tsx`

- [ ] 写出新的静态渲染断言，覆盖设计稿要求的标题、子标签、提示词区、操作条、卡片列表和底部按钮文案
- [ ] 运行 `npm test -- tests/ai-panel.test.tsx tests/ai-card-list.test.tsx tests/ai-cover-panel.test.tsx tests/editor.test.tsx`
- [ ] 确认这些测试先失败，且失败原因是现有 UI 结构与文案不匹配

## Chunk 2: 左栏外壳与 AI 卡片态

### Task 2: 收紧 Editor 左栏外壳

**Files:**
- Modify: `src/pages/Editor.tsx`
- Modify: `src/pages/Editor.module.css`

- [ ] 去掉会干扰设计稿的通用左栏卡片壳视觉
- [ ] 保持 `素材 / AI 助手` 顶部主 tab 结构可被 AI 面板共享
- [ ] 保证 224px 左栏、预览区、检查器区的三栏结构不受影响

### Task 3: 重构 AIPanel 的 cards 视图结构

**Files:**
- Modify: `src/components/AIPanel.tsx`
- Modify: `src/components/AIPanel.module.css`

- [ ] 把 header 改成设计稿要求的紧凑单行结构
- [ ] 把二级 tab 改成下划线式切换，而不是通用 segmented tabs
- [ ] 把提示词区、操作条、底部 CTA 都改成设计稿结构
- [ ] 在分析中/空态下保留必要功能，但视觉尽量收敛到设计稿风格

### Task 4: 重构 AICardList 视图

**Files:**
- Modify: `src/components/AICardList.tsx`
- Modify: `src/components/AICardList.module.css`

- [ ] 去掉与设计稿不符的通用 badge / 删除按钮表现
- [ ] 改成设计稿里的 checkbox + 类型标签 + 标题 + 正文层级
- [ ] 保留点击打开检查器、切换启用状态等交互

## Chunk 3: AI 封面态

### Task 5: 重构 AICoverPanel 结构

**Files:**
- Modify: `src/components/AICoverPanel.tsx`
- Modify: `src/components/AICoverPanel.module.css`

- [ ] 把提示词区改成设计稿里的标题行 + 卡片式 prompt 区
- [ ] 把“重新生成”与“设为整期背景”按钮样式和层级贴回设计稿
- [ ] 把候选封面网格、选中边框和失败态改成设计稿结构

## Chunk 4: 验证

### Task 6: 回归验证

**Files:**
- Verify only

- [ ] 运行 `npm test -- tests/ai-panel.test.tsx tests/ai-card-list.test.tsx tests/ai-cover-panel.test.tsx tests/editor.test.tsx`
- [ ] 如有必要，再运行 `npm test -- tests/export-settings-modal.test.tsx tests/asset-panel.test.tsx`
- [ ] 人工复核 `design.pen` 中 `Left Panel — AI Tab State` 与 `Left Panel — AI Cover Tab State` 的核心结构是否已匹配

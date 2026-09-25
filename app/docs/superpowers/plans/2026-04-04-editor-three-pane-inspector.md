# Editor Three-Pane Inspector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将编辑器主工作区升级为三栏结构，并把 AI 卡片编辑与字幕配置统一迁移到右侧检查器。

**Architecture:** `Editor` 负责三栏布局与统一检查器状态；`AIPanel` 和 `Timeline` 只负责触发检查器打开事件；AI 卡片编辑器从旧 modal 中抽出复用到右侧；字幕配置从 `Timeline` 内联表单抽为独立检查器组件。

**Tech Stack:** React 19, TypeScript, Vitest, CSS Modules, Zustand

---

## Chunk 1: 建立三栏与检查器骨架

### Task 1: 扩展 Editor 布局

**Files:**
- Modify: `src/lib/layout.ts`
- Modify: `src/pages/Editor.tsx`
- Modify: `src/pages/Editor.module.css`
- Test: `tests/editor.test.tsx`

- [ ] Step 1: 在 `Editor` 中定义统一检查器状态与打开/关闭回调
- [ ] Step 2: 宽屏模式改为左栏 / 预览 / 右栏三列布局
- [ ] Step 3: 为右侧检查器壳层增加空态与 region 标记

## Chunk 2: 迁移 AI 卡片编辑入口

### Task 2: 抽出可复用 AI 卡片编辑器

**Files:**
- Create: `src/components/AICardInspector.tsx`
- Create: `src/components/AICardInspector.module.css`
- Modify: `src/components/AICardEditModal.tsx`
- Create: `src/hooks/useAICardInspector.ts`
- Test: `tests/ai-card-edit-modal.test.tsx`

- [ ] Step 1: 将 AI 卡片编辑表单与预览抽出为独立组件
- [ ] Step 2: 让 `AICardEditModal` 变成对新编辑器的兼容包装
- [ ] Step 3: 抽出卡片保存 / 重生成逻辑，供右侧检查器复用

### Task 3: 接通左侧和轨道 AI 卡片入口

**Files:**
- Modify: `src/components/AIPanel.tsx`
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/OverlayBlock.tsx`
- Test: `tests/ai-panel.test.tsx`

- [ ] Step 1: 移除 `AIPanel` 本地卡片编辑 modal 状态
- [ ] Step 2: 左侧 AI 卡片点击时改为通知 `Editor` 打开右侧检查器
- [ ] Step 3: 时间轴 AI 卡片点击时改为通知 `Editor` 打开同一检查器

## Chunk 3: 迁移字幕配置入口

### Task 4: 抽出字幕样式检查器

**Files:**
- Create: `src/components/SubtitleInspector.tsx`
- Create: `src/components/SubtitleInspector.module.css`
- Modify: `src/components/Timeline.tsx`

- [ ] Step 1: 将关键词高亮生成、样式表单和预览从 `Timeline` 抽出
- [ ] Step 2: 时间轴字幕轨只保留状态摘要与“打开配置”入口
- [ ] Step 3: 右侧检查器渲染字幕配置并直连 `timeline.subtitle`

## Chunk 4: 最终验证

### Task 5: 更新测试并执行验证

**Files:**
- Modify: `tests/editor.test.tsx`
- Modify: `tests/ai-panel.test.tsx`
- Create: `tests/subtitle-inspector.test.tsx`

- [ ] Step 1: 执行 `npm test -- tests/editor.test.tsx tests/ai-panel.test.tsx tests/ai-card-edit-modal.test.tsx tests/subtitle-inspector.test.tsx`
- [ ] Step 2: 如有必要，执行 `npm test`
- [ ] Step 3: 执行 `npm run build`
- [ ] Step 4: 执行 `git diff --check`

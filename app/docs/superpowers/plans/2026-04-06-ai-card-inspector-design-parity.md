# AI Card Inspector Design Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 助手卡片详情配置界面按 `design.pen` 的 `YClfO -> vW8Zt` 规范落地，并补齐删除卡片链路。

**Architecture:** 保持现有 `EditorInspector -> AICardInspector -> WebCardPreview` 结构不变，只重写右侧检查器头部与表单区布局。新增一个纯函数负责计算“第 N 段”标签，删除能力继续复用现有 AI 持久化与时间线移除逻辑。

**Tech Stack:** React 19、TypeScript、CSS Modules、Vitest

---

### Task 1: 锁定设计对齐行为

**Files:**
- Modify: `tests/editor.test.tsx`
- Modify: `tests/ai-card-edit-modal.test.tsx`
- Create: `tests/ai-card-inspector.test.tsx`

- [ ] 先把右侧宽度、按钮文案、危险区与预览文案改成设计稿预期
- [ ] 运行相关测试，确认先红灯

### Task 2: 重写检查器头部与表单布局

**Files:**
- Modify: `src/components/EditorInspector.tsx`
- Modify: `src/components/EditorInspector.module.css`
- Modify: `src/components/AICardInspector.tsx`
- Modify: `src/components/AICardInspector.module.css`
- Modify: `src/components/WebCardPreview.module.css`
- Create: `src/lib/ai-card-inspector.ts`

- [ ] 实现 `AI CARD + 第 N 段 + 关闭图标` 头部
- [ ] 按设计稿重排 section、控件与预览区
- [ ] 保留真实网页卡片预览能力，但使用设计稿外框与按钮布局

### Task 3: 补齐删除能力与回归验证

**Files:**
- Modify: `src/hooks/useAICardInspector.ts`
- Modify: `src/components/EditorInspector.tsx`
- Modify: `src/components/AICardInspector.tsx`

- [ ] 接入删除当前卡片能力，并同步清理时间线 overlay
- [ ] 运行定向测试与构建级验证

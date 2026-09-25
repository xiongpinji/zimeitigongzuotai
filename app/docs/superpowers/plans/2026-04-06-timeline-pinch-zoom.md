# Timeline Pinch Zoom Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为时间线增加 Mac 触控板 pinch 连续缩放支持，同时保留 Command + 滚轮缩放。

**Architecture:** 保持现有时间线缩放骨架不变，只在 `timeline-view` 中增加 wheel 模式识别、delta 归一化与连续缩放函数，再由 `Timeline` 组件按模式分流并复用现有 anchored scroll 补偿逻辑。

**Tech Stack:** React、TypeScript、Vitest、Electron Renderer

---

## Chunk 1: 文档与测试

### Task 1: 补充 timeline-view 测试

**Files:**
- Modify: `tests/timeline-view.test.ts`
- Test: `tests/timeline-view.test.ts`

- [ ] **Step 1: 写出 pinch 模式识别与连续缩放失败测试**
- [ ] **Step 2: 运行 `npx vitest run tests/timeline-view.test.ts`，确认新增断言先失败**

## Chunk 2: 最小实现

### Task 2: 在 timeline-view 中增加 pinch 缩放纯函数

**Files:**
- Modify: `src/lib/timeline-view.ts`
- Test: `tests/timeline-view.test.ts`

- [ ] **Step 1: 新增 wheel 模式识别函数**
- [ ] **Step 2: 新增 delta 归一化与连续缩放函数**
- [ ] **Step 3: 运行 `npx vitest run tests/timeline-view.test.ts`，确认测试转绿**

### Task 3: 在 Timeline 组件接入 pinch 缩放

**Files:**
- Modify: `src/components/Timeline.tsx`
- Test: `tests/timeline-view.test.ts`

- [ ] **Step 1: 将 wheel 事件按 legacy / pinch / normal 分流**
- [ ] **Step 2: pinch 模式下复用现有 anchored scroll 补偿**
- [ ] **Step 3: 增加锚点 `clientX` 兜底逻辑**

## Chunk 3: 验证

### Task 4: 回归校验

**Files:**
- Test: `tests/timeline-view.test.ts`
- Test: `tests/timeline.test.tsx`

- [ ] **Step 1: 运行 `npx vitest run tests/timeline-view.test.ts tests/timeline.test.tsx`**
- [ ] **Step 2: 如有失败，做最小修正并回归**
- [ ] **Step 3: 记录验证结果与未覆盖风险**

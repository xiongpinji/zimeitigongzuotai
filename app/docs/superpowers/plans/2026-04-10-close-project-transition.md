# Close Project Transition Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为“关闭项目返回欢迎页”增加克制的淡出淡入过渡动画，同时不影响其他页面切换。

**Architecture:** 将页面切换动画条件抽离为一个小型策略模块，由 App 在 close-project -> welcome 时启用 Framer Motion 过渡。动画只包裹主内容区，Toolbar/状态栏保持稳定。

**Tech Stack:** React 19、Framer Motion、Vitest

---

### Task 1: 定义切换动画策略

**Files:**
- Create: `src/lib/page-transition.ts`
- Test: `tests/page-transition.test.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes**

### Task 2: 在 App 中接入 close-project 专属动画

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/page-transition.test.ts`

- [ ] **Step 1: 接入切换原因状态，仅 close-project -> welcome 启用动画**
- [ ] **Step 2: 用 AnimatePresence/motion 包裹主内容区
- [ ] **Step 3: 保持 Toolbar / AppStatusBar 不参与大幅位移
- [ ] **Step 4: 验证 reduced motion 下自动退化为无动画**

### Task 3: 回归验证

**Files:**
- Test: `tests/page-transition.test.ts`
- Verify: `tests/native-shortcuts.test.ts`, `tests/window-close.test.ts`, `tests/app-menu.test.ts`

- [ ] **Step 1: 运行相关测试集**
- [ ] **Step 2: 运行构建验证**

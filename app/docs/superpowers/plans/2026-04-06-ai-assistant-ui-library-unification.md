# AI 助手面板 UI 组件库统一化 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AI 助手相关面板里重复实现的通用控件收敛回 `src/ui`，同时保持现有业务逻辑与设计稿对齐结果不变。

**Architecture:** 先通过源码级架构测试锁定“业务层不能继续手写通用控件”的约束，再对 `src/ui` 做最小增强，最后分批替换 `SubtitleInspector`、`AICardInspector`、`AIPanel`、`AICoverPanel`、`AICardList` 与 `Editor` 中的重复控件。保留封面候选卡片与时间轴块等业务特化视图。

**Tech Stack:** React 19、TypeScript、CSS Modules、Vitest、SSR render tests

---

## Chunk 1: 先锁定架构约束

### Task 1: 为业务层 UI 组件库使用规则补源码测试

**Files:**
- Create: `tests/ui-library-usage.test.ts`

- [ ] **Step 1: 写失败测试**

为以下文件增加源码级断言：

- `src/components/SubtitleInspector.tsx` 不应继续包含 `function CompactColorField`、`function CompactNumberField`、`function CompactSwitch`、原生 `<select`
- `src/components/AICardInspector.tsx` 不应继续包含原生 `<button`
- `src/components/AIPanel.tsx` 不应继续包含原生 `<button` 与 `<textarea`
- `src/components/AICoverPanel.tsx` 不应继续包含原生 `<button` 与 `<textarea`
- `src/components/AICardList.tsx` 不应继续包含原生 checkbox `<input`
- `src/pages/Editor.tsx` 不应继续包含左侧栏顶部 tab 的原生 `<button`

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- tests/ui-library-usage.test.ts
```

Expected: FAIL，因为这些文件当前仍残留原生控件与局部 UI 壳子。

## Chunk 2: 先增强 UI primitives / patterns

### Task 2: 让 UI 基础件覆盖 inspector 紧凑布局

**Files:**
- Modify: `src/ui/primitives/ColorField.tsx`
- Modify: `src/ui/primitives/ColorField.module.css`
- Modify: `src/ui/primitives/NumberField.tsx`
- Modify: `src/ui/primitives/NumberField.module.css`
- Modify: `src/ui/patterns/PillGroup.tsx`
- Modify: `src/ui/patterns/PillGroup.module.css`

- [ ] **Step 1: 为 ColorField 增加紧凑展示能力**
- [ ] **Step 2: 为 NumberField 增加更适合 inspector inline/compact 的使用方式**
- [ ] **Step 3: 为 PillGroup 提供更贴合 inspector 的紧凑 pill 视觉**
- [ ] **Step 4: 运行相关测试**

Run:

```bash
npm test -- tests/ui-library-usage.test.ts tests/subtitle-inspector.test.ts tests/ai-card-inspector.test.tsx
```

Expected: 仍可能失败，但失败点应开始收敛到业务组件未替换部分。

## Chunk 3: 替换最明显的业务层重复控件

### Task 3: 清理 SubtitleInspector 的 Compact 系列本地实现

**Files:**
- Modify: `src/components/SubtitleInspector.tsx`
- Modify: `src/components/SubtitleInspector.module.css`
- Test: `tests/subtitle-inspector.test.tsx`

- [ ] **Step 1: 先更新测试断言**

补充断言，要求：

- 不再输出原生 `<select`
- 仍保留“关键词高亮 / 颜色与圆角 / 动画与预览”等设计对齐文案

- [ ] **Step 2: 运行 subtitle 测试确认失败**

Run:

```bash
npm test -- tests/subtitle-inspector.test.tsx tests/ui-library-usage.test.ts
```

Expected: FAIL，因为当前仍保留原生 `<select` 和本地 Compact 组件实现。

- [ ] **Step 3: 用 `ColorField / NumberField / Switch / Select` 替换本地 Compact 组件**
- [ ] **Step 4: 删除不再需要的本地 helper 组件实现**
- [ ] **Step 5: 重新运行测试**

### Task 4: 清理 AICardInspector 的本地 pill / button 壳

**Files:**
- Modify: `src/components/AICardInspector.tsx`
- Modify: `src/components/AICardInspector.module.css`
- Test: `tests/ai-card-inspector.test.tsx`

- [ ] **Step 1: 先补断言锁定设计关键文案与动作区**
- [ ] **Step 2: 运行测试确认当前实现不足**

Run:

```bash
npm test -- tests/ai-card-inspector.test.tsx tests/ui-library-usage.test.ts
```

Expected: FAIL，或源码架构测试失败。

- [ ] **Step 3: 用 `PillGroup + Button` 替换本地 pill/button**
- [ ] **Step 4: 保留预览区与业务字段逻辑不变**
- [ ] **Step 5: 重新运行测试**

## Chunk 4: 替换 AI 助手左右相关的通用控件

### Task 5: 收敛 AIPanel / AICoverPanel / AICardList / Editor

**Files:**
- Modify: `src/components/AIPanel.tsx`
- Modify: `src/components/AIPanel.module.css`
- Modify: `src/components/AICoverPanel.tsx`
- Modify: `src/components/AICoverPanel.module.css`
- Modify: `src/components/AICardList.tsx`
- Modify: `src/components/AICardList.module.css`
- Modify: `src/pages/Editor.tsx`
- Modify: `src/pages/Editor.module.css`
- Test: `tests/ai-panel.test.tsx`
- Test: `tests/ai-cover-panel.test.tsx`
- Test: `tests/ai-card-list.test.tsx`
- Test: `tests/editor.test.tsx`

- [ ] **Step 1: 先更新这些测试，锁定现有设计对齐文案与结构**
- [ ] **Step 2: 运行目标测试确认失败点**

Run:

```bash
npm test -- tests/ai-panel.test.tsx tests/ai-cover-panel.test.tsx tests/ai-card-list.test.tsx tests/editor.test.tsx tests/ui-library-usage.test.ts
```

Expected: FAIL，因为业务文件仍残留原生 `button / textarea / checkbox`

- [ ] **Step 3: AIPanel 改用 `Button / Tabs / Textarea`**
- [ ] **Step 4: AICoverPanel 改用 `Button / Textarea`，保留候选卡片为业务对象**
- [ ] **Step 5: AICardList 改用 `Checkbox / Badge`**
- [ ] **Step 6: Editor 顶部 panel switch 改用 `Tabs` 或统一的 UI tab 语义**
- [ ] **Step 7: 重新运行目标测试**

## Chunk 5: 收尾验证

### Task 6: 跑完整的相关验证

**Files:**
- Verify only

- [ ] **Step 1: 跑本轮相关测试**

Run:

```bash
npm test -- tests/ui-library-usage.test.ts tests/subtitle-inspector.test.tsx tests/ai-card-inspector.test.tsx tests/ai-panel.test.tsx tests/ai-cover-panel.test.tsx tests/ai-card-list.test.tsx tests/editor.test.tsx
```

Expected: PASS

- [ ] **Step 2: 跑生产构建**

Run:

```bash
npm run build
```

Expected: PASS

- [ ] **Step 3: 若有失败，明确区分本轮回归与既有脏工作区问题**

Plan complete and saved to `docs/superpowers/plans/2026-04-06-ai-assistant-ui-library-unification.md`. Ready to execute?

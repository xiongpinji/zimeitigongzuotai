# 业务 UI 组件库统一化 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前项目剩余的原生 / 自绘业务交互统一到 `@pikoloo/darwin-ui`，保留 `src/ui/*` 作为薄适配层。

**Architecture:** 先在根部接入 Darwin Overlay Provider，再把 `ModalShell`、`SwitchField`、`ErrorAlert` 和新增 `SelectField` 统一到 Darwin UI；随后清理业务层残留的原生 select、window.confirm、可点击 div 选择器，并更新测试。

**Tech Stack:** React 19, TypeScript, Electron, CSS Modules, @pikoloo/darwin-ui, Vitest

---

## Chunk 1: 底层交互语义收口

### Task 1: 接入 Darwin Overlay Provider 并替换 ModalShell

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/ui/primitives/ModalShell.tsx`
- Test: `tests/ui-primitives.test.tsx`
- Test: `tests/ai-settings-modal.test.tsx`
- Test: `tests/export-progress.test.tsx`

- [x] **Step 1: 在入口挂载 OverlayProvider**
- [x] **Step 2: 用 Darwin `Dialog` 重写 `ModalShell`，保持现有 props API**
- [x] **Step 3: 调整受影响测试以匹配新的 dialog DOM**
- [x] **Step 4: 运行定向测试**

Run:

```bash
npm test -- tests/ui-primitives.test.tsx tests/ai-settings-modal.test.tsx tests/export-progress.test.tsx
```

Expected: 相关弹窗测试通过。

### Task 2: 将 SwitchField 和 ErrorAlert 统一到 Darwin UI

**Files:**
- Modify: `src/ui/primitives/SwitchField.tsx`
- Modify: `src/ui/primitives/ErrorAlert.tsx`
- Test: `tests/ui-primitives.test.tsx`

- [x] **Step 1: 用 Darwin `Switch` 改写 `SwitchField`**
- [x] **Step 2: 用 Darwin `Alert` 改写 `ErrorAlert`**
- [x] **Step 3: 更新 primitives 测试断言**
- [x] **Step 4: 运行定向测试**

Run:

```bash
npm test -- tests/ui-primitives.test.tsx
```

Expected: primitives 测试通过。

### Task 3: 新增 SelectField 并瘦身 Button 包装层

**Files:**
- Add: `src/ui/primitives/SelectField.tsx`
- Modify: `src/ui/primitives/index.ts`
- Modify: `src/ui/primitives/Button.module.css`
- Modify: `src/ui/primitives/IconButton.module.css`
- Test: `tests/ui-primitives.test.tsx`

- [x] **Step 1: 新增基于 Darwin `Select` 的 `SelectField`**
- [x] **Step 2: 调整 Button / IconButton 的样式覆盖，只保留必要尺寸与语义映射**
- [x] **Step 3: 在 primitives 测试中补 SelectField 渲染断言**
- [x] **Step 4: 运行定向测试**

Run:

```bash
npm test -- tests/ui-primitives.test.tsx
```

Expected: SelectField 与按钮 smoke test 通过。

## Chunk 2: 业务层残留自绘控件替换

### Task 4: 重构 SubtitleInspector

**Files:**
- Modify: `src/components/SubtitleInspector.tsx`
- Modify: `src/components/SubtitleInspector.module.css`
- Test: `tests/subtitle-inspector.test.tsx`

- [x] **Step 1: 用 `SelectField` 替换原生 `<select>`**
- [x] **Step 2: 保留颜色输入作为例外，但统一字段结构**
- [x] **Step 3: 根据新的 DOM 更新测试**
- [x] **Step 4: 运行定向测试**

Run:

```bash
npm test -- tests/subtitle-inspector.test.tsx
```

Expected: 字幕样式检查器测试通过。

### Task 5: 重构 AICoverPanel 与 ExportSettingsModal

**Files:**
- Modify: `src/components/AICoverPanel.tsx`
- Modify: `src/components/AICoverPanel.module.css`
- Modify: `src/components/ExportSettingsModal.tsx`
- Modify: `src/components/ExportSettingsModal.module.css`
- Test: `tests/ai-cover-panel.test.tsx`
- Test: `tests/export-settings-modal.test.tsx`

- [x] **Step 1: 将封面候选区从 clickable div 收敛到基于 `SurfaceCard` 的选择卡**
- [x] **Step 2: 去掉 `SelectionCard` 在导出设置中的职责，改用 `SelectField` 或标准按钮组合**
- [x] **Step 3: 更新相关测试**
- [x] **Step 4: 运行定向测试**

Run:

```bash
npm test -- tests/ai-cover-panel.test.tsx tests/export-settings-modal.test.tsx
```

Expected: 候选封面和导出设置测试通过。

### Task 6: 用 Darwin Dialog 替换删除确认流

**Files:**
- Modify: `src/components/AssetPanel.tsx`
- Test: `tests/asset-panel.test.tsx`

- [x] **Step 1: 移除 `window.confirm`，改为受控确认弹窗**
- [x] **Step 2: 保持删除逻辑和文案一致**
- [x] **Step 3: 更新测试**
- [x] **Step 4: 运行定向测试**

Run:

```bash
npm test -- tests/asset-panel.test.tsx
```

Expected: 素材删除确认流程测试通过。

## Chunk 3: 全量回归验证

### Task 7: 全量验证与计划回写

**Files:**
- Modify: `docs/superpowers/plans/2026-04-05-business-ui-library-unification.md`

- [x] **Step 1: 勾选已完成步骤并记录实际差异**
- [x] **Step 2: 运行全量测试**
- [x] **Step 3: 如有需要运行构建验证**

Run:

```bash
npm test
```

Expected: 全量测试通过。

Run:

```bash
npm run build
```

Expected: 构建通过。

### 实际收尾结果

- 已重新执行全量验证：
  - `npm test` → `49 passed`, `174 passed`
  - `npm run build` → 构建通过
- 运行时代码中的 `SelectionCard` 已彻底删除，仅在历史设计 / 计划文档中保留引用
- 代码层已无原生 `<select>`、`window.confirm`、自写 dialog portal
- 当前保留的最小例外：
  - `SubtitleInspector` 中的颜色选择器继续使用原生 `input[type="color"]`，因为 Darwin UI 当前没有现成 color picker
  - `AICoverPanel` 的候选封面继续使用基于 `SurfaceCard` 的业务可选卡片，这属于业务容器交互，不再视为基础按钮 / 选择器重复实现

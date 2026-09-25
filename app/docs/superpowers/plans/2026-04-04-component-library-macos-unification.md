# 组件库扩充 + macOS 桌面化风格统一 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/ui/` 组件库从 18 个组件扩充到 28 个，同时将全部视觉语言从 web dashboard 统一为 macOS 桌面风格，并迁移业务组件消费新组件。

**Architecture:** 分 3 个 Phase 执行：P1 改造 tokens + 现有组件 CSS；P2 新增 6 个 primitives 并迁移业务组件；P3 新增 4 个 patterns 并完成剩余迁移与收尾。每个 Phase 独立提交，可逐步验证。

**Tech Stack:** React 19, CSS Modules, Vite, Vitest, Electron, TypeScript

---

## File Structure

### 新建文件

```
src/ui/primitives/Tooltip.tsx
src/ui/primitives/Tooltip.module.css
src/ui/primitives/ErrorAlert.tsx
src/ui/primitives/ErrorAlert.module.css
src/ui/primitives/LoadingOverlay.tsx
src/ui/primitives/LoadingOverlay.module.css
src/ui/primitives/Divider.tsx
src/ui/primitives/Divider.module.css
src/ui/primitives/SwitchField.tsx
src/ui/primitives/SwitchField.module.css
src/ui/primitives/NumberField.tsx
src/ui/primitives/NumberField.module.css
src/ui/patterns/FieldGrid.tsx
src/ui/patterns/FieldGrid.module.css
src/ui/patterns/ModalFooter.tsx
src/ui/patterns/ModalFooter.module.css
src/ui/patterns/StepIndicator.tsx
src/ui/patterns/StepIndicator.module.css
src/ui/patterns/SummaryCard.tsx
src/ui/patterns/SummaryCard.module.css
```

### 修改文件

```
src/ui/styles/tokens.css          — macOS design tokens 重写
src/ui/styles/base.css             — 字体优先级调整
src/ui/primitives/Button.module.css — macOS 按钮风格
src/ui/primitives/IconButton.module.css — 降低存在感
src/ui/primitives/Input.module.css  — recessed field
src/ui/primitives/Textarea.module.css — recessed field
src/ui/primitives/Field.module.css  — grouped row
src/ui/primitives/Badge.module.css  — 状态胶囊
src/ui/primitives/SurfaceCard.module.css — grouped panel
src/ui/primitives/ModalShell.module.css — 桌面 sheet
src/ui/primitives/EmptyState.module.css — 桌面空状态
src/ui/primitives/ProgressBar.module.css — macOS 进度条
src/ui/primitives/MediaPlaceholder.module.css — 色调调整
src/ui/patterns/PanelHeader.module.css — section title
src/ui/patterns/TabBar.module.css   — segmented control
src/ui/patterns/SearchField.module.css — recessed search
src/ui/patterns/SelectionCard.module.css — system blue selection
src/ui/patterns/ActionBar.module.css — 调整间距
src/ui/patterns/FileDropCard.module.css — 桌面风格
src/ui/patterns/PillGroup.module.css — 调整
src/ui/primitives/index.ts         — 新增导出
src/ui/patterns/index.ts           — 新增导出
src/components/AIPanel.tsx         — Tooltip/StepIndicator/ErrorAlert 迁移
src/components/AIPanel.module.css  — 删除 hoverHint/analysisStep 等内联样式
src/components/SubtitleInspector.tsx — FieldGrid/SwitchField/NumberField/ErrorAlert/SummaryCard 迁移
src/components/SubtitleInspector.module.css — 删除 grid/field/switchRow 等内联样式
src/components/AISettingsModal.tsx  — Divider/ModalFooter 迁移
src/components/ExportSettingsModal.tsx — ModalFooter 迁移
src/components/ExportProgress.tsx   — ModalFooter 迁移
src/components/AICardEditModal.tsx  — ModalFooter 迁移
src/components/WebCardPreview.tsx   — LoadingOverlay 迁移
src/pages/Setup.tsx                — ErrorAlert 迁移
tests/ui-primitives.test.tsx       — 新组件测试
```

---

## Phase 1: Design Tokens + 现有组件 macOS 风格改造

### Task 1: 重写 Design Tokens

**Files:**
- Modify: `src/ui/styles/tokens.css`
- Modify: `src/ui/styles/base.css`

- [ ] **Step 1: 重写 tokens.css**

```css
:root {
  color-scheme: dark;

  /* 背景 — 石墨炭灰层级 */
  --color-bg-canvas: #1a1a1e;
  --color-bg-surface: rgba(44, 44, 46, 0.82);
  --color-bg-elevated: #2c2c2e;
  --color-bg-subtle: rgba(255, 255, 255, 0.04);
  --color-bg-muted: rgba(255, 255, 255, 0.07);

  /* 边框 */
  --color-border-subtle: rgba(255, 255, 255, 0.08);
  --color-border-strong: rgba(255, 255, 255, 0.16);

  /* 文字 */
  --color-text-primary: #f5f5f7;
  --color-text-secondary: #a1a1a6;
  --color-text-muted: #86868b;
  --color-text-disabled: #636366;

  /* 主色 — macOS system blue */
  --color-system-blue: #0a84ff;
  --color-system-blue-hover: #409cff;
  --color-system-blue-active: #0071e3;
  --color-brand-primary: #0a84ff;
  --color-brand-accent: #5ac8fa;
  --color-brand-info: #64d2ff;
  --color-brand-warm: #ff9f0a;
  --color-danger: #ff453a;

  /* 功能色背景 */
  --color-bg-error: rgba(255, 69, 58, 0.12);
  --color-bg-warning: rgba(255, 159, 10, 0.12);
  --color-bg-success: rgba(48, 209, 88, 0.12);

  /* 渐变 — 仅用于装饰，不用于主按钮 */
  --gradient-brand: linear-gradient(90deg, #0a84ff, #5ac8fa);
  --gradient-info: linear-gradient(90deg, #64d2ff 0%, #5ac8fa 100%);
  --gradient-warm: linear-gradient(90deg, #ff9f0a, #ff6723);

  /* 遮罩 */
  --color-overlay: rgba(0, 0, 0, 0.44);
  --backdrop-blur: blur(20px);

  /* 阴影 — 弱化，依赖明度差 */
  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.2);
  --shadow-modal: 0 8px 32px rgba(0, 0, 0, 0.36);
  --shadow-focus: 0 0 0 3px rgba(10, 132, 255, 0.3);

  /* 圆角 — 收紧 */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-pill: 999px;

  /* 间距 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 28px;

  /* 字体 */
  --font-size-xs: 11px;
  --font-size-sm: 12px;
  --font-size-md: 13px;
  --font-size-lg: 14px;

  /* 行高 */
  --line-height-tight: 1.3;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.6;

  /* 动画 */
  --motion-micro: 100ms ease;
  --motion-fast: 150ms ease;
  --motion-base: 200ms ease;

  /* z-index */
  --z-modal: 120;
  --z-toast: 180;
}
```

- [ ] **Step 2: 更新 base.css 字体优先级**

将 `base.css` 中的 `font-family` 改为：

```css
body {
  margin: 0;
  background: var(--color-bg-canvas);
  color: var(--color-text-primary);
  font-family:
    -apple-system,
    "SF Pro Text",
    "SF Pro Display",
    "PingFang SC",
    Inter,
    "Segoe UI",
    sans-serif;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

同时将 `::selection` 和 `:focus-visible` 中的颜色从紫色系改为 system blue：

```css
:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

::selection {
  background: rgba(10, 132, 255, 0.3);
}
```

- [ ] **Step 3: 运行 build 验证 token 变更**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds (exit 0)

- [ ] **Step 4: 提交 tokens 改造**

```bash
git add src/ui/styles/tokens.css src/ui/styles/base.css
git commit -m "refactor(tokens): 重写 design tokens 为 macOS 桌面风格"
```

---

### Task 2: Button + IconButton macOS 风格

**Files:**
- Modify: `src/ui/primitives/Button.module.css`
- Modify: `src/ui/primitives/IconButton.module.css`

- [ ] **Step 1: 重写 Button.module.css**

```css
.root {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
  font-weight: 500;
  line-height: 1;
  transition:
    background var(--motion-fast),
    border-color var(--motion-fast),
    color var(--motion-fast),
    box-shadow var(--motion-fast),
    opacity var(--motion-fast);
}

.root:hover:not(:disabled) {
  /* macOS 不做 translateY 浮起 */
}

.root:active:not(:disabled) {
  opacity: 0.8;
}

.root:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.root:focus-visible {
  box-shadow: var(--shadow-focus);
}

.sizeSm {
  height: 24px;
  padding: 0 10px;
  font-size: var(--font-size-xs);
  border-radius: var(--radius-sm);
}

.sizeMd {
  height: 28px;
  padding: 0 12px;
  font-size: var(--font-size-sm);
}

.sizeLg {
  height: 34px;
  padding: 0 16px;
  font-size: var(--font-size-md);
}

.variantPrimary {
  border: none;
  background: var(--color-system-blue);
  color: #ffffff;
}

.variantPrimary:hover:not(:disabled) {
  background: var(--color-system-blue-hover);
}

.variantSecondary {
  border-color: var(--color-border-subtle);
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
}

.variantSecondary:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  background: var(--color-bg-muted);
}

.variantDanger {
  border-color: rgba(255, 69, 58, 0.24);
  background: rgba(255, 69, 58, 0.12);
  color: #ff6961;
}

.variantDanger:hover:not(:disabled) {
  border-color: rgba(255, 69, 58, 0.36);
  background: rgba(255, 69, 58, 0.18);
}

.variantTint {
  border-color: rgba(10, 132, 255, 0.2);
  background: rgba(10, 132, 255, 0.1);
  color: var(--color-system-blue-hover);
}

.variantTint:hover:not(:disabled) {
  border-color: rgba(10, 132, 255, 0.32);
  background: rgba(10, 132, 255, 0.16);
}

.variantGhost {
  border-color: transparent;
  background: transparent;
  color: var(--color-text-secondary);
}

.variantGhost:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
}

.fullWidth {
  width: 100%;
}

.loading {
  pointer-events: none;
}

.content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
}

.iconWrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 2: 重写 IconButton.module.css**

```css
.root {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-text-secondary);
  transition:
    background var(--motion-fast),
    color var(--motion-fast),
    opacity var(--motion-fast);
}

.root:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.root:active:not(:disabled) {
  opacity: 0.7;
}

.root:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.root:focus-visible {
  box-shadow: var(--shadow-focus);
}

.sizeSm {
  width: 24px;
  height: 24px;
}

.sizeMd {
  width: 30px;
  height: 30px;
}

.variantGhost {
  background: transparent;
  color: var(--color-text-secondary);
}

.variantGhost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.variantSubtle {
  background: rgba(255, 255, 255, 0.03);
}

.variantSubtle:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.variantBrand {
  background: rgba(10, 132, 255, 0.12);
  color: var(--color-system-blue-hover);
}

.variantBrand:hover:not(:disabled) {
  background: rgba(10, 132, 255, 0.2);
}

.variantDanger {
  background: rgba(255, 69, 58, 0.1);
  color: #ff6961;
}

.variantDanger:hover:not(:disabled) {
  background: rgba(255, 69, 58, 0.18);
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: 提交按钮改造**

```bash
git add src/ui/primitives/Button.module.css src/ui/primitives/IconButton.module.css
git commit -m "refactor(ui): Button 和 IconButton 改造为 macOS 桌面风格"
```

---

### Task 3: Input / Textarea / SearchField recessed field 风格

**Files:**
- Modify: `src/ui/primitives/Input.module.css`
- Modify: `src/ui/primitives/Textarea.module.css`
- Modify: `src/ui/patterns/SearchField.module.css`

- [ ] **Step 1: 重写 Input.module.css 为 recessed 风格**

```css
.root {
  min-height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-subtle);
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  outline: none;
  transition:
    border-color var(--motion-fast),
    box-shadow var(--motion-fast);
}

.root::placeholder {
  color: var(--color-text-disabled);
}

.root:hover:not(:disabled) {
  border-color: var(--color-border-strong);
}

.root:focus-visible {
  border-color: var(--color-system-blue);
  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.2);
}

.root:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fullWidth {
  width: 100%;
}
```

- [ ] **Step 2: 重写 Textarea.module.css**

```css
.root {
  min-height: 72px;
  padding: 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-subtle);
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
  resize: vertical;
  outline: none;
  transition:
    border-color var(--motion-fast),
    box-shadow var(--motion-fast);
}

.root::placeholder {
  color: var(--color-text-disabled);
}

.root:hover:not(:disabled) {
  border-color: var(--color-border-strong);
}

.root:focus-visible {
  border-color: var(--color-system-blue);
  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.2);
}

.root:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fullWidth {
  width: 100%;
}
```

- [ ] **Step 3: 重写 SearchField.module.css 为 recessed search**

```css
.root {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-subtle);
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-secondary);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}

.root:focus-within {
  border-color: var(--color-system-blue);
  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.2);
}

.icon {
  font-size: 13px;
  line-height: 1;
  color: var(--color-text-disabled);
}

.input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  outline: none;
}
```

- [ ] **Step 4: 提交输入组件改造**

```bash
git add src/ui/primitives/Input.module.css src/ui/primitives/Textarea.module.css src/ui/patterns/SearchField.module.css
git commit -m "refactor(ui): Input/Textarea/SearchField 改造为 recessed field 风格"
```

---

### Task 4: SurfaceCard / ModalShell / Badge 桌面化

**Files:**
- Modify: `src/ui/primitives/SurfaceCard.module.css`
- Modify: `src/ui/primitives/ModalShell.module.css`
- Modify: `src/ui/primitives/Badge.module.css`

- [ ] **Step 1: 重写 SurfaceCard.module.css 为 grouped panel**

```css
.root {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  box-shadow: var(--shadow-card);
}

.paddingNone { padding: 0; }
.paddingSm { padding: var(--space-2); }
.paddingMd { padding: var(--space-3); }
.paddingLg { padding: var(--space-5); }

.variantDefault {
  background: var(--color-bg-surface);
}

.variantSubtle {
  background: rgba(255, 255, 255, 0.03);
  box-shadow: none;
}

.variantElevated {
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-modal);
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
}

.variantBrand {
  background: rgba(10, 132, 255, 0.08);
  border-color: rgba(10, 132, 255, 0.2);
}

.variantWarm {
  background: rgba(255, 159, 10, 0.08);
  border-color: rgba(255, 159, 10, 0.2);
}

.variantDanger {
  background: var(--color-bg-error);
  border-color: rgba(255, 69, 58, 0.2);
}

.interactive {
  cursor: pointer;
  transition:
    border-color var(--motion-fast),
    background var(--motion-fast);
}

.interactive:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-muted);
}

.interactive:focus-within {
  box-shadow: var(--shadow-focus);
}
```

- [ ] **Step 2: 重写 ModalShell.module.css 为桌面 sheet**

```css
.overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--color-overlay);
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
  z-index: var(--z-modal);
}

.dialog {
  width: min(640px, calc(100vw - 40px));
  max-height: 88vh;
  overflow-y: auto;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-modal);
}

.sizeSm { max-width: 420px; }
.sizeMd { max-width: 640px; }
.sizeLg { max-width: 760px; }

.header {
  padding: 20px 20px 0;
}

.eyebrow {
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  color: var(--color-text-disabled);
  text-transform: uppercase;
}

.title {
  margin: 6px 0 0;
  color: var(--color-text-primary);
  font-size: 16px;
  font-weight: 600;
}

.description {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
}

.body {
  padding: 16px 20px 20px;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 20px;
}
```

- [ ] **Step 3: 重写 Badge.module.css 为状态胶囊**

```css
.root {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 20px;
  padding: 2px 8px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.shapePill { border-radius: var(--radius-pill); }
.shapeRounded { border-radius: var(--radius-sm); }

.variantNeutral {
  background: var(--color-bg-muted);
  color: var(--color-text-secondary);
}

.variantInfo {
  background: rgba(100, 210, 255, 0.12);
  color: #64d2ff;
}

.variantSuccess {
  background: var(--color-bg-success);
  color: #30d158;
}

.variantWarning {
  background: var(--color-bg-warning);
  color: #ff9f0a;
}

.variantDanger {
  background: var(--color-bg-error);
  color: #ff453a;
}

.variantBrand {
  background: rgba(10, 132, 255, 0.14);
  color: var(--color-system-blue-hover);
}
```

- [ ] **Step 4: 提交**

```bash
git add src/ui/primitives/SurfaceCard.module.css src/ui/primitives/ModalShell.module.css src/ui/primitives/Badge.module.css
git commit -m "refactor(ui): SurfaceCard/ModalShell/Badge 改造为 macOS 桌面风格"
```

---

### Task 5: 其余 primitives + patterns CSS 改造

**Files:**
- Modify: `src/ui/primitives/Field.module.css`
- Modify: `src/ui/primitives/EmptyState.module.css`
- Modify: `src/ui/primitives/ProgressBar.module.css`
- Modify: `src/ui/primitives/MediaPlaceholder.module.css`
- Modify: `src/ui/patterns/PanelHeader.module.css`
- Modify: `src/ui/patterns/TabBar.module.css`
- Modify: `src/ui/patterns/SelectionCard.module.css`
- Modify: `src/ui/patterns/FileDropCard.module.css`

- [ ] **Step 1: 重写 Field.module.css**

```css
.root {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.labelRow {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--color-text-muted);
}

.required {
  color: var(--color-danger);
  font-size: var(--font-size-xs);
}

.control {
  min-width: 0;
}

.hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-disabled);
  line-height: var(--line-height-normal);
}

.error {
  font-size: var(--font-size-xs);
  color: var(--color-danger);
  line-height: var(--line-height-normal);
}
```

- [ ] **Step 2: 重写 EmptyState.module.css**

```css
.root {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.02);
}

.eyebrow {
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  color: var(--color-text-disabled);
  text-transform: uppercase;
}

.title {
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.description {
  max-width: 320px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-relaxed);
}

.actions {
  width: 100%;
  margin-top: 2px;
}
```

- [ ] **Step 3: 重写 ProgressBar.module.css**

```css
.track {
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--color-bg-muted);
}

.fill {
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--motion-base);
}

.toneBrand {
  background: var(--color-system-blue);
}

.toneInfo {
  background: var(--color-brand-info);
}

.toneDanger {
  background: var(--color-danger);
}
```

- [ ] **Step 4: 重写 MediaPlaceholder.module.css（调整色调）**

将 `MediaPlaceholder.module.css` 中的蓝黑渐变背景调整为石墨灰系：

```css
.root {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.variantAudio {
  background: linear-gradient(180deg, #2c5282 0%, #1a365d 55%, #153e75 100%);
}

.audioWavePrimary {
  position: absolute;
  inset: 18% 0 auto;
  height: 34%;
  background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.7) 0 2px, transparent 2px 6px);
  opacity: 0.8;
}

.audioWaveSecondary {
  position: absolute;
  inset: 52% 0 auto;
  height: 22%;
  background: repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.2) 0 3px, transparent 3px 8px);
  opacity: 0.5;
}

.audioLabel {
  position: absolute;
  left: 8px;
  bottom: 8px;
  color: rgba(255, 255, 255, 0.8);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
}

.variantSrt {
  box-sizing: border-box;
  padding: 10px 8px;
  background: linear-gradient(135deg, rgba(44, 44, 46, 0.98) 0%, rgba(28, 28, 30, 0.98) 100%);
}

.srtLine {
  height: 6px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.12);
  margin-bottom: 6px;
}

.srtLineAccent {
  background: rgba(10, 132, 255, 0.4);
  margin-bottom: 0;
}

.srtLabel {
  margin-top: 10px;
  color: var(--color-system-blue-hover);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
}

.variantGeneric {
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, rgba(44, 44, 46, 0.95) 0%, rgba(28, 28, 30, 0.98) 100%);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
}
```

- [ ] **Step 5: 重写 PanelHeader.module.css 为 section title**

```css
.root {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.info {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.leading { flex-shrink: 0; }

.copy { min-width: 0; }

.eyebrow {
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  color: var(--color-text-disabled);
  font-weight: 600;
  text-transform: uppercase;
}

.titleRow {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.title {
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.meta { flex-shrink: 0; }

.description {
  margin-top: 2px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-normal);
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
```

- [ ] **Step 6: 重写 TabBar.module.css 为 segmented control**

```css
.root {
  display: flex;
  padding: 2px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.05);
}

.tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--motion-fast), color var(--motion-fast);
}

.tab:hover {
  color: var(--color-text-secondary);
}

.tab[data-active='true'] {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
  font-weight: 600;
}
```

- [ ] **Step 7: 重写 SelectionCard.module.css 为 system blue selection**

```css
.root {
  width: 100%;
  padding: 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--motion-fast),
    background var(--motion-fast);
}

.root:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-muted);
}

.root:focus-visible {
  box-shadow: var(--shadow-focus);
}

.root[data-selected='true'] {
  border-color: rgba(10, 132, 255, 0.4);
  background: rgba(10, 132, 255, 0.1);
}

.toneNeutral[data-selected='true'] {
  border-color: var(--color-border-strong);
  background: rgba(255, 255, 255, 0.06);
}

.toneBrand[data-selected='true'] {
  border-color: rgba(10, 132, 255, 0.4);
  background: rgba(10, 132, 255, 0.1);
}

.toneWarm[data-selected='true'] {
  border-color: rgba(255, 159, 10, 0.4);
  background: rgba(255, 159, 10, 0.08);
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.title {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.meta {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.toneNeutral .meta { color: var(--color-text-secondary); }
.toneBrand .meta { color: var(--color-system-blue-hover); }
.toneWarm .meta { color: #ff9f0a; }

.description {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-relaxed);
}

.content { margin-top: 8px; }
```

- [ ] **Step 8: 重写 FileDropCard.module.css**

```css
.root {
  width: 100%;
  min-height: 180px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.02);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition:
    border-color var(--motion-fast),
    background var(--motion-fast);
}

.root:hover {
  border-color: var(--color-border-strong);
  background: rgba(255, 255, 255, 0.04);
}

.filled {
  border-color: color-mix(in srgb, var(--drop-accent, #64d2ff) 50%, transparent);
  background: color-mix(in srgb, var(--drop-accent, #64d2ff) 6%, transparent);
}

.compact {
  min-height: 150px;
  padding: 16px;
  gap: 10px;
}

.icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--drop-accent, #64d2ff) 12%, transparent);
  color: color-mix(in srgb, var(--drop-accent, #64d2ff) 80%, white 20%);
  font-size: 22px;
}

.compact .icon {
  width: 36px;
  height: 36px;
  font-size: 18px;
}

.eyebrow {
  color: var(--drop-accent, #64d2ff);
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  font-weight: 600;
  text-transform: uppercase;
}

.title {
  margin: 4px 0 0;
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}

.compact .title { font-size: 16px; }

.value {
  margin-top: auto;
  border-radius: var(--radius-md);
  border: 1px dashed rgba(255, 255, 255, 0.1);
  padding: 12px 14px;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  min-height: 44px;
  display: flex;
  align-items: center;
  overflow: hidden;
  word-break: break-all;
}

.compact .value {
  min-height: 38px;
  padding: 10px 12px;
  font-size: var(--font-size-xs);
}

.filled .value { color: var(--color-text-primary); }

.action { display: flex; }
```

- [ ] **Step 9: 运行 build 验证全部 CSS 改造**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 10: 运行测试**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/ui-primitives.test.tsx 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 11: 提交**

```bash
git add src/ui/primitives/Field.module.css src/ui/primitives/EmptyState.module.css src/ui/primitives/ProgressBar.module.css src/ui/primitives/MediaPlaceholder.module.css src/ui/patterns/PanelHeader.module.css src/ui/patterns/TabBar.module.css src/ui/patterns/SelectionCard.module.css src/ui/patterns/FileDropCard.module.css
git commit -m "refactor(ui): 其余 primitives 和 patterns 改造为 macOS 桌面风格"
```

---

## Phase 2: 新增 Primitives + 迁移

### Task 6: Tooltip 组件

**Files:**
- Create: `src/ui/primitives/Tooltip.tsx`
- Create: `src/ui/primitives/Tooltip.module.css`
- Modify: `src/ui/primitives/index.ts`
- Test: `tests/ui-primitives.test.tsx`

- [ ] **Step 1: 编写 Tooltip 测试**

在 `tests/ui-primitives.test.tsx` 末尾添加：

```tsx
import { Tooltip } from '../src/ui/primitives';

// 在 describe 块内添加
it('renders a tooltip with label and position', () => {
  const html = renderToStaticMarkup(
    <Tooltip label="提示信息" position="bottom">
      <button>悬停我</button>
    </Tooltip>,
  );

  expect(html).toContain('role="tooltip"');
  expect(html).toContain('提示信息');
  expect(html).toContain('悬停我');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/ui-primitives.test.tsx 2>&1 | tail -10`
Expected: FAIL — Tooltip not found

- [ ] **Step 3: 创建 Tooltip.module.css**

```css
.root {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.bubble {
  position: absolute;
  z-index: 8;
  padding: 4px 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  line-height: 1.35;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  box-shadow: var(--shadow-card);
  transition: opacity var(--motion-fast), transform var(--motion-fast);
}

.root:hover .bubble,
.root:focus-within .bubble {
  opacity: 1;
}

/* 位置变体 */
.positionTop {
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translate(-50%, 4px);
}

.root:hover .positionTop,
.root:focus-within .positionTop {
  transform: translate(-50%, 0);
}

.positionBottom {
  top: calc(100% + 6px);
  left: 50%;
  transform: translate(-50%, -4px);
}

.root:hover .positionBottom,
.root:focus-within .positionBottom {
  transform: translate(-50%, 0);
}

.positionLeft {
  right: calc(100% + 6px);
  top: 50%;
  transform: translate(4px, -50%);
}

.root:hover .positionLeft,
.root:focus-within .positionLeft {
  transform: translate(0, -50%);
}

.positionRight {
  left: calc(100% + 6px);
  top: 50%;
  transform: translate(-4px, -50%);
}

.root:hover .positionRight,
.root:focus-within .positionRight {
  transform: translate(0, -50%);
}
```

- [ ] **Step 4: 创建 Tooltip.tsx**

```tsx
import type { ReactNode } from 'react';
import styles from './Tooltip.module.css';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  label: string;
  position?: TooltipPosition;
  children: ReactNode;
}

export function Tooltip({ label, position = 'top', children }: TooltipProps) {
  const positionClass = styles[`position${capitalize(position)}`];

  return (
    <span className={styles.root}>
      {children}
      <span role="tooltip" className={`${styles.bubble} ${positionClass}`}>
        {label}
      </span>
    </span>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
```

- [ ] **Step 5: 在 primitives/index.ts 添加导出**

在 `src/ui/primitives/index.ts` 添加一行：

```ts
export * from './Tooltip';
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/ui-primitives.test.tsx 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 7: 提交**

```bash
git add src/ui/primitives/Tooltip.tsx src/ui/primitives/Tooltip.module.css src/ui/primitives/index.ts tests/ui-primitives.test.tsx
git commit -m "feat(ui): 新增 Tooltip 组件"
```

---

### Task 7: ErrorAlert 组件

**Files:**
- Create: `src/ui/primitives/ErrorAlert.tsx`
- Create: `src/ui/primitives/ErrorAlert.module.css`
- Modify: `src/ui/primitives/index.ts`
- Test: `tests/ui-primitives.test.tsx`

- [ ] **Step 1: 编写 ErrorAlert 测试**

```tsx
import { ErrorAlert } from '../src/ui/primitives';

it('renders an error alert with message', () => {
  const html = renderToStaticMarkup(
    <ErrorAlert variant="error">请先导入字幕文件</ErrorAlert>,
  );
  expect(html).toContain('请先导入字幕文件');
  expect(html).toContain('role="alert"');
});

it('renders a warning alert', () => {
  const html = renderToStaticMarkup(
    <ErrorAlert variant="warning">配置不完整</ErrorAlert>,
  );
  expect(html).toContain('配置不完整');
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 创建 ErrorAlert.module.css**

```css
.root {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-normal);
}

.variantError {
  background: var(--color-bg-error);
  border: 1px solid rgba(255, 69, 58, 0.2);
  color: #ff6961;
}

.variantWarning {
  background: var(--color-bg-warning);
  border: 1px solid rgba(255, 159, 10, 0.2);
  color: #ff9f0a;
}

.content {
  flex: 1;
  min-width: 0;
}

.close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  font-size: 14px;
  line-height: 1;
}

.close:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
}
```

- [ ] **Step 4: 创建 ErrorAlert.tsx**

```tsx
import type { ReactNode } from 'react';
import styles from './ErrorAlert.module.css';

export interface ErrorAlertProps {
  variant?: 'error' | 'warning';
  onClose?: () => void;
  children: ReactNode;
}

export function ErrorAlert({
  variant = 'error',
  onClose,
  children,
}: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className={`${styles.root} ${styles[`variant${capitalize(variant)}`]}`}
    >
      <div className={styles.content}>{children}</div>
      {onClose ? (
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
```

- [ ] **Step 5: 在 primitives/index.ts 添加导出**

```ts
export * from './ErrorAlert';
```

- [ ] **Step 6: 运行测试确认通过**

- [ ] **Step 7: 提交**

```bash
git add src/ui/primitives/ErrorAlert.tsx src/ui/primitives/ErrorAlert.module.css src/ui/primitives/index.ts tests/ui-primitives.test.tsx
git commit -m "feat(ui): 新增 ErrorAlert 组件"
```

---

### Task 8: LoadingOverlay 组件

**Files:**
- Create: `src/ui/primitives/LoadingOverlay.tsx`
- Create: `src/ui/primitives/LoadingOverlay.module.css`
- Modify: `src/ui/primitives/index.ts`
- Test: `tests/ui-primitives.test.tsx`

- [ ] **Step 1: 编写测试**

```tsx
import { LoadingOverlay } from '../src/ui/primitives';

it('renders a loading overlay with label', () => {
  const html = renderToStaticMarkup(
    <LoadingOverlay label="正在加载..." />,
  );
  expect(html).toContain('role="status"');
  expect(html).toContain('正在加载...');
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 创建 LoadingOverlay.module.css**

```css
.root {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-overlay);
  backdrop-filter: var(--backdrop-blur);
  -webkit-backdrop-filter: var(--backdrop-blur);
  z-index: 2;
}

.card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 4: 创建 LoadingOverlay.tsx**

```tsx
import styles from './LoadingOverlay.module.css';

export interface LoadingOverlayProps {
  label?: string;
  visible?: boolean;
}

export function LoadingOverlay({
  label,
  visible = true,
}: LoadingOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className={styles.root} role="status" aria-live="polite">
      <div className={styles.card}>
        <span className={styles.spinner} aria-hidden="true" />
        {label ? <span>{label}</span> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 添加导出，运行测试，提交**

```bash
# 添加 export * from './LoadingOverlay'; 到 index.ts
git add src/ui/primitives/LoadingOverlay.tsx src/ui/primitives/LoadingOverlay.module.css src/ui/primitives/index.ts tests/ui-primitives.test.tsx
git commit -m "feat(ui): 新增 LoadingOverlay 组件"
```

---

### Task 9: Divider + SwitchField + NumberField 组件

**Files:**
- Create: `src/ui/primitives/Divider.tsx` + `.module.css`
- Create: `src/ui/primitives/SwitchField.tsx` + `.module.css`
- Create: `src/ui/primitives/NumberField.tsx` + `.module.css`
- Modify: `src/ui/primitives/index.ts`
- Test: `tests/ui-primitives.test.tsx`

- [ ] **Step 1: 编写 Divider / SwitchField / NumberField 测试**

```tsx
import { Divider, SwitchField, NumberField } from '../src/ui/primitives';

it('renders a divider with optional label', () => {
  const html = renderToStaticMarkup(<Divider label="封面设置" />);
  expect(html).toContain('封面设置');
});

it('renders a switch field with label and checked state', () => {
  const html = renderToStaticMarkup(
    <SwitchField label="启用高亮" checked={true} onChange={() => {}} />,
  );
  expect(html).toContain('启用高亮');
  expect(html).toContain('type="checkbox"');
});

it('renders a number field with min/max', () => {
  const html = renderToStaticMarkup(
    <NumberField label="圆角" value={8} onChange={() => {}} min={0} max={24} />,
  );
  expect(html).toContain('圆角');
  expect(html).toContain('type="number"');
  expect(html).toContain('min="0"');
  expect(html).toContain('max="24"');
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 创建 Divider**

`Divider.module.css`:
```css
.root {
  display: flex;
  align-items: center;
  gap: 8px;
}

.line {
  flex: 1;
  height: 1px;
  background: var(--color-border-subtle);
}

.label {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  color: var(--color-text-disabled);
  text-transform: uppercase;
}
```

`Divider.tsx`:
```tsx
import styles from './Divider.module.css';

export interface DividerProps {
  label?: string;
  className?: string;
}

export function Divider({ label, className }: DividerProps) {
  return (
    <div className={`${styles.root}${className ? ` ${className}` : ''}`}>
      <div className={styles.line} />
      {label ? (
        <>
          <span className={styles.label}>{label}</span>
          <div className={styles.line} />
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: 创建 SwitchField**

`SwitchField.module.css`:
```css
.root {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-subtle);
}

.label {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.description {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.toggle {
  flex-shrink: 0;
  accent-color: var(--color-system-blue);
}

.root[data-disabled='true'] {
  opacity: 0.4;
  cursor: not-allowed;
}
```

`SwitchField.tsx`:
```tsx
import styles from './SwitchField.module.css';

export interface SwitchFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
}

export function SwitchField({
  label,
  checked,
  onChange,
  description,
  disabled = false,
}: SwitchFieldProps) {
  return (
    <label className={styles.root} data-disabled={disabled}>
      <div>
        <div className={styles.label}>{label}</div>
        {description ? <div className={styles.description}>{description}</div> : null}
      </div>
      <input
        type="checkbox"
        className={styles.toggle}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        disabled={disabled}
      />
    </label>
  );
}
```

- [ ] **Step 5: 创建 NumberField**

`NumberField.module.css`:
```css
.root {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--color-text-muted);
}

.input {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-subtle);
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  outline: none;
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}

.input:focus-visible {
  border-color: var(--color-system-blue);
  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.2);
}
```

`NumberField.tsx`:
```tsx
import styles from './NumberField.module.css';

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: NumberFieldProps) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    let next = Number(event.currentTarget.value);
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    onChange(next);
  };

  return (
    <label className={styles.root}>
      <span className={styles.label}>{label}</span>
      <input
        type="number"
        className={styles.input}
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}
```

- [ ] **Step 6: 更新 primitives/index.ts 添加 3 个导出**

```ts
export * from './Divider';
export * from './SwitchField';
export * from './NumberField';
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/ui-primitives.test.tsx 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 8: 提交**

```bash
git add src/ui/primitives/Divider.tsx src/ui/primitives/Divider.module.css src/ui/primitives/SwitchField.tsx src/ui/primitives/SwitchField.module.css src/ui/primitives/NumberField.tsx src/ui/primitives/NumberField.module.css src/ui/primitives/index.ts tests/ui-primitives.test.tsx
git commit -m "feat(ui): 新增 Divider、SwitchField、NumberField 组件"
```

---

### Task 10: 迁移 AIPanel — HoverHint → Tooltip + ErrorAlert

**Files:**
- Modify: `src/components/AIPanel.tsx`
- Modify: `src/components/AIPanel.module.css`

- [ ] **Step 1: 替换 AIPanel 中的 HoverHint 为 Tooltip**

在 `src/components/AIPanel.tsx` 中：

1. 添加导入 `Tooltip` 和 `ErrorAlert`：将 `Badge, Button, Field, IconButton, Textarea` 行改为 `Badge, Button, ErrorAlert, Field, IconButton, Textarea, Tooltip`
2. 删除 `HoverHintProps` 接口和 `HoverHint` 函数组件（第 42-54 行）
3. 全局替换 `<HoverHint label=` 为 `<Tooltip label=`，`</HoverHint>` 为 `</Tooltip>`，并添加 `position="bottom"`
4. 将第 606 行的 `{analysisError ? <div className={styles.error}>{analysisError}</div> : null}` 替换为 `{analysisError ? <ErrorAlert>{analysisError}</ErrorAlert> : null}`

- [ ] **Step 2: 清理 AIPanel.module.css 中的 hoverHint 样式**

从 `src/components/AIPanel.module.css` 中删除 `.hoverHint` 和 `.hoverHintBubble` 相关样式（约第 29-62 行）。同时删除 `.error` 样式（第 236-243 行），因为已被 ErrorAlert 组件替代。

- [ ] **Step 3: 运行相关测试**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/ai-panel.test.tsx 2>&1 | tail -10`
Expected: Tests pass

- [ ] **Step 4: 提交**

```bash
git add src/components/AIPanel.tsx src/components/AIPanel.module.css
git commit -m "refactor(AIPanel): 迁移 HoverHint 到 Tooltip，error 到 ErrorAlert"
```

---

### Task 11: 迁移 SubtitleInspector — SwitchField + NumberField + ErrorAlert

**Files:**
- Modify: `src/components/SubtitleInspector.tsx`
- Modify: `src/components/SubtitleInspector.module.css`

- [ ] **Step 1: 重写 SubtitleInspector 使用新组件**

将 `src/components/SubtitleInspector.tsx` 的导入改为：

```tsx
import { Button, ErrorAlert, NumberField, SwitchField } from '../ui/primitives';
```

将 `<label className={styles.switchRow}>...</label>` 替换为：

```tsx
<SwitchField
  label="启用关键词高亮"
  checked={timeline.subtitle.highlightEnabled}
  onChange={(checked) => handleSubtitleStyleUpdate({ highlightEnabled: checked })}
/>
```

将错误提示 `{subtitleHighlightError ? <div className={styles.error}>{subtitleHighlightError}</div> : null}` 替换为：

```tsx
{subtitleHighlightError ? <ErrorAlert>{subtitleHighlightError}</ErrorAlert> : null}
```

将 `<div className={styles.grid}>` 内的数值字段替换为 `NumberField`：

```tsx
<div className={styles.grid}>
  <label className={styles.field}>
    <span>高亮底色</span>
    <input
      type="color"
      value={timeline.subtitle.highlightBackgroundColor}
      onChange={(event) =>
        handleSubtitleStyleUpdate({ highlightBackgroundColor: event.currentTarget.value })
      }
    />
  </label>
  <label className={styles.field}>
    <span>文字颜色</span>
    <input
      type="color"
      value={timeline.subtitle.highlightTextColor}
      onChange={(event) =>
        handleSubtitleStyleUpdate({ highlightTextColor: event.currentTarget.value })
      }
    />
  </label>
  <NumberField
    label="圆角"
    value={timeline.subtitle.highlightRadius}
    onChange={(value) => handleSubtitleStyleUpdate({ highlightRadius: value })}
    min={0}
    max={24}
  />
  <NumberField
    label="横向留白"
    value={timeline.subtitle.highlightPaddingX}
    onChange={(value) => handleSubtitleStyleUpdate({ highlightPaddingX: value })}
    min={0}
    max={24}
  />
  <NumberField
    label="纵向留白"
    value={timeline.subtitle.highlightPaddingY}
    onChange={(value) => handleSubtitleStyleUpdate({ highlightPaddingY: value })}
    min={0}
    max={16}
  />
  <label className={styles.field}>
    <span>高亮动画</span>
    <select
      value={timeline.subtitle.highlightAnimation}
      onChange={(event) =>
        handleSubtitleStyleUpdate({
          highlightAnimation: event.currentTarget.value as SubtitleStyle['highlightAnimation'],
        })
      }
    >
      <option value="pop">弹入</option>
      <option value="wipe">擦入</option>
      <option value="none">无动画</option>
    </select>
  </label>
</div>
```

注意：color 和 select 字段暂时保留内联 `<label>` 形式（因为 NumberField 仅处理数值），grid 布局和 .field 样式保留。

- [ ] **Step 2: 清理 SubtitleInspector.module.css 中的 switchRow 和 error 样式**

从 CSS 中删除 `.switchRow` 及其子规则（第 54-70 行），以及 `.error` 样式（第 38-46 行）。

- [ ] **Step 3: 运行测试**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/subtitle-inspector.test.tsx 2>&1 | tail -10`
Expected: Tests pass

- [ ] **Step 4: 提交**

```bash
git add src/components/SubtitleInspector.tsx src/components/SubtitleInspector.module.css
git commit -m "refactor(SubtitleInspector): 迁移到 SwitchField/NumberField/ErrorAlert"
```

---

### Task 12: 迁移 AISettingsModal — Divider

**Files:**
- Modify: `src/components/AISettingsModal.tsx`

- [ ] **Step 1: 替换内联分隔线为 Divider**

在 `src/components/AISettingsModal.tsx` 中：

1. 添加导入：`import { Button, Divider, Field, Input, ModalShell } from '../ui/primitives';`
2. 替换第 94-96 行的 `<div style={dividerBlockStyle}><div style={sectionEyebrowStyle}>封面生成（即梦）</div></div>` 为：`<Divider label="封面生成（即梦）" />`
3. 删除底部的 `dividerBlockStyle` 和 `sectionEyebrowStyle` 常量

- [ ] **Step 2: 运行测试**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/ai-settings-modal.test.tsx 2>&1 | tail -10`
Expected: Tests pass

- [ ] **Step 3: 提交**

```bash
git add src/components/AISettingsModal.tsx
git commit -m "refactor(AISettingsModal): 迁移内联分隔线到 Divider 组件"
```

---

### Task 13: 迁移 WebCardPreview — LoadingOverlay

**Files:**
- Modify: `src/components/WebCardPreview.tsx`

- [ ] **Step 1: 替换内联 loading overlay 为 LoadingOverlay**

在 `src/components/WebCardPreview.tsx` 中：

1. 添加导入：`import { LoadingOverlay } from '../ui/primitives';`
2. 替换第 64-71 行的 loading overlay JSX：

```tsx
{showLoading ? <LoadingOverlay label={loadingLabel} /> : null}
```

3. 删除底部的 `loadingOverlayStyle` 和 `loadingCardStyle` 常量
4. 删除 `import { LoadingSpinner } from './LoadingSpinner';`（如果不再使用）

- [ ] **Step 2: 运行测试，提交**

```bash
git add src/components/WebCardPreview.tsx
git commit -m "refactor(WebCardPreview): 迁移 loading 到 LoadingOverlay 组件"
```

---

## Phase 3: 新增 Patterns + 迁移 + 收尾

### Task 14: FieldGrid + ModalFooter + StepIndicator + SummaryCard

**Files:**
- Create: `src/ui/patterns/FieldGrid.tsx` + `.module.css`
- Create: `src/ui/patterns/ModalFooter.tsx` + `.module.css`
- Create: `src/ui/patterns/StepIndicator.tsx` + `.module.css`
- Create: `src/ui/patterns/SummaryCard.tsx` + `.module.css`
- Modify: `src/ui/patterns/index.ts`
- Test: `tests/ui-primitives.test.tsx`

- [ ] **Step 1: 编写 4 个 patterns 测试**

```tsx
import { FieldGrid, ModalFooter, StepIndicator, SummaryCard } from '../src/ui/patterns';

it('renders a field grid with columns', () => {
  const html = renderToStaticMarkup(
    <FieldGrid columns={2}>
      <div>A</div>
      <div>B</div>
    </FieldGrid>,
  );
  expect(html).toContain('A');
  expect(html).toContain('B');
});

it('renders a modal footer with cancel and confirm', () => {
  const html = renderToStaticMarkup(
    <ModalFooter cancelLabel="取消" confirmLabel="保存" />,
  );
  expect(html).toContain('取消');
  expect(html).toContain('保存');
});

it('renders step indicator with multiple steps', () => {
  const html = renderToStaticMarkup(
    <StepIndicator
      steps={[
        { label: '解析字幕', status: 'completed' },
        { label: '提炼重点', status: 'active' },
        { label: '生成卡片', status: 'pending' },
      ]}
    />,
  );
  expect(html).toContain('解析字幕');
  expect(html).toContain('提炼重点');
  expect(html).toContain('生成卡片');
});

it('renders a summary card with title and meta', () => {
  const html = renderToStaticMarkup(
    <SummaryCard title="关键词高亮样式" meta="demo.srt">
      当前有 5 处高亮
    </SummaryCard>,
  );
  expect(html).toContain('关键词高亮样式');
  expect(html).toContain('demo.srt');
  expect(html).toContain('当前有 5 处高亮');
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 创建 FieldGrid**

`FieldGrid.module.css`:
```css
.root {
  display: grid;
  gap: 10px;
}
```

`FieldGrid.tsx`:
```tsx
import type { CSSProperties, ReactNode } from 'react';
import styles from './FieldGrid.module.css';

export interface FieldGridProps {
  columns?: number;
  children: ReactNode;
  className?: string;
}

export function FieldGrid({ columns = 2, children, className }: FieldGridProps) {
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
  };

  return (
    <div className={`${styles.root}${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: 创建 ModalFooter**

`ModalFooter.module.css`:
```css
.root {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.extra {
  margin-right: auto;
}
```

`ModalFooter.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Button } from '../primitives';
import styles from './ModalFooter.module.css';

export interface ModalFooterProps {
  onCancel?: () => void;
  onConfirm?: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  confirmVariant?: 'primary' | 'danger';
  extra?: ReactNode;
}

export function ModalFooter({
  onCancel,
  onConfirm,
  cancelLabel = '取消',
  confirmLabel = '确定',
  confirmDisabled = false,
  confirmLoading = false,
  confirmVariant = 'primary',
  extra,
}: ModalFooterProps) {
  return (
    <div className={styles.root}>
      {extra ? <div className={styles.extra}>{extra}</div> : null}
      {onCancel ? (
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
      ) : null}
      {onConfirm ? (
        <Button
          variant={confirmVariant}
          onClick={onConfirm}
          disabled={confirmDisabled}
          loading={confirmLoading}
        >
          {confirmLabel}
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: 创建 StepIndicator**

`StepIndicator.module.css`:
```css
.root {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.step {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.statusPending {
  background: var(--color-bg-muted);
  color: var(--color-text-disabled);
}

.statusActive {
  background: rgba(10, 132, 255, 0.12);
  color: var(--color-system-blue-hover);
}

.statusCompleted {
  background: var(--color-bg-success);
  color: #30d158;
}

.statusError {
  background: var(--color-bg-error);
  color: var(--color-danger);
}

.spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

`StepIndicator.tsx`:
```tsx
import styles from './StepIndicator.module.css';

export interface StepIndicatorStep {
  label: string;
  status: 'pending' | 'active' | 'completed' | 'error';
}

export interface StepIndicatorProps {
  steps: StepIndicatorStep[];
}

export function StepIndicator({ steps }: StepIndicatorProps) {
  return (
    <div className={styles.root}>
      {steps.map((step) => (
        <span
          key={step.label}
          className={`${styles.step} ${styles[`status${capitalize(step.status)}`]}`}
        >
          {step.status === 'active' ? (
            <span className={styles.spinner} aria-hidden="true" />
          ) : null}
          {step.status === 'completed' ? <span aria-hidden="true">✓</span> : null}
          {step.label}
        </span>
      ))}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
```

- [ ] **Step 6: 创建 SummaryCard**

`SummaryCard.module.css`:
```css
.root {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-subtle);
}

.title {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.meta {
  margin-top: 2px;
  color: var(--color-system-blue-hover);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.content {
  margin-top: 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-relaxed);
}
```

`SummaryCard.tsx`:
```tsx
import type { ReactNode } from 'react';
import styles from './SummaryCard.module.css';

export interface SummaryCardProps {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}

export function SummaryCard({ title, meta, children, className }: SummaryCardProps) {
  return (
    <div className={`${styles.root}${className ? ` ${className}` : ''}`}>
      <div className={styles.title}>{title}</div>
      {meta ? <div className={styles.meta}>{meta}</div> : null}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 7: 更新 patterns/index.ts**

```ts
export * from './FieldGrid';
export * from './ModalFooter';
export * from './StepIndicator';
export * from './SummaryCard';
```

- [ ] **Step 8: 运行测试确认通过**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/ui-primitives.test.tsx 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 9: 提交**

```bash
git add src/ui/patterns/FieldGrid.tsx src/ui/patterns/FieldGrid.module.css src/ui/patterns/ModalFooter.tsx src/ui/patterns/ModalFooter.module.css src/ui/patterns/StepIndicator.tsx src/ui/patterns/StepIndicator.module.css src/ui/patterns/SummaryCard.tsx src/ui/patterns/SummaryCard.module.css src/ui/patterns/index.ts tests/ui-primitives.test.tsx
git commit -m "feat(ui): 新增 FieldGrid、ModalFooter、StepIndicator、SummaryCard 组件"
```

---

### Task 15: 迁移 Modal footers — AISettingsModal / ExportSettingsModal / ExportProgress / AICardEditModal

**Files:**
- Modify: `src/components/AISettingsModal.tsx`
- Modify: `src/components/ExportSettingsModal.tsx`
- Modify: `src/components/ExportProgress.tsx`
- Modify: `src/components/AICardEditModal.tsx`

- [ ] **Step 1: 迁移 AISettingsModal footer**

在 `AISettingsModal.tsx` 中将 footer prop 改为使用 ModalFooter：

```tsx
import { ModalFooter } from '../ui/patterns';

// ModalShell 的 footer prop 改为:
footer={
  <ModalFooter
    onCancel={onClose}
    onConfirm={() => {
      if (!canSave) return;
      onSave({ llmBaseUrl, llmApiKey, llmModel, jimengApiUrl, jimengSessionId });
      onClose();
    }}
    confirmLabel="保存"
    confirmDisabled={!canSave}
  />
}
```

- [ ] **Step 2: 迁移 ExportSettingsModal footer**

```tsx
import { ModalFooter } from '../ui/patterns';

footer={
  <ModalFooter
    onCancel={onClose}
    onConfirm={() => void handleConfirm()}
    confirmLabel={isSubmitting ? '准备中...' : '开始导出'}
    confirmDisabled={!outputPath || isSubmitting}
    confirmLoading={isSubmitting}
  />
}
```

- [ ] **Step 3: 迁移 ExportProgress footer**

```tsx
import { ModalFooter } from '../ui/patterns';

footer={
  <ModalFooter
    extra={
      isDone && outputPath ? (
        <Button onClick={() => window.electronAPI.showItemInFolder(outputPath)} variant="tint">
          在 Finder 中显示
        </Button>
      ) : null
    }
    onCancel={canDismiss ? onClose : undefined}
    cancelLabel="关闭"
  />
}
```

- [ ] **Step 4: 迁移 AICardEditModal footer**

```tsx
import { ModalFooter } from '../ui/patterns';

footer={<ModalFooter onCancel={onClose} cancelLabel="关闭" />}
```

- [ ] **Step 5: 运行相关测试**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/ai-settings-modal.test.tsx tests/export-settings-modal.test.tsx tests/export-progress.test.tsx tests/ai-card-edit-modal.test.tsx 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 6: 提交**

```bash
git add src/components/AISettingsModal.tsx src/components/ExportSettingsModal.tsx src/components/ExportProgress.tsx src/components/AICardEditModal.tsx
git commit -m "refactor: 迁移所有 Modal footer 到 ModalFooter 组件"
```

---

### Task 16: 迁移 SubtitleInspector — FieldGrid + SummaryCard

**Files:**
- Modify: `src/components/SubtitleInspector.tsx`
- Modify: `src/components/SubtitleInspector.module.css`

- [ ] **Step 1: 替换 grid 布局为 FieldGrid，summaryCard 为 SummaryCard**

在 SubtitleInspector.tsx 中：

1. 添加导入：`import { FieldGrid, SummaryCard } from '../ui/patterns';`
2. 替换 `<div className={styles.summaryCard}>...</div>` 为：

```tsx
<SummaryCard
  title="关键词高亮样式"
  meta={timeline.podcast.srtPath ? getFileNameFromPath(timeline.podcast.srtPath) : '等待导入字幕'}
>
  {summaryText}
</SummaryCard>
```

3. 替换 `<div className={styles.grid}>...</div>` 为 `<FieldGrid columns={2}>...</FieldGrid>`

- [ ] **Step 2: 清理 SubtitleInspector.module.css 中的 summaryCard 和 grid 样式**

删除 `.summaryCard`, `.summaryTitle`, `.summaryMeta`, `.summaryText`, `.grid` 样式块。

- [ ] **Step 3: 运行测试**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run tests/subtitle-inspector.test.tsx 2>&1 | tail -10`
Expected: Tests pass

- [ ] **Step 4: 提交**

```bash
git add src/components/SubtitleInspector.tsx src/components/SubtitleInspector.module.css
git commit -m "refactor(SubtitleInspector): 迁移到 FieldGrid 和 SummaryCard"
```

---

### Task 17: 迁移 AIPanel — StepIndicator

**Files:**
- Modify: `src/components/AIPanel.tsx`
- Modify: `src/components/AIPanel.module.css`

- [ ] **Step 1: 替换内联步骤行为 StepIndicator**

在 AIPanel.tsx 中：

1. 添加导入：`import { StepIndicator } from '../ui/patterns';`
2. 将两处 `<div className={styles.analysisStepRow}>...</div>` （约第 581-588 行和第 654-660 行）替换为：

```tsx
<StepIndicator
  steps={[
    { label: '解析字幕', status: 'active' },
    { label: '提炼重点', status: 'active' },
    { label: '生成卡片', status: 'active' },
  ]}
/>
```

- [ ] **Step 2: 清理 AIPanel.module.css 中的 analysisStepRow 和 analysisStepChip 样式**

删除 `.analysisStepRow` 和 `.analysisStepChip` 样式块（第 175-194 行）。

- [ ] **Step 3: 运行测试，提交**

```bash
git add src/components/AIPanel.tsx src/components/AIPanel.module.css
git commit -m "refactor(AIPanel): 迁移步骤行到 StepIndicator 组件"
```

---

### Task 18: 迁移 Setup — ErrorAlert

**Files:**
- Modify: `src/pages/Setup.tsx`

- [ ] **Step 1: 检查 Setup.tsx 中的错误横幅使用**

读取 Setup.tsx，找到错误横幅的内联实现，替换为 ErrorAlert。

如果当前使用的是 `<SurfaceCard variant="danger">` 包裹错误消息，替换为：

```tsx
import { ErrorAlert } from '../ui/primitives';

{(localError || errorMessage) ? (
  <ErrorAlert>{localError || errorMessage}</ErrorAlert>
) : null}
```

- [ ] **Step 2: 运行测试，提交**

```bash
git add src/pages/Setup.tsx
git commit -m "refactor(Setup): 迁移错误横幅到 ErrorAlert"
```

---

### Task 19: 全量验证 + 收尾

**Files:**
- All modified files

- [ ] **Step 1: 运行全量测试**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx vitest run 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 2: 运行 build**

Run: `cd /Users/yoqu/Documents/code/self/self-boke/video-web-master && npx electron-vite build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: 检查导出完整性**

验证 `src/ui/primitives/index.ts` 导出了全部 17 个 primitives：

```ts
export * from './Button';
export * from './Badge';
export * from './Divider';
export * from './EmptyState';
export * from './ErrorAlert';
export * from './Field';
export * from './IconButton';
export * from './Input';
export * from './LoadingOverlay';
export * from './MediaPlaceholder';
export * from './ModalShell';
export * from './NumberField';
export * from './ProgressBar';
export * from './SurfaceCard';
export * from './SwitchField';
export * from './Textarea';
export * from './Tooltip';
```

验证 `src/ui/patterns/index.ts` 导出了全部 11 个 patterns：

```ts
export * from './ActionBar';
export * from './FieldGrid';
export * from './FileDropCard';
export * from './ModalFooter';
export * from './PanelHeader';
export * from './PillGroup';
export * from './SearchField';
export * from './SelectionCard';
export * from './StepIndicator';
export * from './SummaryCard';
export * from './TabBar';
```

- [ ] **Step 4: 最终提交（如有收尾修改）**

```bash
git add -A
git commit -m "chore: 组件库扩充与 macOS 风格统一收尾"
```

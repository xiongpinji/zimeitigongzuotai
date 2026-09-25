# 组件库扩充 + macOS 桌面化风格统一设计

## 背景

当前项目 `src/ui/` 下已有 18 个基础组件（11 primitives + 7 patterns），但业务组件中仍存在大量可抽离的内联 UI 模式（Tooltip、ErrorAlert、LoadingOverlay 等）。同时，整体视觉语言偏向网页 dashboard，需要统一调整为 macOS 桌面客户端风格。

本轮将两件事合并执行：**组件库扩充** + **macOS 风格统一**。

## 目标

1. 将业务组件中重复的内联 UI 模式抽离为通用组件，纳入 `src/ui/`
2. 将所有基础组件（现有 + 新增）的视觉语言统一为 macOS 桌面风格
3. 同步迁移业务组件消费新组件，消除重复代码
4. 建立完整的 macOS 风格 design tokens

## 设计输入

- 风格方向：专业创作工具混合型 macOS 桌面风格
- 主题策略：固定深色专业模式
- 视觉参考：macOS 系统设置深色界面
- 参考设计文档：`docs/superpowers/specs/2026-04-03-macos-desktop-ui-refresh-design.md`

## 设计原则

1. **学习 macOS 语法，不照搬系统设置** — 保留视频编辑器结构，吸收桌面语法
2. **低喊叫感替代高装饰感** — 收掉渐变/重阴影/发光，强化明度层级/弱边界/紧凑密度
3. **API 稳定优先** — 优先通过 token 和 CSS 完成视觉迁移，最小化 prop 变更
4. **纯 UI 通用组件库** — 只抽离与业务无关的通用 UI 组件

## Part 1：Design Tokens 改造

改造 `src/ui/styles/tokens.css`，不新建文件。

### 变更项

| Token | 当前值 | 目标值 | 原因 |
|-------|--------|--------|------|
| `--color-bg-canvas` | `#020617`（蓝黑） | 石墨炭灰（如 `#1a1a1e`） | macOS 深色窗口底色 |
| `--color-bg-surface` | `rgba(15, 23, 42, 0.88)` | 炭灰面板色（如 `rgba(44, 44, 46, 0.88)`） | grouped panel 背景 |
| `--color-bg-elevated` | `#0b1220` | 略亮的石墨色 | 浮层区分 |
| `--color-brand-primary` | `#6366f1`（紫） | macOS system blue（如 `#0a84ff`） | 统一选中/聚焦色 |
| `--color-brand-accent` | `#8b5cf6`（紫） | 调整为 blue 辅助色 | 品牌一致性 |
| `--gradient-brand` | 紫色渐变 | 退出主按钮，仅保留装饰用 | 减少网页感 |
| `--shadow-card` | `0 16px 32px ...` | 弱化（如 `0 4px 12px ...`） | 桌面感依赖明度差而非浮起 |
| `--shadow-modal` | `0 24px 80px ...` | 收敛（如 `0 8px 32px ...`） | 桌面 sheet 风格 |
| `--shadow-focus` | 紫色光环 | system blue 光环 | 配合主色变更 |

### 新增 Token

```css
/* 功能色背景 */
--color-bg-error: rgba(255, 69, 58, 0.12);
--color-bg-warning: rgba(255, 159, 10, 0.12);
--color-bg-success: rgba(48, 209, 88, 0.12);

/* 遮罩 */
--color-overlay: rgba(0, 0, 0, 0.44);
--backdrop-blur: blur(20px);

/* macOS system blue */
--color-system-blue: #0a84ff;
--color-system-blue-hover: #409cff;

/* 过渡补充 */
--motion-micro: 100ms ease;
```

### base.css 字体调整

```css
font-family:
  -apple-system,
  "SF Pro Text",
  "SF Pro Display",
  "PingFang SC",
  Inter,
  "Segoe UI",
  sans-serif;
```

## Part 2：新增 Primitives（6 个）

### 2.1 Tooltip

**职责**：轻量悬浮提示，替代 AIPanel 中内联的 HoverHint。

**API**：
```tsx
interface TooltipProps {
  label: string;
  position?: 'top' | 'bottom' | 'left' | 'right'; // 默认 'top'
  children: ReactNode;
}
```

**视觉**：macOS 风格 tooltip — 深色半透明背景 + backdrop blur，小圆角，紧凑字号。

**文件**：`src/ui/primitives/Tooltip.tsx` + `Tooltip.module.css`

### 2.2 ErrorAlert

**职责**：错误/警告提示条。

**API**：
```tsx
interface ErrorAlertProps {
  variant?: 'error' | 'warning'; // 默认 'error'
  onClose?: () => void;
  children: ReactNode;
}
```

**视觉**：低饱和度背景色 + 左侧色条，macOS 风格的克制表达。

**文件**：`src/ui/primitives/ErrorAlert.tsx` + `ErrorAlert.module.css`

### 2.3 LoadingOverlay

**职责**：覆盖父容器的加载遮罩。

**API**：
```tsx
interface LoadingOverlayProps {
  label?: string;
  visible?: boolean; // 默认 true
}
```

**视觉**：半透明 overlay + backdrop blur + 居中 spinner + 可选文案。

**文件**：`src/ui/primitives/LoadingOverlay.tsx` + `LoadingOverlay.module.css`

### 2.4 Divider

**职责**：水平分隔线，可选带标题。

**API**：
```tsx
interface DividerProps {
  label?: string;
  className?: string;
}
```

**视觉**：1px 弱边线，与 macOS grouped section 分隔一致。

**文件**：`src/ui/primitives/Divider.tsx` + `Divider.module.css`

### 2.5 SwitchField

**职责**：标签 + 开关的完整行组件。

**API**：
```tsx
interface SwitchFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
}
```

**视觉**：macOS 风格 toggle switch — grouped settings row 内的开关行。

**文件**：`src/ui/primitives/SwitchField.tsx` + `SwitchField.module.css`

### 2.6 NumberField

**职责**：带 label 和范围限制的数值输入。

**API**：
```tsx
interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}
```

**视觉**：recessed input 风格，内置 clamp 逻辑，统一样式。

**文件**：`src/ui/primitives/NumberField.tsx` + `NumberField.module.css`

## Part 3：新增 Patterns（4 个）

### 3.1 FieldGrid

**职责**：表单字段网格布局容器。

**API**：
```tsx
interface FieldGridProps {
  columns?: number; // 默认 2
  children: ReactNode;
}
```

**文件**：`src/ui/patterns/FieldGrid.tsx` + `FieldGrid.module.css`

### 3.2 ModalFooter

**职责**：模态框底部标准按钮行。

**API**：
```tsx
interface ModalFooterProps {
  onCancel?: () => void;
  onConfirm?: () => void;
  cancelLabel?: string;   // 默认 "取消"
  confirmLabel?: string;  // 默认 "确定"
  confirmDisabled?: boolean;
  confirmVariant?: 'primary' | 'danger'; // 默认 'primary'
  extra?: ReactNode; // 左侧额外内容
}
```

**视觉**：macOS sheet footer — 右对齐，grouped action row。

**文件**：`src/ui/patterns/ModalFooter.tsx` + `ModalFooter.module.css`

### 3.3 StepIndicator

**职责**：多步骤进度指示。

**API**：
```tsx
interface StepIndicatorProps {
  steps: Array<{ label: string; status: 'pending' | 'active' | 'completed' | 'error' }>;
}
```

**视觉**：紧凑水平排列，active 显示 spinner，completed 显示勾号。

**文件**：`src/ui/patterns/StepIndicator.tsx` + `StepIndicator.module.css`

### 3.4 SummaryCard

**职责**：信息摘要卡片，标题 + 元数据 + 内容。

**API**：
```tsx
interface SummaryCardProps {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}
```

**视觉**：grouped section 内的信息面板，低对比度。

**文件**：`src/ui/patterns/SummaryCard.tsx` + `SummaryCard.module.css`

## Part 4：现有组件 macOS 风格改造

仅改 CSS，不改组件 API（除非确有必要做最小补充）。

| 组件 | 改造要点 |
|------|---------|
| **Button** | primary 改为 system blue 实色，收掉渐变/重阴影，尺寸收紧 |
| **IconButton** | 降低默认存在感，hover 改为系统高亮半透明 |
| **Input** | 统一 recessed field 内凹风格，弱边界，低对比背景 |
| **Textarea** | 同 Input 风格统一 |
| **SearchField** | recessed search 语法，参考 macOS 搜索框 |
| **SurfaceCard** | 从网页卡片改为 grouped panel / workspace surface |
| **ModalShell** | 弱化 overlay，header/body 界线克制，桌面 sheet 风格 |
| **Badge** | 改为状态胶囊 / meta pill |
| **Field** | 更像 grouped settings row 容器 |
| **TabBar** | 改为 segmented control 风格 |
| **SelectionCard** | 更像系统设置被选项，system blue selection |
| **PanelHeader** | 改为 section title 风格 |
| **EmptyState** | 调整为桌面工具空状态语法 |
| **ProgressBar** | 收敛到 macOS 风格进度条 |

## Part 5：业务组件迁移

### 迁移映射表

| 业务组件 | 迁移内容 |
|---------|---------|
| `AIPanel` | HoverHint → `Tooltip`（~36 处）, 内联 loading → `LoadingOverlay`, 步骤行 → `StepIndicator`, 错误提示 → `ErrorAlert` |
| `SubtitleInspector` | 内联 grid → `FieldGrid`, checkbox 行 → `SwitchField`, number input → `NumberField`, 错误 → `ErrorAlert`, 摘要 → `SummaryCard` |
| `AICardInspector` | 内联 grid → `FieldGrid`, 错误 → `ErrorAlert` |
| `AISettingsModal` | 内联分隔线 → `Divider`, footer 按钮 → `ModalFooter` |
| `ExportSettingsModal` | footer → `ModalFooter` |
| `ExportProgress` | footer → `ModalFooter` |
| `AICardEditModal` | footer → `ModalFooter` |
| `WebCardPreview` | loading overlay → `LoadingOverlay` |
| `Setup` | 错误横幅 → `ErrorAlert` |

### 删除的内联实现

- `AIPanel` 中的 `HoverHint` 组件和 `HoverHintProps` 类型（被 `Tooltip` 替代）
- `AIPanel.module.css` 中的 `.hoverHint` / `.hoverHintBubble` 样式
- `SubtitleInspector.module.css` 中的 `.grid` / `.field` / `.switchRow` 样式
- 各模态框中重复的 footer 按钮 JSX

## Part 6：分批计划

### P1：Tokens + 现有组件 macOS 风格改造

**改动文件**：
- `src/ui/styles/tokens.css` — token 重写
- `src/ui/styles/base.css` — 字体优先级
- `src/ui/primitives/*.module.css`（11 个） — 视觉调整
- `src/ui/patterns/*.module.css`（7 个） — 视觉调整

**验证**：build 通过，现有页面视觉收敛为 macOS 风格

### P2：新增 Primitives + 迁移

**新增**：Tooltip, ErrorAlert, LoadingOverlay, Divider, SwitchField, NumberField（6 组件 × 2 文件 = 12 文件）

**迁移**：AIPanel, SubtitleInspector, AICardInspector, AISettingsModal, WebCardPreview, Setup

**验证**：新组件可用，迁移后业务组件行为不变

### P3：新增 Patterns + 迁移 + 收尾

**新增**：FieldGrid, ModalFooter, StepIndicator, SummaryCard（4 组件 × 2 文件 = 8 文件）

**迁移**：SubtitleInspector 字段网格, 所有 Modal footer, AIPanel 步骤行, SubtitleInspector 摘要

**验证**：全量 build + test 通过，全面检查视觉一致性

## 不纳入范围

- Remotion 卡片渲染逻辑
- Timeline 交互逻辑重写
- 主题切换系统
- store / hooks / 数据结构变更
- 浅色模式

## 验收标准

1. 所有基础组件视觉不再呈现"网页 dashboard"特征
2. 编辑器主界面具备 macOS 桌面客户端气质
3. 业务组件中的重复内联 UI 模式已迁移到组件库
4. `src/ui/` 组件导出完整，index 文件已更新
5. build 和现有测试通过
6. 核心页面可正常交互

## 风险

- 当前工作区存在未提交的 timeline 相关改动，实施时需避开冲突
- token 变更会影响所有已有组件的视觉，P1 完成后需全面检查
- 部分业务组件有 inline style，迁移时需一并清理

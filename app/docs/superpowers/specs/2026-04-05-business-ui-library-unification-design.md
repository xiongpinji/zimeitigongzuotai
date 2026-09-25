# 业务 UI 组件库统一化设计

## 背景

项目已经引入 `@pikoloo/darwin-ui`，并且大部分业务界面通过 `src/ui/primitives` 与 `src/ui/patterns` 消费本地 UI 层。但本轮审计确认：

- 业务层仍残留原生控件与自绘交互，如字幕高亮配置的原生 `<select>` 与颜色输入
- 多个弹窗仍依赖自写 `ModalShell`
- 若干“选择卡片 / 开关 / 确认操作”仍由本地手写组件承载
- 即便部分控件已调用 Darwin UI，当前包装层也存在较重 CSS 重绘，尚未形成真正的单一组件库语义

用户已确认采用方案 A：

- 保留 `src/ui/*` 作为本地薄适配层
- 所有底层交互语义优先落到 `@pikoloo/darwin-ui`
- 业务层不再新增原生 `button/select/dialog/checkbox` 一类控件
- 遇到 Darwin UI 当前没有覆盖的能力时，只保留最小业务封装

## 目标

- 让项目的交互底座统一到 Darwin UI，而不是“Darwin UI + 本地重绘 + 原生控件”混用
- 优先收敛高频交互：弹窗、选择器、开关、错误提示、删除确认、卡片选择
- 业务层继续通过本地 `src/ui/*` 访问组件，避免第三方 API 散落到业务代码
- 保持现有业务逻辑、状态管理和 Electron 桥接不变

## 非目标

- 不重写 Timeline 拖拽、Overlay 编辑、Remotion 渲染等业务交互逻辑
- 不在本轮引入新的设计系统或替换 Darwin UI
- 不追求删除所有本地 pattern 组件；仅删除“重复实现基础交互语义”的部分

## 审计结论

### 已经对齐 Darwin UI 的部分

- `Button` / `IconButton`
- `Input` / `Textarea`
- `Badge`
- `ProgressBar`
- `SurfaceCard`
- `TabBar`
- `SearchField`

这些组件已接入 Darwin UI，但包装层仍有较重 CSS 覆盖，需要在本轮顺带瘦身。

### 仍属于本地重写的交互语义

- `ModalShell`：自写 portal 与 dialog 容器
- `SwitchField`：自写 checkbox/switch 结构
- `SelectionCard`：原生 `<button>` 卡片选择器
- `ErrorAlert`：自写 alert 容器
- `AssetPanel` 删除确认：原生 `window.confirm`
- `SubtitleInspector`：原生 `<select>` 与颜色 `<input>`
- `AICoverPanel`：候选封面用可点击 `div` 承载选择行为

## 设计原则

### 1. 本地 facade 保留，但只做薄适配

`src/ui/*` 继续保留，作用变成：

- 对 Darwin UI 的 props 做项目语义映射
- 控制少量统一 className 与尺寸约定
- 封装项目需要但 Darwin UI 没有的一点点业务 glue code

不再在 facade 内部重写 dialog/switch/select/button 的核心交互结构。

### 2. 先替换基础语义，再替换业务残留

顺序固定为：

1. 根部 Provider 与 primitives
2. patterns 中重复基础语义的组件
3. 业务层原生 / 自绘控件
4. 测试与样式收尾

### 3. 对“Darwin UI 没有”的控件设置明确例外

本轮确认的例外：

- 颜色选择器：Darwin UI 当前无现成 color picker，继续用原生 `input[type="color"]`，但收敛为本地 `ColorField` 风格包装
- 文件拖拽面板：保留业务拖拽逻辑，但外观尽量由 `SurfaceCard` / `Button` 组合承载
- 时间线拖拽轨道：属于编辑器业务画布，不作为通用组件替换目标

## 目标架构

### primitives

- `ModalShell` 改为 Darwin `Dialog`
- `SwitchField` 改为 Darwin `Switch`
- `ErrorAlert` 改为 Darwin `Alert`
- `Button` / `IconButton` / `Input` / `Textarea` / `SurfaceCard` 保留，但减少视觉重绘
- 新增 `SelectField` 作为 Darwin `Select` 的本地适配

### patterns

- `SelectionCard` 删除或退化为基于 `SurfaceCard + Button/Badge` 的纯展示组合，不再承担底层选择器职责
- `ModalFooter` 保留，仅负责布局
- `FileDropCard` 保留为业务 pattern，但底座统一使用现有 primitives

### 业务层

- `AISettingsModal` / `ExportSettingsModal` / `AICardEditModal` / `ExportProgress` 自动继承新的 `ModalShell`
- `SubtitleInspector` 用 `SelectField` 替换原生 `<select>`
- `AssetPanel` 用 Darwin Dialog 驱动确认流，替换 `window.confirm`
- `AICoverPanel` 把候选封面从可点击 `div` 收敛为基于 `SurfaceCard` 的可选择卡片

## 验证策略

- 更新现有 `ui-primitives` 相关测试，确保 Dialog / Alert / Switch / SelectField 可渲染
- 更新 `subtitle-inspector`、`export-settings-modal`、`ai-settings-modal`、`asset-panel`、`ai-cover-panel` 等测试，确保交互语义不回退
- 最终跑定向测试 + 全量 `vitest run`

## 风险

- Darwin `Dialog` 依赖 `OverlayProvider`，需要在应用根部补充 Provider
- Modal 替换后，现有基于 SSR fallback 的测试可能需要调整
- `SelectionCard` 被移除后，导出设置与候选封面选择的 DOM 结构会变化，对测试影响较大

## 实施决策

- 采用 Darwin UI 作为唯一基础交互语义来源
- 保留本地 facade，但目标是“薄适配”，不是“二次造轮子”
- 对颜色选择器和拖拽面板采用最小例外策略

# AI 助手面板 UI 组件库统一化设计

## 背景

当前项目已经具备较完整的本地 UI 组件库，基础能力集中在 `src/ui/components`、`src/ui/primitives` 与 `src/ui/patterns`。但本轮审查确认，AI 助手相关面板仍存在明显的“双轨实现”：

- 动画能力已经集中在 `src/ui`，业务层没有直接引入 `framer-motion`
- 但业务层仍残留大量原生 `button / textarea / select / checkbox` 与自绘控件壳
- 这些壳子与现有 UI 组件库职责重叠，导致同类交互在多个文件中重复维护
- 最近为对齐 `design.pen` 做的若干业务层样式调整，也进一步放大了这种重复实现

用户已确认采用方案 B：

- 保留 `src/ui/*` 作为项目唯一的通用交互入口
- 允许先对 `src/ui` 做小幅增强，再替换业务层重复控件
- 真正业务特化的对象保留在业务层，不做过度抽象

## 目标

- 让 AI 助手相关面板的通用交互统一收敛到 `src/ui`
- 删除业务层重复实现的基础控件壳子
- 保持当前业务逻辑、状态流、AI 分析流程和设计稿对齐结果不变
- 为后续面板继续统一到 UI 组件库打下稳定基础

## 非目标

- 不重写 AI 分析、封面生成、卡片编辑的业务逻辑
- 不大规模重做所有页面样式，仅处理“应归属 UI 库”的通用控件
- 不把时间轴块、封面候选卡片这类业务对象强行抽成通用组件

## 审查结论

### 已经正确集中在 UI 层的部分

- 动画底座：`Button`、`Tabs`、`Switch` 等均在 `src/ui` 内部使用 `framer-motion`
- 页面级较成熟的 UI 复用：`Setup`、`AssetPanel`、`PreviewPanel`、`AISettingsModal`、`ExportSettingsModal`

### 仍然在业务层重复实现的通用控件

- `SubtitleInspector`
  - `CompactColorField`
  - `CompactNumberField`
  - `CompactSwitch`
  - 原生 `<select>` 包装壳
- `AICardInspector`
  - 类型/展示模式 pill 切换
  - 次级/主操作按钮
  - 危险按钮
- `AIPanel`
  - 顶部 icon button
  - 子 tab
  - prompt textarea
  - action/footer button
- `AICoverPanel`
  - header action button
  - prompt textarea
  - inline action
  - 主按钮与 footer button
- `AICardList`
  - checkbox 壳
- `Editor`
  - 左侧栏顶部 tab button
- `EditorInspector`
  - close button

### 保留为业务特化实现的部分

- `TimelineSubtitleBlocks`：时间轴字幕块属于业务画布对象
- `AICoverPanel` 中候选封面卡片本身：可保留为业务卡片，只把按钮/输入类基础交互换成 UI 库

## 设计原则

### 1. 先增强现有 UI 组件，再替换业务层

不新增平行组件体系，优先复用已有能力：

- `Button`
- `Tabs`
- `Textarea`
- `Checkbox`
- `Select`
- `Switch`
- `ColorField`
- `NumberField`
- `PillGroup`

如果现有能力不够，只做最小增强，使其能覆盖当前 AI 助手面板的设计需求。

### 2. 通用交互语义必须离开业务文件

业务层不再保留：

- 重复的步进器/开关/颜色字段实现
- 仅承担通用交互职责的 button shell
- 仅承担 tab/pill 选择职责的局部实现

### 3. 业务特化布局与视觉骨架可继续留在原文件

例如：

- 封面候选卡片网格
- AI 卡片预览框
- 时间轴字幕块

这些仍属于业务视图，不强制抽到 `src/ui`

## 目标架构

### `src/ui` 层

- 增强 `ColorField`，支持当前字幕高亮面板所需的紧凑展示能力
- 增强 `NumberField`，支持更贴合 inspector 紧凑布局的用法
- 复用 `PillGroup` 驱动 AI 卡片 inspector 的分组切换
- 复用 `Button / Tabs / Textarea / Checkbox / Switch / Select`

### 业务层

- `SubtitleInspector` 只负责字幕高亮业务状态与布局
- `AICardInspector` 只负责 AI 卡片编辑字段与预览业务
- `AIPanel` / `AICoverPanel` 只负责 AI 助手流程和布局组合
- `AICardList` 只负责卡片行视图，不再维护 checkbox 交互壳

## 验证策略

- 增加源码架构测试，直接检查关键业务文件中是否仍残留原生 `button / textarea / select / checkbox`
- 保持并更新现有 SSR 组件测试，确保文案、结构和设计稿对齐不回退
- 最终运行 AI 助手相关测试和生产构建

## 风险

- `Select` 与 `Tabs` 替换后，SSR 输出结构会与当前测试略有差异
- `Button` / `Checkbox` 迁移后，部分 CSS 需要收敛以避免样式双重覆盖
- 当前工作区是脏的，改造必须严格限制在本轮目标文件，不能误伤其他改动

## 实施决策

- 以 `src/ui` 作为唯一通用交互来源
- 先处理最明显重复实现的 `SubtitleInspector` 和 `AICardInspector`
- 再处理 `AIPanel`、`AICoverPanel`、`AICardList`、`Editor`
- 保留业务特化卡片与时间轴对象，不做过度抽象

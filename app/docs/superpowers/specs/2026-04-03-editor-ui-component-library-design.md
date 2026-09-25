# 编辑器 UI 组件库抽取设计

## 背景

当前项目的编辑器侧 UI 已经形成稳定的视觉语言，但实现方式仍以业务组件内部的 inline style 为主，导致以下问题持续放大：

- 基础样式重复，尤其集中在 Modal、Button、Field、Badge、EmptyState 等区域
- 颜色、圆角、间距、层级等 token 事实存在，但没有被显式管理
- 交互态缺失，当前编辑器几乎没有统一的 hover、focus、disabled 反馈
- 新功能开发时必须先复制已有样式块，再做局部调整，迭代成本不断增加

本设计的目标，是先为编辑器 UI 建立一套轻量但可持续扩展的基础组件库，而不是一次性重构整个项目。

## 结论

采用混合方案：

- 编辑器 UI：引入 `CSS Modules + CSS Variables`，建立基础组件库
- Remotion 渲染组件：继续保持 inline style，不纳入第一阶段组件库改造范围
- 业务组件：保留在 `src/components/`，逐步改为消费 `src/ui/*`

这个方案能在不影响视频渲染侧稳定性的前提下，优先解决编辑器交互与重复样式问题。

## 现状诊断

### 1. 高重复区域

#### Modal 系统

以下组件的外层结构高度相似：

- `src/components/AISettingsModal.tsx`
- `src/components/AICardEditModal.tsx`
- `src/components/ExportSettingsModal.tsx`
- `src/components/ExportProgress.tsx`

重复内容包括：

- overlay 遮罩
- modal 容器
- eyebrow 小标题
- 标题区
- action footer
- primary / secondary button

#### 按钮系统

按钮结构分散在多个组件中，主要问题：

- 高度不统一，出现 `28 / 32 / 36 / 44 / 48` 等多种规格
- 圆角在 `8 / 10 / 12 / 14 / 16` 间混用
- 颜色语义存在，但没有组件变体抽象
- `IconButton`、`Pill Button`、`Primary Button`、`Secondary Button` 均为手写实现

#### 表单与输入

输入型组件主要重复于：

- `AISettingsModal`
- `AICardEditModal`
- `AIPanel`
- `AICoverPanel`
- `Setup`

重复模式包括：

- `label + input`
- `label + textarea`
- hint / placeholder 表达
- disabled / loading 表现

#### 状态胶囊与筛选项

重复出现在：

- `AssetPanel`
- `AIPanel`
- `AICardList`
- `Toolbar`
- `PreviewPanel`

这些元素本质上都是 `Badge / Pill / Counter` 的不同视觉变体。

### 2. 已存在但未系统化的 design tokens

以下值已在项目内多次重复出现：

- `rgba(255,255,255,0.08)`
- `#91a2bc`
- `#f5f7fb`
- `#f8fafc`
- `#eef4ff`
- `linear-gradient(90deg, #6366f1, #8b5cf6)`
- `linear-gradient(90deg, #7bd5ff 0%, #5fa4ff 100%)`

说明项目已经形成统一审美倾向，但缺少 token 层统一入口。

### 3. 当前可直接复用的组件

- `src/components/AppIcon.tsx`
- `src/components/LoadingSpinner.tsx`

这两个组件可直接作为组件库初始成员迁入或转为 `src/ui/primitives/` 体系。

## 设计原则

### 1. 先抽基础壳层，再抽业务模式

先沉淀最底层的复用单元：

- token
- primitives
- patterns

暂不直接把业务卡片、素材项、AI 面板整体视为“组件库组件”。

### 2. 组件库只服务编辑器 UI

本次抽取仅覆盖 React DOM 编辑器区域，不进入 Remotion composition 组件。

### 3. 最小侵入

- 不新增重型 UI 框架
- 不引入 CSS-in-JS
- 不改变现有 store、数据结构、Remotion 渲染逻辑
- 允许业务组件保留少量 inline dynamic style，但基础视觉必须逐步回收到组件库

### 4. 先统一状态表达

所有基础组件必须支持统一的：

- default
- hover
- focus-visible
- active
- disabled
- loading

## 组件库分层

### Layer 1: Tokens

建议新增：

- `src/ui/styles/tokens.css`
- `src/ui/styles/base.css`

其中 `tokens.css` 负责定义 CSS variables，`base.css` 负责基础 reset、focus-visible、滚动条、文本选择等通用表现。

建议的 token 分组：

- color
- spacing
- radius
- shadow
- typography
- z-index
- motion

示例命名：

- `--color-bg-canvas`
- `--color-bg-surface`
- `--color-bg-elevated`
- `--color-border-subtle`
- `--color-text-primary`
- `--color-text-secondary`
- `--color-brand-primary`
- `--color-brand-accent`
- `--radius-sm`
- `--radius-md`
- `--radius-lg`
- `--space-2`
- `--space-3`
- `--space-4`
- `--shadow-card`
- `--shadow-modal`
- `--z-modal`
- `--z-toast`

### Layer 2: Primitives

建议目录：

- `src/ui/primitives/Button.tsx`
- `src/ui/primitives/Button.module.css`
- `src/ui/primitives/IconButton.tsx`
- `src/ui/primitives/IconButton.module.css`
- `src/ui/primitives/Input.tsx`
- `src/ui/primitives/Input.module.css`
- `src/ui/primitives/Textarea.tsx`
- `src/ui/primitives/Textarea.module.css`
- `src/ui/primitives/Field.tsx`
- `src/ui/primitives/Field.module.css`
- `src/ui/primitives/Badge.tsx`
- `src/ui/primitives/Badge.module.css`
- `src/ui/primitives/ModalShell.tsx`
- `src/ui/primitives/ModalShell.module.css`
- `src/ui/primitives/ProgressBar.tsx`
- `src/ui/primitives/ProgressBar.module.css`
- `src/ui/primitives/EmptyState.tsx`
- `src/ui/primitives/EmptyState.module.css`

第一批变体建议：

#### Button

- variants: `primary | secondary | danger | tint | ghost`
- sizes: `sm | md | lg`
- states: `disabled | loading`

#### IconButton

- variants: `ghost | subtle | brand | danger`
- sizes: `sm | md`

#### Field

- `label`
- `hint`
- `error`
- `required`
- `content slot`

#### Badge

- variants: `neutral | info | success | warning | danger | brand`
- shapes: `pill | rounded`

#### ModalShell

- `visible`
- `title`
- `eyebrow`
- `footer`
- `size`
- `zIndex`
- `onClose`

`ModalShell` 只解决结构与样式，不处理业务表单逻辑。

### Layer 3: Patterns

建议第二阶段新增：

- `PanelHeader`
- `TabBar`
- `SearchField`
- `ActionBar`
- `SectionCard`
- `StatusChipRow`

这些组件已经包含部分编辑器语义，但仍然不应绑定具体业务实体。

### Layer 4: Business Components

继续保留在 `src/components/`，如：

- `AIPanel`
- `AICoverPanel`
- `AssetPanel`
- `AssetCard`
- `AICardList`
- `PreviewPanel`

这些组件的职责是业务编排，不进入组件库。

## 优先级与替换顺序

### P0

- `ModalShell`
- `Button`
- `IconButton`
- `Input`
- `Textarea`
- `Field`

### P1

- `Badge`
- `ProgressBar`
- `EmptyState`
- `PanelHeader`
- `TabBar`

### P2

- `SearchField`
- `ActionBar`
- `SectionCard`

## 迁移策略

### 阶段一：建立基础层，不做大范围替换

完成以下工作：

- 增加 UI styles 入口
- 定义 token
- 建立 primitives
- 补齐基础测试

目标是让后续迁移有稳定落点。

### 阶段二：优先替换 Modal 家族

迁移：

- `AISettingsModal`
- `AICardEditModal`
- `ExportSettingsModal`
- `ExportProgress`

这是收益最大的第一批替换，因为结构最稳定，重复度最高。

### 阶段三：替换高频交互区

迁移：

- `AIPanel`
- `AICoverPanel`
- `AssetPanel`
- `AICardList`

重点替换按钮、标签、输入区、空状态、action bar。

### 阶段四：整理页面级结构

迁移：

- `Toolbar`
- `PreviewPanel`
- `Editor`
- `Setup`

这一阶段更多是把 pattern 组件真正落地。

## 非目标

以下内容不属于本轮抽取范围：

- Remotion 组件视觉重构
- 全项目主题切换
- 引入第三方组件库
- 全量替换所有 inline style
- 一次性重构所有业务组件

## 风险与约束

### 1. CSS Modules 与 inline style 并存期较长

短期内项目会出现两种样式实现方式并存，这是可接受的，但必须控制边界：

- `src/ui/*` 统一使用 CSS Modules
- `src/components/*` 允许过渡期并存，但新增基础视觉不再手写复制

### 2. 动态布局仍需保留局部 inline style

如：

- 拖拽位置
- preview stage 尺寸
- 计算得出的 overlay frame

这类动态值继续允许 inline style 或 CSS variable 注入。

### 3. 测试需要跟随组件抽象一起升级

组件库抽取后，测试应逐步从“具体按钮文案样式存在”转为“语义和状态正确”。

## 验收标准

满足以下条件即可认为第一轮组件库抽取成功：

1. 编辑器 UI 已有统一 token 入口
2. Modal、Button、Field 三大基础壳层已抽取完成
3. 4 个 modal 不再复制各自的 overlay / container / action 样式
4. 基础按钮与输入控件支持 hover / focus-visible / disabled / loading
5. 新增编辑器功能时，可以优先从 `src/ui/*` 拼装，而不是复制旧组件样式

## 推荐下一步

按本设计继续编写实施计划，并以“基础层 -> modal 替换 -> 高频交互区迁移 -> 页面级整理”的顺序推进。

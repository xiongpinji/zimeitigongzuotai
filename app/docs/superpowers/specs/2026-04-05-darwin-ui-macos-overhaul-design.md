# Darwin UI 源码直入 src/ui 设计

## 背景

当前项目已经在业务层大量使用 `@pikoloo/darwin-ui`，但使用方式是先经过 `src/ui/primitives/*` 与 `src/ui/patterns/*` 的本地包装层，再由业务组件引用。这个结构适合“借用外部组件库”，但不适合用户当前的新目标：

- 将 Darwin UI 全量源码纳入当前仓库，后续可自行二次开发
- 不再依赖上游仓库或 npm 包产物
- 架构尽量简单，不引入 monorepo、本地 package、额外 facade 层
- 如果本地 `src/ui` 下已有重复能力，直接以 Darwin 组件替换，并改业务引用侧

用户已明确否决以下方案：

- 不要 `packages/darwin-ui`
- 不要 `src/ui/darwin -> src/ui/primitives -> 业务` 这种二层依赖
- 不要继续保留“Darwin 外面再套一层同名包装”的重复结构

因此本轮方案收敛为：

- 直接将 Darwin UI 上游源码并入 `src/ui`
- 让 `src/ui` 直接成为“Darwin 源码 + 项目自有组合组件”的统一 UI 根目录
- 删除重复包装组件，业务代码直接依赖 Darwin 组件导出

## 目标

本轮工作的目标是把当前 UI 体系切换为“源码内置的 Darwin UI”：

1. 将 Darwin UI 全量源码接入 `src/ui`
2. 移除对 `@pikoloo/darwin-ui` 的外部包依赖
3. 删除本地重复包装组件，减少层层依赖
4. 将业务侧引用迁移到新的 `src/ui` 统一导出
5. 在行为和视觉上保持现有功能可用，最终结果与当前应用需求对齐

## 非目标

- 不重构 Electron / Zustand / Remotion 业务逻辑
- 不重新设计整个产品信息架构
- 不一次性重写所有 CSS Modules 为 Tailwind utilities
- 不追求与上游文档示例 1:1 一致的页面结构

## 核心决策

### 1. `src/ui` 直接承接 Darwin 源码

Darwin UI 上游源码将被完整复制到以下目录：

- `src/ui/components/`
- `src/ui/contexts/`
- `src/ui/hooks/`
- `src/ui/lib/`

并在 `src/ui/styles/` 下引入 Darwin 的官方样式文件。

这样做的好处是：

- 所有 Darwin 源码都在当前仓库中，可直接修改
- 保持目录扁平，不额外引入 workspace/package 层
- 未来同步上游时，也能明确知道哪些目录来自 Darwin

### 2. 删除重复包装组件

以下现有本地组件，本质上只是 Darwin 的包装或近似包装，需要被 Darwin 组件直接替代：

- `Button`
- `Badge`
- `ErrorAlert`
- `IconButton`
- `Input`
- `Textarea`
- `ProgressBar`
- `SelectField`
- `SwitchField`
- `SurfaceCard`
- `ModalShell`
- `SearchField`
- `TabBar`
- `cn`

这些文件不再作为独立 facade 保留。业务层将直接改用 Darwin 组件导出，必要时在业务文件中自行组合：

- `Dialog + DialogContent + DialogHeader + DialogBody + DialogFooter`
- `Field + Select`
- `Field + Switch`
- `Tabs + TabsList + TabsTrigger`
- `SearchInput`
- `Card`

### 3. 保留项目自有组合组件

以下组件不与 Darwin 重复，保留为项目本地 UI 资产：

- `Divider`
- `EmptyState`
- `Field`
- `LoadingOverlay`
- `MediaPlaceholder`
- `NumberField`
- `ActionBar`
- `FieldGrid`
- `FileDropCard`
- `ModalFooter`
- `PanelHeader`
- `PillGroup`
- `StepIndicator`
- `SummaryCard`

但它们的内部依赖要改成直接使用 `src/ui/components/*` 中的 Darwin 组件，而不是再经过本地重复包装层。

### 4. `src/ui/index.ts` 作为唯一公共出口

迁移完成后：

- 业务组件优先从 `../ui` 引用
- 不再从 `../ui/primitives` 或 `../ui/patterns` 分层导入重复能力
- `src/ui/index.ts` 统一导出 Darwin 组件、上下文、hooks、工具，以及项目自有组合组件

这能让使用侧更简单，也能减少内部结构变动对业务侧的影响。

## 目录设计

迁移完成后，`src/ui` 预期结构如下：

```text
src/ui/
  components/     Darwin UI 全量组件源码
  contexts/       Darwin UI 上下文
  hooks/          Darwin UI hooks
  lib/            Darwin UI 工具与本地补充工具
  patterns/       项目自有组合组件
  primitives/     仅保留非 Darwin 重复的本地原子组件
  styles/         Darwin 样式 + 本地主题 bridge
  index.ts        统一导出入口
```

其中：

- `components/contexts/hooks/lib` 来源于 Darwin UI
- `patterns/primitives/styles` 保留项目自己的业务适配能力

## 迁移策略

### 阶段 1：源码与依赖接入

- 将 Darwin UI 上游 `src/*` 拷贝到 `src/ui/*`
- 将 Darwin 样式文件复制到 `src/ui/styles/`
- 删除 `@pikoloo/darwin-ui` 依赖
- 将 Darwin 运行时依赖显式写入当前项目 `package.json`

### 阶段 2：公共导出层重建

- 重写 `src/ui/index.ts`
- 删除重复包装组件导出
- 确保 `OverlayProvider`、`cn`、Darwin 基础控件都从本地 `src/ui` 导出

### 阶段 3：本地组合组件直连 Darwin

- `ModalFooter` 改为直接依赖 Darwin `Button`
- `PillGroup` 改为直接依赖 Darwin `Button`
- `SummaryCard` 改为直接依赖 Darwin `Card`
- 其他保留组件根据需要直连 Darwin 原子能力

### 阶段 4：业务引用迁移

业务文件不再从 `../ui/primitives` 和 `../ui/patterns` 获取重复能力，而是：

- 从 `../ui` 获取 Darwin 组件与保留组件
- 在需要时直接使用 Darwin 的组合型 API

典型变化包括：

- `ModalShell -> Dialog` 组合
- `SurfaceCard -> Card`
- `SearchField -> SearchInput`
- `TabBar -> Tabs`
- `SelectField -> Field + Select`
- `SwitchField -> Switch` 或 `Field + Switch`

## 风险与对策

### 风险 1：dirty worktree 中已有同主题改动

当前分支已经存在较多 UI 相关改动，且不少文件正是本次改造目标。

对策：

- 不回滚现有改动
- 逐文件读取当前状态后再合并迁移
- 以最终功能一致和引用收敛为准，而不是机械覆盖

### 风险 2：业务 props 与 Darwin 原生 API 不完全一致

例如：

- `danger / tint / subtle / brand / neutral` 这些项目自定义 variant 名
- `ModalShell` 的 `visible/footer/title/description` 语义
- `SelectField` 和 `SwitchField` 的字段型封装

对策：

- 业务侧逐点改造，不保留中间包装层
- 对复杂场景直接改 JSX 结构，不强行追求兼容旧 props

### 风险 3：全局样式顺序可能影响现有页面

Darwin 样式自带 Tailwind 和主题变量，可能与本地 `tokens.css/base.css` 出现层叠影响。

对策：

- 保持 `tailwind.css -> tokens.css -> base.css` 的导入顺序
- 让本地 tokens 作为 Darwin theme bridge 的最终覆盖层
- 优先保证 dark desktop 结果一致，而不是保留历史 token 含义

## 验收标准

完成后应满足：

1. `src/ui` 已包含 Darwin UI 全量源码
2. `package.json` 不再依赖 `@pikoloo/darwin-ui`
3. 重复包装组件已删除或不再被使用
4. 业务层不再依赖旧的重复包装接口
5. `npm test` 与 `npm run build` 通过
6. Setup、Editor、AI 面板、资源弹窗、导出弹窗等核心界面可正常工作

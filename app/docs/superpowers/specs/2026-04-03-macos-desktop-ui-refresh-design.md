# macOS 桌面化编辑器 UI 升级设计

## 背景

当前项目已经完成了一轮 `src/ui/*` 基础组件抽离，但整体视觉语言仍然明显偏向网页端 dark dashboard：

- 主按钮依赖渐变、重阴影和较强悬浮感
- `SurfaceCard` 更像网页卡片，而不是桌面客户端中的窗口分区或 grouped panel
- `ModalShell`、输入框、搜索框、标签和 tab 仍保留浓厚的 web 表达
- 页面骨架是“卡片拼接”，缺少 macOS 应用窗口的一体化 shell 感

用户明确希望按钮、文字、弹窗等基础组件更接近 macOS / Swift 系列桌面客户端，并提供了一张 macOS 系统设置深色界面截图作为参考。

## 目标

本轮设计目标不是把应用改成“系统设置页面”，而是吸收其最有辨识度的桌面语法，让当前 Electron 编辑器具备更强的 macOS 客户端气质：

- 采用固定深色专业模式，不做浅深双主题
- 以基础 token 与 primitives 为主改造入口
- 将 macOS 系统设置截图中的 `window shell / source list / grouped settings / selection blue / recessed search` 融合到视频编辑器语境中
- 保持现有业务逻辑、数据结构和 Remotion 渲染逻辑不变

## 设计输入

### 用户确认的方向

- 风格方向：`B 方案：专业创作工具混合型`
- 改造范围：`先统一全局基础组件`
- 主题策略：`固定深色专业模式`
- 视觉参考：`macOS 系统设置深色界面截图`

### 参考依据

- [Apple Human Interface Guidelines: Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)
- [Apple Human Interface Guidelines: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Apple Human Interface Guidelines: Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
- [Apple Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)

以下结论为基于上述官方文档与用户截图的设计推断：

- macOS 窗口结构强调统一 shell，而不是多个彼此独立的网页卡片
- toolbar、sidebar、search field、selection、grouped section 的层级表达比颜色本身更重要
- 强调色应当节制，只在选中、聚焦和主要动作上出现
- 阴影与浮起感应弱于网页 dashboard，更多依赖材质、边线和明度差区分层级

## 现状诊断

### 1. Token 与基础视觉仍偏网页语法

[tokens.css](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/ui/styles/tokens.css) 当前存在以下问题：

- 背景整体偏蓝黑，较少石墨灰和桌面工具常用的炭灰层次
- `--gradient-brand` 和主按钮阴影过于显眼
- `--shadow-card`、`--shadow-modal` 更像网页卡片浮层
- 全局字体优先级仍偏 `Inter`

### 2. Primitive 抽象已完成，但语法不够桌面化

关键文件包括：

- [Button.module.css](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/ui/primitives/Button.module.css)
- [IconButton.module.css](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/ui/primitives/IconButton.module.css)
- [Input.module.css](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/ui/primitives/Input.module.css)
- [Textarea.module.css](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/ui/primitives/Textarea.module.css)
- [Field.module.css](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/ui/primitives/Field.module.css)
- [Badge.module.css](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/ui/primitives/Badge.module.css)
- [SurfaceCard.module.css](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/ui/primitives/SurfaceCard.module.css)
- [ModalShell.module.css](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/ui/primitives/ModalShell.module.css)

它们已经解决了复用问题，但还没有解决“桌面感”问题。

### 3. 页面骨架仍以网页布局为主

关键页面与壳层：

- [Toolbar.tsx](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/components/Toolbar.tsx)
- [Editor.tsx](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/pages/Editor.tsx)
- [PreviewPanel.tsx](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/components/PreviewPanel.tsx)
- [Setup.tsx](/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/pages/Setup.tsx)

当前结构更接近“web app 中控台”，而不是一个桌面端创作工具窗口。

## 设计原则

### 1. 学习 macOS 语法，不照搬系统设置页面

保留视频编辑器的预览区、时间轴和功能侧栏结构，但吸收以下语法：

- `window chrome`
- `source list sidebar`
- `grouped settings section`
- `recessed search field`
- `selection blue`

### 2. 优先统一基础组件，而不是逐页手工修皮

改造顺序遵循：

1. token
2. primitive
3. pattern
4. page shell
5. modal / inspector 收尾

### 3. 保持 API 稳定优先

除非确有必要，优先保留当前组件 API，不在本轮引入大规模 prop 变更。优先通过 token、CSS Modules 和少量语义补充完成视觉迁移。

### 4. 固定深色专业模式

本轮只服务固定深色桌面专业工具模式，不引入主题切换、跟随系统或浅色变体。

### 5. 以“低喊叫感”替代“高装饰感”

减少以下网页特征：

- 大渐变主按钮
- 过重投影
- 明显上浮 hover
- 大段 marketing 式说明文案
- 过亮的分区边界

强化以下桌面特征：

- 紧凑信息密度
- 明度层级
- 弱边界 grouped surfaces
- selection 与 focus 的系统式表达

## 目标视觉系统

### 1. 窗口与背景层级

整个应用被重构为三层视觉：

- `Window Canvas`：深石墨底板，承担整体沉浸感
- `Functional Surfaces`：panel、group、sidebar、workspace 的弱材质层
- `Floating Surfaces`：sheet、modal、selection 与局部工具浮层

背景不再采用强蓝黑对比，而是更接近 macOS 深色模式中的炭灰、石墨灰和低对比亮面。

### 2. 色彩策略

- 主色：收敛为 macOS selection blue 的近似系统蓝，用于选中、聚焦、主要动作
- 次色：保留必要的 danger / warning / success，但默认压低饱和度
- 品牌渐变：从主按钮退出，只允许在少量状态或信息装饰中低频出现

### 3. 字体与排版

全局字体优先级调整为：

- `SF Pro Text`
- `SF Pro Display`
- `PingFang SC`
- `Inter`
- `sans-serif`

排版强调：

- 标题更像 panel title 或 window section title
- 标签、meta、badge 更像桌面工具信息层
- 说明文字减少 marketing 感，控制长度

### 4. 阴影与材质

- 卡片阴影整体减弱
- modal 更依赖材质和边界，而非大悬浮感
- hover 尽量通过明暗与边色变化表达，而不是上移和发光

## 组件设计决策

### Button

按钮系统继续保留当前 API，但视觉逻辑调整为：

- `primary`：系统强调按钮语法，收掉重渐变和强阴影
- `secondary`：panel 内默认操作按钮
- `tint`：保留蓝色语义，但更像 tonal button
- `ghost`：toolbar / utility action
- `danger`：警示动作，降低红色攻击性

尺寸收紧，倾向更桌面的 `sm / md / lg` 高度层级，减少 web 大按钮感。

### IconButton

转向 toolbar item / utility button 语法：

- 默认存在感更低
- hover 更像系统 hover highlight
- brand 变体只在需要 selection 时使用

### Input / Textarea / SearchField

统一为 recessed field 语法：

- 内凹、弱边界
- 低对比背景
- focus 更清晰但不产生网页发光 ring 既视感

其中 `SearchField` 将直接吸收参考截图中的搜索框语法。

### SurfaceCard

不再理解为“网页卡片”，而是：

- workspace shell
- panel surface
- grouped section
- elevated sheet

必要时可增加新的 surface 变体，但优先保持现有 variant 体系并重定义其视觉含义。

### ModalShell

从“网页弹窗”切换为桌面 sheet / inspector dialog：

- 弱化 overlay 压迫感
- header 与 body 的界线更克制
- footer 更接近 grouped action row

### Badge / Field / PanelHeader

整体从 web dashboard 文法切换为桌面工具文法：

- `Badge` 更接近状态胶囊和 meta pill
- `Field` 更像 grouped settings row 的容器
- `PanelHeader` 更像 section title，而不是内容模块标题

### TabBar / SelectionCard

`TabBar` 将从下划线 web tabs 切向 segmented control / source list hybrid。  
`SelectionCard` 将更像系统设置中的被选项，而非发光交互卡片。

## 页面骨架决策

### 1. Toolbar

Toolbar 将被重构为更接近 window chrome 的顶部区域：

- 左侧预留 traffic lights 逻辑呼吸位
- 中间突出工程标题与状态
- 右侧只保留少量关键动作

### 2. Sidebar

侧栏明确转向 source list 语法：

- 更暗背景
- 更紧凑 row
- 蓝色 selection capsule
- recessed search field

### 3. Main Workspace

预览区不再是网页展示卡，而是专业工作台：

- 弱边界舞台容器
- 更克制的 header / footer
- 与整体窗口保持一体化

### 4. Inspector / Grouped Sections

AI、导出和设置相关面板与弹窗统一采用 grouped settings 语法：

- section title
- grouped row
- 右侧 action / selection / value

### 5. Timeline

Timeline 保持编辑器工作台属性，不照搬系统设置；但其外壳、工具条、选中态和 hover 反馈应纳入统一桌面语法。

## 范围

### 本轮纳入

- `src/ui/styles/*`
- `src/ui/primitives/*`
- `src/ui/patterns/*`
- Toolbar / Editor shell / PreviewPanel / Setup
- 已使用 `ModalShell / SurfaceCard / Button / Field / SearchField / TabBar` 的业务组件视觉收尾

### 本轮不纳入

- Remotion 卡片视觉设计
- Timeline 交互逻辑重写
- 主题切换系统
- store / hooks / 数据结构重构

## 验收标准

当以下条件成立时，认为设计落地达标：

1. 基础组件在视觉上不再显著呈现“网页 dashboard”特征
2. 编辑器主界面具备明显的 macOS 桌面客户端气质
3. 侧栏、搜索框、toolbar、modal、grouped settings section 之间形成统一语法
4. 主要页面在不改变业务逻辑的前提下完成视觉收敛
5. build 和现有测试通过，核心页面可正常交互

## 风险与约束

- 当前工作区存在用户未提交的 timeline 相关改动，本轮需要避开这些文件
- 业务组件中仍有少量 inline style，尤其在 AI / 设置相关组件中，本轮需要分批回收
- 若在实施中发现现有 primitive API 明显限制桌面化表达，应优先做最小范围接口补充

## 结论

本设计采用“`专业创作工具版 macOS` + `系统设置截图语法融合`”路线。  
实施上优先重构 token 与基础组件，再将 Toolbar、Sidebar、Preview、Modal 和 grouped settings 统一到同一套桌面语言中，最终让应用从“web dashboard”收敛为“macOS 创作工具”。

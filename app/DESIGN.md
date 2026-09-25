# macOS Professional Creation Tool Design System

## 1. Product Positioning

本产品不是 Apple 官网式产品展示页面，而是一个 **macOS 深色专业创作工具**。

它服务的核心用户是：
- 播客视频创作者
- 需要快速生成口播稿、整理素材、叠加字幕和导出视频的内容生产者
- 默认在桌面端长时间使用，需要稳定、可信、低打扰的工作环境

设计目标不是”惊艳首屏”，而是：
- **安静**：界面不要频繁喊叫，内容比装饰更重要
- **专业**：像创作软件，而不是营销页或 AI 玩具
- **可信**：所有状态反馈都真实，不出现”看起来能做但其实没做”的控件
- **高效**：用户能快速理解当前阶段、下一步动作、风险和结果

一句话总结：

> 这是一个面向创作者的本地桌面工作台，设计语言应接近 macOS 专业工具（Final Cut Pro、Logic Pro、Xcode），而不是 Apple 官网叙事页面。

### 与 CLAUDE.md 的关系

- **本文件（DESIGN.md）是唯一的设计系统真理来源**
- CLAUDE.md 中保留的旧 Apple 官网风格规范已废弃
- 所有新实现必须遵循本文件规范

---

## 2. Visual Theme & Atmosphere

整体视觉应以 **Darwin / macOS 深色桌面容器** 为基底：
- 深色窗口背景
- 分区明确的面板结构
- 轻量分隔线替代大面积边框
- 克制的系统蓝作为主交互色
- 尽量避免装饰性炫技

界面气质应表现为：
- 稳定
- 冷静
- 精密
- 有秩序

不应表现为：
- 营销式“产品舞台感”
- AI 工作台式“高亮、发光、流光”
- 过度娱乐化的 emoji 与彩色标签堆叠

### Key Characteristics
- 深色桌面背景与嵌套面板结构
- 顶部窗口栏 + 中央工作区 + 辅助侧栏 / 底栏的专业工具布局
- 文本、分隔线和按钮层级明确，靠密度和对比组织信息
- 主要交互只使用系统蓝高亮
- 状态反馈以细粒度文本、进度、局部提示为主，不依赖夸张动画
- 局部可有柔和模糊或阴影，但只能服务层级，不可成为视觉主角

---

## 3. Design Principles

### 3.1 Single Primary Task
- 每个页面只允许一个主要任务中心
- 次级操作必须退后
- 页面不能出现多个同等重量的“主入口”

### 3.2 Progressive Disclosure
- 默认只显示当前阶段必需的信息
- 高级配置、解释性文案、诊断信息，按需展开
- 避免一上来把所有状态层全部摊开

### 3.3 Honest Feedback
- 所有按钮都必须对应真实行为
- “取消”必须真的中止任务，否则只能写“关闭”或“后台继续”
- 不允许“上一段 / 下一段 / 倍速”这类仅有外观、没有实际逻辑的控件长期存在

### 3.4 Calm by Default
- AI 状态提示应克制
- 避免扫描线、辉光、品牌紫色进度条、悬浮发光标签等“抢焦点”设计
- 当系统繁忙时，也应优先通过固定区域提示，而不是让多个动态层同时争抢注意力

### 3.5 Tool First, Marketing Never
- 首页、设置页、工作区都应体现“工具”而不是“宣传”
- 不要使用双主卡片营销式入口、夸张卖点文案、情绪化插画式包装

---

## 4. Color System

### Core Surfaces
- **Window Background**: `#1C1C1E`
- **Panel Background**: `#1E1E20`
- **Elevated Panel**: `#2C2C2E`
- **Titlebar Background**: `#252527`
- **Preview Background**: `#141416`
- **Timeline Background**: `#1A1A1C`
- **Control Background**: `#3A3A3C`

### Text
- **Primary Text**: `#FFFFFF`
- **Secondary Text**: `#EBEBF599`
- **Muted Text**: `#EBEBF54D`
- **Disabled Text**: `#EBEBF533`

### Borders & Separators
- **Separator**: `#38383A`
- **Border Strong**: `#48484A`
- **Soft Outline**: `rgba(255, 255, 255, 0.16)`

### Primary Accent
- **System Blue**: `#0A84FF`
- **System Blue Hover**: `#409CFF`
- **System Blue Active**: `#0071E3`

### Status Colors
这些颜色只允许用于 **反馈 / 诊断 / 告警**，不应成为页面主体语言：
- **Danger**: `#FF453A`
- **Success**: `#32D74B`
- **Warning**: `#FFD60A`
- **Warm Accent (Orange)**: `#FF9F0A`（仅用于时间线轨道等功能区分，不作为主要交互色）

### AI Operation Colors（AI 操作界面专用）
这些颜色仅用于 AI 操作界面的虚拟光标和指示器（详见第 9 章）：
- **Generation Cursor**: `#a78bfa`（紫色，仅用于 AI 生成模式光标）
- **Review Cursor**: `#34d399`（绿色，仅用于 AI 审阅模式光标）
- **Waiting Glow**: `#34d399` + `#00d2ff`（渐变，仅用于等待呼吸效果）

### Rules
- 常态界面只允许一个主强调色：**System Blue** (`#0A84FF`)
- 绿色、橙色、黄色、红色只用于状态，不用于入口包装或品牌分区
- 紫色和青色**仅**用于 AI 操作界面的光标和指示器，不用于常规交互
- 不允许大面积渐变作为界面背景
- **禁止**使用 CLAUDE.md 中旧的 Apple 官网配色（`#f5f5f7`、`#000000`、`#0071e3` 等）

### CSS 变量使用规范
所有颜色必须通过 `tokens.css` 中的 CSS 变量使用：
```css
/* 正确 */
background: var(--color-window-bg);
color: var(--color-text-primary);
border-color: var(--color-separator);

/* 错误 - 不要直接使用色值 */
background: #1C1C1E;
```

---

## 5. Typography

### Font Family
- **Primary UI Font**: `SF Pro Text`
- **Large Heading / Window Hero**: `SF Pro Display`
- 中文 fallback：`PingFang SC`
- 系统 fallback：`-apple-system`, `BlinkMacSystemFont`, `Inter`, `Segoe UI`, `sans-serif`

### Typography Roles

| Role | Font | Size | Weight | Line Height | Notes |
|------|------|------|--------|-------------|-------|
| Window Title | SF Pro Text | 13px | 600 | 1.2 | 顶栏与小型面板标题 |
| Section Title | SF Pro Text | 15px | 600 | 1.3 | 面板标题、设置大项 |
| Large Heading | SF Pro Display | 24px | 600 | 1.15 | Setup 首屏标题、局部主标题 |
| Primary Body | SF Pro Text | 13px | 400 | 1.45 | 常规说明、列表内容 |
| Secondary Body | SF Pro Text | 12px | 400 | 1.4 | 辅助说明、元信息 |
| Control Label | SF Pro Text | 12px | 500 | 1.2 | tabs、segmented control、按钮标签 |
| Mono Meta | SF Mono / Menlo | 12px | 400 | 1.35 | 路径、环境变量、技术字段 |

### CSS 变量映射

| CSS 变量 | 值 | 用途 |
|---------|-----|------|
| `--font-size-xs` | 10px | 极小型元标签 |
| `--font-size-sm` | 11px | 小型辅助文本 |
| `--font-size-md` | 12px | 控件标签、辅助说明 |
| `--font-size-lg` | 13px | 主要正文、列表内容 |
| `--font-size-xl` | 14px | 较大正文 |
| `--line-height-tight` | 1.25 | 紧凑行高 |
| `--line-height-normal` | 1.45 | 正常行高 |
| `--line-height-relaxed` | 1.6 | 宽松行高 |

### Rules
- 大多数正文不超过 `13px`
- 顶栏 / tabs / 工具条文字优先使用 `12px-13px`
- 真正的大标题只在 Setup、空态、关键确认区少量使用
- 避免使用 `700` 以上的粗体
- 避免在普通工具界面中使用过度压缩的营销标题风格
- **禁止**使用 CLAUDE.md 中旧的 Apple 官网字阶（28px+）和负字间距
- 所有字体必须通过 CSS 变量使用，不要直接写 `font-size: 12px`

---

## 6. Layout Patterns

### Application Shell
标准布局应优先遵守以下结构：

```text
┌─────────────────────────────────────────────┐
│ Window Titlebar / Toolbar                   │
├─────────────────────────────────────────────┤
│ Workspace Tabs / Secondary Nav              │
├──────────────┬────────────────┬─────────────┤
│ Side Panel   │ Main Work Area │ Inspector   │
│ / Session    │ / Preview      │ / Details   │
├──────────────┴────────────────┴─────────────┤
│ Bottom Utility Area / Timeline / Status     │
└─────────────────────────────────────────────┘
```

### Spacing

#### CSS 变量
| 变量 | 值 | 用途 |
|-----|-----|------|
| `--space-1` | 2px | 微调间距 |
| `--space-2` | 4px | 元素内紧凑间距 |
| `--space-3` | 6px | 小型元素间距 |
| `--space-4` | 8px | 基础间距单元 |
| `--space-5` | 10px | 适中间距 |
| `--space-6` | 12px | 面板内间距 |
| `--space-7` | 14px | 较大元素间距 |
| `--space-8` | 16px | 区域级间距 |

#### 常用节奏
- 微调整：`2px`
- 紧凑：`4 / 6px`
- 正常：`8 / 10 / 12px`
- 宽松：`16 / 20 / 24 / 32px`
- 面板内优先使用紧凑间距（4-12px）
- 页面级区域之间用更大留白（16-32px）建立层级

### Panel Philosophy
- 靠 **背景层次 + 分隔线 + 内边距** 建立层级
- 避免”每个区域都做成一张独立厚卡片”
- 不要卡片套卡片

### Radius（圆角）

| CSS 变量 | 值 | 用途 |
|---------|-----|------|
| `--radius-sm` | 4px | 小型控件圆角 |
| `--radius-md` | 6px | 标准控件圆角 |
| `--radius-lg` | 8px | 按钮、卡片圆角 |
| `--radius-xl` / `--radius` | 10px | 面板、弹窗圆角 |
| `--radius-2xl` | 12px | 大型容器圆角 |
| `--radius-pill` | 999px | 药丸形标签、徽章 |
| `--radius-window` | 10px | 窗口级圆角 |
| `--radius-dialog` | 14px | 对话框圆角 |
| `--radius-dropdown` | 12px | 下拉菜单圆角 |

#### 圆角规则
- 常规界面优先使用 `6-12px` 圆角
- `999px` 仅用于标签（pill）和徽章，不用于主按钮
- **禁止**使用 CLAUDE.md 中旧的 Apple 官网 5-8px 圆角规范

### Responsive Strategy
这是桌面优先产品：
- 以 `1024px+` 为主设计区间
- 小宽度时优先压缩辅助栏，而不是压缩主工作区逻辑
- 不追求营销页式移动端体验，重点保证可用性和层级不崩

### Shadows（阴影）

| CSS 变量 | 值 | 用途 |
|---------|-----|------|
| `--shadow-card` | `0 4px 14px rgba(0, 0, 0, 0.24)` | 卡片阴影 |
| `--shadow-modal` | `0 20px 60px rgba(0, 0, 0, 0.66)` | 模态框阴影 |
| `--shadow-dropdown` | `0 10px 30px rgba(0, 0, 0, 0.66)` | 下拉菜单阴影 |
| `--shadow-toast` | `0 8px 24px rgba(0, 0, 0, 0.66)` | Toast 阴影 |
| `--shadow-focus` | `0 0 0 3px rgba(10, 132, 255, 0.33)` | 焦点环阴影 |
| `--shadow-window` | `0 18px 44px rgba(0, 0, 0, 0.44)` | 窗口阴影 |

#### 阴影规则
- 阴影仅用于浮层（modal、dropdown、toast）
- 普通工作区面板不使用阴影
- 焦点使用 `--shadow-focus` 统一的系统蓝光环

### Motion（动画）

| CSS 变量 | 值 | 用途 |
|---------|-----|------|
| `--motion-micro` | `100ms cubic-bezier(0.3, 0, 0.2, 1)` | 微交互 |
| `--motion-fast` | `150ms cubic-bezier(0.3, 0, 0.2, 1)` | 快速动画 |
| `--motion-base` | `220ms cubic-bezier(0.2, 0.8, 0.2, 1)` | 标准动画 |

#### 动画规则
- 只允许轻量淡入淡出、面板展开/折叠、hover/active 细微反馈
- 进度条或小型 spinner 可以使用
- **禁止**扫描线、紫色辉光呼吸灯、多层发光背景
- **禁止**为了表现”AI 正在工作”而制造大面积动态噪音

---

## 7. Components

### Buttons

允许的主变体：
- **Primary**：系统蓝填充，白字
- **Secondary**：深色控制面板底，白字
- **Ghost**：透明背景，hover 轻微提亮
- **Destructive**：只用于危险动作
- **Link / Text Action**：不作为主 CTA，只用于弱操作

规则：
- 常规按钮高度约 `28-36px`
- 不要出现五颜六色的按钮族
- 首页与工作区里不要同时出现多个同权 primary CTA

### Inputs / Select / Textarea
- 深色控件底，轻边框
- focus 使用系统蓝 ring 或边框
- 不要使用夸张的 glow
- 技术型字段可使用等宽字体

### Cards / Panels
- 常规面板背景使用 `Panel Background` 或 `Elevated Panel`
- 边框尽量弱
- 圆角克制，通常 `6-12px`
- 阴影只用于浮层，不用于普通工作区卡片

### Dialog / Modal
- 只在真正需要阻断流程时使用
- 阴影柔和但不厚重
- 头部、正文、底部动作清晰分区
- 如果任务支持后台继续，优先使用非阻断反馈

### Tabs / Segmented Control
- 更像桌面工具切换器，而不是营销标签
- active 状态轻量清晰，不要过度发光

### Status Feedback
优先顺序：
1. 固定状态栏 / 面板内说明
2. 局部 inline hint
3. 非阻断 toast
4. 阻断式 modal

禁止：
- 进度条用紫色品牌化包装
- 漂浮光效或扫描线作为默认 AI 状态

---

## 8. Page-Level Guidance

### Setup
- 应只有一个主入口
- “导入已有素材”作为次路径存在
- 最近项目与设置入口应退后，不与主流程竞争
- 不使用 emoji 作为主要视觉锚点

### ScriptWorkbench
- 以编辑器内容为绝对主角
- 只保留一个主要 AI 状态反馈区
- 文件树、批注、抽屉、状态横幅必须控制并发显示密度
- AI 审查反馈优先是结构化列表和状态栏，不是特效

### Editor
- 预览、时间轴、检查器的层级要稳定
- 播放控件必须真实可用
- 导出流程反馈必须与后台状态一致

### Settings
- 先按用户心智分组，再展开技术配置
- 建议至少分成：
  - 创作：AI、模板、审查、TTS
  - 系统：Agent、MCP
- 预检、认证、环境变量、权限策略不要一股脑平铺

### Agent Sidebar
- 用户语言优先，不暴露太多底层运行机制术语
- 会话、连接、恢复历史这些概念要弱化
- 重点表达“当前能做什么”和“下一步做什么”

---

## 9. AI 操作界面视觉反馈体系（铁律）

所有涉及 AI 操作界面的功能（文稿生成、视频剪辑、审稿、AI 辅助编辑等）**必须**复用以下统一的视觉反馈架构。不允许各模块自行发明独立的 AI 操作指示方案。

### 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    页面协调层（Workbench）                    │
│  负责流程编排、状态切换、回调注册                              │
└────┬────────────────────────────────────────────────────────┘
     │
     ├─► LiveStreamingEditor — 实时流式打字机（生成模式）
     │    ├─► 文档内虚拟光标（紫色 #a78bfa，generate 模式）
     │    ├─► 动态分块 + 缓冲区自适应速率
     │    └─► 智能自动滚动跟随
     │
     ├─► ReviewCursorAnimator — 审阅扫描动画（审稿模式）
     │    ├─► 文档内虚拟光标（绿色 #34d399，review 模式）
     │    ├─► 呼吸光效（CSS 动画，等待阶段）
     │    ├─► 浮动鼠标指针（fixed 定位，屏幕坐标）
     │    └─► 行高亮 + 批注逐个揭示
     │
     ├─► StreamingEditor — 预计算帧回放（重放/倒回场景）
     │
     ├─► 状态管理层（Zustand Store）
     │    ├─► virtualCursorPos: number | null
     │    ├─► reviewCursorPos: { x, y } | null
     │    ├─► reviewBreathing: boolean
     │    ├─► streamingActive: boolean
     │    ├─► editorAgent: { readOnly, virtualCursorPos, streamingActive }
     │    └─► agentOperation: { isOperating, operationType, progress, ... }
     │
     └─► 编辑器组件
          ├─► virtualCursorExtension（CM6 StateField + 装饰 + 主题）
          └─► streamingActive 守卫（防止 React 重渲染覆盖 CM6 动画）
```

### 铁律 1：双光标系统

任何 AI 操作界面必须实现两层光标：

1. **文档内虚拟光标**（CodeMirror 6 Widget 装饰）
   - 使用 `src/lib/virtual-cursor.ts` 中的 `virtualCursorExtension`
   - 通过 `setVirtualCursor` / `clearVirtualCursor` Effect 控制位置
   - 通过 `setVirtualCursorMode` 切换模式（`'generate'` 紫色 / `'review'` 绿色）
   - Widget 包含闪烁竖线 + emoji 标签（🤖 生成 / 🔍 审阅）
   - 位置随文档变更自动映射（`tr.changes.mapPos`）

2. **浮动鼠标指针**（仅审阅/扫描场景）
   - `position: fixed` + `z-index: 99999`
   - SVG 箭头 + “AI” 标签徽章
   - 通过 `coordsAtPos()` 获取屏幕坐标
   - `transition: 0.15s ease-out` 平滑移动
   - `drop-shadow` 发光效果

### 铁律 2：三阶段动画模型

所有 AI 操作必须遵循三阶段视觉反馈：

| 阶段 | 视觉表现 | 实现方式 |
|------|---------|---------|
| **等待/准备** | 呼吸光效 + 扫描线 | CSS 动画（`reviewBreathing` 类名），不涉及 CM6 |
| **执行中** | 虚拟光标移动 + 打字机/扫描 | CM6 Effect dispatch + 定时器调度 |
| **完成** | 清除所有光标状态 | `clearVirtualCursor` + 重置 store |

### 铁律 3：流式打字机引擎规范

使用 `LiveStreamingEditor` 处理实时 LLM 流：

- **队列缓冲**：文本 chunk 入队，动画帧按节奏消费
- **动态分块**：基础 chunkSize=3，根据缓冲深度动态调整（3~24 字符）
- **智能停顿**：换行后 +26ms，标点后 +14ms（中英文标点均覆盖）
- **自然断句**：在标点、空格、换行处优先断开，避免硬切
- **速率自适应**：缓冲积压时自动加速（减少延迟 + 增大 chunk），空闲时恢复节奏
- **进度回调**：`committedChars` / `receivedChars` / `processedSteps` / `totalSteps`

### 铁律 4：滚动跟随策略

- **底部检测**：`scrollHeight - scrollTop - clientHeight < 50px` 视为”在底部”
- **自动跟随**：在底部时 `scrollIntoView: true`，不在底部时不强制滚动
- **用户滚动尊重**：一旦用户手动滚动，停止自动跟随（程序滚动 100ms 窗口内忽略）
- **用户回底恢复**：用户滚回底部后恢复自动跟随

### 铁律 5：状态安全守卫

- `streamingActive` 标志位在动画期间**必须**为 `true`，阻止 React 状态同步覆盖 CM6 内容
- `editorAgent.readOnly` 在 AI 操作期间**必须**为 `true`
- 任何异常/中断路径都必须清理光标状态（`clearVirtualCursor` + `setReviewHighlightLine(null)` + 重置 store）
- 多个 `StateEffect` 应在单次 `dispatch` 中批量发送

### 铁律 6：视觉主题一致性

| 操作类型 | 主色 | 光标闪烁 | 指示器样式 |
|---------|------|---------|-----------|
| 生成/写入 | `#a78bfa` 紫色 | 1s step-end | `agentTypingIndicator`（紫色药丸 + 三点脉冲） |
| 审阅/扫描 | `#34d399` 绿色 | 0.8s step-end | `agentReviewIndicator`（绿色药丸 + 三点脉冲） |
| 等待/呼吸 | `#34d399` + `#00d2ff` 渐变 | — | `reviewBreathing`（辉光 + 扫描线） |

### 铁律 7：文件职责与复用方式

| 文件 | 职责 | 复用方式 |
|------|------|---------|
| `src/lib/virtual-cursor.ts` | CM6 虚拟光标扩展（Effect/Field/Widget/Theme） | 直接引入 `virtualCursorExtension` |
| `src/lib/live-streaming-editor.ts` | 实时流式打字机引擎 | `new LiveStreamingEditor(view, options)` |
| `src/lib/review-cursor-animator.ts` | 审阅扫描动画控制器 | `new ReviewCursorAnimator(view, options)` |
| `src/lib/streaming-editor.ts` | 预计算帧回放引擎 | `new StreamingEditor(view, options)` |
| `src/lib/diff-to-frames.ts` | 文本 diff → 动画帧转换 | `diffToFrames(before, after, options)` |

新模块（如视频 AI 剪辑）接入时：
1. 编辑器扩展中加入 `virtualCursorExtension`
2. 根据场景选择合适的引擎（`LiveStreamingEditor` / `StreamingEditor` / `ReviewCursorAnimator`）
3. 在 store 中维护 `editorAgent` / `agentOperation` / `activeStream` 等状态
4. CSS 层复用 `agentTypingIndicator` / `agentReviewIndicator` / `reviewBreathing` / `aiReviewCursor` 样式
5. 遵循三阶段动画模型和滚动跟随策略

### 禁止事项

- **禁止**在新模块中自行实现 blinking cursor、typing indicator、breathing 效果
- **禁止**绕过 `streamingActive` 守卫直接操作编辑器内容
- **禁止**在动画期间允许用户编辑（必须 `readOnly: true`）
- **禁止**使用 `setInterval` 轮询光标位置，必须通过 CM6 Effect 系统驱动
- **禁止**在清理路径中遗漏任何光标/高亮状态的重置

---

## 10. Do / Don't

### Do
- 把它设计成创作工具，不是宣传页
- 用结构、分区和密度表达层级
- 保持主流程清晰
- 使用系统蓝统一交互反馈
- 让状态反馈真实、明确、低噪音
- 用文字和布局建立信任感

### Don't
- 不要再使用 Apple 官网式模块语言指导桌面工具页面
- 不要使用紫色、荧光、渐变、扫描线来包装 AI 状态
- 不要在首页放两个同权主入口
- 不要让多个横幅、抽屉、提示同时争抢焦点
- 不要放没有真实行为的按钮
- 不要把底层实现细节直接讲给普通用户
- 不要依赖 emoji 承担主要视觉设计职责

---

## 11. Implementation Reference（实现参考）

### 源文件映射

| 设计元素 | 源文件位置 |
|---------|-----------|
| CSS 变量（Tokens） | `src/ui/styles/tokens.css` |
| Tailwind 桥接 | `src/ui/styles/darwin-ui.css` |
| 基础样式 | `src/ui/styles/base.css` |
| 按钮组件 | 参考 `src/ui/primitives/` 目录 |
| 面板模式 | 参考 `src/ui/patterns/` 目录 |

### 正确使用 CSS 变量的示例

```css
/* 组件样式 */
.myComponent {
  background: var(--color-panel-bg);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-6);
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  line-height: var(--line-height-normal);
}

.myComponent:hover {
  border-color: var(--color-system-blue);
  background: var(--color-panel-elevated);
}

.myComponent:focus-visible {
  box-shadow: var(--shadow-focus);
}
```

### 与旧代码的迁移路径

如果遇到使用 CLAUDE.md 旧规范的代码：

1. **立即迁移色值**：将 `#0071e3` 替换为 `var(--color-system-blue)`
2. **使用 CSS 变量**：所有硬编码色值、字号、间距都改用 tokens
3. **移除负字间距**：删除 `letter-spacing` 负值
4. **调整圆角**：将 5-8px 调整为 6-12px
5. **移除玻璃效果**：删除 `backdrop-filter` 和半透明白色背景

---

## 12. Validation Checklist

每次调整 `design.pen` 或实现页面时，至少检查以下问题：

1. 当前页面是否只有一个主任务中心？
2. 用户是否能在 2 秒内知道下一步？
3. 有没有两个以上同权高亮入口？
4. 是否出现了不必要的多色强调？
5. AI 状态是否过于抢眼？
6. 是否存在”看起来能做，其实没实现”的控件？
7. 是否把运行机制解释暴露给了普通用户？
8. 是否更像专业工具，而不是营销页或 AI 玩具？
9. **所有颜色都通过 CSS 变量使用，没有硬编码色值？**
10. **没有使用 CLAUDE.md 旧规范中的 `#f5f5f7`、`#0071e3`、负字间距等？**
11. **圆角在 6-12px 范围内，pill 形状仅用于标签？**
12. **阴影仅用于浮层，普通面板没有阴影？**

---

## 13. Design-to-Implementation Workflow

新的执行顺序必须是：

1. 先维护本文件
2. 再用 Pencil MCP 调整 `design.pen`
3. 导出关键页面截图给用户人工验稿
4. 用户明确满意后，才开始代码实现
5. 若用户不满意，优先继续迭代 `design.pen`

这个顺序是强约束，不可跳过。

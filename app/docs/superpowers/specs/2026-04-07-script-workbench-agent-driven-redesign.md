# 脚本工作台 Agent 驱动重构设计

> **日期**: 2026-04-07
> **状态**: 已确认
> **前置**: `2026-04-07-agent-acp-integration-design.md`, `2026-04-07-script-workbench-file-tree-refactor-design.md`

## 1. 目标

将脚本工作台从「强制 4 步线性流程 + Agent 割裂」重构为「Agent 驱动 + 轻量引导 + 实时可视化协作」模式，让用户通过 AI Agent 快速生成、审查、编辑稿件，并在编辑器中实时看到 Agent 的操作过程。

### 核心设计原则

- **Agent 是唯一执行引擎**：所有 AI 操作（生成、审查、重写）统一通过 ACP Agent 执行
- **文件树是唯一产出展示区**：Agent 生成的文件直接出现在文件树中
- **编辑器保持干净**：标注只在审查后出现，无额外 UI 噪音
- **操作透明可见**：虚拟光标 + 流式编辑让用户看到 Agent 在工作

## 2. 设计决策汇总

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 交互模式 | 混合模式：Agent 驱动 + 轻量引导 | 新手有引导，老手可自由探索 |
| 引导位置 | Agent 侧边栏顶部快捷操作 | 操作统一到 Agent 侧，编辑区保持干净 |
| 审查标注 | 内联高亮 + 悬浮操作卡片（Grammarly 式） | 就地操作，不打断编辑流 |
| Agent 可视化 | 虚拟光标 + 流式编辑 + 动态标记 | 核心差异化体验，一步到位 |
| 用户控制 | Agent 操作时编辑器只读，可打断/追加指令 | 简洁可靠，避免并发编辑冲突 |

## 3. 架构概览

### 3.1 数据流

本次重构将 Agent 驱动拆成两条**明确分离**的执行链路，避免把审查标注硬塞进 diff 写入流：

#### A. 生成 / 重写链路（Write Stream）

```
用户操作（快捷按钮 / 自然语言）
        ↓
   Agent 侧边栏
        ↓
   ACP fs/write_text_file
        ↓
   AgentWriteInterceptor
   ├── diff 计算变更区域
   ├── 拆分为动画帧序列
   ├── 生成 streamId / beforeSnapshot
   └── 发送 write-stream-start
        ↓
   编辑器（虚拟光标 → 流式写入 → 滚动跟随）
        ↓
   Renderer 提交 ACK（full / partial / abort）
        ↓
   主进程写入磁盘并抑制自写 watcher
```

#### B. 审查链路（Review Findings）

```
用户点击「AI 审查」
        ↓
   Agent 侧边栏发送审查提示词
        ↓
   Agent 返回结构化 ReviewPayload（不写 script.md）
        ↓
   Renderer 解析 payload
   ├── 校验 schema
   ├── 校验 docVersion / quotedText
   └── 生成本地回放序列
        ↓
   编辑器（虚拟光标扫描 → 逐条落标注）
        ↓
   store / script-state.json 持久化 annotations + reviewState
```

#### C. Source of Truth 与提交规则

- **流式写入期间**：编辑器内存快照是当前工作真相，磁盘文件还未提交。
- **full commit**：Renderer 播放完成后 ACK，主进程写入完整目标内容。
- **partial commit**：用户点击停止后，主进程写入“已播放到编辑器中的部分内容”。
- **abort**：回滚到 `beforeSnapshot`，不写磁盘，不更新文件树。
- **下一次 Agent 读取**：必须基于最近一次已提交内容；若存在未提交流，先结束当前流（commit 或 abort），再允许新指令进入。
- **watcher 抑制**：主进程提交自身写入时必须带 `self-write` 标记，避免当前前端把 Agent 写盘误判为外部冲突。

### 3.2 布局结构

```
┌──────────────────────────────────────────────────────┐
│                    应用顶部栏                         │
├────────┬───────────────────────────┬─────────────────┤
│        │        FileTabs           │  ⚡ 快捷操作     │
│  文件树 ├───────────────────────────┤  ┌──────────┐   │
│        │                           │  │生成口播稿│   │
│ 📁 项目│     编辑器（主工作区）       │  │AI 审查  │   │
│ ├ orig │                           │  │重新生成  │   │
│ └ scrip│   虚拟光标 + 内联标注       │  └──────────┘   │
│        │                           │                 │
│        │   [悬浮操作卡片]           │  🤖 Agent 对话   │
│        │                           │  消息列表...     │
│        │                           │                 │
│        │                           │  [输入框]       │
├────────┴───────────────────────────┴─────────────────┤
│                    状态栏                             │
└──────────────────────────────────────────────────────┘
```

## 4. 组件设计

### 4.1 AgentQuickActions — 快捷操作区

位于 Agent 侧边栏顶部，根据当前文件状态**自适应**显示可用操作。

**状态感知规则：**

| 工作区状态 | 判定条件 | 可用快捷按钮 |
|----------|----------|-------------|
| `empty` | 无 `original.md` 且无 `script.md` | `导入文稿`、`新建空白` |
| `original_ready` | 有 `original.md`，无 `script.md` | `✨ 生成口播稿` |
| `generating` / `rewriting` | `agentOperation.isOperating = true` 且写入流活跃 | `⏹ 停止` |
| `review_ready` | 有 `script.md`，`reviewState = idle` | `🔍 AI 审查`、`重新生成` |
| `reviewing` | `operationType = review` | `⏹ 停止` |
| `review_issues` | `reviewState = issues` | `✅ 全部接受`、`重新审查` |
| `review_stale` | `reviewState = stale` | `重新审查`、`重新生成` |
| `review_clean` | `reviewState = clean` | `📋 复制口播稿`、`重新生成`、`重新审查` |
| `interrupted` | 写入流被 `partial commit` | `继续编辑`、`重新生成`、`重新审查` |

**模板选择：**
- 旧设计中的模板选择抽屉（StepDrawer）移除
- 默认使用上次保存的模板（或内置 `news-broadcast`）
- 用户可通过自然语言指定模板：「用轻松口语风格生成」「换一个正式新闻模板」
- Agent 理解意图后自动匹配或推荐合适的模板

**交互行为：**
- 快捷按钮分为两类：
  - **UI Action**：`导入文稿`、`新建空白`、`复制口播稿`、`全部接受`
  - **Agent Prompt**：`生成口播稿`、`AI 审查`、`重新生成`、`重新审查`
- 只有 Agent Prompt 会向 Agent 发送预设指令。
- UI Action 直接调用本地能力，不经过 Agent。
- Agent 工作时，当前上下文无效的按钮隐藏，仅保留 `⏹ 停止`。

### 4.2 AgentOperationInterceptor — 操作拦截层

**核心模块**，位于 ACP `FileSystemRuntime` 和实际文件写入之间，仅负责**写入流**。

**职责：**
1. 拦截 Agent 的 `write_file` 操作
2. 对比当前文件内容和目标内容，计算 diff
3. 将 diff 拆解为有序的编辑操作序列（insert/delete/replace）
4. 为每个操作计算虚拟光标的目标位置
5. 生成 `streamId` 和 `beforeSnapshot`
6. 将帧序列推送给渲染进程播放
7. 等待渲染进程提交 `full / partial / abort` ACK
8. 再决定是否写入磁盘持久化

**非职责：**
- 不处理 AI 审查标注
- 不解析 ReviewPayload
- 不直接修改 annotations store

**拦截点：** `electron/acp/fs-runtime.ts` 的 `writeTextFile`。通过 `agent:write-stream-start` 将帧序列推送给渲染进程，再通过 `agent:commit-write-stream` 接收提交 ACK。

**关键接口：**

```typescript
// 拦截层产出的编辑操作序列
interface StreamingEditOperation {
  type: 'insert' | 'delete' | 'replace'
  offset: number        // 编辑器中的字符偏移
  length?: number       // delete/replace 时的原文长度
  text?: string         // insert/replace 时的新文本
}

// 拦截层产出的动画帧
interface AnimationFrame {
  cursorPosition: number           // 虚拟光标目标位置
  operation: StreamingEditOperation  // 要执行的编辑操作
  delayMs: number                  // 与上一帧的间隔（毫秒）
}

interface WriteStreamStartEvent {
  streamId: string
  filePath: string
  beforeSnapshot: string
  finalContent: string
  frames: AnimationFrame[]
}

interface WriteStreamCommitAck {
  streamId: string
  mode: 'full' | 'partial' | 'abort'
  committedContent?: string
}
```

### 4.2B ReviewPayload — 审查结果协议

AI 审查**不走 diff 流**。Agent 必须在 assistant 最终响应中返回结构化 `ReviewPayload`，由前端解析并本地回放。

```typescript
interface ReviewFinding {
  id: string
  startOffset: number
  endOffset: number
  quotedText: string
  issue: string
  suggestion: string
  severity: 'error' | 'warning' | 'info'
}

interface ReviewPayload {
  version: 1
  filePath: 'script.md'
  docVersion: number
  summary: {
    total: number
    error: number
    warning: number
    info: number
  }
  findings: ReviewFinding[]
}
```

**约束：**
- ReviewPayload 必须使用固定 fenced block 包裹，便于前端解析。
- Renderer 仅在 `docVersion` 与当前 `scriptDocVersion` 一致时应用。
- 若 `quotedText` 与当前位置文本不一致，finding 标记为 `stale`，不自动应用。

### 4.3 VirtualCursor — 虚拟光标

CodeMirror 装饰层，表示 Agent 当前的操作位置。

**视觉表现：**
- 紫色竖线光标（`#a78bfa`），2px 宽，高度与行高一致
- 光标顶部有小标签 `🤖`，表示这是 Agent 的光标
- 移动时有平滑过渡动画（CSS transition，约 150ms）
- 光标闪烁动画（类似真实光标的 blink）

**实现方式：** CodeMirror 6 的 `Decoration.widget`，通过 `StateField` 管理光标位置状态，通过 `EditorView.dispatch` 更新位置。

### 4.4 StreamingEditor — 流式写入控制器

协调虚拟光标移动和文本写入的时序。

**写入速度策略（仅写入流）：**
- 基础速度：30-50 字/秒（模拟快速打字）
- 大段内容（>200字）：加速到 100-150 字/秒，避免用户等太久
- 用户可通过 Agent 侧边栏调速（快速/正常/详细）

**滚动跟随：** 编辑器视口自动跟随虚拟光标，保持光标在可视区域内，使用 `scrollIntoView` 并带平滑滚动。

**审查回放策略：**
- 审查结果拿到后，不直接瞬间落全部标注，而是按 `findings` 顺序做本地回放。
- 每条 finding 停顿 250-300ms，先移动虚拟光标，再落高亮。
- 审查回放期间编辑器仍为只读，但不会触发写盘。

### 4.5 AnnotationCard — 悬浮标注操作卡片

点击内联高亮文字时弹出的操作卡片。

**卡片内容：**
- 问题严重级别图标 + 颜色（🔴 error / 🟡 warning / 🔵 info）
- 问题描述文字
- AI 建议修改内容（带 diff 高亮）
- 操作按钮：`✓ 接受建议` / `忽略` / `AI 重写`

**交互行为：**
- 点击高亮文字弹出，点击卡片外部或 ESC 关闭
- `接受建议`：直接替换编辑器中的文本，标注消失
- `忽略`：移除标注高亮，记录为已忽略
- `AI 重写`：向 Agent 发送指令，Agent 用虚拟光标定位到该处重写

**标注锚定规则：**
- 每条标注同时保存 `startOffset/endOffset` 与 `quotedText`。
- 标注绑定到生成它时的 `docVersion`。
- 当用户手动编辑或 Agent 重写导致 `scriptDocVersion` 增长时，旧标注默认转为 `stale`。
- `stale` 标注不展示“全部接受”，只允许重新审查或手动忽略。
- `全部接受` 只处理 `pending` 且**非 stale** 的标注，并按 `startOffset` 倒序应用。

**定位：** 卡片出现在高亮文字的正下方，如果空间不足则上方。使用 CodeMirror 的 `Tooltip` 扩展实现。

### 4.6 EditorReadOnlyGuard — 编辑器只读锁

Agent 操作期间的编辑器状态控制。

**行为：**
- Agent 开始操作时，设置编辑器为“禁止文档变更，但保留键盘/点击监听”
- 编辑器右上角显示状态指示：`🤖 Agent 正在输入...`
- 用户尝试输入时，通过外层 keydown 捕获层或 overlay 提示：「Agent 正在工作，可在右侧发送指令」
- Agent 操作完成或被停止后，解除只读

### 4.7 AgentProgressBar — 操作进度指示

位于 Agent 侧边栏的操作状态区域。

**显示内容：**
- 操作类型（生成中 / 审查中 / 重写中）
- 进度条（百分比，基于已写入字数 / 预估总字数）
- `⏹ 停止` 按钮

## 5. 用户旅程

### 5.1 首次进入（空白状态）

1. 用户打开脚本工作台，中间显示 `EmptyGuide` 引导页
2. 用户选择项目目录 或 导入文稿
3. Agent 侧边栏默认折叠，右侧有小图标指示
4. 导入文稿后，Agent 侧边栏自动展开，顶部显示快捷按钮 `✨ 生成口播稿`
5. Agent 对话区显示提示：「检测到原稿已导入（1,280字），你可以点击"生成口播稿"一键生成，或告诉我你想要什么风格。」

### 5.2 生成口播稿

1. 用户点击 `✨ 生成口播稿` 快捷按钮
2. Agent 接收预设指令，开始执行
3. **文件树**：`script.md` 以虚线边框 + 「创建中...」标记出现
4. **编辑器**：自动新开 `script.md` 标签页，右上角显示 `🤖 Agent 正在输入...`
5. **虚拟光标**出现在编辑器开头，开始流式写入内容
6. 文字以打字效果逐渐出现，编辑器自动滚动跟随
7. Agent 侧边栏显示进度：「正在生成口播稿... 已写入 326/~850 字」
8. 完成后：
   - 虚拟光标消失
   - 编辑器恢复可编辑状态
   - 文件树 `script.md` 变为正常状态，显示 `🆕` 标记
   - Agent 提示：「口播稿已生成 ✅ 856字 · 预计3分12秒」
   - 快捷按钮更新为 `🔍 AI 审查` + `重新生成`

**文件树临时节点规则：**
- `write-stream-start` 时，如果目标文件当前尚不存在，FileTreePanel 渲染一个 **ephemeral node**。
- `full / partial commit` 成功后，ephemeral node 转为真实文件节点。
- `abort` 时，ephemeral node 立即移除。
- ephemeral node 只存在于当前会话内，不写入磁盘。

### 5.3 AI 审查

1. 用户点击 `🔍 AI 审查` 快捷按钮
2. Agent 开始审查，编辑器进入只读模式
3. Agent 返回结构化 `ReviewPayload`
4. **虚拟光标**从文档顶部开始向下扫描
5. 遇到问题时：
   - 光标停在问题文字处
   - 文字逐渐被高亮标记（颜色渐入动画，约 300ms）
   - 轻微停顿后继续扫描
6. Agent 侧边栏实时更新：「扫描进度 45%，已发现 1 个问题」
7. 扫描完成后：
   - 虚拟光标消失
   - 编辑器恢复可编辑
   - Agent 提示：「审查完成，发现 2 个问题。点击高亮文字查看详情。」
   - 快捷按钮更新为 `✅ 全部接受` + `重新审查`

### 5.4 处理标注

1. 用户点击编辑器中的高亮文字
2. 弹出悬浮操作卡片，显示问题描述和 AI 建议
3. 用户选择：
   - **接受建议**：文字被替换，高亮消失，带轻微的替换动画
   - **忽略**：高亮消失，标注记录为已忽略
   - **AI 重写**：向 Agent 发送指令，虚拟光标移动到该位置，流式重写该段

### 5.5 自由对话

用户随时可以在 Agent 输入框中用自然语言提出任何要求：
- 「帮我把第二段改成更口语化的风格」
- 「这篇稿子的语气太正式了，整体改轻松一点」
- 「在结尾加一段总结」

Agent 理解意图后，虚拟光标定位到相应位置，流式执行编辑。

### 5.6 打断 Agent

Agent 工作期间，用户可以：
- 在输入框发送新指令 → Agent 停止当前操作，基于已写内容处理新指令
- 点击 `⏹ 停止` 按钮 → Agent 停止，已写入内容保留在编辑器中，并以 `partial commit` 提交到磁盘

### 5.7 内部运行时文件

脚本工作台允许存在运行时保留数据，但这些内容**不属于用户文件树展示范围**：

- `script-state.json`：工作台持久化状态
- 未来如需引入内部缓存目录，必须位于保留命名空间下，并从 FileTreePanel 中隐藏

## 6. 状态管理变更

### 6.1 移除

```typescript
// 从 ScriptState 中移除
currentStep: ScriptStep           // 不再需要步骤状态机
drawerVisible: boolean            // 不再需要抽屉
drawerContent: 'template' | 'annotations' | null
```

### 6.2 新增

```typescript
// 新增到 ScriptState 或独立 store
interface AgentOperationState {
  isOperating: boolean              // Agent 是否正在操作
  operationType: 'generate' | 'review' | 'rewrite' | 'custom' | null
  progress: number                  // 0-100 进度
  canInterrupt: boolean             // 是否可打断
}

// 编辑器状态
interface EditorAgentState {
  readOnly: boolean                 // Agent 操作时只读
  virtualCursorPos: number | null   // 虚拟光标位置，null 表示不显示
  streamingActive: boolean          // 是否正在流式写入
}

type ReviewState = 'idle' | 'pending' | 'issues' | 'clean' | 'stale'

interface WorkspaceFilesState {
  hasOriginalFile: boolean
  hasScriptFile: boolean
}

interface ActiveStreamState {
  streamId: string | null
  filePath: string | null
  phase: 'idle' | 'playing' | 'awaiting_commit' | 'stopped'
}
```

### 6.3 持久化变更

`script-state.json` 格式调整：

```typescript
interface PersistedScriptState {
  version: 2                        // 版本升级为 2
  templateId: string
  annotations: Annotation[]
  createdAt: string
  updatedAt: string
  reviewState: ReviewState
  lastReviewedDocVersion: number
  lastOperation?: string            // 最后一次 Agent 操作的类型
}
```

需要向后兼容 version 1 格式。

## 7. 需要移除的组件

| 组件 | 路径 | 原因 |
|------|------|------|
| StepIndicator | `src/components/script/StepIndicator.tsx` | 步骤条不再需要 |
| StepReviewOriginal | `src/components/script/StepReviewOriginal.tsx` | 步骤逻辑移到 Agent |
| StepGenerate | `src/components/script/StepGenerate.tsx` | 生成逻辑移到 Agent |
| StepAIReview | `src/components/script/StepAIReview.tsx` | 审查逻辑移到 Agent |
| StepConfirm | `src/components/script/StepConfirm.tsx` | 确认逻辑简化为保存 |
| StepDrawer | `src/components/script/StepDrawer.tsx` | 模板选择移到 Agent 对话 |
| OperationBar 步骤逻辑 | `src/components/script/OperationBar.tsx` | 操作移到 Agent 快捷区 |

## 8. 需要新增的组件

| 组件 | 路径 | 职责 |
|------|------|------|
| AgentQuickActions | `src/components/agent/AgentQuickActions.tsx` | 侧边栏顶部快捷操作按钮 |
| AgentOperationInterceptor | `electron/acp/operation-interceptor.ts` | 拦截 Agent 文件写入，编排动画 |
| ReviewPayloadParser | `src/lib/script-review-payload.ts` | 解析 Agent 返回的结构化审查结果 |
| VirtualCursor | `src/components/script/VirtualCursor.ts` | CodeMirror 虚拟光标装饰 |
| StreamingEditor | `src/lib/streaming-editor.ts` | 流式写入时序控制器 |
| ReviewPlaybackController | `src/lib/review-playback.ts` | 将 ReviewPayload 本地回放为扫描动画和标注 |
| AnnotationCard | `src/components/script/AnnotationCard.tsx` | 悬浮标注操作卡片 |
| EditorReadOnlyGuard | `src/lib/editor-readonly-guard.ts` | Agent 操作时编辑器只读控制 |
| AgentProgressBar | `src/components/agent/AgentProgressBar.tsx` | Agent 操作进度指示 |

## 9. 需要修改的模块

| 模块 | 变更内容 |
|------|----------|
| `ScriptWorkbench.tsx` | 去掉步骤流程编排，接入 Agent 操作事件流 |
| `AgentSidebar.tsx` | 顶部插入 AgentQuickActions 区域 |
| `FileTreePanel.tsx` | 新增文件创建动画（虚线边框 + 创建中标记） |
| `script store` | 去掉 `currentStep` 状态机，新增 `WorkspaceFilesState`、`ReviewState`、`scriptDocVersion` |
| `script-persistence.ts` | 升级 `script-state.json` 为 v2，兼容 v1 |
| `src/lib/agent-api.ts` | 新增 write-stream ACK 事件与监听类型 |
| `electron/acp/session.ts` | 将 interceptor 真正注入 `FileSystemRuntime`，并管理 pending write stream |
| `electron/acp/fs-runtime.ts` | 在 `handleWriteFile` 中插入拦截层 |
| `electron/acp/ipc.ts` | 新增 write-stream start / commit ACK IPC 通道 |
| `ScriptEditor` | 集成 VirtualCursor 装饰、ReadOnlyGuard、流式插入 API；扩展所有权归组件内部 |

## 10. 风险与注意事项

### 性能
- 流式写入大量文字时需要注意 CodeMirror dispatch 频率，建议批量更新（每次 10-20 字）而非逐字
- 虚拟光标的 CSS transition 在高频更新时可能卡顿，需要用 `requestAnimationFrame` 节流

### 兼容性
- `script-state.json` v1 → v2 需要迁移逻辑
- 旧项目目录如果有 v1 格式，打开时自动升级

### 边界情况
- Agent 操作中途网络断开：保留已写入内容，提示用户重试
- Agent 返回的内容与预期文件格式不符：拦截层校验后回退
- 用户快速连续点击快捷按钮：前一个操作自动取消
- v1 → v2 状态迁移：必须使用明确映射表，不能用 `currentStep >= 3` 这类粗糙条件
- 标注与当前文本不再匹配：标记为 `stale`，引导重新审查

### 测试要点
- 拦截层 diff 计算的正确性
- 虚拟光标动画的流畅度
- 只读锁的启用/解除时机
- 打断操作后的状态一致性
- v1 → v2 持久化迁移

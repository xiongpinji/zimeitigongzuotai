# 子项目 B · 对话 UI 全面重构设计方案

- 日期：2026-06-13
- 分支：feat/lingji-cli
- 状态：已评审，待实现
- 依赖：子项目 A（多协议 Agent Runtime）的统一事件流
- 参考：open-design-slim（`apps/web/src/components/ChatPane.tsx`、`AssistantMessage.tsx`、`ChatComposer.tsx`、`AgentPicker.tsx`）

## 1. 背景与目标

当前 AI 对话 UI（`src/components/agent/`）已有 block 分发渲染、斜杠命令、@文件，但 agent 选择是隐式的（"启用 + sortOrder"），消息不带 agent 身份，主面板 `ConversationDetailPane` 较臃肿。本子项目按 open-design 的组件拆分与交互全面重构对话 UI，支持 **Claude / Codex / Pi** 三家的显式选择与混合历史展示。

**保留**：Zustand + SQLite + 现有 Context 管线（`acp-connections-context` / `conversation-workspace-context` / `conversation-runtime-context`）。只重构**组件结构与交互**，不换状态底座。

### 核心决策（已确认）
- 全面重构对齐 open-design 的 ChatPane / AssistantMessage(block 分发) / ChatComposer / AgentPicker。
- 消息/turn 带 `agentId`+`agentName`，支持一个会话内混合 agent 历史展示与 agent 切换。
- 复用现有 block 组件（TextBlock/ThinkingBlock/ToolCallBlock/ErrorBlock），上层加分发器。
- 遵守 DESIGN.md：macOS 专业风、系统蓝 accent、复用 `src/ui/*`、不新增第二套彩色 accent、不新增弹窗/顶部条。

## 2. 组件架构（对标 open-design）

```
AgentSidebar（容器，保留）
├── ConversationListPane（增强：虚拟化 + 搜索 + 重命名 + agent 图标）
└── ChatPane（重构自 ConversationDetailPane：纯容器）
    ├── ChatHeader（标题 + 连接状态 + 上下文用量 + 当前 agent 名/图标）
    ├── MessageList（虚拟化消息区）
    │   ├── UserMessage（保留）
    │   └── AssistantMessage（新：按 block 分发）
    │        ├── TextBlock / ThinkingBlock / ToolCallBlock / ErrorBlock（复用）
    │        └── PermissionCard（权限请求纳入消息流，复用 PermissionPrompt 逻辑）
    └── ChatComposer（增强自 MessageInput：输入 + 斜杠/@ + 附件 + 模式/配置 + AgentPicker 入口）
```

### AgentPicker（新增，核心交互）
- 新建会话时显式选 agent（Claude Code / Pi / Codex），来源 `listAgentDefs()`（子项目 A 提供，renderer 可 import 无 electron 依赖的纯数据）+ 各 agent 的 detection 状态（已装/未装）。
- 形态：复用 `src/ui` 的 Select/Segmented；显示 agent 名 + 图标 + 可用性（未装置灰 + 指引）。
- 选定后写入 `createConversation({ agentType })`（沿用现有会话级 agentType 绑定）。
- 修复现状："启用 + sortOrder 隐式选"改为显式选择。

### 消息 agent 身份
- `ConversationTurn` / 持久化 turn 增加可选 `agentId`/`agentName`（迁移：缺省回退会话级 agentType）。
- AssistantMessage 头部显示该轮 agent 名 + 图标（`AgentIcon` 新增，按 agentId 映射 emoji/图标）。
- 支持同一会话切换 agent 后，历史按各 turn 的 agent 正确标注（混合展示）。

## 3. 模块与文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/components/agent/ChatPane.tsx` | 新建（重构自 ConversationDetailPane） | 纯容器：头部 + MessageList + ChatComposer |
| `src/components/agent/MessageList.tsx` | 新建 | 虚拟化消息区 + 自动滚动/置底 |
| `src/components/agent/AssistantMessage.tsx` | 新建 | 按 block.type 分发到现有 block 组件 + agent 头 + 权限卡 |
| `src/components/agent/AgentPicker.tsx` | 新建 | agent 选择器（名+图标+可用性） |
| `src/components/agent/AgentIcon.tsx` | 新建 | agentId → 图标/emoji |
| `src/components/agent/ChatComposer.tsx` | 重构自 MessageInput | 输入 + 斜杠/@ + 附件 + 模式/配置 + 新建会话时的 AgentPicker |
| `src/components/agent/ConversationListPane.tsx` | 增强 SessionListPane | 虚拟化 + 搜索 + 重命名 + agent 图标 |
| `src/components/agent/TextBlock/ThinkingBlock/ToolCallBlock/ErrorBlock` | 保留 | 复用 |
| `src/components/agent/ConversationDetailPane.tsx` | 删除/瘦身 | 逻辑迁入 ChatPane + hooks |
| `src/types/conversation.ts` | 改 | turn 增加可选 agentId/agentName |
| `electron/conversations/`（types+repository） | 改 | turn 持久化 agentId/agentName（迁移兼容） |

状态层：继续用 `useConversationDetail` / `useConnectionLifecycle` / workspace+acp+runtime context；按需微调接口，不换 Zustand/SQLite。

## 4. 交互流程

1. 新建会话 → ChatComposer/Toolbar 弹 AgentPicker → 选 Claude/Codex/Pi（未装给指引）→ `createConversation({agentType})`。
2. 发消息 → 现有 sendPrompt 管线（子项目 A runtime 已按 agentType 选 def 连接）。
3. 流式 → 子项目 A 归一化事件 → applyRuntimeEvent → MessageList 实时渲染（block 分发）。
4. 会话列表显示每个会话的 agent 图标；混合历史按 turn 标 agent。

## 5. 验证策略
- 组件单测：AgentPicker 渲染 agent 列表/可用性/选择回调；AssistantMessage block 分发；ConversationListPane 搜索/重命名。
- 渲染回归：现有 agent 相关组件测试迁移后全绿；消息流式渲染不丢帧。
- 类型 + `npm run build` 通过。
- 手动验收：三家 agent 各新建会话能选中、消息头显示正确 agent、混合历史正确、视觉符合 DESIGN。

## 6. 明确不做
- 不换状态/持久化底座（Zustand+SQLite 保留）。
- 不引入 Lexical（若现有 MessageInput 已够用则增强而非替换为 Lexical；视实现成本决定，首版可不上 Lexical）。
- 不做 open-design 的 web 专属能力（daemon/api 双模式切换等与本桌面端无关的部分）。

# 子项目 B · 对话 UI 全面重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（可并行无冲突任务）。Steps 用 checkbox。

**Goal:** 按 open-design 组件拆分重构对话 UI，支持 Claude/Codex/Pi 显式选择与混合历史展示；保留 Zustand+SQLite+现有 Context。

**Architecture:** AgentSidebar(容器) → ConversationListPane + ChatPane(ChatHeader+MessageList+ChatComposer)；AssistantMessage 按 block 分发复用现有 block 组件；AgentPicker 显式选 agent（来源 A 的 `listAgentDefs()` + detection）；turn 带 agentId/agentName。

**Tech Stack:** React/TS/Zustand/Vitest，复用 `src/ui/*`，遵守 DESIGN.md（系统蓝、无第二 accent、无新弹窗）。

依赖：子项目 A（统一事件流 + listAgentDefs + detection）。参考 spec：`docs/superpowers/specs/2026-06-13-conversation-ui-overhaul-design.md`

---

## 并行批次
- **批次 1（并行，新文件/低耦合）**：B1 turn agent 身份持久化、B2 AgentIcon、B5 MessageList、B7 ConversationListPane 增强。
- **批次 2（并行，依赖 A registry / B2）**：B3 AgentPicker、B4 AssistantMessage。
- **串行**：B6 ChatComposer → B8 ChatPane（组装，替换 ConversationDetailPane）→ B9 AgentSidebar 接 AgentPicker → B10 验证。

---

## B1: turn 带 agentId/agentName 持久化
**Files:** `src/types/conversation.ts`, `electron/conversations/types.ts`, `electron/conversations/repository.ts`; Test 现有 conversations 测试补充
- [ ] Step1 调研现有 turn 结构与 repository.appendConversationTurn。
- [ ] Step2 `ConversationTurn`/turn entity 增加可选 `agentId?:string`/`agentName?:string`；repository 读写带上（迁移：旧数据缺省回退 conversation.agentType）。
- [ ] Step3 测试：append turn 带 agentId 能读回；旧 turn 无字段不报错。Step4 commit `feat(conv): turn 记录 agentId/agentName`

## B2: AgentIcon
**Files:** Create `src/components/agent/AgentIcon.tsx`; Test
- [ ] Step1 测试：`<AgentIcon agentId="claude"/>` 渲染对应图标/emoji；未知 id 回退默认。
- [ ] Step2 实现：agentId→icon 映射（claude/codex/pi 各一个，复用 src/ui 或 emoji；不引第二 accent）。Step3 通过；Step4 commit `feat(agent-ui): AgentIcon`

## B5: MessageList（虚拟化消息区 + 自动置底）
**Files:** Create `src/components/agent/MessageList.tsx`; Test
- [ ] Step1 调研现有 ConversationDetailPane 的消息滚动区/自动滚动逻辑。
- [ ] Step2 实现 MessageList：接收 turns（用户/assistant），渲染 UserMessage / AssistantMessage（B4），自动滚动到底、用户上滚时不强拉。虚拟化可用现有方案或简单窗口（会话消息量适中，先正确再优化，>N 时再虚拟化）。Step3 测试渲染 + 置底行为；Step4 commit `feat(agent-ui): MessageList`

## B7: ConversationListPane 增强
**Files:** Modify/rename `src/components/agent/SessionListPane.tsx` → 增强; Test
- [ ] Step1 调研 SessionListPane 现状。
- [ ] Step2 增强：搜索过滤、双击重命名、agent 图标（用 B2，按 conversation.agentType）。保留现有选择/新建回调。Step3 测试搜索/重命名；Step4 commit `feat(agent-ui): 会话列表搜索/重命名/agent 图标`

## B3: AgentPicker
**Files:** Create `src/components/agent/AgentPicker.tsx`; Test
依赖：A `listAgentDefs()`、detection 可用性（经 agent-api/IPC）。
- [ ] Step1 调研 A 提供的 listAgentDefs / preflight(detection) 在 renderer 怎么拿（agent-api）。
- [ ] Step2 实现 AgentPicker：列出 claude/codex/pi（名+AgentIcon+可用性：已装/未装置灰+指引），`value`/`onChange(agentId)`，复用 src/ui Select/Segmented。Step3 测试列表/选择/不可用置灰；Step4 commit `feat(agent-ui): AgentPicker`

## B4: AssistantMessage（block 分发 + agent 头 + 权限卡）
**Files:** Create `src/components/agent/AssistantMessage.tsx`; Test
- [ ] Step1 调研现有 ConversationDetailPane 的 block 分发（switch block.type→TextBlock/ThinkingBlock/ToolCallBlock/ErrorBlock）与 PermissionPrompt。
- [ ] Step2 实现 AssistantMessage：头部显示 agentName+AgentIcon（来自 turn.agentId 或会话回退）；body 按 block.type 分发到现有 block 组件；pendingPermission 时渲染权限卡（复用 PermissionPrompt 逻辑）。memo 优化避免流式全树重渲。Step3 测试分发各 block 类型 + agent 头；Step4 commit `feat(agent-ui): AssistantMessage block 分发`

## B6: ChatComposer（重构 MessageInput）
**Files:** `src/components/agent/ChatComposer.tsx`（重构自 MessageInput）; Test
- [ ] Step1 调研 MessageInput（斜杠/@文件/附件/模式/配置/取消）。
- [ ] Step2 重构为 ChatComposer：保留全部现有能力；新建会话场景集成 AgentPicker（B3）。不引 Lexical（增强现有即可）。Step3 测试核心交互不回归；Step4 commit `feat(agent-ui): ChatComposer`

## B8: ChatPane（容器，替换 ConversationDetailPane）
**Files:** Create `src/components/agent/ChatPane.tsx`; 删/瘦身 ConversationDetailPane; Test
- [ ] Step1 实现 ChatPane：组装 ChatHeader（标题+连接状态+用量+当前 agent）+ MessageList（B5）+ ChatComposer（B6）；复用现有 hooks（useConversationDetail/useConnectionLifecycle）。把 ConversationDetailPane 的逻辑迁入，保持数据流。Step2 替换引用点（AgentSidebar 用 ChatPane）。Step3 类型+回归；Step4 commit `feat(agent-ui): ChatPane 容器替换 ConversationDetailPane`

## B9: AgentSidebar 接 AgentPicker（显式选 agent 建会话）
**Files:** Modify `src/components/agent/AgentSidebar.tsx`
- [ ] Step1 新建会话流程改为：弹/展示 AgentPicker 选 agent（默认上次/首个可用）→ `createConversation({agentType: 选中})`，取代 getPreferredAgentType 隐式选。保留无选择时回退默认。Step2 类型+回归；Step3 commit `feat(agent-ui): 新建会话显式选 agent`

## B10: 集成验证
- [ ] Step1 全量 `npx vitest run` 全绿 + `npx tsc --noEmit`。
- [ ] Step2 `npm run build` 通过。
- [ ] Step3 手动验收：三家各新建会话能选中、消息头显示正确 agent、混合历史正确、视觉符合 DESIGN、流式渲染正常。
- [ ] Step4 CHANGELOG 记录；commit。

## Self-Review 备注
- 现有 ConversationDetailPane/MessageInput/SessionListPane 真实结构（B4/B6/B7/B8）。
- A 的 listAgentDefs/detection 在 renderer 的获取方式（B3）。
- 现有 hooks 接口（B8）。

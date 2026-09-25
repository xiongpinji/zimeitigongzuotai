# 对话界面重做（对齐 open-design）Implementation Plan

> 子项目 B 的迭代。REQUIRED SUB-SKILL: subagent-driven-development（并行无冲突任务）。

**Goal:** 按用户指令 + open-design 风格重做 AI 对话界面：①去掉左会话列表→icon 弹 dropdown 切换/新建；②agent 切换移到设置中心、全局单选一个、顶部只读标记（点击进设置）；③暴露模型选择器（可手动切换/用默认）；④消息/工具/skill 渲染换 open-design 风格（op-card 状态徽章+折叠+同名聚合）；⑤移除"Claude Code"标题；⑥移除 MCP 运行状态展示。

**参考实现**：open-design `InlineModelSwitcher.tsx`（模型芯片）、`ToolCard.tsx`（op-card）、`AssistantMessage.tsx`（block 渲染/tool-group）、chat header（icon→popover 会话切换）。

**约定**：保留 Zustand+SQLite+现有 context/hooks；遵守 DESIGN.md（系统蓝、无第二 accent、无新弹窗——dropdown/popover 复用 src/ui）。

---

## 模型数据来源（前置）
现 `RuntimeAgentDef` 只有 `defaultModel` 无模型列表。对齐 open-design 的 `fallbackModels`：给三家 def 加**静态模型列表**（真实可用模型名待手动校正，先给合理静态集）：
- claude：`claude-sonnet-4-6` / `claude-opus-4-8` / `claude-haiku-4-5`（按项目现用模型）
- codex：`gpt-5.1-codex` / `gpt-5.1` 等（占位 + TODO）
- pi：可配置/默认（占位 + TODO）
模型选定 → `ctx.model` → buildArgs（已支持）。

---

## Wave 1（并行，独立文件）

### T1: AgentHeader 去标题 + 去 MCP 状态（小）
**File:** `src/components/agent/AgentHeader.tsx`；Test 调整
- 删除第 35 行 "Claude Code" 标题；删除 mcpStatus state/useEffect/渲染块（约 12-17、42-62 行）。保留连接状态点 + 关闭按钮（若 ChatHeader 已显示状态，AgentHeader 可精简到仅关闭按钮）。grep 确认无别处依赖被删元素。
- commit `feat(agent-ui): 移除 AgentHeader 的 Claude Code 标题与 MCP 状态`

### T2: agent defs 加模型列表 + 暴露到 renderer（中）
**Files:** `electron/agent-runtime/types.ts`（RuntimeAgentDef 加 `models?: {id:string;label:string}[]`）、`agent-defs/{claude,codex,pi}.ts`、`registry.ts`；`src/lib/agent-presentation.ts`（暴露 models）；Test
- 给三家 def 加静态 models 列表（见上，真实名标 TODO）。`getAgentDef`/`listAgentDefs` 带出。
- `agent-presentation.ts` 的 presentation 暴露 `models` + `defaultModel`，renderer 可读。
- 测试：getAgentDef('claude').models 非空；presentation 带 models。
- commit `feat(agent-runtime): agent def 增加模型列表并暴露到 renderer`

### T3: ToolCallBlock 重做为 open-design op-card（中）
**File:** `src/components/agent/ToolCallBlock.tsx`；Test
- 重做为 op-card 风格：左侧状态徽章（running=系统蓝 spinner / ok=绿 check / error=红 close）、标题（工具名）+ meta、可折叠 input(JSON)/output；流式中 shimmer/spinner。复用现有 props（block: {type,toolCallId,title,kind,status,rawInput,rawOutput}）。遵守 DESIGN（系统蓝 accent，不引第二 accent；绿/红仅用于状态语义，最小化）。
- 测试：running/done/error 三态渲染；input/output 折叠；含 title。
- commit `feat(agent-ui): ToolCallBlock 重做为 open-design op-card 风格`

---

## Wave 2（依赖 Wave 1）

### T4: 设置中心改"全局单选 agent + 模型下拉"（中）
**Files:** `src/components/settings/AgentSettingsTab.tsx`；`electron/acp/config.ts`（存一个全局 `defaultAgentId`，单选语义）；`src/lib/agent-api.ts`（getPreferredAgentType 改为读 defaultAgentId）；Test
依赖 T2（模型列表）。
- AgentSettingsTab：PillGroup 多 agent 切换改为**单选当前激活 agent**（RadioGroup/单选 PillGroup，选中即设为全局默认；只允许一个激活）。Model 字段从 text input 改为 **下拉**（来自 T2 的 `presentation.models`，可选默认）。
- config：新增/复用 `defaultAgentId`（全局单 agent）；`getPreferredAgentType` 返回它。`ensureDefaultAgents` 保持三家配置存在但"激活/默认"只一个。
- 测试：选某 agent → defaultAgentId 更新；model 下拉选择写回 agent.model。
- commit `feat(agent-ui): 设置中心全局单选 agent + 模型下拉`

### T5: 模型选择芯片（composer，open-design InlineModelSwitcher-lite）（中）
**Files:** Create `src/components/agent/ModelPicker.tsx`；改 `ChatComposer.tsx` 接入；模型流经发送链路（`acp-connections-context` sendPrompt/connect 带 model → ipc → runtime）；Test
依赖 T2。
- ModelPicker：显示当前 agent 图标+名（只读，点击触发 `onOpenAgentSettings` 进设置）+ 当前模型（可搜索下拉，列表来自 active agent 的 models，默认 = defaultModel/agent.model）。对齐 open-design 芯片视觉（紧凑 chip + popover）。
- ChatComposer 底部渲染 ModelPicker；选模型 → 受控 state；发送时把 model 传入 sendPrompt。
- 数据路径：确认 `connect`/`sendPrompt` 能带 model 到 runtime（A 的 connectRuntime 已接 payload.model；renderer 侧把选中 model 传进去）。若现 sendPrompt 不带 model，补上（acp-connections-context + ipc + runtime-registry.sendPrompt 透传 model 给 AgentSession.start）。
- 测试：渲染当前模型；切换 → onChange/受控更新；点 agent 区 → onOpenAgentSettings。
- commit `feat(agent-ui): 模型选择芯片 + 模型流经发送链路`

### T6: 会话切换 dropdown（去左列表）（大）
**Files:** Create `src/components/agent/ConversationDropdown.tsx`；改 `ChatPane.tsx`（header 加会话切换 icon→dropdown）；改 `AgentSidebar.tsx`（移除左列 + SessionListPane）；删除/弃用 `SessionListPane.tsx`、`ConversationToolbar.tsx`（功能并入）；Test
- ConversationDropdown：icon 触发 popover，内含搜索 + 会话列表（选择/删除/双击重命名，复用 useConversationList 的 setActiveConversation/deleteConversation/renameConversation）+ 顶部"新建会话"项（用全局默认 agent，**不再选 agent**）。
- ChatPane header：左=会话切换 icon（开 ConversationDropdown）+ 当前会话标题；右=连接状态/用量 + agent 只读标记（点击 onOpenAgentSettings）。
- AgentSidebar：移除左列布局/ConversationToolbar/SessionListPane/selectedAgentId/AgentPicker；只剩 AgentHeader（精简）+ ChatPane。新建会话用 getPreferredAgentType()（=全局默认 agent）。
- 测试：dropdown 渲染会话列表 + 搜索 + 新建项；选择/重命名/删除回调；ChatPane header 含会话切换 icon。
- commit `feat(agent-ui): 会话切换改 icon→dropdown，移除左侧会话列表`

---

## Wave 3（集成 + 渲染收尾）

### T7: tool-group 同名聚合 + AssistantMessage 收尾（中）
**Files:** `src/components/agent/AssistantMessage.tsx`（或 MessageList）；Test
- 连续同名 tool_call block 聚合为一张可折叠 group 卡（"Editing ×3, Done"），单个不聚合。复用 T3 的 op-card。对齐 open-design ToolGroupCard。
- 移除 AssistantMessage 里多余 agent 头？保留（混合历史需要）。
- 测试：3 个同名 tool_call → 聚合卡；不同名不聚合。
- commit `feat(agent-ui): 同名工具调用聚合（tool-group）`

### T8: 集成验证 + 清理 + CHANGELOG
- 删除/弃用的组件无悬空引用（grep SessionListPane/ConversationToolbar/AgentPicker 旧用法）。
- 全量 `npx vitest run` 全绿 + `npm run build` 通过 + `tsc` 干净。
- 手动验收清单：①icon 弹会话 dropdown 切换/新建；②顶部 agent 只读、点击进设置；③设置中心单选 agent + 模型下拉；④composer 模型芯片可切换；⑤工具卡 op-card + 聚合；⑥无"Claude Code"标题、无 MCP 状态。
- CHANGELOG。commit。

---

## 依赖与并行
- Wave1：T1/T2/T3 完全独立，并行。
- Wave2：T4（依赖 T2）、T5（依赖 T2）、T6（独立于 T2/T4/T5，但改 AgentSidebar/ChatPane 与 T5 的 ChatComposer/ChatPane 有交集）→ T5、T6 都改 ChatPane/Composer，**串行或仔细分区**：先 T5（composer 模型芯片）再 T6（ChatPane header + 布局），避免冲突。T4 可与 T5 并行（不同文件）。
- Wave3：T7（AssistantMessage）独立，可与 Wave2 并行；T8 最后。

## Self-Review 备注（实现时核对）
- 真实可用模型名（T2）——标 TODO 待手动校正。
- sendPrompt 是否已带 model 到 runtime（T5）——核实 acp-connections-context/ipc/runtime-registry。
- 设置"单 agent"语义与 config 现有多 agent 结构兼容（T4）。
- ChatPane/ChatComposer 被 T5/T6 都改——注意分区避免冲突。

# 子项目 A · 多协议 Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（可并行无冲突任务）。Steps 用 checkbox。

**Goal:** 用多协议 runtime 替换 ACP-only 底层，支持 Claude(`claude-stream-json`) / Codex(`codex-json-event`) / Pi(`pi-rpc`)，归一化成统一事件流，对接现有会话管线与 SQLite。加新 agent = 1 个 def 文件 + 注册一行。

**Architecture:** `electron/agent-runtime/`：声明式 `RuntimeAgentDef` 注册表 → `AgentSession`（spawn + 按 streamFormat 接 parser + 生命周期/resume）→ parser emit 统一 `AgentStreamEvent` → 归一化 `toRuntimeEvent` 映射到现有 Renderer 事件形状 → 沿用现有 `agent:runtime-event` IPC + SQLite。

**Tech Stack:** Electron / TS / Node child_process / Vitest。

参考 spec：`docs/superpowers/specs/2026-06-13-multi-protocol-agent-runtime-design.md`

---

## 并行批次

- **批次 1（并行，互不依赖，全新文件）**：A1 event-model、A2 registry+defs、A3 line-stream、A7 detection。
- **批次 2（并行，依赖批次1 的 event-model+line-stream）**：A4 claude parser、A5 codex parser、A6 pi-rpc parser。
- **串行**：A8 session → A9 runtime-registry → A10 ipc 接线+config 迁移 → A11 Renderer 归一化对接 → A12 集成验证+清理。

---

## A1: 统一事件模型 + 归一化映射

**Files:** Create `electron/agent-runtime/event-model.ts`; Test `tests/agent-runtime/event-model.test.ts`

- [ ] Step1 写失败测试：覆盖 `toRuntimeEvent` 把每种 `AgentStreamEvent` 映射到现有 runtime-event 形状。先 Read `src/contexts/acp-connections-context.tsx` 的 `applyRuntimeEvent`，确认它消费的事件字段名（`content_delta`/`text`/`thinking`/`tool_call`(info)/`tool_call_update`/`turn_complete`/`error`），测试断言映射输出与之匹配。
- [ ] Step2 实现 `AgentStreamEvent` 类型（见 spec §2）+ `toRuntimeEvent(ev): RuntimeEventOut | null`：
  - text_delta→`{type:'text', text}`；thinking_delta→`{type:'thinking', text}`；tool_use→`{type:'tool_call', info:{toolCallId:id,title:name,kind:'other',status:'pending',rawInput:JSON.stringify(input)}}`；tool_result→`{type:'tool_call_update', toolCallId, status:isError?'error':'completed', rawOutput:content, rawOutputAppend:false}`；turn_end→`{type:'turn_complete', stopReason}`；error→`{type:'error', message}`；usage→`{type:'usage', used,size}`(按现有 usage 形状)；status/thinking_start/thinking_end/tool_input_delta/raw→null（不直接映射或后续处理）。
  - 以 Read 到的真实 Renderer 事件字段为准微调。
- [ ] Step3 测试通过；Step4 commit `feat(agent-runtime): 统一事件模型 + 归一化映射`

## A2: RuntimeAgentDef 类型 + registry + 三个 def

**Files:** Create `electron/agent-runtime/types.ts`, `registry.ts`, `agent-defs/{claude,codex,pi}.ts`; Test `tests/agent-runtime/registry.test.ts`

- [ ] Step1 写失败测试：`getAgentDef('claude'|'codex'|'pi')` 返回正确 def（id/name/bin/streamFormat）；未知 id 返回 null；`listAgentDefs()` 含三个；重复 id 抛错。
- [ ] Step2 实现 `types.ts`（`RuntimeAgentDef`、`StreamFormat`、`BuildArgsCtx`，见 spec §3）。三个 def：
  - claude：`{id:'claude',name:'Claude Code',bin:'claude',versionArgs:['--version'],streamFormat:'claude-stream-json',promptViaStdin:true, buildArgs:(ctx)=>['--print','--output-format','stream-json','--verbose', ...(ctx.model?['--model',ctx.model]:[]), ...(ctx.cwd?['--add-dir',ctx.cwd]:[])]}`（参数以 claude CLI stream-json 约定为准，实现者据 claude --help 真实 flag 校正；拿不准的 flag 用最小集合）。
  - codex：`{id:'codex',name:'Codex',bin:'codex',versionArgs:['--version'],streamFormat:'codex-json-event',buildArgs:(ctx)=>[...]}`（codex 的 JSON 事件输出模式参数，实现者据 codex --help 校正）。
  - pi：`{id:'pi',name:'Pi',bin:'pi',versionArgs:['--version'],streamFormat:'pi-rpc',resumesSessionViaCli:true,buildArgs:(ctx)=>['--mode','rpc']}`（以 pi rpc 模式为准）。
  - `registry.ts`：`AGENT_DEFS=[claude,codex,pi]` + 唯一性校验 + `getAgentDef`/`listAgentDefs`。
- [ ] Step3 测试通过；Step4 commit `feat(agent-runtime): RuntimeAgentDef 注册表 + claude/codex/pi def`

> 注意：buildArgs 的真实 CLI flag 可能与上面不完全一致；实现者用各 CLI `--help` 校正，拿不准用最小可跑集合并在汇报标注，后续手动验收再调。本任务重点是结构正确 + 可测。

## A3: 公用行/部分 JSON 切分器

**Files:** Create `electron/agent-runtime/parsers/line-stream.ts`; Test `tests/agent-runtime/line-stream.test.ts`

- [ ] Step1 写失败测试：`createJsonLineStream(onJson)` 的 `feed(chunk)`：完整 JSON 行→onJson(obj)；跨 chunk 的半行→拼接后解析；非 JSON 行→onRaw 或忽略；多行一次 feed→逐个 emit；超大累积上限保护。
- [ ] Step2 实现：有状态按 `\n` 切，残留缓冲跨 feed 拼接；每行尝试 `JSON.parse`，失败则缓存与下一行聚合（上限 256 行/128KB，超限丢弃并继续），`flush()` 处理尾残留。接口 `{feed(chunk:Buffer|string), flush()}` + 回调 `onJson(obj)` / 可选 `onRaw(line)`。
- [ ] Step3 测试通过；Step4 commit `feat(agent-runtime): 公用 JSON 行/部分聚合切分器`

## A7: detection（bin/版本探测，复用 BinaryManager）

**Files:** Create `electron/agent-runtime/detection.ts`; Test `tests/agent-runtime/detection.test.ts`

- [ ] Step1 写失败测试（注入 fake BinaryManager）：`detectAgent(def, bm)` 返回 `{installed:boolean, binPath:string|null, version:string|null}`：resolveBinary 命中→installed=true+binPath；未命中→installed=false。版本探测调 execFile（可注入/跳过）。
- [ ] Step2 实现：用 `bm.resolveBinary(def.bin)`（+ fallbackBins）解析路径；可选探版本（execFile def.versionArgs，超时容错，失败 version=null 不阻塞）。
- [ ] Step3 测试通过；Step4 commit `feat(agent-runtime): agent 探测（bin/版本，复用 BinaryManager）`

## A4: Claude stream-json parser

**Files:** Create `electron/agent-runtime/parsers/claude-stream.ts`; Test `tests/agent-runtime/claude-stream.test.ts`
依赖：A1 event-model、A3 line-stream。

- [ ] Step1 写失败测试：构造代表性 Claude JSONL 样本（system/init、content_block_delta(text_delta)、content_block_delta(thinking_delta)、input_json_delta 累积 + content_block_stop、user 消息 tool_result block、result(usage)、message stop_reason），feed 后断言 emit 的 AgentStreamEvent 序列：status→text_delta→thinking_delta→tool_use(id,name,input)→tool_result→usage→turn_end。含 tool_use 去重（streamedToolUseIds）。
- [ ] Step2 实现 `createClaudeStreamParser(onEvent): {feed,flush}`（用 line-stream 切 JSONL），映射规则见 spec §4。
- [ ] Step3 测试通过；Step4 commit `feat(agent-runtime): Claude stream-json parser`

## A5: Codex json-event parser

**Files:** Create `electron/agent-runtime/parsers/codex-json-event.ts`; Test `tests/agent-runtime/codex-json-event.test.ts`
依赖：A1、A3。

- [ ] Step1 写失败测试：构造代表性 codex JSON 行样本（turn.started、item.started/command_execution、item.completed/command_execution、item.completed/agent_message、turn.completed、error），断言 emit：status→tool_use(Bash)→tool_result→text_delta→usage；command_execution 的 started/completed 双发用集合去重只产生一个 tool_use；"Reconnecting" error 归为 status。
- [ ] Step2 实现 `createCodexParser(onEvent): {feed,flush}`（用 line-stream），映射见 spec §4。
- [ ] Step3 测试通过；Step4 commit `feat(agent-runtime): Codex json-event parser`

## A6: Pi rpc parser/session

**Files:** Create `electron/agent-runtime/parsers/pi-rpc.ts`; Test `tests/agent-runtime/pi-rpc.test.ts`
依赖：A1、A3。

- [ ] Step1 写失败测试：`mapPiRpcEvent(raw, emit, ctx)` 纯映射函数（先把"映射"与"会话 IO"拆开，先测映射）：agent_start→status；message_update(text_delta/thinking_delta/error)；tool_execution_start→tool_use；tool_execution_end→tool_result；turn_end+usage→usage；agent_end→turn_end。
- [ ] Step2 实现 `mapPiRpcEvent`（纯函数）+ `createPiRpcSession({child,prompt,cwd,model,parentSession,onEvent})`（写 stdin 命令：首轮 prompt，续轮 new_session{parentSession} 再 prompt；读 stdout 经 line-stream → mapPiRpcEvent；捕获 `.pi/sessions/*.jsonl` 会话路径用于 resume）。session IO 部分可注入 child 做集成测试，纯映射部分单测覆盖。
- [ ] Step3 测试通过；Step4 commit `feat(agent-runtime): Pi rpc parser/session`

## A8: AgentSession（spawn + 接 parser + 生命周期/resume）

**Files:** Create `electron/agent-runtime/session.ts`; Test `tests/agent-runtime/session.test.ts`
依赖：A2、A4/A5/A6、A7、A1。

- [ ] Step1 写失败测试（注入 fake spawn / fake child 提供可控 stdout/stdin）：`AgentSession.start({def, prompt, cwd, model, env, onEvent})` 按 def.streamFormat 选 parser，feed fake stdout → onEvent 收到归一事件；`cancel()` 杀子进程；claude/codex 走 feed/flush，pi 走 createPiRpcSession。
- [ ] Step2 实现 `AgentSession`：用 detection 解析 binPath，`buildArgs(ctx)` 构 args，spawn（stdio: stdin(pipe if promptViaStdin/pi)/stdout(pipe)/stderr(pipe)），按 streamFormat 接对应 parser，prompt 写 stdin（claude/codex promptViaStdin）或交给 pi-rpc session；stdinOpen 保活（claude 多轮）；emit AgentStreamEvent；close/flush/cancel/error 处理；resume（pi parentSession，claude 续轮）。spawn 用可注入的 spawn 函数便于测试。
- [ ] Step3 测试通过；Step4 commit `feat(agent-runtime): AgentSession spawn + parser 接线 + 生命周期`

## A9: runtime-registry（多会话 + 归一化转发）

**Files:** Create `electron/agent-runtime/runtime-registry.ts`; Test `tests/agent-runtime/runtime-registry.test.ts`
依赖：A8、A1。对标现有 `electron/acp/connection-registry.ts` 的对外接口。

- [ ] Step1 调研：Read `electron/acp/connection-registry.ts` 的对外方法（connect/disconnect/sendPrompt/cancelTurn/setMode/respondPermission + 'status'/'event'/'capabilities'/'file_changed' 事件）与 `electron/acp/ipc.ts` 怎么用它。
- [ ] Step2 写失败测试（注入 fake AgentSession）：connect 建会话；session emit AgentStreamEvent → registry 经 `toRuntimeEvent` 转成现有 runtime-event 形状并 emit 'event'（conversationId 维度）；disconnect 清理；多会话隔离。
- [ ] Step3 实现 `RuntimeRegistry`：conversationId→AgentSession map；connect({conversationId,agentType,projectDir,model,...})→getAgentDef→AgentSession.start，把 session 的 AgentStreamEvent 经 toRuntimeEvent 转发为 'event'；status/error 转发；sendPrompt/cancel/disconnect。对外事件/方法签名尽量对齐旧 connection-registry，便于 ipc 平滑切换。
- [ ] Step4 测试通过；Step5 commit `feat(agent-runtime): 多会话 runtime-registry + 归一化转发`

## A10: ipc 接线 + config 键迁移 + preflight

**Files:** Modify `electron/acp/ipc.ts`, `electron/acp/config.ts`, `electron/acp/preflight.ts`（或迁到 agent-runtime）; Test 调整
依赖：A9、A7。

- [ ] Step1 调研 ipc.ts connectRuntime 当前如何用 connection-registry + agent-profiles。
- [ ] Step2 connectRuntime 改用 `RuntimeRegistry`：`agentId=payload.agentType`→`getAgentDef(agentId)`；agentType 取值从 `claude-acp/pi-acp` 迁移为 `claude/codex/pi`（加兼容映射：`claude-acp→claude`、`pi-acp→pi`）。env 组装沿用（custom_api→ANTHROPIC_* 仅 claude 适用，由 def/profile 决定）。
- [ ] Step3 config 迁移：`ensureDefaultAgents` 默认键改为 `claude/codex/pi`（保留旧键兼容读取，load 时把旧键映射/补齐）。`agent:run-preflight` 改用 `detection.ts` 按 def 探测。
- [ ] Step4 类型检查 + 现有 agent 测试回归（按需更新断言中的 agentId）；Step5 commit `feat(agent-runtime): ipc/config/preflight 切换到多协议 runtime（claude/codex/pi）`

## A11: Renderer 归一化事件对接

**Files:** Modify `src/contexts/acp-connections-context.tsx`（applyRuntimeEvent）; 视情况 `src/lib/agent-api.ts`
依赖：A1 的映射形状。

- [ ] Step1 核对：A1 的 `toRuntimeEvent` 输出形状是否与 `applyRuntimeEvent` 现有 case 完全匹配；不匹配处做最小适配（优先改 toRuntimeEvent 对齐前端，避免动前端）。
- [ ] Step2 若需要，最小调整 applyRuntimeEvent 接纳新增/改名事件；保证 text 连续合并、tool_call 配对、usage 更新、turn_complete 清 liveMessage 行为不变。
- [ ] Step3 类型检查 + 回归；Step4 commit `feat(agent-runtime): Renderer 事件管线对接多协议归一事件`

## A12: 集成验证 + 旧 ACP 层处置

- [ ] Step1 全量 `npx vitest run`（全绿）+ `npx tsc --noEmit`。
- [ ] Step2 `npm run build` 通过。
- [ ] Step3 旧 `electron/acp/connection-registry.ts`/`session.ts`/`client.ts`（ACP spawn）若已无引用则标记废弃或删除（保留 acp 协议工具备用）；确认无悬空 import。
- [ ] Step4 手动验收清单（需本机装 claude/codex/pi）：三家各连一次、发一条 prompt、看流式文本+工具调用+多轮 resume。记入说明。
- [ ] Step5 commit `chore(agent-runtime): 集成验证 + 旧 ACP spawn 层处置`

## Self-Review 备注（实现时核对真实信息）
- 各 CLI 的真实 stream/json/rpc 输出格式与 flag（A2/A4/A5/A6）——以各 CLI `--help` 与参考项目 parser 源码为准；测试用代表性 fixture。
- `applyRuntimeEvent` 真实消费的事件字段（A1/A11）。
- connection-registry 对外接口（A9/A10）。
- config 现有 agents 键与 ensureDefaultAgents（A10）。

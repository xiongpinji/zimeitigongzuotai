# 子项目 A · 多协议 Agent Runtime 设计方案

- 日期：2026-06-13
- 分支：feat/lingji-cli
- 状态：已评审，待实现
- 参考：open-design-slim（`apps/daemon/src/runtimes/`、`claude-stream.ts`、`json-event-stream.ts`、`pi-rpc.ts`、`acp.ts`、`server.ts`）

## 1. 背景与目标

当前 `electron/acp/` 是 **ACP-only** runtime：所有 agent 经 ACP JSON-RPC 适配器（`claude-agent-acp`、上一轮加的 `pi-acp`）。本子项目按 open-design 的**多协议**架构重写底层 agent runtime，让 **Claude / Codex / Pi** 三家各走最适合的原生协议，归一化成一套统一事件流，对接现有会话管线与 SQLite 持久化。

**目标（验收口径）：底层 Agent 工具可替换**——新增/切换一个 agent 只需一个声明式 def 文件 + 注册一行；三家 agent 都能 spawn、流式对话、工具调用、多轮 resume。

### 核心决策（已确认）
1. **多协议**（非 ACP-only）：Claude=`claude-stream-json`、Codex=`json-event-stream`(codex)、Pi=`pi-rpc`。
2. **保留 Zustand + SQLite**：会话/消息持久化与 store 不变。
3. 多协议**取代** ACP-only 路径；上一轮 `AgentProfile`/pi-acp 演进为 `RuntimeAgentDef`，复用可复用的（BinaryManager PATH 解析、IPC 表面、conversation 持久化），替换 ACP 专属会话层。
4. **事件契约锚定现有前端**：parser 归一化事件映射到 Renderer 现有 `applyRuntimeEvent` 能消费的形状（text/thinking/tool_call/tool_call_update/permission_request/turn_complete/error），使 IPC 表面与前端事件契约尽量不变，降低 UI 联动风险（UI 全面重构是子项目 B）。

## 2. 架构总览

```
RuntimeAgentDef 注册表 (claude/codex/pi)
        │  getAgentDef(id)
        ▼
AgentSession（spawn 子进程 + 按 streamFormat 接 parser + 生命周期/resume）
        │  parser.feed(stdout chunk) → onEvent(AgentStreamEvent)
        ▼
归一化层 normalizeToRuntimeEvent(AgentStreamEvent) → 现有 runtime-event 形状
        │  IPC 'agent:runtime-event'（沿用现有通道）
        ▼
Renderer acp-connections-context.applyRuntimeEvent（基本不变）→ SQLite 持久化（不变）
```

### 统一事件模型 `AgentStreamEvent`（parser 输出）
```ts
type AgentStreamEvent =
  | { type: 'status'; label: string; detail?: string; model?: string; sessionId?: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_input_delta'; id: string; delta: string }   // claude 特有，可被归一化层折叠
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number }
  | { type: 'turn_end'; stopReason?: string }
  | { type: 'error'; message: string; raw?: string }
  | { type: 'raw'; line: string };
```

### 归一化映射（AgentStreamEvent → 现有 Renderer 事件）
现有 `applyRuntimeEvent` 消费的事件（见 `src/contexts/acp-connections-context.tsx`）：`content_delta/text`、`thinking`、`tool_call`、`tool_call_update`、`permission_request`、`turn_complete`、`error`。映射规则：
| AgentStreamEvent | Renderer 事件 |
|---|---|
| `text_delta` | `{ type:'text', text: delta }`（连续 text 合并由前端处理） |
| `thinking_delta` | `{ type:'thinking', text: delta }` |
| `tool_use` | `{ type:'tool_call', info:{ toolCallId:id, title:name, kind, status:'pending', rawInput } }` |
| `tool_result` | `{ type:'tool_call_update', toolCallId, status:'completed'|'error', rawOutput, rawOutputAppend? }` |
| `turn_end` | `{ type:'turn_complete', stopReason }` |
| `error` | `{ type:'error', message }` |
| `status`(usage 折算) | 更新 usage（沿用现有 usage 通道） |
| `tool_input_delta` | 折叠进 tool_call 的 rawInput 流式更新（可选；首版可缓冲到 tool_use 一次性给出） |

> 权限：Claude 工具级权限（AskUserQuestion）保留前端 PermissionPrompt 路径；codex/pi 首版采用"协议级自动批准"（对齐 open-design acp 的自动 approve），后续可加 UI。首版不主动制造 `permission_request` 事件，除非 agent 协议显式发出。

## 3. 模块与文件结构（新增 `electron/agent-runtime/`）

| 文件 | 职责 |
|---|---|
| `event-model.ts` | `AgentStreamEvent` 类型 + 归一化 `toRuntimeEvent(ev)`（→ 现有 runtime-event 形状） |
| `types.ts` | `RuntimeAgentDef` 接口 |
| `agent-defs/claude.ts` / `codex.ts` / `pi.ts` | 三个声明式 def |
| `registry.ts` | `AGENT_DEFS` 数组 + `getAgentDef(id)` + `listAgentDefs()` + id 唯一性校验 |
| `parsers/claude-stream.ts` | `createClaudeStreamParser(onEvent): {feed,flush}`（解析 Claude JSONL） |
| `parsers/codex-json-event.ts` | `createCodexParser(onEvent): {feed,flush}`（解析 codex JSON 行事件） |
| `parsers/pi-rpc.ts` | `createPiRpcSession({...,onEvent})`（pi JSON-RPC 方言，含 stdin 命令 + parentSession resume） |
| `parsers/line-stream.ts` | 公用：按行/部分 JSON 聚合的有状态切分器（对标 acp.ts 的 createJsonLineStream） |
| `detection.ts` | 复用 `BinaryManager.resolveBinary` 解析 bin、`getNodeVersion`、版本探测 |
| `session.ts` | `AgentSession`：按 def spawn 子进程、接 parser、stdin 保活/prompt、cancel、resume，emit `AgentStreamEvent` |
| `runtime-registry.ts` | 多会话管理（对标现有 `electron/acp/connection-registry.ts`）：conversationId→AgentSession，转发归一化事件 |

### RuntimeAgentDef（声明式）
```ts
export type StreamFormat = 'claude-stream-json' | 'codex-json-event' | 'pi-rpc';
export interface RuntimeAgentDef {
  id: string;                 // 'claude' | 'codex' | 'pi'
  name: string;               // 'Claude Code' | 'Codex' | 'Pi'
  bin: string;                // 'claude' | 'codex' | 'pi'
  fallbackBins?: string[];
  versionArgs: string[];
  buildArgs: (ctx: BuildArgsCtx) => string[];   // 构建 CLI 参数
  streamFormat: StreamFormat;
  promptViaStdin?: boolean;
  resumesSessionViaCli?: boolean;               // pi=true
  env?: Record<string, string>;
  defaultModel?: string;
}
```

## 4. 三个 parser 的归一化要点（对标研究结论）

- **claude-stream-json**：`system/init`→status；`content_block_delta/text_delta`→text_delta；`thinking_delta`→thinking_delta；`input_json_delta`累积+`content_block_stop`→tool_use；user 消息的 `tool_result` block→tool_result；`result`→usage；`stop_reason!=='tool_use'`→turn_end。用 `streamedToolUseIds` 去重。
- **codex-json-event**：`turn.started`→status；`item.started/command_execution`→tool_use；`item.completed/command_execution`→tool_result（用集合去重 started/completed 双发）；`item.completed/agent_message`→text_delta（needsBoundary 处理多消息粘合）；`turn.completed`→usage；`error`→error（"Reconnecting" 归为 status）。
- **pi-rpc**：spawn `pi`（buildArgs 给 rpc 模式参数）；`agent_start`→status；`message_update` 的 text_delta/thinking_delta/error；`tool_execution_start`→tool_use；`tool_execution_end`→tool_result；`turn_end+usage`→usage；`agent_end`→turn_end。多轮：首轮直接发 prompt，续轮先 `new_session{parentSession}` 再发 prompt；会话路径从 `.pi/sessions/*.jsonl` 快照对比捕获，存入 conversation 的 externalId 用于 resume。

### 部分 JSON / 容错
公用 `line-stream.ts`：单行 JSON 解析失败时缓存到下一行聚合（上限 256 行 / 128KB），最终失败 emit `{type:'raw'}`；parser 不因脏行死锁。

## 5. 与现有代码的衔接 / 替换

- **IPC 表面不变**：`agent:connect-runtime` / `agent:send-prompt-runtime` / `agent:cancel-turn-runtime` / `agent:runtime-event` 等通道与参数保持；`electron/acp/ipc.ts` 的 `connectRuntime` 改为调用新 `runtime-registry`（按 `payload.agentType` → `getAgentDef`）。
- **替换**：`electron/acp/connection-registry.ts` + `session.ts` + `client.ts`（ACP JSON-RPC spawn/会话）被 `electron/agent-runtime/runtime-registry.ts` + `session.ts` 取代。`electron/acp/acp.ts`（若存在 ACP 协议工具）保留作 acp streamFormat 备用，但三家目标 agent 不走它。
- **复用**：`BinaryManager`（PATH/nvm 解析、resolveBinary、ensureNodeInPath）；`electron/conversations/`（SQLite 会话/turn 持久化）；Renderer `acp-connections-context`（applyRuntimeEvent 事件管线，按归一化映射微调）。
- **agent-profiles → agent-defs 迁移**：上一轮 `electron/acp/agent-profiles.ts` 的 claude/pi profile 概念并入 `agent-runtime/agent-defs/`。preflight 改为基于 def（`detection.ts`）。Pi 不再依赖 `pi-acp` 适配器，改 `pi` 原生 rpc。
- **config**：`agents` 配置键从 `claude-acp`/`pi-acp` 迁移到 `claude`/`codex`/`pi`（带兼容读取：旧键映射到新 id）。

## 6. 验证策略

- **parser 单测（核心）**：每个 parser 用录制的真实输出样本（JSONL/JSON 行/rpc 消息）feed，断言 emit 的 `AgentStreamEvent` 序列正确（text/tool_use/tool_result/usage/turn_end）。含部分 JSON、多消息粘合、tool 去重等边界。
- **归一化单测**：`toRuntimeEvent` 把 AgentStreamEvent 正确映射到现有 runtime-event 形状。
- **registry/detection 单测**：def 唯一性、getAgentDef、bin 解析（注入 fake）。
- **session 集成（可注入）**：用 fake child（可控 stdout 流）驱动 AgentSession，验证 spawn→parse→emit→cancel 生命周期，不依赖真实 CLI。
- **IPC 回归**：`agent:*` 通道契约不破坏，现有 agent 相关测试全绿。
- **构建**：`npm run build` 通过。
- **手动验收（需本机装 claude/codex/pi）**：三家各连一次、发一条 prompt、看流式文本+工具调用+多轮。无法在 CI/无 binary 环境自动化，列入手动清单。

## 7. 明确不做（本子项目）
- 不做 UI 全面重构（子项目 B）。
- 不接 codex/pi 的工具级权限 UI（首版协议级自动批准，对齐参考项目）。
- 不引入 open-design 的全部 20+ agent / 全部 streamFormat，只做 claude/codex/pi 三家 + 三种格式 + 公用 line-stream。

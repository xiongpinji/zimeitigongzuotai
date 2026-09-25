# 内置 pi 为唯一对话 Agent —— 移除 codex / claude 面板路径

- 日期：2026-06-17
- 状态：设计已确认，待写实现计划
- 关联：`2026-06-13-multi-protocol-agent-runtime-design.md`、`2026-06-17-agent-skill-workflow-design.md`

## 1. 背景与目标

当前 AI 对话面板（`src/components/agent/`）的运行时是 `electron/agent-runtime/` 里的
`RuntimeRegistry`（CLI-spawn 模型，每轮 spawn 一次进程），通过 `electron/acp/ipc.ts` 接到 IPC。
`registry.ts` 注册了三个面板 agent：

- `claude`：spawn 系统 `claude` CLI（`--output-format stream-json`，即 Claude Code headless），
  也是注入 MCP server 注册与 `CLAUDE.md` 引导的地方。**注意它不是 ACP，是 CLI 流协议。**
- `codex`：spawn `codex exec --json`。
- `pi`：spawn 系统 `pi --mode rpc`，已有 `parsers/pi-rpc.ts` 解析。

此外代码里还有两处「Claude / ACP」相关物，与面板独立：

- **#2 `HeadlessAcpProvider`**（`electron/acp/headless-provider.ts`，在 `main.ts` 暴露为
  `runClaudeCodeAcpLLM`）：真正的 ACP 适配器（`claude-agent-acp`，由 `binary-manager` 安装），
  但它被当作 **编辑器内部 AI 功能（写稿 / 审稿 / 分析）的 LLM Provider** 使用，**不属于对话面板**。
  `src/types/ai.ts` 的 `LLMProvider.type` 里也有 `claude_code_acp` 一项与之对应。
- **#3 旧 ACP 面板系统**（`electron/acp/connection-registry.ts`、`agent-profiles.ts`、
  `acp/client.ts`、`acp/session.ts`）：旧的持久会话 ACP 面板路径，**已不再接到 live IPC**
  （live IPC 用 `RuntimeRegistry`）。

`pi` 当前是用户自行安装的 `@earendil-works/pi-coding-agent`（纯 Node CLI，`dist/cli.js`，
~151MB 含 node_modules 与跨平台原生预编译；配置在 `~/.pi/agent/`，可通过 `PI_CODING_AGENT_DIR`
整体重定向；原生支持 `--skill` / `--prompt-template` / `--system-prompt` / `--provider` / `--model`）。

### 目标

1. **对话面板只保留 pi，且内置**（无需用户自行安装 pi）。
2. 移除面板里的 `codex` 与 `claude` agent。
3. 保留 **#2 ACP LLM Provider**（编辑器 AI 功能用），不受面板改动影响。
4. 清理 **#3 旧 ACP 面板** 死代码（确认无引用后）。
5. pi 的 provider / skill / 提示词等配置 **预置好、开箱即用**，且适配本视频剪辑软件。
6. 减少多 agent 兼容逻辑，目标单一清晰。

### 非目标

- 不改动 `HeadlessAcpProvider`（#2）的行为或其作为 LLM Provider 的调用链。
- 不引入新的云端密钥网关 / 不在 App 内打包任何模型 key。
- 不改 Remotion / 时间线 / 项目持久化主链路。

## 2. 目标态总览

| 集成 | 处理 |
|---|---|
| `pi` 面板 agent（`agent-runtime`） | **保留 + 内置**，成为唯一面板 agent，从打包的 pi 包运行 |
| `codex` 面板 agent | **移除**（def、parser、UI、测试） |
| `claude` 面板 agent（CLI stream-json） | **移除**（def、parser、UI） |
| `HeadlessAcpProvider` / `runClaudeCodeAcpLLM`（#2） | **保持不动**，与面板独立 |
| 旧 ACP 面板（`connection-registry`、`agent-profiles`、`acp/client.ts`、`acp/session.ts`）（#3） | 确认无引用后 **删除** |
| `binary-manager` | **保留**，`RuntimeRegistry`/detection（`ensureNodeInPath`/`resolveBinary`）与 #2 的 `claude-agent-acp` 安装都还依赖它 |

## 3. 内置与运行时（方案 A：打包 npm 包，用 Electron 自带 Node 运行）

- 在 `resources/pi/` 内置 **裁剪后的** `@earendil-works/pi-coding-agent`（dist + 运行时
  `node_modules`，原生预编译裁剪到要发布的平台；需验证 `--mode rpc` 不强依赖交互式 TUI）。
- **新增 agent-def 能力**：def 可声明「内置 JS 入口」而非 `PATH` 二进制。session/detection 层
  学会用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 启动 `resources/pi/dist/cli.js`，
  而不是 `resolveBinary('pi')`。
- `piAgentDef.buildArgs` 维持 `--mode rpc` 等参数；现有 `parsers/pi-rpc.ts` 原样复用。
- 通过 `PI_CODING_AGENT_DIR` 把 pi 指向 **App 托管的配置目录**（见 §4），pi 不碰用户 `~/.pi`。
- 资源路径解析沿用现有 `agent-skills` 种子模式：`app.getAppPath()` / `process.resourcesPath`
  （dev = 仓库根，打包 = `resources/`）。`package.json` 的打包配置把 `resources/pi` 纳入资源。

### 取舍记录

- 方案 B（首次运行自动 `npm i -g pi` 或 `npx -y pi-acp`）：需要用户机器有 Node/npm + 联网，
  冷启动慢，不是真·开箱即用。**否决。**
- 方案 C（用 bun/pkg 把 pi 编成各平台独立二进制）：单文件、不依赖 Node，但要构建/发布 3 个平台
  二进制、体积大、且 pi 对 skill/extension 的动态 `jiti`/`require` 在打包器下易碎、补丁困难。
  风险高。**否决。**

## 4. App 托管 pi 配置 + Provider 投影

- App 托管目录如 `~/.lingji/pi-agent/`（从 `resources/pi-config/` 种子复制），作为
  `PI_CODING_AGENT_DIR` 传入。
- **Provider 投影层**（新增、纯函数、可单测）：把 App `AISettings.llmProviders[]`
  映射成 pi 的 `models.json`（`{ providers: { ... } }`）：
  - `type` → pi `api`：`openai_compatible` → `openai-completions`，`anthropic` → anthropic，
    `gemini` → google，`lmstudio` / `minimax` → `openai-completions`，
    `claude_code_acp` → 走 #2 / 跳过（不投影成 pi provider）。
  - 透传 `baseUrl` / `apiKey` / `models[]`；并 **补齐 pi 更丰富的每模型 schema**
    （`contextWindow` / `maxTokens` / `reasoning` / `cost` / `compat.*`），给合理默认值，
    并按 pi provider 参数要求 **追加更多参数性配置**。
  - `settings.json` 的 `defaultProvider` / `defaultModel` / `defaultThinkingLevel`
    由 `AISettings.defaultProviderId` / `defaultModel` 推导。
- 在 **连接时**（以及 AI 设置变更时）重新生成，保证「App 的 LLM 配置」始终是唯一真源。
- 可能给 `LLMProvider` 增加少量 **可选** 字段以显式携带 pi 专属参数（共享持久化类型，**高风险**，
  改动必须可选且迁移安全）；缺省时由 `type` 推断。

### 凭证策略

复用 App 现有 `llmProviders` 作为唯一凭证来源 —— 用户在 App AI 设置里配好 provider 后，
pi agent 自动继承，无需另填 key。不在 App 内打包任何模型 key。

## 5. Skill 与提示词预置（开箱即用）

- 复用现有 `agent-skills` 的 `SkillRegistry` 种子 / 注入模式
  （`resources/agent-skills` → `~/.lingji/agent-skills`，经 `--skill <path>` 传给 pi）。
- 预置一套 **适配视频剪辑** 的内容：
  - **skills**：灵机编辑器工作流相关。
  - **prompt-templates**：经 `--prompt-template` 传入。
  - **App 系统提示词**：经 `--append-system-prompt` 注入，教 pi 理解灵机领域与 `lingji_*` MCP 工具。
- 这些种子进 pi 配置目录 / skills 目录，使全新用户开箱即得到一个领域感知的可用 agent
  （唯一需用户提供的是 §4 的凭证）。

## 6. UI 与设置改动

- `AgentPicker`：收敛为 pi 单一（隐藏选择器或固定显示 pi）。
- `AgentIcon`、`agent-presentation.ts`、`ThinkingLevelPicker`、`ChatComposer`、
  `AssistantMessage`：去掉 codex / claude 分支。
- `AgentSettingsTab`：不再 import `agent-profiles` 面板 profile；围绕 pi（模型 / thinking / skills）
  重构；保留 #2 ACP-LLM-Provider 设置（在它原本所在处）。
- `McpSettingsTab`：移除 codex 的 MCP 注册目标；保留 claude_code（#2）及其它。

## 7. 移除与清理清单

- `agent-runtime/agent-defs/codex.ts`、`agent-runtime/agent-defs/claude.ts` 及 `registry.ts`
  的引用。
- `agent-runtime/parsers/codex-json-event.ts`、`parsers/claude-stream.ts`（确认无其它引用后）。
- `acp/ipc.ts` 里仅服务 codex / claude 的分支（如 `agentId === 'claude'` 的 MCP / `CLAUDE.md`
  逻辑 —— 需评估：写 `CLAUDE.md` 引导是否要迁移到 pi 路径，见 §9 开放问题）。
- #3 旧 ACP 面板：`connection-registry.ts`、`agent-profiles.ts`、`acp/client.ts`、
  `acp/session.ts` —— **删除前逐一确认无 live 引用**（尤其 `AgentSettingsTab` 对
  `agent-profiles` 的 import、`preflight.ts`、`config.ts`）。
- **保留** `binary-manager.ts`、`headless-provider.ts`、`fetch-agent-api-models.ts` 等 #2 / 运行时
  仍依赖的文件。

## 8. 测试与验证

- 更新 / 精简引用 codex/claude def 的测试：`tests/tool-call-descriptor.test.ts`、
  `tests/tool-call-block.test.tsx`、`tests/tool-group-block.test.tsx`、
  `tests/assistant-message.test.tsx`、`tests/agent-runtime/registry.test.ts`、
  `tests/agent-runtime/list-agent-models.test.ts`、`tests/agent-runtime/session.test.ts`。
- 新增单测：
  - Provider 投影（App `LLMProvider` → pi `models.json`，含各 `type` 映射与默认补齐）。
  - 内置 JS 入口的 spawn 解析（Electron Node 路径 / `ELECTRON_RUN_AS_NODE`）。
  - 配置目录种子与 `PI_CODING_AGENT_DIR` 注入。
- 冒烟：`npm test`；用打包的 pi 包经 Electron Node 跑一次 `--mode rpc` 往返；
  打包/资源改动跑 `npm run build`。

## 9. 风险与开放问题

- pi `--mode rpc` 是否在启动时硬 import 原生 TUI / clipboard → 需验证并按平台打包最小预编译。
- `LLMProvider` 是共享持久化类型，新增字段必须可选 + 迁移安全。
- 内置 pi 的版本固定与升级策略（如何更新打包副本）。
- 删除 #3 旧 ACP 面板前，需确认 `AgentSettingsTab` / `preflight.ts` / `config.ts` 等无残留引用。
- `claude` agent 移除后，原本「仅对 claude 写 `CLAUDE.md` MCP 引导 + 注册 MCP server」的逻辑
  归属：是否迁移给 pi（让 pi 也能用 `lingji_*` MCP 工具）—— 倾向迁移，使 pi 成为完整面板 agent；
  实现计划阶段确认。
- pi 体积裁剪边界（哪些 node_modules / 预编译可安全移除而不影响 `--mode rpc` + skill 加载）。

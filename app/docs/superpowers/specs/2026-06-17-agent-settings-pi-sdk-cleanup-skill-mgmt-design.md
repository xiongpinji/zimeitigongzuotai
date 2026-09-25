# Agent 设置瘦身（pi SDK 化）+ 模型 provider 对齐 + Skill 管理

日期：2026-06-17
分支：feat/lingji-cli

## 背景

pi 已从「多 agent + 外部 CLI / ACP」收敛为单一内置 **pi** agent（vendored `@earendil-works/pi-coding-agent`，通过 Electron Node 以 `--mode rpc` 启动）。pi 的模型 / 凭证不再来自 Agent 自己的配置，而是由 `AISettings.llmProviders` 投影成 `~/.lingji/pi-agent/{models,settings}.json`（`electron/agent-runtime/pi-config-seed.ts` + `pi-provider-projection.ts`，连接时在 `electron/acp/ipc.ts:92-119` 写入）。

后果：

1. 设置中心 Agent 面板里大量字段（订阅 / API Key / Base URL / 安装卸载 / 多 agent 选择）已对 pi 失效，是上一代多 agent 的死配置。
2. 会话模型下拉吃的是写死的 `PI_FALLBACK_MODELS`（`electron/agent-runtime/agent-defs/pi.ts:49-57`），与用户真实配置的 `llmProviders[].models` 脱节——"没按 provider 模式写"。
3. Skill 能力大部分已存在（`$` 补全、SkillRegistry、注入、逐 skill 开关），但缺「用户自行添加 skill 库」入口、`+` 触发符、真实状态检测。

## 目标

- 剔除 pi SDK 化后失效的 Agent 配置字段与 UI。
- 会话模型 / 思考深度按 provider 模式对齐：模型下拉来源于 `llmProviders`，默认随 `defaultProviderId/defaultModel`，会话级可覆盖。
- 把 Skill 从「单个内置 + 简单开关」升级为可管理的 skill 库：列出全部、用户本地文件夹导入、启用/禁用/删除、对话中 `$`/`+` 选择。

## 非目标

- 不扩充内置 skill 数量（仍只有 `lingji-video-workflow`），只把 registry/UI 改造成支持多 skill。
- 不做 git / zip 导入（仅本地文件夹），后续可加。
- 不动 pi 投影管线本身的 provider 类型映射逻辑。
- 不恢复 claude/codex/ACP 多 agent。

---

## Part A — Agent 设置瘦身 + provider 对齐

### A1. 剔除死字段

类型层 `electron/acp/types.ts` 的 `AgentEntry`，移除：

- `authMode`、`apiKey`、`apiBaseUrl`（pi 凭证走 `llmProviders` 投影）。
- `model`（会话模型改由 provider 列表驱动，不再逐 agent 持久化文本模型）。
- `configJson`、`envText`。

持久化层 `electron/acp/config.ts`：

- `makeDefaultEntry` 同步去掉上述字段。
- 移除 `~/.lingji/<agentId>.key` 加密读写与 `agent:set-api-key` IPC（`electron/acp/ipc.ts`、`preload.ts`、`src/lib/agent-api.ts` 三件套同步）。
- 旧 `agent-config.json` 里残留的死字段：load 时静默忽略即可，无需迁移搬运。

UI 层 `src/components/settings/AgentSettingsTab.tsx`，移除：

- authMode PillGroup、API Key 输入（含 Eye/EyeOff 显隐）、API Base URL 输入。
- model 文本输入。
- 安装引导文案、managed 判断、安装 / 卸载按钮。
- preflight 状态检查区块（`agent:run-preflight` 调用点；IPC handler 是否保留见 A4）。
- agent 多选 PillGroup 与「设为当前」按钮：只剩 pi，面板直接呈现 pi，不再做选择交互。

### A2. 会话模型按 provider 对齐（方案 B）

- 会话模型下拉（`ChatPane` / `MessageInput` 的 model selector）数据源：`AISettings.llmProviders` 展开为 `{ providerId, model }` 列表，label 形如 `模型名（providerName）`。
- 传给 pi 的 `--model` 值，必须与 `pi-provider-projection.ts` 写入 `models.json` 的 key 规则**完全一致**（即 pi 端能识别的 provider/model 标识）。这是本节的关键约束：UI 列出的 value = 投影产物的 key，避免传了 pi 不认的模型。
- 默认选中：`defaultProviderId` + `defaultModel`。
- 会话级覆盖：沿用现有 `ChatPane.selectedModel` → `opts.model` → `runtimeRegistry.connect/sendPrompt`，不持久化到 `agent-config.json`。
- `PI_FALLBACK_MODELS`：仅在「一个可投影 provider 都没配」时作为兜底占位（提示用户去配 provider），不再作为正常 UI 数据源。`agent:list-models` IPC 的语义相应调整或由 renderer 直接读 `llmProviders`（实现期二选一，spec 不锁定）。

### A3. 思考深度按会话级保留

- 去掉 `buildPiSettingsJson`（`pi-provider-projection.ts`）里写死的 `defaultThinkingLevel: 'medium'`：不再注入硬编码默认，交给 pi 自身默认。
- 会话级 reasoning 选择器保留（`ChatPane.selectedReasoning` → `opts.reasoning` → `--thinking`），选项沿用 `piAgentDef.reasoningOptions`。

### A4. preflight 取舍

- UI 的 preflight 区块剔除。
- 主进程对「pi 入口 `resources/pi/dist/cli.js` 是否存在」的健壮性检查保留在连接路径内部（连接失败给明确错误），不再作为设置面板的独立交互。

---

## Part B — Skill 管理

### B0. 现状（保留，不重写）

- `electron/agent-skills/registry.ts`：`SkillRegistry` 扫描 `~/.lingji/agent-skills/`、解析 SKILL.md frontmatter、`ensureBundled/list/resolveForAgent/readSkillMarkdown`。
- `electron/agent-skills/inject.ts` + `electron/acp/ipc.ts` `maybeInjectSkills`：两段式校验 + SKILL.md 注入。
- `MessageInput.tsx`：`$` 补全菜单（检测、导航、回填）已可用。
- pi 端 `--skill <rootPath>`（可重复）。

### B1. AgentSkillDefinition 增加来源

- `source: 'builtin'` → `source: 'builtin' | 'user'`（`electron/acp/types.ts`）。
- 内置 skill 仍从 `resources/agent-skills/` seed；用户 skill 落 `~/.lingji/agent-skills/<id>` 并标 `source: 'user'`。来源判定：是否存在于 seed 目录。

### B2. 真实状态检测

- `resolveForAgent` 中 `status` 不再写死 `'available'`：按 `<rootPath>/SKILL.md` 是否存在 / 可解析产出 `available | missing | error`，`error` 带原因。

### B3. 用户本地文件夹导入

新增 IPC（main / preload / `src/lib/agent-api.ts` 三件套同步）：

- `agent:add-skill`（参数：用户选定的源文件夹路径）：
  - 用 Electron `dialog.showOpenDialog`（`properties: ['openDirectory']`）在 renderer 触发选目录。
  - 校验源目录含 `SKILL.md` 且 frontmatter 可解析出 `name`；id 取 frontmatter `name`（kebab）或目录名，去重（已存在则报冲突，不静默覆盖内置）。
  - 复制到 `~/.lingji/agent-skills/<id>`，重扫，返回更新后的 skill 列表。
- `agent:remove-skill`（参数：skillId）：仅允许删除 `source: 'user'`；删除目录后重扫。内置不可删（UI 禁用删除）。

### B4. 设置面板：Skill 库管理

`AgentSettingsTab.tsx` 的 Skills 区升级为列表：

- 每项展示：名称、描述、来源标签（内置 / 用户）、状态（可用 / 缺失 / 配置错误）、启用开关。
- 用户项额外有「删除」操作；内置项删除禁用。
- 顶部「添加 skill 库…」按钮 → `agent:add-skill`。
- 启用/禁用沿用现有 `AgentEntry.skills`（`AgentSkillConfig[]`）持久化与 `toggleSkill`。

### B5. 对话触发：补 `+`

- `MessageInput.tsx`：在现有 `$` 检测正则与触发逻辑旁，增加 `+` 作为等价触发符，弹同一 skill 菜单、走同一 `handleSkillSelect`。
- 回填仍以 `$id ` 形式写入文本（保持 `parseSkillTokens` 的 `$` 协议不变），即 `+` 仅是「打开菜单」的额外入口，选中后落地的 token 仍是 `$id`。

---

## 数据流（对齐后）

```
AI Provider 设置 (llmProviders, defaultProviderId/Model, enableThinking)
        │  投影
        ▼
~/.lingji/pi-agent/{models,settings}.json  ──┐
                                              ├─► pi 进程 (--model / --thinking / --skill)
会话 UI (selectedModel/reasoning, $+skill) ───┘
        │ model 选项来源 = llmProviders 展开（与投影 key 对齐）
        │ skill 来源 = SkillRegistry.list()（内置 + 用户）
```

## 影响面 / 三件套

- IPC 三件套（`electron/acp/ipc.ts` + `electron/preload.ts` + `src/lib/agent-api.ts`）：删 `agent:set-api-key`、（视实现）调整 `agent:list-models`、新增 `agent:add-skill` / `agent:remove-skill`。
- 共享类型：`electron/acp/types.ts` 的 `AgentEntry`、`AgentSkillDefinition.source`、`AgentSkillStatus` 使用。
- 投影：`pi-provider-projection.ts` 去 `defaultThinkingLevel` 硬编码。
- UI：`AgentSettingsTab.tsx`、`MessageInput.tsx`、`ChatPane.tsx`。

## 测试与验证

- 单测：`SkillRegistry` 多 skill 扫描 / 来源判定 / 状态检测 / add-remove；`parseSkillTokens` 不受 `+` 入口影响。
- provider→pi 投影：model 列表 key 与 `--model` 值一致性的单测（防漂移）。
- 手验：无 provider 时下拉兜底提示；配 MiniMax 后下拉只出 MiniMax 模型；导入一个本地 skill 文件夹后出现在列表且 `$`/`+` 可选中并注入；删除用户 skill；内置不可删。
- 回归：旧 `agent-config.json`（带 authMode/apiKey 等死字段）能正常加载、死字段被忽略、不崩。

## 开放项 / 风险

- `agent:list-models` 是否保留：若 renderer 直接读 `llmProviders` 更简单，可废弃该 IPC；实现期定。
- pi 投影 key 规则需在实现前核实 `pi-provider-projection.ts` 实际写出的 provider/model 形态，确保 UI value 完全对齐。

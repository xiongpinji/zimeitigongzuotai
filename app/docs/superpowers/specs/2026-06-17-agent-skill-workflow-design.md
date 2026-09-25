# Agent Skill Workflow 内置与调用设计

## 背景

灵机剪影已经具备多协议 Agent Runtime：Claude、Codex、Pi 可通过统一的会话入口连接到项目工作区。项目也已经沉淀了 `lingji-video-workflow` 用户级 skill，用于把稿件项目推进到灵机剪影视频项目，并覆盖文稿编辑、MCP/App 生成协作、时间线与 Motion Card 精修。

本设计把该 workflow 内置到应用中，并让应用内 AI Agent 通过统一配置和 `$skill` 显式调用使用它。首期选择“配置中心可开关 + `$` 补全 + 本轮 prompt 注入 + agent 加载方式透明展示”的方案。

## 目标

1. 应用首次运行时把内置 `lingji-video-workflow` skill 复制到用户应用配置目录。
2. 所有 agent 都从同一个用户配置目录读取 skills，避免开发态与打包态路径分叉。
3. 配置中心在每个 agent 下展示 Skills 列表，首期只暴露 `$lingji-video-workflow`。
4. Skills 默认启用，可按 agent 手动关闭。
5. 对话输入 `$` 时补全启用的 skills；用户选择后插入 `$lingji-video-workflow`。
6. 用户显式输入 `$lingji-video-workflow` 时，本轮注入该 skill 的主 `SKILL.md`。
7. Pi 使用原生 `--skill <path>` 加载；Codex/Claude 通过 prompt 注入和上下文引导获得一致用户体验。
8. 配置中心显示每个 agent 的加载方式，明确区分原生加载、目录访问、prompt 注入和上下文文件引导。

## 非目标

- 首期不支持用户添加/删除外部 skill 目录。
- 首期不暴露 `lingji-script-edit`、`lingji-video-edit` 等局部 skill 名称；它们作为 `lingji-video-workflow` 的 references 能力存在。
- 首期不做用户级 skill 覆盖内置 skill。
- 首期不自动注入 references 全文。
- 首期不在消息流里展示“本轮使用了哪些 skills”的运行态标签。
- 首期不要求所有 agent 都具备相同底层原生 skill 机制；要求用户体验尽量一致，并透明标注底层差异。

## 用户配置目录

运行时统一读取用户应用配置目录：

```text
~/.lingji/agent-skills/
  lingji-video-workflow/
    SKILL.md
    agents/openai.yaml
    references/
      mcp-workflow.md
      script-editing.md
      video-editing.md
```

应用包内保留一份只读种子：

```text
resources/agent-skills/lingji-video-workflow/
```

打包脚本必须把 `resources/agent-skills/` 带入应用资源目录。开发态和生产态只在“种子目录解析”上有差异；复制完成后，runtime、配置中心和 composer 都统一读取 `~/.lingji/agent-skills/`。

初始化规则：

1. main 侧提供 `ensureBundledAgentSkills()`。
2. 启动 Agent 配置、连接 runtime、或查询 skill 列表前，先确保该函数执行。
3. 若 `~/.lingji/agent-skills/lingji-video-workflow/SKILL.md` 不存在，则从应用内置资源复制整个目录到用户配置目录。
4. 若用户配置目录已存在该 skill，首期不覆盖，避免破坏用户本地调整。
5. 后续可另做“恢复内置版本”或“升级内置版本”，但首期不自动覆盖。

## 数据模型

新增结构化 skill 定义：

```ts
export type AgentSkillLoadMode =
  | 'native'
  | 'prompt_injection'
  | 'context_file'
  | 'directory_access';

export interface AgentSkillDefinition {
  id: string;
  displayName: string;
  description: string;
  source: 'builtin';
  rootPath: string;
  skillFilePath: string;
  defaultEnabled: boolean;
  loadModesByAgent: Record<string, AgentSkillLoadMode[]>;
}

export interface AgentSkillConfig {
  id: string;
  enabled: boolean;
}

export interface ResolvedAgentSkill extends AgentSkillDefinition {
  enabled: boolean;
}
```

扩展现有 `AgentEntry`：

```ts
export interface AgentEntry {
  enabled: boolean;
  authMode: AuthMode;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  envText: string;
  configJson: string;
  version: string;
  sortOrder: number;
  skills?: AgentSkillConfig[];
}
```

默认配置：

- `ensureDefaultAgents()` 保持向后兼容。
- 对 `claude`、`codex`、`pi` 补齐 `{ id: 'lingji-video-workflow', enabled: true }`。
- 旧配置无 `skills` 时自动补默认值。
- 未知 skill id 在解析时忽略，并保留配置文件原值以避免未来兼容问题。

## Skill Registry

新增 main 侧 registry，职责保持单一：

- 确保内置 skill 已复制到用户配置目录。
- 读取 `SKILL.md` frontmatter 和 `agents/openai.yaml`。
- 返回 `AgentSkillDefinition[]`。
- 按 agent id 和配置返回 enabled skills。
- 读取主 `SKILL.md` 内容用于 `$skill` prompt 注入。
- 校验 skill 路径是否存在、`SKILL.md` 是否存在、frontmatter 是否可解析。

Renderer 不直接拼文件路径，也不读取 skill 文件内容；它只通过 `window.agentAPI.listSkills()` 获取可展示的元数据。`SKILL.md` 内容读取和 prompt 注入只发生在 main 侧。

## IPC 与前端 API

扩展 `window.agentAPI`：

```ts
listSkills(agentId: string): Promise<ResolvedAgentSkill[]>;
```

扩展发送 prompt 的 opts：

```ts
sendPromptToConversation(
  conversationId: number,
  contents: PromptInputBlock[],
  opts?: {
    model?: string;
    reasoning?: string;
    skillIds?: string[];
  },
): Promise<void>;
```

安全规则：

- Renderer 传入的 `skillIds` 仅作为请求。
- Main 侧必须二次校验 skill 是否存在、当前 agent 是否启用、路径是否在 `~/.lingji/agent-skills/` 下。
- 未启用或不存在的 skill 不注入。
- skill 内容读取失败时发 warning/error 事件给 renderer，并继续发送用户原始消息。

## `$skill` 对话流程

1. Composer 根据当前 agent 调用 `listSkills(agentId)`。
2. 输入 `$` 时弹出补全菜单，仅展示当前 agent 启用的 skills。
3. 首期补全项为 `$lingji-video-workflow`，展示名为“灵机剪影视频工作流”，并显示简短说明。
4. 用户选择后插入 `$lingji-video-workflow`。
5. 发送前 renderer 从文本中解析 `$skill-id`，生成去重后的 `skillIds`。
6. `skillIds` 随 `sendPromptToConversation` opts 传给 main。
7. Main 读取对应 `SKILL.md`，将内容拼接到本轮 prompt 前部。

注入模板：

```text
The user explicitly invoked these skills:
$lingji-video-workflow

Follow the SKILL.md instructions below. Load referenced files only when needed.

--- skill: lingji-video-workflow ---
<SKILL.md content>
--- end skill ---

User message:
<original prompt>
```

只注入主 `SKILL.md`，不注入 references 全文。References 仍按 skill 的 progressive disclosure 规则由 agent 按需读取。

如果用户未显式输入 `$skill`：

- Pi 仍可通过原生 `--skill` 自动发现和触发已启用 skill。
- Codex/Claude 不默认每轮注入 skill 全文，避免 token 膨胀。
- 项目上下文文件中提供轻量提示，告知用户可输入 `$lingji-video-workflow` 显式调用。

## Runtime 适配

扩展 runtime 输入：

```ts
interface RuntimeConnectInput {
  conversationId: number;
  agentType: string;
  projectDir: string;
  model?: string;
  sessionId?: string | null;
  env?: Record<string, string>;
  permissionPolicy?: string;
  skills?: ResolvedAgentSkill[];
}

interface AgentSessionStartInput {
  // existing fields...
  skills?: ResolvedAgentSkill[];
}

interface BuildArgsCtx {
  // existing fields...
  skills?: ResolvedAgentSkill[];
}
```

连接阶段：

1. `connectRuntime` 读取 agent 配置。
2. 调用 registry 得到当前 agent 启用的 resolved skills。
3. 将 resolved skills 存入 `RuntimeRegistry` 的 context entry。
4. 每轮 `sendPrompt` 时传给 `AgentSession.start()` 和 agent `buildArgs()`。

Pi：

- 对每个 enabled skill 追加：

```bash
--skill ~/.lingji/agent-skills/lingji-video-workflow
```

- Pi help 已确认 `--skill <path>` 可重复使用，未来多 skill 可自然扩展。

Codex：

- 当前 Codex CLI 未暴露 `--skill` 参数。
- 首期对 enabled skill 目录追加：

```bash
--add-dir ~/.lingji/agent-skills/lingji-video-workflow
```

- 真正的 skill 指令通过 `$skill` prompt 注入。

Claude：

- 不使用原生 skill 参数。
- `$skill` 显式调用时注入 `SKILL.md`。
- 连接项目时继续写入 `CLAUDE.md` 和 file-first 契约，并补充可用 `$lingji-video-workflow` 的说明。

配置中心加载方式显示：

- Pi：原生加载 + `$` 显式注入。
- Codex：目录访问 + `$` 显式注入。
- Claude：上下文文件引导 + `$` 显式注入。

## 设置页设计

在现有 `AI Agent` 设置页中，模型和高级配置之间新增 “Skills” section。

首期内容：

- 列表项：`lingji-video-workflow`
- 显示名：灵机剪影视频工作流
- 状态开关：启用/关闭
- 来源：内置
- 路径：`~/.lingji/agent-skills/lingji-video-workflow`
- 加载方式：按当前 agent 展示，例如“原生加载 + $显式注入”
- 状态：可用 / 缺失 / 配置错误

交互规则：

- 关闭 skill 后，该 agent 的 composer 不再补全 `$lingji-video-workflow`。
- 关闭 skill 后，即使用户手写 `$lingji-video-workflow`，main 侧也不注入内容，并可返回 warning。
- 保存配置沿用现有“保存配置”按钮。
- 初始化复制失败时，设置页显示错误状态和简短恢复建议。

## 项目上下文引导

现有 `ensureProjectAgentContracts()` 会写入 `CLAUDE.md`、`AGENTS.md`、`GEMINI.md` 的 file-first 契约。首期扩展该 block，追加一个短段落：

```md
### 可用内置工作流

本应用提供内置 `$lingji-video-workflow`。当用户希望从稿件推进到灵机剪影视频，或需要协调文稿、生成、时间线、Motion Card 精修时，优先使用该 workflow。用户也可以在对话中显式输入 `$lingji-video-workflow`。
```

这只是发现引导，不替代 `$skill` prompt 注入。

## 错误处理

- 内置种子目录缺失：`listSkills` 返回空列表并记录主进程日志；设置页显示“内置 skill 种子缺失”。
- 用户配置目录复制失败：设置页显示失败，runtime 不传该 skill。
- `SKILL.md` 缺失：skill 状态为缺失，composer 不补全。
- `$skill` 未启用：本轮不注入，renderer 可显示 warning。
- `SKILL.md` 读取失败：不中断用户消息发送，发 error 事件提示用户。
- Pi `--skill` 路径失效：预检给出 warning，运行时仍允许发送，但不声称 skill 已加载。
- Codex `--add-dir` 不支持或失败：按现有 CLI 错误流返回，不额外吞错。

## 测试策略

单元测试：

- `ensureBundledAgentSkills()` 在目标缺失时复制目录。
- 目标已存在时不覆盖用户文件。
- Registry 能解析 `lingji-video-workflow` 的元数据和 `SKILL.md`。
- `ensureDefaultAgents()` 给三类 agent 补默认 skill 配置。
- Pi `buildArgs()` 对 enabled skills 生成 `--skill <path>`。
- Codex `buildArgs()` 对 enabled skills 生成 `--add-dir <path>`。
- `$skill` 解析能去重并忽略未知 id。
- Main 侧注入逻辑只接受当前 agent 启用的 skill。

组件测试：

- Agent 设置页显示 Skills section。
- Skill 开关变更后能保存并恢复。
- Composer 输入 `$` 时展示当前 agent 启用 skill。
- 关闭 skill 后补全项消失。

集成/手动验证：

- 删除 `~/.lingji/agent-skills/lingji-video-workflow` 后启动应用，确认自动复制。
- PI 会话启动参数包含 `--skill ~/.lingji/agent-skills/lingji-video-workflow`。
- Codex 会话启动参数包含 `--add-dir ~/.lingji/agent-skills/lingji-video-workflow`。
- 发送包含 `$lingji-video-workflow` 的消息，确认 prompt 注入主 `SKILL.md`。
- 发送不含 `$skill` 的普通消息，确认 Codex/Claude 不注入全文。

## 迁移与兼容

- 旧 `~/.lingji/agent-config.json` 无 `skills` 字段时自动补默认配置。
- 保存配置后写入 `skills` 字段。
- 不迁移用户级 `~/.codex/skills/lingji-video-workflow`；它只作为本次设计前的来源，不作为运行时依赖。
- 用户配置目录中的 skill 文件一旦存在，首期不自动覆盖。

## 交付验收

1. 新安装或清空用户 skill 目录后，应用自动生成 `~/.lingji/agent-skills/lingji-video-workflow`。
2. 配置中心三类 agent 下都能看到 `lingji-video-workflow` skill，并能启用/关闭。
3. 配置中心显示每个 agent 的加载方式。
4. 对话输入 `$` 能补全 `$lingji-video-workflow`。
5. 显式 `$lingji-video-workflow` 会让本轮 prompt 注入主 `SKILL.md`。
6. PI 启动时传入 `--skill`。
7. Codex 启动时传入 `--add-dir`。
8. 关闭某 agent 的 skill 后，该 agent 不再补全，也不会注入该 skill。
9. References 不被默认全文注入。
10. 现有 agent 会话、模型选择、reasoning 切换和权限策略不回归。

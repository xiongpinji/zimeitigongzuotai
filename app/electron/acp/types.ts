// ─── JSON-RPC 2.0 基础 ───────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ─── ACP 协议消息 ────────────────────────────────────────────

// Client → Agent

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities: {
    terminal: boolean;
    fs: {
      readTextFile: boolean;
      writeTextFile: boolean;
    };
  };
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: {
    promptCapabilities?: {
      image?: boolean;
      embeddedContext?: boolean;
    };
    loadSession?: boolean;
    sessionCapabilities?: {
      fork?: Record<string, unknown>;
      list?: Record<string, unknown>;
      resume?: Record<string, unknown>;
      close?: Record<string, unknown>;
    };
  };
  agentInfo?: {
    name?: string;
    title?: string;
    version?: string;
  };
  // 兼容旧字段
  serverCapabilities?: {
    prompting?: {
      modes?: AgentMode[];
      configOptions?: ConfigOption[];
    };
    fork?: boolean;
  };
}

export interface AgentMode {
  modeId: string;
  name: string;
  description?: string;
}

export interface ConfigOption {
  configId: string;
  name: string;
  description?: string;
  values: ConfigOptionValue[];
}

export interface ConfigOptionValue {
  valueId: string;
  name: string;
}

export interface NewSessionParams {
  cwd: string;
}

export interface NewSessionResult {
  sessionId: string;
  models?: {
    availableModels: { modelId: string; name: string; description?: string }[];
    currentModelId: string;
  };
  modes?: {
    currentModeId: string;
    availableModes: { id: string; name: string; description?: string; decription?: string }[];
  };
  configOptions?: ConfigOption[];
}

export interface LoadSessionParams {
  sessionId: string;
  cwd: string;
  mcpServers?: unknown[];
}

export interface PromptParams {
  sessionId: string;
  prompt: PromptInputBlock[];
}

export interface SetSessionModeParams {
  sessionId: string;
  modeId: string;
}

export interface SetSessionConfigOptionParams {
  sessionId: string;
  configId: string;
  valueId: string;
}

// Agent → Client (请求)

export interface RequestPermissionParams {
  toolCall: unknown;
  options: PermissionOption[];
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export interface ReadTextFileParams {
  path: string;
}

export interface WriteTextFileParams {
  path: string;
  content: string;
}

export interface CreateTerminalParams {
  cwd?: string;
}

export interface TerminalExecuteParams {
  terminalId: string;
  command: string;
}

export interface KillTerminalParams {
  terminalId: string;
}

// ─── 流式事件（Agent → Client 通知）──────────────────────────

export type AcpEvent =
  | SessionStartedEvent
  | ContentDeltaEvent
  | ThinkingEvent
  | ToolCallEvent
  | ToolCallUpdateEvent
  | TurnCompleteEvent
  | PermissionRequestEvent
  | UsageEvent;

export interface SessionStartedEvent {
  type: 'session_started';
  sessionId: string;
}

export interface ContentDeltaEvent {
  type: 'content_delta';
  text: string;
  sessionId?: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  text: string;
  sessionId?: string;
}

export interface ToolCallEvent {
  type: 'tool_call';
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  content?: string;
  rawInput?: string;
  rawOutput?: string;
  sessionId?: string;
}

export interface ToolCallUpdateEvent {
  type: 'tool_call_update';
  toolCallId: string;
  title?: string;
  status?: string;
  content?: string;
  rawInput?: string;
  rawOutput?: string;
  rawOutputAppend?: boolean;
  sessionId?: string;
}

export interface TurnCompleteEvent {
  type: 'turn_complete';
  sessionId: string;
  stopReason: string;
  agentType: string;
  usage?: { used: number; size: number };
}

export interface UsageEvent {
  type: 'usage';
  used: number;
  size: number;
  sessionId?: string;
}

export interface PermissionRequestEvent {
  type: 'permission_request';
  requestId: string;
  toolCall: unknown;
  options: PermissionOption[];
  sessionId?: string;
}

// ─── Prompt 输入 ─────────────────────────────────────────────

export type PromptInputBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; uri?: string }
  | { type: 'resource'; uri: string; mimeType?: string; text?: string; blob?: string };

// ─── 连接状态 ────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'prompting' | 'error';

// ─── 斜杠命令 ──────────────────────────────────────────────

export interface AvailableCommand {
  name: string;
  description: string;
  input?: { hint?: string } | null;
}

// ─── ACP 配置选项（session/new 实际返回格式）────────────────

export interface AcpConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: 'select';
  currentValue: string;
  options: AcpConfigOptionValue[];
}

export interface AcpConfigOptionValue {
  value: string;
  name: string;
  description?: string;
}

// ─── 配置 ────────────────────────────────────────────────────

export type PermissionPolicy = 'auto_approve' | 'tiered' | 'always_ask';
export type AuthMode = 'subscription' | 'custom_api';

export interface AgentConfigData {
  agents: Record<string, AgentEntry>;
  permissionPolicy: PermissionPolicy;
  /**
   * 全局当前激活 / 默认 agent id（claude/codex/pi）。
   * 全局只允许使用一个 agent；新建会话用此 id。缺省（旧数据）回退默认 'claude'。
   */
  activeAgentId?: string;
}

// ─── Agent Skills ────────────────────────────────────────────

export type AgentSkillLoadMode =
  | 'native'
  | 'prompt_injection'
  | 'context_file'
  | 'directory_access';

export type AgentSkillStatus = 'available' | 'missing' | 'error';

/** skill 的静态定义（来自 frontmatter + openai.yaml）。 */
export interface AgentSkillDefinition {
  id: string;
  displayName: string;
  description: string;
  /** 'builtin'：随 App 种子分发；'user'：用户从本地文件夹导入。 */
  source: 'builtin' | 'user';
  /** skill 根目录绝对路径（~/.lingji/agent-skills/<id>）。 */
  rootPath: string;
  /** 主 SKILL.md 绝对路径。 */
  skillFilePath: string;
  defaultEnabled: boolean;
  /** 各 agent 的加载方式（用于配置中心展示）。 */
  loadModesByAgent: Record<string, AgentSkillLoadMode[]>;
}

/** 持久化在 AgentEntry.skills 中的逐 agent 开关。 */
export interface AgentSkillConfig {
  id: string;
  enabled: boolean;
}

/** listSkills 返回：定义 + 当前 agent 的启用态与可用状态。 */
export interface ResolvedAgentSkill extends AgentSkillDefinition {
  enabled: boolean;
  status: AgentSkillStatus;
  /** status 非 available 时的简短原因。 */
  error?: string;
}

/** skill 详情模态用的目录树节点（相对 skill 根目录）。 */
export interface SkillTreeNode {
  name: string;
  /** 相对 skill 根目录的 POSIX 路径；根节点为 ''。 */
  relPath: string;
  isDir: boolean;
  /** 仅目录有；按「目录在前、名称字典序」排序。 */
  children?: SkillTreeNode[];
}

/** skill 详情模态用的单文件内容（已做大小 / 二进制保护）。 */
export interface SkillFileContent {
  relPath: string;
  size: number;
  /** 二进制（含图片）→ 不返回 text，前端展示「不可预览」。 */
  binary: boolean;
  /** 文本超过上限 → text 为截断片段，truncated=true。 */
  truncated: boolean;
  text?: string;
}

export interface AgentEntry {
  enabled: boolean;
  version: string;
  sortOrder: number;
  /** 逐 agent 的内置 skill 开关；旧数据缺省由 ensureDefaultAgents 补默认。 */
  skills?: AgentSkillConfig[];
  /**
   * 以下字段为上一代多 agent（订阅 / 自定义 API 凭证、本地 CLI 模型）遗留，
   * pi SDK 化后已不再由设置中心写入：pi 的模型/凭证统一走 AISettings.llmProviders
   * 投影。保留为可选，仅用于读取旧 agent-config.json 时不丢数据（不再产生新值）。
   * @deprecated pi SDK 模式下失效，勿在新代码消费。
   */
  authMode?: AuthMode;
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  envText?: string;
  configJson?: string;
}

// ─── 预检 ────────────────────────────────────────────────────

export type PreflightStatus = 'pass' | 'fail' | 'warn' | 'checking';
export type PreflightFixAction = 'install' | 'upgrade' | 'uninstall' | 'clear_cache';

export interface PreflightCheck {
  label: string;
  status: PreflightStatus;
  message: string;
  fixAction?: PreflightFixAction;
}

// ─── 工具函数 ────────────────────────────────────────────────

export function isJsonRpcResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && ('result' in msg || 'error' in msg) && !('method' in msg);
}

export function isJsonRpcRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'id' in msg && 'method' in msg && !('result' in msg) && !('error' in msg);
}

export function isJsonRpcNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

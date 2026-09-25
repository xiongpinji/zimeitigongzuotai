import type {
  AgentConfigData,
  AgentMode,
  ConfigOption,
  ConnectionStatus,
  PermissionOption,
  PermissionPolicy,
  PreflightCheck,
  PromptInputBlock,
  ResolvedAgentSkill,
  SkillFileContent,
  SkillTreeNode,
} from '../../electron/acp/types';
import type { AgentModel } from '../../electron/agent-runtime/types';

/** 动态模型列表结果（与 main 侧 listAgentModels 对齐）。 */
export interface AgentModelList {
  models: AgentModel[];
  source: 'live' | 'fallback';
}

// ─── 前端使用的消息类型 ────────────────────────────────────

export type ContentBlock =
  | {
      type: 'session_started';
      sessionId: string;
    }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool_call';
      toolCallId: string;
      title: string;
      kind: string;
      status: string;
      rawInput?: string;
      rawOutput?: string;
    }
  | {
      type: 'tool_call_update';
      toolCallId: string;
      title?: string;
      status?: string;
      rawInput?: string;
      rawOutput?: string;
      rawOutputAppend?: boolean;
    }
  | {
      type: 'turn_complete';
      stopReason: string;
    }
  | {
      type: 'permission_request';
      requestId: string;
      toolCall: unknown;
      options: PermissionOption[];
    }
  | {
      type: 'file_changed';
      path: string;
      before: string | null;
      after: string;
    }
  | {
      type: 'error';
      message: string;
    };

export interface AgentCapabilities {
  modes: AgentMode[];
  configOptions: ConfigOption[];
  forkSupported: boolean;
}

// ─── AgentAPI 接口（window.agentAPI）────────────────────────
//
// 只包含两类 API：
//   1. 全局配置 / 预检 / 安装管理 —— 和单个会话无关
//   2. Per-conversation runtime —— 多会话架构的唯一入口
//
// 历史上的"单例 ACP 连接" API（connect/disconnect/getStatus/sendPrompt/
// cancelTurn/setMode/setConfigOption/respondPermission/onStatusChanged/
// onEvent/onCapabilities）已经在多会话迁移中彻底移除。

export interface AgentAPI {
  // 设置
  getConfig(): Promise<AgentConfigData>;
  saveConfig(data: AgentConfigData): Promise<void>;
  /** 立即持久化全局激活 agent（新建会话据此决定 agentType）。 */
  setActiveAgent(agentId: string): Promise<void>;
  getApiKey(agentId: string): Promise<string>;
  setApiKey(agentId: string, key: string): Promise<void>;
  getPermissionPolicy(): Promise<PermissionPolicy>;
  setPermissionPolicy(policy: PermissionPolicy): Promise<void>;

  // 预检与安装
  runPreflight(agentId?: string): Promise<PreflightCheck[]>;
  /** 拉取某 agent 的可选模型列表（pi 走 `pi --list-models`，失败回退兜底）。 */
  listModels(agentId: string): Promise<AgentModelList>;
  installAgent(version: string): Promise<void>;
  uninstallAgent(): Promise<void>;
  getLatestVersion(): Promise<string | null>;

  // 多会话 runtime API
  connectRuntime(input: {
    conversationId: number;
    projectDir: string;
    sessionId?: string | null;
    agentType?: string;
  }): Promise<void>;
  disconnectRuntime(conversationId: number): Promise<void>;
  /** 列出某 agent 的内置 skills（设置页 / composer 补全）。 */
  listSkills(agentId: string): Promise<ResolvedAgentSkill[]>;
  /** 弹目录选择器导入用户 skill 库；取消返回 {canceled:true}。 */
  addSkill(): Promise<{ canceled: true } | { canceled: false; addedId?: string; error?: string }>;
  /** 删除用户导入的 skill（内置不可删，返回 {ok:false,error} 表示失败）。 */
  removeSkill(skillId: string): Promise<{ ok: boolean; error?: string }>;
  /** 读取 skill 目录树（详情模态用）；失败返回 null。 */
  readSkillTree(skillId: string): Promise<SkillTreeNode | null>;
  /** 读取 skill 内单文件（已做大小 / 二进制保护）；失败返回 {error}。 */
  readSkillFile(
    skillId: string,
    relPath: string,
  ): Promise<SkillFileContent | { error: string }>;
  /** 在 Finder 打开 skill 目录；不传 id 打开 skill 库根目录。 */
  openSkillDir(skillId?: string): Promise<{ ok: boolean; error?: string }>;
  sendPromptToConversation(
    conversationId: number,
    contents: PromptInputBlock[],
    opts?: { model?: string; reasoning?: string; skillIds?: string[] },
  ): Promise<void>;
  cancelConversationTurn(conversationId: number): Promise<void>;
  setConversationMode(conversationId: number, modeId: string): Promise<void>;
  setConversationConfigOption(conversationId: number, configId: string, valueId: string): Promise<void>;
  respondConversationPermission(conversationId: number, requestId: string, optionId: string): Promise<void>;
  onRuntimeStatusChanged(
    callback: (payload: { conversationId: number; status: ConnectionStatus }) => void,
  ): () => void;
  onRuntimeEvent(
    callback: (payload: { conversationId: number; event: ContentBlock | Record<string, unknown> }) => void,
  ): () => void;
  onRuntimeCapabilities(
    callback: (payload: { conversationId: number; capabilities: AgentCapabilities | Record<string, unknown> }) => void,
  ): () => void;
}

declare global {
  interface Window {
    agentAPI: AgentAPI;
  }
}

/**
 * 从 agent 配置中解析出当前应连接的 agentType。
 *
 * 全局单激活语义：直接返回 `config.activeAgentId`（设置中心单选的全局激活 agent）。
 * 旧数据无 activeAgentId（或无 config）时回退到 'claude'，保证不回归。
 */
export function resolvePreferredAgentType(config: AgentConfigData | null | undefined): string {
  const fallback = 'claude';
  return config?.activeAgentId ?? fallback;
}

/** 读取配置并解析当前应连接的 agentType（renderer 侧）。 */
export async function getPreferredAgentType(): Promise<string> {
  if (typeof window === 'undefined' || typeof window.agentAPI === 'undefined') {
    return 'claude';
  }
  try {
    const config = await window.agentAPI.getConfig();
    return resolvePreferredAgentType(config);
  } catch {
    return 'claude';
  }
}

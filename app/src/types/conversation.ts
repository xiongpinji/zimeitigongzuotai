import type {
  AcpConfigOption,
  AgentMode,
  AvailableCommand,
  ConnectionStatus,
  PermissionOption,
  PromptInputBlock,
} from '../../electron/acp/types';

export type ConversationStatus = 'draft_local' | 'active' | 'archived' | string;

export interface ConversationSummary {
  id: number;
  projectId: string;
  title: string;
  agentType: string;
  status: ConversationStatus;
  externalId: string | null;
  parentId: number | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationTurn {
  id: number | string;
  conversationId: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  blocks: ConversationBlock[];
  createdAt: string;
  agentId?: string;
  agentName?: string;
}

export type ConversationBlock =
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
  | { type: 'error'; message: string }
  | { type: 'turn_complete'; stopReason: string }
  | {
      type: 'file_changed';
      path: string;
      before: string | null;
      after: string;
      diff?: string;
      operation?: 'edit' | 'create' | 'delete';
    };

export interface ConversationDetail extends ConversationSummary {
  turns: ConversationTurn[];
}

export interface OpenConversationResult {
  conversation: ConversationSummary;
  resumeExternalId: string | null;
}

export interface ConversationListResult {
  conversations: ConversationSummary[];
}

export interface CreateConversationInput {
  projectId: string;
  agentType: string;
  title?: string;
}

export interface UpdateConversationInput {
  title?: string;
  status?: ConversationStatus;
  externalId?: string | null;
  sessionStatsJson?: string | null;
  messageCount?: number;
}

export interface AppendConversationTurnInput {
  role: ConversationTurn['role'];
  blocks: ConversationBlock[];
  sessionStatsJson?: string | null;
  agentId?: string;
  agentName?: string;
}

export interface AppendConversationTurnResult {
  conversation: ConversationSummary;
  turn: ConversationTurn;
}

export interface ConversationAPI {
  list(projectId: string): Promise<ConversationListResult>;
  detail(conversationId: number, projectId?: string): Promise<ConversationDetail>;
  create(input: CreateConversationInput): Promise<ConversationSummary>;
  fork(sourceConversationId: number, projectId?: string, title?: string): Promise<ConversationSummary>;
  update(conversationId: number, patch: UpdateConversationInput, projectId?: string): Promise<ConversationSummary>;
  delete(conversationId: number, projectId?: string): Promise<void>;
  open(projectId: string, conversationId: number): Promise<OpenConversationResult>;
  appendTurn(
    conversationId: number,
    input: AppendConversationTurnInput,
    projectId?: string,
  ): Promise<AppendConversationTurnResult>;
  getOpenedConversation(projectId: string): Promise<number | null>;
  setOpenedConversation(projectId: string, conversationId: number | null): Promise<void>;
}

export interface LiveToolCallInfo {
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  rawInput?: string;
  rawOutput?: string;
}

export type LiveContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; info: LiveToolCallInfo }
  | { type: 'error'; message: string }
  | { type: 'file_changed'; path: string; before: string | null; after: string };

export interface LiveMessage {
  id: string;
  role: 'assistant' | 'tool';
  content: LiveContentBlock[];
  startedAt: number;
}

export interface PendingPermission {
  requestId: string;
  toolCall: unknown;
  options: PermissionOption[];
}

export interface ModelInfo {
  availableModels: { modelId: string; name: string; description?: string }[];
  currentModelId: string;
}

export interface ConversationConnectionState {
  conversationId: number;
  agentType: string;
  status: ConnectionStatus;
  sessionId: string | null;
  liveMessage: LiveMessage | null;
  pendingPermission: PendingPermission | null;
  usage: { used: number; size: number } | null;
  availableCommands: AvailableCommand[] | null;
  configOptions: AcpConfigOption[] | null;
  availableModes: AgentMode[] | null;
  currentModeId: string | null;
  models: ModelInfo | null;
  error: string | null;
}

export interface ConnectionLifecycleOptions {
  conversationId: number;
  projectDir?: string;
  sessionId?: string | null;
  isActive: boolean;
  agentType?: string;
  autoConnectOnActive?: boolean;
}

export interface ConnectionLifecycleResult {
  autoConnectError: string | null;
  selectorsLoading: boolean;
  send: (contents: PromptInputBlock[], opts?: { model?: string; reasoning?: string; skillIds?: string[] }) => Promise<void>;
  cancel: () => Promise<void>;
  disconnect: () => Promise<void>;
  setMode: (modeId: string) => Promise<void>;
  setConfigOption: (configId: string, valueId: string) => Promise<void>;
  respondPermission: (requestId: string, optionId: string) => Promise<void>;
}

declare global {
  interface Window {
    conversationAPI?: ConversationAPI;
  }
}

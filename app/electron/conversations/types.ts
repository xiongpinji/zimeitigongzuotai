export type ConversationStatus = 'draft_local' | 'active' | 'archived';

export type ConversationTurnBlock =
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
    };

export interface ConversationEntity {
  id: number;
  projectId: string;
  title: string;
  agentType: string;
  status: ConversationStatus;
  externalId: string | null;
  parentId: number | null;
  messageCount: number;
  sessionStatsJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationTurnEntity {
  id: number;
  conversationId: number;
  role: string;
  blocks: ConversationTurnBlock[];
  createdAt: string;
  agentId?: string;
  agentName?: string;
}

export interface OpenedConversationEntity {
  projectId: string;
  conversationId: number | null;
  updatedAt: string;
}

export interface CreateConversationInput {
  projectId: string;
  title: string;
  agentType: string;
  status: ConversationStatus;
  externalId?: string | null;
  parentId?: number | null;
  messageCount?: number;
  sessionStatsJson?: string | null;
}

export interface ForkConversationInput {
  sourceConversationId: number;
  title: string;
}

export interface UpdateConversationInput {
  title?: string;
  status?: ConversationStatus;
  externalId?: string | null;
  sessionStatsJson?: string | null;
  messageCount?: number;
}

export interface AppendConversationTurnInput {
  role: string;
  blocks: ConversationTurnBlock[];
  sessionStatsJson?: string | null;
  agentId?: string;
  agentName?: string;
}

export interface AppendConversationTurnResult {
  conversation: ConversationEntity;
  turn: ConversationTurnEntity;
}

export interface ConversationSummaryItem {
  id: number;
  projectId: string;
  title: string;
  status: ConversationStatus;
  externalId: string | null;
  parentId: number | null;
  updatedAt: string;
  isOpened: boolean;
}

export interface ConversationWorkspaceSummary {
  projectId: string;
  openedConversationId: number | null;
  conversations: ConversationSummaryItem[];
}

export interface OpenConversationResolution {
  conversation: ConversationEntity;
  resumeExternalId: string | null;
}

export interface ConversationDetailEntity extends ConversationEntity {
  turns: ConversationTurnEntity[];
}

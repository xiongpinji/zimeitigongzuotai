import type {
  AppendConversationTurnResult,
  ConversationDetailEntity,
  ConversationEntity,
  ConversationStatus,
  ConversationTurnBlock,
  ConversationSummaryItem,
  ConversationWorkspaceSummary,
  OpenConversationResolution,
} from './types';
import { ConversationRepository } from './repository';

export interface CreateConversationParams {
  projectId: string;
  agentType: string;
  title?: string;
}

export interface ForkConversationParams {
  sourceConversationId: number;
  title?: string;
}

export interface UpdateConversationParams {
  title?: string;
  status?: ConversationStatus;
  externalId?: string | null;
  sessionStatsJson?: string | null;
  messageCount?: number;
}

export interface AppendConversationTurnParams {
  role: string;
  blocks: ConversationTurnBlock[];
  sessionStatsJson?: string | null;
  agentId?: string;
  agentName?: string;
}

function buildDefaultConversationTitle(now = new Date()): string {
  const y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `新会话 ${y}-${M}-${d} ${h}:${m}`;
}

export class ConversationService {
  constructor(private readonly repository: ConversationRepository) {}

  createConversation(input: CreateConversationParams): ConversationEntity {
    const conversation = this.repository.createConversation({
      projectId: input.projectId,
      title: input.title?.trim() || buildDefaultConversationTitle(),
      agentType: input.agentType,
      status: 'draft_local',
      externalId: null,
      parentId: null,
      messageCount: 0,
      sessionStatsJson: null,
    });

    this.repository.setOpenedConversation(input.projectId, conversation.id);
    return conversation;
  }

  listConversations(projectId: string): ConversationEntity[] {
    return this.repository.listConversations(projectId);
  }

  listConversationSummaries(projectId: string): ConversationWorkspaceSummary {
    const openedConversationId = this.getOpenedConversation(projectId);
    const conversations = this.repository.listConversations(projectId).map((conversation) => {
      const summary: ConversationSummaryItem = {
        id: conversation.id,
        projectId: conversation.projectId,
        title: conversation.title,
        status: conversation.status,
        externalId: conversation.externalId,
        parentId: conversation.parentId,
        updatedAt: conversation.updatedAt,
        isOpened: openedConversationId === conversation.id,
      };
      return summary;
    });

    return {
      projectId,
      openedConversationId,
      conversations,
    };
  }

  getConversationDetail(conversationId: number): ConversationDetailEntity | null {
    return this.repository.getConversationDetail(conversationId);
  }

  setOpenedConversation(projectId: string, conversationId: number | null): void {
    if (conversationId !== null) {
      const conversation = this.repository.getConversationById(conversationId);
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }
      if (conversation.projectId !== projectId) {
        throw new Error(`Conversation ${conversationId} does not belong to project ${projectId}`);
      }
    }
    this.repository.setOpenedConversation(projectId, conversationId);
  }

  getOpenedConversation(projectId: string): number | null {
    return this.repository.getOpenedConversation(projectId)?.conversationId ?? null;
  }

  openConversation(projectId: string, conversationId: number): OpenConversationResolution {
    const conversation = this.repository.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    if (conversation.projectId !== projectId) {
      throw new Error(`Conversation ${conversationId} does not belong to project ${projectId}`);
    }

    this.repository.setOpenedConversation(projectId, conversationId);

    // 仅在用户显式打开/切换会话时，才将 externalId 作为可恢复会话返回给上层 runtime。
    return {
      conversation,
      resumeExternalId: conversation.externalId,
    };
  }

  forkConversation(input: ForkConversationParams): ConversationEntity {
    const source = this.repository.getConversationById(input.sourceConversationId);
    if (!source) {
      throw new Error(`Conversation ${input.sourceConversationId} not found`);
    }

    const forked = this.repository.forkConversation({
      sourceConversationId: input.sourceConversationId,
      title: input.title?.trim() || `${source.title} (fork)`,
    });

    this.repository.setOpenedConversation(source.projectId, forked.id);
    return forked;
  }

  updateConversation(conversationId: number, patch: UpdateConversationParams): ConversationEntity {
    return this.repository.updateConversation(conversationId, patch);
  }

  appendTurn(
    projectId: string,
    conversationId: number,
    input: AppendConversationTurnParams,
  ): AppendConversationTurnResult {
    const conversation = this.repository.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    if (conversation.projectId !== projectId) {
      throw new Error(`Conversation ${conversationId} does not belong to project ${projectId}`);
    }
    return this.repository.appendConversationTurn(conversationId, {
      role: input.role,
      blocks: input.blocks,
      sessionStatsJson: input.sessionStatsJson,
      agentId: input.agentId,
      agentName: input.agentName,
    });
  }

  deleteConversation(projectId: string, conversationId: number): void {
    const conversation = this.repository.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    if (conversation.projectId !== projectId) {
      throw new Error(`Conversation ${conversationId} does not belong to project ${projectId}`);
    }

    this.repository.deleteConversation(conversationId);

    if (this.getOpenedConversation(projectId) === conversationId) {
      this.repository.setOpenedConversation(projectId, null);
    }
  }
}

export { buildDefaultConversationTitle };

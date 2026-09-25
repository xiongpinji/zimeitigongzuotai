import type { PromptInputBlock } from '../../electron/acp/types';
import {
  appendConversationTurn,
  createConversation,
  getOpenedConversation,
  openConversation,
} from './conversation-api';
import { getPreferredAgentType } from './agent-api';

const DEFAULT_AGENT_TYPE = 'claude';
export const QUICK_ACTION_CONVERSATION_EVENT = 'conversation:activate';

interface ConversationActivationDetail {
  projectId: string;
  conversationId: number;
  explicit: boolean;
}

function assertAgentApi() {
  if (!window.agentAPI || !window.conversationAPI) {
    throw new Error('agentAPI/conversationAPI is unavailable in current runtime');
  }
  return {
    agentApi: window.agentAPI,
    conversationApi: window.conversationAPI,
  };
}

function emitConversationActivation(detail: ConversationActivationDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ConversationActivationDetail>(QUICK_ACTION_CONVERSATION_EVENT, { detail }));
}

function promptBlocksToConversationBlocks(contents: PromptInputBlock[]) {
  return contents.map((block) => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text };
    }
    if (block.type === 'resource') {
      return {
        type: 'text' as const,
        text: block.text?.trim() || `[resource] ${block.uri}`,
      };
    }
    return {
      type: 'text' as const,
      text: block.uri ? `[image] ${block.uri}` : `[image] ${block.mimeType}`,
    };
  });
}

async function ensureOpenedConversationRuntime(projectId: string): Promise<number> {
  const { agentApi } = assertAgentApi();
  let conversationId = await getOpenedConversation(projectId);
  if (conversationId === null) {
    // 跟随设置中心的全局激活 agent；解析失败才回退默认。
    const agentType = (await getPreferredAgentType()) || DEFAULT_AGENT_TYPE;
    const created = await createConversation({
      projectId,
      agentType,
      title: '脚本工作台会话',
    });
    conversationId = created.id;
  }

  const opened = await openConversation(projectId, conversationId);
  emitConversationActivation({
    projectId,
    conversationId,
    explicit: true,
  });
  await agentApi.connectRuntime({
    conversationId,
    projectDir: projectId,
    sessionId: opened.resumeExternalId,
    agentType: opened.conversation.agentType,
  });
  return conversationId;
}

export async function sendQuickActionPrompt(projectId: string, text: string): Promise<number> {
  const contents: PromptInputBlock[] = [{ type: 'text', text }];
  const { agentApi } = assertAgentApi();
  const conversationId = await ensureOpenedConversationRuntime(projectId);
  await appendConversationTurn(
    conversationId,
    {
      role: 'user',
      blocks: promptBlocksToConversationBlocks(contents),
    },
    projectId,
  );
  await agentApi.sendPromptToConversation(conversationId, contents);
  return conversationId;
}

export async function cancelQuickActionTurn(projectId: string): Promise<boolean> {
  const { agentApi } = assertAgentApi();
  const conversationId = await getOpenedConversation(projectId);
  if (conversationId === null) {
    return false;
  }
  emitConversationActivation({
    projectId,
    conversationId,
    explicit: true,
  });
  await agentApi.cancelConversationTurn(conversationId);
  return true;
}

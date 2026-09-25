import type {
  AppendConversationTurnInput,
  AppendConversationTurnResult,
  ConversationAPI,
  ConversationDetail,
  OpenConversationResult,
  ConversationSummary,
  CreateConversationInput,
  UpdateConversationInput,
} from '../types/conversation';

function resolveConversationApi(apiOverride?: ConversationAPI): ConversationAPI {
  if (apiOverride) return apiOverride;
  if (typeof window !== 'undefined' && window.conversationAPI) {
    return window.conversationAPI;
  }
  throw new Error('conversationAPI is unavailable in current runtime');
}

export async function listConversations(
  projectId: string,
  apiOverride?: ConversationAPI,
): Promise<ConversationSummary[]> {
  const api = resolveConversationApi(apiOverride);
  const result = await api.list(projectId);
  return result.conversations ?? [];
}

export function getConversationDetail(
  conversationId: number,
  projectId?: string,
  apiOverride?: ConversationAPI,
): Promise<ConversationDetail> {
  return resolveConversationApi(apiOverride).detail(conversationId, projectId);
}

export function createConversation(
  input: CreateConversationInput,
  apiOverride?: ConversationAPI,
): Promise<ConversationSummary> {
  return resolveConversationApi(apiOverride).create(input);
}

export function forkConversation(
  sourceConversationId: number,
  projectId?: string,
  title?: string,
  apiOverride?: ConversationAPI,
): Promise<ConversationSummary> {
  return resolveConversationApi(apiOverride).fork(sourceConversationId, projectId, title);
}

export function updateConversation(
  conversationId: number,
  patch: UpdateConversationInput,
  projectId?: string,
  apiOverride?: ConversationAPI,
): Promise<ConversationSummary> {
  return resolveConversationApi(apiOverride).update(conversationId, patch, projectId);
}

export function deleteConversation(
  conversationId: number,
  projectId?: string,
  apiOverride?: ConversationAPI,
): Promise<void> {
  return resolveConversationApi(apiOverride).delete(conversationId, projectId);
}

export function openConversation(
  projectId: string,
  conversationId: number,
  apiOverride?: ConversationAPI,
): Promise<OpenConversationResult> {
  return resolveConversationApi(apiOverride).open(projectId, conversationId);
}

export function appendConversationTurn(
  conversationId: number,
  input: AppendConversationTurnInput,
  projectId?: string,
  apiOverride?: ConversationAPI,
): Promise<AppendConversationTurnResult> {
  return resolveConversationApi(apiOverride).appendTurn(conversationId, input, projectId);
}

export function getOpenedConversation(
  projectId: string,
  apiOverride?: ConversationAPI,
): Promise<number | null> {
  return resolveConversationApi(apiOverride).getOpenedConversation(projectId);
}

export function setOpenedConversation(
  projectId: string,
  conversationId: number | null,
  apiOverride?: ConversationAPI,
): Promise<void> {
  return resolveConversationApi(apiOverride).setOpenedConversation(projectId, conversationId);
}

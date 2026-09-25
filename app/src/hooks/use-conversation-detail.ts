import { useConversationRuntimeContext } from '../contexts/conversation-runtime-context';
import { useConversationWorkspace } from '../contexts/conversation-workspace-context';

export function useConversationDetail(conversationId?: number | null) {
  const workspace = useConversationWorkspace();
  const runtimeContext = useConversationRuntimeContext();
  const resolvedConversationId = conversationId ?? workspace.activeConversationId;

  if (resolvedConversationId === null || resolvedConversationId === undefined) {
    return {
      conversationId: null,
      detail: null,
      runtime: null,
      loading: workspace.loadingDetail,
      error: workspace.error,
    };
  }

  return {
    conversationId: resolvedConversationId,
    detail: workspace.getDetail(resolvedConversationId),
    runtime: runtimeContext.getRuntimeByConversationId(resolvedConversationId),
    loading: workspace.loadingDetail,
    error: workspace.error,
  };
}


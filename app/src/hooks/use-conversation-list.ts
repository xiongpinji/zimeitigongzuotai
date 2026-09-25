import { useConversationWorkspace } from '../contexts/conversation-workspace-context';

export function useConversationList() {
  const workspace = useConversationWorkspace();

  return {
    conversations: workspace.conversations,
    activeConversationId: workspace.activeConversationId,
    openedConversationId: workspace.openedConversationId,
    loading: workspace.loadingList,
    error: workspace.error,
    refresh: workspace.refresh,
    setActiveConversation: workspace.setActiveConversation,
    createConversation: workspace.createConversation,
    forkConversation: workspace.forkConversation,
    deleteConversation: workspace.deleteConversation,
    renameConversation: workspace.renameConversation,
    archiveConversation: workspace.archiveConversation,
  };
}

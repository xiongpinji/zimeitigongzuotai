import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  createConversation,
  deleteConversation,
  forkConversation,
  getConversationDetail,
  getOpenedConversation,
  listConversations,
  setOpenedConversation,
  updateConversation,
} from '../lib/conversation-api';
import type {
  ConversationAPI,
  ConversationDetail,
  ConversationSummary,
  CreateConversationInput,
} from '../types/conversation';

export interface ConversationWorkspaceState {
  projectId: string | null;
  conversations: ConversationSummary[];
  detailMap: Record<number, ConversationDetail>;
  activeConversationId: number | null;
  openedConversationId: number | null;
  loadingList: boolean;
  loadingDetail: boolean;
  error: string | null;
}

export interface ConversationWorkspaceValue extends ConversationWorkspaceState {
  refresh: () => Promise<void>;
  setActiveConversation: (conversationId: number | null) => Promise<void>;
  createConversation: (input: Omit<CreateConversationInput, 'projectId'>) => Promise<ConversationSummary>;
  forkConversation: (sourceConversationId: number) => Promise<ConversationSummary>;
  deleteConversation: (conversationId: number) => Promise<void>;
  renameConversation: (conversationId: number, title: string) => Promise<ConversationSummary>;
  archiveConversation: (conversationId: number) => Promise<ConversationSummary>;
  getDetail: (conversationId: number) => ConversationDetail | null;
  applyConversationSummary: (conversation: ConversationSummary) => void;
  appendPersistedTurn: (conversation: ConversationSummary, turn: ConversationDetail['turns'][number]) => void;
}

export interface WorkspaceBootstrapResult {
  conversations: ConversationSummary[];
  openedConversationId: number | null;
  activeConversationId: number | null;
}

export function mergeConversationIntoList(
  conversations: ConversationSummary[],
  conversation: ConversationSummary,
): ConversationSummary[] {
  return [conversation, ...conversations.filter((item) => item.id !== conversation.id)];
}

export function mergeConversationWithoutReorder(
  conversations: ConversationSummary[],
  conversation: ConversationSummary,
): ConversationSummary[] {
  const index = conversations.findIndex((item) => item.id === conversation.id);
  if (index === -1) {
    return [...conversations, conversation];
  }
  return conversations.map((item) => (item.id === conversation.id ? conversation : item));
}

export async function loadWorkspaceBootstrap(
  projectId: string,
  apiOverride?: ConversationAPI,
): Promise<WorkspaceBootstrapResult> {
  const [conversations, openedConversationId] = await Promise.all([
    listConversations(projectId, apiOverride),
    getOpenedConversation(projectId, apiOverride),
  ]);
  const activeConversationId =
    openedConversationId ?? (conversations.length > 0 ? conversations[0].id : null);

  return {
    conversations,
    openedConversationId,
    activeConversationId,
  };
}

export async function switchConversationAndLoadDetail(
  projectId: string,
  conversationId: number,
  detailMap: Record<number, ConversationDetail>,
  apiOverride?: ConversationAPI,
): Promise<{ detail: ConversationDetail; nextDetailMap: Record<number, ConversationDetail> }> {
  const existingDetail = detailMap[conversationId];
  if (existingDetail) {
    await setOpenedConversation(projectId, conversationId, apiOverride);
    return {
      detail: existingDetail,
      nextDetailMap: detailMap,
    };
  }

  const detail = await getConversationDetail(conversationId, projectId, apiOverride);
  await setOpenedConversation(projectId, conversationId, apiOverride);

  return {
    detail,
    nextDetailMap: {
      ...detailMap,
      [conversationId]: detail,
    },
  };
}

const initialWorkspaceState: ConversationWorkspaceState = {
  projectId: null,
  conversations: [],
  detailMap: {},
  activeConversationId: null,
  openedConversationId: null,
  loadingList: false,
  loadingDetail: false,
  error: null,
};

const ConversationWorkspaceContext = createContext<ConversationWorkspaceValue | null>(null);

interface ConversationWorkspaceProviderProps {
  projectId: string | null;
  children: ReactNode;
  apiOverride?: ConversationAPI;
}

export function ConversationWorkspaceProvider({
  projectId,
  children,
  apiOverride,
}: ConversationWorkspaceProviderProps) {
  const [state, setState] = useState<ConversationWorkspaceState>({
    ...initialWorkspaceState,
    projectId,
  });

  useEffect(() => {
    setState((prev) => ({
      ...prev,
      projectId,
      detailMap: projectId === prev.projectId ? prev.detailMap : {},
      activeConversationId: projectId === prev.projectId ? prev.activeConversationId : null,
      openedConversationId: projectId === prev.projectId ? prev.openedConversationId : null,
    }));
  }, [projectId]);

  async function refresh() {
    if (!projectId) {
      setState((prev) => ({
        ...prev,
        conversations: [],
        activeConversationId: null,
        openedConversationId: null,
        detailMap: {},
      }));
      return;
    }

    setState((prev) => ({ ...prev, loadingList: true, error: null }));
    try {
      const bootstrap = await loadWorkspaceBootstrap(projectId, apiOverride);
      setState((prev) => ({
        ...prev,
        conversations: bootstrap.conversations,
        openedConversationId: bootstrap.openedConversationId,
        activeConversationId: bootstrap.activeConversationId,
        loadingList: false,
      }));
      if (bootstrap.activeConversationId !== null) {
        await setActiveConversation(bootstrap.activeConversationId);
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loadingList: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function setActiveConversation(conversationId: number | null) {
    if (!projectId) return;
    if (conversationId === null) {
      await setOpenedConversation(projectId, null, apiOverride);
      setState((prev) => ({
        ...prev,
        activeConversationId: null,
        openedConversationId: null,
      }));
      return;
    }

    setState((prev) => ({ ...prev, loadingDetail: true, error: null }));
    try {
      const { detail, nextDetailMap } = await switchConversationAndLoadDetail(
        projectId,
        conversationId,
        state.detailMap,
        apiOverride,
      );
      setState((prev) => ({
        ...prev,
        detailMap: nextDetailMap,
        activeConversationId: conversationId,
        openedConversationId: conversationId,
        loadingDetail: false,
      }));
      setState((prev) => ({
        ...prev,
        conversations: mergeConversationWithoutReorder(prev.conversations, detail),
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loadingDetail: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function createConversationInWorkspace(
    input: Omit<CreateConversationInput, 'projectId'>,
  ): Promise<ConversationSummary> {
    if (!projectId) {
      throw new Error('projectId is required before creating conversation');
    }
    const created = await createConversation(
      {
        ...input,
        projectId,
      },
      apiOverride,
    );
    setState((prev) => ({
      ...prev,
      conversations: mergeConversationIntoList(prev.conversations, created),
    }));
    await setActiveConversation(created.id);
    return created;
  }

  async function forkConversationInWorkspace(sourceConversationId: number): Promise<ConversationSummary> {
    const forked = await forkConversation(
      sourceConversationId,
      projectId ?? undefined,
      undefined,
      apiOverride,
    );
    setState((prev) => ({
      ...prev,
      conversations: mergeConversationIntoList(prev.conversations, forked),
    }));
    if (projectId) {
      await setActiveConversation(forked.id);
    }
    return forked;
  }

  async function deleteConversationInWorkspace(conversationId: number): Promise<void> {
    if (!projectId) {
      throw new Error('projectId is required before deleting conversation');
    }

    await deleteConversation(conversationId, projectId, apiOverride);
    setState((prev) => {
      const nextConversations = prev.conversations.filter((item) => item.id !== conversationId);
      const fallbackActive = nextConversations[0]?.id ?? null;
      const nextActive =
        prev.activeConversationId === conversationId ? fallbackActive : prev.activeConversationId;
      const nextOpened =
        prev.openedConversationId === conversationId ? nextActive : prev.openedConversationId;
      const nextDetailMap = { ...prev.detailMap };
      delete nextDetailMap[conversationId];
      return {
        ...prev,
        conversations: nextConversations,
        detailMap: nextDetailMap,
        activeConversationId: nextActive,
        openedConversationId: nextOpened,
      };
    });
    if (projectId) {
      const remaining = state.conversations.filter((item) => item.id !== conversationId);
      await setOpenedConversation(projectId, remaining[0]?.id ?? null, apiOverride);
    }
  }

  async function renameConversation(conversationId: number, title: string): Promise<ConversationSummary> {
    const updated = await updateConversation(
      conversationId,
      {
        title,
      },
      projectId ?? undefined,
      apiOverride,
    );
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((item) => (item.id === conversationId ? updated : item)),
      detailMap: prev.detailMap[conversationId]
        ? {
            ...prev.detailMap,
            [conversationId]: {
              ...prev.detailMap[conversationId],
              title: updated.title,
              updatedAt: updated.updatedAt,
            },
          }
        : prev.detailMap,
    }));
    return updated;
  }

  async function archiveConversation(conversationId: number): Promise<ConversationSummary> {
    const updated = await updateConversation(
      conversationId,
      {
        status: 'archived',
      },
      projectId ?? undefined,
      apiOverride,
    );
    setState((prev) => {
      const nextConversations = prev.conversations.map((item) => (item.id === conversationId ? updated : item));
      const fallbackActive = nextConversations.find((item) => item.status !== 'archived')?.id ?? null;
      const nextActive = prev.activeConversationId === conversationId ? fallbackActive : prev.activeConversationId;
      return {
        ...prev,
        conversations: nextConversations,
        activeConversationId: nextActive,
        openedConversationId: nextActive,
      };
    });
    if (projectId) {
      await setOpenedConversation(projectId, state.activeConversationId, apiOverride);
    }
    return updated;
  }

  function getDetail(conversationId: number): ConversationDetail | null {
    return state.detailMap[conversationId] ?? null;
  }

  function applyConversationSummary(conversation: ConversationSummary) {
    setState((prev) => ({
      ...prev,
      conversations: mergeConversationWithoutReorder(prev.conversations, conversation),
      detailMap: prev.detailMap[conversation.id]
        ? {
            ...prev.detailMap,
            [conversation.id]: {
              ...prev.detailMap[conversation.id],
              ...conversation,
            },
          }
        : prev.detailMap,
    }));
  }

  function appendPersistedTurn(
    conversation: ConversationSummary,
    turn: ConversationDetail['turns'][number],
  ) {
    setState((prev) => {
      const currentDetail = prev.detailMap[conversation.id];
      return {
        ...prev,
        conversations: mergeConversationWithoutReorder(prev.conversations, conversation),
        detailMap: currentDetail
          ? {
              ...prev.detailMap,
              [conversation.id]: {
                ...currentDetail,
                ...conversation,
                turns: [...currentDetail.turns, turn],
              },
            }
          : prev.detailMap,
      };
    });
  }

  useEffect(() => {
    void refresh();
    // 仅在 projectId 变化时重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const value: ConversationWorkspaceValue = {
    ...state,
    refresh,
    setActiveConversation,
    createConversation: createConversationInWorkspace,
    forkConversation: forkConversationInWorkspace,
    deleteConversation: deleteConversationInWorkspace,
    renameConversation,
    archiveConversation,
    getDetail,
    applyConversationSummary,
    appendPersistedTurn,
  };

  return <ConversationWorkspaceContext.Provider value={value}>{children}</ConversationWorkspaceContext.Provider>;
}

export function useConversationWorkspace(): ConversationWorkspaceValue {
  const context = useContext(ConversationWorkspaceContext);
  if (!context) {
    throw new Error('useConversationWorkspace must be used within ConversationWorkspaceProvider');
  }
  return context;
}

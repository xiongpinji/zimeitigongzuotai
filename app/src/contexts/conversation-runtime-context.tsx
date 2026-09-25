import { createContext, useContext, type ReactNode } from 'react';
import type { ConversationTurn } from '../types/conversation';
import { useAcpConnections } from './acp-connections-context';
import { useConversationWorkspace } from './conversation-workspace-context';
import { getAgentPresentation } from '../lib/agent-presentation';

export interface ConversationRuntimeSnapshot {
  conversationId: number;
  turns: ConversationTurn[];
  status: string;
  sessionId: string | null;
  usage: { used: number; size: number } | null;
  pendingPermission: ReturnType<typeof useAcpConnections>['getConnection'] extends (
    ...args: never[]
  ) => infer T
    ? T extends { pendingPermission: infer P }
      ? P
      : null
    : null;
  error: string | null;
}

export interface ConversationRuntimeContextValue {
  getRuntimeByConversationId: (conversationId: number) => ConversationRuntimeSnapshot;
  getActiveRuntime: () => ConversationRuntimeSnapshot | null;
}

const ConversationRuntimeContext = createContext<ConversationRuntimeContextValue | null>(null);

interface ConversationRuntimeProviderProps {
  children: ReactNode;
}

function getNowIso() {
  return new Date().toISOString();
}

export function ConversationRuntimeProvider({ children }: ConversationRuntimeProviderProps) {
  const workspace = useConversationWorkspace();
  const connections = useAcpConnections();

  function getRuntimeByConversationId(conversationId: number): ConversationRuntimeSnapshot {
    const detail = workspace.getDetail(conversationId);
    const connection = connections.getConnection(conversationId);
    const persistedTurns = detail?.turns ?? [];
    const agentId = detail?.agentType || connection.agentType;
    const agentName = agentId ? getAgentPresentation(agentId).displayName : undefined;

    const liveTurn: ConversationTurn[] = connection.liveMessage
      ? [
          {
            id: `live-${conversationId}`,
            conversationId,
            role: connection.liveMessage.role,
            agentId,
            agentName,
            blocks: connection.liveMessage.content.map((block) => {
              if (block.type === 'tool_call') {
                return {
                  type: 'tool_call' as const,
                  toolCallId: block.info.toolCallId,
                  title: block.info.title,
                  kind: block.info.kind,
                  status: block.info.status,
                  rawInput: block.info.rawInput,
                  rawOutput: block.info.rawOutput,
                };
              }
              if (block.type === 'thinking') {
                return {
                  type: 'thinking' as const,
                  text: block.text,
                };
              }
              if (block.type === 'error') {
                return {
                  type: 'error' as const,
                  message: block.message,
                };
              }
              if (block.type === 'file_changed') {
                return {
                  type: 'file_changed' as const,
                  path: block.path,
                  before: block.before,
                  after: block.after,
                };
              }
              return {
                type: 'text' as const,
                text: block.text,
              };
            }),
            createdAt: getNowIso(),
          },
        ]
      : [];

    return {
      conversationId,
      turns: [...persistedTurns, ...liveTurn],
      status: connection.status,
      sessionId: connection.sessionId,
      usage: connection.usage,
      pendingPermission: connection.pendingPermission,
      error: connection.error,
    };
  }

  function getActiveRuntime(): ConversationRuntimeSnapshot | null {
    if (workspace.activeConversationId === null) return null;
    return getRuntimeByConversationId(workspace.activeConversationId);
  }

  const value: ConversationRuntimeContextValue = {
    getRuntimeByConversationId,
    getActiveRuntime,
  };

  return <ConversationRuntimeContext.Provider value={value}>{children}</ConversationRuntimeContext.Provider>;
}

export function useConversationRuntimeContext(): ConversationRuntimeContextValue {
  const context = useContext(ConversationRuntimeContext);
  if (!context) {
    throw new Error('useConversationRuntimeContext must be used within ConversationRuntimeProvider');
  }
  return context;
}

import type { PromptInputBlock } from '../../electron/acp/types';
import { useAcpConnections } from '../contexts/acp-connections-context';

export function useConnection(conversationId: number) {
  const connections = useAcpConnections();
  const state = connections.getConnection(conversationId);

  return {
    ...state,
    connect: (input: { projectDir: string; sessionId?: string | null; agentType?: string }) =>
      connections.connect({
        conversationId,
        projectDir: input.projectDir,
        sessionId: input.sessionId,
        agentType: input.agentType,
      }),
    disconnect: () => connections.disconnect(conversationId),
    sendPrompt: (contents: PromptInputBlock[], opts?: { model?: string; reasoning?: string; skillIds?: string[] }) =>
      connections.sendPrompt(conversationId, contents, opts),
    cancelTurn: () => connections.cancelTurn(conversationId),
    reportError: (message: string) => connections.reportError(conversationId, message),
    setMode: (modeId: string) => connections.setMode(conversationId, modeId),
    setConfigOption: (configId: string, valueId: string) =>
      connections.setConfigOption(conversationId, configId, valueId),
    respondPermission: (requestId: string, optionId: string) =>
      connections.respondPermission(conversationId, requestId, optionId),
  };
}


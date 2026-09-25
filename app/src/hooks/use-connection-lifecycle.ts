import { useEffect, useState } from 'react';
import type { PromptInputBlock } from '../../electron/acp/types';
import type { ConnectionLifecycleOptions, ConnectionLifecycleResult } from '../types/conversation';
import { useConnection } from './use-connection';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useConnectionLifecycle({
  conversationId,
  isActive,
  projectDir,
  sessionId,
  agentType,
  autoConnectOnActive = false,
}: ConnectionLifecycleOptions): ReturnType<typeof useConnection> & ConnectionLifecycleResult {
  const connection = useConnection(conversationId);
  const [autoConnectError, setAutoConnectError] = useState<string | null>(null);

  useEffect(() => {
    if (!autoConnectOnActive) return;
    if (!isActive) return;
    if (!projectDir) return;
    if (connection.status !== 'disconnected' && connection.status !== 'error') return;

    let cancelled = false;
    connection
      .connect({
        projectDir,
        sessionId: sessionId ?? null,
        agentType,
      })
      .then(() => {
        if (!cancelled) {
          setAutoConnectError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAutoConnectError(normalizeError(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentType, autoConnectOnActive, connection, isActive, projectDir, sessionId]);

  async function send(
    contents: PromptInputBlock[],
    opts?: { model?: string; reasoning?: string; skillIds?: string[] },
  ): Promise<void> {
    await connection.sendPrompt(contents, opts);
  }

  async function cancel(): Promise<void> {
    await connection.cancelTurn();
  }

  async function disconnect(): Promise<void> {
    await connection.disconnect();
  }

  async function setMode(modeId: string): Promise<void> {
    await connection.setMode(modeId);
  }

  async function setConfigOption(configId: string, valueId: string): Promise<void> {
    await connection.setConfigOption(configId, valueId);
  }

  async function respondPermission(requestId: string, optionId: string): Promise<void> {
    await connection.respondPermission(requestId, optionId);
  }

  return {
    ...connection,
    autoConnectError,
    selectorsLoading: connection.status === 'connecting' || connection.status === 'prompting',
    send,
    cancel,
    disconnect,
    setMode,
    setConfigOption,
    respondPermission,
  };
}

// @vitest-environment jsdom
//
// ConversationRuntimeProvider 回归：流式 live turn 也必须携带当前连接的 agent 元数据。
// 否则 Pi 正在回复时会落到默认/旧 agent 展示，出现“顶部是 Pi，消息头是 Claude Code”的错觉。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationWorkspaceProvider } from '../src/contexts/conversation-workspace-context';
import { AcpConnectionsProvider, useAcpConnections } from '../src/contexts/acp-connections-context';
import {
  ConversationRuntimeProvider,
  useConversationRuntimeContext,
} from '../src/contexts/conversation-runtime-context';
import type { ConversationAPI, ConversationRuntimeSnapshot } from '../src/types/conversation';
import type { AcpConnectionsContextValue } from '../src/contexts/acp-connections-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let runtimeEventHandler:
  | ((payload: { conversationId: number; event: Record<string, unknown> }) => void)
  | null = null;
let runtimeStatusHandler:
  | ((payload: { conversationId: number; status: string }) => void)
  | null = null;
let latestSnapshot: ConversationRuntimeSnapshot | null = null;
let latestStatus: string | null = null;
let latestConnections: AcpConnectionsContextValue | null = null;

const conversation = {
  id: 1,
  projectId: 'project-a',
  title: 'Pi 会话',
  agentType: 'pi',
  status: 'active',
  externalId: null,
  parentId: null,
  messageCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const api: ConversationAPI = {
  list: vi.fn(async () => ({ conversations: [conversation] })),
  detail: vi.fn(async () => ({ ...conversation, turns: [] })),
  create: vi.fn(),
  fork: vi.fn(),
  update: vi.fn(async () => conversation),
  delete: vi.fn(async () => undefined),
  open: vi.fn(async () => ({ conversation, resumeExternalId: null })),
  appendTurn: vi.fn(async (_conversationId, input) => ({
    conversation,
    turn: {
      id: 100,
      conversationId: conversation.id,
      role: input.role,
      blocks: input.blocks,
      createdAt: '2026-01-01T00:00:02.000Z',
      agentId: input.agentId,
      agentName: input.agentName,
    },
  })),
  getOpenedConversation: vi.fn(async () => conversation.id),
  setOpenedConversation: vi.fn(async () => undefined),
};

beforeEach(() => {
  runtimeEventHandler = null;
  runtimeStatusHandler = null;
  latestSnapshot = null;
  latestStatus = null;
  latestConnections = null;
  (window as unknown as { agentAPI: unknown }).agentAPI = {
    onRuntimeStatusChanged: vi.fn((handler) => {
      runtimeStatusHandler = handler;
      return () => undefined;
    }),
    onRuntimeEvent: vi.fn((handler) => {
      runtimeEventHandler = handler;
      return () => undefined;
    }),
    onRuntimeCapabilities: vi.fn(() => () => undefined),
    connectRuntime: vi.fn(async () => undefined),
    sendPromptToConversation: vi.fn(async () => undefined),
    disconnectRuntime: vi.fn(async () => undefined),
    cancelConversationTurn: vi.fn(async () => undefined),
    setConversationMode: vi.fn(async () => undefined),
    setConversationConfigOption: vi.fn(async () => undefined),
    respondConversationPermission: vi.fn(async () => undefined),
  };
  window.conversationAPI = api;
});

afterEach(() => {
  delete (window as unknown as { agentAPI?: unknown }).agentAPI;
  delete window.conversationAPI;
});

function Probe() {
  const connections = useAcpConnections();
  const runtime = useConversationRuntimeContext();
  latestConnections = connections;
  latestStatus = connections.getConnection(conversation.id).status;
  latestSnapshot = runtime.getRuntimeByConversationId(conversation.id);
  return (
    <button
      type="button"
      onClick={() =>
        void connections.connect({
          conversationId: conversation.id,
          projectDir: '/tmp/project-a',
          agentType: 'pi',
        })
      }
    >
      connect
    </button>
  );
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ConversationWorkspaceProvider projectId="project-a" apiOverride={api}>
        <AcpConnectionsProvider>
          <ConversationRuntimeProvider>
            <Probe />
          </ConversationRuntimeProvider>
        </AcpConnectionsProvider>
      </ConversationWorkspaceProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

describe('ConversationRuntimeProvider live agent metadata', () => {
  it('marks Pi live assistant turns as Pi while streaming', async () => {
    const { container, root } = await mount();
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      runtimeEventHandler?.({
        conversationId: conversation.id,
        event: { type: 'text', text: 'Pi 正在回答' },
      });
    });

    expect(latestSnapshot?.turns).toHaveLength(1);
    expect(latestSnapshot?.turns[0]).toMatchObject({
      role: 'assistant',
      agentId: 'pi',
      agentName: 'Pi',
    });

    act(() => root.unmount());
    container.remove();
  });

  it('keeps conversation status prompting while live assistant content is streaming', async () => {
    const { container, root } = await mount();
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await latestConnections?.sendPrompt(conversation.id, [{ type: 'text', text: '继续' }]);
    });

    await act(async () => {
      runtimeEventHandler?.({
        conversationId: conversation.id,
        event: { type: 'thinking', text: '正在思考' },
      });
    });

    await act(async () => {
      runtimeStatusHandler?.({ conversationId: conversation.id, status: 'connected' });
    });

    expect(latestStatus).toBe('prompting');

    await act(async () => {
      runtimeEventHandler?.({
        conversationId: conversation.id,
        event: { type: 'turn_complete', stopReason: 'end_turn' },
      });
      runtimeStatusHandler?.({ conversationId: conversation.id, status: 'connected' });
    });

    expect(latestStatus).toBe('connected');

    act(() => root.unmount());
    container.remove();
  });

  it('keeps conversation status prompting when Pi session_started arrives before content', async () => {
    const { container, root } = await mount();
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await latestConnections?.sendPrompt(conversation.id, [{ type: 'text', text: '继续' }]);
    });

    await act(async () => {
      runtimeEventHandler?.({
        conversationId: conversation.id,
        event: { type: 'session_started', sessionId: 'pi-session-1' },
      });
      runtimeStatusHandler?.({ conversationId: conversation.id, status: 'connected' });
    });

    expect(latestStatus).toBe('prompting');

    act(() => root.unmount());
    container.remove();
  });

  it('keeps tool rawInput when completion update only carries output', async () => {
    const { container, root } = await mount();
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      runtimeEventHandler?.({
        conversationId: conversation.id,
        event: {
          type: 'tool_call',
          toolCallId: 'cmd-1',
          title: 'bash',
          kind: 'execute',
          status: 'pending',
          rawInput: '{"command":"wc -l original.md"}',
        },
      });
      runtimeEventHandler?.({
        conversationId: conversation.id,
        event: {
          type: 'tool_call_update',
          toolCallId: 'cmd-1',
          status: 'completed',
          rawOutput: '110 original.md',
          rawOutputAppend: false,
        },
      });
    });

    expect(latestSnapshot?.turns[0].blocks).toContainEqual({
      type: 'tool_call',
      toolCallId: 'cmd-1',
      title: 'bash',
      kind: 'execute',
      status: 'completed',
      rawInput: '{"command":"wc -l original.md"}',
      rawOutput: '110 original.md',
    });

    act(() => root.unmount());
    container.remove();
  });

  it('clears prompting state when sendPrompt fails before runtime events arrive', async () => {
    const { container, root } = await mount();
    const button = container.querySelector('button')!;
    const agentAPI = window.agentAPI as { sendPromptToConversation: ReturnType<typeof vi.fn> };

    agentAPI.sendPromptToConversation.mockRejectedValueOnce(new Error('send failed'));

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    let thrown: unknown;
    await act(async () => {
      try {
        await latestConnections?.sendPrompt(conversation.id, [{ type: 'text', text: '继续' }]);
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('send failed');
    expect(latestStatus).toBe('error');

    act(() => root.unmount());
    container.remove();
  });
});

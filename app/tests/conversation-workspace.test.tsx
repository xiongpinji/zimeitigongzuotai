import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConversationAPI } from '../src/types/conversation';
import {
  ConversationWorkspaceProvider,
  loadWorkspaceBootstrap,
  mergeConversationIntoList,
  mergeConversationWithoutReorder,
  switchConversationAndLoadDetail,
} from '../src/contexts/conversation-workspace-context';
import { AcpConnectionsProvider } from '../src/contexts/acp-connections-context';
import { ConversationRuntimeProvider } from '../src/contexts/conversation-runtime-context';
import { ChatPane } from '../src/components/agent/ChatPane';

function buildConversationApiMock(): ConversationAPI {
  const conversations = [
    {
      id: 101,
      projectId: 'project-a',
      title: '会话 A',
      agentType: 'claude',
      status: 'active',
      externalId: null,
      parentId: null,
      messageCount: 2,
      createdAt: '2026-04-09T10:00:00.000Z',
      updatedAt: '2026-04-09T10:05:00.000Z',
    },
    {
      id: 102,
      projectId: 'project-a',
      title: '会话 B',
      agentType: 'claude',
      status: 'draft_local',
      externalId: null,
      parentId: null,
      messageCount: 0,
      createdAt: '2026-04-09T10:06:00.000Z',
      updatedAt: '2026-04-09T10:06:00.000Z',
    },
  ];

  return {
    list: vi.fn(async () => ({ conversations })),
    detail: vi.fn(async (conversationId: number) => ({
      ...conversations.find((item) => item.id === conversationId)!,
      turns: [
        {
          id: 1,
          conversationId,
          role: 'assistant',
          blocks: [{ type: 'text', text: `${conversationId} 的消息` }],
          createdAt: '2026-04-09T10:10:00.000Z',
        },
      ],
    })),
    create: vi.fn(),
    fork: vi.fn(),
    delete: vi.fn(async () => undefined),
    update: vi.fn(),
    open: vi.fn(async (_projectId: string, conversationId: number) => ({
      conversation: conversations.find((item) => item.id === conversationId)!,
      resumeExternalId: null,
    })),
    appendTurn: vi.fn(),
    getOpenedConversation: vi.fn(async () => conversations[0].id),
    setOpenedConversation: vi.fn(async () => undefined),
  };
}

describe('conversation workspace skeleton', () => {
  it('merges conversation list without duplicating same id', () => {
    const api = buildConversationApiMock();
    const existing = [
      {
        id: 101,
        projectId: 'project-a',
        title: '会话 A',
        agentType: 'claude',
        status: 'active',
        externalId: null,
        parentId: null,
        messageCount: 2,
        createdAt: '2026-04-09T10:00:00.000Z',
        updatedAt: '2026-04-09T10:05:00.000Z',
      },
    ];
    const incoming = {
      id: 101,
      projectId: 'project-a',
      title: '会话 A 已更新',
      agentType: 'claude',
      status: 'active',
      externalId: null,
      parentId: null,
      messageCount: 3,
      createdAt: '2026-04-09T10:00:00.000Z',
      updatedAt: '2026-04-09T10:06:00.000Z',
    };

    const merged = mergeConversationIntoList(existing, incoming);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('会话 A 已更新');
    expect(merged[0]?.messageCount).toBe(3);
    expect(api.list).not.toHaveBeenCalled();
  });

  it('loads conversation list and opened conversation id', async () => {
    const api = buildConversationApiMock();
    const result = await loadWorkspaceBootstrap('project-a', api);

    expect(result.conversations).toHaveLength(2);
    expect(result.openedConversationId).toBe(101);
    expect(result.activeConversationId).toBe(101);
  });

  it('switches active conversation and refreshes detail map', async () => {
    const api = buildConversationApiMock();
    const detailA = await switchConversationAndLoadDetail('project-a', 101, {}, api);
    const detailB = await switchConversationAndLoadDetail(
      'project-a',
      102,
      detailA.nextDetailMap,
      api,
    );

    expect(detailA.detail.turns[0]?.blocks).toEqual([{ type: 'text', text: '101 的消息' }]);
    expect(detailB.detail.turns[0]?.blocks).toEqual([{ type: 'text', text: '102 的消息' }]);
    expect(detailB.nextDetailMap[101]).toBeDefined();
    expect(detailB.nextDetailMap[102]).toBeDefined();
    expect(api.detail).toHaveBeenCalledTimes(2);
    expect(api.setOpenedConversation).toHaveBeenCalledTimes(2);
    expect(api.setOpenedConversation).toHaveBeenLastCalledWith('project-a', 102);
  });

  it('keeps original list order when switching to an existing conversation', () => {
    const existing = [
      {
        id: 102,
        projectId: 'project-a',
        title: '会话 B',
        agentType: 'claude',
        status: 'draft_local',
        externalId: null,
        parentId: null,
        messageCount: 0,
        createdAt: '2026-04-09T10:06:00.000Z',
        updatedAt: '2026-04-09T10:06:00.000Z',
      },
      {
        id: 101,
        projectId: 'project-a',
        title: '会话 A',
        agentType: 'claude',
        status: 'active',
        externalId: null,
        parentId: null,
        messageCount: 2,
        createdAt: '2026-04-09T10:00:00.000Z',
        updatedAt: '2026-04-09T10:05:00.000Z',
      },
    ];

    const merged = mergeConversationWithoutReorder(existing, {
      ...existing[1],
      title: '会话 A 已刷新',
      messageCount: 3,
    });

    expect(merged.map((item) => item.id)).toEqual([102, 101]);
    expect(merged[1]?.title).toBe('会话 A 已刷新');
    expect(merged[1]?.messageCount).toBe(3);
  });

  it('renders the workspace shell panes without auto-connecting by default', () => {
    const api = buildConversationApiMock();
    const html = renderToStaticMarkup(
      <ConversationWorkspaceProvider projectId="project-a" apiOverride={api}>
        <AcpConnectionsProvider>
          <ConversationRuntimeProvider>
            <div>
              <ChatPane
                projectDir="/tmp/project-a"
                explicitActivated={false}
                explicitConversationId={null}
                onSelectConversation={() => undefined}
                onCreateConversation={() => undefined}
                onDeleteConversation={() => undefined}
              />
            </div>
          </ConversationRuntimeProvider>
        </AcpConnectionsProvider>
      </ConversationWorkspaceProvider>,
    );

    // ChatPane 渲染会话切换入口（ConversationDropdown 触发 icon）。
    expect(html).toContain('data-testid="conversation-dropdown-trigger"');
  });
});

// @vitest-environment jsdom
//
// ChatPane 测试：承接原 ConversationDetailPane 行为——
//  - 渲染会话（标题 / agent 头 / 消息 / composer）
//  - 连接状态展示
//  - pendingPermission 渲染（经 MessageList 挂到末尾 assistant turn）
//  - 未选择会话 / 加载 / 错误等空态
//
// 策略：mock 两个数据/连接 hook（与 conversation-workspace 单测一致的隔离思路），
// 全权控制 detail / runtime / connection 状态，结构断言用 SSR。
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ConversationDetail,
  ConversationTurn,
  PendingPermission,
} from '../src/types/conversation';

// jsdom 默认无 matchMedia，补桩（ui 库部分组件会引用）。
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const detailState: {
  conversationId: number | null;
  detail: ConversationDetail | null;
  runtime: { turns: ConversationTurn[]; usage?: { used: number; size: number } } | null;
  loading: boolean;
  error: string | null;
} = {
  conversationId: 1,
  detail: null,
  runtime: null,
  loading: false,
  error: null,
};

const connectionState: {
  status: string;
  pendingPermission: PendingPermission | null;
  autoConnectError: string | null;
} = {
  status: 'connected',
  pendingPermission: null,
  autoConnectError: null,
};

vi.mock('../src/hooks/use-conversation-detail', () => ({
  useConversationDetail: () => detailState,
}));

// ChatPane header 渲染 ConversationDropdown，后者依赖 useConversationList。
vi.mock('../src/hooks/use-conversation-list', () => ({
  useConversationList: () => ({
    conversations: [],
    activeConversationId: null,
    loading: false,
    createConversation: vi.fn(async () => ({ id: 1, agentType: 'claude' })),
    deleteConversation: vi.fn(),
    renameConversation: vi.fn(async () => undefined),
  }),
}));

vi.mock('../src/hooks/use-connection-lifecycle', () => ({
  useConnectionLifecycle: () => ({
    status: connectionState.status,
    pendingPermission: connectionState.pendingPermission,
    autoConnectError: connectionState.autoConnectError,
    availableCommands: null,
    configOptions: null,
    availableModes: null,
    currentModeId: null,
    connect: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    respondPermission: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    setConfigOption: vi.fn(async () => undefined),
  }),
}));

// 在 mock 声明之后再导入被测组件。
import { ChatPane } from '../src/components/agent/ChatPane';

// 必填回调的轻量占位 + onOpenAgentSettings 探针。
const onOpenAgentSettings = vi.fn();
const chatPaneCallbacks = {
  explicitConversationId: null as number | null,
  onSelectConversation: () => undefined,
  onCreateConversation: () => undefined,
  onDeleteConversation: () => undefined,
  onOpenAgentSettings,
};

function renderChatPane(props: { projectDir: string; explicitActivated: boolean }) {
  return renderToStaticMarkup(<ChatPane {...props} {...chatPaneCallbacks} />);
}

function makeDetail(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: 1,
    projectId: 'project-a',
    title: '调试会话',
    agentType: 'pi',
    status: 'active',
    externalId: null,
    parentId: null,
    messageCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    turns: [],
    ...overrides,
  } as ConversationDetail;
}

function assistantTurn(id: number, text: string): ConversationTurn {
  return {
    id,
    conversationId: 1,
    role: 'assistant',
    createdAt: '2026-01-01T00:00:01.000Z',
    blocks: [{ type: 'text', text }],
  };
}

function makePending(): PendingPermission {
  return {
    requestId: 'req-1',
    toolCall: { title: 'write_text_file', rawInput: { path: 'b.md' } },
    options: [{ optionId: 'opt-allow', name: '允许一次', kind: 'allow_once' }],
  };
}

beforeEach(() => {
  detailState.conversationId = 1;
  detailState.detail = makeDetail();
  detailState.runtime = { turns: [assistantTurn(2, '我来处理')] };
  detailState.loading = false;
  detailState.error = null;
  connectionState.status = 'connected';
  connectionState.pendingPermission = null;
  connectionState.autoConnectError = null;
});

describe('ChatPane 渲染会话', () => {
  it('renders header title, agent icon/name, message and composer', () => {
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true });
    // ChatHeader 标题
    expect(html).toContain('调试会话');
    // 当前 agent 名 + 图标（agentType=pi）
    expect(html).toContain('aria-label="Pi"');
    expect(html).toContain('Pi');
    // 消息正文
    expect(html).toContain('我来处理');
    // composer 由 MessageInput 渲染（占位文案）
    expect(html).toContain('输入消息开始对话');
    // header 含会话切换 icon（ConversationDropdown 触发）。
    expect(html).toContain('data-testid="conversation-dropdown-trigger"');
    // header 含 agent 只读标记（点击进设置）。
    expect(html).toContain('data-testid="chat-header-agent"');
    // composer 含「模型+思考」合并芯片（agentId=pi → ModelReasoningPicker）。
    expect(html).toContain('data-agent-id="pi"');
    expect(html).toContain('data-testid="model-reasoning-chip"');
  });

  it('shows resumable marker when externalId exists, otherwise new session', () => {
    detailState.detail = makeDetail({ externalId: 'sess-123' });
    expect(
      renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true }),
    ).toContain('可恢复历史会话');

    detailState.detail = makeDetail({ externalId: null });
    expect(
      renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true }),
    ).toContain('新会话');
  });
});

describe('ChatPane 连接状态', () => {
  it('shows connected status label', () => {
    connectionState.status = 'connected';
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true });
    expect(html).toContain('已连接');
  });

  it('shows prompting status label and disables auto-connect hint when activated', () => {
    connectionState.status = 'prompting';
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true });
    expect(html).toContain('思考中...');
    expect(html).toContain('aria-label="停止生成"');
    expect(html).toContain('Agent 正在思考中');
    // explicitActivated=true 时不显示自动连接提示
    expect(html).not.toContain('发送消息后自动建立 ACP 连接');
  });

  it('shows connect hint when not explicitly activated', () => {
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: false });
    expect(html).toContain('当前仅展示会话内容');
    expect(html).toContain('发送消息后自动建立 ACP 连接');
  });

  it('shows usage label when runtime usage is present', () => {
    detailState.runtime = {
      turns: [assistantTurn(2, '正文')],
      usage: { used: 50, size: 100 },
    };
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true });
    expect(html).toContain('上下文 50.0%');
  });

  it('shows autoConnectError when present', () => {
    connectionState.autoConnectError = 'spawn ENOENT';
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true });
    expect(html).toContain('连接失败：spawn ENOENT');
  });
});

describe('ChatPane 权限卡', () => {
  it('renders pending permission card through MessageList', () => {
    connectionState.pendingPermission = makePending();
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true });
    expect(html).toContain('需要你授权工具调用');
    expect(html).toContain('write_text_file');
    expect(html).toContain('允许一次');
  });
});

describe('ChatPane 空态', () => {
  it('renders empty state when no conversation selected', () => {
    detailState.conversationId = null;
    detailState.detail = null;
    detailState.runtime = null;
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: false });
    expect(html).toContain('尚未选择会话');
    // 空态也渲染会话切换入口（ConversationDropdown）。
    expect(html).toContain('data-testid="conversation-dropdown-trigger"');
  });

  it('renders loading state while detail not yet loaded', () => {
    detailState.detail = null;
    detailState.loading = true;
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true });
    expect(html).toContain('正在加载会话详情');
  });

  it('renders error state when detail load fails', () => {
    detailState.detail = null;
    detailState.error = '网络错误';
    const html = renderChatPane({ projectDir: "/tmp/project-a", explicitActivated: true });
    expect(html).toContain('会话详情加载失败：网络错误');
  });
});

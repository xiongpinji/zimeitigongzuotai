// @vitest-environment jsdom
//
// AgentSidebar（SidebarWorkspaceShell）T6 重构后的结构测试：
//  - 不再渲染左侧 SessionListPane / ConversationToolbar / AgentPicker。
//  - 渲染 ChatPane（会话切换/新建收敛到 ChatPane header 的 ConversationDropdown）。
//
// 策略：mock useConversationList / useAcpConnections，并把 ChatPane 替换为占位探针，
// 仅断言 shell 把回调与会话切换委托给 ChatPane，不再有左列布局。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/hooks/use-conversation-list', () => ({
  useConversationList: () => ({
    activeConversationId: null,
    setActiveConversation: vi.fn(async () => undefined),
    deleteConversation: vi.fn(async () => undefined),
  }),
}));

vi.mock('../src/contexts/acp-connections-context', () => ({
  useAcpConnections: () => ({ disconnect: vi.fn(async () => undefined) }),
}));

// ChatPane 替换为占位探针，记录收到的 props。
const chatPaneProps: { received: Record<string, unknown> | null } = { received: null };
vi.mock('../src/components/agent/ChatPane', () => ({
  ChatPane: (props: Record<string, unknown>) => {
    chatPaneProps.received = props;
    return <div data-testid="chat-pane-stub" />;
  },
}));

beforeEach(() => {
  chatPaneProps.received = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

async function mount() {
  const { SidebarWorkspaceShell } = await import('../src/components/agent/AgentSidebar');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpenAgentSettings = vi.fn();
  await act(async () => {
    root.render(
      <SidebarWorkspaceShell projectDir="project-a" onOpenAgentSettings={onOpenAgentSettings} />,
    );
  });
  return { container, root, onOpenAgentSettings };
}

describe('AgentSidebar shell (T6)', () => {
  it('renders ChatPane and no longer renders SessionListPane / AgentPicker', async () => {
    const { container, root } = await mount();
    expect(container.querySelector('[data-testid="chat-pane-stub"]')).not.toBeNull();
    // 左列会话工具栏/列表/agent picker 已移除。
    expect(container.querySelector('[data-agent-id="claude"]')).toBeNull();
    expect(container.textContent).not.toContain('新建会话');
    act(() => root.unmount());
    container.remove();
  });

  it('passes conversation callbacks and onOpenAgentSettings to ChatPane', async () => {
    const { container, root, onOpenAgentSettings } = await mount();
    const props = chatPaneProps.received!;
    expect(typeof props.onSelectConversation).toBe('function');
    expect(typeof props.onCreateConversation).toBe('function');
    expect(typeof props.onDeleteConversation).toBe('function');
    expect(props.onOpenAgentSettings).toBe(onOpenAgentSettings);
    expect(props.projectDir).toBe('project-a');
    act(() => root.unmount());
    container.remove();
  });
});

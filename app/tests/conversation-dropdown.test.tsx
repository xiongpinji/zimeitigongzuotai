// @vitest-environment jsdom
//
// ConversationDropdown 测试：
//  - icon 触发按钮点击展开/收起 popover。
//  - 展开后列出会话 + 搜索过滤。
//  - 「新建会话」项调 createConversation，agentType 取 getPreferredAgentType()（全局默认 agent）。
//  - 选择 / 删除回调被触发。
//  - filterConversations 纯函数过滤逻辑。
//
// 策略：mock useConversationList 暴露被断言的 conversations/createConversation 等，
// 用 jsdom + createRoot + act 驱动真实交互。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const conversations = [
  { id: 101, title: '播客脚本会话', agentType: 'claude', status: 'active', externalId: null },
  { id: 102, title: '封面设计会话', agentType: 'codex', status: 'active', externalId: 'sess-1' },
];

const createConversation = vi.fn(async (input: { agentType: string }) => ({
  id: 999,
  agentType: input.agentType,
}));
const deleteConversation = vi.fn();
const renameConversation = vi.fn(async () => undefined);

vi.mock('../src/hooks/use-conversation-list', () => ({
  useConversationList: () => ({
    conversations,
    activeConversationId: 101,
    loading: false,
    createConversation,
    deleteConversation,
    renameConversation,
  }),
}));

import { ConversationDropdown, filterConversations } from '../src/components/agent/ConversationDropdown';

const getConfig = vi.fn();

beforeEach(() => {
  createConversation.mockClear();
  deleteConversation.mockClear();
  renameConversation.mockClear();
  getConfig.mockReset();
  // getPreferredAgentType → resolvePreferredAgentType：全局激活 agent 为 codex。
  getConfig.mockResolvedValue({ activeAgentId: 'codex' });
  (window as unknown as { agentAPI: unknown }).agentAPI = { getConfig };
});

afterEach(() => {
  delete (window as unknown as { agentAPI?: unknown }).agentAPI;
});

const noop = () => undefined;

async function mount(overrides: Partial<Parameters<typeof ConversationDropdown>[0]> = {}) {
  const props = {
    explicitConversationId: 101,
    onSelectConversation: vi.fn(),
    onCreateConversation: vi.fn(),
    onDeleteConversation: vi.fn(),
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ConversationDropdown {...props} />);
  });
  return { container, root, props };
}

function clickTrigger(container: HTMLElement) {
  const trigger = container.querySelector('[data-testid="conversation-dropdown-trigger"]') as HTMLButtonElement;
  act(() => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('filterConversations', () => {
  it('returns all on empty query', () => {
    expect(filterConversations(conversations, '')).toHaveLength(2);
    expect(filterConversations(conversations, '   ')).toHaveLength(2);
  });
  it('filters by case-insensitive title includes', () => {
    expect(filterConversations(conversations, '封面')).toHaveLength(1);
    expect(filterConversations(conversations, '不存在')).toHaveLength(0);
  });
});

describe('ConversationDropdown', () => {
  it('toggles popover open/closed on trigger click', async () => {
    const { container, root } = await mount();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    clickTrigger(container);
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    clickTrigger(container);
    expect(container.querySelector('[role="menu"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('lists conversations when open', async () => {
    const { container, root } = await mount();
    clickTrigger(container);
    expect(container.querySelector('[data-conversation-id="101"]')).not.toBeNull();
    expect(container.querySelector('[data-conversation-id="102"]')).not.toBeNull();
    expect(container.textContent).toContain('播客脚本会话');
    expect(container.textContent).toContain('封面设计会话');
    act(() => root.unmount());
    container.remove();
  });

  it('filters conversations via the search box', async () => {
    const { container, root } = await mount();
    clickTrigger(container);
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, '封面');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[data-conversation-id="102"]')).not.toBeNull();
    expect(container.querySelector('[data-conversation-id="101"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('creates a conversation with the preferred agent (codex)', async () => {
    const onCreateConversation = vi.fn();
    const { container, root } = await mount({ onCreateConversation });
    clickTrigger(container);
    const createButton = container.querySelector(
      '[data-testid="conversation-dropdown-create"]',
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(createConversation.mock.calls[0][0]).toMatchObject({ agentType: 'codex' });
    expect(onCreateConversation).toHaveBeenCalledWith(999);
    act(() => root.unmount());
    container.remove();
  });

  it('invokes onSelectConversation when clicking a conversation', async () => {
    const onSelectConversation = vi.fn();
    const { container, root } = await mount({ onSelectConversation });
    clickTrigger(container);
    const item = container
      .querySelector('[data-conversation-id="102"]')!
      .querySelector('button') as HTMLButtonElement;
    act(() => {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectConversation).toHaveBeenCalledWith(102);
    act(() => root.unmount());
    container.remove();
  });

  it('invokes onDeleteConversation when clicking the delete button', async () => {
    const onDeleteConversation = vi.fn();
    const { container, root } = await mount({ onDeleteConversation });
    clickTrigger(container);
    const deleteButton = container.querySelector(
      '[aria-label="删除封面设计会话"]',
    ) as HTMLButtonElement;
    act(() => {
      deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDeleteConversation).toHaveBeenCalledWith(102);
    act(() => root.unmount());
    container.remove();
  });
});

void noop;

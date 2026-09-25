// @vitest-environment jsdom
//
// MessageList 测试：混合 turns 渲染 + 权限卡归属 + 空态。
// 结构断言用 SSR（renderToStaticMarkup）；置底涉及 DOM 滚动，jsdom 下只测“渲染正确”，
// 真实置底行为标注手测（jsdom 不计算 scrollHeight/clientHeight 布局）。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageList } from '../src/components/agent/MessageList';
import type { ConversationTurn, PendingPermission } from '../src/types/conversation';

// 补 ui 库（如 Badge）在渲染时引用的 window.matchMedia（jsdom 默认不实现）。
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

function userTurn(id: number, text: string): ConversationTurn {
  return {
    id,
    conversationId: 1,
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    blocks: [{ type: 'text', text }],
  };
}

function assistantTurn(id: number, text: string, agentId?: string): ConversationTurn {
  return {
    id,
    conversationId: 1,
    role: 'assistant',
    createdAt: '2026-01-01T00:00:01.000Z',
    agentId,
    blocks: [{ type: 'text', text }],
  };
}

function makePending(overrides: Partial<PendingPermission> = {}): PendingPermission {
  return {
    requestId: 'req-1',
    toolCall: { title: 'write_text_file', rawInput: { path: 'b.md' } },
    options: [
      { optionId: 'opt-allow', name: '允许一次', kind: 'allow_once' },
      { optionId: 'opt-reject', name: '拒绝', kind: 'reject_once' },
    ],
    ...overrides,
  };
}

describe('MessageList 混合 turns', () => {
  it('renders UserMessage and AssistantMessage body without an agent header', () => {
    const turns = [
      userTurn(1, '帮我读一下文件'),
      assistantTurn(2, '好的，我来读取', 'pi'),
    ];
    const html = renderToStaticMarkup(<MessageList turns={turns} />);
    // UserMessage 文本
    expect(html).toContain('帮我读一下文件');
    // AssistantMessage 正文
    expect(html).toContain('好的，我来读取');
    // 不再渲染 agent 身份头（无 Pi 图标 / 名称）。
    expect(html).not.toContain('aria-label="Pi"');
  });

  it('renders assistant body even when turn has no agentId (fallbackAgentId)', () => {
    const turns = [assistantTurn(1, '正文')];
    delete turns[0].agentId;
    const html = renderToStaticMarkup(
      <MessageList turns={turns} fallbackAgentId="pi" />,
    );
    expect(html).toContain('正文');
    expect(html).not.toContain('aria-label="Pi"');
  });
});

describe('MessageList 权限卡归属', () => {
  it('renders permission card on the last assistant turn', () => {
    const turns = [userTurn(1, '问题'), assistantTurn(2, '回答')];
    const html = renderToStaticMarkup(
      <MessageList turns={turns} pendingPermission={makePending()} />,
    );
    expect(html).toContain('需要你授权工具调用');
    expect(html).toContain('write_text_file');
    expect(html).toContain('允许一次');
  });

  it('renders permission card standalone when there is no assistant turn', () => {
    const turns = [userTurn(1, '问题')];
    const html = renderToStaticMarkup(
      <MessageList turns={turns} pendingPermission={makePending()} />,
    );
    expect(html).toContain('需要你授权工具调用');
    expect(html).toContain('write_text_file');
  });

  it('does not render permission card when pendingPermission is null', () => {
    const turns = [assistantTurn(1, '回答')];
    const html = renderToStaticMarkup(
      <MessageList turns={turns} pendingPermission={null} />,
    );
    expect(html).not.toContain('需要你授权工具调用');
  });
});

describe('MessageList 空态', () => {
  it('renders empty state without crashing for empty turns', () => {
    const html = renderToStaticMarkup(<MessageList turns={[]} />);
    expect(html).toContain('暂无消息');
  });
});

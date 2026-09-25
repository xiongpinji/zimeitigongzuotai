// @vitest-environment jsdom
//
// ToolGroupBlock + AssistantMessage 同名工具调用聚合测试。
// 结构断言用 SSR（renderToStaticMarkup），交互用 jsdom + createRoot + act。
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantMessage } from '../src/components/agent/AssistantMessage';
import { aggregateStatus } from '../src/components/agent/ToolGroupBlock';
import type { ConversationBlock, ConversationTurn } from '../src/types/conversation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 补 ui 库引用的 window.matchMedia（jsdom 默认不实现）。
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

function toolCall(
  title: string,
  status: string,
  id: string,
  rawInput?: string,
): ConversationBlock {
  return { type: 'tool_call', toolCallId: id, title, kind: 'edit', status, rawInput };
}

function makeTurn(blocks: ConversationBlock[]): ConversationTurn {
  return {
    id: 1,
    conversationId: 1,
    role: 'assistant',
    createdAt: '2026-01-01T00:00:00.000Z',
    agentId: 'claude',
    blocks,
  };
}

describe('ToolGroupBlock aggregateStatus', () => {
  it('全 completed → ok', () => {
    expect(
      aggregateStatus([
        { type: 'tool_call', toolCallId: 'a', title: 'Edit', kind: '', status: 'completed' },
        { type: 'tool_call', toolCallId: 'b', title: 'Edit', kind: '', status: 'completed' },
      ]),
    ).toBe('ok');
  });

  it('任一 failed → error', () => {
    expect(
      aggregateStatus([
        { type: 'tool_call', toolCallId: 'a', title: 'Edit', kind: '', status: 'completed' },
        { type: 'tool_call', toolCallId: 'b', title: 'Edit', kind: '', status: 'failed' },
      ]),
    ).toBe('error');
  });

  it('任一 running/pending → running（优先于 error）', () => {
    expect(
      aggregateStatus([
        { type: 'tool_call', toolCallId: 'a', title: 'Edit', kind: '', status: 'failed' },
        { type: 'tool_call', toolCallId: 'b', title: 'Edit', kind: '', status: 'in_progress' },
      ]),
    ).toBe('running');
  });

  it('运行时缺少 status 时按 running 兜底', () => {
    expect(
      aggregateStatus([
        { type: 'tool_call', toolCallId: 'a', title: 'Edit', kind: '', status: undefined },
      ] as unknown as Parameters<typeof aggregateStatus>[0]),
    ).toBe('running');
  });
});

describe('AssistantMessage 同名工具调用聚合', () => {
  it('3 个连续同名 tool_call → 聚合卡 ×3，展开后含 3 个工具', () => {
    const turn = makeTurn([
      toolCall('Edit', 'completed', 'e1', '{"path":"a.ts"}'),
      toolCall('Edit', 'completed', 'e2', '{"path":"b.ts"}'),
      toolCall('Edit', 'completed', 'e3', '{"path":"c.ts"}'),
    ]);
    const html = renderToStaticMarkup(<AssistantMessage turn={turn} />);
    expect(html).toContain('编辑');
    expect(html).toContain('3 次调用');
    expect(html).toContain('已完成');
  });

  it('聚合卡遇到缺 title/kind/status 的历史工具调用时不崩溃', () => {
    const brokenTool = {
      type: 'tool_call',
      toolCallId: 'broken',
      title: undefined,
      kind: undefined,
      status: undefined,
    } as unknown as ConversationBlock;
    const turn = makeTurn([brokenTool, brokenTool]);

    const html = renderToStaticMarkup(<AssistantMessage turn={turn} />);

    expect(html).toContain('工具调用');
    expect(html).toContain('2 次调用');
    expect(html).toContain('运行中');
  });

  it('展开聚合卡后列出各个工具卡（input 细节）', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const turn = makeTurn([
      toolCall('Edit', 'completed', 'e1', '{"path":"a.ts"}'),
      toolCall('Edit', 'completed', 'e2', '{"path":"b.ts"}'),
      toolCall('Edit', 'completed', 'e3', '{"path":"c.ts"}'),
    ]);
    act(() => {
      root.render(<AssistantMessage turn={turn} />);
    });

    // 聚合卡头按钮（aria-expanded）。
    const groupHeader = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('3 次调用'),
    )!;
    expect(groupHeader).toBeTruthy();
    act(() => {
      groupHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 展开后内部应含 3 个单工具卡：组头 1 个 + 3 个单卡头 = 4 个按钮。
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBe(4);
    // 单卡展开后会展示每个工具的目标预览。
    expect(container.textContent).toContain('a.ts');
    expect(container.textContent).toContain('b.ts');
    expect(container.textContent).toContain('c.ts');

    act(() => root.unmount());
    container.remove();
  });

  it('命令聚合默认收起；点击组头后列出命令，再点击单条行展开 shell', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const turn = makeTurn([
      { type: 'tool_call', toolCallId: 'c1', title: 'bash', kind: 'execute', status: 'completed', rawInput: '{"command":"wc -l original.md"}', rawOutput: '110 original.md' },
      { type: 'tool_call', toolCallId: 'c2', title: 'bash', kind: 'execute', status: 'completed', rawInput: '{"command":"rm .lingji/edit-lock.json"}', rawOutput: '' },
    ]);
    act(() => {
      root.render(<AssistantMessage turn={turn} />);
    });

    // 默认只显示命令组摘要，不直接露出命令行。
    expect(container.textContent).toContain('已运行 2 条命令');
    expect(container.textContent).not.toContain('wc -l original.md');
    expect(container.textContent).not.toContain('rm .lingji/edit-lock.json');

    const groupHeader = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('已运行 2 条命令'),
    )!;
    act(() => {
      groupHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 展开组头后，两条命令文本可见；shell 输出仍然保持折叠。
    expect(container.textContent).toContain('wc -l original.md');
    expect(container.textContent).toContain('rm .lingji/edit-lock.json');
    expect(container.textContent).not.toContain('$ wc -l original.md');
    expect(container.textContent).not.toContain('110 original.md');

    // 点第二条命令行，展开它的 shell。
    const rmRow = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('rm .lingji/edit-lock.json'),
    )!;
    act(() => {
      rmRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('$ rm .lingji/edit-lock.json');
    expect(container.textContent).toContain('(no output)');
    // 第一条没动，仍然没有 shell 输出。
    expect(container.textContent).not.toContain('$ wc -l original.md');
    expect(container.textContent).not.toContain('110 original.md');

    expect(container.textContent).not.toContain('Command');
    expect(container.textContent).not.toContain('Output');

    act(() => root.unmount());
    container.remove();
  });

  it('不同名 tool_call 不聚合（各自单卡，无聚合 summary）', () => {
    const turn = makeTurn([
      toolCall('Edit', 'completed', 'e1'),
      toolCall('Read', 'completed', 'r1'),
    ]);
    const html = renderToStaticMarkup(<AssistantMessage turn={turn} />);
    // descriptor.label 中文化后看到的是 "编辑文件" / "读取文件"，不再渲染 rawTitle。
    expect(html).toContain('编辑文件');
    expect(html).toContain('读取文件');
    expect(html).not.toContain('×2');
    expect(html).not.toContain('Edit ×');
  });

  it('单个 tool_call 不包 group', () => {
    const turn = makeTurn([toolCall('Edit', 'completed', 'e1')]);
    const html = renderToStaticMarkup(<AssistantMessage turn={turn} />);
    expect(html).toContain('编辑');
    expect(html).not.toContain('1 次调用');
  });

  it('整体状态：组内有 failed → 组徽章 error（aria-label=失败）', () => {
    const turn = makeTurn([
      toolCall('Edit', 'completed', 'e1'),
      toolCall('Edit', 'failed', 'e2'),
      toolCall('Edit', 'completed', 'e3'),
    ]);
    const html = renderToStaticMarkup(<AssistantMessage turn={turn} />);
    expect(html).toContain('3 次调用');
    expect(html).toContain('调用失败');
    expect(html).toContain('aria-label="失败"');
  });

  it('text block 打断聚合（两侧同名 tool_call 不合并）', () => {
    const turn = makeTurn([
      toolCall('Edit', 'completed', 'e1'),
      { type: 'text', text: '中间穿插一段说明' },
      toolCall('Edit', 'completed', 'e2'),
    ]);
    const html = renderToStaticMarkup(<AssistantMessage turn={turn} />);
    // 被打断 → 两段各 1 个，不应出现聚合 ×N。
    expect(html).not.toContain('×2');
    expect(html).toContain('中间穿插一段说明');
  });
});

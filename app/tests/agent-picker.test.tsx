// @vitest-environment jsdom
//
// AgentPicker 测试：候选渲染 / 选择回调 / 当前高亮 / 可用性置灰。
// 当前 runtime 仅内置 pi（codex/claude 已下线），候选列表自然只有 Pi 一项。
// 交互用 jsdom + createRoot + act；可用性通过 mock window.agentAPI.runPreflight 注入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentPicker } from '../src/components/agent/AgentPicker';

// 让 React 在 jsdom 下识别 act() 边界。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runPreflight = vi.fn();

beforeEach(() => {
  runPreflight.mockReset();
  // 默认：全部 agent 可用（pass）。
  runPreflight.mockResolvedValue([{ label: 'CLI', status: 'pass', message: 'ok' }]);
  (window as unknown as { agentAPI: { runPreflight: typeof runPreflight } }).agentAPI = {
    runPreflight,
  };
});

afterEach(() => {
  delete (window as unknown as { agentAPI?: unknown }).agentAPI;
});

/** 挂载并等待挂载时的 preflight Promise 解析（flush microtasks）。 */
async function mount(props: { value: string; onChange: (id: string) => void }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AgentPicker value={props.value} onChange={props.onChange} />);
  });
  // 等待 Promise.all(runPreflight) 解析后的 setState。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

describe('AgentPicker', () => {
  it('renders the single bundled agent (pi)', async () => {
    const { container, root } = await mount({ value: 'pi', onChange: () => undefined });

    const text = container.textContent ?? '';
    expect(text).toContain('Pi');
    // codex/claude 已下线，不应再出现。
    expect(text).not.toContain('Claude');
    expect(text).not.toContain('Codex');

    // 候选携带 data-agent-id，便于定位。
    expect(container.querySelector('[data-agent-id="pi"]')).not.toBeNull();
    expect(container.querySelector('[data-agent-id="claude"]')).toBeNull();
    expect(container.querySelector('[data-agent-id="codex"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it('calls onChange with the agent id when an item is clicked', async () => {
    const onChange = vi.fn();
    const { container, root } = await mount({ value: '', onChange });

    const piLabel = container.querySelector('[data-agent-id="pi"]')!;
    const button = piLabel.closest('button')!;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith('pi');

    act(() => root.unmount());
    container.remove();
  });

  it('highlights the current value via aria-pressed', async () => {
    const selected = await mount({ value: 'pi', onChange: () => undefined });
    const piButton = selected.container.querySelector('[data-agent-id="pi"]')!.closest('button')!;
    expect(piButton.getAttribute('aria-pressed')).toBe('true');
    act(() => selected.root.unmount());
    selected.container.remove();

    // 当前值非 pi（未选中）→ pi 项不应高亮。
    const unselected = await mount({ value: '', onChange: () => undefined });
    const piButton2 = unselected.container.querySelector('[data-agent-id="pi"]')!.closest('button')!;
    expect(piButton2.getAttribute('aria-pressed')).toBe('false');
    act(() => unselected.root.unmount());
    unselected.container.remove();
  });

  it('disables an agent whose preflight fails and shows the install guide tooltip', async () => {
    // pi 探测失败（未安装）→ 置灰。
    runPreflight.mockImplementation(async (agentId?: string) => {
      if (agentId === 'pi') {
        return [{ label: 'CLI', status: 'fail', message: 'pi not found' }];
      }
      return [{ label: 'CLI', status: 'pass', message: 'ok' }];
    });

    const onChange = vi.fn();
    const { container, root } = await mount({ value: 'pi', onChange });

    const piLabel = container.querySelector('[data-agent-id="pi"]')! as HTMLElement;
    const piButton = piLabel.closest('button') as HTMLButtonElement;

    // 置灰：按钮 disabled + 标注 unavailable。
    expect(piButton.disabled).toBe(true);
    expect(piLabel.getAttribute('data-availability')).toBe('unavailable');
    // tooltip 使用 installGuide（包含 pi 安装提示）。
    expect(piLabel.getAttribute('title') ?? '').toContain('pi');

    act(() => root.unmount());
    container.remove();
  });
});

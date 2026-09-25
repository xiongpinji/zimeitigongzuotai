// @vitest-environment jsdom
//
// ModelReasoningPicker 测试（取代旧 model-picker / thinking-level-picker）：
// - 芯片直接展示模型名 + 当前思考档，不再展示 agent 框架名。
// - popover：顶部「推理」档位列表 + 「模型」行展开二级浮层；选择回调正确。
// - 该 agent 无 reasoningOptions 时退化为纯模型列表（直接列在 popover 内）。
// - 动态模型：经 window.agentAPI.listModels 拉取 live 模型并渲染；无桥接回退兜底。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelReasoningPicker } from '../src/components/agent/ModelReasoningPicker';
import { getAgentPresentation } from '../src/lib/agent-presentation';
import { __clearAgentModelsCache } from '../src/lib/use-agent-models';

vi.mock('../src/lib/agent-presentation', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/agent-presentation')>();
  return {
    ...actual,
    getAgentPresentation: (id: string | undefined | null) =>
      id === '__no-reasoning__'
        ? {
            id: '__no-reasoning__',
            displayName: 'NoReasoning',
            managed: false,
            reasoningOptions: [],
            models: [
              { id: 'default', label: 'Default' },
              { id: 'x/m1', label: 'Model One' },
            ],
            defaultModel: 'default',
          }
        : actual.getAgentPresentation(id),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface MountProps {
  agentId?: string;
  modelValue?: string;
  onModelChange?: (id: string) => void;
  reasoningValue?: string;
  onReasoningChange?: (id: string) => void;
}

async function mount(props: MountProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ModelReasoningPicker
        agentId={props.agentId ?? 'pi'}
        modelValue={props.modelValue}
        onModelChange={props.onModelChange ?? (() => undefined)}
        reasoningValue={props.reasoningValue}
        onReasoningChange={props.onReasoningChange ?? (() => undefined)}
      />,
    );
  });
  await flush();
  return { container, root };
}

function click(el: Element | null) {
  act(() => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('ModelReasoningPicker', () => {
  beforeEach(() => {
    __clearAgentModelsCache();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as { agentAPI?: unknown }).agentAPI;
  });

  it('芯片展示模型名 + 当前思考档，且不展示 agent 框架名', async () => {
    const presentation = getAgentPresentation('pi');
    const { container, root } = await mount({ agentId: 'pi' });

    const chip = container.querySelector('[data-testid="model-reasoning-chip"]')!;
    expect(chip).not.toBeNull();
    // 当前思考档 label（pi 默认档）。
    const reasoning = presentation.reasoningOptions!.find(
      (o) => o.id === presentation.defaultReasoning,
    )!;
    expect(chip.textContent).toContain(reasoning.label);
    // 不应展示 agent 名（pi/Pi）。
    expect(chip.textContent).not.toContain(presentation.displayName);

    act(() => root.unmount());
  });

  it('popover 列出推理档位，选择回调 onReasoningChange', async () => {
    const onReasoningChange = vi.fn();
    const { container, root } = await mount({ agentId: 'pi', onReasoningChange });

    click(container.querySelector('[data-testid="model-reasoning-chip"]'));
    const high = container.querySelector('[data-reasoning-id="high"]');
    expect(high).not.toBeNull();
    click(high);
    expect(onReasoningChange).toHaveBeenCalledWith('high');

    act(() => root.unmount());
  });

  it('「模型」行展开二级浮层并能选模型，回调 onModelChange', async () => {
    const onModelChange = vi.fn();
    const { container, root } = await mount({ agentId: 'pi', onModelChange });

    click(container.querySelector('[data-testid="model-reasoning-chip"]'));
    // 二级浮层默认不展开。
    expect(document.querySelector('.model-reasoning-picker__flyout')).toBeNull();

    click(container.querySelector('[data-testid="model-reasoning-model-trigger"]'));
    const flyout = document.querySelector('.model-reasoning-picker__flyout');
    expect(flyout).not.toBeNull();

    // 选一个具体模型（pi 静态兜底含 anthropic/claude-sonnet-4-5）。
    const opt = flyout!.querySelector('[data-model-id="anthropic/claude-sonnet-4-5"]');
    expect(opt).not.toBeNull();
    click(opt);
    expect(onModelChange).toHaveBeenCalledWith('anthropic/claude-sonnet-4-5');

    act(() => root.unmount());
  });

  it('无 reasoningOptions 的 agent → popover 直接列模型，无二级浮层入口', async () => {
    const onModelChange = vi.fn();
    const { container, root } = await mount({ agentId: '__no-reasoning__', onModelChange });

    click(container.querySelector('[data-testid="model-reasoning-chip"]'));
    // 无「模型」二级入口。
    expect(container.querySelector('[data-testid="model-reasoning-model-trigger"]')).toBeNull();
    // 直接列模型。
    const m1 = container.querySelector('[data-model-id="x/m1"]');
    expect(m1).not.toBeNull();
    click(m1);
    expect(onModelChange).toHaveBeenCalledWith('x/m1');

    act(() => root.unmount());
  });

  it('从 listModels 拉取的 live 模型出现在模型浮层', async () => {
    (window as { agentAPI?: unknown }).agentAPI = {
      listModels: vi.fn().mockResolvedValue({
        models: [
          { id: 'default', label: 'gpt-5.1' },
          { id: 'openai/gpt-5', label: 'openai/gpt-5' },
        ],
        source: 'live',
      }),
    };

    const { container, root } = await mount({ agentId: 'pi' });

    click(container.querySelector('[data-testid="model-reasoning-chip"]'));
    click(container.querySelector('[data-testid="model-reasoning-model-trigger"]'));

    expect(document.querySelector('[data-model-id="openai/gpt-5"]')).not.toBeNull();
    expect(
      (window.agentAPI as { listModels: ReturnType<typeof vi.fn> }).listModels,
    ).toHaveBeenCalledWith('pi');

    act(() => root.unmount());
  });
});

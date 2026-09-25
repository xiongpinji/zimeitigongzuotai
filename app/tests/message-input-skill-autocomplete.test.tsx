// @vitest-environment jsdom
//
// MessageInput $ 技能补全最小渲染测试：
// - skillItems 非空时输入 $ 弹出 $<id> 菜单项，mousedown 选择后插入 $<id>。
// - skillItems 为空时输入 $ 不弹菜单。
//
// 项目未引入 @testing-library/react；沿用既有 tests/agent-settings-skills.test.tsx
// 的 createRoot + act 手动渲染约定 + matchMedia shim。React onChange 监听原生
// input 事件：用 HTMLTextAreaElement.prototype.value setter 改值再 dispatch 'input'，
// 并显式设置 selectionStart 以驱动 handleTextChange 的光标判定。
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MessageInput } from '../src/components/agent/MessageInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 不实现 scrollIntoView（AutocompleteMenu 选中项滚动用）。
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}

// 补 ui 库依赖链可能引用的 window.matchMedia（jsdom 默认不实现）。
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

const skillItems = [
  { id: 'lingji-video-workflow', label: '$lingji-video-workflow', description: '灵机剪影视频工作流' },
];

const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value',
)!.set!;

/** 模拟用户输入：设值 + 设光标 + 触发 React onChange（监听原生 input 事件）。 */
function typeInto(ta: HTMLTextAreaElement, value: string) {
  nativeTextareaValueSetter.call(ta, value);
  ta.selectionStart = value.length;
  ta.selectionEnd = value.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

let active: { root: Root; container: HTMLElement } | null = null;

async function mount(props: Parameters<typeof MessageInput>[0]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MessageInput {...props} />);
  });
  active = { root, container };
  return container;
}

afterEach(() => {
  if (active) {
    const { root, container } = active;
    act(() => root.unmount());
    container.remove();
    active = null;
  }
});

function findByText(container: HTMLElement, text: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll('*')).find(
      (el) => el.children.length === 0 && (el.textContent ?? '') === text,
    ) as HTMLElement | undefined
  ) ?? null;
}

describe('MessageInput $ 技能补全', () => {
  it('输入 $ 展示启用 skill，选择后插入 $id', async () => {
    const container = await mount({ onSend: () => {}, skillItems });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;

    await act(async () => {
      typeInto(ta, '$');
    });

    const item = findByText(container, '$lingji-video-workflow');
    expect(item).not.toBeNull();

    await act(async () => {
      item!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(ta.value).toContain('$lingji-video-workflow');
  });

  it('skillItems 为空时输入 $ 不弹菜单', async () => {
    const container = await mount({ onSend: () => {}, skillItems: [] });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;

    await act(async () => {
      typeInto(ta, '$');
    });

    expect(findByText(container, '$lingji-video-workflow')).toBeNull();
  });
});

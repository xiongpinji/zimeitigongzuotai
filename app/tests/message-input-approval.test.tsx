// @vitest-environment jsdom
//
// MessageInput 审批 pill + 「+」Dropdown 最小渲染测试。
// 沿用 tests/message-input-skill-autocomplete.test.tsx 的 createRoot + act 约定。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MessageInput } from '../src/components/agent/MessageInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const skillItems = [
  { id: 'lingji-video-workflow', label: '$lingji-video-workflow', description: '灵机剪影视频工作流' },
];

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

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('MessageInput 审批模式 pill', () => {
  it('提供 onPermissionPolicyChange 时显示当前模式标签', async () => {
    const container = await mount({ onSend: () => {}, permissionPolicy: 'tiered', onPermissionPolicyChange: () => {} });
    expect(findByText(container, '替我审批')).not.toBeNull();
  });

  it('未提供 onPermissionPolicyChange 时不渲染 pill', async () => {
    const container = await mount({ onSend: () => {} });
    expect(findByText(container, '替我审批')).toBeNull();
    expect(findByText(container, '完全访问')).toBeNull();
  });

  it('打开后选择「完全访问」回调 auto_approve', async () => {
    const onChange = vi.fn();
    const container = await mount({ onSend: () => {}, permissionPolicy: 'tiered', onPermissionPolicyChange: onChange });
    const pill = container.querySelector('[aria-label="审批模式"]')!;
    await click(pill);
    const opt = findByText(container, '完全访问');
    expect(opt).not.toBeNull();
    await click(opt!);
    expect(onChange).toHaveBeenCalledWith('auto_approve');
  });
});

describe('MessageInput 「+」Dropdown', () => {
  it('打开后展示添加文件 / 添加照片 / Skill 入口（skill 不内联铺开）', async () => {
    const container = await mount({ onSend: () => {}, skillItems });
    const plus = container.querySelector('[aria-label="添加内容"]')!;
    await click(plus);
    expect(findByText(container, '添加文件')).not.toBeNull();
    expect(findByText(container, '添加照片')).not.toBeNull();
    expect(findByText(container, 'Skill')).not.toBeNull();
    // 二级菜单：未点击 Skill 前不铺开技能项。
    expect(findByText(container, '$lingji-video-workflow')).toBeNull();
  });

  it('点击 Skill 弹出二级浮层，选中后向输入框插入 $id', async () => {
    const container = await mount({ onSend: () => {}, skillItems });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    const plus = container.querySelector('[aria-label="添加内容"]')!;
    await click(plus);
    // 浮层经 portal 渲染到 document.body，未点击 Skill 前不存在。
    expect(findByText(document.body, '$lingji-video-workflow')).toBeNull();
    await click(findByText(container, 'Skill')!);
    const item = findByText(document.body, '$lingji-video-workflow');
    expect(item).not.toBeNull();
    await click(item!);
    expect(ta.value).toContain('$lingji-video-workflow');
  });

  it('无启用 skill 时不渲染 Skill 入口', async () => {
    const container = await mount({ onSend: () => {}, skillItems: [] });
    const plus = container.querySelector('[aria-label="添加内容"]')!;
    await click(plus);
    expect(findByText(container, 'Skill')).toBeNull();
  });
});

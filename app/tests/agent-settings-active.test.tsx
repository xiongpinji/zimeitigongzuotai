// @vitest-environment jsdom
//
// AgentSettingsTab 瘦身后（pi SDK 模式）的最小渲染测试：
// - 设置面板不再渲染「设为当前」「Model 下拉」「API Key」等失效项。
// - Skill 库管理：内置 skill 无删除按钮、用户 skill 有删除按钮。
// - 「添加 Skill 库…」调用 agentAPI.addSkill，成功后刷新 listSkills。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ResolvedAgentSkill } from '../electron/acp/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const builtin: ResolvedAgentSkill = {
  id: 'lingji-video-workflow',
  displayName: '灵机剪影视频工作流',
  description: '内置工作流',
  source: 'builtin',
  rootPath: '/u/.lingji/agent-skills/lingji-video-workflow',
  skillFilePath: '/u/.lingji/agent-skills/lingji-video-workflow/SKILL.md',
  defaultEnabled: true,
  loadModesByAgent: { pi: ['native', 'prompt_injection'] },
  enabled: true,
  status: 'available',
};
const userSkill: ResolvedAgentSkill = {
  id: 'my-skill',
  displayName: 'My Skill',
  description: '用户导入',
  source: 'user',
  rootPath: '/u/.lingji/agent-skills/my-skill',
  skillFilePath: '/u/.lingji/agent-skills/my-skill/SKILL.md',
  defaultEnabled: true,
  loadModesByAgent: { pi: ['native', 'prompt_injection'] },
  enabled: true,
  status: 'available',
};

const getConfig = vi.fn();
const saveConfig = vi.fn(async () => undefined);
const listSkills = vi.fn(async () => [builtin, userSkill]);
const addSkill = vi.fn(async () => ({ canceled: false as const, addedId: 'new-skill' }));
const removeSkill = vi.fn(async () => ({ ok: true as const }));

function baseConfig() {
  return {
    permissionPolicy: 'tiered',
    activeAgentId: 'pi',
    agents: {
      pi: {
        enabled: true,
        version: '',
        sortOrder: 0,
        skills: [{ id: 'lingji-video-workflow', enabled: true }],
      },
    },
  };
}

beforeEach(() => {
  getConfig.mockResolvedValue(baseConfig());
  saveConfig.mockClear();
  listSkills.mockClear();
  addSkill.mockClear();
  removeSkill.mockClear();
  (window as unknown as { agentAPI: unknown }).agentAPI = {
    getConfig,
    saveConfig,
    listSkills,
    addSkill,
    removeSkill,
    readSkillTree: vi.fn(async () => null),
    readSkillFile: vi.fn(async () => ({ error: 'x' })),
    openSkillDir: vi.fn(async () => ({ ok: true as const })),
  };
});

afterEach(() => {
  delete (window as unknown as { agentAPI?: unknown }).agentAPI;
});

async function mount() {
  const { AgentSettingsTab } = await import('../src/components/settings/AgentSettingsTab');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AgentSettingsTab />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

function clickByText(container: HTMLElement, text: string) {
  const el = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(text),
  );
  if (!el) throw new Error(`button not found: ${text}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('AgentSettingsTab 瘦身 + Skill 库管理', () => {
  it('不再渲染「设为当前」与 Model 下拉', async () => {
    const { container, root } = await mount();
    const text = container.textContent ?? '';
    expect(text).not.toContain('设为当前');
    expect(container.querySelector('button[aria-haspopup="listbox"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('内置 skill 无删除按钮，用户 skill 有删除按钮', async () => {
    const { container, root } = await mount();
    expect(container.querySelector('[aria-label="删除 My Skill"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="删除 灵机剪影视频工作流"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('内置 skill 开关常亮且 disabled，用户 skill 开关可切换', async () => {
    const { container, root } = await mount();
    const builtinSwitch = container.querySelector<HTMLInputElement>(
      'input[aria-label="灵机剪影视频工作流 启用开关"]',
    );
    const userSwitch = container.querySelector<HTMLInputElement>(
      'input[aria-label="My Skill 启用开关"]',
    );
    expect(builtinSwitch).not.toBeNull();
    expect(builtinSwitch!.disabled).toBe(true);
    expect(builtinSwitch!.checked).toBe(true);
    expect(userSwitch!.disabled).toBe(false);
    act(() => root.unmount());
    container.remove();
  });

  it('简介超过 100 字符被截断', async () => {
    const long = '字'.repeat(200);
    listSkills.mockResolvedValueOnce([{ ...userSkill, description: long }]);
    const { container, root } = await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('…');
    expect(text).not.toContain('字'.repeat(101));
    act(() => root.unmount());
    container.remove();
  });

  it('点击「添加 Skill 库…」调用 addSkill 并刷新列表', async () => {
    const { container, root } = await mount();
    listSkills.mockClear();
    await act(async () => {
      clickByText(container, '添加 Skill 库');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(addSkill).toHaveBeenCalled();
    expect(listSkills).toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});

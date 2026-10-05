// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpSettingsTab } from '../src/components/settings/McpSettingsTab';
import type { ProductionActivityAPI } from '../src/lib/electron-api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); host = null; root = null;
});

describe('智能体质检设置入口', () => {
  it('显示当前工程授权状态并提供发行与撤销入口，不显示自动发布许可', async () => {
    let active = false;
    const activityApi = {
      status: vi.fn(async () => ({ ok: true as const, status: { active } })),
      issueQualityCheck: vi.fn(async () => { active = true; return { ok: true as const,
        status: { active, expiresAtMs: Date.now() + 30 * 60_000, allowedActions: ['quality_check'] } }; }),
      revoke: vi.fn(async () => { active = false; return { ok: true as const, status: { active } }; }),
    };
    (window as unknown as { mcpAPI: unknown }).mcpAPI = {
      getStatus: async () => ({ running: true, port: 19820, url: 'http://127.0.0.1:19820/mcp' }),
      isRegistered: async () => false,
    };
    (window as unknown as { productionActivityAPI: ProductionActivityAPI }).productionActivityAPI = activityApi;
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<McpSettingsTab />); });
    expect(host.textContent).toContain('当前未授权');
    expect(host.textContent).toContain('此授权不允许登录或发布');
    expect(host.textContent).not.toContain('自动发布');
    const button = (label: string) => [...host!.querySelectorAll('button')]
      .find((item) => item.textContent === label)!;
    await act(async () => { button('授权 30 分钟').click(); });
    expect(activityApi.issueQualityCheck).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('已授权，至');
    await act(async () => { button('撤销').click(); });
    expect(activityApi.revoke).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('当前未授权');
  });
});

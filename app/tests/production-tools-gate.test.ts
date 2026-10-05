import { describe, expect, it, vi } from 'vitest';
import { registerProductionReadTools } from '../electron/mcp/production-tools';

describe('生产 MCP 质检门控', () => {
  it('无授权不执行预检；允许时调用，撤销后立即拒绝', async () => {
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = { registerTool: (name: string, _spec: unknown, handler: (args: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    } };
    const preview = vi.fn(async () => ({ valid: true }));
    let allowed = false;
    registerProductionReadTools(server as never,
      () => ({ preview, listDrafts: async () => [] }) as never,
      () => allowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' });
    const args = { assignments: [{ accountId: 'a', batchId: 'b', planId: 'p',
      metadata: { title: 't', description: 'd', tags: [], coverRefs: [], scheduleAt: null },
      commerceRequest: null }] };
    const call = () => handlers.get('lingji_production_preview_publish')!(args) as Promise<{
      isError?: boolean; content: { text: string }[] }>;
    expect(JSON.parse((await call()).content[0].text)).toEqual({ code: 'grant_missing' });
    expect(preview).not.toHaveBeenCalled();
    allowed = true;
    expect(JSON.parse((await call()).content[0].text)).toEqual({ valid: true });
    expect(preview).toHaveBeenCalledTimes(1);
    allowed = false;
    expect(JSON.parse((await call()).content[0].text)).toEqual({ code: 'grant_missing' });
    expect(preview).toHaveBeenCalledTimes(1);
  });
});

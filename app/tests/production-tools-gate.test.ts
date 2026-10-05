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
      () => allowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' },
      () => null, () => ({ allowed: false, reason: 'grant_missing' }));
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

  it('素材检索在调用前和返回前都复核授权，撤销后不泄露结果', async () => {
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = { registerTool: (name: string, _spec: unknown,
      handler: (args: unknown) => Promise<unknown>) => { handlers.set(name, handler); } };
    let allowed = false;
    const search = vi.fn(async () => {
      allowed = false;
      return { status: 'ok', assets: [{ assetId: 'secret-id', similarity: 1, mediaType: 'image' }] };
    });
    registerProductionReadTools(server as never, () => null,
      () => ({ allowed: false, reason: 'grant_missing' }),
      () => search as never,
      () => allowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' });
    const call = () => handlers.get('lingji_production_search_authorized_assets')!({
      text: '夜景', platform: 'douyin', region: 'cn', commercialShortVideo: true, maxResults: 5,
    }) as Promise<{ isError?: boolean; content: { text: string }[] }>;
    expect(JSON.parse((await call()).content[0].text)).toEqual({ code: 'grant_missing' });
    expect(search).not.toHaveBeenCalled();
    allowed = true;
    const revoked = await call();
    expect(revoked.isError).toBe(true);
    expect(JSON.parse(revoked.content[0].text)).toEqual({ code: 'grant_missing' });
    expect(revoked.content[0].text).not.toContain('secret-id');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('录屏导入工具只接收数量参数，授权撤销后拒绝并隐藏队列结果', async () => {
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = { registerTool: (name: string, _spec: unknown,
      handler: (args: unknown) => Promise<unknown>) => { handlers.set(name, handler); } };
    let allowed = false;
    const importer = vi.fn(async () => {
      allowed = false;
      return { ok: true as const, recordings: [{ id: 'private-task', sourceSha256: 'a'.repeat(64), state: 'queued' }] };
    });
    registerProductionReadTools(server as never, () => null,
      () => ({ allowed: false, reason: 'grant_missing' }), () => null,
      () => ({ allowed: false, reason: 'grant_missing' }),
      () => importer, () => allowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' });
    const call = () => handlers.get('lingji_production_import_recordings')!({ maxClips: 2 }) as
      Promise<{ isError?: boolean; content: { text: string }[] }>;
    expect(JSON.parse((await call()).content[0].text)).toEqual({ code: 'grant_missing' });
    expect(importer).not.toHaveBeenCalled();
    allowed = true;
    const revoked = await call();
    expect(revoked.isError).toBe(true);
    expect(JSON.parse(revoked.content[0].text)).toEqual({ code: 'grant_missing' });
    expect(revoked.content[0].text).not.toContain('private-task');
  });

  it('只读录屏状态需当前工程授权，撤销期间不输出任务信息', async () => {
    const handlers = new Map<string, () => Promise<unknown>>();
    const server = { registerTool: (name: string, _spec: unknown,
      handler: () => Promise<unknown>) => { handlers.set(name, handler); } };
    let allowed = false;
    const privateStatus = { id: 'private-task', sourceSha256: 'a'.repeat(64), state: 'queued',
      candidateCount: 0, highlightCount: 0, lastErrorCode: null };
    const list = vi.fn(() => ({ ok: true as const, recordings: [privateStatus] }));
    registerProductionReadTools(server as never, () => null,
      () => ({ allowed: false, reason: 'grant_missing' }), () => null,
      () => ({ allowed: false, reason: 'grant_missing' }),
      () => null, () => allowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' },
      () => list);
    const call = () => handlers.get('lingji_production_list_recordings')!() as
      Promise<{ isError?: boolean; content: { text: string }[] }>;
    expect(JSON.parse((await call()).content[0].text)).toEqual({ code: 'grant_missing' });
    expect(list).not.toHaveBeenCalled();
    allowed = true;
    list.mockImplementationOnce(() => { allowed = false; return { ok: true,
      recordings: [privateStatus] }; });
    const revoked = await call();
    expect(revoked.isError).toBe(true);
    expect(revoked.content[0].text).not.toContain('private-task');
  });

  it('智能体高光执行只接受绑定任务 ID，未授权与执行中撤销都拒绝', async () => {
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = { registerTool: (name: string, _spec: unknown,
      handler: (args: unknown) => Promise<unknown>) => { handlers.set(name, handler); } };
    let allowed = false;
    const taskId = `hbatch_${'a'.repeat(64)}`;
    const start = vi.fn(async () => {
      allowed = false;
      return { ok: true as const, startedIds: [taskId] };
    });
    registerProductionReadTools(server as never, () => null,
      () => ({ allowed: false, reason: 'grant_missing' }), () => null,
      () => ({ allowed: false, reason: 'grant_missing' }),
      () => null, () => ({ allowed: false, reason: 'grant_missing' }), () => null,
      () => start, () => allowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' });
    const call = () => handlers.get('lingji_production_detect_highlights')!({ taskIds: [taskId] }) as
      Promise<{ isError?: boolean; content: { text: string }[] }>;
    expect(JSON.parse((await call()).content[0].text)).toEqual({ code: 'grant_missing' });
    expect(start).not.toHaveBeenCalled();
    allowed = true;
    const revoked = await call();
    expect(revoked.isError).toBe(true);
    expect(JSON.parse(revoked.content[0].text)).toEqual({ code: 'grant_missing' });
    expect(revoked.content[0].text).not.toContain(taskId);
  });

  it('混剪工具没有文本或路径入参，授权撤销时不泄露生成结果', async () => {
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = { registerTool: (name: string, _spec: unknown,
      handler: (args: unknown) => Promise<unknown>) => { handlers.set(name, handler); } };
    let allowed = false;
    const build = vi.fn(async () => { allowed = false;
      return { ok: true as const, batchId: 'secret-batch', planIds: ['secret-plan'] }; });
    registerProductionReadTools(server as never, () => null,
      () => ({ allowed: false, reason: 'grant_missing' }), () => null,
      () => ({ allowed: false, reason: 'grant_missing' }),
      () => null, () => ({ allowed: false, reason: 'grant_missing' }), () => null,
      () => null, () => ({ allowed: false, reason: 'grant_missing' }),
      () => build, () => allowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' });
    const call = () => handlers.get('lingji_production_build_compositions')!({}) as
      Promise<{ isError?: boolean; content: { text: string }[] }>;
    expect(JSON.parse((await call()).content[0].text)).toEqual({ code: 'grant_missing' });
    expect(build).not.toHaveBeenCalled();
    allowed = true;
    const revoked = await call();
    expect(revoked.isError).toBe(true);
    expect(JSON.parse(revoked.content[0].text)).toEqual({ code: 'grant_missing' });
    expect(revoked.content[0].text).not.toContain('secret-batch');
  });

  it('智能体渲染工具仅消费桌面准备，撤销后隐藏结果且不返回本地路径', async () => {
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = { registerTool: (name: string, _spec: unknown,
      handler: (args: unknown) => Promise<unknown>) => { handlers.set(name, handler); } };
    let allowed = false;
    const render = vi.fn(async () => ({ ok: true as const, batchId: 'batch-1', versions: [{
      planId: 'plan-1', state: 'completed', reviewRequired: true as const, errorCode: null,
      outputPath: 'C:\\private\\render.mp4',
    }] }));
    registerProductionReadTools(server as never, () => null,
      () => ({ allowed: false, reason: 'grant_missing' }), () => null,
      () => ({ allowed: false, reason: 'grant_missing' }),
      () => null, () => ({ allowed: false, reason: 'grant_missing' }), () => null,
      () => null, () => ({ allowed: false, reason: 'grant_missing' }),
      () => null, () => ({ allowed: false, reason: 'grant_missing' }),
      () => render, () => allowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' });
    const call = () => handlers.get('lingji_production_render_variants')!({}) as
      Promise<{ isError?: boolean; content: { text: string }[] }>;
    expect(JSON.parse((await call()).content[0].text)).toEqual({ code: 'grant_missing' });
    expect(render).not.toHaveBeenCalled();
    allowed = true;
    const completed = await call();
    expect(JSON.parse(completed.content[0].text)).toMatchObject({ batchId: 'batch-1', versions: [
      { planId: 'plan-1', state: 'completed', reviewRequired: true },
    ] });
    expect(completed.content[0].text).not.toContain('private');
    render.mockImplementationOnce(async () => { allowed = false; return { ok: true as const,
      batchId: 'secret-batch', versions: [] }; });
    const revoked = await call();
    expect(revoked.isError).toBe(true);
    expect(JSON.parse(revoked.content[0].text)).toEqual({ code: 'grant_missing' });
    expect(revoked.content[0].text).not.toContain('secret-batch');
  });
});

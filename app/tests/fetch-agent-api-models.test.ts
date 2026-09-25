import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAgentApiModels } from '../electron/acp/fetch-agent-api-models';

function mockFetchOnce(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(impl as never);
  (globalThis as { fetch?: unknown }).fetch = fn as never;
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('fetchAgentApiModels', () => {
  it('解析 {data:[{id,display_name}]}，label 优先 display_name', async () => {
    const fetchFn = mockFetchOnce(() =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
            { id: 'claude-opus-4-5' },
          ],
        }),
        { status: 200 },
      ),
    );
    const models = await fetchAgentApiModels('https://api.anthropic.com', 'sk-test');
    expect(models).toEqual([
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
    ]);
    // 端点拼接 + 双鉴权头
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(headers['x-api-key']).toBe('sk-test');
  });

  it('baseUrl 已含 /v1 → 仅追加 /models', async () => {
    const fetchFn = mockFetchOnce(() =>
      new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { status: 200 }),
    );
    await fetchAgentApiModels('https://proxy.example.com/v1', 'k');
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe('https://proxy.example.com/v1/models');
  });

  it('非 2xx / 网络异常 / 空 baseUrl → null', async () => {
    mockFetchOnce(() => new Response('nope', { status: 401 }));
    expect(await fetchAgentApiModels('https://x.com', 'k')).toBeNull();

    mockFetchOnce(() => {
      throw new Error('network down');
    });
    expect(await fetchAgentApiModels('https://x.com', 'k')).toBeNull();

    expect(await fetchAgentApiModels('   ', 'k')).toBeNull();
  });

  it('data 为空数组 → null', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    expect(await fetchAgentApiModels('https://x.com', 'k')).toBeNull();
  });
});

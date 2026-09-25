import { describe, it, expect, vi } from 'vitest';
import {
  createBridgeClient,
  type BridgeConfig,
  type BridgePayload,
  type BridgePendingStore,
} from '@/bridge/bridge-client';

const config: BridgeConfig = {
  enabled: true,
  endpoint: 'http://127.0.0.1:19820',
  token: 'tkn',
};

function payload(over: Partial<BridgePayload> = {}): BridgePayload {
  return {
    source: 'douyin',
    awemeId: 'a1',
    creatorId: 'c1',
    creatorName: '博主',
    title: '标题',
    url: 'https://www.douyin.com/video/a1',
    publishedAt: 1_700_000_000_000,
    transcript: { fullText: '转录', srtText: 'srt', segments: [{ text: '转录', startMs: 0, endMs: 1000 }] },
    ...over,
  };
}

function memPending(initial: BridgePayload[] = []): BridgePendingStore & { items: BridgePayload[] } {
  let items = [...initial];
  return {
    get items() {
      return items;
    },
    async read() {
      return [...items];
    },
    async write(next) {
      items = [...next];
    },
  };
}

function okJson(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('createBridgeClient.probe', () => {
  it('GET /sonar/health 返回 ok', async () => {
    const fetchImpl = vi.fn(async () => okJson({ ok: true, version: '1.0.0' }));
    const client = createBridgeClient({ fetchImpl, pending: memPending() });
    const res = await client.probe(config);
    expect(res.ok).toBe(true);
    expect(res.version).toBe('1.0.0');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:19820/sonar/health', expect.anything());
  });

  it('网络失败时 ok=false 不抛', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = createBridgeClient({ fetchImpl, pending: memPending() });
    expect((await client.probe(config)).ok).toBe(false);
  });
});

describe('createBridgeClient.pair', () => {
  it('GET /sonar/pair 返回 endpoint+token', async () => {
    const fetchImpl = vi.fn(async () =>
      okJson({ ok: true, endpoint: 'http://127.0.0.1:19820', token: 'tok-xyz' }),
    );
    const client = createBridgeClient({ fetchImpl, pending: memPending() });
    const r = await client.pair('http://127.0.0.1:19820');
    expect(r).toEqual({ ok: true, endpoint: 'http://127.0.0.1:19820', token: 'tok-xyz' });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:19820/sonar/pair', expect.anything());
  });

  it('无 token 或不可达 → ok:false', async () => {
    const c1 = createBridgeClient({ fetchImpl: vi.fn(async () => okJson({ ok: true })), pending: memPending() });
    expect((await c1.pair('http://127.0.0.1:19820')).ok).toBe(false);
    const c2 = createBridgeClient({
      fetchImpl: vi.fn(async () => {
        throw new Error('down');
      }),
      pending: memPending(),
    });
    expect((await c2.pair('http://127.0.0.1:19820')).ok).toBe(false);
  });
});

describe('createBridgeClient.enqueue', () => {
  it('disabled 时直接跳过', async () => {
    const fetchImpl = vi.fn();
    const client = createBridgeClient({ fetchImpl, pending: memPending() });
    const res = await client.enqueue({ ...config, enabled: false }, payload());
    expect(res.status).toBe('disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('成功发送带 x-sonar-token 头', async () => {
    const fetchImpl = vi.fn(async () => okJson({ queued: true, itemId: 'x', duplicate: false }));
    const pending = memPending();
    const client = createBridgeClient({ fetchImpl, pending });
    const res = await client.enqueue(config, payload());
    expect(res).toMatchObject({ status: 'sent', duplicate: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe('http://127.0.0.1:19820/sonar/enqueue');
    expect(init.method).toBe('POST');
    expect(init.headers['x-sonar-token']).toBe('tkn');
    expect(pending.items).toHaveLength(0);
  });

  it('refresh 选项把 refresh:true 写入请求体', async () => {
    const fetchImpl = vi.fn(async () => okJson({ queued: true, itemId: 'x', duplicate: false, refreshed: true }));
    const client = createBridgeClient({ fetchImpl, pending: memPending() });
    await client.enqueue(config, payload(), { refresh: true });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).refresh).toBe(true);
  });

  it('不传 refresh 时请求体不含 refresh', async () => {
    const fetchImpl = vi.fn(async () => okJson({ queued: true, itemId: 'x', duplicate: false }));
    const client = createBridgeClient({ fetchImpl, pending: memPending() });
    await client.enqueue(config, payload());
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect('refresh' in JSON.parse(init.body)).toBe(false);
  });

  it('网络失败 → 入 pending 暂存', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const pending = memPending();
    const client = createBridgeClient({ fetchImpl, pending });
    const res = await client.enqueue(config, payload());
    expect(res.status).toBe('queued');
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0].awemeId).toBe('a1');
  });

  it('pending 入队按 awemeId 幂等，不重复', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const pending = memPending();
    const client = createBridgeClient({ fetchImpl, pending });
    await client.enqueue(config, payload());
    await client.enqueue(config, payload({ title: '又来一次' }));
    expect(pending.items).toHaveLength(1);
  });

  it('401 → unauthorized，不入 pending', async () => {
    const fetchImpl = vi.fn(async () => okJson({ error: 'Unauthorized' }, 401));
    const pending = memPending();
    const client = createBridgeClient({ fetchImpl, pending });
    const res = await client.enqueue(config, payload());
    expect(res.status).toBe('unauthorized');
    expect(pending.items).toHaveLength(0);
  });

  it('其它非 2xx → 入 pending', async () => {
    const fetchImpl = vi.fn(async () => okJson({ error: 'boom' }, 500));
    const pending = memPending();
    const client = createBridgeClient({ fetchImpl, pending });
    const res = await client.enqueue(config, payload());
    expect(res.status).toBe('queued');
    expect(pending.items).toHaveLength(1);
  });
});

describe('createBridgeClient.flushPending', () => {
  it('补推成功的从 pending 移除，失败的保留', async () => {
    const pending = memPending([payload({ awemeId: 'a1' }), payload({ awemeId: 'a2' })]);
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return okJson({ queued: true, itemId: 'x', duplicate: false });
      throw new Error('still down');
    });
    const client = createBridgeClient({ fetchImpl, pending });
    const res = await client.flushPending(config);
    expect(res.sent).toBe(1);
    expect(res.remaining).toBe(1);
    expect(pending.items.map((p) => p.awemeId)).toEqual(['a2']);
  });

  it('duplicate 视为已送达，从 pending 移除', async () => {
    const pending = memPending([payload({ awemeId: 'a1' })]);
    const fetchImpl = vi.fn(async () => okJson({ queued: true, itemId: 'x', duplicate: true }));
    const client = createBridgeClient({ fetchImpl, pending });
    const res = await client.flushPending(config);
    expect(res.sent).toBe(1);
    expect(pending.items).toHaveLength(0);
  });

  it('disabled 时不补推', async () => {
    const pending = memPending([payload()]);
    const fetchImpl = vi.fn();
    const client = createBridgeClient({ fetchImpl, pending });
    const res = await client.flushPending({ ...config, enabled: false });
    expect(res.sent).toBe(0);
    expect(res.remaining).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

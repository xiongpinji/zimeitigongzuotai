import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageGenerationError } from '../../../src/lib/image-gen/errors';
import { minimaxImageProvider } from '../../../src/lib/image-gen/providers/minimax';
import type {
  ImageGenerationContext,
  ImageGenerationRequest,
  ImageProviderConfig,
} from '../../../src/lib/image-gen/types';

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ImageProviderConfig> = {}): ImageProviderConfig {
  return {
    baseUrl: '',
    apiKey: 'test-api-key',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest {
  return {
    model: 'image-01',
    prompt: 'a cute cat',
    aspectRatio: '1:1',
    n: 1,
    ...overrides,
  };
}

function makeCtx(): ImageGenerationContext & { progressCalls: { percent?: number; phase?: string }[] } {
  const progressCalls: { percent?: number; phase?: string }[] = [];
  return {
    taskId: 'task-1',
    signal: new AbortController().signal,
    onProgress: (update) => {
      progressCalls.push(update);
    },
    progressCalls,
  };
}

function mockFetchOk(imageUrls: string[], extraBody?: Partial<Record<string, unknown>>) {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      data: { image_urls: imageUrls },
      base_resp: { status_code: 0, status_msg: 'success' },
      ...extraBody,
    }),
    text: async () => '',
  });
}

function mockFetchHttpError(status: number) {
  return vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => `HTTP error ${status}`,
  });
}

function mockFetchBusinessError(statusCode: number, statusMsg = '业务错误') {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      data: { image_urls: [] },
      base_resp: { status_code: statusCode, status_msg: statusMsg },
    }),
    text: async () => '',
  });
}

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('minimaxImageProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 正常响应
  // -------------------------------------------------------------------------

  it('正常返回 image_urls', async () => {
    const urls = ['https://example.com/img1.png', 'https://example.com/img2.png'];
    globalThis.fetch = mockFetchOk(urls);

    const ctx = makeCtx();
    const result = await minimaxImageProvider.generate(makeRequest(), makeConfig(), ctx);

    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toEqual({ url: urls[0], mimeType: 'image/png' });
    expect(result.images[1]).toEqual({ url: urls[1], mimeType: 'image/png' });
  });

  it('进度回调：10% submitting → 80% rendering → 100% done', async () => {
    globalThis.fetch = mockFetchOk(['https://example.com/img.png']);

    const ctx = makeCtx();
    await minimaxImageProvider.generate(makeRequest(), makeConfig(), ctx);

    expect(ctx.progressCalls[0].percent).toBe(10);
    expect(ctx.progressCalls[0].phase).toBe('submitting');
    expect(ctx.progressCalls[1].percent).toBe(80);
    expect(ctx.progressCalls[1].phase).toBe('rendering');
    expect(ctx.progressCalls[2].percent).toBe(100);
  });

  // -------------------------------------------------------------------------
  // aspect_ratio 透传
  // -------------------------------------------------------------------------

  it('aspect_ratio 透传到请求体', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: { image_urls: ['https://example.com/img.png'] },
          base_resp: { status_code: 0 },
        }),
        text: async () => '',
      });
    });

    await minimaxImageProvider.generate(
      makeRequest({ aspectRatio: '16:9' }),
      makeConfig(),
      makeCtx(),
    );

    expect(capturedBody.aspect_ratio).toBe('16:9');
  });

  it('aspect_ratio 默认值为 16:9（当请求未指定时）', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: { image_urls: ['https://example.com/img.png'] },
          base_resp: { status_code: 0 },
        }),
        text: async () => '',
      });
    });

    const req = makeRequest();
    delete req.aspectRatio;
    await minimaxImageProvider.generate(req, makeConfig(), makeCtx());

    expect(capturedBody.aspect_ratio).toBe('16:9');
  });

  // -------------------------------------------------------------------------
  // extraParams 透传
  // -------------------------------------------------------------------------

  it('extraParams.prompt_optimizer=true 透传到请求体', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: { image_urls: ['https://example.com/img.png'] },
          base_resp: { status_code: 0 },
        }),
        text: async () => '',
      });
    });

    await minimaxImageProvider.generate(
      makeRequest({ extraParams: { prompt_optimizer: true } }),
      makeConfig(),
      makeCtx(),
    );

    expect(capturedBody.prompt_optimizer).toBe(true);
  });

  it('未传 extraParams 时请求体不含 prompt_optimizer / seed', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: { image_urls: ['https://example.com/img.png'] },
          base_resp: { status_code: 0 },
        }),
        text: async () => '',
      });
    });

    await minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx());

    expect(Object.prototype.hasOwnProperty.call(capturedBody, 'prompt_optimizer')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(capturedBody, 'seed')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // HTTP 错误
  // -------------------------------------------------------------------------

  it('HTTP 401 → auth 错误', async () => {
    globalThis.fetch = mockFetchHttpError(401);

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({
      code: 'auth',
      providerType: 'minimax',
    });
  });

  it('HTTP 500 → server 错误', async () => {
    globalThis.fetch = mockFetchHttpError(500);

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({
      code: 'server',
      providerType: 'minimax',
    });
  });

  // -------------------------------------------------------------------------
  // 业务错误（200 + base_resp.status_code !== 0）
  // -------------------------------------------------------------------------

  it('200 + base_resp.status_code=1004 → auth', async () => {
    globalThis.fetch = mockFetchBusinessError(1004, '鉴权失败');

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({
      code: 'auth',
      providerType: 'minimax',
    });
  });

  it('200 + base_resp.status_code=1008 → quota', async () => {
    globalThis.fetch = mockFetchBusinessError(1008, '配额不足');

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({
      code: 'quota',
      providerType: 'minimax',
    });
  });

  it('200 + base_resp.status_code=1013 → invalid_request', async () => {
    globalThis.fetch = mockFetchBusinessError(1013, '参数无效');

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({
      code: 'invalid_request',
      providerType: 'minimax',
    });
  });

  it('200 + base_resp.status_code=9999（未知码）→ server', async () => {
    globalThis.fetch = mockFetchBusinessError(9999, '未知错误');

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({
      code: 'server',
      providerType: 'minimax',
    });
  });

  // -------------------------------------------------------------------------
  // baseUrl 默认值
  // -------------------------------------------------------------------------

  it('baseUrl 为空时使用默认 https://api.minimax.chat', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn().mockImplementationOnce((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: { image_urls: ['https://example.com/img.png'] },
          base_resp: { status_code: 0 },
        }),
        text: async () => '',
      });
    });

    await minimaxImageProvider.generate(makeRequest(), makeConfig({ baseUrl: '' }), makeCtx());

    expect(capturedUrl).toBe('https://api.minimax.chat/v1/image_generation');
  });

  it('自定义 baseUrl 被使用', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn().mockImplementationOnce((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: { image_urls: ['https://example.com/img.png'] },
          base_resp: { status_code: 0 },
        }),
        text: async () => '',
      });
    });

    await minimaxImageProvider.generate(
      makeRequest(),
      makeConfig({ baseUrl: 'https://custom.api.com' }),
      makeCtx(),
    );

    expect(capturedUrl).toBe('https://custom.api.com/v1/image_generation');
  });

  // -------------------------------------------------------------------------
  // 空 image_urls → server 错误
  // -------------------------------------------------------------------------

  it('空 image_urls 抛 server 错误', async () => {
    globalThis.fetch = mockFetchOk([]);

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({
      code: 'server',
      providerType: 'minimax',
    });
  });

  it('data 字段缺失时抛 server 错误', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ base_resp: { status_code: 0 } }),
      text: async () => '',
    });

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({
      code: 'server',
      providerType: 'minimax',
    });
  });

  // -------------------------------------------------------------------------
  // 网络错误 / 取消
  // -------------------------------------------------------------------------

  it('网络错误抛 network 错误', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('fetch failed'));

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({
      code: 'network',
      providerType: 'minimax',
    });
  });

  it('signal 已中止时抛 cancelled 错误', async () => {
    const ac = new AbortController();
    ac.abort();
    const abortedCtx: ImageGenerationContext = {
      taskId: 'task-abort',
      signal: ac.signal,
      onProgress: () => {},
    };

    // fetch 因 signal 已中止抛出 AbortError
    const abortError = new DOMException('Aborted', 'AbortError');
    globalThis.fetch = vi.fn().mockRejectedValueOnce(abortError);

    await expect(
      minimaxImageProvider.generate(makeRequest(), makeConfig(), abortedCtx),
    ).rejects.toMatchObject({
      code: 'cancelled',
      providerType: 'minimax',
    });
  });

  // -------------------------------------------------------------------------
  // capabilities 静态属性
  // -------------------------------------------------------------------------

  it('type 为 minimax', () => {
    expect(minimaxImageProvider.type).toBe('minimax');
  });

  it('capabilities 符合规格', () => {
    const { capabilities } = minimaxImageProvider;
    expect(capabilities.maxN).toBe(8);
    expect(capabilities.isAsync).toBe(false);
    expect(capabilities.supportsImageToImage).toBe(false);
    expect(capabilities.defaultModels).toContain('image-01');
    expect(capabilities.aspectRatios).toEqual(
      expect.arrayContaining(['1:1', '16:9', '9:16', '4:3', '3:4']),
    );
  });

  // -------------------------------------------------------------------------
  // 错误对象是 ImageGenerationError
  // -------------------------------------------------------------------------

  it('抛出的错误是 ImageGenerationError 实例', async () => {
    globalThis.fetch = mockFetchHttpError(401);

    let caught: unknown;
    try {
      await minimaxImageProvider.generate(makeRequest(), makeConfig(), makeCtx());
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ImageGenerationError);
  });
});

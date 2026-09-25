import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imagenImageProvider } from '../../../src/lib/image-gen/providers/imagen';
import { ImageGenerationError } from '../../../src/lib/image-gen/errors';
import type { ImageGenerationContext, ImageGenerationRequest, ImageProviderConfig } from '../../../src/lib/image-gen/types';

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function makePredictionsBody(predictions: Array<{ bytesBase64Encoded: string; mimeType?: string }>) {
  return JSON.stringify({ predictions });
}

function makeConfig(overrides: Partial<ImageProviderConfig> = {}): ImageProviderConfig {
  return {
    baseUrl: '',
    apiKey: 'test-api-key',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest {
  return {
    prompt: '一只猫',
    model: 'imagen-3.0-generate-002',
    ...overrides,
  };
}

function makeCtx(): ImageGenerationContext {
  return {
    taskId: 'task-1',
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  };
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('imagenImageProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 正常流程 ──────────────────────────────────────────────────────────────

  it('正常响应：返回 base64 图片', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(makePredictionsBody([{ bytesBase64Encoded: 'abc123', mimeType: 'image/jpeg' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await imagenImageProvider.generate(makeRequest(), makeConfig(), makeCtx());

    expect(result.images).toHaveLength(1);
    expect(result.images[0].base64).toBe('abc123');
    expect(result.images[0].mimeType).toBe('image/jpeg');
  });

  it('URL 中包含 ?key= query string', async () => {
    let capturedUrl = '';
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(
        new Response(makePredictionsBody([{ bytesBase64Encoded: 'data' }]), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    await imagenImageProvider.generate(makeRequest(), makeConfig({ apiKey: 'my-key' }), makeCtx());

    expect(capturedUrl).toContain('?key=my-key');
  });

  it('请求 URL 包含模型名 imagen-3.0-generate-002', async () => {
    let capturedUrl = '';
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(
        new Response(makePredictionsBody([{ bytesBase64Encoded: 'data' }]), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    await imagenImageProvider.generate(
      makeRequest({ model: 'imagen-3.0-generate-002' }),
      makeConfig(),
      makeCtx(),
    );

    expect(capturedUrl).toContain('imagen-3.0-generate-002');
  });

  it('aspectRatio 正确透传到请求体 parameters', async () => {
    let capturedBody: unknown;
    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(makePredictionsBody([{ bytesBase64Encoded: 'data' }]), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    await imagenImageProvider.generate(
      makeRequest({ aspectRatio: '9:16' }),
      makeConfig(),
      makeCtx(),
    );

    expect((capturedBody as { parameters: { aspectRatio: string } }).parameters.aspectRatio).toBe('9:16');
  });

  it('mimeType 缺省时回退为 image/png', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(makePredictionsBody([{ bytesBase64Encoded: 'xyz' }]), { status: 200 }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await imagenImageProvider.generate(makeRequest(), makeConfig(), makeCtx());

    expect(result.images[0].mimeType).toBe('image/png');
  });

  // ── 进度回调 ──────────────────────────────────────────────────────────────

  it('正常流程触发 10% 和 100% 进度', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(makePredictionsBody([{ bytesBase64Encoded: 'data' }]), { status: 200 }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const ctx = makeCtx();
    await imagenImageProvider.generate(makeRequest(), makeConfig(), ctx);

    const progressCalls = (ctx.onProgress as ReturnType<typeof vi.fn>).mock.calls;
    expect(progressCalls[0][0].percent).toBe(10);
    expect(progressCalls[progressCalls.length - 1][0].percent).toBe(100);
  });

  // ── 错误分支 ──────────────────────────────────────────────────────────────

  it('HTTP 403 → auth 错误', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: '无权限' } }), {
        status: 403,
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      imagenImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'auth', providerType: 'imagen' });
  });

  it('HTTP 429 → rate_limited 错误', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: '配额超限' } }), { status: 429 }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      imagenImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'rate_limited', providerType: 'imagen' });
  });

  it('HTTP 400 → invalid_request 错误', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: '参数无效' } }), { status: 400 }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      imagenImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'invalid_request', providerType: 'imagen' });
  });

  it('200 但 predictions 为空 → server 错误', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ predictions: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      imagenImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'server', providerType: 'imagen' });
  });

  it('网络异常（fetch 抛错）→ network 错误', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      imagenImageProvider.generate(makeRequest(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'network', providerType: 'imagen' });
  });

  it('AbortSignal 触发 → cancelled 错误', async () => {
    const controller = new AbortController();
    const ctx: ImageGenerationContext = {
      taskId: 'task-abort',
      signal: controller.signal,
      onProgress: vi.fn(),
    };

    const mockFetch = vi.fn().mockImplementation(() => {
      controller.abort();
      const err = new DOMException('Aborted', 'AbortError');
      return Promise.reject(err);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      imagenImageProvider.generate(makeRequest(), makeConfig(), ctx),
    ).rejects.toMatchObject({ code: 'cancelled', providerType: 'imagen' });
  });

  // ── capabilities ──────────────────────────────────────────────────────────

  it('type 为 imagen', () => {
    expect(imagenImageProvider.type).toBe('imagen');
  });

  it('capabilities 包含预期 aspectRatios 与 defaultModels', () => {
    const { capabilities } = imagenImageProvider;
    expect(capabilities.aspectRatios).toContain('16:9');
    expect(capabilities.aspectRatios).toContain('1:1');
    expect(capabilities.defaultModels).toContain('imagen-3.0-generate-002');
    expect(capabilities.defaultModels).toContain('imagen-4.0-generate-preview-06-06');
    expect(capabilities.maxN).toBe(4);
    expect(capabilities.supportsImageToImage).toBe(false);
  });
});

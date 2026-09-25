import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doubaoImageProvider } from '../../../src/lib/image-gen/providers/doubao';
import { ImageGenerationError } from '../../../src/lib/image-gen/errors';
import type { ImageGenerationContext, ImageGenerationRequest, ImageProviderConfig } from '../../../src/lib/image-gen/types';

// --- 辅助工具 ---

function makeConfig(overrides?: Partial<ImageProviderConfig>): ImageProviderConfig {
  return {
    baseUrl: 'https://ark.test',
    apiKey: 'test-key',
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<ImageGenerationRequest>): ImageGenerationRequest {
  return {
    prompt: '一只可爱的猫',
    model: 'doubao-seedream-3.0-t2i-250415',
    aspectRatio: '1:1',
    n: 1,
    ...overrides,
  };
}

function makeCtx(): ImageGenerationContext & { abort: () => void } {
  const ctrl = new AbortController();
  return {
    taskId: 'ctx-task-id',
    signal: ctrl.signal,
    abort: () => ctrl.abort(),
    onProgress: vi.fn(),
  };
}

// --- fetch mock 工具 ---

interface MockRoute {
  url: string;
  response: () => Response | Promise<Response>;
}

function mockFetchRoutes(routes: MockRoute[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const route = routes.find((r) => url.includes(r.url));
      if (!route) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      return route.response();
    }),
  );
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, body = '{}'): Response {
  return new Response(body, { status });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// --- 测试用例 ---

describe('doubaoImageProvider', () => {
  it('capabilities 符合规格', () => {
    expect(doubaoImageProvider.type).toBe('doubao');
    expect(doubaoImageProvider.capabilities.isAsync).toBe(true);
    expect(doubaoImageProvider.capabilities.maxN).toBe(1);
    expect(doubaoImageProvider.capabilities.aspectRatios).toContain('1:1');
    expect(doubaoImageProvider.capabilities.aspectRatios).toContain('16:9');
    expect(doubaoImageProvider.capabilities.aspectRatios).toContain('9:16');
  });

  it('正常路径：submit→succeeded，返回图片 URL', async () => {
    // 直接在第一次 status 查询时返回 succeeded，避免 INTERVAL_MS=2000 的等待
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (/\/tasks\/task-123/.test(url)) {
          return jsonOk({
            status: 'succeeded',
            content: { image_urls: ['https://example.com/img.jpg'] },
          });
        }
        // submit
        return jsonOk({ id: 'task-123' });
      }),
    );

    const ctx = makeCtx();
    const result = await doubaoImageProvider.generate(makeRequest(), makeConfig(), ctx);

    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe('https://example.com/img.jpg');
  });

  it('submit 401 → ImageGenerationError(code=auth)', async () => {
    mockFetchRoutes([
      {
        url: '/tasks',
        response: () => jsonError(401, '{"message":"Unauthorized"}'),
      },
    ]);

    const ctx = makeCtx();
    await expect(
      doubaoImageProvider.generate(makeRequest(), makeConfig(), ctx),
    ).rejects.toMatchObject({
      code: 'auth',
      providerType: 'doubao',
    });
  });

  it('status=failed → ImageGenerationError(code=server)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (/\/tasks\/task-fail/.test(url)) {
          return jsonOk({ status: 'failed', error: { message: '内容违规' } });
        }
        return jsonOk({ id: 'task-fail' });
      }),
    );

    const ctx = makeCtx();
    await expect(
      doubaoImageProvider.generate(makeRequest(), makeConfig(), ctx),
    ).rejects.toMatchObject({
      code: 'server',
      providerType: 'doubao',
    });
  });

  it('aspectRatio 16:9 时 submit body 的 size 为 1664x936', async () => {
    let capturedBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/tasks') && !url.match(/\/tasks\/\w/)) {
          capturedBody = JSON.parse((init?.body as string) ?? '{}');
          return jsonOk({ id: 'task-size' });
        }
        return jsonOk({
          status: 'succeeded',
          content: { image_urls: ['https://example.com/16x9.jpg'] },
        });
      }),
    );

    const ctx = makeCtx();
    await doubaoImageProvider.generate(
      makeRequest({ aspectRatio: '16:9' }),
      makeConfig(),
      ctx,
    );

    expect((capturedBody as { parameters: { size: string } }).parameters.size).toBe('1664x936');
  });

  it('9:16 时 size 为 936x1664', async () => {
    let capturedBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/tasks') && !url.match(/\/tasks\/\w/)) {
          capturedBody = JSON.parse((init?.body as string) ?? '{}');
          return jsonOk({ id: 'task-916' });
        }
        return jsonOk({
          status: 'succeeded',
          content: { image_urls: ['https://example.com/9x16.jpg'] },
        });
      }),
    );

    const ctx = makeCtx();
    await doubaoImageProvider.generate(
      makeRequest({ aspectRatio: '9:16' }),
      makeConfig(),
      ctx,
    );

    expect((capturedBody as { parameters: { size: string } }).parameters.size).toBe('936x1664');
  });

  it('abort 中途取消 → ImageGenerationError(code=cancelled)', async () => {
    const ctx = makeCtx();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (/\/tasks\/task-abort/.test(url)) {
          // 在 status 查询之前立即 abort，pollUntilDone 在 sleep 之前会检查 signal
          ctx.abort();
          return jsonOk({ status: 'running' });
        }
        // submit 成功
        return jsonOk({ id: 'task-abort' });
      }),
    );

    await expect(
      doubaoImageProvider.generate(makeRequest(), makeConfig(), ctx),
    ).rejects.toMatchObject({
      code: 'cancelled',
      providerType: 'doubao',
    });
  });

  it('ImageGenerationError 实例类型正确', async () => {
    mockFetchRoutes([
      {
        url: '/tasks',
        response: () => jsonError(403, 'Forbidden'),
      },
    ]);

    const ctx = makeCtx();
    let err: unknown;
    try {
      await doubaoImageProvider.generate(makeRequest(), makeConfig(), ctx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImageGenerationError);
  });
});

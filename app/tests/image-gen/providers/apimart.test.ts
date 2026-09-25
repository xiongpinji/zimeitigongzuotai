import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageGenerationError } from '../../../src/lib/image-gen/errors';
import { apimartImageProvider } from '../../../src/lib/image-gen/providers/apimart';
import type {
  ImageGenerationContext,
  ImageGenerationRequest,
  ImageProviderConfig,
} from '../../../src/lib/image-gen/types';

// ── 辅助构建 ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ImageProviderConfig> = {}): ImageProviderConfig {
  return {
    baseUrl: 'https://api.apimart.ai',
    apiKey: 'test-key',
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

function makeReq(overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest {
  return {
    prompt: '一只可爱的猫',
    model: 'gpt-image-2',
    aspectRatio: '1:1',
    n: 1,
    ...overrides,
  };
}

function submitResponse(taskId = 'task_01KPQ7J7DWB7QZ3WCEK3YVPBRA', status = 'submitted'): Response {
  return new Response(
    JSON.stringify({
      code: 200,
      data: [{ status, task_id: taskId }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function statusResponse(body: Record<string, unknown>, http = 200): Response {
  return new Response(JSON.stringify(body), {
    status: http,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** submit → completed 直接完成（跳过 processing，无 sleep） */
function mockApimartImmediate(urls: string[] = ['https://upload.apimart.ai/img.png']): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(globalThis, 'fetch');
  spy.mockResolvedValueOnce(submitResponse());
  spy.mockResolvedValueOnce(
    statusResponse({
      code: 200,
      data: {
        id: 'task_01KPQ7J7DWB7QZ3WCEK3YVPBRA',
        status: 'completed',
        progress: 100,
        result: {
          images: [{ url: urls, expires_at: 1_763_174_708 }],
        },
      },
    }),
  );
  return spy;
}

/** submit → processing → completed（验证中间进度） */
function mockApimartWithProcessing(urls: string[] = ['https://upload.apimart.ai/img.png']): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(globalThis, 'fetch');
  spy.mockResolvedValueOnce(submitResponse());
  spy.mockResolvedValueOnce(
    statusResponse({
      code: 200,
      data: { id: 'task_x', status: 'processing', progress: 42 },
    }),
  );
  spy.mockResolvedValueOnce(
    statusResponse({
      code: 200,
      data: {
        id: 'task_x',
        status: 'completed',
        progress: 100,
        result: { images: [{ url: urls }] },
      },
    }),
  );
  return spy;
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('apimartImageProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── 基本属性 ──────────────────────────────────────────────────────────────

  it('type 为 apimart', () => {
    expect(apimartImageProvider.type).toBe('apimart');
  });

  it('capabilities 符合预期', () => {
    const cap = apimartImageProvider.capabilities;
    expect(cap.aspectRatios).toEqual(['1:1', '16:9', '9:16', '4:3', '3:4']);
    expect(cap.maxN).toBe(1);
    expect(cap.isAsync).toBe(true);
    expect(cap.supportsImageToImage).toBe(true);
    expect(cap.defaultModels).toContain('gpt-image-2');
  });

  // ── 正常流程 ──────────────────────────────────────────────────────────────

  it('正常完成：返回图片 URL 列表（url 为字符串数组）', async () => {
    mockApimartImmediate(['https://upload.apimart.ai/cat.png']);

    const result = await apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx());

    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe('https://upload.apimart.ai/cat.png');
    expect(result.images[0].mimeType).toBe('image/png');
  });

  it('processing → completed：中间轮询后完成，percent 透传服务端值', async () => {
    vi.useFakeTimers();
    mockApimartWithProcessing(['https://upload.apimart.ai/cat.png']);

    const ctx = makeCtx();
    const promise = apimartImageProvider.generate(makeReq(), makeConfig(), ctx);
    await vi.advanceTimersByTimeAsync(3100);
    const result = await promise;

    expect(result.images).toHaveLength(1);
    const calls = (ctx.onProgress as ReturnType<typeof vi.fn>).mock.calls;
    // 最终必定回到 100%
    expect(calls[calls.length - 1][0]).toMatchObject({ percent: 100 });
    // 中间阶段应该出现 42% 的 rendering 进度
    const seenPercents = calls.map((c) => c[0]?.percent);
    expect(seenPercents).toContain(42);
  });

  // ── submit body 结构 ──────────────────────────────────────────────────────

  it('submit body：透传 model / prompt / size / 固定 n=1 / 默认 resolution=2k', async () => {
    const spy = mockApimartImmediate();
    await apimartImageProvider.generate(
      makeReq({ model: 'gpt-image-2', prompt: '山水画', aspectRatio: '16:9' }),
      makeConfig(),
      makeCtx(),
    );

    const [, init] = spy.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('gpt-image-2');
    expect(body.prompt).toBe('山水画');
    expect(body.size).toBe('16:9');
    expect(body.n).toBe(1);
    expect(body.resolution).toBe('2k');
  });

  it('submit body：extraParams.resolution 覆盖默认值', async () => {
    const spy = mockApimartImmediate();
    await apimartImageProvider.generate(
      makeReq({ extraParams: { resolution: '4k' } }),
      makeConfig(),
      makeCtx(),
    );

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.resolution).toBe('4k');
  });

  it('submit body：extraParams.image_urls 非空时加入请求体（图生图）', async () => {
    const spy = mockApimartImmediate();
    await apimartImageProvider.generate(
      makeReq({ extraParams: { image_urls: ['https://example.com/ref.png'] } }),
      makeConfig(),
      makeCtx(),
    );

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.image_urls).toEqual(['https://example.com/ref.png']);
  });

  it('submit body：extraParams.image_urls 为空或缺省时不加入', async () => {
    const spy = mockApimartImmediate();
    await apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx());

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.image_urls).toBeUndefined();
  });

  it('submit body：model 缺省时兜底 gpt-image-2', async () => {
    const spy = mockApimartImmediate();
    await apimartImageProvider.generate(makeReq({ model: '' as string }), makeConfig(), makeCtx());

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.model).toBe('gpt-image-2');
  });

  // ── 请求头 ────────────────────────────────────────────────────────────────

  it('submit 请求头含 Authorization: Bearer {apiKey}', async () => {
    const spy = mockApimartImmediate();
    await apimartImageProvider.generate(makeReq(), makeConfig({ apiKey: 'my-secret-key' }), makeCtx());

    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-key');
  });

  // ── URL 构建 ──────────────────────────────────────────────────────────────

  it('baseUrl 为空时使用默认 https://api.apimart.ai', async () => {
    const spy = mockApimartImmediate();
    await apimartImageProvider.generate(makeReq(), makeConfig({ baseUrl: '' }), makeCtx());

    const submitUrl = String(spy.mock.calls[0][0]);
    expect(submitUrl).toBe('https://api.apimart.ai/v1/images/generations');
  });

  it('baseUrl 末尾斜杠会被去除', async () => {
    const spy = mockApimartImmediate();
    await apimartImageProvider.generate(
      makeReq(),
      makeConfig({ baseUrl: 'https://api.apimart.ai///' }),
      makeCtx(),
    );

    const submitUrl = String(spy.mock.calls[0][0]);
    expect(submitUrl).toBe('https://api.apimart.ai/v1/images/generations');
  });

  it('status URL 含 task_id 路径参数和 language=zh', async () => {
    const spy = mockApimartImmediate();
    await apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx());

    const statusUrl = String(spy.mock.calls[1][0]);
    expect(statusUrl).toContain('/v1/tasks/task_01KPQ7J7DWB7QZ3WCEK3YVPBRA');
    expect(statusUrl).toContain('language=zh');
  });

  // ── HTTP 错误映射 ────────────────────────────────────────────────────────

  it('submit 401 → ImageGenerationError(code=auth)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'auth', providerType: 'apimart' });
  });

  it('submit 402 → ImageGenerationError(code=quota)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 402 }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'quota', providerType: 'apimart' });
  });

  it('submit 429 → ImageGenerationError(code=rate_limited)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 429 }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'rate_limited', providerType: 'apimart' });
  });

  it('submit 500 → ImageGenerationError(code=server)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'server', providerType: 'apimart' });
  });

  it('submit 200 但缺少 task_id → ImageGenerationError(code=server)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      statusResponse({ code: 200, data: [] }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'server', providerType: 'apimart' });
  });

  // ── 任务失败 / 错误分类 ──────────────────────────────────────────────────

  it('status=failed + error.type=authentication_error → code=auth', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(submitResponse());
    spy.mockResolvedValueOnce(
      statusResponse({
        code: 200,
        data: {
          id: 'task_fail',
          status: 'failed',
          error: { code: 401, type: 'authentication_error', message: 'API 密钥无效' },
        },
      }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'auth', providerType: 'apimart' });
  });

  it('status=failed + error.type=invalid_request_error → code=invalid_request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(submitResponse());
    spy.mockResolvedValueOnce(
      statusResponse({
        code: 200,
        data: {
          id: 'task_fail',
          status: 'failed',
          error: { type: 'invalid_request_error', message: '参数错误' },
        },
      }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'invalid_request', providerType: 'apimart' });
  });

  it('status=failed 无 error 对象 → code=server + 默认文案', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(submitResponse());
    spy.mockResolvedValueOnce(
      statusResponse({ code: 200, data: { id: 'task_fail', status: 'failed' } }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'server', message: 'Apimart 任务失败' });
  });

  it('status=cancelled → code=server + 取消文案', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(submitResponse());
    spy.mockResolvedValueOnce(
      statusResponse({ code: 200, data: { id: 'task_x', status: 'cancelled' } }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'server', message: 'Apimart 任务被取消' });
  });

  it('status=completed 但未返回图片 → ImageGenerationError(code=server)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(submitResponse());
    spy.mockResolvedValueOnce(
      statusResponse({
        code: 200,
        data: { id: 'task_x', status: 'completed', result: { images: [] } },
      }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'server', providerType: 'apimart' });
  });

  // ── abort 中途取消 ────────────────────────────────────────────────────────

  it('abort 中途取消 → ImageGenerationError(code=cancelled)', async () => {
    const ctrl = new AbortController();
    const ctx: ImageGenerationContext = {
      taskId: 'task-abort',
      signal: ctrl.signal,
      onProgress: vi.fn(),
    };

    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(submitResponse());
    spy.mockImplementationOnce(() => {
      ctrl.abort();
      return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    });

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), ctx),
    ).rejects.toMatchObject({ code: 'cancelled', providerType: 'apimart' });
  });

  // ── 错误类型 ──────────────────────────────────────────────────────────────

  it('抛出的错误是 ImageGenerationError 实例', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 401 }),
    );

    await expect(
      apimartImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toBeInstanceOf(ImageGenerationError);
  });

  // ── 进度回调 ──────────────────────────────────────────────────────────────

  it('进度回调：submit 阶段 submitting，结束 100', async () => {
    mockApimartImmediate();
    const ctx = makeCtx();
    await apimartImageProvider.generate(makeReq(), makeConfig(), ctx);

    const calls = (ctx.onProgress as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toMatchObject({ phase: 'submitting' });
    expect(calls[calls.length - 1][0]).toMatchObject({ percent: 100 });
  });
});

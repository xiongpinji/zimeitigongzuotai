import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageGenerationError } from '../../../src/lib/image-gen/errors';
import { wanxImageProvider } from '../../../src/lib/image-gen/providers/wanx';
import type {
  ImageGenerationContext,
  ImageGenerationRequest,
  ImageProviderConfig,
} from '../../../src/lib/image-gen/types';

// ── 辅助构建 ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ImageProviderConfig> = {}): ImageProviderConfig {
  return {
    baseUrl: 'https://dashscope.aliyuncs.com',
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
    model: 'wanx2.1-t2i-turbo',
    aspectRatio: '1:1',
    n: 1,
    ...overrides,
  };
}

/**
 * 快速 mock：submit → SUCCEEDED（跳过 RUNNING，无 sleep 等待）
 * 用于大多数只需验证请求/响应结构的用例
 */
function mockWanxImmediate(imageUrls: string[] = ['https://example.com/img1.jpg']): ReturnType<typeof vi.spyOn> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  // 第 1 次：submit
  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ output: { task_id: 'wanx-task-001', task_status: 'PENDING' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  // 第 2 次：status → SUCCEEDED（直接完成，跳过 RUNNING）
  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        output: {
          task_status: 'SUCCEEDED',
          results: imageUrls.map((url) => ({ url })),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  return fetchSpy;
}

/**
 * 完整 mock：submit → RUNNING → SUCCEEDED（验证中间轮询进度）
 * 使用 vi.useFakeTimers 跳过 sleep，需要在调用后 advanceTimersByTimeAsync
 */
function mockWanxWithRunning(imageUrls: string[] = ['https://example.com/img1.jpg']): ReturnType<typeof vi.spyOn> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ output: { task_id: 'wanx-task-r', task_status: 'PENDING' } }),
      { status: 200 },
    ),
  );
  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ output: { task_status: 'RUNNING' } }),
      { status: 200 },
    ),
  );
  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        output: { task_status: 'SUCCEEDED', results: imageUrls.map((url) => ({ url })) },
      }),
      { status: 200 },
    ),
  );

  return fetchSpy;
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('wanxImageProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── 基本属性 ──────────────────────────────────────────────────────────────

  it('type 为 wanx', () => {
    expect(wanxImageProvider.type).toBe('wanx');
  });

  it('capabilities 符合预期', () => {
    const cap = wanxImageProvider.capabilities;
    expect(cap.aspectRatios).toContain('1:1');
    expect(cap.aspectRatios).toContain('16:9');
    expect(cap.aspectRatios).toContain('9:16');
    expect(cap.maxN).toBe(4);
    expect(cap.supportsImageToImage).toBe(false);
    expect(cap.isAsync).toBe(true);
    expect(cap.defaultModels).toContain('wanx2.1-t2i-turbo');
    expect(cap.defaultModels).toContain('wanx2.1-t2i-plus');
    expect(cap.defaultModels).toContain('wan2.2-t2i-flash');
  });

  // ── 正常流程：submit → succeeded ────────────────────────────────────────

  it('正常完成：返回图片 URL 列表', async () => {
    mockWanxImmediate(['https://example.com/cat.jpg']);

    const result = await wanxImageProvider.generate(makeReq(), makeConfig(), makeCtx());

    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe('https://example.com/cat.jpg');
    expect(result.images[0].mimeType).toBe('image/jpeg');
  });

  it('正常完成（running→succeeded）：中间轮询后完成', async () => {
    vi.useFakeTimers();
    mockWanxWithRunning(['https://example.com/cat2.jpg']);

    const promise = wanxImageProvider.generate(makeReq(), makeConfig(), makeCtx());
    // 推进 2s 跳过 sleep(2000)
    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;

    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe('https://example.com/cat2.jpg');
  });

  // ── aspectRatio 映射 ──────────────────────────────────────────────────────

  it('aspectRatio 16:9 → size="1280*720"', async () => {
    const spy = mockWanxImmediate();
    await wanxImageProvider.generate(makeReq({ aspectRatio: '16:9' }), makeConfig(), makeCtx());

    const [, submitInit] = spy.mock.calls[0];
    const body = JSON.parse(submitInit?.body as string);
    expect(body.parameters.size).toBe('1280*720');
  });

  it('aspectRatio 9:16 → size="720*1280"', async () => {
    const spy = mockWanxImmediate();
    await wanxImageProvider.generate(makeReq({ aspectRatio: '9:16' }), makeConfig(), makeCtx());

    const [, submitInit] = spy.mock.calls[0];
    const body = JSON.parse(submitInit?.body as string);
    expect(body.parameters.size).toBe('720*1280');
  });

  it('aspectRatio 1:1 → size="1024*1024"', async () => {
    const spy = mockWanxImmediate();
    await wanxImageProvider.generate(makeReq({ aspectRatio: '1:1' }), makeConfig(), makeCtx());

    const [, submitInit] = spy.mock.calls[0];
    const body = JSON.parse(submitInit?.body as string);
    expect(body.parameters.size).toBe('1024*1024');
  });

  // ── submit 请求头验证 ────────────────────────────────────────────────────

  it('submit 请求头含 X-DashScope-Async: enable', async () => {
    const spy = mockWanxImmediate();
    await wanxImageProvider.generate(makeReq(), makeConfig(), makeCtx());

    const [, submitInit] = spy.mock.calls[0];
    const headers = submitInit?.headers as Record<string, string>;
    expect(headers['X-DashScope-Async']).toBe('enable');
  });

  it('submit 请求头含 Authorization: Bearer {apiKey}', async () => {
    const spy = mockWanxImmediate();
    await wanxImageProvider.generate(makeReq(), makeConfig({ apiKey: 'my-secret-key' }), makeCtx());

    const [, submitInit] = spy.mock.calls[0];
    const headers = submitInit?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-key');
  });

  // ── submit body 结构 ──────────────────────────────────────────────────────

  it('submit body 结构：model / input.prompt / parameters', async () => {
    const spy = mockWanxImmediate();
    await wanxImageProvider.generate(
      makeReq({ model: 'wanx2.1-t2i-plus', n: 3, prompt: '山水画' }),
      makeConfig(),
      makeCtx(),
    );

    const [, submitInit] = spy.mock.calls[0];
    const body = JSON.parse(submitInit?.body as string);
    expect(body.model).toBe('wanx2.1-t2i-plus');
    expect(body.input.prompt).toBe('山水画');
    expect(body.parameters.n).toBe(3);
  });

  // ── HTTP 错误 ─────────────────────────────────────────────────────────────

  it('submit 401 → ImageGenerationError(code=auth)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 }),
    );

    await expect(
      wanxImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'auth', providerType: 'wanx' });
  });

  it('submit 429 → ImageGenerationError(code=rate_limited)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Too Many Requests' }), { status: 429 }),
    );

    await expect(
      wanxImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'rate_limited', providerType: 'wanx' });
  });

  it('submit 500 → ImageGenerationError(code=server)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(
      wanxImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'server', providerType: 'wanx' });
  });

  it('抛出的错误是 ImageGenerationError 实例', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 401 }),
    );

    await expect(
      wanxImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toBeInstanceOf(ImageGenerationError);
  });

  // ── task_status=FAILED → server error ────────────────────────────────────

  it('task_status=FAILED → ImageGenerationError(code=server)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');

    // submit
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ output: { task_id: 'task-fail', task_status: 'PENDING' } }),
        { status: 200 },
      ),
    );
    // status → FAILED
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output: { task_status: 'FAILED', message: '生成失败：内容违规' },
        }),
        { status: 200 },
      ),
    );

    await expect(
      wanxImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'server', providerType: 'wanx' });
  });

  it('task_status=FAILED 无 message 时使用默认文案', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');

    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ output: { task_id: 'task-fail2', task_status: 'PENDING' } }),
        { status: 200 },
      ),
    );
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ output: { task_status: 'FAILED' } }),
        { status: 200 },
      ),
    );

    await expect(
      wanxImageProvider.generate(makeReq(), makeConfig(), makeCtx()),
    ).rejects.toMatchObject({ code: 'server', message: 'wanx 任务失败' });
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

    // submit 成功
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ output: { task_id: 'task-c', task_status: 'PENDING' } }),
        { status: 200 },
      ),
    );

    // status 轮询时 abort 发生，fetch 抛 AbortError
    spy.mockImplementationOnce(() => {
      ctrl.abort();
      return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    });

    await expect(
      wanxImageProvider.generate(makeReq(), makeConfig(), ctx),
    ).rejects.toMatchObject({ code: 'cancelled', providerType: 'wanx' });
  });

  // ── baseUrl 默认值 ────────────────────────────────────────────────────────

  it('baseUrl 为空时使用默认 https://dashscope.aliyuncs.com', async () => {
    const spy = mockWanxImmediate();
    await wanxImageProvider.generate(makeReq(), makeConfig({ baseUrl: '' }), makeCtx());

    const [submitUrl] = spy.mock.calls[0];
    expect(String(submitUrl)).toContain('https://dashscope.aliyuncs.com');
  });

  // ── 进度回调 ──────────────────────────────────────────────────────────────

  it('进度回调：submit 阶段上报 submitting，完成上报 100', async () => {
    mockWanxImmediate(['https://example.com/p.jpg']);

    const ctx = makeCtx();
    await wanxImageProvider.generate(makeReq(), makeConfig(), ctx);

    const calls = (ctx.onProgress as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toMatchObject({ phase: 'submitting' });
    expect(calls[calls.length - 1][0]).toMatchObject({ percent: 100 });
  });
});

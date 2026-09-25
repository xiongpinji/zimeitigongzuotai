import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viduProvider } from '../src/lib/video-gen/providers/vidu';
import { VideoGenerationError } from '../src/lib/video-gen/errors';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vidu provider', () => {
  it('成功路径：submit → poll → 返回 url', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ task_id: 't1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: 'success',
            creations: [{ url: 'http://x/y.mp4', cover_url: 'http://x/y.jpg', width: 1920, height: 1080, duration: 6 }],
          }),
          { status: 200 },
        ),
      );
    const result = await viduProvider.generate(
      { prompt: 'a cat', model: 'vidu-2', aspectRatio: '16:9', durationSeconds: 6 },
      { baseUrl: 'https://api.vidu.com', apiKey: 'key' },
      { taskId: 't1', signal: new AbortController().signal, onProgress: () => {} },
    );
    expect(result.videoUrl).toBe('http://x/y.mp4');
    expect(result.posterUrl).toBe('http://x/y.jpg');
    expect(result.durationMs).toBe(6000);
  });

  it('401 抛 auth 错误', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(
      viduProvider.generate(
        { prompt: 'a cat', model: 'vidu-2', aspectRatio: '16:9', durationSeconds: 6 },
        { baseUrl: 'https://api.vidu.com', apiKey: 'bad' },
        { taskId: 't1', signal: new AbortController().signal, onProgress: () => {} },
      ),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('durationSeconds 不在档位抛 invalid_request', async () => {
    await expect(
      viduProvider.generate(
        { prompt: 'a cat', model: 'vidu-2', aspectRatio: '16:9', durationSeconds: 5 },
        { baseUrl: 'https://api.vidu.com', apiKey: 'key' },
        { taskId: 't1', signal: new AbortController().signal, onProgress: () => {} },
      ),
    ).rejects.toBeInstanceOf(VideoGenerationError);
  });

  it('failed state 透传错误', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 't1' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: 'failed', err_code: 'content_policy' }), { status: 200 }),
      );
    await expect(
      viduProvider.generate(
        { prompt: 'a cat', model: 'vidu-2', aspectRatio: '16:9', durationSeconds: 6 },
        { baseUrl: 'https://api.vidu.com', apiKey: 'key' },
        { taskId: 't1', signal: new AbortController().signal, onProgress: () => {} },
      ),
    ).rejects.toMatchObject({ code: 'content_policy' });
  });
});

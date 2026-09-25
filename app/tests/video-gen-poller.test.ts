import { describe, expect, it, vi } from 'vitest';
import { pollVideoUntilDone } from '../src/lib/video-gen/async-poller';
import { VideoGenerationError } from '../src/lib/video-gen/errors';

describe('pollVideoUntilDone', () => {
  it('成功路径：submit → fetchStatus 多次 → succeeded', async () => {
    const onProgress = vi.fn();
    const result = await pollVideoUntilDone({
      submit: async () => ({ taskId: 't1' }),
      fetchStatus: vi
        .fn()
        .mockResolvedValueOnce({ status: 'running', percent: 30 })
        .mockResolvedValueOnce({
          status: 'succeeded',
          result: { videoUrl: 'http://x/y.mp4', durationMs: 6000, width: 1920, height: 1080 },
        }),
      intervalMs: 1,
      timeoutMs: 5000,
      onProgress,
      signal: new AbortController().signal,
      providerType: 'vidu',
    });
    expect(result.videoUrl).toBe('http://x/y.mp4');
    expect(onProgress).toHaveBeenCalled();
  });

  it('failed status 抛 VideoGenerationError', async () => {
    await expect(
      pollVideoUntilDone({
        submit: async () => ({ taskId: 't1' }),
        fetchStatus: async () => ({
          status: 'failed',
          error: { code: 'content_policy' as const, message: '违规' },
        }),
        intervalMs: 1,
        onProgress: () => {},
        signal: new AbortController().signal,
        providerType: 'vidu',
      }),
    ).rejects.toBeInstanceOf(VideoGenerationError);
  });

  it('signal abort 抛 cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      pollVideoUntilDone({
        submit: async () => ({ taskId: 't1' }),
        fetchStatus: async () => ({ status: 'running' }),
        intervalMs: 1,
        onProgress: () => {},
        signal: ac.signal,
        providerType: 'vidu',
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('超时抛 VideoGenerationError(timeout)', async () => {
    await expect(
      pollVideoUntilDone({
        submit: async () => ({ taskId: 't1' }),
        fetchStatus: async () => ({ status: 'running' }),
        intervalMs: 1,
        timeoutMs: 5,
        onProgress: () => {},
        signal: new AbortController().signal,
        providerType: 'vidu',
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('sleep 期间 abort 立即响应（不必等下一轮）', async () => {
    const ac = new AbortController();
    const fetchStatus = vi.fn().mockResolvedValue({ status: 'running' });
    const promise = pollVideoUntilDone({
      submit: async () => ({ taskId: 't1' }),
      fetchStatus,
      intervalMs: 5000,
      timeoutMs: 30_000,
      onProgress: () => {},
      signal: ac.signal,
      providerType: 'vidu',
    });
    // 等一帧让首轮 fetchStatus 落地、进入 sleep
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('succeeded 但缺 result 抛 server', async () => {
    await expect(
      pollVideoUntilDone({
        submit: async () => ({ taskId: 't1' }),
        fetchStatus: async () => ({ status: 'succeeded' as const }),
        intervalMs: 1,
        onProgress: () => {},
        signal: new AbortController().signal,
        providerType: 'vidu',
      }),
    ).rejects.toMatchObject({ code: 'server' });
  });
});

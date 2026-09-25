import { describe, expect, it, vi } from 'vitest';
import { pollUntilDone } from '../../src/lib/image-gen/async-poller';
import { ImageGenerationError } from '../../src/lib/image-gen/errors';

function createCtx() {
  const ctrl = new AbortController();
  const updates: Array<{ percent?: number; phase?: string; message?: string }> = [];
  return {
    signal: ctrl.signal,
    abort: () => ctrl.abort(),
    updates,
    onProgress: (u: { percent?: number; phase?: string; message?: string }) => updates.push(u),
  };
}

describe('pollUntilDone', () => {
  it('正常完成路径返回 result，并上报中间进度', async () => {
    const ctx = createCtx();
    let polls = 0;
    const result = await pollUntilDone<{ url: string }>({
      providerType: 'doubao',
      submit: async () => ({ taskId: 't-1' }),
      fetchStatus: async () => {
        polls++;
        if (polls < 2) return { status: 'running', percent: 50 };
        return { status: 'succeeded', result: { url: 'http://x/y.png' } };
      },
      intervalMs: 5,
      timeoutMs: 5000,
      onProgress: ctx.onProgress,
      signal: ctx.signal,
    });
    expect(result).toEqual({ url: 'http://x/y.png' });
    expect(polls).toBe(2);
    expect(ctx.updates.some((u) => u.percent === 100)).toBe(true);
    expect(ctx.updates.some((u) => u.phase === 'submitting')).toBe(true);
  });

  it('failed 状态抛 ImageGenerationError，错误码使用响应中的 code', async () => {
    const ctx = createCtx();
    await expect(
      pollUntilDone({
        providerType: 'wanx',
        submit: async () => ({ taskId: 't' }),
        fetchStatus: async () => ({
          status: 'failed',
          error: { code: 'content_policy', message: '内容违规' },
        }),
        intervalMs: 5,
        timeoutMs: 1000,
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      }),
    ).rejects.toMatchObject({ code: 'content_policy' });
  });

  it('超时抛 timeout', async () => {
    const ctx = createCtx();
    await expect(
      pollUntilDone({
        providerType: 'doubao',
        submit: async () => ({ taskId: 't' }),
        fetchStatus: async () => ({ status: 'running' }),
        intervalMs: 10,
        timeoutMs: 30,
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('signal abort 抛 cancelled', async () => {
    const ctx = createCtx();
    const promise = pollUntilDone({
      providerType: 'wanx',
      submit: async () => ({ taskId: 't' }),
      fetchStatus: async () => ({ status: 'running' }),
      intervalMs: 50,
      timeoutMs: 5000,
      onProgress: ctx.onProgress,
      signal: ctx.signal,
    });
    setTimeout(() => ctx.abort(), 10);
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('succeeded 但缺 result 抛 server', async () => {
    const ctx = createCtx();
    await expect(
      pollUntilDone({
        providerType: 'doubao',
        submit: async () => ({ taskId: 't' }),
        fetchStatus: async () => ({ status: 'succeeded' }),
        intervalMs: 5,
        timeoutMs: 1000,
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      }),
    ).rejects.toMatchObject({ code: 'server' });
  });
});

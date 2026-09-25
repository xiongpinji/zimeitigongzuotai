import { describe, it, expect, vi } from 'vitest';
import { createProcessingQueue } from '@/background/processing-queue';
import type { ProcessingService } from '@/background/services';
import type { ProcessingTask, TranscriptDocument } from '@/domain/models';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function makeProcessing() {
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const processing: ProcessingService = {
    process: vi.fn(async (videoId: string): Promise<ProcessingTask> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const gate = gates.get(videoId);
      if (gate) await gate.promise;
      order.push(videoId);
      active -= 1;
      return { id: `t-${videoId}`, videoId, stage: 'completed', progress: 1 };
    }),
    start: vi.fn(async (videoId: string): Promise<ProcessingTask> => ({ id: `t-${videoId}`, videoId, stage: 'queued', progress: 0 })),
    cancel: vi.fn(async () => {}),
  };
  return { processing, order, gate: (id: string) => gates.set(id, deferred()), release: (id: string) => gates.get(id)?.resolve(), getMax: () => maxActive };
}

const noTranscriptRepo = { getTranscript: vi.fn(async () => null) };

describe('createProcessingQueue', () => {
  it('runs tasks one at a time in FIFO order', async () => {
    const { processing, order, getMax } = makeProcessing();
    const queue = createProcessingQueue({ processing, repo: noTranscriptRepo });

    await queue.enqueue('a');
    await queue.enqueue('b');
    await queue.enqueue('c');
    await queue.idle();

    expect(order).toEqual(['a', 'b', 'c']);
    expect(getMax()).toBe(1);
  });

  it('dedupes a videoId already queued or in flight', async () => {
    const m = makeProcessing();
    m.gate('a');
    const queue = createProcessingQueue({ processing: m.processing, repo: noTranscriptRepo });

    await queue.enqueue('a');
    await queue.enqueue('a'); // in flight → ignored
    await queue.enqueue('a'); // still in flight → ignored
    m.release('a');
    await queue.idle();

    expect(m.processing.process).toHaveBeenCalledTimes(1);
  });

  it('skips a video that already has a transcript (default, non-force)', async () => {
    const m = makeProcessing();
    const transcript = { videoId: 'a' } as unknown as TranscriptDocument;
    const repo = { getTranscript: vi.fn(async () => transcript) };
    const queue = createProcessingQueue({ processing: m.processing, repo });

    await queue.enqueue('a');
    await queue.idle();

    expect(m.processing.process).not.toHaveBeenCalled();
  });

  it('re-processes despite an existing transcript when force is set', async () => {
    const m = makeProcessing();
    const repo = { getTranscript: vi.fn(async () => ({ videoId: 'a' } as unknown as TranscriptDocument)) };
    const queue = createProcessingQueue({ processing: m.processing, repo });

    await queue.enqueue('a', { force: true });
    await queue.idle();

    expect(m.processing.process).toHaveBeenCalledWith('a', { force: true });
  });

  it('keeps draining after one task fails and reports the error', async () => {
    const order: string[] = [];
    const processing: ProcessingService = {
      process: vi.fn(async (videoId: string) => {
        if (videoId === 'a') throw new Error('boom');
        order.push(videoId);
        return { id: `t-${videoId}`, videoId, stage: 'completed', progress: 1 } as ProcessingTask;
      }),
      start: vi.fn(async (videoId: string) => ({ id: `t-${videoId}`, videoId, stage: 'queued', progress: 0 }) as ProcessingTask),
      cancel: vi.fn(async () => {}),
    };
    const onError = vi.fn();
    const queue = createProcessingQueue({ processing, repo: noTranscriptRepo, onError });

    await queue.enqueue('a');
    await queue.enqueue('b');
    await queue.idle();

    expect(order).toEqual(['b']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('a');
  });

  it('成功处理后触发 onProcessed；onProcessed 抛错不阻断队列', async () => {
    const m = makeProcessing();
    const onProcessed = vi.fn(async (videoId: string) => {
      if (videoId === 'a') throw new Error('bridge down');
    });
    const onError = vi.fn();
    const queue = createProcessingQueue({
      processing: m.processing,
      repo: noTranscriptRepo,
      onProcessed,
      onError,
    });

    await queue.enqueue('a');
    await queue.enqueue('b');
    await queue.idle();

    expect(onProcessed.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(m.order).toEqual(['a', 'b']); // onProcessed 抛错不影响后续处理
    expect(onError).toHaveBeenCalledTimes(1); // a 的 onProcessed 错误被上报
  });
});

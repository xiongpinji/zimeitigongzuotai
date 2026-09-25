import type { VideoProviderType } from '../../types/ai';
import { VideoGenerationError, type VideoGenerationErrorCode } from './errors';
import type { VideoGenerationContext } from './types';

export interface VideoPollerStatus<T> {
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  percent?: number;
  result?: T;
  error?: { code: VideoGenerationErrorCode; message: string };
}

export interface VideoPollerOptions<T> {
  submit: () => Promise<{ taskId: string; estimatedSeconds?: number }>;
  fetchStatus: (taskId: string) => Promise<VideoPollerStatus<T>>;
  intervalMs?: number;
  /** 默认 300_000（视频生成长轮询，5min） */
  timeoutMs?: number;
  onProgress: VideoGenerationContext['onProgress'];
  signal: AbortSignal;
  providerType: VideoProviderType;
}

const FAKE_PERCENT_STEPS = [10, 25, 45, 60, 75, 85, 92, 95];

export async function pollVideoUntilDone<T>(opts: VideoPollerOptions<T>): Promise<T> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const startedAt = Date.now();

  ensureNotAborted(opts.signal, opts.providerType);
  opts.onProgress({ percent: 5, phase: 'submitting', message: '提交视频生成任务…' });

  const submission = await opts.submit();
  const { taskId } = submission;
  opts.onProgress({ percent: 8, phase: 'queued', message: '已入队，等待生成…' });

  let fakeStepIndex = 0;
  while (true) {
    ensureNotAborted(opts.signal, opts.providerType);
    if (Date.now() - startedAt > timeoutMs) {
      throw new VideoGenerationError(
        'timeout',
        opts.providerType,
        `视频任务 ${taskId} 超过 ${Math.round(timeoutMs / 1000)}s 仍未完成`,
      );
    }

    let status: VideoPollerStatus<T>;
    try {
      status = await opts.fetchStatus(taskId);
    } catch (err) {
      if (err instanceof VideoGenerationError) throw err;
      throw new VideoGenerationError(
        'network',
        opts.providerType,
        `查询任务状态失败：${(err as Error).message}`,
        err,
      );
    }

    if (status.status === 'succeeded') {
      if (status.result === undefined) {
        throw new VideoGenerationError(
          'server',
          opts.providerType,
          `任务 ${taskId} 标记 succeeded 但缺少结果`,
        );
      }
      opts.onProgress({ percent: 99, phase: 'rendering', message: '生成完成，准备下载…' });
      return status.result;
    }
    if (status.status === 'failed') {
      throw new VideoGenerationError(
        status.error?.code ?? 'server',
        opts.providerType,
        status.error?.message ?? '视频生成失败',
      );
    }

    const percent = status.percent ?? FAKE_PERCENT_STEPS[Math.min(fakeStepIndex, FAKE_PERCENT_STEPS.length - 1)];
    fakeStepIndex += 1;
    opts.onProgress({ percent, phase: 'rendering', message: '模型生成中…' });
    await sleep(intervalMs, opts.signal, opts.providerType);
  }
}

function ensureNotAborted(signal: AbortSignal, providerType: VideoProviderType): void {
  if (signal.aborted) {
    throw new VideoGenerationError('cancelled', providerType, '任务已取消');
  }
}

function sleep(ms: number, signal: AbortSignal, providerType: VideoProviderType): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new VideoGenerationError('cancelled', providerType, '任务已取消'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new VideoGenerationError('cancelled', providerType, '任务已取消'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 串行处理队列（设计文档 7.1：同一时刻只执行一个媒体处理任务）。
 *
 * 自动监控发现新作品时，逐条入队「字幕解析（+ 可选摘要）」。队列保证：
 * - 单飞：同一时刻只跑一个 process，避免多视频并发占满内存。
 * - 去重：同一 videoId 在排队/执行中重复入队会被忽略。
 * - 跳过已转录：非 force/onlySummary 时，已有字幕的作品不重复转录。
 * - 容错：单条失败不阻断后续，错误经 onError 上报（不抛出）。
 *
 * 纯编排，processing/repo 注入，可单测。
 */
import type { ProcessVideoOptions } from '@/domain/api-types';
import type { TranscriptDocument } from '@/domain/models';
import type { ProcessingService } from './services';

export interface ProcessingQueueDeps {
  processing: ProcessingService;
  repo: { getTranscript(videoId: string): Promise<TranscriptDocument | null> };
  /** 单条处理失败时回调（队列不抛出，继续后续任务）。 */
  onError?: (videoId: string, error: unknown) => void;
  /** 单条处理成功后回调（转录已落库）；用于推送桥。失败不阻断队列。 */
  onProcessed?: (videoId: string) => void | Promise<void>;
}

export interface ProcessingQueue {
  /** 入队一条作品的处理；已在队列/执行中或已转录（非 force）时静默跳过。 */
  enqueue(videoId: string, options?: ProcessVideoOptions): Promise<void>;
  /** 当前排队 + 执行中的任务数。 */
  size(): number;
  /** 等待队列清空（测试与关停用）。 */
  idle(): Promise<void>;
}

interface QueueItem {
  videoId: string;
  options?: ProcessVideoOptions;
}

export function createProcessingQueue(deps: ProcessingQueueDeps): ProcessingQueue {
  const pending: QueueItem[] = [];
  const tracked = new Set<string>();
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (pending.length > 0) {
      const item = pending.shift()!;
      try {
        await deps.processing.process(item.videoId, item.options);
        // 转录已落库 → 推桥（失败不阻断队列）。
        try {
          await deps.onProcessed?.(item.videoId);
        } catch (error) {
          deps.onError?.(item.videoId, error);
        }
      } catch (error) {
        deps.onError?.(item.videoId, error);
      } finally {
        tracked.delete(item.videoId);
      }
    }
    running = null;
  }

  return {
    async enqueue(videoId, options) {
      if (tracked.has(videoId)) return;
      // 默认（非 force / 非 onlySummary）跳过已转录作品，避免每轮监控重复转录。
      if (!options?.force && !options?.onlySummary) {
        const existing = await deps.repo.getTranscript(videoId);
        if (existing) return;
      }
      tracked.add(videoId);
      pending.push(options ? { videoId, options } : { videoId });
      if (!running) running = drain();
    },

    size() {
      return tracked.size;
    },

    async idle() {
      while (running) await running;
    },
  };
}

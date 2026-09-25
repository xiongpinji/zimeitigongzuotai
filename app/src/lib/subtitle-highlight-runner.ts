import type { SrtEntry, SubtitleHighlight } from '../types';
import type { AISettings } from '../types/ai';
import {
  buildSubtitleHighlightSystemPrompt,
  buildSubtitleHighlightUserMessage,
} from './subtitle-highlight-ai';
import { generateStructuredData } from './llm';
import { parseSubtitleHighlightResponse } from './subtitle-highlight-service';
import type { TelemetryHook } from './telemetry/auto-run';

export interface SubtitleHighlightProgress {
  batchIndex: number;
  batchTotal: number;
  processedEntries: number;
  totalEntries: number;
  percent: number;
}

interface GenerateSubtitleHighlightsOptions {
  batchSize?: number;
  /**
   * 同时进行的 batch 数。默认 3。LLM 请求是 I/O 密集型，3-4 并行通常稳定低于 provider 限速，
   * 又能把"5000 字字幕跑 4 个 batch 串行 5+ 分钟"压到 1-2 分钟。
   */
  concurrency?: number;
  generateStructuredData?: typeof generateStructuredData;
  onProgress?: (progress: SubtitleHighlightProgress) => void;
  shouldCancel?: () => boolean;
  telemetry?: TelemetryHook;
}

export async function generateSubtitleHighlights(
  entries: SrtEntry[],
  settings: AISettings,
  options: GenerateSubtitleHighlightsOptions = {},
): Promise<SubtitleHighlight[]> {
  if (entries.length === 0) {
    return [];
  }

  const batchSize = Math.max(1, options.batchSize ?? 30);
  const rawConcurrency = options.concurrency ?? 3;
  const concurrency = Math.max(1, Math.floor(rawConcurrency));
  const requestStructuredData = options.generateStructuredData ?? generateStructuredData;
  const systemPrompt = buildSubtitleHighlightSystemPrompt();
  const telemetry = options.telemetry;

  // 切批：保留原顺序，每个 batch 独立可并行
  const batches: { index: number; entries: SrtEntry[] }[] = [];
  for (let i = 0; i < entries.length; i += batchSize) {
    batches.push({ index: batches.length, entries: entries.slice(i, i + batchSize) });
  }
  const batchTotal = batches.length;
  const results: SubtitleHighlight[][] = new Array(batchTotal).fill(null).map(() => []);
  let processedEntries = 0;

  options.onProgress?.({
    batchIndex: 0,
    batchTotal,
    processedEntries: 0,
    totalEntries: entries.length,
    percent: 0,
  });

  const stageStart = Date.now();
  telemetry?.emit('stage.start', {
    stage: 'highlights',
    totalEntries: entries.length,
    batchTotal,
    batchSize,
    concurrency,
  });

  // worker 池模式：从共享游标里抢任务，保证 concurrency 个 batch 同时跑
  let cursor = 0;
  const firstError: { current: unknown } = { current: null };

  const runOne = async (): Promise<void> => {
    while (true) {
      if (firstError.current) return;
      if (options.shouldCancel?.()) return;
      const myIndex = cursor;
      cursor += 1;
      if (myIndex >= batches.length) return;
      const batch = batches[myIndex];
      const batchStart = Date.now();
      telemetry?.emit('highlight.batch.start', {
        batchIndex: myIndex,
        batchTotal,
        entries: batch.entries.length,
      });
      try {
        const payload = await requestStructuredData(
          settings,
          systemPrompt,
          buildSubtitleHighlightUserMessage(batch.entries),
          undefined,
          { label: `highlights#${myIndex + 1}/${batchTotal}`, telemetry },
        );
        results[myIndex] = parseSubtitleHighlightResponse(payload, batch.entries);
        processedEntries += batch.entries.length;
        telemetry?.emit('highlight.batch.end', {
          batchIndex: myIndex,
          batchTotal,
          durationMs: Date.now() - batchStart,
          ok: true,
        });
        options.onProgress?.({
          batchIndex: myIndex + 1,
          batchTotal,
          processedEntries,
          totalEntries: entries.length,
          percent: Math.round((processedEntries / entries.length) * 100),
        });
      } catch (err) {
        telemetry?.emit('highlight.batch.end', {
          batchIndex: myIndex,
          batchTotal,
          durationMs: Date.now() - batchStart,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!firstError.current) firstError.current = err;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, batchTotal) }, () => runOne()));

  if (firstError.current) {
    const message =
      firstError.current instanceof Error ? firstError.current.message : '未知错误';
    telemetry?.emit('stage.end', {
      stage: 'highlights',
      durationMs: Date.now() - stageStart,
      ok: false,
      error: message,
    });
    throw new Error(`字幕关键词高亮生成失败：${message}`);
  }

  telemetry?.emit('stage.end', {
    stage: 'highlights',
    durationMs: Date.now() - stageStart,
    ok: true,
    processedEntries,
  });

  return results.flat();
}

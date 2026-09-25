/**
 * 媒体处理编排（设计文档 5.9 / 8.1）。
 *
 * 阶段：queued → resolving → fetching_media → extracting_audio → transcribing → summarizing → completed
 * 各步骤注入（fetchMedia / extractAudio 默认由 SW + Offscreen Web Audio 实现），便于单测与替换。
 * 转录成功但摘要失败时保留字幕；onlySummary 复用已有字幕，跳过取流/提音/转录。
 */
import type { ProcessingStage, ProcessingTask, TranscriptDocument, VideoSource } from '@/domain/models';
import { SonarException, makeError, toSonarError } from '@/domain/errors';
import type { ProcessVideoOptions } from '@/domain/api-types';
import type { Repository } from '@/background/repository';
import type { ProcessingService } from '@/background/services';
import type { AsrProvider } from './asr-provider';
import type { SummaryProvider } from './summary-provider';

export interface ProcessingDeps {
  repo: Repository;
  resolveSources: (videoId: string) => Promise<VideoSource[]>;
  fetchMedia: (url: string) => Promise<Blob>;
  extractAudio: (video: Blob) => Promise<Blob>;
  asr: AsrProvider | null;
  summary: SummaryProvider | null;
  now: () => number;
  newId: () => string;
}

/** 最多尝试的候选源数量（含纯视频 DASH 流被跳过的情况）。 */
const MAX_SOURCE_ATTEMPTS = 4;

/**
 * 折叠尝试候选：抖音音视频分离时会下发多个同清晰度的纯视频 bit_rate 档位，直接占满尝试
 * 窗口会把带音轨的 download_addr 挤出去。这里只折叠「已知且相同清晰度 × 同水印态」的重复
 * 档位（无法判定重复的清晰度未知源全部保留），腾出窗口让真正含音频的源被尝试到。
 */
function foldAttemptCandidates(sources: VideoSource[]): VideoSource[] {
  const seen = new Set<string>();
  const out: VideoSource[] = [];
  for (const s of sources) {
    if (s.width === undefined && s.height === undefined) {
      out.push(s);
      continue;
    }
    const key = `${s.watermark === 'present' ? 'wm' : 'clean'}:${s.width ?? '?'}x${s.height ?? '?'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** 候选源的简短标签（主机 + 来源字段 + 清晰度），用于失败诊断，不含签名参数。 */
function sourceLabel(source: VideoSource): string {
  let host = '?';
  try {
    host = new URL(source.url).hostname;
  } catch {
    /* 非法 URL */
  }
  const res = source.width && source.height ? `${source.width}x${source.height}` : '';
  return [host, source.watermark, res].filter(Boolean).join('/');
}

const STAGE_PROGRESS: Record<ProcessingStage, number> = {
  queued: 0,
  resolving: 0.1,
  fetching_media: 0.3,
  extracting_audio: 0.5,
  transcribing: 0.7,
  summarizing: 0.9,
  completed: 1,
  failed: 1,
  cancelled: 1,
};

export function createProcessingService(deps: ProcessingDeps): ProcessingService {
  const cancelled = new Set<string>();

  async function runPipeline(
    id: string,
    videoId: string,
    options?: ProcessVideoOptions,
  ): Promise<ProcessingTask> {
    let task: ProcessingTask = { id, videoId, stage: 'queued', progress: 0 };

    const advance = async (stage: ProcessingStage): Promise<void> => {
      task = { ...task, stage, progress: STAGE_PROGRESS[stage] };
      await deps.repo.putProcessingTask(task);
      if (cancelled.has(id)) {
        throw new SonarException(makeError('TIMEOUT', '任务已取消'));
      }
    };

    try {
      await advance('queued');

      let transcript: TranscriptDocument | null = null;
      // 复用已有字幕，避免重复下载 mp3 + 重新转录：
      // - onlySummary（重新提取要点）：只重做摘要，必复用；
      // - 普通分析（无 options，「分析此视频」）：已有字幕则复用，直接进摘要；
      // - force（重新转录）：忽略已有字幕，强制重转。
      const reuse =
        options?.onlySummary || !options?.force ? await deps.repo.getTranscript(videoId) : null;

      if (reuse) {
        transcript = reuse;
      } else {
        // 仅在确实需要转录时才要求 ASR；复用字幕时不依赖 ASR Provider。
        if (!deps.asr) {
          throw new SonarException(
            makeError('ASR_NOT_CONFIGURED', '未配置 ASR Provider', { nextAction: '在设置中配置 ASR' }),
          );
        }
        await advance('resolving');
        const sources = await deps.resolveSources(videoId);
        if (sources.length === 0) {
          throw new SonarException(makeError('NO_DOWNLOADABLE_SOURCE', '没有可用于提取音频的视频源'));
        }

        // 逐个候选源尝试取流+提音，直到拿到含音频的源。
        // 抖音 Web 捕获的 bit_rate 档位常是「纯视频 DASH 流」（音视频分离），被排序为高优先；
        // 纯视频源经 ffmpeg `-vn` 后无任何输出流（“Output file #0 does not contain any stream”）。
        // 失败即换下一个候选；全部失败时把各候选的主机与原因汇总进 detail，便于定位。
        await advance('fetching_media');
        let audio: Blob | null = null;
        const attempts: string[] = [];
        for (const source of foldAttemptCandidates(sources).slice(0, MAX_SOURCE_ATTEMPTS)) {
          try {
            const media = await deps.fetchMedia(source.url);
            await advance('extracting_audio');
            audio = await deps.extractAudio(media);
            break;
          } catch (err) {
            if (cancelled.has(id)) throw err; // 用户取消则不再尝试其它候选
            const e = toSonarError(err);
            attempts.push(`${sourceLabel(source)}→${e.detail ?? e.message}`);
          }
        }
        if (!audio) {
          throw new SonarException(
            makeError('AUDIO_EXTRACTION_FAILED', '浏览器音频提取失败：候选源均无可用音频', {
              retryable: true,
              detail: attempts.join(' ｜ '),
            }),
          );
        }

        await advance('transcribing');
        transcript = await deps.asr.transcribe(audio, { videoId });
        await deps.repo.putTranscript(transcript);
      }

      // 摘要：
      // - 配置了 LLM Provider → 生成并落库。
      // - 未配置但本次「要求摘要」（用户主动分析 / onlySummary）→ 抛 SUMMARY_NOT_CONFIGURED，
      //   让 UI 明确提示去配置（字幕已落库，不丢失）；不再静默完成造成「点了没反应」。
      // - 未配置且不要求摘要（自动监控转录）→ 止于字幕，正常完成。
      const needSummary = Boolean(options?.requireSummary || options?.onlySummary);
      if (deps.summary) {
        await advance('summarizing');
        const analysis = await deps.summary.summarize(transcript, { videoId });
        await deps.repo.putAnalysis(analysis);
      } else if (needSummary) {
        throw new SonarException(
          makeError('SUMMARY_NOT_CONFIGURED', '未配置 AI 模型，无法生成摘要', {
            nextAction: '在设置中添加 AI Provider 并填写 API Key',
          }),
        );
      }

      await advance('completed');
      return task;
    } catch (thrown) {
      const error = toSonarError(thrown);
      task = { ...task, stage: 'failed', progress: 1, error };
      await deps.repo.putProcessingTask(task);
      throw thrown instanceof SonarException ? thrown : new SonarException(error);
    } finally {
      cancelled.delete(id);
    }
  }

  return {
    process(videoId: string, options?: ProcessVideoOptions): Promise<ProcessingTask> {
      return runPipeline(deps.newId(), videoId, options);
    },

    // 即时返回 queued 任务，管线在后台推进（每阶段写入 repo 供 UI 轮询）。
    // 失败被捕获进任务（poller 可读 task.error），不抛回调用方 —— UI 不再「点了没反应」。
    async start(videoId: string, options?: ProcessVideoOptions): Promise<ProcessingTask> {
      const id = deps.newId();
      const queued: ProcessingTask = { id, videoId, stage: 'queued', progress: 0 };
      await deps.repo.putProcessingTask(queued);
      void runPipeline(id, videoId, options).catch(() => {
        /* 失败已写入任务，由 UI 轮询读取 */
      });
      return queued;
    },

    async cancel(taskId: string): Promise<void> {
      cancelled.add(taskId);
      const existing = await deps.repo.getProcessingTask(taskId);
      if (existing) {
        await deps.repo.putProcessingTask({ ...existing, stage: 'cancelled', progress: 1 });
      }
    },
  };
}

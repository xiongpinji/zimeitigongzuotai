/**
 * 子系统服务契约（下载 / 媒体处理 / 监控 / 导出 / Provider 连通性测试）。
 *
 * handler 只依赖这里的接口，下载、Offscreen 音频提取、ASR、摘要与监控均可独立测试
 * 和替换实现。
 *
 * 默认 stub 返回**标准化错误**而非假成功：在子系统接入前，API 仍然连通（请求能路由、
 * 能拿到结构化结果），但如实反映「能力尚未就绪 / 未配置」。
 */
import type { Creator, DownloadTask, ProcessingTask, Video, VideoSource } from '@/domain/models';
import type {
  ExportTask,
  MarkdownExportInput,
  MonitorResult,
  ProcessVideoOptions,
  ProviderTestResult,
  TestAiProviderInput,
} from '@/domain/api-types';
import { SonarException, makeError } from '@/domain/errors';
import type { CollectCreatorInput, CollectCreatorResult } from './collect-tab';
import type { CollectProgressInfo } from './collect-progress';

export interface DownloadRequest {
  video: Video;
  creator: Creator | null;
  source: VideoSource;
}

export interface DownloadService {
  download(req: DownloadRequest): Promise<DownloadTask>;
  cancel(taskId: string): Promise<void>;
}

export interface ProcessingService {
  /** 同步运行整条管线，到终态才 resolve（自动监控串行队列用）。 */
  process(videoId: string, options?: ProcessVideoOptions): Promise<ProcessingTask>;
  /** 即时返回 queued 任务，管线在后台推进；供 UI 轮询阶段，不阻塞调用方。 */
  start(videoId: string, options?: ProcessVideoOptions): Promise<ProcessingTask>;
  cancel(taskId: string): Promise<void>;
}

export interface MonitorService {
  runOnce(creatorId?: string): Promise<MonitorResult>;
  /** 检查一批到期博主（按各自 intervalMinutes），定时调度调用。 */
  runDueBatch(opts?: { batchSize?: number }): Promise<MonitorResult>;
}

export interface ExportService {
  exportMarkdown(input: MarkdownExportInput): Promise<ExportTask>;
}

export interface AiProviderTester {
  test(input: TestAiProviderInput): Promise<ProviderTestResult>;
}

/** 博主作品全量采集（后台隐藏标签页滚动加载全部 + 进度）。 */
export interface CollectService {
  /** 后台开标签页全量采集某博主作品，完成或超时才 resolve。 */
  collectCreatorFully(input: CollectCreatorInput): Promise<CollectCreatorResult>;
  /** 读取某博主当前采集进度（无则 null）。 */
  getProgress(secUid: string): CollectProgressInfo | null;
}

/** 工作流流水线：拉入后自动「准备素材 → 爆款拆解」，停在 ready。 */
export interface WorkflowService {
  /** 后台运行/重跑某条流水线（fire-and-forget，阶段写 repo 供 UI 轮询）。 */
  run(itemId: string): Promise<void>;
}

export interface Services {
  download: DownloadService;
  processing: ProcessingService;
  monitor: MonitorService;
  export: ExportService;
  aiTester: AiProviderTester;
  collect: CollectService;
  workflow: WorkflowService;
}

/**
 * 默认 stub：子系统尚未接入时如实失败。
 * 监控返回空的、未熔断的结果（无收藏即无新作品，是合法的真实结果）。
 */
export function createStubServices(): Services {
  return {
    download: {
      async download() {
        throw new SonarException(
          makeError('DOWNLOAD_FAILED', '下载能力尚未接入', { nextAction: '等待下载模块上线' }),
        );
      },
      async cancel() {
        /* no-op */
      },
    },
    processing: {
      async process() {
        throw new SonarException(
          makeError('ASR_NOT_CONFIGURED', '媒体处理能力尚未接入', {
            nextAction: '等待转录/摘要模块上线',
          }),
        );
      },
      async start() {
        throw new SonarException(
          makeError('ASR_NOT_CONFIGURED', '媒体处理能力尚未接入', {
            nextAction: '等待转录/摘要模块上线',
          }),
        );
      },
      async cancel() {
        /* no-op */
      },
    },
    monitor: {
      async runOnce() {
        return { checkedCreatorIds: [], newVideoIds: [], circuitBroken: false };
      },
      async runDueBatch() {
        return { checkedCreatorIds: [], newVideoIds: [], circuitBroken: false };
      },
    },
    export: {
      async exportMarkdown() {
        throw new SonarException(makeError('EXPORT_FAILED', '导出能力尚未接入'));
      },
    },
    aiTester: {
      async test() {
        return { ok: false, error: makeError('SUMMARY_NOT_CONFIGURED', '尚未配置该 Provider') };
      },
    },
    collect: {
      async collectCreatorFully() {
        return { ok: false, collected: 0, reason: 'no_tab' };
      },
      getProgress() {
        return null;
      },
    },
    workflow: {
      async run() {
        /* 子系统未接入：no-op（阶段保持，不崩溃） */
      },
    },
  };
}

/**
 * DouyinClient 能力的请求参数与返回结果类型（设计文档第 6 节引用但未逐一定义的部分）。
 * 纯声明，构成 UI ↔ Service Worker 的稳定契约。AI 设置视图中的 API Key 一律遮罩。
 */
import type { SonarError } from './errors';
import type {
  Creator,
  CreatorSubscription,
  LlmProtocol,
  PageDetectionResult,
  Video,
  VideoSource,
} from './models';

// —— 采集 ——
export interface ListVideoOptions {
  /** 翻页游标（max_cursor）。 */
  cursor?: number;
  /** 期望条数。 */
  count?: number;
}

export interface VideoPage {
  videos: Video[];
  cursor?: number;
  hasMore: boolean;
}

// —— 博主作品全量采集（后台隐藏标签页滚动加载全部 + 进度）——
export interface CollectCreatorInput {
  secUid: string;
  /** 博主主页 URL（缺省由 secUid 拼出）。 */
  profileUrl?: string;
}

export interface CollectCreatorResult {
  ok: boolean;
  /** 入库去重后的作品数。 */
  collected: number;
  /** 主页声明的作品总数（读到时）。 */
  total?: number;
  /** 失败原因：无法开标签页 / Content Script 未就绪 / 超时未完成。 */
  reason?: 'no_tab' | 'not_ready' | 'timeout';
}

/** 全量采集实时进度视图（UI 轮询用）。 */
export interface CollectProgressView {
  secUid: string;
  collected: number;
  total?: number;
  round: number;
  done: boolean;
  updatedAt: number;
}

// —— 解析与下载 ——
export interface ResolveVideoInput {
  videoId?: string;
  /** 分享短链或包含文案的分享内容。 */
  shareUrl?: string;
  /** 当前页面 URL（视频页 / 作品弹层）。 */
  pageUrl?: string;
  /**
   * 强制走分享页现解析新鲜签名地址（在线播放 / 复制地址 / 下载时使用）。
   * 缺省走缓存优先，仅用于展示候选清晰度，签名可能已过期。
   */
  preferFresh?: boolean;
}

export interface ResolvedVideo {
  video: Video;
  /** 已去重排序的候选，best-first。 */
  sources: VideoSource[];
}

export interface DownloadOptions {
  /** 默认 false：无水印源不可用时返回 NO_WATERMARK_SOURCE，不静默下载带水印版本。 */
  allowWatermarkFallback?: boolean;
  /** 用户在 UI 中明确选择的源 URL（清晰度/编码）。 */
  preferredSourceUrl?: string;
}

// —— 媒体处理 ——
export interface ProcessVideoOptions {
  /** 强制重新处理（忽略已有结果）。 */
  force?: boolean;
  /** 仅重试摘要（转录已成功时）。 */
  onlySummary?: boolean;
  /**
   * 摘要为本次处理的必需产物：未配置可用 LLM Provider 时抛 SUMMARY_NOT_CONFIGURED，
   * 而非静默止于字幕（用户主动「分析/生成摘要」时应置 true，自动监控转录则保持 false）。
   * onlySummary 隐含 requireSummary。
   */
  requireSummary?: boolean;
}

// —— 监控 ——
export interface MonitorResult {
  checkedCreatorIds: string[];
  newVideoIds: string[];
  /** 是否因登录失效 / 验证码 / 访问限制触发熔断。 */
  circuitBroken: boolean;
  error?: SonarError;
}

// —— 导出 ——
export interface MarkdownExportInput {
  /** 单条或多条。 */
  videoIds: string[];
}

export interface ExportTask {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  filename?: string;
  error?: SonarError;
}

// —— 工作流（创作流水线）——
export interface AddWorkflowItemInput {
  videoId: string;
  note?: string;
}

/** 按 id 操作单条工作流条目（重试 / 移除 / 送二创）。 */
export interface WorkflowItemRef {
  id: string;
}

// —— 博主收藏 ——
export interface FollowCreatorInput {
  creator: Creator;
  intervalMinutes?: 15 | 30 | 60;
  autoAnalyze?: boolean;
  note?: string;
  group?: string;
}

// —— AI 设置（视图：API Key 遮罩） ——
// 转录固定走 bcut（零配置），不再有 ASR 配置项；这里只暴露 LLM（摘要/分析）多 Provider 配置。
export type AiProviderTarget = 'summary';

export interface LlmProviderView {
  id: string;
  name: string;
  protocol: LlmProtocol;
  baseUrl: string;
  models: string[];
  presetId?: string;
  /** 是否已写入 API Key（用于 UI 判断是否需要补填）。 */
  hasApiKey: boolean;
  apiKeyMasked?: string;
}

export interface LlmSettingsView {
  providers: LlmProviderView[];
  defaultProviderId?: string;
  defaultModel?: string;
  temperature?: number;
  /** 默认 Provider 是否可用（有 baseUrl，且有 Key 或免 Key 预设）。 */
  configured: boolean;
}

export interface AiSettingsView {
  llm: LlmSettingsView;
  /** 是否自动分析新视频。未配置 Provider 与数据发送确认前应为 false。 */
  autoAnalyze: boolean;
  /** 用户是否已确认音频/字幕会发送给配置的 Provider。 */
  dataSendConsent: boolean;
}

export interface LlmProviderInput {
  id: string;
  name: string;
  protocol: LlmProtocol;
  baseUrl: string;
  /** 写入用；省略表示保留同 id 既有 Key，不会回读明文。 */
  apiKey?: string;
  models: string[];
  presetId?: string;
}

export interface UpdateAiSettingsInput {
  llm?: {
    /** 整列表替换（省略 apiKey 的项保留既有 Key）。 */
    providers?: LlmProviderInput[];
    defaultProviderId?: string;
    defaultModel?: string;
    temperature?: number;
  };
  autoAnalyze?: boolean;
  dataSendConsent?: boolean;
}

export interface TestAiProviderInput {
  /** 目前仅 'summary'（LLM 默认 Provider）。 */
  target?: AiProviderTarget;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: SonarError;
}

export type { PageDetectionResult, CreatorSubscription };

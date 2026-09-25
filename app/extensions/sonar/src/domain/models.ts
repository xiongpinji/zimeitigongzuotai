/**
 * 稳定领域模型（设计文档第 7 节）。
 *
 * 抖音原始响应字段不直接暴露给 UI；DouyinAdapter 将其转换为这些稳定模型。
 * 这些类型是纯声明，没有运行时行为。
 */
import type { SonarError } from './errors';

export interface Creator {
  id: string;
  secUid: string;
  nickname: string;
  avatarUrl?: string;
  profileUrl: string;
  signature?: string;
  followerCount?: number;
  videoCount?: number;
  /** 本地最近一次标准化的时间戳（ms）。 */
  updatedAt: number;
}

export interface VideoStatistics {
  likeCount?: number;
  commentCount?: number;
  collectCount?: number;
  shareCount?: number;
  playCount?: number;
}

export interface Video {
  id: string;
  creatorId: string;
  description: string;
  coverUrl?: string;
  publishedAt: number;
  durationMs?: number;
  statistics?: VideoStatistics;
  sourcePageUrl: string;
}

export type WatermarkState = 'none' | 'present' | 'unknown';
export type WatermarkConfidence = 'high' | 'medium' | 'low';

export interface VideoSource {
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  codec?: string;
  watermark: WatermarkState;
  watermarkConfidence: WatermarkConfidence;
  /** 形成水印判断的证据条目（用于 UI 展示判断依据）。 */
  watermarkEvidence: string[];
  /** 带签名地址的过期时间（ms）。仅作短期缓存依据。 */
  expiresAt?: number;
  /** 来自图文/动态作品 images[] 的独立资产（静态图或实况短视频），UI 应作为单独一项展示。 */
  fromImageSet?: boolean;
}

export type DownloadStatus =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadTask {
  id: string;
  videoId: string;
  status: DownloadStatus;
  chromeDownloadId?: number;
  filename?: string;
  receivedBytes?: number;
  totalBytes?: number;
  error?: SonarError;
}

export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptDocument {
  videoId: string;
  provider: string;
  language: string;
  fullText: string;
  srtText: string;
  segments: TranscriptSegment[];
  createdAt: number;
}

export type VideoCategory =
  | '深度分析'
  | '数据解读'
  | '观点评论'
  | '科普讲解'
  | '资讯快讯'
  | '复盘总结';

export const VIDEO_CATEGORIES = [
  '深度分析',
  '数据解读',
  '观点评论',
  '科普讲解',
  '资讯快讯',
  '复盘总结',
] as const satisfies readonly VideoCategory[];

export interface VideoAnalysis {
  videoId: string;
  category: VideoCategory;
  summary: string;
  keyPoints: string[];
  tags: string[];
  model: string;
  createdAt: number;
}

/**
 * 摘要/分析 LLM Provider 支持的协议：
 * - 'openai'：POST {baseUrl}/chat/completions（OpenAI 兼容）
 * - 'anthropic'：POST {baseUrl}/v1/messages（Anthropic Messages，含 MiniMax anthropic 端点）
 */
export type LlmProtocol = 'openai' | 'anthropic';

export type ProcessingStage =
  | 'queued'
  | 'resolving'
  | 'fetching_media'
  | 'extracting_audio'
  | 'transcribing'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ProcessingTask {
  id: string;
  videoId: string;
  stage: ProcessingStage;
  /** 0..1 阶段进度。 */
  progress: number;
  error?: SonarError;
}

/**
 * 工作流流水线阶段（取代旧的手动看板 todo/in_progress/done）：
 * 拉入后自动 准备素材(抓取+转录) → 爆款拆解 → 待确认，确认后送进灵机剪影。
 */
export type WorkflowStage =
  | 'collected' // 刚拉进来，待开始
  | 'preparing' // 抓取源 + 转录中
  | 'analyzing' // 爆款拆解中
  | 'ready' // 拆解完成，待确认送二创
  | 'pushed' // 已送进灵机剪影待创作箱
  | 'failed'; // 某阶段失败

/** 面向口播二创的爆款拆解报告（LLM 产出，validateInsight 校验）。 */
export interface ViralInsight {
  videoId: string;
  /** 选题角度（一句话点破）。 */
  angle: string;
  /** 开头钩子（原话 + 为什么抓人）。 */
  hook: string;
  /** 内容骨架（分段提纲）。 */
  structure: string[];
  /** 记忆点 / 金句。 */
  highlights: string[];
  /** 引用的数据 / 论据（提醒二创核实或替换）。 */
  dataPoints: string[];
  /** 二创改造建议（换角度 / 换案例 / 换受众）。 */
  remixSuggestions: string[];
  model: string;
  createdAt: number;
}

export interface WorkflowItem {
  id: string;
  videoId: string;
  stage: WorkflowStage;
  /** 失败阶段的原因（stage='failed' 时）。 */
  error?: string;
  note: string;
  /** 由 insight 存储水合（listWorkflowItems 注入）；落库记录不含此字段。 */
  insight?: ViralInsight;
  createdAt: number;
  updatedAt: number;
}

/** 收藏博主及监控设置。 */
export interface CreatorSubscription {
  creator: Creator;
  /** 监控周期（分钟）：15 / 30 / 60。 */
  intervalMinutes: 15 | 30 | 60;
  /** 是否暂停监控。 */
  paused: boolean;
  /** 是否自动分析新视频（未配置 Provider 前默认 false）。 */
  autoAnalyze: boolean;
  /** 上次检查时间（ms）。 */
  lastCheckedAt?: number;
  /** 已知最新作品 ID（差异计算游标）。 */
  latestVideoId?: string;
  /** 备注名称与分组。 */
  note?: string;
  group?: string;
}

/** 页面类型识别结果。 */
export type PageType =
  | 'video'
  | 'creator'
  | 'video_modal'
  | 'share_link'
  | 'unsupported';

export interface PageDetectionResult {
  type: PageType;
  url: string;
  /** 已确定的作品 ID（视频页 / 弹层）。 */
  awemeId?: string;
  /** 已确定的博主 secUid（博主页）。 */
  secUid?: string;
}

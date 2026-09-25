/**
 * 阶段一生产数据契约（v1）—— 纯数据类型，无任何运行时依赖。
 *
 * 边界说明：
 * - 本契约描述「生产 sidecar 文档」：录屏、高光、授权素材、合成计划、视频版本、
 *   账号元数据与发布任务。它是纯 JSON 数据边界，可序列化、可跨进程传输。
 * - Lingji 现有项目（project.json 的 timeline 等）仍是**编辑事实来源**；
 *   本契约只保存对它的引用（timelineRef / projectId），绝不复制时间线内容，
 *   不形成第二套事实来源。
 * - 账号只保存元数据与不透明会话引用（sessionRef），Cookie / Token / 存储态
 *   文件内容永远不进入本契约。
 * - 本文件不 import 上游 `electron/publish/types.ts` 或 `src/types/ai.ts`，
 *   避免契约与上游实现耦合；平台命名映射（如 wechat-channels ↔ 上游 'tencent'）
 *   由未来 Electron main 的适配层负责。
 * - 所有字段在 v1 JSON 中均为必填；“可选”语义一律用 null 显式表达。
 *   解析器（src/lib/production-document.ts）不补默认值、不删字段、不做静默迁移。
 */

/** 当前契约版本。未知 / 未来版本必须被解析器显式拒绝。 */
export const PRODUCTION_SCHEMA_VERSION = 1 as const;

export type ProductionSchemaVersionV1 = typeof PRODUCTION_SCHEMA_VERSION;

/**
 * 阶段一支持的平台：抖音、快手、微信视频号、小红书。
 * 上游发布适配器中的 'bilibili' 不在本契约内；'wechat-channels' 对应上游
 * PublishPlatform 的 'tencent'（视频号），映射在适配层完成。
 */
export const PRODUCTION_PLATFORMS = [
  'douyin',
  'kuaishou',
  'wechat-channels',
  'xiaohongshu',
] as const;

export type ProductionPlatform = (typeof PRODUCTION_PLATFORMS)[number];

/** 画幅比例集合（与上游 ImageAspectRatio 取值一致，但独立声明避免耦合）。 */
export const PRODUCTION_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;

export type ProductionAspectRatio = (typeof PRODUCTION_ASPECT_RATIOS)[number];

// ——————————————————————————————— 录屏与高光 ———————————————————————————————

/**
 * 一段已导入的直播录屏。文件本体保存在仓库外 / 被忽略的本地数据目录，
 * 契约只保存引用与内容哈希，保证来源可追溯。
 */
export interface RecordingV1 {
  /** 稳定内部 ID（不透明字符串，如 UUID）；不得由文件名或昵称推导。 */
  id: string;
  /** 录屏文件引用（本地数据目录内路径或 opaque key），不含文件内容。 */
  sourceRef: string;
  /** 录屏内容 sha256（64 位十六进制），用于来源追溯与去重。 */
  sourceSha256: string;
  /** 录制时间（ISO 8601）；未知时为 null。 */
  capturedAt: string | null;
  /** 总时长（毫秒，非负整数）；未探测时为 null，此时不做上界校验。 */
  durationMs: number | null;
  /** MIME 类型；未知时为 null。 */
  mimeType: string | null;
  /** 转写产物引用；无转写时为 null。 */
  transcriptRef: string | null;
  /** 导入时间（ISO 8601）。 */
  importedAt: string;
}

/** 高光证据类型：转写、说话人、场景、音量峰值、互动、人工标注或其他。 */
export const HIGHLIGHT_EVIDENCE_KINDS = [
  'transcript',
  'speaker',
  'scene',
  'audio-peak',
  'interaction',
  'manual',
  'other',
] as const;

export type HighlightEvidenceKind = (typeof HIGHLIGHT_EVIDENCE_KINDS)[number];

/** 单条高光证据。时间码为所属录屏的绝对毫秒时间码，可为 null（点状证据）。 */
export interface HighlightEvidenceV1 {
  kind: HighlightEvidenceKind;
  startMs: number | null;
  endMs: number | null;
  note: string | null;
}

/** 高光边界的来源：算法候选或人工调整后。 */
export const HIGHLIGHT_BOUNDARY_ORIGINS = ['auto', 'human-adjusted'] as const;

export type HighlightBoundaryOrigin = (typeof HIGHLIGHT_BOUNDARY_ORIGINS)[number];

/**
 * 录屏中的一段高光候选 / 已确认片段。时间码是所属录屏的绝对毫秒时间码；
 * 人工调整边界通过 boundaryOrigin + adjustedAt 显式留痕。
 */
export interface HighlightV1 {
  id: string;
  /** 所属录屏 ID，必须存在于同一文档的 recordings 中。 */
  recordingId: string;
  /** 起始毫秒时间码（非负整数）。 */
  startMs: number;
  /** 结束毫秒时间码（非负整数，必须 > startMs，且不超过录屏总时长（若已知））。 */
  endMs: number;
  /** 候选分数（仅供质检参考，不等于平台原创判定）；无评分时为 null。 */
  score: number | null;
  topic: string | null;
  context: string | null;
  /** 证据列表；可为空数组，但字段必须存在。 */
  evidence: HighlightEvidenceV1[];
  boundaryOrigin: HighlightBoundaryOrigin;
  /** 最近一次人工调整时间（ISO 8601）；未人工调整时为 null。 */
  adjustedAt: string | null;
  createdAt: string;
}

// ——————————————————————————————— 授权素材 ———————————————————————————————

export const ASSET_MEDIA_TYPES = ['video', 'image', 'audio', 'subtitle'] as const;

export type AssetMediaType = (typeof ASSET_MEDIA_TYPES)[number];

/**
 * 素材库条目。来源、权利持有人、许可与使用范围必须可追溯；
 * 没有授权或来源不明的素材 authorizedForAutoUse=false，不得被自动入片。
 */
export interface AssetV1 {
  id: string;
  /** 素材内容 sha256（64 位十六进制）。 */
  sha256: string;
  mediaType: AssetMediaType;
  /** 时长（毫秒）；图片 / 字幕等无时长媒体为 null。 */
  durationMs: number | null;
  tags: string[];
  /** 转写文本（长文本）；无转写时为 null。 */
  transcript: string | null;
  /** 语义向量索引引用；未建索引时为 null。 */
  embeddingRef: string | null;
  /** 来源描述（购买记录 / 素材库 / 自拍 / 导入批次等），用于追溯。 */
  source: string;
  /** 权利持有人。 */
  rightsHolder: string;
  /** 许可（如 proprietary、cc-by-4.0、purchased-stock 等自由标识）。 */
  license: string;
  /** 授权使用范围（地域 / 媒介 / 期限等的文字描述）。 */
  usageScope: string;
  /** 是否已确认可自动入片；未授权 / 来源不明必须为 false。 */
  authorizedForAutoUse: boolean;
  importedAt: string;
}

// ——————————————————————————————— 合成计划 ———————————————————————————————

export const COMPOSITION_VOICEOVER_KINDS = ['original-audio', 'narration', 'mixed'] as const;

export type CompositionVoiceoverKind = (typeof COMPOSITION_VOICEOVER_KINDS)[number];

/** 分段可引用的素材来源类型。 */
export const COMPOSITION_SEGMENT_SOURCE_KINDS = ['recording', 'highlight', 'asset'] as const;

export type CompositionSegmentSourceKind = (typeof COMPOSITION_SEGMENT_SOURCE_KINDS)[number];

/**
 * 分段来源引用。inMs / outMs 语义按 kind 区分：
 * - recording / asset：来源媒体内的 0 起毫秒区间；
 * - highlight：所属录屏的绝对毫秒时间码，必须落在该高光 [startMs, endMs] 内。
 */
export interface CompositionSegmentSourceV1 {
  kind: CompositionSegmentSourceKind;
  /** 对应集合内的实体 ID，必须存在于同一文档中。 */
  sourceId: string;
  inMs: number;
  outMs: number;
}

export interface CompositionPlanSegmentV1 {
  id: string;
  /** 分段顺序（非负整数）。 */
  order: number;
  /** 该分段的叙事 / 镜头描述。 */
  description: string;
  source: CompositionSegmentSourceV1;
}

/**
 * 一版混剪的结构性描述：故事主旨、镜头顺序、来源片段与时间码。
 * 计划回写到 Lingji 可编辑时间线（timelineRef 只保存引用）；
 * 本契约不承诺任何平台“原创”认定。
 */
export interface CompositionPlanV1 {
  id: string;
  /** 故事主旨 / 叙事摘要。 */
  narrativeSummary: string;
  voiceoverKind: CompositionVoiceoverKind;
  aspectRatio: ProductionAspectRatio;
  segments: CompositionPlanSegmentV1[];
  /** 可编辑时间线引用（Lingji 项目内的 opaque 标识）；尚未回写时为 null。 */
  timelineRef: string | null;
  createdAt: string;
  updatedAt: string;
}

// ——————————————————————————————— 视频版本 ———————————————————————————————

export const VIDEO_VARIANT_STATUSES = [
  'planned',
  'rendering',
  'rendered',
  'qc_passed',
  'qc_failed',
] as const;

export type VideoVariantStatus = (typeof VIDEO_VARIANT_STATUSES)[number];

/**
 * 一个可发布的视频版本。编辑事实来源仍在 Lingji 时间线；
 * 这里只保存对合成计划、时间线与渲染产物（仓库外）的引用和质检状态。
 */
export interface VideoVariantV1 {
  id: string;
  /** 所属合成计划 ID，必须存在于同一文档中。 */
  compositionPlanId: string;
  /** 可编辑时间线引用；未绑定时间线时为 null。 */
  timelineRef: string | null;
  /** 渲染产物引用（本地数据目录）；未渲染时为 null。 */
  outputRef: string | null;
  /** 渲染产物 sha256（64 位十六进制）；未渲染时为 null。 */
  outputSha256: string | null;
  /** 产物时长（毫秒）；未渲染时为 null。 */
  durationMs: number | null;
  aspectRatio: ProductionAspectRatio;
  status: VideoVariantStatus;
  createdAt: string;
  updatedAt: string;
}

// ——————————————————————————————— 账号元数据 ———————————————————————————————

export const ACCOUNT_STATUSES = ['active', 'expired', 'needs_login', 'removed', 'unknown'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * 平台账号元数据。契约内**禁止**出现 Cookie / Token / 密码 / 存储态内容；
 * 会话仅以不透明引用（sessionRef）指向 Electron main 管理的加密会话仓。
 * 内部 ID 必须独立生成（如 UUID），不得由昵称 / displayName 推导。
 */
export interface AccountV1 {
  /** 内部不透明 ID；同平台多账号各自独立，不得等于 displayName。 */
  id: string;
  platform: ProductionPlatform;
  /** 展示昵称（仅用于 UI，不作唯一键）。 */
  displayName: string;
  /** 账号持有人标识（审计用，非凭证）。 */
  owner: string;
  status: AccountStatus;
  /** 加密会话仓的不透明引用；未登录 / 已删除时为 null。 */
  sessionRef: string | null;
  /** 能力快照（如商品挂载 not_implemented）；未知时为 null。 */
  capabilitySnapshot: Record<string, unknown> | null;
  /** 最近一次会话核验时间（ISO 8601）；从未核验时为 null。 */
  lastVerifiedAt: string | null;
  createdAt: string;
}

// ——————————————————————————————— 商品请求 ———————————————————————————————

/**
 * 商品类型：自建商品、店铺商品、联盟商品、小程序锚点。
 * 具体平台接口在用户研究后由 R6-C 决定，阶段一仅保留契约端口。
 */
export const COMMERCE_KINDS = ['self-built', 'shop', 'alliance', 'mini-program-anchor'] as const;

export type CommerceKind = (typeof COMMERCE_KINDS)[number];

/**
 * 商品挂载请求（阶段一预留端口，四个平台插件均报告 not_implemented）。
 * 携带本请求的任务在解析 / 迁移中不得被丢弃或静默降级为普通发布；
 * 阶段一预检必须阻止其提交（COMMERCE_NOT_CONFIGURED / needs_user_action）。
 */
export interface CommerceRequestV1 {
  platform: ProductionPlatform;
  /** 必须与所属发布任务的 accountId 一致。 */
  accountId: string;
  kind: CommerceKind;
  /** 平台自有商品 ID；不得用通用 URL 代替。 */
  platformProductId: string;
  /** true：必须挂车，预检阻止提交；false：仍进入 needs_user_action，绝不暗中降级。 */
  required: boolean;
}

// ——————————————————————————————— 发布任务 ———————————————————————————————

/**
 * 发布任务状态机（与 docs/architecture.md §F 对齐）：
 * draft → preflight → queued → uploading → submitted → verifying → published，
 * 以及人工接管 / 失败 / 未知提交状态。unknown_submission 必须先查远端，禁止盲重试。
 */
export const PUBLISH_JOB_STATES = [
  'draft',
  'preflight',
  'queued',
  'uploading',
  'submitted',
  'verifying',
  'published',
  'needs_login',
  'needs_permission',
  'needs_user_action',
  'retryable_failure',
  'terminal_failure',
  'unknown_submission',
] as const;

export type PublishJobState = (typeof PUBLISH_JOB_STATES)[number];

/** 任务文案与封面元数据。封面只保存引用（本地数据目录），不含文件内容。 */
export interface PublishJobMetadataV1 {
  /** 标题；draft 阶段允许为空串。 */
  title: string;
  description: string;
  tags: string[];
  coverRefs: string[];
  /** 计划发布时间（ISO 8601）；null 表示立即发布。 */
  scheduleAt: string | null;
}

export const PUBLISH_REMOTE_FINAL_STATES = ['published', 'failed', 'unknown'] as const;

export type PublishRemoteFinalState = (typeof PUBLISH_REMOTE_FINAL_STATES)[number];

/** 远端核验结果。状态不明时 finalState='unknown'，先查远端再决定重试。 */
export interface PublishJobRemoteResultV1 {
  remoteId: string | null;
  remoteUrl: string | null;
  finalState: PublishRemoteFinalState;
  /** 最近一次远端核验时间（ISO 8601）；尚未核验为 null。 */
  verifiedAt: string | null;
}

/**
 * 一个发布任务固定一个账号和一个视频版本。幂等键 + attempt + leaseUntil
 * 支撑持久化队列的重试与租约；commerceRequest 必须显式为 null 或完整对象。
 */
export interface PublishJobV1 {
  id: string;
  /** 账号 ID，必须存在于同一文档的 accounts 中。 */
  accountId: string;
  /** 视频版本 ID，必须存在于同一文档的 videoVariants 中。 */
  videoVariantId: string;
  metadata: PublishJobMetadataV1;
  /** 商品请求；普通发布必须显式为 null，字段不允许缺失。 */
  commerceRequest: CommerceRequestV1 | null;
  state: PublishJobState;
  /** 幂等键（非空），防止重复提交产生重复作品。 */
  idempotencyKey: string;
  /** 已尝试次数（非负整数）。 */
  attempt: number;
  /** 队列租约到期时间（ISO 8601）；无租约为 null。 */
  leaseUntil: string | null;
  remoteResult: PublishJobRemoteResultV1 | null;
  createdAt: string;
  updatedAt: string;
}

// ——————————————————————————————— 文档根 ———————————————————————————————

/**
 * 生产 sidecar 文档（v1）。单一项目模型：
 * - projectId 关联一个 Lingji 编辑项目，该项目的时间线是编辑事实来源；
 * - 本文档只保存生产链路元数据与引用，不复制时间线 / 素材 / 凭证内容；
 * - 首次没有 sidecar 时由调用方（未来的 Electron main）用
 *   createEmptyProductionDocument 创建空 v1；契约不存在 v0。
 */
export interface ProductionDocumentV1 {
  schemaVersion: ProductionSchemaVersionV1;
  /** 关联的 Lingji 项目标识（非空、非空白）。 */
  projectId: string;
  createdAt: string;
  updatedAt: string;
  recordings: RecordingV1[];
  highlights: HighlightV1[];
  assets: AssetV1[];
  compositionPlans: CompositionPlanV1[];
  videoVariants: VideoVariantV1[];
  accounts: AccountV1[];
  publishJobs: PublishJobV1[];
}

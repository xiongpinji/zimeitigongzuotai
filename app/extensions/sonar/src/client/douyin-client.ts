/**
 * DouyinClient — UI 使用抖音能力的唯一入口（设计文档第 6 / 12 节）。
 *
 * UI 四个表面都只依赖此接口，不直接访问 chrome.runtime，便于测试与后续替换实现。
 * 具体实现（createDouyinClient）经消息协议把请求送到 Service Worker 路由。
 */
import type {
  Creator,
  CreatorSubscription,
  DownloadTask,
  ProcessingTask,
  TranscriptDocument,
  Video,
  VideoAnalysis,
  WorkflowItem,
} from '@/domain/models';
import type {
  AddWorkflowItemInput,
  AiSettingsView,
  CollectCreatorInput,
  CollectCreatorResult,
  CollectProgressView,
  DownloadOptions,
  ExportTask,
  FollowCreatorInput,
  ListVideoOptions,
  MarkdownExportInput,
  MonitorResult,
  PageDetectionResult,
  ProcessVideoOptions,
  ProviderTestResult,
  ResolveVideoInput,
  ResolvedVideo,
  TestAiProviderInput,
  UpdateAiSettingsInput,
  VideoPage,
} from '@/domain/api-types';
import type { MethodName } from '@/protocol/methods';
import { createRequest } from '@/protocol/messages';
import { SonarException } from '@/domain/errors';
import type { BridgeSettingsView, UpdateBridgeSettingsInput } from '@/bridge/bridge-settings';
import type { ProbeResult } from '@/bridge/bridge-client';
import type { PushResult } from '@/bridge/push-on-processed';
import type { Transport } from './transport';

export interface DouyinClient {
  detectCurrentPage(): Promise<PageDetectionResult>;

  getCreator(creatorId: string): Promise<Creator>;
  /** 按页面 secUid 反查已采集的博主（未采集到返回 null）。 */
  getCreatorBySecUid(secUid: string): Promise<Creator | null>;
  listCreatorVideos(creatorId: string, options?: ListVideoOptions): Promise<VideoPage>;
  /** 全部已采集视频（视频库 / 动态流）。 */
  listRecentVideos(limit?: number): Promise<Video[]>;
  /** 后台开隐藏标签页全量采集某博主作品（滚动加载全部），完成或超时才 resolve。 */
  collectCreatorFully(input: CollectCreatorInput): Promise<CollectCreatorResult>;
  /** 读取某博主当前全量采集进度（无则 null）。 */
  getCollectProgress(secUid: string): Promise<CollectProgressView | null>;

  resolveVideo(input: ResolveVideoInput): Promise<ResolvedVideo>;
  downloadVideo(videoId: string, options?: DownloadOptions): Promise<DownloadTask>;
  getDownloadTask(taskId: string): Promise<DownloadTask>;
  cancelDownload(taskId: string): Promise<void>;

  followCreator(input: FollowCreatorInput): Promise<void>;
  unfollowCreator(creatorId: string): Promise<void>;
  listFollowedCreators(): Promise<CreatorSubscription[]>;
  runMonitorOnce(creatorId?: string): Promise<MonitorResult>;

  processVideo(videoId: string, options?: ProcessVideoOptions): Promise<ProcessingTask>;
  getProcessingTask(taskId: string): Promise<ProcessingTask>;
  cancelProcessingTask(taskId: string): Promise<void>;

  getTranscript(videoId: string): Promise<TranscriptDocument | null>;
  regenerateTranscript(videoId: string): Promise<ProcessingTask>;
  getAnalysis(videoId: string): Promise<VideoAnalysis | null>;
  /** 全部分析，单次取回供视频库批量水合。 */
  listAnalyses(): Promise<VideoAnalysis[]>;
  regenerateAnalysis(videoId: string): Promise<ProcessingTask>;

  exportMarkdown(input: MarkdownExportInput): Promise<ExportTask>;
  /** 把视频拉入创作流水线（自动开始准备素材 → 爆款拆解）。 */
  addToWorkflow(input: AddWorkflowItemInput): Promise<WorkflowItem>;
  /** 列出流水线条目（已水合各自 insight）。 */
  listWorkflowItems(): Promise<WorkflowItem[]>;
  /** 重跑某条流水线（失败后重试）。 */
  retryWorkflowItem(id: string): Promise<WorkflowItem>;
  /** 从流水线移除某条。 */
  removeWorkflowItem(id: string): Promise<boolean>;
  /** 确认送二创：把该条（含拆解报告）推送到灵机剪影待创作箱并标记 pushed。 */
  pushWorkflowItem(id: string): Promise<PushResult>;

  getAiSettings(): Promise<AiSettingsView>;
  updateAiSettings(input: UpdateAiSettingsInput): Promise<void>;
  testAiProvider(input: TestAiProviderInput): Promise<ProviderTestResult>;

  // 灵机剪影联动（桥）
  getBridgeSettings(): Promise<BridgeSettingsView>;
  updateBridgeSettings(input: UpdateBridgeSettingsInput): Promise<void>;
  testBridge(): Promise<ProbeResult>;
  /** 手动把某视频（须已转录）推送到灵机剪影待创作箱，命中已有则刷新为待创作。 */
  pushVideoToBridge(videoId: string): Promise<PushResult>;
  /** 一键自动连接：从本机 /sonar/pair 拉取 endpoint+token 并保存开启，返回是否成功与最新设置视图。 */
  autoConnectBridge(): Promise<{ ok: boolean; settings: BridgeSettingsView }>;
}

/**
 * 构造经传输层与 Service Worker 通信的 DouyinClient 实现。
 * 成功响应返回结果；失败响应抛出携带标准化 SonarError 的 SonarException。
 */
export function createDouyinClient(transport: Transport): DouyinClient {
  async function call<T>(method: MethodName, params: unknown): Promise<T> {
    const response = await transport.send(createRequest(method, params));
    if (response.ok) return response.result as T;
    throw new SonarException(response.error);
  }

  return {
    detectCurrentPage: () => call('detectCurrentPage', undefined),
    getCreator: (creatorId) => call('getCreator', { creatorId }),
    getCreatorBySecUid: (secUid) => call('getCreatorBySecUid', { secUid }),
    listCreatorVideos: (creatorId, options) => call('listCreatorVideos', { creatorId, options }),
    listRecentVideos: (limit) => call('listRecentVideos', { limit }),
    collectCreatorFully: (input) => call('collectCreatorFully', input),
    getCollectProgress: (secUid) => call('getCollectProgress', { secUid }),
    resolveVideo: (input) => call('resolveVideo', input),
    downloadVideo: (videoId, options) => call('downloadVideo', { videoId, options }),
    getDownloadTask: (taskId) => call('getDownloadTask', { taskId }),
    cancelDownload: async (taskId) => {
      await call('cancelDownload', { taskId });
    },
    followCreator: async (input) => {
      await call('followCreator', input);
    },
    unfollowCreator: async (creatorId) => {
      await call('unfollowCreator', { creatorId });
    },
    listFollowedCreators: () => call('listFollowedCreators', undefined),
    runMonitorOnce: (creatorId) => call('runMonitorOnce', { creatorId }),
    processVideo: (videoId, options) => call('processVideo', { videoId, options }),
    getProcessingTask: (taskId) => call('getProcessingTask', { taskId }),
    cancelProcessingTask: async (taskId) => {
      await call('cancelProcessingTask', { taskId });
    },
    getTranscript: (videoId) => call('getTranscript', { videoId }),
    regenerateTranscript: (videoId) => call('regenerateTranscript', { videoId }),
    getAnalysis: (videoId) => call('getAnalysis', { videoId }),
    listAnalyses: () => call('listAnalyses', undefined),
    regenerateAnalysis: (videoId) => call('regenerateAnalysis', { videoId }),
    exportMarkdown: (input) => call('exportMarkdown', input),
    addToWorkflow: (input) => call('addToWorkflow', input),
    listWorkflowItems: () => call('listWorkflowItems', undefined),
    retryWorkflowItem: (id) => call('retryWorkflowItem', { id }),
    removeWorkflowItem: (id) => call('removeWorkflowItem', { id }),
    pushWorkflowItem: (id) => call('pushWorkflowItem', { id }),
    getAiSettings: () => call('getAiSettings', undefined),
    updateAiSettings: async (input) => {
      await call('updateAiSettings', input);
    },
    testAiProvider: (input) => call('testAiProvider', input),
    getBridgeSettings: () => call('getBridgeSettings', undefined),
    updateBridgeSettings: async (input) => {
      await call('updateBridgeSettings', input);
    },
    testBridge: () => call('testBridge', undefined),
    pushVideoToBridge: (videoId) => call('pushVideoToBridge', { videoId }),
    autoConnectBridge: () => call('autoConnectBridge', undefined),
  };
}

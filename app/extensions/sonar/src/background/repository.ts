/**
 * Repository（设计文档 5.5）：标准化领域数据的持久化抽象。
 *
 * 这里提供进程内的内存实现，用于测试与首版运行；IndexedDB 实现作为后续阶段替换，
 * 接口保持不变。不保存 Cookie / Token / 完整认证信息；带签名视频地址只作短期缓存。
 */
import type {
  Creator,
  CreatorSubscription,
  DownloadTask,
  ProcessingTask,
  TranscriptDocument,
  Video,
  VideoAnalysis,
  VideoSource,
  ViralInsight,
  WorkflowItem,
  WorkflowStage,
} from '@/domain/models';
import type {
  AddWorkflowItemInput,
  FollowCreatorInput,
  ListVideoOptions,
  VideoPage,
} from '@/domain/api-types';
import { SonarException, makeError } from '@/domain/errors';

export interface CachedSources {
  sources: VideoSource[];
  cachedAt: number;
}

export interface Repository {
  upsertCreator(creator: Creator): Promise<void>;
  getCreator(id: string): Promise<Creator | null>;
  /** 按 secUid 反查博主（页面 URL 给的是 secUid，不是内部 uid）。 */
  getCreatorBySecUid(secUid: string): Promise<Creator | null>;
  followCreator(input: FollowCreatorInput): Promise<void>;
  unfollowCreator(creatorId: string): Promise<void>;
  listSubscriptions(): Promise<CreatorSubscription[]>;
  getSubscription(creatorId: string): Promise<CreatorSubscription | null>;
  /** 更新订阅的监控状态（lastCheckedAt / latestVideoId / paused 等）。不存在则忽略。 */
  updateSubscription(creatorId: string, patch: Partial<CreatorSubscription>): Promise<void>;

  upsertVideos(videos: Video[]): Promise<void>;
  getVideo(id: string): Promise<Video | null>;
  listCreatorVideos(creatorId: string, options?: ListVideoOptions): Promise<VideoPage>;
  /** 全部已采集视频，按发布时间倒序，用于视频库 / 动态流。 */
  listRecentVideos(limit?: number): Promise<Video[]>;

  /** 短期缓存已排序视频源（带签名地址会过期）。 */
  cacheSources(videoId: string, sources: VideoSource[]): Promise<void>;
  getCachedSources(videoId: string): Promise<VideoSource[] | null>;
  /** 缓存原始 video 对象，供 resolveVideo 在需要时重新提取源。 */
  cacheRawVideo(videoId: string, rawVideo: unknown): Promise<void>;
  getRawVideo(videoId: string): Promise<unknown | null>;

  getTranscript(videoId: string): Promise<TranscriptDocument | null>;
  putTranscript(doc: TranscriptDocument): Promise<void>;
  getAnalysis(videoId: string): Promise<VideoAnalysis | null>;
  /** 全部分析，单次取回供视频库批量水合（避免逐条 IPC 往返）。 */
  listAnalyses(): Promise<VideoAnalysis[]>;
  putAnalysis(analysis: VideoAnalysis): Promise<void>;

  /** 爆款拆解报告（按 videoId 索引，与 analyses 同构），工作流卡片水合 + 桥 payload 复用。 */
  getInsight(videoId: string): Promise<ViralInsight | null>;
  putInsight(insight: ViralInsight): Promise<void>;

  addWorkflowItem(input: AddWorkflowItemInput): Promise<WorkflowItem>;
  /** 列出工作流条目，水合各自的 insight（若已生成）。 */
  listWorkflowItems(): Promise<WorkflowItem[]>;
  getWorkflowItem(id: string): Promise<WorkflowItem | null>;
  /** 推进/置失败某条流水线阶段；不存在则抛 PARSE_ERROR。 */
  setWorkflowStage(id: string, stage: WorkflowStage, patch?: { error?: string }): Promise<WorkflowItem>;
  removeWorkflowItem(id: string): Promise<boolean>;

  putDownloadTask(task: DownloadTask): Promise<void>;
  getDownloadTask(id: string): Promise<DownloadTask | null>;
  /** 按 chrome 下载 id 反查任务，用于 onChanged 进度回写与 SW 重启后恢复映射。 */
  findDownloadTaskByChromeId(chromeDownloadId: number): Promise<DownloadTask | null>;
  listDownloadTasks(): Promise<DownloadTask[]>;
  putProcessingTask(task: ProcessingTask): Promise<void>;
  getProcessingTask(id: string): Promise<ProcessingTask | null>;
}

export interface MemoryRepositoryDeps {
  now: () => number;
  newId: () => string;
}

export function createMemoryRepository(deps: MemoryRepositoryDeps): Repository {
  const creators = new Map<string, Creator>();
  const subscriptions = new Map<string, CreatorSubscription>();
  const videos = new Map<string, Video>();
  const sourceCache = new Map<string, CachedSources>();
  const rawVideoCache = new Map<string, unknown>();
  const transcripts = new Map<string, TranscriptDocument>();
  const analyses = new Map<string, VideoAnalysis>();
  const insights = new Map<string, ViralInsight>();
  const workflow = new Map<string, WorkflowItem>();
  const downloads = new Map<string, DownloadTask>();
  const processings = new Map<string, ProcessingTask>();

  return {
    async upsertCreator(creator) {
      creators.set(creator.id, creator);
    },
    async getCreator(id) {
      return creators.get(id) ?? null;
    },
    async getCreatorBySecUid(secUid) {
      for (const c of creators.values()) {
        if (c.secUid === secUid) return c;
      }
      return null;
    },
    async followCreator(input) {
      creators.set(input.creator.id, input.creator);
      subscriptions.set(input.creator.id, {
        creator: input.creator,
        intervalMinutes: input.intervalMinutes ?? 30,
        paused: false,
        autoAnalyze: input.autoAnalyze ?? false,
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.group !== undefined ? { group: input.group } : {}),
      });
    },
    async unfollowCreator(creatorId) {
      subscriptions.delete(creatorId);
    },
    async listSubscriptions() {
      return [...subscriptions.values()];
    },
    async getSubscription(creatorId) {
      return subscriptions.get(creatorId) ?? null;
    },
    async updateSubscription(creatorId, patch) {
      const existing = subscriptions.get(creatorId);
      if (existing) subscriptions.set(creatorId, { ...existing, ...patch });
    },

    async upsertVideos(list) {
      for (const v of list) videos.set(v.id, v);
    },
    async getVideo(id) {
      return videos.get(id) ?? null;
    },
    async listRecentVideos(limit) {
      const all = [...videos.values()].sort((a, b) => b.publishedAt - a.publishedAt);
      return typeof limit === 'number' ? all.slice(0, limit) : all;
    },
    async listCreatorVideos(creatorId, options) {
      const count = options?.count ?? 20;
      const all = [...videos.values()]
        .filter((v) => v.creatorId === creatorId)
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .filter((v) => options?.cursor === undefined || v.publishedAt < options.cursor);
      const page = all.slice(0, count);
      return {
        videos: page,
        hasMore: all.length > count,
        ...(page.length > 0 ? { cursor: page[page.length - 1].publishedAt } : {}),
      };
    },

    async cacheSources(videoId, sources) {
      sourceCache.set(videoId, { sources, cachedAt: deps.now() });
    },
    async getCachedSources(videoId) {
      return sourceCache.get(videoId)?.sources ?? null;
    },
    async cacheRawVideo(videoId, rawVideo) {
      rawVideoCache.set(videoId, rawVideo);
    },
    async getRawVideo(videoId) {
      return rawVideoCache.has(videoId) ? rawVideoCache.get(videoId) : null;
    },

    async getTranscript(videoId) {
      return transcripts.get(videoId) ?? null;
    },
    async putTranscript(doc) {
      transcripts.set(doc.videoId, doc);
    },
    async getAnalysis(videoId) {
      return analyses.get(videoId) ?? null;
    },
    async listAnalyses() {
      return Array.from(analyses.values());
    },
    async putAnalysis(analysis) {
      analyses.set(analysis.videoId, analysis);
    },

    async getInsight(videoId) {
      return insights.get(videoId) ?? null;
    },
    async putInsight(insight) {
      insights.set(insight.videoId, insight);
    },

    async addWorkflowItem(input) {
      const ts = deps.now();
      const item: WorkflowItem = {
        id: deps.newId(),
        videoId: input.videoId,
        stage: 'collected',
        note: input.note ?? '',
        createdAt: ts,
        updatedAt: ts,
      };
      workflow.set(item.id, item);
      return item;
    },
    async listWorkflowItems() {
      return [...workflow.values()].map((item) => {
        const insight = insights.get(item.videoId);
        return insight ? { ...item, insight } : item;
      });
    },
    async getWorkflowItem(id) {
      const item = workflow.get(id);
      if (!item) return null;
      const insight = insights.get(item.videoId);
      return insight ? { ...item, insight } : item;
    },
    async setWorkflowStage(id, stage, patch) {
      const existing = workflow.get(id);
      if (!existing) {
        throw new SonarException(makeError('PARSE_ERROR', `工作流条目不存在：${id}`));
      }
      const updated: WorkflowItem = {
        ...existing,
        stage,
        // 失败才带 error；推进到其它阶段清掉旧 error。
        ...(stage === 'failed' ? { error: patch?.error } : { error: undefined }),
        updatedAt: deps.now(),
      };
      workflow.set(id, updated);
      return updated;
    },
    async removeWorkflowItem(id) {
      return workflow.delete(id);
    },

    async putDownloadTask(task) {
      downloads.set(task.id, task);
    },
    async getDownloadTask(id) {
      return downloads.get(id) ?? null;
    },
    async findDownloadTaskByChromeId(chromeDownloadId) {
      for (const task of downloads.values()) {
        if (task.chromeDownloadId === chromeDownloadId) return task;
      }
      return null;
    },
    async listDownloadTasks() {
      return [...downloads.values()];
    },
    async putProcessingTask(task) {
      processings.set(task.id, task);
    },
    async getProcessingTask(id) {
      return processings.get(id) ?? null;
    },
  };
}

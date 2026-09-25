/**
 * IndexedDB 持久化 Repository（设计文档 5.5）。
 *
 * 与内存实现同一接口、同一契约测试。Service Worker 被回收后数据仍在。
 * 不保存 Cookie / Token；带签名视频地址（sources/rawVideos）只作短期缓存。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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
import type { MemoryRepositoryDeps, Repository } from './repository';

interface SonarDB extends DBSchema {
  creators: { key: string; value: Creator; indexes: { secUid: string } };
  subscriptions: { key: string; value: CreatorSubscription };
  videos: { key: string; value: Video; indexes: { creatorId: string } };
  sources: { key: string; value: { videoId: string; sources: VideoSource[]; cachedAt: number } };
  rawVideos: { key: string; value: { videoId: string; raw: unknown } };
  transcripts: { key: string; value: TranscriptDocument };
  analyses: { key: string; value: VideoAnalysis };
  insights: { key: string; value: ViralInsight };
  workflow: { key: string; value: WorkflowItem };
  downloads: { key: string; value: DownloadTask; indexes: { chromeDownloadId: number } };
  processings: { key: string; value: ProcessingTask };
}

/** 旧记录（手动看板 status，无 stage）读时降级为流水线阶段。 */
function normalizeWorkflowItem(raw: WorkflowItem): WorkflowItem {
  if (raw.stage) return raw;
  const legacyStatus = (raw as unknown as { status?: string }).status;
  return { ...raw, stage: legacyStatus === 'done' ? 'pushed' : 'collected' };
}

export interface IdbRepositoryDeps extends MemoryRepositoryDeps {
  dbName?: string;
}

export function createIdbRepository(deps: IdbRepositoryDeps): Repository {
  const dbName = deps.dbName ?? 'sonar';
  let dbPromise: Promise<IDBPDatabase<SonarDB>> | null = null;

  function db(): Promise<IDBPDatabase<SonarDB>> {
    if (!dbPromise) {
      dbPromise = openDB<SonarDB>(dbName, 2, {
        upgrade(database, oldVersion) {
          if (oldVersion < 1) {
            database.createObjectStore('creators', { keyPath: 'id' }).createIndex('secUid', 'secUid');
            database.createObjectStore('subscriptions');
            database.createObjectStore('videos', { keyPath: 'id' }).createIndex('creatorId', 'creatorId');
            database.createObjectStore('sources', { keyPath: 'videoId' });
            database.createObjectStore('rawVideos', { keyPath: 'videoId' });
            database.createObjectStore('transcripts', { keyPath: 'videoId' });
            database.createObjectStore('analyses', { keyPath: 'videoId' });
            database.createObjectStore('workflow', { keyPath: 'id' });
            const downloads = database.createObjectStore('downloads', { keyPath: 'id' });
            downloads.createIndex('chromeDownloadId', 'chromeDownloadId');
            database.createObjectStore('processings', { keyPath: 'id' });
          }
          // v2：爆款拆解报告存储（工作流流水线）。
          if (oldVersion < 2) {
            database.createObjectStore('insights', { keyPath: 'videoId' });
          }
        },
      });
    }
    return dbPromise;
  }

  return {
    async upsertCreator(creator) {
      await (await db()).put('creators', creator);
    },
    async getCreator(id) {
      return (await (await db()).get('creators', id)) ?? null;
    },
    async getCreatorBySecUid(secUid) {
      return (await (await db()).getFromIndex('creators', 'secUid', secUid)) ?? null;
    },
    async followCreator(input: FollowCreatorInput) {
      const database = await db();
      await database.put('creators', input.creator);
      const sub: CreatorSubscription = {
        creator: input.creator,
        intervalMinutes: input.intervalMinutes ?? 30,
        paused: false,
        autoAnalyze: input.autoAnalyze ?? false,
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.group !== undefined ? { group: input.group } : {}),
      };
      await database.put('subscriptions', sub, input.creator.id);
    },
    async unfollowCreator(creatorId) {
      await (await db()).delete('subscriptions', creatorId);
    },
    async listSubscriptions() {
      return (await db()).getAll('subscriptions');
    },
    async getSubscription(creatorId) {
      return (await (await db()).get('subscriptions', creatorId)) ?? null;
    },
    async updateSubscription(creatorId, patch) {
      const database = await db();
      const existing = await database.get('subscriptions', creatorId);
      if (existing) await database.put('subscriptions', { ...existing, ...patch }, creatorId);
    },

    async upsertVideos(list) {
      const database = await db();
      const tx = database.transaction('videos', 'readwrite');
      await Promise.all(list.map((v) => tx.store.put(v)));
      await tx.done;
    },
    async getVideo(id) {
      return (await (await db()).get('videos', id)) ?? null;
    },
    async listRecentVideos(limit) {
      const all = (await (await db()).getAll('videos')).sort((a, b) => b.publishedAt - a.publishedAt);
      return typeof limit === 'number' ? all.slice(0, limit) : all;
    },
    async listCreatorVideos(creatorId, options?: ListVideoOptions): Promise<VideoPage> {
      const all = (await (await db()).getAllFromIndex('videos', 'creatorId', creatorId))
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .filter((v) => options?.cursor === undefined || v.publishedAt < options.cursor);
      const count = options?.count ?? 20;
      const page = all.slice(0, count);
      return {
        videos: page,
        hasMore: all.length > count,
        ...(page.length > 0 ? { cursor: page[page.length - 1].publishedAt } : {}),
      };
    },

    async cacheSources(videoId, sources) {
      await (await db()).put('sources', { videoId, sources, cachedAt: deps.now() });
    },
    async getCachedSources(videoId) {
      return (await (await db()).get('sources', videoId))?.sources ?? null;
    },
    async cacheRawVideo(videoId, raw) {
      await (await db()).put('rawVideos', { videoId, raw });
    },
    async getRawVideo(videoId) {
      const row = await (await db()).get('rawVideos', videoId);
      return row ? row.raw : null;
    },

    async getTranscript(videoId) {
      return (await (await db()).get('transcripts', videoId)) ?? null;
    },
    async putTranscript(doc) {
      await (await db()).put('transcripts', doc);
    },
    async getAnalysis(videoId) {
      return (await (await db()).get('analyses', videoId)) ?? null;
    },
    async listAnalyses() {
      return (await db()).getAll('analyses');
    },
    async putAnalysis(analysis) {
      await (await db()).put('analyses', analysis);
    },

    async getInsight(videoId) {
      return (await (await db()).get('insights', videoId)) ?? null;
    },
    async putInsight(insight) {
      await (await db()).put('insights', insight);
    },

    async addWorkflowItem(input: AddWorkflowItemInput) {
      const ts = deps.now();
      const item: WorkflowItem = {
        id: deps.newId(),
        videoId: input.videoId,
        stage: 'collected',
        note: input.note ?? '',
        createdAt: ts,
        updatedAt: ts,
      };
      await (await db()).put('workflow', item);
      return item;
    },
    async listWorkflowItems() {
      const database = await db();
      const items = await database.getAll('workflow');
      return Promise.all(
        items.map(async (raw) => {
          const item = normalizeWorkflowItem(raw);
          const insight = await database.get('insights', item.videoId);
          return insight ? { ...item, insight } : item;
        }),
      );
    },
    async getWorkflowItem(id) {
      const database = await db();
      const raw = await database.get('workflow', id);
      if (!raw) return null;
      const item = normalizeWorkflowItem(raw);
      const insight = await database.get('insights', item.videoId);
      return insight ? { ...item, insight } : item;
    },
    async setWorkflowStage(id, stage: WorkflowStage, patch) {
      const database = await db();
      const existing = await database.get('workflow', id);
      if (!existing) {
        throw new SonarException(makeError('PARSE_ERROR', `工作流条目不存在：${id}`));
      }
      const updated: WorkflowItem = {
        ...normalizeWorkflowItem(existing),
        stage,
        ...(stage === 'failed' ? { error: patch?.error } : { error: undefined }),
        updatedAt: deps.now(),
      };
      // 拆解不落工作流记录（按 videoId 单独存储），落库前剔除水合字段。
      delete (updated as { insight?: unknown }).insight;
      await database.put('workflow', updated);
      return updated;
    },
    async removeWorkflowItem(id) {
      const database = await db();
      const existing = await database.get('workflow', id);
      if (!existing) return false;
      await database.delete('workflow', id);
      return true;
    },

    async putDownloadTask(task) {
      await (await db()).put('downloads', task);
    },
    async getDownloadTask(id) {
      return (await (await db()).get('downloads', id)) ?? null;
    },
    async findDownloadTaskByChromeId(chromeDownloadId) {
      return (await (await db()).getFromIndex('downloads', 'chromeDownloadId', chromeDownloadId)) ?? null;
    },
    async listDownloadTasks() {
      return (await db()).getAll('downloads');
    },
    async putProcessingTask(task) {
      await (await db()).put('processings', task);
    },
    async getProcessingTask(id) {
      return (await (await db()).get('processings', id)) ?? null;
    },
  };
}

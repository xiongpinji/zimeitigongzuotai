/**
 * 把 Content Script 捕获到的抖音响应载入 Repository。
 *
 * 复用适配器把原始响应转成稳定模型；同时缓存原始 video 对象，供 resolveVideo 重新提取源。
 * 这里不做下载或 AI 判断，只负责入库。
 */
import { adaptAwemeDetail, adaptAwemePostList } from '@/adapter/video-adapter';
import { adaptCreator } from '@/adapter/creator-adapter';
import { pick } from '@/adapter/field';
import type { ResponseCategory } from '@/content/page-capture';
import type { Creator, Video } from '@/domain/models';
import type { Repository } from './repository';

export interface IngestResult {
  videoIds: string[];
  creatorId?: string;
}

function isCreatorShape(value: unknown): value is Creator {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.secUid === 'string' && typeof c.nickname === 'string';
}

function isVideoShape(value: unknown): value is Video {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.creatorId === 'string';
}

/**
 * 同一 secUid 复用已有 Creator 的 id，避免 DOM 与 API 两条捕获路径各用一套主键
 * （DOM 只有 secUid；API 用内部 uid）而产生重复 Creator。优先沿用订阅里的 id，使作品
 * 始终挂在用户实际关注的那条上。返回已存在的 Creator（供合并字段）与规整后的 id。
 */
async function canonicalCreatorIdentity(
  repo: Repository,
  creator: Creator,
): Promise<{ existing: Creator | undefined; creatorId: string }> {
  const subscribed = (await repo.listSubscriptions()).find((sub) => sub.creator.secUid === creator.secUid)?.creator;
  const existing = subscribed ?? (await repo.getCreatorBySecUid(creator.secUid)) ?? undefined;
  return { existing, creatorId: existing?.id ?? creator.id };
}

/** upsert Creator 并把其作品统一重挂到规整后的 creatorId（幂等，跨捕获路径收敛到单一记录）。 */
async function upsertCanonicalCreator(
  repo: Repository,
  creator: Creator,
  videos: Video[],
): Promise<{ videoIds: string[]; creatorId: string }> {
  const { existing, creatorId } = await canonicalCreatorIdentity(repo, creator);
  await repo.upsertCreator({ ...existing, ...creator, id: creatorId });
  const canonicalVideos = videos.map((video) => ({ ...video, creatorId }));
  if (canonicalVideos.length > 0) await repo.upsertVideos(canonicalVideos);
  return { videoIds: canonicalVideos.map((v) => v.id), creatorId };
}

/**
 * 载入「主动提取」的博主主页结果（DOM/SSR fallback，详见 content/dom-extractor.ts）。
 * 入参已是规整后的稳定模型；这里只做最小结构校验并入库（与 ingestCapture 行为对齐：
 * upsert 博主与作品，幂等）。DOM 提取拿不到 raw video 对象，故不写 cacheRawVideo——
 * 源提取仍走作品详情页的既有捕获路径。
 */
export async function ingestDomCreatorPage(
  repo: Repository,
  creator: unknown,
  videos: unknown,
): Promise<IngestResult> {
  if (!isCreatorShape(creator)) return { videoIds: [] };
  const list = Array.isArray(videos) ? videos.filter(isVideoShape) : [];
  return upsertCanonicalCreator(repo, creator, list);
}

export async function ingestCapture(
  repo: Repository,
  category: ResponseCategory,
  payload: unknown,
  now: () => number,
): Promise<IngestResult> {
  if (category === 'video_detail') {
    const adapted = adaptAwemeDetail(payload, now());
    if (!adapted) return { videoIds: [] };
    const { creatorId } = await upsertCanonicalCreator(repo, adapted.creator, [adapted.video]);
    const rawVideo = pick(pick(payload, ['aweme_detail', 'awemeDetail']), ['video']);
    if (rawVideo) await repo.cacheRawVideo(adapted.video.id, rawVideo);
    return { videoIds: [adapted.video.id], creatorId };
  }

  if (category === 'creator_videos') {
    const { videos, creator } = adaptAwemePostList(payload, now());
    const result = creator
      ? await upsertCanonicalCreator(repo, creator, videos)
      : (await repo.upsertVideos(videos), { videoIds: videos.map((v) => v.id), creatorId: undefined });
    const list = pick(payload, ['aweme_list', 'awemeList']);
    if (Array.isArray(list)) {
      for (const item of list) {
        const id = pick(item, ['aweme_id', 'awemeId']);
        const rawVideo = pick(item, ['video']);
        if (typeof id === 'string' && rawVideo) await repo.cacheRawVideo(id, rawVideo);
      }
    }
    return {
      videoIds: result.videoIds,
      ...(result.creatorId ? { creatorId: result.creatorId } : {}),
    };
  }

  if (category === 'creator_profile') {
    const creator = adaptCreator(pick(payload, ['user']), now());
    if (!creator) return { videoIds: [] };
    const { creatorId } = await upsertCanonicalCreator(repo, creator, []);
    return { videoIds: [], creatorId };
  }

  return { videoIds: [] };
}

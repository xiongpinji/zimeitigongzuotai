/**
 * 抖音作品对象 / 作品详情 / 作品列表 → 稳定 Video（+ Creator）模型。
 *
 * 适配器按响应类别拆分；这里只负责字段标准化，不提取视频源（见 source-extractor），
 * 也不做无水印判断或排序（见 resolver）。
 */
import type { Creator, Video, VideoStatistics } from '@/domain/models';
import { asNumber, asString, firstUrl, isRecord, pick } from './field';
import { adaptCreator } from './creator-adapter';

function adaptStatistics(raw: unknown): VideoStatistics | undefined {
  if (!isRecord(raw)) return undefined;
  const stats: VideoStatistics = {};
  const map: Array<[keyof VideoStatistics, string[]]> = [
    ['likeCount', ['digg_count', 'diggCount']],
    ['commentCount', ['comment_count', 'commentCount']],
    ['collectCount', ['collect_count', 'collectCount']],
    ['shareCount', ['share_count', 'shareCount']],
    ['playCount', ['play_count', 'playCount']],
  ];
  let any = false;
  for (const [key, keys] of map) {
    const value = asNumber(pick(raw, keys));
    if (value !== undefined) {
      stats[key] = value;
      any = true;
    }
  }
  return any ? stats : undefined;
}

/**
 * 把单个作品对象（aweme_detail 或 aweme_list 项）标准化为 Video + Creator。
 */
export function adaptAweme(aweme: unknown, now: number = Date.now()): { video: Video; creator: Creator } | null {
  if (!isRecord(aweme)) return null;
  const id = asString(pick(aweme, ['aweme_id', 'awemeId']));
  if (!id) return null;

  const creator = adaptCreator(pick(aweme, ['author']), now);
  if (!creator) return null;

  const video = pick(aweme, ['video']);
  const createTime = asNumber(pick(aweme, ['create_time', 'createTime']));
  const durationMs = asNumber(pick(video, ['duration']));
  // 图文/动态作品：内容在 images[]，页面路径是 /note/，封面回退到首图。
  const images = pick(aweme, ['images']);
  const isImagePost = Array.isArray(images) && images.length > 0;
  const coverUrl =
    firstUrl(pick(video, ['cover', 'origin_cover', 'originCover'])) ??
    (isImagePost ? firstUrl(images[0]) : undefined);
  const statistics = adaptStatistics(pick(aweme, ['statistics']));
  const description = asString(pick(aweme, ['desc', 'description'])) ?? '';

  const result: Video = {
    id,
    creatorId: creator.id,
    description,
    publishedAt: createTime !== undefined ? createTime * 1000 : 0,
    sourcePageUrl: isImagePost ? `https://www.douyin.com/note/${id}` : `https://www.douyin.com/video/${id}`,
    ...(coverUrl !== undefined ? { coverUrl } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(statistics !== undefined ? { statistics } : {}),
  };
  return { video: result, creator };
}

/** aweme detail 响应封套 → Video + Creator。无作品则返回 null。 */
export function adaptAwemeDetail(raw: unknown, now: number = Date.now()): { video: Video; creator: Creator } | null {
  const aweme = pick(raw, ['aweme_detail', 'awemeDetail']);
  if (!aweme) return null;
  return adaptAweme(aweme, now);
}

/** aweme post 列表响应封套 → Video[]（+ 推断的 Creator）。 */
export function adaptAwemePostList(
  raw: unknown,
  now: number = Date.now(),
): { videos: Video[]; creator?: Creator } {
  const list = pick(raw, ['aweme_list', 'awemeList']);
  if (!Array.isArray(list)) return { videos: [] };
  const videos: Video[] = [];
  let creator: Creator | undefined;
  for (const item of list) {
    const adapted = adaptAweme(item, now);
    if (!adapted) continue;
    videos.push(adapted.video);
    if (!creator) creator = adapted.creator;
  }
  return creator ? { videos, creator } : { videos };
}

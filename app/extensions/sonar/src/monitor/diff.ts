/**
 * 新作品差异计算（设计文档第 9 节第 5 步）。
 *
 * 抖音作品列表最新在前。与本地记录的 latestVideoId 比较，得出新增作品。
 * 首次同步只建立基线、不算新增，避免一次性刷出大量通知。纯逻辑，可单测。
 */
import type { Video } from '@/domain/models';

export interface VideoDiff {
  newVideos: Video[];
  latestId?: string;
}

export function diffNewVideos(knownLatestId: string | undefined, latest: Video[]): VideoDiff {
  if (latest.length === 0) return { newVideos: [] };
  const latestId = latest[0].id;

  if (knownLatestId === undefined) {
    // 首次同步：仅建立基线。
    return { newVideos: [], latestId };
  }

  const newVideos: Video[] = [];
  for (const video of latest) {
    if (video.id === knownLatestId) break;
    newVideos.push(video);
  }
  return { newVideos, latestId };
}

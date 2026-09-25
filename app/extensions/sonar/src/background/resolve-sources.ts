/**
 * 视频源解析编排：先用已捕获的原始响应，缺失时回退抖音分享页（无水印 playwm→play）。
 *
 * resolveVideo 与处理流水线（取流转录）共用，确保「未捕获/链接入库」的作品也能拿到无水印源。
 */
import type { Video, VideoSource } from '@/domain/models';
import { extractVideoSources, buildMuxedPlayApiSource } from '@/adapter/source-extractor';
import { rankSources } from '@/resolver/source-ranker';
import { resolveFromSharePage, type FetchText } from '@/resolver/share-resolver';
import type { Repository } from './repository';

/** 仅用已采集数据解析源（缓存优先，其次由缓存的原始 video 重新提取排序）。 */
export async function getRepoSources(repo: Repository, videoId: string): Promise<VideoSource[]> {
  const cached = await repo.getCachedSources(videoId);
  if (cached && cached.length > 0) return cached;
  const raw = await repo.getRawVideo(videoId);
  const ranked = raw ? rankSources(extractVideoSources(raw)) : [];
  if (ranked.length > 0) await repo.cacheSources(videoId, ranked);
  return ranked;
}

export interface EnsureSourcesDeps {
  repo: Repository;
  fetchPage: FetchText;
  now: () => number;
}

/**
 * 解析作品的视频源；若本地无源则抓分享页兜底，并把解析到的 Video/Creator/原始 video/源入库。
 * 返回的 video 可能来自仓库或分享页；都拿不到则 video 为 null。
 *
 * preferFresh：用于下载/取流路径。抖音 CDN 的 play_addr 带时间签名，过期后返回 403 text/html，
 * 而捕获入库只缓存了 raw video（会反复提取出同一个过期地址）。开启后优先抓分享页**现解析**新鲜
 * 地址（对齐参考脚本 run_single_file.py 的「现解析、立即下载」），分享页失败时再回退到缓存源。
 */
export async function ensureVideoSources(
  deps: EnsureSourcesDeps,
  input: { awemeId?: string; shareUrl?: string; preferFresh?: boolean },
): Promise<{ video: Video | null; sources: VideoSource[]; rawVideo: unknown }> {
  const { repo, fetchPage, now } = deps;
  let video = input.awemeId ? await repo.getVideo(input.awemeId) : null;
  let sources = input.awemeId ? await getRepoSources(repo, input.awemeId) : [];
  let rawVideo: unknown = input.awemeId ? await repo.getRawVideo(input.awemeId) : null;

  if (input.preferFresh || sources.length === 0) {
    const fromShare = await resolveFromSharePage({
      awemeId: input.awemeId,
      shareUrl: input.shareUrl,
      fetchText: fetchPage,
      now: now(),
    }).catch(() => null);

    if (fromShare && fromShare.sources.length > 0) {
      await repo.upsertCreator(fromShare.creator);
      await repo.upsertVideos([fromShare.video]);
      await repo.cacheRawVideo(fromShare.video.id, fromShare.rawVideo);
      await repo.cacheSources(fromShare.video.id, fromShare.sources);
      video = fromShare.video;
      sources = fromShare.sources;
      rawVideo = fromShare.rawVideo;
    } else if (fromShare) {
      // 分享页解析到作品但没有视频源（如图文/动态作品）：补全元数据，保留已有缓存源。
      await repo.upsertCreator(fromShare.creator);
      await repo.upsertVideos([fromShare.video]);
      video = video ?? fromShare.video;
      rawVideo = rawVideo ?? fromShare.rawVideo;
    }
  }

  return { video, sources, rawVideo };
}

/**
 * 把 snssdk play API 合流源置于候选首位（音视频分离作品里唯一稳定含音轨的源）。
 * 拿不到 video_id 时原样返回；与既有源 URL 去重。供提音管线优先尝试。
 */
export function prependMuxedAudioSource(sources: VideoSource[], rawVideo: unknown): VideoSource[] {
  const muxed = buildMuxedPlayApiSource(rawVideo);
  if (!muxed) return sources;
  return [muxed, ...sources.filter((s) => s.url !== muxed.url)];
}

/** 由一个 fetch 实现构造跟随跳转、返回文本与最终地址的 fetchPage。 */
export function createFetchPage(fetchImpl: typeof fetch): FetchText {
  return async (url: string) => {
    const res = await fetchImpl(url, { redirect: 'follow', credentials: 'omit' });
    const text = await res.text();
    return { text, finalUrl: res.url };
  };
}

/**
 * 抖音分享页（iesdouyin）无水印解析（参考 run_single_file.py 的 DouyinDownloader）。
 *
 * 当页面捕获未拿到作品的视频源时，作为兜底：GET
 * `https://www.iesdouyin.com/share/video/{awemeId}`，解析内嵌的 `window._ROUTER_DATA`，
 * 取 `video.play_addr.url_list[0]` 并把 `playwm`→`play` 得到无水印播放地址。
 *
 * 纯解析逻辑（parseRouterData / extractSharePayload / buildFromSharePayload）与网络隔离，
 * 便于用固定 HTML 夹具回归。网络部分由调用方注入 fetchText。
 */
import type { Creator, Video, VideoSource } from '@/domain/models';
import { isRecord, pick } from '@/adapter/field';
import { adaptAweme } from '@/adapter/video-adapter';
import { extractVideoSources, extractImageSources, normalizeMediaUrl } from '@/adapter/source-extractor';
import { rankSources } from './source-ranker';

/** 参考脚本使用的移动端 UA；SW fetch 无法直接设置 UA，需配合 DNR 改写。 */
export const SHARE_MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1';

export function shareVideoUrl(awemeId: string): string {
  return `https://www.iesdouyin.com/share/video/${awemeId}`;
}

const ROUTER_DATA_RE = /window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/;
const ID_RE = /\/(?:share\/)?(?:video|note|slides)\/(\d+)/;

/** 从分享链接 / 最终跳转地址里提取 awemeId。 */
export function extractAwemeId(url: string): string | null {
  if (!url) return null;
  const m = ID_RE.exec(url);
  if (m) return m[1];
  try {
    const modal = new URL(url).searchParams.get('modal_id');
    if (modal && /^\d+$/.test(modal)) return modal;
  } catch {
    /* 非法 URL */
  }
  return null;
}

/** 把 playwm 播放地址转成无水印 play 地址（抖音公认去水印手法）。 */
export function toNoWatermark(url: string): string {
  return url.replace(/playwm/g, 'play');
}

export function parseRouterData(html: string): unknown {
  const m = ROUTER_DATA_RE.exec(html);
  if (!m) return null;
  const raw = m[1].trim().replace(/;$/, '');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 在 _ROUTER_DATA.loaderData 中定位作品详情对象（item_list[0]）。 */
export function extractSharePayload(routerData: unknown): Record<string, unknown> | null {
  const loaderData = pick(routerData, ['loaderData']);
  if (!isRecord(loaderData)) return null;

  const fromKey = (key: string): Record<string, unknown> | null => {
    const page = pick(loaderData, [key]);
    const itemList = pick(pick(page, ['videoInfoRes']), ['item_list', 'itemList']);
    if (Array.isArray(itemList) && itemList.length > 0 && isRecord(itemList[0])) return itemList[0];
    return null;
  };

  for (const key of ['video_(id)/page', 'note_(id)/page', 'slides_(id)/page']) {
    const hit = fromKey(key);
    if (hit) return hit;
  }
  for (const value of Object.values(loaderData)) {
    const itemList = pick(pick(value, ['videoInfoRes']), ['item_list', 'itemList']);
    if (Array.isArray(itemList) && itemList.length > 0 && isRecord(itemList[0])) return itemList[0];
  }
  return null;
}

/**
 * 由分享页作品构建已排序的视频源；play_addr 经 playwm→play 标为高置信度无水印。
 * 传入作品级对象 `aweme` 时，补充图文/动态作品 images[] 的资产（静态图 + 实况短视频）。
 */
export function buildSharePageSources(video: unknown, aweme?: unknown): VideoSource[] {
  const raw = extractVideoSources(video).map((s) => ({ ...s, url: toNoWatermark(s.url) }));
  // 兜底：若提取器没拿到 play_addr，直接取 url_list[0]。
  if (raw.length === 0 && isRecord(video)) {
    const direct = pick(pick(video, ['play_addr', 'playAddr']), ['url_list', 'urlList']);
    if (Array.isArray(direct) && typeof direct[0] === 'string') {
      raw.push({ url: toNoWatermark(normalizeMediaUrl(direct[0])), sourceField: 'play_addr' });
    }
  }
  // 图文/动态作品：把 images[] 资产并入候选。
  if (aweme !== undefined) {
    for (const img of extractImageSources(aweme)) raw.push({ ...img, url: toNoWatermark(img.url) });
  }
  const ranked = rankSources(raw);
  return ranked.map((s) =>
    s.watermark === 'none'
      ? {
          ...s,
          watermarkConfidence: 'high',
          watermarkEvidence: [...s.watermarkEvidence, '经 iesdouyin 分享页 playwm→play 去水印'],
        }
      : s,
  );
}

export interface ShareResolveResult {
  video: Video;
  creator: Creator;
  rawVideo: unknown;
  sources: VideoSource[];
}

/** 由分享页作品详情对象构建 Video / Creator / 原始 video / 视频源。 */
export function buildFromSharePayload(
  payload: Record<string, unknown>,
  now: number,
): ShareResolveResult | null {
  const adapted = adaptAweme(payload, now);
  if (!adapted) return null;
  const rawVideo = pick(payload, ['video']);
  return {
    video: adapted.video,
    creator: adapted.creator,
    rawVideo,
    sources: buildSharePageSources(rawVideo, payload),
  };
}

export interface FetchTextResult {
  text: string;
  finalUrl: string;
}
export type FetchText = (url: string) => Promise<FetchTextResult>;

/**
 * 网络编排：必要时先跟随短链拿到 awemeId，再抓分享页解析。失败返回 null。
 */
export async function resolveFromSharePage(opts: {
  awemeId?: string;
  shareUrl?: string;
  fetchText: FetchText;
  now: number;
}): Promise<ShareResolveResult | null> {
  let awemeId = opts.awemeId ?? null;
  if (!awemeId && opts.shareUrl) {
    awemeId = extractAwemeId(opts.shareUrl);
    if (!awemeId) {
      // 短链：跟随跳转后从最终地址解析 id。
      const redirected = await opts.fetchText(opts.shareUrl).catch(() => null);
      if (redirected) awemeId = extractAwemeId(redirected.finalUrl) ?? extractAwemeId(opts.shareUrl);
    }
  }
  if (!awemeId) return null;

  const page = await opts.fetchText(shareVideoUrl(awemeId)).catch(() => null);
  if (!page) return null;
  const payload = extractSharePayload(parseRouterData(page.text));
  if (!payload) return null;
  return buildFromSharePayload(payload, opts.now);
}

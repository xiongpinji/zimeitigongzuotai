/**
 * 视频源去重、排序与无水印证据分级（设计文档 4.3 / 5.6 / 第 8 节）。
 *
 * 输入是适配器提取的 RawVideoSource 候选；输出是按「优先无水印、再按质量」排序的
 * VideoSource。水印判断带证据与置信度，UI 不得把低置信度候选展示为「已确认无水印」。
 *
 * 重要：这里只做基于字段语义与 URL 特征的判断；实际可下载性、MIME、大小由运行时
 * HTTP 探测验证（后续阶段）。HTTP 探测不能证明画面绝对无水印，故置信度分级保守。
 */
import type { VideoSource, WatermarkConfidence, WatermarkState } from '@/domain/models';
import type { RawVideoSource } from '@/adapter/types';

interface WatermarkJudgement {
  watermark: WatermarkState;
  confidence: WatermarkConfidence;
  evidence: string[];
}

function judgeWatermark(src: RawVideoSource): WatermarkJudgement {
  const url = src.url.toLowerCase();
  const evidence: string[] = [];

  if (src.sourceField === 'image') {
    evidence.push('图文/动态作品的静态图，无视频水印概念');
    return { watermark: 'unknown', confidence: 'low', evidence };
  }

  if (url.includes('playwm') || url.includes('watermark')) {
    evidence.push('URL 含水印标记（playwm/watermark）');
    return { watermark: 'present', confidence: 'high', evidence };
  }

  if (src.sourceField === 'download_addr') {
    evidence.push('来源为 download_addr，通常是带水印下载源');
    return { watermark: 'present', confidence: 'medium', evidence };
  }

  if (src.sourceField === 'bit_rate') {
    evidence.push('来源为 bit_rate 编码档位，通常为无水印播放流');
    if (url.includes('/play/')) evidence.push('URL 为 /play/ 播放路径');
    return { watermark: 'none', confidence: 'high', evidence };
  }

  // play_addr 主播放源：通常无可见水印，但缺少编码档位信息，置信度保守为 medium。
  evidence.push('来源为 play_addr 主播放源，通常无可见水印');
  return { watermark: 'none', confidence: 'medium', evidence };
}

function deriveCodec(src: RawVideoSource): string | undefined {
  if (src.sourceField !== 'bit_rate') return undefined;
  if (src.isBytevc1 === true) return 'bytevc1';
  if (src.isBytevc1 === false) return 'h264';
  return undefined;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|heic|gif)(?:$|[?#])/i;

function deriveMimeType(src: RawVideoSource): string | undefined {
  if (src.sourceField === 'image') {
    const ext = IMAGE_EXT_RE.exec(src.url)?.[1]?.toLowerCase();
    const norm = ext === 'jpg' ? 'jpeg' : ext;
    return `image/${norm ?? 'jpeg'}`;
  }
  if (src.format) return `video/${src.format.toLowerCase()}`;
  return undefined;
}

function toVideoSource(src: RawVideoSource): VideoSource {
  const judgement = judgeWatermark(src);
  const codec = deriveCodec(src);
  const mimeType = deriveMimeType(src);
  return {
    url: src.url,
    watermark: judgement.watermark,
    watermarkConfidence: judgement.confidence,
    watermarkEvidence: judgement.evidence,
    ...(src.width !== undefined ? { width: src.width } : {}),
    ...(src.height !== undefined ? { height: src.height } : {}),
    ...(src.bitrate !== undefined ? { bitrate: src.bitrate } : {}),
    ...(codec !== undefined ? { codec } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(src.fromImageSet ? { fromImageSet: true } : {}),
  };
}

// 无水印优先级分层（越小越靠前）。
function watermarkTier(s: VideoSource): number {
  if (s.watermark === 'none') return s.watermarkConfidence === 'high' ? 0 : 1;
  if (s.watermark === 'unknown') return 2;
  return 3; // present
}

function area(s: VideoSource): number {
  return (s.width ?? 0) * (s.height ?? 0);
}

function isHevc(s: VideoSource): boolean {
  return s.codec === 'bytevc1' || s.codec === 'hevc' || s.codec === 'h265';
}

/** 去重并按「优先无水印、再按质量、再按下载兼容性」排序。 */
export function rankSources(raw: RawVideoSource[]): VideoSource[] {
  const seen = new Set<string>();
  const sources: VideoSource[] = [];
  for (const r of raw) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    sources.push(toVideoSource(r));
  }

  return sources.sort((a, b) => {
    const tierDiff = watermarkTier(a) - watermarkTier(b);
    if (tierDiff !== 0) return tierDiff;
    const areaDiff = area(b) - area(a);
    if (areaDiff !== 0) return areaDiff;
    // 同分辨率优先 H.264（下载兼容性优于 H.265/bytevc1）。
    const hevcDiff = Number(isHevc(a)) - Number(isHevc(b));
    if (hevcDiff !== 0) return hevcDiff;
    return (b.bitrate ?? 0) - (a.bitrate ?? 0);
  });
}

/**
 * 分辨率指纹（用于把同一清晰度的多个编码档位折叠成一个候选）。
 * 用精确 宽×高，竖屏不会被 height 阈值误判（720×1280 与 1080×1920 应分开）。
 */
function resolutionKey(s: VideoSource): string {
  if (s.width === undefined && s.height === undefined) return 'unknown';
  return `${s.width ?? '?'}x${s.height ?? '?'}`;
}

/**
 * 把已排序候选折叠成"少而精"的可选项：每个（是否带水印 × 清晰度档位）只保留最优的一个。
 *
 * `extractVideoSources` 会把 play_addr / download_addr / 每个 bit_rate 编码档位都收集成候选，
 * 同一清晰度往往出现 3~4 个（h264 / bytevc1 / 主播放源…），直接全摊给用户就是"格式太多了"。
 * 这里依赖输入已按"无水印优先、再按质量"排好序，取每组第一个即为该组最优（对齐参考脚本只下载单一最优源）。
 */
export function pickDownloadCandidates(ranked: VideoSource[]): VideoSource[] {
  const seen = new Set<string>();
  const out: VideoSource[] = [];
  for (const s of ranked) {
    // 图文/动态作品的每张图（或实况短视频）都是独立资产，按 url 唯一保留，绝不按清晰度折叠。
    const key = s.fromImageSet
      ? `img:${s.url}`
      : `${s.watermark === 'present' ? 'wm' : 'clean'}:${resolutionKey(s)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export type SelectSourceResult =
  | { ok: true; source: VideoSource }
  | { ok: false; code: 'NO_WATERMARK_SOURCE' | 'NO_DOWNLOADABLE_SOURCE' };

/**
 * 在已排序候选中选择要下载的源。
 * 默认只选无水印（none/unknown）候选；全部带水印时返回 NO_WATERMARK_SOURCE，
 * 仅当用户明确允许 allowWatermarkFallback 才回退到带水印候选。
 */
export function selectPreferredSource(
  ranked: VideoSource[],
  options: { allowWatermarkFallback: boolean },
): SelectSourceResult {
  if (ranked.length === 0) return { ok: false, code: 'NO_DOWNLOADABLE_SOURCE' };
  const nonWatermarked = ranked.find((s) => s.watermark !== 'present');
  if (nonWatermarked) return { ok: true, source: nonWatermarked };
  if (options.allowWatermarkFallback) return { ok: true, source: ranked[0] };
  return { ok: false, code: 'NO_WATERMARK_SOURCE' };
}

/**
 * 在「现解析」得到的新鲜候选中，找回与用户已选项对应的源（用于在线播放 / 复制地址）。
 *
 * UI 展示的候选来自缓存的非新鲜解析，其签名地址可能已过期；播放与复制必须改用 preferFresh
 * 重新解析的新鲜地址。两次解析的 url 通常不同（签名变化），故这里先按 url 精确命中，再退化到
 * 「同清晰度 × 同水印态」匹配，最后退回最优无水印源（无则首个）。图文/动态作品可能只有图片源，
 * 由调用方决定是否可播放。
 */
export function matchFreshSource(fresh: VideoSource[], prefer?: VideoSource): VideoSource | undefined {
  if (fresh.length === 0) return undefined;
  if (prefer) {
    const exact = fresh.find((s) => s.url === prefer.url);
    if (exact) return exact;
    const sameKey = fresh.find(
      (s) =>
        resolutionKey(s) === resolutionKey(prefer) &&
        (s.watermark === 'present') === (prefer.watermark === 'present'),
    );
    if (sameKey) return sameKey;
  }
  return fresh.find((s) => s.watermark !== 'present') ?? fresh[0];
}

import { describe, it, expect } from 'vitest';
import { rankSources, selectPreferredSource, pickDownloadCandidates, matchFreshSource } from '@/resolver/source-ranker';
import type { RawVideoSource } from '@/adapter/types';
import type { VideoSource } from '@/domain/models';

const raw: RawVideoSource[] = [
  {
    url: 'https://v3-web.douyinvod.com/fake/play_main.mp4?sign=X',
    sourceField: 'play_addr',
    width: 1080,
    height: 1920,
  },
  {
    url: 'https://v3-web.douyinvod.com/fake/playwm_main.mp4?watermark=1&sign=X',
    sourceField: 'download_addr',
    width: 1080,
    height: 1920,
  },
  {
    url: 'https://v3-web.douyinvod.com/fake/h264_1080.mp4?sign=X',
    sourceField: 'bit_rate',
    width: 1080,
    height: 1920,
    bitrate: 2500000,
    format: 'mp4',
    isBytevc1: false,
  },
  {
    url: 'https://v3-web.douyinvod.com/fake/bytevc1_1080.mp4?sign=X',
    sourceField: 'bit_rate',
    width: 1080,
    height: 1920,
    bitrate: 1800000,
    format: 'mp4',
    isBytevc1: true,
  },
];

describe('rankSources — watermark judgement', () => {
  const ranked = rankSources(raw);

  it('flags a playwm/watermark url as present with high confidence', () => {
    const wm = ranked.find((s) => s.url.includes('playwm'))!;
    expect(wm.watermark).toBe('present');
    expect(wm.watermarkConfidence).toBe('high');
    expect(wm.watermarkEvidence.length).toBeGreaterThan(0);
  });

  it('judges a bit_rate gear as no-watermark with high confidence', () => {
    const gear = ranked.find((s) => s.url.includes('h264_1080'))!;
    expect(gear.watermark).toBe('none');
    expect(gear.watermarkConfidence).toBe('high');
  });

  it('judges the main play_addr as no-watermark but only medium confidence', () => {
    const main = ranked.find((s) => s.url.includes('play_main'))!;
    expect(main.watermark).toBe('none');
    expect(main.watermarkConfidence).toBe('medium');
  });

  it('derives codec and mimeType for bit_rate gears', () => {
    const h264 = ranked.find((s) => s.url.includes('h264_1080'))!;
    expect(h264.codec).toBe('h264');
    expect(h264.mimeType).toBe('video/mp4');
    const hevc = ranked.find((s) => s.url.includes('bytevc1'))!;
    expect(hevc.codec).toBe('bytevc1');
  });
});

describe('rankSources — ordering', () => {
  it('orders high-confidence no-watermark first, watermarked last', () => {
    const order = rankSources(raw).map((s) => {
      if (s.url.includes('h264_1080')) return 'h264';
      if (s.url.includes('bytevc1')) return 'bytevc1';
      if (s.url.includes('play_main')) return 'play';
      return 'wm';
    });
    expect(order).toEqual(['h264', 'bytevc1', 'play', 'wm']);
  });

  it('prefers h264 over bytevc1 at equal resolution for download compatibility', () => {
    const ranked = rankSources(raw);
    const h264Idx = ranked.findIndex((s) => s.url.includes('h264_1080'));
    const hevcIdx = ranked.findIndex((s) => s.url.includes('bytevc1'));
    expect(h264Idx).toBeLessThan(hevcIdx);
  });

  it('dedupes identical urls', () => {
    const dup = [raw[0], raw[0]];
    expect(rankSources(dup)).toHaveLength(1);
  });

  it('returns an empty array for no input', () => {
    expect(rankSources([])).toEqual([]);
  });
});

describe('selectPreferredSource', () => {
  it('selects the best no-watermark candidate by default', () => {
    const result = selectPreferredSource(rankSources(raw), { allowWatermarkFallback: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source.url).toContain('h264_1080');
  });

  it('returns NO_WATERMARK_SOURCE when only watermarked sources exist and fallback is off', () => {
    const onlyWm = rankSources([raw[1]]);
    const result = selectPreferredSource(onlyWm, { allowWatermarkFallback: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NO_WATERMARK_SOURCE');
  });

  it('falls back to a watermarked source only when explicitly allowed', () => {
    const onlyWm = rankSources([raw[1]]);
    const result = selectPreferredSource(onlyWm, { allowWatermarkFallback: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source.watermark).toBe('present');
  });

  it('returns NO_DOWNLOADABLE_SOURCE for an empty candidate list', () => {
    const result = selectPreferredSource([], { allowWatermarkFallback: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NO_DOWNLOADABLE_SOURCE');
  });
});

describe('pickDownloadCandidates — 折叠重复清晰度', () => {
  it('把同一清晰度的多个编码档位折叠成一个最优候选（无水印 + 带水印各一）', () => {
    const candidates = pickDownloadCandidates(rankSources(raw));
    // 四个 1080 候选（h264 / bytevc1 / play_main / 带水印）折叠为：最优无水印 + 带水印
    expect(candidates).toHaveLength(2);
    expect(candidates[0].watermark).toBe('none');
    expect(candidates[0].url).toContain('h264_1080');
    expect(candidates[1].watermark).toBe('present');
  });

  it('保留不同清晰度档位', () => {
    const multi = pickDownloadCandidates(
      rankSources([
        { url: 'https://x/a_1080.mp4', sourceField: 'bit_rate', width: 1080, height: 1920, format: 'mp4', isBytevc1: false },
        { url: 'https://x/b_720.mp4', sourceField: 'bit_rate', width: 720, height: 1280, format: 'mp4', isBytevc1: false },
      ]),
    );
    expect(multi).toHaveLength(2);
  });
});

describe('matchFreshSource — 现解析后回找已选源', () => {
  const src = (over: Partial<VideoSource> & { url: string }): VideoSource => ({
    watermark: 'none',
    watermarkConfidence: 'high',
    watermarkEvidence: [],
    ...over,
  });
  const fresh: VideoSource[] = [
    src({ url: 'https://cdn/clean_1080?sign=NEW', width: 1080, height: 1920 }),
    src({ url: 'https://cdn/clean_720?sign=NEW', width: 720, height: 1280 }),
    src({ url: 'https://cdn/wm_1080?sign=NEW', width: 1080, height: 1920, watermark: 'present' }),
  ];

  it('按 url 精确命中', () => {
    const hit = matchFreshSource(fresh, fresh[1]);
    expect(hit?.url).toBe('https://cdn/clean_720?sign=NEW');
  });

  it('url 变化时按「同清晰度 × 同水印态」回找新鲜地址', () => {
    const stale = src({ url: 'https://cdn/clean_720?sign=OLD', width: 720, height: 1280 });
    const hit = matchFreshSource(fresh, stale);
    expect(hit?.url).toBe('https://cdn/clean_720?sign=NEW');
  });

  it('带水印的已选项不会回找成无水印源', () => {
    const staleWm = src({ url: 'https://cdn/wm_1080?sign=OLD', width: 1080, height: 1920, watermark: 'present' });
    const hit = matchFreshSource(fresh, staleWm);
    expect(hit?.watermark).toBe('present');
  });

  it('无匹配时退回最优无水印源', () => {
    const hit = matchFreshSource(fresh, src({ url: 'https://cdn/gone?sign=OLD', width: 480, height: 854 }));
    expect(hit?.url).toBe('https://cdn/clean_1080?sign=NEW');
  });

  it('未提供已选项时返回最优无水印源', () => {
    expect(matchFreshSource(fresh)?.url).toBe('https://cdn/clean_1080?sign=NEW');
  });

  it('空候选返回 undefined', () => {
    expect(matchFreshSource([], fresh[0])).toBeUndefined();
  });
})

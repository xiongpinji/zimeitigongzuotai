import { describe, it, expect } from 'vitest';
import {
  parseCountText,
  parseAwemeHref,
  cleanDescription,
  assembleCreatorPage,
  awemeIdToPublishedAtMs,
  advanceCaptureStability,
  type RawCreatorHeader,
  type RawPostItem,
} from '@/content/dom-extractor';

describe('parseCountText', () => {
  it('parses plain integers', () => {
    expect(parseCountText('186')).toBe(186);
    expect(parseCountText('23')).toBe(23);
  });

  it('parses 万 / 亿 units', () => {
    expect(parseCountText('1.3万')).toBe(13000);
    expect(parseCountText('1.2亿')).toBe(120000000);
    expect(parseCountText('10w')).toBe(100000);
  });

  it('parses counts embedded in labels', () => {
    expect(parseCountText('粉丝1.3万')).toBe(13000);
    expect(parseCountText('获赞1.3万')).toBe(13000);
    expect(parseCountText('关注23')).toBe(23);
  });

  it('tolerates separators and suffixes', () => {
    expect(parseCountText('1,234')).toBe(1234);
    expect(parseCountText('10万+')).toBe(100000);
  });

  it('returns undefined for non-numeric / empty', () => {
    expect(parseCountText('')).toBeUndefined();
    expect(parseCountText(null)).toBeUndefined();
    expect(parseCountText(undefined)).toBeUndefined();
    expect(parseCountText('暂无')).toBeUndefined();
  });
});

describe('parseAwemeHref', () => {
  it('extracts video id', () => {
    expect(parseAwemeHref('/video/7214119063771991307?foo=1')).toEqual({
      id: '7214119063771991307',
      isNote: false,
    });
  });

  it('marks note / slides as image posts', () => {
    expect(parseAwemeHref('https://www.douyin.com/note/7300000000000000001')).toEqual({
      id: '7300000000000000001',
      isNote: true,
    });
    expect(parseAwemeHref('/slides/7300000000000000002')).toEqual({
      id: '7300000000000000002',
      isNote: true,
    });
  });

  it('recognizes article works rendered in the creator grid', () => {
    expect(parseAwemeHref('//www.douyin.com/article/7637333382447353115')).toEqual({
      id: '7637333382447353115',
      isNote: true,
      pathType: 'article',
    });
  });

  it('returns null for non-aweme hrefs', () => {
    expect(parseAwemeHref('/user/MS4wABC')).toBeNull();
    expect(parseAwemeHref(undefined)).toBeNull();
  });
});

describe('cleanDescription', () => {
  it('strips the leading "{nickname}：" prefix (full-width colon)', () => {
    expect(cleanDescription('彩棉熊：#衣服染色', '彩棉熊')).toBe('#衣服染色');
  });

  it('strips half-width colon prefix', () => {
    expect(cleanDescription('彩棉熊:hello', '彩棉熊')).toBe('hello');
  });

  it('strips a leading 置顶 marker', () => {
    expect(cleanDescription('置顶 早安', '某人')).toBe('早安');
  });

  it('returns empty string for blank input', () => {
    expect(cleanDescription('', '某人')).toBe('');
    expect(cleanDescription(undefined)).toBe('');
  });
});

describe('assembleCreatorPage', () => {
  const header: RawCreatorHeader = {
    secUid: 'MS4wLjABAAAA-secuid',
    nickname: '彩棉熊',
    fansText: '粉丝1.3万',
    avatarUrl: 'https://p3-pc.douyinpic.com/avatar.jpeg',
  };
  const items: RawPostItem[] = [
    // 置顶（最前）但 id 较小：不应被当成最新。
    { awemeId: '7000000000000000001', descText: '彩棉熊：置顶老视频', likeText: '186', pinned: true },
    { awemeId: '7300000000000000009', descText: '彩棉熊：最新视频', likeText: '1.3万' },
    { awemeId: '7200000000000000005', descText: '彩棉熊：中间视频', isNote: true },
  ];

  it('builds a creator keyed by secUid with parsed follower count', () => {
    const out = assembleCreatorPage(header, items, 1000)!;
    expect(out).not.toBeNull();
    expect(out.creator.id).toBe('MS4wLjABAAAA-secuid');
    expect(out.creator.secUid).toBe('MS4wLjABAAAA-secuid');
    expect(out.creator.nickname).toBe('彩棉熊');
    expect(out.creator.profileUrl).toBe('https://www.douyin.com/user/MS4wLjABAAAA-secuid');
    expect(out.creator.followerCount).toBe(13000);
    expect(out.creator.updatedAt).toBe(1000);
  });

  it('sorts videos by aweme id descending so newest is first (pinned ignored)', () => {
    const out = assembleCreatorPage(header, items, 1000)!;
    expect(out.videos.map((v) => v.id)).toEqual([
      '7300000000000000009',
      '7200000000000000005',
      '7000000000000000001',
    ]);
  });

  it('normalizes video fields and cleans description', () => {
    const out = assembleCreatorPage(header, items, 1000)!;
    const newest = out.videos[0];
    expect(newest.creatorId).toBe('MS4wLjABAAAA-secuid');
    expect(newest.description).toBe('最新视频');
    expect(newest.sourcePageUrl).toBe('https://www.douyin.com/video/7300000000000000009');
    expect(newest.statistics).toEqual({ likeCount: 13000 });
  });

  it('derives publishedAt from awemeId so the repo can sort newest-first', () => {
    const out = assembleCreatorPage(header, items, 1000)!;
    // 每条都拿到非 0 发布时间，且与 awemeId 降序一致（最新发布时间最大）。
    expect(out.videos.every((v) => v.publishedAt > 0)).toBe(true);
    const times = out.videos.map((v) => v.publishedAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('routes note posts to /note/ source url', () => {
    const out = assembleCreatorPage(header, items, 1000)!;
    const note = out.videos.find((v) => v.id === '7200000000000000005')!;
    expect(note.sourcePageUrl).toBe('https://www.douyin.com/note/7200000000000000005');
  });

  it('preserves article source urls', () => {
    const out = assembleCreatorPage(header, [{ awemeId: '7300000000000000006', isNote: true, pathType: 'article' }], 1000)!;
    expect(out.videos[0].sourcePageUrl).toBe('https://www.douyin.com/article/7300000000000000006');
  });

  it('dedupes repeated aweme ids', () => {
    const dup = [...items, { awemeId: '7300000000000000009', descText: 'dup' }];
    const out = assembleCreatorPage(header, dup, 1000)!;
    expect(out.videos.filter((v) => v.id === '7300000000000000009')).toHaveLength(1);
  });

  it('returns null when nickname or secUid is missing', () => {
    expect(assembleCreatorPage({ secUid: '', nickname: '彩棉熊' }, items, 1000)).toBeNull();
    expect(assembleCreatorPage({ secUid: 'abc', nickname: '' }, items, 1000)).toBeNull();
  });
});

describe('awemeIdToPublishedAtMs', () => {
  it('decodes the snowflake timestamp (high 32 bits = unix seconds) to ms', () => {
    // 真实 awemeId（合伙人Mike）：2026-06-21 / 2026-06-20。
    expect(awemeIdToPublishedAtMs('7653800519768558863')).toBe(1782039301 * 1000);
    expect(awemeIdToPublishedAtMs('7653415571018501403')).toBe(1781949673 * 1000);
  });

  it('orders by decoded time consistent with awemeId magnitude', () => {
    expect(awemeIdToPublishedAtMs('7653800519768558863')).toBeGreaterThan(
      awemeIdToPublishedAtMs('7649294440174996772'),
    );
  });

  it('returns 0 for non-numeric or out-of-range ids', () => {
    expect(awemeIdToPublishedAtMs('not-a-number')).toBe(0);
    expect(awemeIdToPublishedAtMs('')).toBe(0);
    expect(awemeIdToPublishedAtMs('1')).toBe(0); // 解码后远早于 2010，判为无效
  });
});

describe('advanceCaptureStability', () => {
  it('does not settle on a partially rendered first row', () => {
    let state = { lastCount: 0, stableRounds: 0 };
    state = advanceCaptureStability(state, 2).state;
    expect(state.stableRounds).toBe(0);
    const next = advanceCaptureStability(state, 20);
    expect(next.settled).toBe(false);
    expect(next.state).toEqual({ lastCount: 20, stableRounds: 0 });
  });

  it('settles only after the non-empty item count is stable for three polls', () => {
    let state = { lastCount: 20, stableRounds: 0 };
    expect((state = advanceCaptureStability(state, 20).state).stableRounds).toBe(1);
    expect((state = advanceCaptureStability(state, 20).state).stableRounds).toBe(2);
    const third = advanceCaptureStability(state, 20);
    expect(third.settled).toBe(true);
    expect(third.state.stableRounds).toBe(3);
  });
});

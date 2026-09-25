import { describe, it, expect } from 'vitest';
import { diffNewVideos } from '@/monitor/diff';
import type { Video } from '@/domain/models';

const v = (id: string): Video => ({
  id,
  creatorId: 'c1',
  description: id,
  publishedAt: Number(id),
  sourcePageUrl: `https://www.douyin.com/video/${id}`,
});

// 抖音作品列表为最新在前。
describe('diffNewVideos', () => {
  it('treats the first sync as baseline (no new videos, records latest)', () => {
    const r = diffNewVideos(undefined, [v('3'), v('2'), v('1')]);
    expect(r.newVideos).toEqual([]);
    expect(r.latestId).toBe('3');
  });

  it('returns videos newer than the known latest id', () => {
    const r = diffNewVideos('1', [v('3'), v('2'), v('1')]);
    expect(r.newVideos.map((x) => x.id)).toEqual(['3', '2']);
    expect(r.latestId).toBe('3');
  });

  it('treats all as new when the known id is no longer in the list', () => {
    const r = diffNewVideos('0', [v('3'), v('2')]);
    expect(r.newVideos.map((x) => x.id)).toEqual(['3', '2']);
    expect(r.latestId).toBe('3');
  });

  it('returns nothing new when the latest matches the known id', () => {
    const r = diffNewVideos('3', [v('3'), v('2')]);
    expect(r.newVideos).toEqual([]);
    expect(r.latestId).toBe('3');
  });

  it('handles an empty list', () => {
    const r = diffNewVideos('3', []);
    expect(r.newVideos).toEqual([]);
    expect(r.latestId).toBeUndefined();
  });
});

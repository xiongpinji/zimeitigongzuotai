import { describe, it, expect } from 'vitest';
import { adaptAwemeDetail, adaptAwemePostList } from '@/adapter/video-adapter';
import {
  extractVideoSources,
  extractVideoId,
  buildMuxedPlayApiUrl,
  buildMuxedPlayApiSource,
} from '@/adapter/source-extractor';
import detailFixture from './fixtures/aweme-detail.json';
import camelFixture from './fixtures/aweme-detail.camel.json';
import postListFixture from './fixtures/aweme-post-list.json';

describe('adaptAwemeDetail', () => {
  const result = adaptAwemeDetail(detailFixture)!;

  it('maps core video fields', () => {
    expect(result).not.toBeNull();
    expect(result.video.id).toBe('7300000000000000001');
    expect(result.video.description).toBe('测试视频标题 不含真实数据');
    expect(result.video.creatorId).toBe('100000001');
    expect(result.video.durationMs).toBe(30000);
    expect(result.video.coverUrl).toBe('https://p3.douyinpic.com/aweme/cover.jpeg');
  });

  it('converts create_time seconds to a millisecond timestamp', () => {
    expect(result.video.publishedAt).toBe(1718000000 * 1000);
  });

  it('maps statistics from douyin field names', () => {
    expect(result.video.statistics).toEqual({
      likeCount: 1000,
      commentCount: 50,
      collectCount: 30,
      shareCount: 20,
      playCount: 0,
    });
  });

  it('builds a canonical source page url from the aweme id', () => {
    expect(result.video.sourcePageUrl).toBe('https://www.douyin.com/video/7300000000000000001');
  });

  it('maps the creator profile', () => {
    expect(result.creator.id).toBe('100000001');
    expect(result.creator.secUid).toBe('MS4wLjABAAAAtestsecuid0001');
    expect(result.creator.nickname).toBe('测试博主');
    expect(result.creator.followerCount).toBe(12345);
    expect(result.creator.videoCount).toBe(67);
    expect(result.creator.profileUrl).toBe(
      'https://www.douyin.com/user/MS4wLjABAAAAtestsecuid0001',
    );
  });

  it('tolerates camelCase field variants', () => {
    const camel = adaptAwemeDetail(camelFixture)!;
    expect(camel.video.id).toBe('7300000000000000009');
    expect(camel.video.durationMs).toBe(12000);
    expect(camel.creator.nickname).toBe('驼峰博主');
    expect(camel.creator.secUid).toBe('MS4wLjABAAAAtestsecuid0009');
    expect(camel.video.coverUrl).toBe('https://p3.douyinpic.com/aweme/cover9.jpeg');
  });

  it('returns null when the detail envelope has no aweme', () => {
    expect(adaptAwemeDetail({ status_code: 0 })).toBeNull();
  });
});

describe('adaptAwemePostList', () => {
  const result = adaptAwemePostList(postListFixture);

  it('maps every aweme in the list', () => {
    expect(result.videos).toHaveLength(2);
    expect(result.videos.map((v) => v.id)).toEqual([
      '7300000000000000101',
      '7300000000000000102',
    ]);
  });

  it('derives the creator once from the list authors', () => {
    expect(result.creator?.id).toBe('100000050');
    expect(result.creator?.nickname).toBe('列表博主');
  });

  it('returns an empty list for an empty envelope', () => {
    expect(adaptAwemePostList({ status_code: 0 }).videos).toEqual([]);
  });
});

describe('extractVideoSources', () => {
  const video = (detailFixture as { aweme_detail: { video: unknown } }).aweme_detail.video;
  const sources = extractVideoSources(video);

  it('collects candidates from play_addr, download_addr and every bit_rate gear', () => {
    expect(sources).toHaveLength(4);
    const fields = sources.map((s) => s.sourceField).sort();
    expect(fields).toEqual(['bit_rate', 'bit_rate', 'download_addr', 'play_addr']);
  });

  it('carries dimensions, bitrate and codec hints for bit_rate gears', () => {
    const bytevc1 = sources.find((s) => s.isBytevc1);
    expect(bytevc1).toBeDefined();
    expect(bytevc1!.bitrate).toBe(1800000);
    expect(bytevc1!.width).toBe(1080);
    expect(bytevc1!.format).toBe('mp4');
  });

  it('flags the download_addr candidate distinctly from play_addr', () => {
    const dl = sources.find((s) => s.sourceField === 'download_addr');
    expect(dl).toBeDefined();
    expect(dl!.url).toContain('playwm');
  });

  it('returns an empty array when no video sources exist', () => {
    expect(extractVideoSources({})).toEqual([]);
  });
});

describe('muxed play API source (音视频分离作品的合流提音源)', () => {
  const video = (detailFixture as { aweme_detail: { video: unknown } }).aweme_detail.video;

  it('reads video_id from play_addr.uri', () => {
    expect(extractVideoId(video)).toBe('v0300fake0001');
  });

  it('falls back to the first bit_rate gear uri when play_addr.uri is absent', () => {
    expect(extractVideoId({ bit_rate: [{ play_addr: { uri: 'gearVid' } }] })).toBe('gearVid');
    expect(extractVideoId({})).toBeUndefined();
  });

  it('builds the snssdk play API muxed url with video_id and ratio', () => {
    expect(buildMuxedPlayApiUrl('abc', '720p')).toBe(
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=abc&ratio=720p&line=0',
    );
  });

  it('builds a no-watermark muxed VideoSource carrying the play API url', () => {
    const muxed = buildMuxedPlayApiSource(video)!;
    expect(muxed.url).toContain('aweme.snssdk.com/aweme/v1/play/');
    expect(muxed.url).toContain('video_id=v0300fake0001');
    expect(muxed.watermark).toBe('none');
    expect(muxed.mimeType).toBe('video/mp4');
  });

  it('returns null when no video_id can be derived', () => {
    expect(buildMuxedPlayApiSource({})).toBeNull();
  });
});

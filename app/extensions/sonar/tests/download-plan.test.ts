import { describe, it, expect } from 'vitest';
import { planDownload, extensionFromSource } from '@/background/download/plan';
import type { Creator, Video, VideoSource } from '@/domain/models';

const video: Video = {
  id: '7300000000000000001',
  creatorId: 'c1',
  description: '标题',
  publishedAt: Date.UTC(2026, 5, 19),
  sourcePageUrl: 'https://www.douyin.com/video/7300000000000000001',
};
const creator: Creator = {
  id: 'c1',
  secUid: 'MS4w',
  nickname: '博主',
  profileUrl: 'https://www.douyin.com/user/MS4w',
  updatedAt: 0,
};
function source(over: Partial<VideoSource> = {}): VideoSource {
  return {
    url: 'https://v3-web.douyinvod.com/fake/h264.mp4?sign=X',
    watermark: 'none',
    watermarkConfidence: 'high',
    watermarkEvidence: [],
    ...over,
  };
}

describe('extensionFromSource', () => {
  it('prefers the source mimeType', () => {
    expect(extensionFromSource(source({ mimeType: 'video/webm' }))).toBe('webm');
  });

  it('sniffs the url path extension when mime is absent', () => {
    expect(extensionFromSource(source({ url: 'https://cdn/x/clip.mov?sign=1' }))).toBe('mov');
  });

  it('falls back to mp4 when neither mime nor a known url extension exists', () => {
    expect(extensionFromSource(source({ url: 'https://cdn/x/stream?sign=1' }))).toBe('mp4');
  });
});

describe('planDownload', () => {
  it('composes filename and url from video, creator and source', () => {
    const plan = planDownload({ video, creator, source: source({ mimeType: 'video/mp4' }) });
    expect(plan.url).toBe(source().url);
    expect(plan.filename).toBe('灵机剪影/抖音/博主/20260619_标题_7300000000000000001.mp4');
  });

  it('uses a fallback nickname when creator is null', () => {
    const plan = planDownload({ video, creator: null, source: source() });
    expect(plan.filename).toContain('/抖音/未知博主/');
  });
});

import { describe, it, expect } from 'vitest';
import { buildBridgePayload } from '@/bridge/payload-builder';
import type { Creator, Video, TranscriptDocument, ViralInsight } from '@/domain/models';

const video: Video = {
  id: 'aweme-9',
  creatorId: 'c1',
  description: '第一行标题\n第二行正文',
  coverUrl: 'https://cdn/c.jpg',
  publishedAt: 1_700_000_000_000,
  durationMs: 42_000,
  sourcePageUrl: 'https://www.douyin.com/video/aweme-9',
};

const creator: Creator = {
  id: 'c1',
  secUid: 'sec',
  nickname: '老王',
  profileUrl: 'https://www.douyin.com/user/sec',
  updatedAt: 0,
};

const transcript: TranscriptDocument = {
  videoId: 'aweme-9',
  provider: 'bcut',
  language: 'zh',
  fullText: '完整转录',
  srtText: '1\n00:00:00,000 --> 00:00:01,000\n完整转录\n',
  segments: [{ text: '完整转录', startMs: 0, endMs: 1000 }],
  createdAt: 0,
};

describe('buildBridgePayload', () => {
  it('组装完整负载，title 取文案首行', () => {
    const p = buildBridgePayload(video, creator, transcript)!;
    expect(p).toMatchObject({
      source: 'douyin',
      awemeId: 'aweme-9',
      creatorId: 'c1',
      creatorName: '老王',
      title: '第一行标题',
      url: 'https://www.douyin.com/video/aweme-9',
      coverUrl: 'https://cdn/c.jpg',
      durationMs: 42_000,
    });
    expect(p.transcript.fullText).toBe('完整转录');
    expect(p.transcript.segments).toHaveLength(1);
  });

  it('缺转录 → null', () => {
    expect(buildBridgePayload(video, creator, null)).toBeNull();
    expect(buildBridgePayload(video, creator, { ...transcript, fullText: '' })).toBeNull();
  });

  it('creator 缺失 → 用占位名', () => {
    expect(buildBridgePayload(video, null, transcript)!.creatorName).toBe('未知博主');
  });

  it('超长 title 截断', () => {
    const long = 'x'.repeat(200);
    const p = buildBridgePayload({ ...video, description: long }, creator, transcript)!;
    expect(p.title.length).toBeLessThanOrEqual(81);
    expect(p.title.endsWith('…')).toBe(true);
  });

  it('无封面/时长时省略对应字段', () => {
    const bare: Video = { ...video, coverUrl: undefined, durationMs: undefined };
    const p = buildBridgePayload(bare, creator, transcript)!;
    expect('coverUrl' in p).toBe(false);
    expect('durationMs' in p).toBe(false);
  });

  it('带 insight 时附爆款拆解（剔除内部字段）', () => {
    const insight: ViralInsight = {
      videoId: 'aweme-9',
      angle: '反常识',
      hook: '开头钩子',
      structure: ['一', '二'],
      highlights: ['金句'],
      dataPoints: [],
      remixSuggestions: ['换案例'],
      model: 'm',
      createdAt: 9,
    };
    const p = buildBridgePayload(video, creator, transcript, insight)!;
    expect(p.insight).toEqual({
      angle: '反常识',
      hook: '开头钩子',
      structure: ['一', '二'],
      highlights: ['金句'],
      dataPoints: [],
      remixSuggestions: ['换案例'],
    });
  });

  it('无 insight 时省略该字段', () => {
    expect('insight' in buildBridgePayload(video, creator, transcript)!).toBe(false);
  });
});

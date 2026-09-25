import { describe, expect, it } from 'vitest';
import { createPersistedAIState, parsePersistedAIState } from './ai-persistence';
import type { AICard, AIAnalysisResult } from '../types/ai';
import { DEFAULT_CARD_STYLE } from '../types/ai';

describe('ai-persistence media cards', () => {
  it('parses persisted image and video card content', () => {
    const imageCard: AICard = {
      id: 'card-image',
      segmentId: 'manual:image',
      type: 'image',
      title: '图片卡',
      content: {
        mediaType: 'image',
        assetPath: 'ai-cards/card-image/image.png',
        aspectRatio: '16:9',
        prompt: '生成一张科技发布会图片',
        providerId: null,
        model: null,
        generationStatus: 'ready',
      },
      startMs: 0,
      endMs: 4000,
      displayDurationMs: 4000,
      displayMode: 'fullscreen',
      template: 'image-default',
      enabled: true,
      style: DEFAULT_CARD_STYLE.image,
    };
    const videoCard: AICard = {
      ...imageCard,
      id: 'card-video',
      segmentId: 'manual:video',
      type: 'video',
      title: '视频卡',
      content: {
        mediaType: 'video',
        assetPath: 'ai-cards/card-video/video.mp4',
        posterPath: 'ai-cards/card-video/poster.jpg',
        aspectRatio: '16:9',
        prompt: '生成一个短视频',
        providerId: null,
        model: null,
        generationStatus: 'ready',
        mediaDurationMs: 6000,
      },
      template: 'video-default',
      style: DEFAULT_CARD_STYLE.video,
    };
    const result: AIAnalysisResult = {
      segments: [],
      cards: [imageCard, videoCard],
      coverPrompts: [],
      summary: '',
      keywords: [],
    };

    const parsed = parsePersistedAIState(createPersistedAIState(result, []));

    expect(parsed?.analysisResult?.cards).toHaveLength(2);
    expect(parsed?.analysisResult?.cards[0]?.type).toBe('image');
    expect(parsed?.analysisResult?.cards[1]?.content).toMatchObject({
      mediaType: 'video',
      posterPath: 'ai-cards/card-video/poster.jpg',
    });
  });
});

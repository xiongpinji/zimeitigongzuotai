import { beforeEach, describe, expect, it } from 'vitest';
import { createManualMediaCard } from './manual-media-card';
import { useAIStore } from '../store/ai';
import { useTimelineStore } from '../store/timeline';
import { createDefaultTimeline } from '../types';

describe('createManualMediaCard', () => {
  beforeEach(() => {
    useAIStore.setState({
      analysisResult: null,
      coverCandidates: [],
      cardMediaTasks: {},
    });
    useTimelineStore.setState({
      timeline: createDefaultTimeline(),
      srtEntries: [],
      originalSrtEntries: [],
      assets: [],
      overlayClipboard: null,
      canUndo: false,
      canRedo: false,
      historyPast: [],
      historyFuture: [],
      subtitleSelection: [],
    });
  });

  it('creates an image card from selected subtitles and inserts it into timeline', async () => {
    const card = await createManualMediaCard({
      mediaType: 'image',
      segmentId: 'manual:selection-1',
      title: '手选图片卡',
      prompt: '镜头里出现城市夜景和关键数据',
      startMs: 1200,
      endMs: 4500,
      displayDurationMs: 3000,
    });

    expect(card.type).toBe('image');
    expect(card.title).toBe('手选图片卡');
    expect(card.startMs).toBe(1200);
    expect(card.endMs).toBe(4500);
    expect(card.displayDurationMs).toBe(3000);
    expect(useAIStore.getState().analysisResult?.cards).toHaveLength(1);

    const overlay = useTimelineStore.getState().timeline.overlays[0];
    expect(overlay.overlayType).toBe('ai-card');
    expect(overlay.aiCardData?.sourceCardId).toBe(card.id);
    expect(overlay.aiCardData?.cardType).toBe('image');
    expect(overlay.startMs).toBe(1500);
    expect(overlay.durationMs).toBe(3000);
  });

  it('creates a video card with duration seconds derived from display duration', async () => {
    const card = await createManualMediaCard({
      mediaType: 'video',
      segmentId: 'manual:selection-2',
      prompt: '产品功能动效展示',
      startMs: 10_000,
      endMs: 18_000,
      displayDurationMs: 8000,
    });

    expect(card.type).toBe('video');
    expect(card.displayDurationMs).toBe(8000);
    expect(card.content).toMatchObject({
      mediaType: 'video',
      prompt: '产品功能动效展示',
    });
    expect(useTimelineStore.getState().timeline.overlays[0]?.durationMs).toBe(8000);
  });
});

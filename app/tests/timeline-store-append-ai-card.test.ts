import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTimeline } from '../src/types';
import { useTimelineStore } from '../src/store/timeline';
import type { AICardTimelineDraft } from '../src/types/ai';

const makeDraft = (
  id: string,
  startMs: number,
  displayMode: AICardTimelineDraft['aiCardData']['displayMode'] = 'fullscreen',
): AICardTimelineDraft => ({
  sourceCardId: id,
  startMs,
  durationMs: 5_000,
  aiCardData: {
    sourceCardId: id,
    cardType: 'summary',
    title: `卡片 ${id}`,
    content: '内容',
    template: 'summary-default',
    displayMode,
    style: {
      primaryColor: '#6366f1',
      backgroundColor: '#0f172a',
      fontSize: 48,
    },
  },
});

const resetStore = () => {
  useTimelineStore.setState({
    timeline: createDefaultTimeline(),
    srtEntries: [],
    assets: [],
    overlayClipboard: null,
    historyPast: [],
    historyFuture: [],
  });
};

// 用于结构性对比：去掉每张卡片随机生成的 overlay id（`${sourceCardId}-${uuid()}`）。
const normalizeForParity = (timeline: ReturnType<typeof createDefaultTimeline>) => ({
  tracks: timeline.tracks,
  overlays: timeline.overlays.map((overlay) => {
    const { id: _id, ...rest } = overlay;
    return rest;
  }),
});

describe('appendAICardToTimeline', () => {
  beforeEach(resetStore);

  it('inserts a single ai-card overlay immediately', () => {
    useTimelineStore.getState().appendAICardToTimeline(makeDraft('ai-card-1', 2_000));

    const overlay = useTimelineStore.getState().timeline.overlays[0];
    expect(overlay).toMatchObject({ overlayType: 'ai-card' });
    expect(overlay?.id).toMatch(/^ai-card-1-/);
    expect(overlay?.aiCardData?.sourceCardId).toBe('ai-card-1');
    // 与批量动作一致：不产生幽灵媒体资产。
    expect(useTimelineStore.getState().assets).toEqual([]);
  });

  it('produces the SAME final timeline as one batch addAICardsToTimeline call (parity)', () => {
    const drafts = [
      makeDraft('ai-card-1', 2_000, 'fullscreen'),
      makeDraft('ai-card-2', 8_000, 'pip'),
      makeDraft('ai-card-3', 14_000, 'fullscreen'),
    ];

    // 路径 A：逐张 append。
    resetStore();
    for (const draft of drafts) {
      useTimelineStore.getState().appendAICardToTimeline(draft);
    }
    const incremental = normalizeForParity(useTimelineStore.getState().timeline);

    // 路径 B：一次批量。
    resetStore();
    useTimelineStore.getState().addAICardsToTimeline(drafts);
    const batched = normalizeForParity(useTimelineStore.getState().timeline);

    expect(incremental.tracks).toEqual(batched.tracks);
    expect(incremental.overlays).toEqual(batched.overlays);
  });

  it('coalesces consecutive appends into a single undo entry', () => {
    const drafts = [
      makeDraft('ai-card-1', 2_000),
      makeDraft('ai-card-2', 8_000),
      makeDraft('ai-card-3', 14_000),
    ];

    for (const draft of drafts) {
      useTimelineStore.getState().appendAICardToTimeline(draft, { coalesceHistory: true });
    }

    // 三张卡片全部可见。
    expect(
      useTimelineStore
        .getState()
        .timeline.overlays.filter((o) => o.overlayType === 'ai-card'),
    ).toHaveLength(3);

    // 仅一条撤销记录（整轮折叠）。
    expect(useTimelineStore.getState().historyPast).toHaveLength(1);

    // 单次 undo 即回到所有卡片插入之前。
    useTimelineStore.getState().undo();
    expect(
      useTimelineStore
        .getState()
        .timeline.overlays.filter((o) => o.overlayType === 'ai-card'),
    ).toHaveLength(0);
  });

  it('records a separate undo entry per append without coalescing', () => {
    useTimelineStore.getState().appendAICardToTimeline(makeDraft('ai-card-1', 2_000));
    useTimelineStore.getState().appendAICardToTimeline(makeDraft('ai-card-2', 8_000));

    expect(useTimelineStore.getState().historyPast).toHaveLength(2);
  });
});

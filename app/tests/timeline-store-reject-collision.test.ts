import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('updateOverlay reject-on-collision', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      timeline: {
        ...createDefaultTimeline(),
        overlays: [
          {
            id: 'a', type: 'image', assetPath: '', trackId: 'visual-1',
            startMs: 0, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
          {
            id: 'b', type: 'image', assetPath: '', trackId: 'visual-1',
            startMs: 3000, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
      historyPast: [],
      historyFuture: [],
      canUndo: false,
      canRedo: false,
    });
  });

  it('rejects move that would overlap an existing clip', () => {
    const { updateOverlay } = useTimelineStore.getState();
    updateOverlay('a', { startMs: 2500 }); // 会和 b 相撞
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(0); // 保留原值
  });

  it('accepts move into free slot', () => {
    const { updateOverlay } = useTimelineStore.getState();
    updateOverlay('a', { startMs: 5000 }); // 空区
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(5000);
  });

  it('rejects cross-track move into occupied slot', () => {
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: [
          ...s.timeline.tracks,
          { id: 'visual-9', kind: 'visual', label: '轨道9', order: 9 },
        ],
        overlays: [
          ...s.timeline.overlays,
          {
            id: 'c', type: 'image', assetPath: '', trackId: 'visual-9',
            startMs: 0, durationMs: 10_000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
    }));
    useTimelineStore.getState().updateOverlay('a', { trackId: 'visual-9', startMs: 0 });
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.trackId).toBe('visual-1');
    expect(a.startMs).toBe(0);
  });

  it('ai-card now participates in collision rejection', () => {
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        overlays: [
          {
            id: 'card', type: 'image', assetPath: '', trackId: 'visual-2',
            startMs: 1000, durationMs: 3000,
            position: { x: 0, y: 0, width: 100, height: 100 },
            overlayType: 'ai-card',
          },
          {
            id: 'media', type: 'image', assetPath: '', trackId: 'visual-2',
            startMs: 6000, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
    }));
    useTimelineStore.getState().updateOverlay('media', { startMs: 2000 });
    const media = useTimelineStore
      .getState()
      .timeline.overlays.find((o) => o.id === 'media')!;
    expect(media.startMs).toBe(6000);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('trimOverlayClip', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      timeline: {
        ...createDefaultTimeline(),
        overlays: [
          {
            id: 'a', type: 'image', assetPath: '', trackId: 'visual-1',
            startMs: 2000, durationMs: 3000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
          {
            id: 'b', type: 'image', assetPath: '', trackId: 'visual-1',
            startMs: 6000, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
      historyPast: [], historyFuture: [],
      canUndo: false, canRedo: false,
    });
  });

  it('trims the start edge', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'start', 2500);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(2500);
    expect(a.durationMs).toBe(2500); // (2000+3000) - 2500
  });

  it('trims the end edge', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'end', 4500);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(2000);
    expect(a.durationMs).toBe(2500);
  });

  it('enforces minimum duration of 100ms', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'end', 2050);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.durationMs).toBe(100);
  });

  it('stops at adjacent clip on end trim', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'end', 7000);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs + a.durationMs).toBeLessThanOrEqual(6000);
  });

  it('does not allow negative start', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'start', -500);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(0);
  });

  it('rejects trim on locked track', () => {
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: s.timeline.tracks.map((t) =>
          t.id === 'visual-1' ? { ...t, locked: true } : t,
        ),
      },
    }));
    useTimelineStore.getState().trimOverlayClip('a', 'end', 4500);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.durationMs).toBe(3000);
  });
});

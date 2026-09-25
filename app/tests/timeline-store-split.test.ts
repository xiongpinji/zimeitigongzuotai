import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('splitOverlayClipsAt', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      timeline: {
        ...createDefaultTimeline(),
        overlays: [
          {
            id: 'a', type: 'image', assetPath: '/foo.png', trackId: 'visual-1',
            startMs: 1000, durationMs: 4000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
          {
            id: 'b', type: 'image', assetPath: '/bar.png', trackId: 'visual-1',
            startMs: 6000, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
      historyPast: [], historyFuture: [],
      canUndo: false, canRedo: false,
    });
  });

  it('splits the clip intersecting playhead', () => {
    useTimelineStore.getState().splitOverlayClipsAt(3000);
    const overlays = useTimelineStore.getState().timeline.overlays;
    const left = overlays.find((o) => o.id === 'a')!;
    expect(left.startMs).toBe(1000);
    expect(left.durationMs).toBe(2000);
    const right = overlays.find(
      (o) => o.id !== 'a' && o.id !== 'b' && o.assetPath === '/foo.png',
    );
    expect(right).toBeDefined();
    expect(right!.startMs).toBe(3000);
    expect(right!.durationMs).toBe(2000);
  });

  it('does nothing when playhead does not intersect any clip', () => {
    const before = useTimelineStore.getState().timeline.overlays.length;
    useTimelineStore.getState().splitOverlayClipsAt(5500);
    expect(useTimelineStore.getState().timeline.overlays.length).toBe(before);
  });

  it('only splits targetIds when provided', () => {
    useTimelineStore.getState().splitOverlayClipsAt(3000, ['b']);
    const overlays = useTimelineStore.getState().timeline.overlays;
    expect(overlays.filter((o) => o.assetPath === '/foo.png').length).toBe(1);
  });

  it('skips locked tracks', () => {
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: s.timeline.tracks.map((t) =>
          t.id === 'visual-1' ? { ...t, locked: true } : t,
        ),
      },
    }));
    useTimelineStore.getState().splitOverlayClipsAt(3000);
    const overlays = useTimelineStore.getState().timeline.overlays;
    expect(overlays.filter((o) => o.assetPath === '/foo.png').length).toBe(1);
  });

  it('rejects split within 50ms of a clip edge', () => {
    useTimelineStore.getState().splitOverlayClipsAt(1020);
    const overlays = useTimelineStore.getState().timeline.overlays;
    expect(overlays.filter((o) => o.assetPath === '/foo.png').length).toBe(1);
  });
});

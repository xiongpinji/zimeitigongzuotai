import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('track lock & createTrackAt', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      timeline: {
        ...createDefaultTimeline(),
        overlays: [
          {
            id: 'a',
            type: 'image',
            assetPath: '',
            trackId: 'visual-1',
            startMs: 1000,
            durationMs: 2000,
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

  it('toggleTrackLocked toggles locked flag', () => {
    useTimelineStore.getState().toggleTrackLocked('visual-1');
    expect(
      useTimelineStore.getState().timeline.tracks.find((t) => t.id === 'visual-1')?.locked,
    ).toBe(true);
    useTimelineStore.getState().toggleTrackLocked('visual-1');
    expect(
      useTimelineStore.getState().timeline.tracks.find((t) => t.id === 'visual-1')?.locked,
    ).toBe(false);
  });

  it('removeOverlay is blocked on locked track', () => {
    useTimelineStore.getState().toggleTrackLocked('visual-1');
    useTimelineStore.getState().removeOverlay('a');
    expect(
      useTimelineStore.getState().timeline.overlays.some((o) => o.id === 'a'),
    ).toBe(true);
  });

  it('audio track is unlockable (no hardcoded block)', () => {
    useTimelineStore.getState().toggleTrackLocked('audio');
    expect(
      useTimelineStore.getState().timeline.tracks.find((t) => t.id === 'audio')?.locked,
    ).toBe(false);
  });

  it('createTrackAt top inserts a track with lowest order', () => {
    const id = useTimelineStore.getState().createTrackAt('top');
    const tracks = useTimelineStore.getState().timeline.tracks;
    const visualTracks = tracks
      .filter((t) => t.kind === 'visual')
      .sort((a, b) => a.order - b.order);
    expect(visualTracks[0].id).toBe(id);
  });

  it('createTrackAt bottom inserts a track with highest order', () => {
    const id = useTimelineStore.getState().createTrackAt('bottom');
    const tracks = useTimelineStore.getState().timeline.tracks;
    const visualTracks = tracks
      .filter((t) => t.kind === 'visual')
      .sort((a, b) => a.order - b.order);
    expect(visualTracks[visualTracks.length - 1].id).toBe(id);
  });

  it('createTrackAt gap inserts at exact index with re-normalized order', () => {
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: [
          { id: 'audio', kind: 'audio', label: 'A', order: 0, locked: true },
          { id: 'visual-1', kind: 'visual', label: 'V1', order: 0 },
          { id: 'visual-2', kind: 'visual', label: 'V2', order: 1 },
          { id: 'visual-3', kind: 'visual', label: 'V3', order: 2 },
        ],
      },
    }));
    const newId = useTimelineStore
      .getState()
      .createTrackAt({ kind: 'gap', gapIndex: 2 });
    const visualTracks = useTimelineStore
      .getState()
      .timeline.tracks.filter((t) => t.kind === 'visual')
      .sort((a, b) => a.order - b.order);
    expect(visualTracks.map((t) => t.id)).toEqual([
      'visual-1',
      'visual-2',
      newId,
      'visual-3',
    ]);
    expect(visualTracks.map((t) => t.order)).toEqual([0, 1, 2, 3]);
  });
});

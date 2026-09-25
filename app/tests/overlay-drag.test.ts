import { describe, expect, it } from 'vitest';
import { getOverlayMoveDraft, resolveTrackIdByClientY } from '../src/lib/overlay-drag';

describe('overlay drag helpers', () => {
  const trackZones = [
    { trackId: 'visual-3', top: 100, bottom: 140 },
    { trackId: 'visual-2', top: 141, bottom: 181 },
    { trackId: 'visual-1', top: 182, bottom: 222 },
  ];

  it('resolves the hovered track by pointer y position', () => {
    expect(resolveTrackIdByClientY(150, trackZones, 'visual-1')).toBe('visual-2');
  });

  it('keeps the current track when pointer is outside every lane', () => {
    expect(resolveTrackIdByClientY(80, trackZones, 'visual-1')).toBe('visual-1');
  });

  it('returns both the updated start time and target track while dragging', () => {
    expect(
      getOverlayMoveDraft({
        startMs: 1_000,
        startClientX: 300,
        currentClientX: 620,
        pxPerMs: 0.08,
        projectDurationMs: 12_000,
        overlayDurationMs: 5_000,
        fallbackTrackId: 'visual-1',
        clientY: 150,
        trackZones,
      }),
    ).toEqual({
      startMs: 5_000,
      trackId: 'visual-2',
    });
  });

  it('clamps the dragged start time within the project duration', () => {
    expect(
      getOverlayMoveDraft({
        startMs: 9_000,
        startClientX: 300,
        currentClientX: 760,
        pxPerMs: 0.08,
        projectDurationMs: 12_000,
        overlayDurationMs: 5_000,
        fallbackTrackId: 'visual-1',
        clientY: 205,
        trackZones,
      }),
    ).toEqual({
      startMs: 7_000,
      trackId: 'visual-1',
    });
  });
});

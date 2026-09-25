import { describe, it, expect } from 'vitest';
import {
  isOverlayTrackManaged,
  canPlaceAt,
  findCollidingItems,
  overlaysOverlap,
} from '../src/lib/timeline-placement';
import type { OverlayItem } from '../src/types';

function makeOverlay(partial: Partial<OverlayItem>): OverlayItem {
  return {
    id: 'o1',
    type: 'image',
    assetPath: '',
    trackId: 'visual-1',
    startMs: 0,
    durationMs: 1000,
    position: { x: 0, y: 0, width: 100, height: 100 },
    ...partial,
  } as OverlayItem;
}

describe('isOverlayTrackManaged (universal)', () => {
  it('treats ai-card as managed', () => {
    const overlay = makeOverlay({ overlayType: 'ai-card' });
    expect(isOverlayTrackManaged(overlay)).toBe(true);
  });

  it('excludes default-background', () => {
    const overlay = makeOverlay({ overlayRole: 'default-background' });
    expect(isOverlayTrackManaged(overlay)).toBe(false);
  });

  it('treats text overlay as managed', () => {
    const overlay = makeOverlay({ type: 'text' });
    expect(isOverlayTrackManaged(overlay)).toBe(true);
  });
});

describe('canPlaceAt', () => {
  const existing: OverlayItem[] = [
    makeOverlay({ id: 'a', trackId: 'visual-1', startMs: 1000, durationMs: 2000 }),
    makeOverlay({ id: 'b', trackId: 'visual-1', startMs: 5000, durationMs: 1000, overlayType: 'ai-card' }),
  ];

  it('returns ok=true when slot is empty', () => {
    const result = canPlaceAt({
      trackId: 'visual-1',
      startMs: 3500,
      durationMs: 1000,
      overlays: existing,
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with reason=overlap when colliding with ai-card', () => {
    const result = canPlaceAt({
      trackId: 'visual-1',
      startMs: 5500,
      durationMs: 500,
      overlays: existing,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('overlap');
  });

  it('respects excludeOverlayId', () => {
    const result = canPlaceAt({
      trackId: 'visual-1',
      startMs: 1000,
      durationMs: 2000,
      excludeOverlayId: 'a',
      overlays: existing,
    });
    expect(result.ok).toBe(true);
  });
});

describe('findCollidingItems', () => {
  it('returns all overlapping ids regardless of type', () => {
    const overlays: OverlayItem[] = [
      makeOverlay({ id: 'x1', trackId: 'visual-1', startMs: 0, durationMs: 2000 }),
      makeOverlay({ id: 'x2', trackId: 'visual-1', startMs: 1500, durationMs: 1000, overlayType: 'ai-card' }),
      makeOverlay({ id: 'x3', trackId: 'visual-1', startMs: 3000, durationMs: 1000 }),
    ];
    const collisions = findCollidingItems({
      trackId: 'visual-1',
      startMs: 1000,
      durationMs: 1200,
      overlays,
    });
    expect(collisions.map((o) => o.id).sort()).toEqual(['x1', 'x2']);
  });
});

// overlaysOverlap re-exported sanity check (used by callers of this module)
describe('overlaysOverlap (sanity)', () => {
  it('is accessible via the module', () => {
    expect(typeof overlaysOverlap).toBe('function');
  });
});

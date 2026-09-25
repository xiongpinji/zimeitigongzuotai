import { describe, it, expect } from 'vitest';
import { computeSnap } from '../src/lib/timeline-snap';
import type { OverlayItem } from '../src/types';

function o(partial: Partial<OverlayItem>): OverlayItem {
  return {
    id: partial.id ?? 'x',
    type: 'image', assetPath: '', trackId: partial.trackId ?? 'visual-1',
    startMs: partial.startMs ?? 0, durationMs: partial.durationMs ?? 1000,
    position: { x: 0, y: 0, width: 100, height: 100 },
  } as OverlayItem;
}

describe('computeSnap', () => {
  const overlays: OverlayItem[] = [
    o({ id: 'a', trackId: 'visual-1', startMs: 1000, durationMs: 2000 }),
    o({ id: 'b', trackId: 'visual-2', startMs: 5000, durationMs: 1000 }),
  ];

  it('snaps to playhead within threshold', () => {
    const result = computeSnap({
      candidateMs: 4980,
      playheadMs: 5000,
      overlays,
      excludeOverlayId: 'a',
      pxPerMs: 0.1,          // 10ms == 1px; threshold 8px == 80ms
      thresholdPx: 8,
      enabled: true,
    });
    expect(result.snappedMs).toBe(5000);
    expect(result.targets.some((t) => t.kind === 'playhead')).toBe(true);
  });

  it('snaps to clip edge across tracks', () => {
    const result = computeSnap({
      candidateMs: 3010,
      playheadMs: 0,
      overlays,
      // 注意:此处不排除 clip a,因为被测场景是"拖动另一个 clip 时贴齐到 a 的 end"
      pxPerMs: 0.1,
      thresholdPx: 8,
      enabled: true,
    });
    // clip a 的 end = 3000 在阈值内
    expect(result.snappedMs).toBe(3000);
    expect(result.targets[0].kind).toBe('clip-edge');
  });

  it('returns candidate unchanged when disabled', () => {
    const result = computeSnap({
      candidateMs: 4980,
      playheadMs: 5000,
      overlays,
      pxPerMs: 0.1,
      thresholdPx: 8,
      enabled: false,
    });
    expect(result.snappedMs).toBe(4980);
    expect(result.targets).toEqual([]);
  });

  it('picks the closest target when multiple are within threshold', () => {
    const result = computeSnap({
      candidateMs: 3020,
      playheadMs: 3010,
      overlays,
      excludeOverlayId: 'a',
      pxPerMs: 0.1,
      thresholdPx: 8,
      enabled: true,
    });
    expect(result.snappedMs).toBe(3010); // playhead 更近
  });
});

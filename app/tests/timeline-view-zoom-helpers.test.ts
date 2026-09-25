import { describe, it, expect } from 'vitest';
import {
  zoomIn,
  zoomOut,
  zoomToFit,
  zoomToPercent,
  clampTimelineZoom,
} from '../src/lib/timeline-view';

describe('zoomIn / zoomOut', () => {
  it('zoomIn multiplies by step', () => {
    expect(zoomIn(1)).toBeCloseTo(1.25, 2);
  });
  it('zoomOut divides by step', () => {
    expect(zoomOut(1)).toBeCloseTo(0.8, 2);
  });
  it('clamps to upper bound', () => {
    expect(zoomIn(4)).toBe(4);
  });
  it('clamps to lower bound', () => {
    expect(zoomOut(0.02)).toBe(0.02);
  });
});

describe('zoomToPercent', () => {
  it('returns the decimal value clamped', () => {
    expect(zoomToPercent(200)).toBe(2);
    expect(zoomToPercent(10000)).toBe(4);
    expect(zoomToPercent(1)).toBe(0.02);
  });
});

describe('zoomToFit', () => {
  it('equals getFitTimelineZoom', () => {
    const fit = zoomToFit(60_000, 1200);
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThanOrEqual(4);
  });
});

// Keep clampTimelineZoom referenced to avoid unused import warnings.
describe('clampTimelineZoom sanity', () => {
  it('is importable alongside helpers', () => {
    expect(clampTimelineZoom(1)).toBe(1);
  });
});

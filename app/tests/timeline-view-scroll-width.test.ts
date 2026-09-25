import { describe, it, expect } from 'vitest';
import {
  getTimelineVisualEndMs,
  getTimelineContentWidthPx,
} from '../src/lib/timeline-view';
import type { TimelineData } from '../src/types';
import { createDefaultTimeline } from '../src/types';

function makeTimeline(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    ...createDefaultTimeline(),
    ...overrides,
  };
}

describe('getTimelineVisualEndMs', () => {
  it('returns last overlay end when overlays exist', () => {
    const timeline = makeTimeline({
      overlays: [
        {
          id: 'a', type: 'image', assetPath: '', trackId: 'visual-1',
          startMs: 2000, durationMs: 3000,
          position: { x: 0, y: 0, width: 100, height: 100 },
        },
      ],
    });
    expect(getTimelineVisualEndMs(timeline)).toBe(5000);
  });

  it('falls back to podcast durationMs when no overlays', () => {
    const timeline = makeTimeline({
      podcast: { audioPath: '', srtPath: '', durationMs: 60_000 },
    });
    expect(getTimelineVisualEndMs(timeline)).toBe(60_000);
  });

  it('returns max of overlay end and podcast duration', () => {
    const timeline = makeTimeline({
      podcast: { audioPath: '', srtPath: '', durationMs: 60_000 },
      overlays: [
        {
          id: 'a', type: 'image', assetPath: '', trackId: 'visual-1',
          startMs: 50_000, durationMs: 20_000,
          position: { x: 0, y: 0, width: 100, height: 100 },
        },
      ],
    });
    expect(getTimelineVisualEndMs(timeline)).toBe(70_000);
  });
});

describe('getTimelineContentWidthPx', () => {
  it('adds one viewport of trailing padding to the scroll width', () => {
    const timeline = makeTimeline({
      podcast: { audioPath: '', srtPath: '', durationMs: 10_000 },
    });
    const viewportWidth = 800;
    const zoomLevel = 1;
    const width = getTimelineContentWidthPx(timeline, zoomLevel, viewportWidth);

    // base = getBaseTimelineWidth(10_000) * 1; plus viewport
    // base ceil(max(1000,10000)/1000) * 96 = 10 * 96 = 960 (< MIN 960, stays 960)
    // Actually MIN_TIMELINE_TRACK_WIDTH = 960, so base = 960
    expect(width).toBe(960 + viewportWidth);
  });

  it('never returns less than viewport width', () => {
    const timeline = makeTimeline({
      podcast: { audioPath: '', srtPath: '', durationMs: 0 },
    });
    const width = getTimelineContentWidthPx(timeline, 0.02, 600);
    expect(width).toBeGreaterThanOrEqual(600);
  });
});

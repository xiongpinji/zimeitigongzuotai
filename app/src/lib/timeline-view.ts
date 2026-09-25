import type { TimelineData } from '../types';

const BASE_TIMELINE_PX_PER_SECOND = 96;
const MIN_TIMELINE_TRACK_WIDTH = 960;
const MIN_TIMELINE_ZOOM = 0.02;
const MAX_TIMELINE_ZOOM = 4;
const TIMELINE_ZOOM_STEP = 1.25;
const CONTINUOUS_ZOOM_SENSITIVITY = 100;
const TIMELINE_WHEEL_LINE_HEIGHT = 16;
const TIMELINE_WHEEL_PAGE_HEIGHT = 800;
const MIN_CONTINUOUS_ZOOM_DELTA = 0.5;

type ZoomDirection = 'in' | 'out';
type TimelineWheelZoomMode = 'legacy' | 'pinch';

interface TimelineWheelGestureLike {
  metaKey: boolean;
  ctrlKey: boolean;
}

function roundZoom(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampTimelineZoom(zoomLevel: number): number {
  return roundZoom(Math.min(MAX_TIMELINE_ZOOM, Math.max(MIN_TIMELINE_ZOOM, zoomLevel)));
}

export function getBaseTimelineWidth(durationMs: number): number {
  return Math.max(
    MIN_TIMELINE_TRACK_WIDTH,
    Math.ceil(Math.max(1_000, durationMs) / 1_000) * BASE_TIMELINE_PX_PER_SECOND,
  );
}

export function getNextTimelineZoom(
  zoomLevel: number,
  direction: ZoomDirection,
): number {
  const nextZoom = direction === 'in' ? zoomLevel * TIMELINE_ZOOM_STEP : zoomLevel / TIMELINE_ZOOM_STEP;
  return clampTimelineZoom(nextZoom);
}

export function getWheelTimelineZoom(zoomLevel: number, deltaY: number): number {
  if (deltaY === 0) {
    return clampTimelineZoom(zoomLevel);
  }

  return getNextTimelineZoom(zoomLevel, deltaY < 0 ? 'in' : 'out');
}

export function getTimelineWheelZoomMode(
  event: TimelineWheelGestureLike,
): TimelineWheelZoomMode | null {
  if (event.ctrlKey) {
    return 'pinch';
  }

  if (event.metaKey) {
    return 'legacy';
  }

  return null;
}

export function normalizeTimelineWheelDelta(deltaY: number, deltaMode = 0): number {
  if (deltaMode === 1) {
    return deltaY * TIMELINE_WHEEL_LINE_HEIGHT;
  }

  if (deltaMode === 2) {
    return deltaY * TIMELINE_WHEEL_PAGE_HEIGHT;
  }

  return deltaY;
}

export function getContinuousTimelineZoom(
  zoomLevel: number,
  deltaY: number,
  deltaMode = 0,
  sensitivity = CONTINUOUS_ZOOM_SENSITIVITY,
): number {
  const normalizedDelta = normalizeTimelineWheelDelta(deltaY, deltaMode);
  if (Math.abs(normalizedDelta) < MIN_CONTINUOUS_ZOOM_DELTA) {
    return clampTimelineZoom(zoomLevel);
  }

  const nextZoom = zoomLevel * Math.exp(-normalizedDelta / Math.max(1, sensitivity));
  return clampTimelineZoom(nextZoom);
}

export function getFitTimelineZoom(durationMs: number, viewportWidth: number): number {
  const safeViewportWidth = Math.max(320, viewportWidth);
  return clampTimelineZoom(safeViewportWidth / getBaseTimelineWidth(durationMs));
}

export function getTimelineTrackWidth(
  durationMs: number,
  zoomLevel: number,
  viewportWidth: number,
): number {
  const safeViewportWidth = Math.max(320, viewportWidth);
  const zoomedWidth = Math.round(getBaseTimelineWidth(durationMs) * clampTimelineZoom(zoomLevel));
  return Math.max(safeViewportWidth, zoomedWidth);
}

interface AnchoredTimelineScrollLeftOptions {
  scrollLeft: number;
  pointerX: number;
  previousTrackWidth: number;
  nextTrackWidth: number;
}

export function getAnchoredTimelineScrollLeft({
  scrollLeft,
  pointerX,
  previousTrackWidth,
  nextTrackWidth,
}: AnchoredTimelineScrollLeftOptions): number {
  const safePreviousTrackWidth = Math.max(1, previousTrackWidth);
  const safeNextTrackWidth = Math.max(1, nextTrackWidth);
  const anchorRatio = (scrollLeft + pointerX) / safePreviousTrackWidth;
  return Math.max(0, anchorRatio * safeNextTrackWidth - pointerX);
}

/**
 * 把播放头滚动到可视轨道区水平居中位置时需要的 scrollLeft。
 *
 * 既用于"定位"按钮，也用于缩放：缩放时以缩放后的播放头偏移调用本函数，
 * 即可让竖条在每一步缩放中都保持水平居中，内容两侧等比例展开 / 收缩。
 */
export function getCenteredPlayheadScrollLeft(
  playheadPx: number,
  visibleTrackWidth: number,
): number {
  return Math.max(0, playheadPx - Math.max(1, visibleTrackWidth) / 2);
}

export function getTimelineVisualEndMs(timeline: TimelineData): number {
  const podcastEnd = timeline.podcast?.durationMs ?? 0;
  const overlayEnd = timeline.overlays.reduce((max, o) => {
    const end = o.startMs + o.durationMs;
    return end > max ? end : max;
  }, 0);
  return Math.max(podcastEnd, overlayEnd);
}

export function getTimelineContentWidthPx(
  timeline: TimelineData,
  zoomLevel: number,
  viewportWidth: number,
): number {
  const end = getTimelineVisualEndMs(timeline);
  const base = Math.round(getBaseTimelineWidth(end) * clampTimelineZoom(zoomLevel));
  const safeViewport = Math.max(320, viewportWidth);
  return Math.max(safeViewport, base + safeViewport);
}

export function zoomIn(zoomLevel: number): number {
  return getNextTimelineZoom(zoomLevel, 'in');
}

export function zoomOut(zoomLevel: number): number {
  return getNextTimelineZoom(zoomLevel, 'out');
}

export function zoomToFit(durationMs: number, viewportWidth: number): number {
  return getFitTimelineZoom(durationMs, viewportWidth);
}

export function zoomToPercent(percent: number): number {
  return clampTimelineZoom(percent / 100);
}

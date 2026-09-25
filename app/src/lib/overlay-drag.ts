import { clamp } from './utils';

export interface TrackDragZone {
  trackId: string;
  top: number;
  bottom: number;
}

interface OverlayMoveDraftArgs {
  startMs: number;
  startClientX: number;
  currentClientX: number;
  pxPerMs: number;
  projectDurationMs: number;
  overlayDurationMs: number;
  fallbackTrackId: string;
  clientY: number;
  trackZones: TrackDragZone[];
}

export function resolveTrackIdByClientY(
  clientY: number,
  trackZones: TrackDragZone[],
  fallbackTrackId: string,
): string {
  const matchedTrack = trackZones.find((trackZone) => {
    return clientY >= trackZone.top && clientY <= trackZone.bottom;
  });

  return matchedTrack?.trackId ?? fallbackTrackId;
}

export function getOverlayMoveDraft({
  startMs,
  startClientX,
  currentClientX,
  pxPerMs,
  projectDurationMs,
  overlayDurationMs,
  fallbackTrackId,
  clientY,
  trackZones,
}: OverlayMoveDraftArgs): {
  startMs: number;
  trackId: string;
} {
  const deltaMs = (currentClientX - startClientX) / pxPerMs;
  const nextStartMs = clamp(
    Math.round(startMs + deltaMs),
    0,
    Math.max(0, projectDurationMs - overlayDurationMs),
  );

  return {
    startMs: nextStartMs,
    trackId: resolveTrackIdByClientY(clientY, trackZones, fallbackTrackId),
  };
}

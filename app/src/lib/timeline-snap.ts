import type { OverlayItem } from '../types';
import { isOverlayTrackManaged } from './timeline-placement';

export type SnapTargetKind = 'playhead' | 'clip-edge';

export interface SnapTarget {
  ms: number;
  kind: SnapTargetKind;
}

export interface ComputeSnapArgs {
  candidateMs: number;
  playheadMs: number;
  overlays: OverlayItem[];
  excludeOverlayId?: string;
  pxPerMs: number;
  thresholdPx: number;
  enabled: boolean;
}

export interface ComputeSnapResult {
  snappedMs: number;
  targets: SnapTarget[];
}

export function computeSnap(args: ComputeSnapArgs): ComputeSnapResult {
  const {
    candidateMs,
    playheadMs,
    overlays,
    excludeOverlayId,
    pxPerMs,
    thresholdPx,
    enabled,
  } = args;

  if (!enabled) {
    return { snappedMs: candidateMs, targets: [] };
  }

  const thresholdMs = thresholdPx / Math.max(pxPerMs, 1e-6);

  const candidates: SnapTarget[] = [];

  // Playhead target
  if (Math.abs(candidateMs - playheadMs) <= thresholdMs) {
    candidates.push({ ms: playheadMs, kind: 'playhead' });
  }

  // Clip edge targets (both starts and ends), across all tracks
  for (const overlay of overlays) {
    if (overlay.id === excludeOverlayId) continue;
    if (!isOverlayTrackManaged(overlay)) continue;
    const start = overlay.startMs;
    const end = overlay.startMs + overlay.durationMs;
    if (Math.abs(candidateMs - start) <= thresholdMs) {
      candidates.push({ ms: start, kind: 'clip-edge' });
    }
    if (Math.abs(candidateMs - end) <= thresholdMs) {
      candidates.push({ ms: end, kind: 'clip-edge' });
    }
  }

  if (candidates.length === 0) {
    return { snappedMs: candidateMs, targets: [] };
  }

  // Pick closest
  candidates.sort(
    (a, b) => Math.abs(a.ms - candidateMs) - Math.abs(b.ms - candidateMs),
  );
  const chosen = candidates[0];
  const sameMsTargets = candidates.filter((t) => t.ms === chosen.ms);

  return { snappedMs: chosen.ms, targets: sameMsTargets };
}

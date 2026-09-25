import {
  DEFAULT_AUDIO_TRACK_ID,
  DEFAULT_SUBTITLE_TRACK_ID,
  DEFAULT_TIMELINE_VERSION,
  DEFAULT_VISUAL_TRACK_ID,
  createDefaultSubtitleStyle,
  createVisualTrack,
  createAudioOverlayTrack,
  sortOverlaysByStart,
  type OverlayItem,
  type TimelineData,
  type TimelineTrack,
} from '../types';
import { resolveOverlayMotion } from './overlay-motion';

function buildLockedTrack(
  id: string,
  label: string,
  kind: 'audio' | 'subtitle',
  existing?: TimelineTrack,
): TimelineTrack {
  // 默认 locked: true，但保留已有 track 的 locked 值（允许用户解锁）
  const locked = existing ? Boolean(existing.locked) : true;
  return {
    id,
    kind,
    label,
    order: 0,
    locked,
  };
}

function dedupeTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  const seen = new Set<string>();

  return tracks.filter((track) => {
    if (seen.has(track.id)) {
      return false;
    }

    seen.add(track.id);
    return true;
  });
}

export function getVisualTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  return tracks
    .filter((track) => track.kind === 'visual')
    .sort((left, right) => {
      if (left.order !== right.order) {
        return right.order - left.order;
      }

      return left.id.localeCompare(right.id);
    });
}

export function getRenderableVisualTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  return [...getVisualTracks(tracks)].reverse();
}

/**
 * 可承载音频 overlay 的轨道（排除口播主轨，保留额外的 audio 轨道）。
 * 按 order 升序：id 较小的排在前，显示在时间线下方。
 */
export function getAudioOverlayTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  return tracks
    .filter((track) => track.kind === 'audio' && track.id !== DEFAULT_AUDIO_TRACK_ID)
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }

      return left.id.localeCompare(right.id);
    });
}

export function getNextVisualTrack(tracks: TimelineTrack[]): TimelineTrack {
  const visualTracks = getVisualTracks(tracks);
  const nextOrder = (visualTracks[0]?.order ?? 0) + 1;
  const nextIndex =
    visualTracks.reduce((maxValue, track) => {
      const match = track.id.match(/visual-(\d+)/);
      const parsed = match ? Number.parseInt(match[1], 10) : 0;
      return Number.isFinite(parsed) ? Math.max(maxValue, parsed) : maxValue;
    }, 0) + 1;

  return createVisualTrack(nextIndex, nextOrder);
}

export function getNextAudioOverlayTrack(tracks: TimelineTrack[]): TimelineTrack {
  const audioTracks = getAudioOverlayTracks(tracks);
  const nextIndex =
    audioTracks.reduce((maxValue, track) => {
      const match = track.id.match(/audio-overlay-(\d+)/);
      const parsed = match ? Number.parseInt(match[1], 10) : 0;
      return Number.isFinite(parsed) ? Math.max(maxValue, parsed) : maxValue;
    }, 0) + 1;

  return createAudioOverlayTrack(nextIndex);
}

export function normalizeTimelineData(timeline: TimelineData): TimelineData {
  const rawTracks = Array.isArray(timeline.tracks) ? timeline.tracks : [];
  const rawOverlays = Array.isArray(timeline.overlays) ? timeline.overlays : [];
  const visualTracks = rawTracks.filter((track) => track.kind === 'visual');
  const normalizedVisualTracks =
    visualTracks.length > 0
      ? dedupeTracks(
          visualTracks.map((track, index) => ({
            ...track,
            kind: 'visual',
            label: track.label || `轨道 ${index + 1}`,
            order: Number.isFinite(track.order) ? track.order : index + 1,
          })),
        )
      : [createVisualTrack(1)];

  const audioOverlayTracks = dedupeTracks(
    rawTracks
      .filter((track) => track.kind === 'audio' && track.id !== DEFAULT_AUDIO_TRACK_ID)
      .map((track, index) => ({
        ...track,
        kind: 'audio' as const,
        label: track.label || `音轨 ${index + 1}`,
        order: Number.isFinite(track.order) ? track.order : index + 1,
      })),
  );

  const existingAudioTrack = rawTracks.find((t) => t.id === DEFAULT_AUDIO_TRACK_ID);
  const existingSubtitleTrack = rawTracks.find((t) => t.id === DEFAULT_SUBTITLE_TRACK_ID);
  const normalizedTracks = [
    buildLockedTrack(DEFAULT_AUDIO_TRACK_ID, '口播轨', 'audio', existingAudioTrack),
    buildLockedTrack(DEFAULT_SUBTITLE_TRACK_ID, '字幕轨', 'subtitle', existingSubtitleTrack),
    ...normalizedVisualTracks,
    ...audioOverlayTracks,
  ];
  const visualTrackIds = new Set(normalizedVisualTracks.map((track) => track.id));
  const audioOverlayTrackIds = new Set(audioOverlayTracks.map((track) => track.id));
  const fallbackVisualTrackId = normalizedVisualTracks[0]?.id ?? DEFAULT_VISUAL_TRACK_ID;
  const defaultSubtitleStyle = createDefaultSubtitleStyle();

  return {
    ...timeline,
    version: DEFAULT_TIMELINE_VERSION,
    tracks: normalizedTracks,
    subtitle: {
      ...defaultSubtitleStyle,
      ...timeline.subtitle,
    },
    subtitleHighlights: Array.isArray(timeline.subtitleHighlights) ? timeline.subtitleHighlights : [],
    overlays: sortOverlaysByStart(
      rawOverlays.map((overlay) => {
        if (overlay.type === 'audio') {
          const trackId = audioOverlayTrackIds.has(overlay.trackId)
            ? overlay.trackId
            : audioOverlayTracks[0]?.id ?? overlay.trackId;
          // 音频 overlay 不走 overlay motion（淡入淡出另行处理）
          return {
            ...overlay,
            trackId,
          };
        }

        return {
          ...overlay,
          motion: resolveOverlayMotion(overlay),
          trackId: visualTrackIds.has(overlay.trackId) ? overlay.trackId : fallbackVisualTrackId,
        };
      }),
    ),
  };
}

export function getRenderableOverlays(timeline: TimelineData): OverlayItem[] {
  const trackOrderMap = new Map(
    getRenderableVisualTracks(timeline.tracks).map((track) => [track.id, track.order]),
  );

  return [...timeline.overlays].sort((left, right) => {
    const leftIsBackground = left.overlayRole === 'default-background';
    const rightIsBackground = right.overlayRole === 'default-background';

    if (leftIsBackground !== rightIsBackground) {
      return leftIsBackground ? -1 : 1;
    }

    const leftOrder = trackOrderMap.get(left.trackId) ?? 0;
    const rightOrder = trackOrderMap.get(right.trackId) ?? 0;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    if (left.startMs !== right.startMs) {
      return left.startMs - right.startMs;
    }

    return left.id.localeCompare(right.id);
  });
}

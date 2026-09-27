/** Map one reviewed R4 plan to editable Lingji overlays; no media or filesystem I/O. */
import path from 'node:path';
import { createDefaultTextData } from '../../src/lib/text-templates';
import {
  createAudioOverlayTrack,
  createDefaultAudioOverlayData,
  createDefaultTimeline,
  createVisualTrack,
  type OverlayItem,
  type TimelineData,
} from '../../src/types';
import type {
  CompositionPlanSegmentV1,
  CompositionPlanV1,
  ProductionAspectRatio,
} from '../../src/types/production-contracts';
import type {
  ResolvedCompositionSegment,
  ResolvedCompositionSources,
} from './source-resolver';

export type CompositionTimelineErrorCode =
  | 'invalid_plan' | 'source_mismatch' | 'invalid_timecode' | 'unsupported_voiceover';

export class CompositionTimelineError extends Error {
  constructor(readonly code: CompositionTimelineErrorCode, message: string = code) {
    super(message);
    this.name = 'CompositionTimelineError';
  }
}

const DIMENSIONS: Record<ProductionAspectRatio, readonly [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:3': [1440, 1080],
  '3:4': [1080, 1440],
};

function fail(code: CompositionTimelineErrorCode, message?: string): never {
  throw new CompositionTimelineError(code, message);
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nonnegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function localAbsolutePath(value: unknown): value is string {
  return typeof value === 'string'
    && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
}

function checkedSegments(
  plan: CompositionPlanV1,
  sources: ResolvedCompositionSources,
): Array<{ planSegment: CompositionPlanSegmentV1; resolved: ResolvedCompositionSegment; durationMs: number }> {
  if (!plan || !plan.editorial || !Array.isArray(plan.segments) || plan.segments.length === 0
    || !plan.editorial.openingClaim?.trim() || !plan.editorial.endingMessage?.trim()) {
    fail('invalid_plan', 'composition plan requires editorial claims and segments');
  }
  if (!sources || sources.planId !== plan.id || !Array.isArray(sources.segments)
    || sources.segments.length !== plan.segments.length) {
    fail('source_mismatch', 'verified sources must match the plan');
  }
  const resolvedById = new Map(sources.segments.map((segment) => [segment.segmentId, segment]));
  const orders = new Set<number>();
  if (resolvedById.size !== sources.segments.length
    || new Set(plan.segments.map((segment) => segment.id)).size !== plan.segments.length) {
    fail('source_mismatch', 'duplicate segment IDs');
  }
  return plan.segments.slice().sort((left, right) => left.order - right.order).map((segment) => {
    const resolved = resolvedById.get(segment.id);
    if (!resolved || !segment.editorial || !Number.isSafeInteger(segment.order)
      || segment.order < 0 || orders.has(segment.order)
      || resolved.order !== segment.order || segment.source.kind !== 'highlight'
      || resolved.clip.highlightId !== segment.source.sourceId
      || resolved.clip.absoluteInMs !== segment.source.inMs
      || resolved.clip.absoluteOutMs !== segment.source.outMs
      || !localAbsolutePath(resolved.clip.path)) {
      fail('source_mismatch', `verified segment ${segment.id} differs from plan`);
    }
    orders.add(segment.order);
    const durationMs = resolved.clip.sourceOutMs - resolved.clip.sourceInMs;
    if (!positiveFinite(durationMs) || !nonnegativeFinite(resolved.clip.sourceInMs)
      || !positiveFinite(resolved.clip.outputDurationMs)
      || resolved.clip.sourceOutMs > resolved.clip.outputDurationMs
      || durationMs !== segment.source.outMs - segment.source.inMs) {
      fail('invalid_timecode', `reviewed segment ${segment.id} has invalid trim`);
    }
    const plannedLayer = segment.visualLayer;
    const layer = resolved.visualLayer;
    if (Boolean(plannedLayer) !== Boolean(layer)) {
      fail('source_mismatch', `visual layer for ${segment.id} differs from plan`);
    }
    if (plannedLayer && layer) {
      if (plannedLayer.assetId !== layer.assetId
        || plannedLayer.sourceInMs !== layer.sourceInMs
        || plannedLayer.startAtMs !== layer.startAtMs
        || plannedLayer.durationMs !== layer.durationMs
        || plannedLayer.purpose !== layer.purpose
        || !localAbsolutePath(layer.path)
        || (layer.mediaType !== 'video' && layer.mediaType !== 'image')) {
        fail('source_mismatch', `verified visual layer ${segment.id} differs from plan`);
      }
      if (!nonnegativeFinite(layer.startAtMs) || !nonnegativeFinite(layer.sourceInMs)
        || !positiveFinite(layer.durationMs) || layer.startAtMs + layer.durationMs > durationMs
        || (layer.mediaType === 'image' && layer.sourceInMs !== 0)) {
        fail('invalid_timecode', `visual layer ${segment.id} exceeds source segment`);
      }
    }
    return { planSegment: segment, resolved, durationMs };
  });
}

/**
 * The visual video renderer always mutes source media. Original sound is therefore a
 * separate overlay with the same start, duration, source path and source trim.
 */
export function buildCompositionTimeline(
  plan: CompositionPlanV1,
  sources: ResolvedCompositionSources,
): TimelineData {
  if (!plan || typeof plan !== 'object') fail('invalid_plan', 'composition plan is missing');
  if (plan.voiceoverKind !== 'original-audio') {
    fail('unsupported_voiceover', 'verified narration media is not available');
  }
  const dimensions = DIMENSIONS[plan.aspectRatio];
  if (!dimensions) fail('invalid_plan', 'unsupported aspect ratio');
  const segments = checkedSegments(plan, sources);
  const [width, height] = dimensions;
  const timeline = createDefaultTimeline();
  timeline.width = width;
  timeline.height = height;
  timeline.tracks.push(createVisualTrack(2), createVisualTrack(3), createAudioOverlayTrack(1));
  const fullFrame = { x: 0, y: 0, width, height };
  let startMs = 0;

  for (const { planSegment, resolved, durationMs } of segments) {
    const video: OverlayItem = {
      id: `${planSegment.id}-video`, type: 'video', assetPath: resolved.clip.path,
      trackId: 'visual-1', startMs, durationMs, position: { ...fullFrame },
      videoData: {
        trimStartMs: resolved.clip.sourceInMs,
        sourceDurationMs: resolved.clip.outputDurationMs,
      },
    };
    const audio: OverlayItem = {
      id: `${planSegment.id}-audio`, type: 'audio', assetPath: resolved.clip.path,
      trackId: 'audio-overlay-1', startMs, durationMs, position: { ...fullFrame },
      audioData: {
        ...createDefaultAudioOverlayData(resolved.clip.outputDurationMs),
        trimStartMs: resolved.clip.sourceInMs,
      },
    };
    timeline.overlays.push(video, audio);
    if (resolved.visualLayer) {
      const layer = resolved.visualLayer;
      timeline.overlays.push({
        id: `${planSegment.id}-broll`, type: layer.mediaType, assetPath: layer.path,
        trackId: 'visual-2', startMs: startMs + layer.startAtMs,
        durationMs: layer.durationMs, position: { ...fullFrame },
        ...(layer.mediaType === 'video' ? {
          videoData: {
            trimStartMs: layer.sourceInMs,
            // The resolver snapshot proves this consumed range, not the full asset duration.
            sourceDurationMs: layer.sourceInMs + layer.durationMs,
          },
        } : {}),
      });
    }
    startMs += durationMs;
  }

  const openingDurationMs = Math.min(2000, Math.max(1, Math.floor(startMs / 2)));
  const endingDurationMs = Math.min(2000, Math.max(1, startMs - openingDurationMs));
  timeline.overlays.push({
    id: `${plan.id}-opening`, type: 'text', assetPath: '', trackId: 'visual-3',
    startMs: 0, durationMs: openingDurationMs,
    position: {
      x: Math.round(width * 0.06), y: Math.round(height * 0.06),
      width: Math.round(width * 0.88), height: Math.round(height * 0.2),
    },
    textData: createDefaultTextData({ content: plan.editorial!.openingClaim }),
  }, {
    id: `${plan.id}-ending`, type: 'text', assetPath: '', trackId: 'visual-3',
    startMs: startMs - endingDurationMs, durationMs: endingDurationMs,
    position: {
      x: Math.round(width * 0.06), y: Math.round(height * 0.72),
      width: Math.round(width * 0.88), height: Math.round(height * 0.2),
    },
    textData: createDefaultTextData({ content: plan.editorial!.endingMessage }),
  });
  return timeline;
}

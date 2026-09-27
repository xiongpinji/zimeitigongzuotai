import { describe, expect, it } from 'vitest';
import { buildCompositionTimeline } from '../electron/composition/timeline-builder';
import type { ResolvedCompositionSources } from '../electron/composition/source-resolver';
import { getRenderableVisualTracks } from '../src/lib/timeline-tracks';
import { buildRenderPlan } from '../src/remotion/timeline-to-sequences';
import type { CompositionPlanV1 } from '../src/types/production-contracts';

const NOW = '2026-09-28T01:00:00.000Z';

function fixture(): { plan: CompositionPlanV1; sources: ResolvedCompositionSources } {
  const plan: CompositionPlanV1 = {
    id: 'plan-1', narrativeSummary: '演示和结论', voiceoverKind: 'original-audio',
    aspectRatio: '9:16',
    editorial: {
      targetAudience: '新用户', centralQuestion: '怎么用？',
      openingClaim: '先看演示', endingMessage: '记住使用限制',
    },
    segments: [
      {
        id: 'segment-1', order: 0, description: '展示操作',
        source: { kind: 'highlight', sourceId: 'highlight-1', inMs: 1500, outMs: 2500 },
        editorial: { narrativeRole: 'evidence', visualIntent: '操作', audioIntent: '保留原声' },
        visualLayer: { assetId: 'asset-1', sourceInMs: 100, startAtMs: 200,
          durationMs: 500, purpose: '展示实物细节' },
      },
      {
        id: 'segment-2', order: 1, description: '补充说明',
        source: { kind: 'highlight', sourceId: 'highlight-2', inMs: 3000, outMs: 3500 },
        editorial: { narrativeRole: 'conclusion', visualIntent: '说明', audioIntent: '保留原声' },
      },
    ],
    timelineRef: null, createdAt: NOW, updatedAt: NOW,
  };
  const sources: ResolvedCompositionSources = {
    planId: plan.id,
    context: { platform: 'douyin', region: 'cn', usedAt: NOW, commercialShortVideo: true },
    segments: [
      {
        segmentId: 'segment-1', order: 0,
        clip: {
          path: '/private/reviewed-1.mp4', receiptId: 'receipt-1', highlightId: 'highlight-1',
          recordingId: 'recording-1', sourceSha256: 'a'.repeat(64), outputSha256: 'b'.repeat(64),
          absoluteInMs: 1500, absoluteOutMs: 2500, sourceInMs: 300, sourceOutMs: 1300,
          outputDurationMs: 2000, reviewedAt: NOW,
        },
        visualLayer: {
          path: '/private/asset.mp4', assetId: 'asset-1', sha256: 'c'.repeat(64),
          mediaType: 'video', sourceInMs: 100, startAtMs: 200, durationMs: 500,
          purpose: '展示实物细节', evidenceRefs: ['grant-1'],
          grantValidFrom: null, grantValidUntil: null,
        },
      },
      {
        segmentId: 'segment-2', order: 1,
        clip: {
          path: '/private/reviewed-2.mp4', receiptId: 'receipt-2', highlightId: 'highlight-2',
          recordingId: 'recording-1', sourceSha256: 'a'.repeat(64), outputSha256: 'd'.repeat(64),
          absoluteInMs: 3000, absoluteOutMs: 3500, sourceInMs: 100, sourceOutMs: 600,
          outputDurationMs: 1000, reviewedAt: NOW,
        },
        visualLayer: null,
      },
    ],
  };
  return { plan, sources };
}

describe('R4 editable composition timeline', () => {
  it('aligns reviewed video and original audio trims and keeps B-roll visual-only above them', () => {
    const { plan, sources } = fixture();
    const beforePlan = structuredClone(plan);
    const beforeSources = structuredClone(sources);
    const timeline = buildCompositionTimeline(plan, sources);
    const firstVideo = timeline.overlays.find((overlay) => overlay.id === 'segment-1-video');
    const firstAudio = timeline.overlays.find((overlay) => overlay.id === 'segment-1-audio');
    const secondVideo = timeline.overlays.find((overlay) => overlay.id === 'segment-2-video');
    const secondAudio = timeline.overlays.find((overlay) => overlay.id === 'segment-2-audio');
    const broll = timeline.overlays.find((overlay) => overlay.id === 'segment-1-broll');

    expect(timeline).toMatchObject({ width: 1080, height: 1920, fps: 30 });
    expect(firstVideo).toMatchObject({
      type: 'video', assetPath: '/private/reviewed-1.mp4', trackId: 'visual-1',
      startMs: 0, durationMs: 1000,
      videoData: { trimStartMs: 300, sourceDurationMs: 2000 },
    });
    expect(firstAudio).toMatchObject({
      type: 'audio', assetPath: '/private/reviewed-1.mp4', trackId: 'audio-overlay-1',
      startMs: 0, durationMs: 1000,
      audioData: { trimStartMs: 300, sourceDurationMs: 2000, volume: 1 },
    });
    expect(secondVideo).toMatchObject({ startMs: 1000, durationMs: 500,
      videoData: { trimStartMs: 100 } });
    expect(secondAudio).toMatchObject({ startMs: 1000, durationMs: 500,
      audioData: { trimStartMs: 100 } });
    expect(broll).toMatchObject({ type: 'video', trackId: 'visual-2',
      startMs: 200, durationMs: 500, videoData: { trimStartMs: 100 } });
    expect(getRenderableVisualTracks(timeline.tracks).map((track) => track.id))
      .toEqual(['visual-1', 'visual-2', 'visual-3']);
    const renderPlan = buildRenderPlan(timeline, []);
    expect(renderPlan.audio).toHaveLength(2);
    expect(renderPlan.audio[0]).toMatchObject({ trimStartMs: 300, durationFrames: 30 });
    expect(renderPlan.visual.find((clip) => clip.id === 'segment-1-broll')!.zIndex)
      .toBeGreaterThan(renderPlan.visual.find((clip) => clip.id === 'segment-1-video')!.zIndex);
    expect(plan).toEqual(beforePlan);
    expect(sources).toEqual(beforeSources);
  });

  it('places editable opening and ending claims on the upper visual track', () => {
    const { plan, sources } = fixture();
    const timeline = buildCompositionTimeline(plan, sources);
    const opening = timeline.overlays.find((overlay) => overlay.id === 'plan-1-opening');
    const ending = timeline.overlays.find((overlay) => overlay.id === 'plan-1-ending');
    expect(opening).toMatchObject({ type: 'text', trackId: 'visual-3', startMs: 0,
      textData: { content: '先看演示' } });
    expect(ending).toMatchObject({ type: 'text', trackId: 'visual-3',
      textData: { content: '记住使用限制' } });
    expect((ending?.startMs ?? 0) + (ending?.durationMs ?? 0)).toBe(1500);
  });

  it('maps every supported aspect ratio to editor dimensions', () => {
    const expected = {
      '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080],
      '4:3': [1440, 1080], '3:4': [1080, 1440],
    } as const;
    for (const [ratio, [width, height]] of Object.entries(expected)) {
      const { plan, sources } = fixture();
      plan.aspectRatio = ratio as CompositionPlanV1['aspectRatio'];
      expect(buildCompositionTimeline(plan, sources)).toMatchObject({ width, height });
    }
  });

  it('rejects mismatched verified source data and B-roll outside a reviewed segment', () => {
    const { plan, sources } = fixture();
    sources.planId = 'other-plan';
    expect(() => buildCompositionTimeline(plan, sources)).toThrowError();
    sources.planId = plan.id;
    sources.segments[0].clip.absoluteInMs = 1400;
    expect(() => buildCompositionTimeline(plan, sources)).toThrowError();
    sources.segments[0].clip.absoluteInMs = 1500;
    sources.segments[0].visualLayer!.durationMs = 900;
    expect(() => buildCompositionTimeline(plan, sources)).toThrowError();
    sources.segments[0].visualLayer!.durationMs = 500;
    sources.segments[0].clip.path = 'https://untrusted.example/video.mp4';
    expect(() => buildCompositionTimeline(plan, sources)).toThrowError();
  });

  it('places an authorized image B-roll without video trim metadata', () => {
    const { plan, sources } = fixture();
    plan.segments[0].visualLayer!.sourceInMs = 0;
    sources.segments[0].visualLayer = {
      ...sources.segments[0].visualLayer!,
      path: '/private/asset.png', mediaType: 'image', sourceInMs: 0,
    };
    const overlay = buildCompositionTimeline(plan, sources).overlays
      .find((item) => item.id === 'segment-1-broll');
    expect(overlay).toMatchObject({ type: 'image', startMs: 200, durationMs: 500 });
    expect(overlay?.videoData).toBeUndefined();
  });

  it('does not invent missing narration or mixed audio', () => {
    const { plan, sources } = fixture();
    plan.voiceoverKind = 'narration';
    expect(() => buildCompositionTimeline(plan, sources))
      .toThrowError(expect.objectContaining({ code: 'unsupported_voiceover' }));
    plan.voiceoverKind = 'mixed';
    expect(() => buildCompositionTimeline(plan, sources))
      .toThrowError(expect.objectContaining({ code: 'unsupported_voiceover' }));
  });
});

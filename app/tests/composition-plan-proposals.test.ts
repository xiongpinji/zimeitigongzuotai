import { describe, expect, it } from 'vitest';
import type { ProductionDocumentV1 } from '../src/types/production-contracts';
import { createEmptyProductionDocument, parseProductionDocument } from '../src/lib/production-document';
import {
  proposePlans,
  CompositionProposalError,
  type CompositionDraft,
  type CompositionProposalBrief,
} from '../electron/composition/plan-proposals';

const NOW = '2026-09-28T03:00:00.000Z';
const SHA = 'b'.repeat(64);

function sourceDocument(): ProductionDocumentV1 {
  const doc = createEmptyProductionDocument('project-1', { nowIso: NOW });
  doc.recordings.push({
    id: 'recording-1', sourceRef: 'private-recording-path.mp4', sourceSha256: SHA,
    capturedAt: null, durationMs: 90_000, mimeType: 'video/mp4',
    transcriptRef: 'private-transcript.srt', importedAt: NOW,
  });
  for (let i = 0; i < 3; i++) {
    doc.highlights.push({
      id: `highlight-${i + 1}`, recordingId: 'recording-1',
      startMs: i * 20_000, endMs: i * 20_000 + 10_000,
      score: null, topic: `private-topic-${i}`, context: 'private-context', evidence: [],
      boundaryOrigin: 'auto', adjustedAt: null, createdAt: NOW,
    });
  }
  doc.assets.push({
    id: 'asset-1', sha256: SHA, mediaType: 'video', durationMs: 15_000,
    tags: ['private-tag'], transcript: null, embeddingRef: null,
    source: 'private-asset-path', rightsHolder: 'private-rights-holder',
    license: 'proprietary', usageScope: '商业短视频',
    authorizedForAutoUse: true, importedAt: NOW,
  });
  doc.accounts.push({
    id: 'account-1', platform: 'douyin', displayName: 'private-account-name',
    owner: 'owner-1', status: 'active', sessionRef: 'private-session-ref',
    capabilitySnapshot: null, lastVerifiedAt: null, createdAt: NOW,
  });
  return doc;
}

function draft(index: number, sourceIds: string[]): CompositionDraft {
  return {
    narrativeSummary: `第 ${index} 版的叙事`, voiceoverKind: 'original-audio', aspectRatio: '9:16',
    editorial: {
      targetAudience: `受众 ${index}`,
      centralQuestion: `第 ${index} 版关注什么问题？`,
      openingClaim: `先观察第 ${index} 个现象`,
      endingMessage: `总结第 ${index} 个结论`,
    },
    segments: sourceIds.map((sourceId, segmentIndex) => ({
      description: `证据 ${segmentIndex + 1}`,
      source: {
        kind: 'highlight', sourceId,
        inMs: Number(sourceId.slice(-1)) * 20_000 - 20_000,
        outMs: Number(sourceId.slice(-1)) * 20_000 - 10_000,
      },
      editorial: {
        narrativeRole: segmentIndex === 0 ? 'hook' : 'evidence',
        visualIntent: `展示 ${sourceId} 的演示`,
        audioIntent: '保留原声',
      },
    })),
  };
}

function input(document = sourceDocument()) {
  return {
    document,
    approvedHighlights: [1, 2, 3].map((index) => ({
      id: `highlight-${index}`, anonymousTopic: `匿名主题 ${index}`,
      approvedTranscriptExcerpt: `匿名转写 ${index}`,
    })),
    approvedAssets: [{ id: 'asset-1', anonymousDescription: '自有产品细节镜头' }],
    aspectRatio: '9:16' as const,
    model: 'local-test-model', promptVersion: 'r4-proposal-v1', nowIso: NOW,
  };
}

describe('R4 composition plan proposal port', () => {
  it('requests three narrative drafts with only approved source descriptions and returns reviewable plans', async () => {
    const document = sourceDocument();
    let sentBrief: CompositionProposalBrief | undefined;
    const batch = await proposePlans(input(document), async (brief) => {
      sentBrief = brief;
      return [
        draft(1, ['highlight-1', 'highlight-2']),
        draft(2, ['highlight-2', 'highlight-3']),
        draft(3, ['highlight-3', 'highlight-1']),
      ];
    });

    expect(batch.reviewRequired).toBe(true);
    expect(batch.model).toBe('local-test-model');
    expect(batch.promptVersion).toBe('r4-proposal-v1');
    expect(batch.plans).toHaveLength(3);
    expect(new Set(batch.plans.map((plan) => plan.id)).size).toBe(3);
    expect(batch.plans.every((plan) => plan.timelineRef === null)).toBe(true);
    expect(parseProductionDocument({ ...document, compositionPlans: batch.plans }).compositionPlans)
      .toEqual(batch.plans);

    const serialized = JSON.stringify(sentBrief);
    for (const secret of [
      'private-recording-path', 'private-transcript.srt', 'private-topic',
      'private-context', 'private-asset-path', 'private-rights-holder',
      'private-account-name', 'private-session-ref', SHA,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(sentBrief?.highlights).toHaveLength(3);
    expect(sentBrief?.assets).toHaveLength(1);
  });

  it('rejects plans that only change cosmetic descriptions while keeping the same claim and evidence', async () => {
    const first = draft(1, ['highlight-1', 'highlight-2']);
    const cosmetic = draft(1, ['highlight-1', 'highlight-2']);
    cosmetic.narrativeSummary = '换封面和 BGM 的版本';
    cosmetic.segments[0].description = '换色调后的同一镜头';
    await expect(proposePlans(input(), async () => [
      first, cosmetic, draft(3, ['highlight-2', 'highlight-3']),
    ])).rejects.toMatchObject<CompositionProposalError>({ code: 'duplicate_plans' });
  });

  it('rejects a simple reorder or small trims of the same highlights for the same central question', async () => {
    const reordered = draft(1, ['highlight-2', 'highlight-1']);
    reordered.segments[0].source.inMs += 500;
    reordered.segments[0].source.outMs -= 500;
    await expect(proposePlans(input(), async () => [
      draft(1, ['highlight-1', 'highlight-2']),
      reordered,
      draft(3, ['highlight-2', 'highlight-3']),
    ])).rejects.toMatchObject<CompositionProposalError>({ code: 'duplicate_plans' });
  });

  it('stops when the model is unavailable or returns fewer than three plans', async () => {
    let calls = 0;
    await expect(proposePlans(input(), async () => {
      calls += 1;
      throw new Error('provider failed with private details');
    })).rejects.toMatchObject({ code: 'model_unavailable' });
    expect(calls).toBe(1);

    await expect(proposePlans(input(), async () => [
      draft(1, ['highlight-1']), draft(2, ['highlight-2']),
    ])).rejects.toMatchObject({ code: 'insufficient_plans' });
  });

  it('rejects blank claims, out-of-range timecodes and unapproved sources', async () => {
    const blank = draft(1, ['highlight-1']);
    blank.editorial.openingClaim = '  ';
    await expect(proposePlans(input(), async () => [
      blank, draft(2, ['highlight-2']), draft(3, ['highlight-3']),
    ])).rejects.toMatchObject({ code: 'invalid_model_output' });

    const outOfRange = draft(1, ['highlight-1']);
    outOfRange.segments[0].source.outMs = 15_000;
    await expect(proposePlans(input(), async () => [
      outOfRange, draft(2, ['highlight-2']), draft(3, ['highlight-3']),
    ])).rejects.toMatchObject({ code: 'invalid_model_output' });

    const restricted = input();
    restricted.approvedHighlights = restricted.approvedHighlights.slice(0, 2);
    await expect(proposePlans(restricted, async () => [
      draft(1, ['highlight-1']), draft(2, ['highlight-2']), draft(3, ['highlight-3']),
    ])).rejects.toMatchObject({ code: 'invalid_model_output' });
  });

  it('flags shared evidence for human review without claiming platform originality', async () => {
    const batch = await proposePlans(input(), async () => [
      draft(1, ['highlight-1', 'highlight-2']),
      draft(2, ['highlight-2', 'highlight-1']),
      draft(3, ['highlight-3']),
    ]);
    expect(batch.reviewRequired).toBe(true);
    expect(batch.reviewFlags).toContainEqual({
      planIds: [batch.plans[0].id, batch.plans[1].id],
      reason: 'same-source-evidence',
    });
  });

  it('validates trusted batch metadata before invoking the model', async () => {
    const bad = { ...input(), nowIso: 'not-a-time' };
    let calls = 0;
    await expect(proposePlans(bad, async () => {
      calls += 1;
      return [];
    })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toBe(0);
  });

  it('rejects malformed approved source cards before invoking the model', async () => {
    const bad = input();
    bad.approvedHighlights = [null] as unknown as typeof bad.approvedHighlights;
    let calls = 0;
    await expect(proposePlans(bad, async () => {
      calls += 1;
      return [];
    })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toBe(0);
  });

  it('does not let model output assign plan IDs, paths or timestamps', async () => {
    const injected = { ...draft(1, ['highlight-1']), id: '../outside-project' };
    await expect(proposePlans(input(), async () => [
      injected, draft(2, ['highlight-2']), draft(3, ['highlight-3']),
    ])).rejects.toMatchObject({ code: 'invalid_model_output' });
  });

  it('does not trust approved source lists after a generator mutates its brief', async () => {
    const restricted = input();
    restricted.approvedHighlights = restricted.approvedHighlights.slice(0, 2);
    await expect(proposePlans(restricted, async (brief) => {
      brief.highlights.push({
        id: 'highlight-3', startMs: 40_000, endMs: 50_000,
        anonymousTopic: 'unauthorized', approvedTranscriptExcerpt: null,
      });
      return [
        draft(1, ['highlight-1']), draft(2, ['highlight-2']), draft(3, ['highlight-3']),
      ];
    })).rejects.toMatchObject({ code: 'invalid_model_output' });
  });

  it('keeps batch metadata fixed even if the generator mutates the caller input', async () => {
    const request = input();
    const batch = await proposePlans(request, async () => {
      request.nowIso = '2040-01-01T00:00:00.000Z';
      return [
        draft(1, ['highlight-1']), draft(2, ['highlight-2']), draft(3, ['highlight-3']),
      ];
    });
    expect(batch.generatedAt).toBe(NOW);
    expect(batch.plans.every((plan) => plan.createdAt === NOW)).toBe(true);
  });

  it('requires a usable narrative summary and segment descriptions in every generated plan', async () => {
    const blank = draft(1, ['highlight-1']);
    blank.narrativeSummary = ' ';
    blank.segments[0].description = ' ';
    await expect(proposePlans(input(), async () => [
      blank, draft(2, ['highlight-2']), draft(3, ['highlight-3']),
    ])).rejects.toMatchObject({ code: 'invalid_model_output' });
  });
});

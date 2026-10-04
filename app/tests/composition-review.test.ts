import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProductionDocument } from '../src/lib/production-document';
import { createDefaultProjectData } from '../src/lib/project-persistence';
import { createDefaultTimeline } from '../src/types';
import type { CompositionPlanV1 } from '../src/types/production-contracts';
import { buildReviewedClipReceipt, expectedReviewedClipId } from '../electron/highlights/reviewed-clip-receipts';
import { persistCompositionVersions } from '../electron/composition/version-projects';
import { resolveCompositionSources, type CompositionSourceServices } from '../electron/composition/source-resolver';
import { createCompositionReview, probeCompositionMediaWithBinary, type HumanReviewDecision } from '../electron/composition/review';
import { createCompositionReviewSourceGate } from '../electron/composition/review-source-gate';
import type { CompositionRenderState } from '../electron/composition/render-batch';
import { resolveFfmpegPath } from '../electron/runtime-binaries';

const NOW = '2026-09-28T04:00:00.000Z';
const BATCH = 'review-batch';
const RECORDING = '00000000-0000-4000-8000-000000000001';
const HIGHLIGHT = `hlcv1-${'b'.repeat(64)}`;
const TASK = `hbatch_${'c'.repeat(64)}`;
const HASH = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
let root: string;
let projectDir: string;

async function setup() {
  const document = createEmptyProductionDocument('project-1', { nowIso: NOW });
  const recording = { id: RECORDING, sourceRef: 'private-live.mp4', sourceSha256: 'a'.repeat(64),
    capturedAt: null, durationMs: 60_000, mimeType: 'video/mp4', transcriptRef: null, importedAt: NOW };
  const highlight = { id: HIGHLIGHT, recordingId: RECORDING, startMs: 1000, endMs: 3500,
    score: null, topic: '演示', context: null, evidence: [] as [],
    boundaryOrigin: 'auto' as const, adjustedAt: null, createdAt: NOW };
  document.recordings.push(recording);
  document.highlights.push(highlight);
  const receiptBody = { schemaVersion: 1 as const, taskId: TASK, highlightId: HIGHLIGHT,
    recordingId: RECORDING, sourceSha256: recording.sourceSha256, startMs: 1200, endMs: 3200,
    reviewedBy: 'local-owner' as const, reviewedAt: NOW, renderedAt: NOW,
    outputSha256: 'd'.repeat(64), outputDurationMs: 2000 };
  const receipt = buildReviewedClipReceipt({ ...receiptBody, id: expectedReviewedClipId(receiptBody) });
  const sourceServices: CompositionSourceServices = {
    nowIso: () => NOW,
    controller: {
      list: () => [{ id: TASK, recording, sourceSha256: recording.sourceSha256,
        options: { maxClips: 2 }, state: 'completed' as const, attempt: 1,
        candidateIds: [], highlightIds: [HIGHLIGHT], lastErrorCode: null, createdAt: 1, updatedAt: 2 }],
      readArtifact: () => ({ taskId: TASK, attempt: 1, candidateIds: [], highlightIds: [HIGHLIGHT],
        highlights: [highlight], reviewRequired: true }),
    },
    exporter: { verifiedOutput: async () => ({ path: path.join(projectDir, 'reviewed.mp4'), receipt }) },
    library: { get: () => null, verifiedForUsage: async () => { throw new Error('no B-roll'); } },
  };
  const plans = [1, 2, 3].map((number): CompositionPlanV1 => ({
    id: `plan-${number}`,
    narrativeSummary: number === 3 ? '完全不同的情节和解读' : '同一场直播的精彩回答',
    voiceoverKind: 'original-audio', aspectRatio: '9:16',
    editorial: { targetAudience: '用户', centralQuestion: number === 3 ? '另一个问题' : '直播问题',
      openingClaim: number === 3 ? '另一种开场' : '相同开场',
      endingMessage: number === 3 ? '不同结论' : '相同结论' },
    segments: [{ id: `segment-${number}`, order: 0, description: number === 3 ? '独立叙事' : '重复回答',
      source: { kind: 'highlight', sourceId: HIGHLIGHT,
        inMs: number === 3 ? 2500 : 1500, outMs: number === 3 ? 3200 : 2500 },
      editorial: { narrativeRole: 'evidence', visualIntent: '演示', audioIntent: '保留原声' } }],
    timelineRef: null, createdAt: NOW, updatedAt: NOW,
  }));
  const versions = [];
  for (const plan of plans) {
    const sources = await resolveCompositionSources({ document, plan,
      clipSelections: [{ segmentId: plan.segments[0].id, receiptId: receipt.id }],
      context: { platform: 'douyin', region: 'cn', commercialShortVideo: true } }, sourceServices);
    const timeline = createDefaultTimeline();
    timeline.overlays.push({ id: `clip-${plan.id}`, type: 'video',
      assetPath: path.join(projectDir, 'reviewed.mp4'), trackId: 'visual-1', startMs: 0,
      durationMs: 1000, position: { x: 0, y: 0, width: 1080, height: 1920 },
      videoData: { trimStartMs: 300, sourceDurationMs: 2000 } });
    versions.push({ plan, timeline, sources });
  }
  const records = await persistCompositionVersions({ projectDir, batchId: BATCH, versions });
  const states = new Map<string, CompositionRenderState>();
  for (const record of records) {
    const output = Buffer.from(`synthetic encoded ${record.manifest.planId}`);
    const outputSha256 = HASH(output);
    const outputFile = `render-${outputSha256}.mp4`;
    await fs.writeFile(path.join(record.projectDir, outputFile), output);
    states.set(record.manifest.planId, {
      schemaVersion: 1, batchId: BATCH, planId: record.manifest.planId,
      state: 'completed', attemptId: 'attempt-1', inputFingerprint: 'e'.repeat(64),
      sourceIdentitySha256: 'f'.repeat(64), timelineSha256: 'a'.repeat(64),
      sources: record.manifest.sources, createdAt: NOW, updatedAt: NOW,
      errorCode: null, outputFile, outputSha256,
    });
  }
  const read = vi.fn(async ({ planId }: { planId: string }) => {
    const state = states.get(planId) ?? null;
    if (!state || !state.outputFile || !state.outputSha256) return state;
    const file = path.join(records.find((record) => record.manifest.planId === planId)!.projectDir, state.outputFile);
    if (HASH(await fs.readFile(file)) !== state.outputSha256) throw new Error('output_conflict');
    return state;
  });
  const mediaProbe = vi.fn(async (file: string) => {
    const planId = path.basename(path.dirname(file));
    return planId === 'plan-3'
      ? { visualHashes: ['ffffffffffffffff'], audioEnergy: [0.1, 0.8] }
      : { visualHashes: ['0000000000000000'], audioEnergy: planId === 'plan-1' ? [0.1, 0.8] : [0.8, 0.1] };
  });
  const sourceGate = vi.fn(async () => undefined);
  const service = createCompositionReview({ renderState: { read }, sourceGate,
    mediaProbe, nowIso: () => NOW });
  return { service, states, records, mediaProbe, sourceGate, document, sourceServices };
}

function decision(planId: string, reviewerId: string, evidenceSha256: string): Omit<HumanReviewDecision, 'submittedAt'> {
  return { planId, reviewerId, evidenceSha256,
    ratings: { independentClarity: 5, appeal: 5, boundaries: 5, audiovisual: 5, factual: 5 },
    vetoReasons: [] };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-composition-review-'));
  projectDir = path.join(root, 'project');
  await fs.mkdir(projectDir);
  await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(createDefaultProjectData()));
});
afterEach(async () => {
  if (!root.startsWith(path.join(os.tmpdir(), 'r4-composition-review-'))) throw new Error('unsafe fixture root');
  await fs.rm(root, { recursive: true, force: true });
});

describe('R4 composition similarity evidence and human review', () => {
  it('re-resolves current sources and rejects a withdrawn reviewed clip', async () => {
    const { document, sourceServices } = await setup();
    const gate = createCompositionReviewSourceGate({ getDocument: async () => document, sourceServices });
    const location = { projectDir, batchId: BATCH, planId: 'plan-1' };
    await expect(gate(location)).resolves.toBeUndefined();
    sourceServices.exporter.verifiedOutput = async () => { throw new Error('clip removed'); };
    await expect(gate(location)).rejects.toMatchObject({ code: 'clip_unavailable' });
  });

  it('flags near-duplicate picture and source even with changed audio, without claiming originality', async () => {
    const { service, mediaProbe } = await setup();
    const report = await service.analyze(projectDir, BATCH, ['plan-1', 'plan-2', 'plan-3']);
    expect(mediaProbe).toHaveBeenCalledTimes(3);
    expect(report.pairs).toHaveLength(3);
    expect(report.pairs[0]).toMatchObject({ planIds: ['plan-1', 'plan-2'],
      textSimilarity: 1, sourceOverlap: 1, visualSimilarity: 1 });
    expect(report.pairs[0].audioSimilarity).toBeLessThan(0.5);
    expect(report.pairs[0].flags).toEqual(expect.arrayContaining(['similar_text', 'same_source_ranges', 'similar_visuals']));
    expect(report.pairs[1].sourceOverlap).toBe(0);
    expect(report.reviewRequired).toBe(true);
    expect(report.platformOriginality).toBe('unverified');
    expect(JSON.stringify(report)).not.toContain(projectDir);
  });

  it('keeps two agreeing scores as review evidence, and a veto or low score needs resolution', async () => {
    const { service } = await setup();
    const report = await service.analyze(projectDir, BATCH, ['plan-1', 'plan-2', 'plan-3']);
    const one = await service.recordDecision(projectDir, BATCH, decision('plan-1', 'reviewer-a', report.evidenceSha256));
    expect(one).toMatchObject({ reviewStatus: 'awaiting_second_reviewer', reviewRequired: true });
    const two = await service.recordDecision(projectDir, BATCH, decision('plan-1', 'reviewer-b', report.evidenceSha256));
    expect(two).toMatchObject({ distinctReviewerIds: 2, reviewStatus: 'ratings_agree',
      reviewRequired: true, platformOriginality: 'unverified' });
    await expect(service.recordDecision(projectDir, BATCH, decision('plan-1', 'reviewer-b', report.evidenceSha256)))
      .rejects.toMatchObject({ code: 'duplicate_reviewer' });
    await service.recordDecision(projectDir, BATCH, decision('plan-2', 'reviewer-a', report.evidenceSha256));
    const veto = await service.recordDecision(projectDir, BATCH,
      { ...decision('plan-2', 'reviewer-b', report.evidenceSha256), vetoReasons: ['rights'] });
    expect(veto.reviewStatus).toBe('vetoed');
    await service.recordDecision(projectDir, BATCH, decision('plan-3', 'reviewer-a', report.evidenceSha256));
    const low = await service.recordDecision(projectDir, BATCH,
      { ...decision('plan-3', 'reviewer-b', report.evidenceSha256),
        ratings: { ...decision('plan-3', 'reviewer-b', report.evidenceSha256).ratings, factual: 2 } });
    expect(low.reviewStatus).toBe('needs_resolution');
  });

  it('rejects tampered outputs, changed evidence, invalid ratings and concurrent duplicate reviewers', async () => {
    const { service, states, records } = await setup();
    const report = await service.analyze(projectDir, BATCH, ['plan-1', 'plan-2', 'plan-3']);
    const invalid = decision('plan-1', 'reviewer-a', report.evidenceSha256);
    invalid.ratings.factual = 6;
    await expect(service.recordDecision(projectDir, BATCH, invalid)).rejects.toMatchObject({ code: 'invalid_decision' });
    const same = decision('plan-1', 'reviewer-a', report.evidenceSha256);
    const parallel = await Promise.allSettled([
      service.recordDecision(projectDir, BATCH, same), service.recordDecision(projectDir, BATCH, same),
    ]);
    expect(parallel.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(parallel.filter((item) => item.status === 'rejected')).toHaveLength(1);
    states.get('plan-1')!.outputSha256 = '0'.repeat(64);
    await expect(service.recordDecision(projectDir, BATCH, decision('plan-1', 'reviewer-b', report.evidenceSha256)))
      .rejects.toThrow('output_conflict');
    states.get('plan-1')!.outputSha256 = HASH(Buffer.from('synthetic encoded plan-1'));
    states.get('plan-3')!.outputSha256 = '0'.repeat(64);
    await expect(service.recordDecision(projectDir, BATCH, decision('plan-2', 'reviewer-b', report.evidenceSha256)))
      .rejects.toThrow('output_conflict');
    states.get('plan-3')!.outputSha256 = HASH(Buffer.from('synthetic encoded plan-3'));
    const file = path.join(records[0].projectDir, states.get('plan-1')!.outputFile!);
    await fs.writeFile(file, 'tampered');
    await expect(service.analyze(projectDir, BATCH, ['plan-1', 'plan-2', 'plan-3']))
      .rejects.toThrow('output_conflict');
    await fs.writeFile(file, 'synthetic encoded plan-1');
    const reportFile = path.join(projectDir, 'compositions', BATCH, 'review-report.json');
    const corrupt = JSON.parse(await fs.readFile(reportFile, 'utf8'));
    corrupt.pairs[0].sourceOverlap = 0;
    await fs.writeFile(reportFile, JSON.stringify(corrupt));
    await expect(service.recordDecision(projectDir, BATCH, decision('plan-2', 'reviewer-b', report.evidenceSha256)))
      .rejects.toMatchObject({ code: 'stale_evidence' });
  });

  it('stops analysis and existing report decisions when the current source gate rejects', async () => {
    const { service, sourceGate, mediaProbe } = await setup();
    const report = await service.analyze(projectDir, BATCH, ['plan-1', 'plan-2', 'plan-3']);
    sourceGate.mockRejectedValue(new Error('rights revoked'));
    await expect(service.analyze(projectDir, BATCH, ['plan-1', 'plan-2', 'plan-3']))
      .rejects.toThrow('rights revoked');
    expect(mediaProbe).toHaveBeenCalledTimes(3);
    await expect(service.recordDecision(projectDir, BATCH,
      decision('plan-1', 'reviewer-a', report.evidenceSha256)))
      .rejects.toThrow('rights revoked');
  });

  it('decodes actual synthetic picture and audio with the bundled FFmpeg', async () => {
    const binary = resolveFfmpegPath({ appPath: process.cwd(), resourcesPath: '',
      cwd: process.cwd(), moduleDir: __dirname });
    if (!binary || !existsSync(binary)) throw new Error('bundled FFmpeg missing');
    const output = path.join(root, 'synthetic-probe.mp4');
    await new Promise<void>((resolve, reject) => {
      const encoder = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'color=c=red:s=96x96:r=15:d=2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=2',
        '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', output], { windowsHide: true });
      encoder.on('error', reject);
      encoder.on('close', (code) => code === 0 ? resolve() : reject(new Error(`encoder exit ${code}`)));
    });
    const fingerprint = await probeCompositionMediaWithBinary(output, binary);
    expect(fingerprint.visualHashes.length).toBeGreaterThan(0);
    expect(fingerprint.audioEnergy.length).toBeGreaterThan(0);
    expect(fingerprint.visualHashes.every((hash) => /^[a-f0-9]{16}$/.test(hash))).toBe(true);
    expect(fingerprint.audioEnergy.every((energy) => energy >= 0 && energy <= 1)).toBe(true);
    const silentOutput = path.join(root, 'synthetic-video-only.mp4');
    await new Promise<void>((resolve, reject) => {
      const encoder = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'color=c=blue:s=96x96:r=15:d=2',
        '-c:v', 'mpeg4', '-an', silentOutput], { windowsHide: true });
      encoder.on('error', reject);
      encoder.on('close', (code) => code === 0 ? resolve() : reject(new Error(`encoder exit ${code}`)));
    });
    const silent = await probeCompositionMediaWithBinary(silentOutput, binary);
    expect(silent.visualHashes.length).toBeGreaterThan(0);
    expect(silent.audioEnergy).toEqual([]);
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProductionDocument } from '../src/lib/production-document';
import { createDefaultProjectData } from '../src/lib/project-persistence';
import { buildReviewedClipReceipt, expectedReviewedClipId } from '../electron/highlights/reviewed-clip-receipts';
import { createCompositionBatch } from '../electron/composition/create-batch';
import type { CompositionSourceServices } from '../electron/composition/source-resolver';
import { readCompositionVersion } from '../electron/composition/version-projects';

const NOW = '2026-10-05T00:00:00.000Z';
const RECORDING = '00000000-0000-4000-8000-000000000001';
const HIGHLIGHT = `hlcv1-${'b'.repeat(64)}`;
const TASK = `hbatch_${'c'.repeat(64)}`;
let root: string;
let projectDir: string;

function fixture() {
  const document = createEmptyProductionDocument('project-1', { nowIso: NOW });
  const recording = { id: RECORDING, sourceRef: 'private-live.mp4',
    sourceSha256: 'a'.repeat(64), capturedAt: null, durationMs: 60_000,
    mimeType: 'video/mp4', transcriptRef: null, importedAt: NOW };
  const highlight = { id: HIGHLIGHT, recordingId: RECORDING, startMs: 1000, endMs: 3500,
    score: null, topic: '匿名演示', context: null, evidence: [] as [],
    boundaryOrigin: 'auto' as const, adjustedAt: null, createdAt: NOW };
  document.recordings.push(recording); document.highlights.push(highlight);
  const body = { schemaVersion: 1 as const, taskId: TASK, highlightId: HIGHLIGHT,
    recordingId: RECORDING, sourceSha256: recording.sourceSha256, startMs: 1200, endMs: 3200,
    reviewedBy: 'local-owner' as const, reviewedAt: NOW, renderedAt: NOW,
    outputSha256: 'd'.repeat(64), outputDurationMs: 2000 };
  const receipt = buildReviewedClipReceipt({ ...body, id: expectedReviewedClipId(body) });
  const exporter = { verifiedOutput: vi.fn(async () => ({
    path: path.join(projectDir, 'reviewed.mp4'), receipt })) };
  const services: CompositionSourceServices = {
    nowIso: () => NOW,
    controller: { list: () => [{ id: TASK, recording, sourceSha256: recording.sourceSha256,
      options: { maxClips: 3 }, state: 'completed' as const, attempt: 1,
      candidateIds: [], highlightIds: [HIGHLIGHT], lastErrorCode: null,
      createdAt: 1, updatedAt: 2 }],
    readArtifact: () => ({ taskId: TASK, attempt: 1, candidateIds: [],
      highlightIds: [HIGHLIGHT], highlights: [highlight], reviewRequired: true }) },
    exporter,
    library: { get: () => null,
      verifiedForUsage: async () => { throw new Error('no authorized B-roll'); } },
  };
  const generate = vi.fn(async () => [1, 2, 3].map((number) => ({
    narrativeSummary: `不同的回答角度 ${number}`, voiceoverKind: 'original-audio',
    aspectRatio: '9:16', editorial: { targetAudience: '用户',
      centralQuestion: `独立问题 ${number}`, openingClaim: `开场论点 ${number}`,
      endingMessage: `独立结论 ${number}` },
    segments: [{ description: `证据片段 ${number}`,
      source: { kind: 'highlight', sourceId: HIGHLIGHT,
        inMs: 1300 + number * 100, outMs: 2100 + number * 100 },
      editorial: { narrativeRole: 'evidence', visualIntent: '保留画面', audioIntent: '保留原声' } }],
  })));
  const create = createCompositionBatch({ getDocument: async () => document,
    sourceServices: services, generate, model: 'offline-fake', promptVersion: 'test-v1',
    nowIso: () => NOW });
  const input = { projectDir, aspectRatio: '9:16' as const,
    context: { platform: 'douyin' as const, region: 'cn', commercialShortVideo: true },
    selectedReceipts: [{ receiptId: receipt.id, anonymousTopic: '匿名演示',
      approvedTranscriptExcerpt: null }], selectedAssets: [] };
  return { create, input, generate, exporter, document, services };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-create-batch-'));
  projectDir = path.join(root, 'project');
  await fs.mkdir(projectDir);
  await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(createDefaultProjectData()));
});
afterEach(async () => {
  if (!root.startsWith(path.join(os.tmpdir(), 'r4-create-batch-'))) throw new Error('unsafe fixture root');
  await fs.rm(root, { recursive: true, force: true });
});

describe('R4 controlled composition creation', () => {
  it('creates three independent editable timelines from approved IDs and a bounded fake model', async () => {
    const fx = fixture();
    const original = await fs.readFile(path.join(projectDir, 'project.json'));
    const result = await fx.create(fx.input);
    expect(result.reviewRequired).toBe(true);
    expect(result.plans).toHaveLength(3);
    expect(result.reviewFlags).toHaveLength(3);
    expect(fx.generate).toHaveBeenCalledOnce();
    const brief = fx.generate.mock.calls[0][0];
    expect(JSON.stringify(brief)).not.toContain(projectDir);
    expect(JSON.stringify(brief)).not.toContain('private-live.mp4');
    for (const item of result.plans) {
      const version = await readCompositionVersion({ projectDir,
        batchId: result.batchId, planId: item.planId });
      expect(version.timelineModified).toBe(false);
      expect(version.project.timeline?.overlays.some((overlay) => overlay.type === 'video')).toBe(true);
      expect(version.project.timeline?.overlays.some((overlay) => overlay.type === 'audio')).toBe(true);
    }
    expect(await fs.readFile(path.join(projectDir, 'project.json'))).toEqual(original);
  });

  it('rejects source loss or an invalid AI response before writing any version', async () => {
    const fx = fixture();
    fx.exporter.verifiedOutput.mockRejectedValueOnce(new Error('source changed'));
    await expect(fx.create(fx.input)).rejects.toMatchObject({ code: 'source_unavailable' });
    expect(fx.generate).not.toHaveBeenCalled();
    const invalid = createCompositionBatch({ getDocument: async () => fx.document,
      sourceServices: fx.services,
      generate: async () => null, model: 'offline-fake', promptVersion: 'test-v1', nowIso: () => NOW });
    await expect(invalid(fx.input)).rejects.toMatchObject({ code: 'invalid_model_output' });
    await expect(fs.stat(path.join(projectDir, 'compositions'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not persist proposals when authorization expires during model generation', async () => {
    const fx = fixture();
    const beforePersist = vi.fn(() => { throw Object.assign(new Error('authorization_expired'),
      { code: 'authorization_expired' }); });
    const guarded = createCompositionBatch({ getDocument: async () => fx.document,
      sourceServices: fx.services, generate: fx.generate, model: 'offline-fake',
      promptVersion: 'test-v1', nowIso: () => NOW, beforePersist });
    await expect(guarded(fx.input)).rejects.toMatchObject({ code: 'authorization_expired' });
    expect(fx.generate).toHaveBeenCalledOnce();
    expect(beforePersist).toHaveBeenCalledOnce();
    await expect(fs.stat(path.join(projectDir, 'compositions'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

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
import { createCompositionRenderBatch } from '../electron/composition/render-batch';

const NOW = '2026-09-28T04:00:00.000Z';
const BATCH = 'batch-1';
const RECORDING = '00000000-0000-4000-8000-000000000001';
const HIGHLIGHT = `hlcv1-${'b'.repeat(64)}`;
const TASK = `hbatch_${'c'.repeat(64)}`;
const SOURCE_SHA = 'a'.repeat(64);
const context = { platform: 'douyin' as const, region: 'cn', commercialShortVideo: true };
const exportConfig = { resolution: '480p' as const, quality: 'speed' as const };
let root: string;
let projectDir: string;

function fixture() {
  const document = createEmptyProductionDocument('project-1', { nowIso: NOW });
  const recording = {
    id: RECORDING, sourceRef: 'private-live.mp4', sourceSha256: SOURCE_SHA,
    capturedAt: null, durationMs: 60_000, mimeType: 'video/mp4', transcriptRef: null, importedAt: NOW,
  };
  const highlight = {
    id: HIGHLIGHT, recordingId: RECORDING, startMs: 1000, endMs: 3500,
    score: null, topic: '演示', context: null, evidence: [] as [],
    boundaryOrigin: 'auto' as const, adjustedAt: null, createdAt: NOW,
  };
  document.recordings.push(recording);
  document.highlights.push(highlight);
  const receiptBody = {
    schemaVersion: 1 as const, taskId: TASK, highlightId: HIGHLIGHT, recordingId: RECORDING,
    sourceSha256: SOURCE_SHA, startMs: 1200, endMs: 3200,
    reviewedBy: 'local-owner' as const, reviewedAt: NOW, renderedAt: NOW,
    outputSha256: 'd'.repeat(64), outputDurationMs: 2000,
  };
  const receipt = buildReviewedClipReceipt({ ...receiptBody, id: expectedReviewedClipId(receiptBody) });
  const task = {
    id: TASK, recording, sourceSha256: SOURCE_SHA, options: { maxClips: 2 },
    state: 'completed' as const, attempt: 1, candidateIds: [], highlightIds: [HIGHLIGHT],
    lastErrorCode: null, createdAt: 1, updatedAt: 2,
  };
  const verifiedOutput = vi.fn(async () => ({ path: path.join(projectDir, 'reviewed.mp4'), receipt }));
  const sourceServices: CompositionSourceServices = {
    nowIso: () => NOW,
    controller: {
      list: () => [task],
      readArtifact: () => ({ taskId: TASK, attempt: 1, candidateIds: [], highlightIds: [HIGHLIGHT],
        highlights: [{ ...highlight }], reviewRequired: true }),
    },
    exporter: { verifiedOutput },
    library: {
      get: () => null,
      verifiedForUsage: async () => { throw new Error('no B-roll in fixture'); },
    },
  };
  const plans = [1, 2, 3].map((number): CompositionPlanV1 => ({
    id: `plan-${number}`, narrativeSummary: `版本 ${number}`, voiceoverKind: 'original-audio',
    aspectRatio: '9:16', editorial: {
      targetAudience: '用户', centralQuestion: `问题 ${number}`,
      openingClaim: `开场 ${number}`, endingMessage: `结尾 ${number}`,
    },
    segments: [{ id: `segment-${number}`, order: 0, description: '审核片段',
      source: { kind: 'highlight', sourceId: HIGHLIGHT, inMs: 1500, outMs: 2500 },
      editorial: { narrativeRole: 'evidence', visualIntent: '演示', audioIntent: '保留原声' } }],
    timelineRef: null, createdAt: NOW, updatedAt: NOW,
  }));
  return { document, plans, sourceServices, verifiedOutput, receipt };
}

async function setupVersions(fx: ReturnType<typeof fixture>) {
  const versions = [];
  for (const plan of fx.plans) {
    const sources = await resolveCompositionSources({ document: fx.document, plan,
      clipSelections: [{ segmentId: plan.segments[0].id, receiptId: fx.receipt.id }], context }, fx.sourceServices);
    const timeline = createDefaultTimeline();
    timeline.width = 1080;
    timeline.height = 1920;
    timeline.overlays.push({
      id: `clip-${plan.id}`, type: 'video', assetPath: path.join(projectDir, 'reviewed.mp4'),
      trackId: 'visual-1', startMs: 0, durationMs: 1000,
      position: { x: 0, y: 0, width: 1080, height: 1920 },
      videoData: { trimStartMs: 300, sourceDurationMs: 2000 },
    });
    versions.push({ plan, timeline, sources });
  }
  return persistCompositionVersions({ projectDir, batchId: BATCH, versions });
}

const input = () => ({ projectDir, batchId: BATCH, planIds: ['plan-1', 'plan-2', 'plan-3'], exportConfig, context });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-render-batch-'));
  projectDir = path.join(root, 'project');
  await fs.mkdir(projectDir);
  await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(createDefaultProjectData()));
});
afterEach(async () => {
  if (!root.startsWith(path.join(os.tmpdir(), 'r4-render-batch-'))) throw new Error('unsafe fixture root');
  await fs.rm(root, { recursive: true, force: true });
});

describe('R4 recoverable version render batch', () => {
  it('does not commit an Agent render when its grant is revoked during encoding', async () => {
    const fx = fixture();
    const records = await setupVersions(fx);
    let authorized = true;
    const render = vi.fn(async (args: { outputPath: string }) => {
      await fs.writeFile(args.outputPath, 'synthetic-frame');
      authorized = false;
    });
    const beforeCommit = () => {
      if (!authorized) throw Object.assign(new Error('authorization_expired'), { code: 'authorization_expired' });
    };
    const service = createCompositionRenderBatch({ getDocument: async () => fx.document,
      sourceServices: fx.sourceServices, render, nowIso: () => NOW });
    const done = await service.run({ ...input(), beforeCommit });
    expect(done.versions.every((version) => version.state === 'failed' &&
      version.errorCode === 'authorization_expired')).toBe(true);
    for (const record of records) {
      expect((await fs.readdir(record.projectDir)).some((name) => /^render-[a-f0-9]{64}\.mp4$/.test(name)))
        .toBe(false);
    }
  });

  it('rolls back the output and completed state if the render grant expires at commit', async () => {
    const fx = fixture();
    const [record] = await setupVersions(fx);
    let checks = 0;
    const service = createCompositionRenderBatch({ getDocument: async () => fx.document,
      sourceServices: fx.sourceServices,
      render: async (args) => { await fs.writeFile(args.outputPath, 'synthetic-frame'); },
      nowIso: () => NOW });
    const done = await service.run({ ...input(), planIds: ['plan-1'], beforeCommit: () => {
      checks += 1;
      if (checks === 5) throw Object.assign(new Error('authorization_expired'),
        { code: 'authorization_expired' });
    } });
    expect(checks).toBe(5);
    expect(done.versions).toMatchObject([{ state: 'failed', errorCode: 'authorization_expired',
      outputPath: null }]);
    expect((await service.read({ projectDir, batchId: BATCH, planId: 'plan-1' }))?.state).toBe('failed');
    expect((await fs.readdir(record.projectDir)).some((name) => /^render-[a-f0-9]{64}\.mp4$/.test(name)))
      .toBe(false);
  });

  it('renders three independent outputs with at most two active renders and isolates one failure', async () => {
    const fx = fixture();
    const records = await setupVersions(fx);
    const originalRoot = await fs.readFile(path.join(projectDir, 'project.json'));
    const originalProjects = await Promise.all(records.map((record) => fs.readFile(path.join(record.projectDir, 'project.json'))));
    let active = 0;
    let peak = 0;
    const render = vi.fn(async (args: { outputPath: string }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        if (args.outputPath.includes('plan-2')) throw new Error('synthetic encoder failure with private path');
        await fs.writeFile(args.outputPath, Buffer.from(path.basename(path.dirname(args.outputPath))));
      } finally { active -= 1; }
    });
    const service = createCompositionRenderBatch({ getDocument: async () => fx.document,
      sourceServices: fx.sourceServices, render, nowIso: () => NOW });
    const done = await service.run(input());
    expect(peak).toBe(2);
    expect(render).toHaveBeenCalledTimes(3);
    expect(done.versions.map((version) => version.state)).toEqual(['completed', 'failed', 'completed']);
    expect(done.versions.every((version) => version.reviewRequired)).toBe(true);
    expect(done.versions[1].errorCode).toBe('render_failed');
    expect(await fs.readFile(path.join(projectDir, 'project.json'))).toEqual(originalRoot);
    for (const [index, record] of records.entries()) {
      expect(await fs.readFile(path.join(record.projectDir, 'project.json'))).toEqual(originalProjects[index]);
      expect((await service.read({ projectDir, batchId: BATCH, planId: `plan-${index + 1}` }))?.state)
        .toBe(index === 1 ? 'failed' : 'completed');
    }
  });

  it('reuses verified completed outputs but refuses a changed source and tampered bytes', async () => {
    const fx = fixture();
    await setupVersions(fx);
    const render = vi.fn(async (args: { outputPath: string }) => fs.writeFile(args.outputPath, Buffer.from('synthetic video')));
    let clock = NOW;
    const deps = { getDocument: async () => fx.document, sourceServices: fx.sourceServices,
      render, nowIso: () => clock };
    const first = await createCompositionRenderBatch(deps).run(input());
    expect(first.versions.every((version) => version.state === 'completed')).toBe(true);
    clock = '2026-09-29T04:00:00.000Z';
    const second = await createCompositionRenderBatch(deps).run(input());
    expect(second.versions.every((version) => version.state === 'completed')).toBe(true);
    expect(render).toHaveBeenCalledTimes(3);
    fx.verifiedOutput.mockRejectedValue(new Error('private path changed'));
    const changed = await createCompositionRenderBatch(deps).run(input());
    expect(changed.versions.every((version) => version.state === 'failed' && version.errorCode === 'clip_unavailable')).toBe(true);
    expect(render).toHaveBeenCalledTimes(3);
    fx.verifiedOutput.mockResolvedValue({ path: path.join(projectDir, 'reviewed.mp4'),
      receipt: { ...fx.receipt, outputSha256: 'e'.repeat(64) } });
    const identityChanged = await createCompositionRenderBatch(deps).run(input());
    expect(identityChanged.versions.every((version) => version.state === 'failed' && version.errorCode === 'source_changed')).toBe(true);
    expect(render).toHaveBeenCalledTimes(3);
    fx.verifiedOutput.mockResolvedValue({ path: path.join(projectDir, 'reviewed.mp4'), receipt: fx.receipt });
    await fs.writeFile(first.versions[0].outputPath!, 'tampered');
    await expect(createCompositionRenderBatch(deps).read({ projectDir, batchId: BATCH, planId: 'plan-1' }))
      .rejects.toMatchObject({ code: 'output_conflict' });
    const tampered = await createCompositionRenderBatch(deps).run(input());
    expect(tampered.versions[0]).toMatchObject({ state: 'failed', errorCode: 'output_conflict' });
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('preserves interrupted rendering as unknown and does not blindly rerender', async () => {
    const fx = fixture();
    const records = await setupVersions(fx);
    const render = vi.fn(async (args: { outputPath: string }) => fs.writeFile(args.outputPath, 'synthetic video'));
    const deps = { getDocument: async () => fx.document, sourceServices: fx.sourceServices,
      render, nowIso: () => NOW };
    await createCompositionRenderBatch(deps).run(input());
    const file = path.join(records[0].projectDir, 'render-state.json');
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    state.state = 'rendering';
    state.outputFile = null;
    state.outputSha256 = null;
    await fs.writeFile(file, JSON.stringify(state));
    const fresh = createCompositionRenderBatch(deps);
    expect((await fresh.read({ projectDir, batchId: BATCH, planId: 'plan-1' }))?.state).toBe('unknown');
    const resumed = await fresh.run(input());
    expect(resumed.versions[0].state).toBe('unknown');
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('retries only a confirmed failure after explicit retryFailed', async () => {
    const fx = fixture();
    await setupVersions(fx);
    let failPlanTwo = true;
    const render = vi.fn(async (args: { outputPath: string }) => {
      if (args.outputPath.includes('plan-2') && failPlanTwo) throw new Error('synthetic failure');
      await fs.writeFile(args.outputPath, 'synthetic video');
    });
    const service = createCompositionRenderBatch({ getDocument: async () => fx.document,
      sourceServices: fx.sourceServices, render, nowIso: () => NOW });
    expect((await service.run(input())).versions[1].state).toBe('failed');
    failPlanTwo = false;
    expect((await service.run(input())).versions[1].state).toBe('failed');
    expect(render).toHaveBeenCalledTimes(3);
    expect((await service.run({ ...input(), retryFailed: true })).versions[1].state).toBe('completed');
    expect(render).toHaveBeenCalledTimes(4);
  });

  it('rejects a second owner and waits for in-flight render promises before cancellation settles', async () => {
    const fx = fixture();
    await setupVersions(fx);
    const gates: Array<() => void> = [];
    const render = vi.fn(async (args: { outputPath: string }) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      await fs.writeFile(args.outputPath, 'late synthetic output');
    });
    const deps = { getDocument: async () => fx.document, sourceServices: fx.sourceServices,
      render, nowIso: () => NOW };
    const service = createCompositionRenderBatch(deps);
    const running = service.run(input());
    for (let attempt = 0; attempt < 100 && gates.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(gates).toHaveLength(2);
    await expect(createCompositionRenderBatch(deps).run(input())).rejects.toMatchObject({ code: 'batch_busy' });
    let settled = false;
    const cancelling = service.cancel(projectDir, BATCH).then((value) => { settled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    gates.forEach((release) => release());
    expect(await cancelling).toBe(true);
    const done = await running;
    expect(done.versions.map((version) => version.state)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('refuses edited timelines and corrupt state files before an encoder is called', async () => {
    const fx = fixture();
    const records = await setupVersions(fx);
    const render = vi.fn(async (args: { outputPath: string }) => fs.writeFile(args.outputPath, 'synthetic'));
    const service = createCompositionRenderBatch({ getDocument: async () => fx.document,
      sourceServices: fx.sourceServices, render, nowIso: () => NOW });
    const projectPath = path.join(records[0].projectDir, 'project.json');
    const edited = JSON.parse(await fs.readFile(projectPath, 'utf8'));
    edited.timeline.width = 720;
    await fs.writeFile(projectPath, JSON.stringify(edited));
    await fs.writeFile(path.join(records[1].projectDir, 'render-state.json'), '{invalid');
    const done = await service.run(input());
    expect(done.versions[0]).toMatchObject({ state: 'failed', errorCode: 'review_required' });
    expect(done.versions[1]).toMatchObject({ state: 'failed', errorCode: 'corrupt_state' });
    expect(done.versions[2].state).toBe('completed');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('rechecks source authorization after a queue wait before starting the third encoder', async () => {
    const fx = fixture();
    await setupVersions(fx);
    const originalVerified = fx.sourceServices.exporter.verifiedOutput;
    let blocked = false;
    fx.sourceServices.exporter.verifiedOutput = async (receiptId) => {
      if (blocked) throw new Error('synthetic authorization expired');
      return originalVerified(receiptId);
    };
    const gates: Array<() => void> = [];
    const render = vi.fn(async (args: { outputPath: string }) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      await fs.writeFile(args.outputPath, 'synthetic video');
    });
    const service = createCompositionRenderBatch({ getDocument: async () => fx.document,
      sourceServices: fx.sourceServices, render, nowIso: () => NOW });
    const running = service.run(input());
    let queuedPlan: string | null = null;
    for (let attempt = 0; attempt < 100 && !queuedPlan; attempt += 1) {
      const states = await Promise.all(input().planIds.map(async (planId) => ({ planId,
        state: await service.read({ projectDir, batchId: BATCH, planId }) })));
      if (gates.length === 2) queuedPlan = states.find((item) => item.state?.state === 'queued')?.planId ?? null;
      if (!queuedPlan) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(queuedPlan).not.toBeNull();
    blocked = true;
    gates.forEach((release) => release());
    const done = await running;
    expect(done.versions.find((version) => version.planId === queuedPlan))
      .toMatchObject({ state: 'failed', errorCode: 'clip_unavailable' });
    expect(render).toHaveBeenCalledTimes(2);
  });
});

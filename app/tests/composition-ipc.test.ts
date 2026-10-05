import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProjectData } from '../src/lib/project-persistence';
import { COMPOSITION_V1_CHANNELS, registerCompositionIpc, type CompositionIpcOptions } from '../electron/composition/composition-ipc';

let root: string;
let projectDir: string;
const owner = { id: 'main-window' };

function setup() {
  let allowed = false;
  let renderAllowed = false;
  let activeProject = projectDir;
  const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>();
  const run = vi.fn(async () => ({ batchId: 'batch-1', versions: [
    { planId: 'plan-1', state: 'completed', reviewRequired: true,
      outputPath: 'C:\\private\\render.mp4', errorCode: null },
  ] }));
  const read = vi.fn(async () => null);
  const cancel = vi.fn(async () => true);
  const analyze = vi.fn(async () => ({ batchId: 'batch-1', evidenceSha256: 'a'.repeat(64),
    reviewRequired: true, platformOriginality: 'unverified' }));
  const recordDecision = vi.fn(async () => ({ planId: 'plan-1', reviewRequired: true,
    platformOriginality: 'unverified' }));
  const resources = vi.fn(async () => ({ receipts: [], assets: [] }));
  const createBatch = vi.fn(async () => ({ batchId: 'batch-1', plans: [],
    reviewFlags: [], reviewRequired: true }));
  const recommend = vi.fn(async () => ({ status: 'ok', recommendations: [
    { assetId: `asset_${'a'.repeat(64)}`, similarity: 0.9, reasons: ['content'] },
  ] }));
  const bridge = registerCompositionIpc({
    ipc: { handle: (channel, handler) => { handlers.set(channel, handler as typeof handlers extends Map<string, infer H> ? H : never); } },
    allowedSender: (event) => event === owner,
    activeProjectDir: () => activeProject,
    authorizeAgentBuild: () => allowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' },
    authorizeAgentRender: () => renderAllowed ? { allowed: true } : { allowed: false, reason: 'grant_missing' },
    renderBatch: { run, read, cancel },
    review: { analyze, recordDecision },
    resources, createBatch, recommend,
  } as unknown as CompositionIpcOptions);
  const call = (channel: string, input?: unknown, event: unknown = owner) => handlers.get(channel)!(event, input);
  return { call, run, read, cancel, analyze, recordDecision, resources, createBatch, recommend,
    handlers, bridge, setAllowed: (value: boolean) => { allowed = value; },
    setRenderAllowed: (value: boolean) => { renderAllowed = value; },
    setProject: (value: string) => { activeProject = value; } };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-composition-ipc-'));
  projectDir = path.join(root, 'project');
  await fs.mkdir(projectDir);
  await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(createDefaultProjectData()));
});
afterEach(async () => {
  if (!root.startsWith(path.join(os.tmpdir(), 'r4-composition-ipc-'))) throw new Error('unsafe fixture root');
  await fs.rm(root, { recursive: true, force: true });
});

describe('R4 owner-window composition IPC', () => {
  it('returns a render job before encoding finishes and exposes only safe polled state', async () => {
    const fx = setup();
    fx.setRenderAllowed(true);
    const selection = { batchId: 'batch-1', planIds: ['plan-1', 'plan-2', 'plan-3'],
      platform: 'douyin', region: 'cn', commercialShortVideo: false,
      resolution: '480p', quality: 'speed', approvedForRender: true };
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    fx.run.mockImplementationOnce(async () => {
      await held;
      return { batchId: 'batch-1', versions: selection.planIds.map((planId) => ({
        planId, state: 'completed', reviewRequired: true, outputPath: 'C:\\private\\render.mp4',
        errorCode: null,
      })) };
    });
    fx.read.mockImplementation(async (location) => ({
      planId: location.planId, state: 'rendering', errorCode: null,
      sources: { segments: [{ clip: { path: 'C:\\private\\source.mp4' } }] },
    }));
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentRender, selection))
      .toEqual({ ok: true, prepared: true });
    const pending = fx.bridge.render();
    const started = await Promise.race([pending,
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 100))]);
    release();
    expect(started).toEqual({ ok: true, batchId: 'batch-1', planIds: selection.planIds,
      status: 'running' });
    const status = await fx.bridge.renderStatus('batch-1', selection.planIds);
    expect(status).toMatchObject({ ok: true, batchId: 'batch-1',
      versions: expect.arrayContaining([
        expect.objectContaining({ planId: 'plan-1', state: 'rendering', reviewRequired: true }),
      ]) });
    expect(JSON.stringify(status)).not.toContain('private');
  });

  it('renders only a one-shot desktop selection under the current project and render grant', async () => {
    const fx = setup();
    const selection = { batchId: 'batch-1', planIds: ['plan-1', 'plan-2', 'plan-3'],
      platform: 'douyin', region: 'cn', commercialShortVideo: true,
      resolution: '480p', quality: 'speed', approvedForRender: true };
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentRender, selection))
      .toEqual({ ok: false, code: 'authorization_expired' });
    fx.setRenderAllowed(true);
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentRender,
      { ...selection, approvedForRender: false }))
      .toEqual({ ok: false, code: 'invalid_input' });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentRender, selection))
      .toEqual({ ok: true, prepared: true });
    fx.setProject(path.join(root, 'other-project'));
    expect(await fx.bridge.render()).toEqual({ ok: false, code: 'authorization_expired' });
    expect(fx.run).not.toHaveBeenCalled();
    fx.setProject(projectDir);
    expect(await fx.bridge.render()).toEqual({ ok: false, code: 'not_prepared' });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentRender, selection))
      .toEqual({ ok: true, prepared: true });
    const started = await fx.bridge.render();
    expect(started).toEqual({ ok: true, batchId: 'batch-1', planIds: selection.planIds,
      status: 'running' });
    expect(JSON.stringify(started)).not.toContain('private');
    expect(fx.run).toHaveBeenCalledWith(expect.objectContaining({
      projectDir, batchId: 'batch-1', planIds: selection.planIds,
      beforeCommit: expect.any(Function),
    }));
    await vi.waitFor(async () => expect(await fx.bridge.renderStatus('batch-1', selection.planIds))
      .toMatchObject({ ok: true, jobStatus: 'settled' }));
    expect(await fx.bridge.render()).toEqual({ ok: false, code: 'not_prepared' });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentRender, selection))
      .toEqual({ ok: true, prepared: true });
    fx.run.mockImplementationOnce(async (input) => {
      fx.setRenderAllowed(false);
      input.beforeCommit();
      return { batchId: 'batch-1', versions: [] };
    });
    expect(await fx.bridge.render()).toMatchObject({ ok: true, status: 'running' });
    await vi.waitFor(async () => expect(await fx.bridge.renderStatus('batch-1', selection.planIds))
      .toEqual({ ok: false, code: 'authorization_expired' }));
    fx.setRenderAllowed(true);
    await vi.waitFor(async () => expect(await fx.bridge.renderStatus('batch-1', selection.planIds))
      .toMatchObject({ ok: true, jobStatus: 'failed', errorCode: 'authorization_expired' }));
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentRender, selection))
      .toEqual({ ok: true, prepared: true });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    fx.run.mockImplementationOnce(async (input) => {
      await held;
      input.beforeCommit();
      return { batchId: 'batch-1', versions: [] };
    });
    const pending = await fx.bridge.render();
    expect(pending).toMatchObject({ ok: true, status: 'running' });
    expect(await fx.bridge.render()).toEqual({ ok: false, code: 'batch_busy' });
    fx.bridge.clear();
    expect(fx.cancel).toHaveBeenCalledWith(projectDir, 'batch-1');
    release();
    await vi.waitFor(() => expect(fx.run).toHaveBeenCalled());
  });

  it('rejects every operation from another frame before calling services', async () => {
    const fx = setup();
    for (const channel of Object.values(COMPOSITION_V1_CHANNELS)) {
      expect(await fx.call(channel, {}, { id: 'other-frame' })).toEqual({ ok: false, code: 'forbidden' });
    }
    expect(fx.run).not.toHaveBeenCalled();
    expect(fx.analyze).not.toHaveBeenCalled();
  });

  it('lists an empty project and rejects forged paths, IDs and unsafe render parameters', async () => {
    const fx = setup();
    expect(await fx.call(COMPOSITION_V1_CHANNELS.list)).toEqual({ ok: true, batches: [] });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.open,
      { batchId: '../outside', planId: 'plan-1', projectDir: root }))
      .toEqual({ ok: false, code: 'invalid_input' });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.render,
      { batchId: 'batch-1', planIds: ['plan-1', 'plan-1', 'plan-2'],
        platform: 'douyin', region: 'cn', commercialShortVideo: false,
        resolution: '480p', quality: 'speed', outputPath: 'C:\\outside.mp4' }))
      .toEqual({ ok: false, code: 'invalid_input' });
    expect(fx.run).not.toHaveBeenCalled();
  });

  it('passes only the active project and IDs to services and strips output paths', async () => {
    const fx = setup();
    const input = { batchId: 'batch-1', planIds: ['plan-1', 'plan-2', 'plan-3'],
      platform: 'douyin', region: 'cn', commercialShortVideo: true,
      resolution: '480p', quality: 'speed', projectDir: 'C:\\forged',
      outputPath: 'C:\\forged\\out.mp4' };
    const result = await fx.call(COMPOSITION_V1_CHANNELS.render, input);
    expect(fx.run).toHaveBeenCalledWith(expect.objectContaining({
      projectDir, batchId: 'batch-1', planIds: input.planIds,
    }));
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('forged');
    expect(result).toMatchObject({ ok: true, versions: [
      { planId: 'plan-1', state: 'completed', reviewRequired: true },
    ] });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.analyze,
      { batchId: 'batch-1', planIds: input.planIds })).toMatchObject({ ok: true });
    expect(fx.analyze).toHaveBeenCalledWith(projectDir, 'batch-1', input.planIds);
    expect(await fx.call(COMPOSITION_V1_CHANNELS.cancel, { batchId: 'batch-1' }))
      .toEqual({ ok: true, cancelled: true });
    expect(fx.cancel).toHaveBeenCalledWith(projectDir, 'batch-1');
    expect(await fx.call(COMPOSITION_V1_CHANNELS.resources)).toEqual({ ok: true, receipts: [], assets: [] });
    expect(fx.resources).toHaveBeenCalledWith(projectDir);
    expect(await fx.call(COMPOSITION_V1_CHANNELS.create, {
      aspectRatio: '9:16', platform: 'douyin', region: 'cn', commercialShortVideo: false,
      selectedReceipts: [{ receiptId: `hclip_${'a'.repeat(64)}`, anonymousTopic: '匿名主题',
        approvedTranscriptExcerpt: null }], selectedAssets: [], projectDir: 'C:\\forged',
    })).toMatchObject({ ok: true, batchId: 'batch-1' });
    expect(fx.createBatch).toHaveBeenCalledWith(expect.objectContaining({ projectDir }));
    expect(await fx.call(COMPOSITION_V1_CHANNELS.recommend, { query: '匿名主题',
      platform: 'douyin', region: 'cn', commercialShortVideo: false,
      mediaRef: 'C:\\forged\\private.mp4' })).toMatchObject({ ok: true, status: 'ok' });
    expect(fx.recommend).toHaveBeenCalledWith('匿名主题', {
      platform: 'douyin', region: 'cn', commercialShortVideo: false,
    });
  });

  it('prepares reviewed inputs for one Agent call and rechecks project and grant', async () => {
    const fx = setup();
    const receiptId = `hclip_${'a'.repeat(64)}`;
    const assetId = `asset_${'b'.repeat(64)}`;
    const input = { aspectRatio: '9:16', platform: 'douyin', region: 'cn',
      commercialShortVideo: false, approvedForModel: true,
      selectedReceipts: [{ receiptId, anonymousTopic: '匿名主题', approvedTranscriptExcerpt: null }],
      selectedAssets: [{ assetId, anonymousDescription: '已授权画面' }] };
    fx.resources.mockResolvedValue({ receipts: [{ id: receiptId, highlightId: 'h',
      startMs: 0, endMs: 1000, topic: '匿名主题' }],
      assets: [{ id: assetId, description: '已授权画面', mediaType: 'video' }] });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentBuild, input))
      .toEqual({ ok: false, code: 'authorization_expired' });
    fx.setAllowed(true);
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentBuild,
      { ...input, approvedForModel: false })).toEqual({ ok: false, code: 'invalid_input' });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentBuild, input))
      .toEqual({ ok: true, prepared: true });
    fx.setProject(path.join(root, 'other-project'));
    expect(await fx.bridge.build()).toEqual({ ok: false, code: 'authorization_expired' });
    expect(fx.createBatch).not.toHaveBeenCalled();
    fx.setProject(projectDir);
    expect(await fx.bridge.build()).toEqual({ ok: false, code: 'not_prepared' });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentBuild, input))
      .toEqual({ ok: true, prepared: true });
    fx.createBatch.mockImplementationOnce(async (_input, beforePersist) => {
      fx.setAllowed(false);
      beforePersist?.();
      return { batchId: 'batch-1', plans: [], reviewFlags: [], reviewRequired: true };
    });
    expect(await fx.bridge.build()).toEqual({ ok: false, code: 'authorization_expired' });
    expect(await fx.bridge.build()).toEqual({ ok: false, code: 'not_prepared' });
  });

  it('consumes one prepared build, refuses concurrent triggers and honors revocation during generation', async () => {
    const fx = setup();
    const receiptId = `hclip_${'a'.repeat(64)}`;
    fx.resources.mockResolvedValue({ receipts: [{ id: receiptId, highlightId: 'h',
      startMs: 0, endMs: 1000, topic: '匿名主题' }], assets: [] });
    fx.setAllowed(true);
    const input = { aspectRatio: '9:16', platform: 'douyin', region: 'cn',
      commercialShortVideo: false, approvedForModel: true,
      selectedReceipts: [{ receiptId, anonymousTopic: '匿名主题', approvedTranscriptExcerpt: null }],
      selectedAssets: [] };
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentBuild, input))
      .toEqual({ ok: true, prepared: true });
    fx.createBatch.mockResolvedValueOnce({ batchId: 'batch-1',
      plans: ['plan-1', 'plan-2', 'plan-3'].map((planId) => ({ planId,
        narrativeSummary: planId, centralQuestion: planId, segmentCount: 1 })),
      reviewFlags: [], reviewRequired: true });
    expect(await fx.bridge.build()).toEqual({ ok: true, batchId: 'batch-1',
      planIds: ['plan-1', 'plan-2', 'plan-3'] });
    expect(await fx.bridge.build()).toEqual({ ok: false, code: 'not_prepared' });

    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentBuild, input))
      .toEqual({ ok: true, prepared: true });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    fx.createBatch.mockImplementationOnce(async (_input, beforePersist) => {
      await hold;
      beforePersist?.();
      return { batchId: 'late', plans: [], reviewFlags: [], reviewRequired: true };
    });
    const pending = fx.bridge.build();
    expect(await fx.bridge.build()).toEqual({ ok: false, code: 'batch_busy' });
    expect(await fx.call(COMPOSITION_V1_CHANNELS.prepareAgentBuild, input))
      .toEqual({ ok: false, code: 'batch_busy' });
    fx.bridge.clear();
    release();
    expect(await pending).toEqual({ ok: false, code: 'authorization_expired' });
    expect(await fx.bridge.build()).toEqual({ ok: false, code: 'not_prepared' });
  });
});

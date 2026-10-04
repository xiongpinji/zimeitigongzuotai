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
  registerCompositionIpc({
    ipc: { handle: (channel, handler) => { handlers.set(channel, handler as typeof handlers extends Map<string, infer H> ? H : never); } },
    allowedSender: (event) => event === owner,
    activeProjectDir: () => projectDir,
    renderBatch: { run, read, cancel },
    review: { analyze, recordDecision },
    resources, createBatch, recommend,
  } as unknown as CompositionIpcOptions);
  const call = (channel: string, input?: unknown, event: unknown = owner) => handlers.get(channel)!(event, input);
  return { call, run, read, cancel, analyze, recordDecision, resources, createBatch, recommend, handlers };
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
});

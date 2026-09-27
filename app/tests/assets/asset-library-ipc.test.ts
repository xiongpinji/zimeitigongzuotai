import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAssetLibrary, type AssetImportMetadata } from '../../electron/assets/local-asset-library';
import { OllamaAssetIndex } from '../../electron/assets/ollama-asset-index';
import { ASSET_LIBRARY_CHANNELS, registerAssetLibraryIpc } from '../../electron/assets/asset-library-ipc';

const dirs: string[] = [];
const writers: LocalAssetLibrary[] = [];
const metadata: AssetImportMetadata = {
  semanticText: '夜晚城市街道', tags: ['霓虹'], transcript: null,
  source: '自拍', rightsHolder: '用户', license: 'proprietary', usageScope: '商业短视频',
  authorizedForAutoUse: true,
  rightsGrant: {
    platforms: ['douyin'], regions: ['cn'], commercialShortVideoUse: 'allowed',
    validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
    evidence: [{ kind: 'written-approval', ref: 'evidence-001',
      collectedAt: '2026-09-01T00:00:00.000Z', note: null }],
  },
};
const context = {
  platform: 'douyin', region: 'cn', usedAt: '2026-09-27T12:00:00.000Z', commercialShortVideo: true,
} as const;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zmt-asset-ipc-'));
  dirs.push(dir);
  const source = join(dir, 'selected.png');
  writeFileSync(source, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
    'base64',
  ));
  const root = join(dir, 'userData', 'assets-v1');
  const library = new LocalAssetLibrary({ rootDir: root });
  writers.push(library);
  const index = new OllamaAssetIndex({ rootDir: root, fetcher: vi.fn(async (url: string) =>
    url.endsWith('/api/tags')
      ? Response.json({ models: [{ name: 'nomic-embed-text-v2-moe:latest', digest: 'digest-1' }] })
      : Response.json({ embeddings: [[1, 0]] })) });
  const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>();
  const pickFile = vi.fn(async () => ({ canceled: false, filePaths: [source] }));
  registerAssetLibraryIpc({
    ipc: { handle: (channel, handler) => { handlers.set(channel, handler); } },
    library, index, pickFile, allowedSender: (event) => event === 'owner',
  });
  const call = (channel: string, input?: unknown, event: unknown = 'owner') => handlers.get(channel)!(event, input);
  return { call, source, pickFile, root, index };
}

afterEach(() => {
  for (const writer of writers.splice(0)) writer.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('asset library desktop IPC', () => {
  it('does not misreport an unexpected runtime failure as bad user input', async () => {
    const { call, index } = setup();
    vi.spyOn(index, 'indexRecords').mockRejectedValueOnce(new Error('internal failure'));
    expect(await call(ASSET_LIBRARY_CHANNELS.index)).toEqual({ ok: false, code: 'internal_error' });
  });

  it('wires the owner-only bridge and the material workbench into the desktop source', () => {
    const main = readFileSync(resolve(__dirname, '../../electron/main.ts'), 'utf8');
    const preload = readFileSync(resolve(__dirname, '../../electron/preload.ts'), 'utf8');
    const app = readFileSync(resolve(__dirname, '../../src/App.tsx'), 'utf8');
    const tabs = readFileSync(resolve(__dirname, '../../src/components/WorkspaceTabs.tsx'), 'utf8');
    expect(main.indexOf('registerAssetLibraryIpc(')).toBeGreaterThan(main.indexOf("app.getPath('userData')"));
    expect(main.indexOf('registerAssetLibraryIpc(')).toBeLessThan(main.indexOf('createWindow();'));
    expect(preload).toContain("exposeInMainWorld('assetLibraryAPI'");
    expect(app).toContain('<AssetLibraryWorkbench');
    expect(tabs).toContain("key: 'assets'");
  });

  it('accepts only a system-selected file, returns no source path, and persists rights metadata', async () => {
    const { call, source, pickFile } = setup();
    expect(await call(ASSET_LIBRARY_CHANNELS.choose)).toEqual({ ok: true, label: 'selected.png' });
    const injected = await call(ASSET_LIBRARY_CHANNELS.import, { sourcePath: source, metadata });
    expect(injected).toMatchObject({ ok: false, code: 'invalid_request' });
    const imported = await call(ASSET_LIBRARY_CHANNELS.import, { metadata });
    expect(imported).toMatchObject({ ok: true, record: { semanticText: metadata.semanticText } });
    expect(JSON.stringify(imported)).not.toContain(source);
    expect(pickFile).toHaveBeenCalledTimes(1);
    const listed = await call(ASSET_LIBRARY_CHANNELS.list);
    expect(listed).toMatchObject({ ok: true, records: [{ source: '自拍', authorizedForAutoUse: true }] });
    expect(JSON.stringify(listed)).not.toContain(source);
  });

  it('forbids other windows before dialogs or writes and consumes a selection once', async () => {
    const { call, pickFile } = setup();
    expect(await call(ASSET_LIBRARY_CHANNELS.choose, undefined, 'other')).toEqual({ ok: false, code: 'forbidden' });
    expect(pickFile).not.toHaveBeenCalled();
    expect(await call(ASSET_LIBRARY_CHANNELS.import, { metadata })).toMatchObject({ ok: false, code: 'selection_required' });
    await call(ASSET_LIBRARY_CHANNELS.choose);
    expect(await call(ASSET_LIBRARY_CHANNELS.import, { metadata })).toMatchObject({ ok: true });
    expect(await call(ASSET_LIBRARY_CHANNELS.import, { metadata })).toMatchObject({ ok: false, code: 'selection_required' });
  });

  it('indexes, recommends only eligible media and rechecks bytes and rights before editor use', async () => {
    const { call, root } = setup();
    await call(ASSET_LIBRARY_CHANNELS.choose);
    const imported = await call(ASSET_LIBRARY_CHANNELS.import, { metadata }) as { record: { id: string } };
    const id = imported.record.id;
    expect(await call(ASSET_LIBRARY_CHANNELS.index)).toMatchObject({ ok: true, indexedCount: 1 });
    const result = await call(ASSET_LIBRARY_CHANNELS.recommend, {
      query: { text: '夜晚街景' }, context,
    }) as { ok: boolean; result: { recommendations: Array<{ assetId: string }> } };
    expect(result.ok).toBe(true);
    expect(result.result.recommendations.map((item) => item.assetId)).toEqual([id]);
    expect(await call(ASSET_LIBRARY_CHANNELS.use, { id, context })).toMatchObject({
      ok: true, mediaType: 'image', durationMs: null,
    });
    expect(await call(ASSET_LIBRARY_CHANNELS.revoke, { id })).toMatchObject({ ok: true });
    expect(await call(ASSET_LIBRARY_CHANNELS.use, { id, context })).toMatchObject({ ok: false, code: 'rights_blocked' });
    const afterRevoke = await call(ASSET_LIBRARY_CHANNELS.recommend, {
      query: { text: '夜晚街景' }, context,
    });
    expect(afterRevoke).toMatchObject({ ok: true, result: { status: 'no_eligible_assets' } });
    expect(readFileSync(join(root, 'catalog.json'), 'utf8')).toContain('"authorizedForAutoUse":false');
  });
});

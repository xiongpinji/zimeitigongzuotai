import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAssetLibrary, type AssetImportMetadata } from '../electron/assets/local-asset-library';
import { OllamaAssetIndex } from '../electron/assets/ollama-asset-index';
import { createProductionAssetSearch } from '../electron/production/asset-search';

const dirs: string[] = [];
const libraries: LocalAssetLibrary[] = [];
afterEach(() => {
  for (const library of libraries.splice(0)) library.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const metadata: AssetImportMetadata = {
  semanticText: '夜晚城市街道', tags: ['夜景'], transcript: null,
  source: '自拍', rightsHolder: '用户', license: 'proprietary', usageScope: '商业短视频',
  authorizedForAutoUse: true,
  rightsGrant: {
    platforms: ['douyin'], regions: ['cn'], commercialShortVideoUse: 'allowed',
    validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
    evidence: [{ kind: 'written-approval', ref: 'private-evidence-001',
      collectedAt: '2026-09-01T00:00:00.000Z', note: null }],
  },
};

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'production-search-')); dirs.push(dir);
  const source = join(dir, 'selected.png');
  writeFileSync(source, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
  const root = join(dir, 'assets');
  const library = new LocalAssetLibrary({ rootDir: root }); libraries.push(library);
  const index = new OllamaAssetIndex({ rootDir: root, fetcher: vi.fn(async (url: string) =>
    url.endsWith('/api/tags')
      ? Response.json({ models: [{ name: 'nomic-embed-text-v2-moe:latest', digest: 'digest-1' }] })
      : Response.json({ embeddings: [[1, 0]] })) });
  const record = await library.importFile(source, metadata);
  await index.indexRecords(library.list());
  const search = createProductionAssetSearch({ library, index,
    now: () => new Date('2026-10-05T00:00:00.000Z') });
  const input = { text: '夜晚街景', platform: 'douyin' as const, region: 'cn',
    commercialShortVideo: true, maxResults: 5 };
  return { library, record, search, input, source };
}

describe('production asset search', () => {
  it('returns only verified eligible IDs and scores without private paths or rights references', async () => {
    const f = await fixture();
    const result = await f.search(f.input);
    expect(result).toMatchObject({ status: 'ok', assets: [{ assetId: f.record.entry.asset.id }] });
    const output = JSON.stringify(result);
    expect(output).not.toContain(f.source);
    expect(output).not.toContain('private-evidence-001');
    expect(output).not.toContain('media/');
    expect(output).not.toContain('自拍');
  });

  it('blocks other platforms, revoked grants and changed media bytes', async () => {
    const f = await fixture();
    expect(await f.search({ ...f.input, platform: 'kuaishou' })).toEqual({ status: 'no_eligible_assets', assets: [] });
    f.library.revokeAutoUse(f.record.entry.asset.id);
    expect(await f.search(f.input)).toEqual({ status: 'no_eligible_assets', assets: [] });
    f.library.updateAuthorization(f.record.entry.asset.id, {
      rightsGrant: metadata.rightsGrant, authorizedForAutoUse: true,
    });
    const media = await f.library.verifiedForUsage(f.record.entry.asset.id, {
      platform: 'douyin', region: 'cn', usedAt: '2026-10-05T00:00:00.000Z', commercialShortVideo: true,
    });
    writeFileSync(media, 'tampered');
    await expect(f.search(f.input)).rejects.toMatchObject({ code: 'media_changed' });
  });
});

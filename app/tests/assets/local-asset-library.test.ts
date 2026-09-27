import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalAssetLibrary,
  LocalAssetLibraryError,
  type AssetImportMetadata,
} from '../../electron/assets/local-asset-library';
import type { AssetUsageContext } from '../../electron/assets/asset-rights';

const dirs: string[] = [];
const writers: LocalAssetLibrary[] = [];
const context: AssetUsageContext = {
  platform: 'douyin', region: 'cn', usedAt: '2026-09-27T12:00:00.000Z', commercialShortVideo: true,
};
const metadata: AssetImportMetadata = {
  semanticText: '夜晚的城市街道，霓虹灯与行人',
  tags: ['城市', '夜景'], transcript: null,
  source: '用户自拍素材', rightsHolder: '本项目用户', license: 'proprietary',
  usageScope: '中国大陆商业短视频', authorizedForAutoUse: true,
  rightsGrant: {
    platforms: ['douyin', 'kuaishou'], regions: ['cn'], commercialShortVideoUse: 'allowed',
    validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
    evidence: [{ kind: 'written-approval', ref: 'local-approval-001',
      collectedAt: '2026-09-01T00:00:00.000Z', note: null }],
  },
};

function fixture(): { root: string; source: string } {
  const dir = mkdtempSync(join(tmpdir(), 'zmt-asset-library-'));
  dirs.push(dir);
  const source = join(dir, 'selected.png');
  writeFileSync(source, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
    'base64',
  ));
  return { root: join(dir, 'userData', 'assets-v1'), source };
}

function open(root: string): LocalAssetLibrary {
  const writer = new LocalAssetLibrary({ rootDir: root, probeDurationMs: vi.fn(async () => 2400) });
  writers.push(writer);
  return writer;
}

afterEach(() => {
  for (const writer of writers.splice(0)) writer.close();
  for (const dir of dirs.splice(0)) {
    if (dir.startsWith(tmpdir()) && dir.includes('zmt-asset-library-')) rmSync(dir, { recursive: true, force: true });
  }
});

describe('LocalAssetLibrary', () => {
  it('copies selected media into a content-addressed store and reopens with rights and provenance intact', async () => {
    const { root, source } = fixture();
    const writer = open(root);
    const record = await writer.importFile(source, metadata);
    const sha = createHash('sha256').update(readFileSync(source)).digest('hex');
    expect(record.entry.asset.sha256).toBe(sha);
    expect(record.entry.mediaRef).toBe(`media/${sha}.png`);
    expect(record.entry.asset.durationMs).toBeNull();
    expect(record.semanticText).toBe(metadata.semanticText);
    const internalPath = await writer.verifiedForUsage(record.entry.asset.id, context);
    expect(readFileSync(internalPath)).toEqual(readFileSync(source));
    writer.close();

    const reopened = open(root);
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.list()[0]).toEqual(record);
    expect(await reopened.verifiedForUsage(record.entry.asset.id, context)).toBe(internalPath);
  });

  it('does not treat the usageScope prose as permission and supports explicit grant update and revocation', async () => {
    const { root, source } = fixture();
    const writer = open(root);
    const record = await writer.importFile(source, { ...metadata, rightsGrant: null, authorizedForAutoUse: false });
    await expect(writer.verifiedForUsage(record.entry.asset.id, context)).rejects.toMatchObject({ code: 'rights_blocked' });
    const updated = writer.updateAuthorization(record.entry.asset.id, {
      rightsGrant: metadata.rightsGrant, authorizedForAutoUse: true,
    });
    expect(updated.entry.rightsGrant).toEqual(metadata.rightsGrant);
    expect(await writer.verifiedForUsage(record.entry.asset.id, context)).toContain(record.entry.asset.sha256);
    writer.revokeAutoUse(record.entry.asset.id);
    await expect(writer.verifiedForUsage(record.entry.asset.id, context)).rejects.toMatchObject({ code: 'rights_blocked' });
    expect(writer.get(record.entry.asset.id)?.entry.rightsGrant).toEqual(metadata.rightsGrant);
  });

  it('rejects tampered stored bytes before handing media to automatic composition', async () => {
    const { root, source } = fixture();
    const writer = open(root);
    const record = await writer.importFile(source, metadata);
    const stored = await writer.verifiedForUsage(record.entry.asset.id, context);
    writeFileSync(stored, 'changed image bytes');
    await expect(writer.verifiedForUsage(record.entry.asset.id, context)).rejects.toMatchObject({ code: 'media_changed' });
    await expect(writer.importFile(source, metadata)).rejects.toMatchObject({ code: 'media_changed' });
  });

  it('deduplicates identical bytes and gives changed bytes a new content identity', async () => {
    const { root, source } = fixture();
    const writer = open(root);
    const first = await writer.importFile(source, metadata);
    const same = await writer.importFile(source, { ...metadata, semanticText: '不同描述不可暗中覆盖既有目录' });
    expect(same).toEqual(first);
    expect(writer.list()).toHaveLength(1);
    writeFileSync(source, Buffer.concat([readFileSync(source), Buffer.from('v2')]));
    const changed = await writer.importFile(source, metadata);
    expect(changed.entry.asset.id).not.toBe(first.entry.asset.id);
    expect(writer.list()).toHaveLength(2);
  });

  it('rejects unsupported files, invalid metadata, a second writer and a corrupt catalog', async () => {
    const { root, source } = fixture();
    const writer = open(root);
    expect(() => open(root)).toThrow(expect.objectContaining({ code: 'store_busy' }));
    await expect(writer.importFile(source, { ...metadata, rightsGrant: null })).rejects.toMatchObject({
      code: 'invalid_metadata',
    });
    const unsupported = join(join(root, '..', '..'), 'bad.exe');
    writeFileSync(unsupported, 'not media');
    await expect(writer.importFile(unsupported, metadata)).rejects.toMatchObject({ code: 'invalid_source' });
    expect(writer.list()).toEqual([]);
    writer.close();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'catalog.json'), '{"schemaVersion":1,"records":[{"bad":1}]}');
    expect(() => open(root)).toThrow(LocalAssetLibraryError);
  });

  it('does not save a catalog entry when duration probing fails for selected video', async () => {
    const { root, source } = fixture();
    const video = source.replace(/\.png$/, '.mp4');
    writeFileSync(video, 'invalid synthetic video');
    const writer = new LocalAssetLibrary({ rootDir: root, probeDurationMs: async () => { throw new Error('bad media'); } });
    writers.push(writer);
    await expect(writer.importFile(video, metadata)).rejects.toMatchObject({ code: 'invalid_media' });
    expect(writer.list()).toEqual([]);
    expect(existsSync(join(root, 'catalog.json'))).toBe(false);
  });

  it('detects an external catalog rewrite instead of overwriting it', async () => {
    const { root, source } = fixture();
    const writer = open(root);
    const record = await writer.importFile(source, metadata);
    writeFileSync(join(root, 'catalog.json'), '{"schemaVersion":1,"records":[]}');
    expect(() => writer.revokeAutoUse(record.entry.asset.id)).toThrow(
      expect.objectContaining({ code: 'store_changed' }),
    );
  });

  it('does not release writer ownership while a media import is still active', async () => {
    const { root, source } = fixture();
    const video = source.replace(/\.png$/, '.mp4');
    writeFileSync(video, 'synthetic probe input');
    let finishProbe!: (duration: number) => void;
    const probing = new Promise<number>((resolve) => { finishProbe = resolve; });
    const writer = new LocalAssetLibrary({ rootDir: root, probeDurationMs: () => probing });
    writers.push(writer);
    const pending = writer.importFile(video, metadata);
    await vi.waitFor(() => expect(existsSync(join(root, 'media'))).toBe(true));
    expect(() => writer.close()).toThrow(expect.objectContaining({ code: 'busy' }));
    finishProbe(2400);
    await pending;
    writer.close();
  });
});

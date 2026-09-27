/** Product-owned material bytes and rights metadata. No renderer-supplied path reaches this class. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants as fsConstants, createReadStream, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import type { AssetV1 } from '../../src/types/production-contracts';
import { readVideoDurationMs } from '../media-duration';
import {
  AssetRightsCatalog, evaluateAssetEligibility, validateAssetCatalogEntry,
  type AssetCatalogEntry, type AssetUsageContext, type RightsGrant,
} from './asset-rights';

export type LocalAssetLibraryErrorCode =
  | 'invalid_store' | 'store_busy' | 'store_corrupt' | 'store_unsupported_version'
  | 'store_changed' | 'store_write_failed' | 'closed' | 'busy'
  | 'invalid_source' | 'invalid_media' | 'invalid_metadata'
  | 'asset_not_found' | 'rights_blocked' | 'media_changed';

export class LocalAssetLibraryError extends Error {
  readonly code: LocalAssetLibraryErrorCode;
  constructor(code: LocalAssetLibraryErrorCode) {
    super(code);
    this.name = 'LocalAssetLibraryError';
    this.code = code;
  }
}

export interface AssetImportMetadata {
  /** User-authored description of visible content, never treated as verified image understanding. */
  semanticText: string;
  tags: string[];
  transcript: string | null;
  source: string;
  rightsHolder: string;
  license: string;
  usageScope: string;
  authorizedForAutoUse: boolean;
  rightsGrant: RightsGrant | null;
}

export interface LocalAssetRecord {
  entry: AssetCatalogEntry;
  semanticText: string;
}

interface CatalogFileV1 {
  schemaVersion: 1;
  records: LocalAssetRecord[];
}

export interface LocalAssetLibraryOptions {
  rootDir: string;
  ffprobePath?: string | null;
  probeDurationMs?: (mediaPath: string) => Promise<number>;
  now?: () => Date;
}

const ACTIVE_WRITERS = new Set<string>();
const MAX_CATALOG_BYTES = 20 * 1024 * 1024;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024 * 1024;
const MEDIA_BY_EXTENSION = {
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio',
} as const satisfies Record<string, AssetV1['mediaType']>;
const CATALOG_KEYS = ['schemaVersion', 'records'] as const;
const RECORD_KEYS = ['entry', 'semanticText'] as const;
const IMPORT_KEYS = [
  'semanticText', 'tags', 'transcript', 'source', 'rightsHolder', 'license',
  'usageScope', 'authorizedForAutoUse', 'rightsGrant',
] as const;
const AUTH_KEYS = ['rightsGrant', 'authorizedForAutoUse'] as const;

function fail(code: LocalAssetLibraryErrorCode): never { throw new LocalAssetLibraryError(code); }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key));
}

function normalString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function validSemanticText(value: unknown): value is string {
  return normalString(value, 4096);
}

function normalizeImportMetadata(value: unknown): AssetImportMetadata {
  if (!object(value) || !exactKeys(value, IMPORT_KEYS) ||
      !validSemanticText(value.semanticText) ||
      !Array.isArray(value.tags) || value.tags.length > 40 ||
      value.tags.some((tag) => !normalString(tag, 120)) ||
      !(value.transcript === null ||
        (typeof value.transcript === 'string' && value.transcript.length <= 30_000)) ||
      !normalString(value.source, 1024) || !normalString(value.rightsHolder, 512) ||
      !normalString(value.license, 256) || !normalString(value.usageScope, 2048) ||
      typeof value.authorizedForAutoUse !== 'boolean' ||
      (value.authorizedForAutoUse && value.rightsGrant === null)) fail('invalid_metadata');
  // Reuse the strict credential-key and nested RightsGrant validator before copying bytes.
  try {
    validateAssetCatalogEntry({
      asset: {
        id: `asset_${'0'.repeat(64)}`, sha256: '0'.repeat(64), mediaType: 'image',
        durationMs: null, tags: value.tags, transcript: value.transcript, embeddingRef: null,
        source: value.source, rightsHolder: value.rightsHolder, license: value.license,
        usageScope: value.usageScope, authorizedForAutoUse: value.authorizedForAutoUse,
        importedAt: '2026-01-01T00:00:00.000Z',
      },
      mediaRef: 'media/placeholder.png', rightsGrant: value.rightsGrant,
    });
  } catch { fail('invalid_metadata'); }
  return {
    semanticText: value.semanticText as string,
    tags: [...(value.tags as string[])], transcript: value.transcript as string | null,
    source: value.source as string, rightsHolder: value.rightsHolder as string,
    license: value.license as string, usageScope: value.usageScope as string,
    authorizedForAutoUse: value.authorizedForAutoUse as boolean,
    rightsGrant: value.rightsGrant as RightsGrant | null,
  };
}

function ordinaryFile(filePath: string): boolean {
  try { const stat = lstatSync(filePath); return stat.isFile() && !stat.isSymbolicLink(); }
  catch { return false; }
}

function pathExists(filePath: string): boolean {
  try { lstatSync(filePath); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    fail('media_changed');
  }
}

function ensureDirectory(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_store');
  } catch (error) {
    if (error instanceof LocalAssetLibraryError) throw error;
    fail('invalid_store');
  }
}

function readCatalogText(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CATALOG_BYTES) fail('store_corrupt');
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof LocalAssetLibraryError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    fail('store_corrupt');
  }
}

function textSha256(text: string | null): string | null {
  return text === null ? null : createHash('sha256').update(text, 'utf8').digest('hex');
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest('hex');
}

function validateImageHeader(path: string, ext: string): boolean {
  const bytes = Buffer.alloc(8);
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    if (ext === '.png') return count === 8 && bytes.equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    return count >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  } catch { return false; }
  finally { if (fd !== null) closeSync(fd); }
}

function validateStoredRecord(value: unknown): LocalAssetRecord {
  if (!object(value) || !exactKeys(value, RECORD_KEYS) || !validSemanticText(value.semanticText)) {
    fail('store_corrupt');
  }
  let entry: AssetCatalogEntry;
  try { entry = validateAssetCatalogEntry(value.entry); }
  catch { fail('store_corrupt'); }
  const sha = entry.asset.sha256.toLowerCase();
  const ext = extname(entry.mediaRef).toLowerCase();
  if (entry.asset.id !== `asset_${sha}` ||
      !Object.prototype.hasOwnProperty.call(MEDIA_BY_EXTENSION, ext) ||
      MEDIA_BY_EXTENSION[ext as keyof typeof MEDIA_BY_EXTENSION] !== entry.asset.mediaType ||
      entry.mediaRef !== `media/${sha}${ext}`) fail('store_corrupt');
  return Object.freeze({ entry, semanticText: value.semanticText as string });
}

function loadRecords(text: string | null): LocalAssetRecord[] {
  if (text === null) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { fail('store_corrupt'); }
  if (!object(parsed) || !exactKeys(parsed, CATALOG_KEYS)) fail('store_corrupt');
  if (parsed.schemaVersion !== 1) fail('store_unsupported_version');
  if (!Array.isArray(parsed.records) || parsed.records.length > 20_000) fail('store_corrupt');
  const records = parsed.records.map(validateStoredRecord);
  try { new AssetRightsCatalog(records.map((record) => record.entry)); }
  catch { fail('store_corrupt'); }
  return records;
}

export class LocalAssetLibrary {
  private readonly root: string;
  private readonly catalogPath: string;
  private readonly mediaDir: string;
  private readonly probeDurationMs: (mediaPath: string) => Promise<number>;
  private readonly now: () => Date;
  private records: LocalAssetRecord[];
  private catalogHash: string | null;
  private closed = false;
  private busy = false;

  constructor(options: LocalAssetLibraryOptions) {
    if (!options || typeof options.rootDir !== 'string' || !isAbsolute(options.rootDir)) fail('invalid_store');
    this.root = resolve(options.rootDir);
    if (ACTIVE_WRITERS.has(this.root)) fail('store_busy');
    this.catalogPath = join(this.root, 'catalog.json');
    this.mediaDir = join(this.root, 'media');
    this.probeDurationMs = options.probeDurationMs ?? ((mediaPath) =>
      readVideoDurationMs(mediaPath, { ffprobePath: options.ffprobePath }));
    this.now = options.now ?? (() => new Date());
    try {
      try {
        const stat = lstatSync(this.root);
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_store');
      } catch (error) {
        if (error instanceof LocalAssetLibraryError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('invalid_store');
      }
      const text = readCatalogText(this.catalogPath);
      this.records = loadRecords(text);
      this.catalogHash = textSha256(text);
      ACTIVE_WRITERS.add(this.root);
    } catch (error) {
      if (error instanceof LocalAssetLibraryError) throw error;
      fail('store_corrupt');
    }
  }

  close(): void {
    if (this.closed) return;
    if (this.busy) fail('busy');
    this.closed = true;
    ACTIVE_WRITERS.delete(this.root);
  }

  private assertOpen(): void { if (this.closed) fail('closed'); }

  list(): readonly LocalAssetRecord[] {
    this.assertOpen();
    return Object.freeze([...this.records]);
  }

  get(id: string): LocalAssetRecord | null {
    this.assertOpen();
    return this.records.find((record) => record.entry.asset.id === id) ?? null;
  }

  private commit(nextRecords: LocalAssetRecord[]): void {
    this.assertOpen();
    ensureDirectory(this.root);
    const current = readCatalogText(this.catalogPath);
    if (textSha256(current) !== this.catalogHash) fail('store_changed');
    const content: CatalogFileV1 = { schemaVersion: 1, records: nextRecords };
    const text = JSON.stringify(content);
    if (Buffer.byteLength(text, 'utf8') > MAX_CATALOG_BYTES) fail('store_write_failed');
    const temp = join(this.root, `catalog.${randomUUID()}.tmp`);
    let fd: number | null = null;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, text, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      if (textSha256(readCatalogText(this.catalogPath)) !== this.catalogHash) fail('store_changed');
      renameSync(temp, this.catalogPath);
      this.catalogHash = textSha256(text);
      this.records = nextRecords;
    } catch (error) {
      if (error instanceof LocalAssetLibraryError) throw error;
      fail('store_write_failed');
    } finally {
      if (fd !== null) try { closeSync(fd); } catch { /* preserve original failure */ }
      try { rmSync(temp, { force: true }); } catch { /* preserve original failure */ }
    }
  }

  async importFile(sourcePath: string, rawMetadata: unknown): Promise<LocalAssetRecord> {
    this.assertOpen();
    if (this.busy) fail('busy');
    this.busy = true;
    let temp: string | null = null;
    try {
      const metadata = normalizeImportMetadata(rawMetadata);
      if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath) || !ordinaryFile(sourcePath)) fail('invalid_source');
      const ext = extname(sourcePath).toLowerCase();
      const mediaType = MEDIA_BY_EXTENSION[ext as keyof typeof MEDIA_BY_EXTENSION];
      if (!mediaType) fail('invalid_source');
      const sourceStat = lstatSync(sourcePath);
      if (sourceStat.size <= 0 || sourceStat.size > MAX_MEDIA_BYTES) fail('invalid_source');
      ensureDirectory(this.root);
      ensureDirectory(this.mediaDir);
      temp = join(this.mediaDir, `${randomUUID()}.part${ext}`);
      await copyFile(sourcePath, temp, fsConstants.COPYFILE_EXCL);
      if (!ordinaryFile(temp)) fail('invalid_media');
      const sha = await sha256File(temp);
      const existing = this.records.find((record) => record.entry.asset.sha256.toLowerCase() === sha);
      if (existing) {
        const stored = join(this.root, existing.entry.mediaRef);
        if (!ordinaryFile(stored) || await sha256File(stored) !== sha) fail('media_changed');
        return existing;
      }
      let durationMs: number | null = null;
      if (mediaType === 'image') {
        if (!validateImageHeader(temp, ext)) fail('invalid_media');
      } else {
        try { durationMs = await this.probeDurationMs(temp); }
        catch { fail('invalid_media'); }
        if (!Number.isSafeInteger(durationMs) || durationMs <= 0) fail('invalid_media');
      }
      const importedAt = this.now().toISOString();
      const entry = validateAssetCatalogEntry({
        asset: {
          id: `asset_${sha}`, sha256: sha, mediaType, durationMs,
          tags: metadata.tags, transcript: metadata.transcript, embeddingRef: null,
          source: metadata.source, rightsHolder: metadata.rightsHolder,
          license: metadata.license, usageScope: metadata.usageScope,
          authorizedForAutoUse: metadata.authorizedForAutoUse, importedAt,
        },
        mediaRef: `media/${sha}${ext}`, rightsGrant: metadata.rightsGrant,
      });
      const record = validateStoredRecord({ entry, semanticText: metadata.semanticText });
      const finalPath = join(this.mediaDir, `${sha}${ext}`);
      if (pathExists(finalPath)) {
        if (!ordinaryFile(finalPath)) fail('media_changed');
        if (await sha256File(finalPath) !== sha) fail('media_changed');
      } else {
        try { renameSync(temp, finalPath); temp = null; }
        catch { fail('store_write_failed'); }
      }
      this.commit([...this.records, record]);
      return record;
    } catch (error) {
      if (error instanceof LocalAssetLibraryError) throw error;
      throw new LocalAssetLibraryError('invalid_media');
    } finally {
      if (temp !== null) try { rmSync(temp, { force: true }); } catch { /* preserve original failure */ }
      this.busy = false;
    }
  }

  updateAuthorization(id: string, raw: unknown): LocalAssetRecord {
    this.assertOpen();
    if (this.busy) fail('busy');
    if (!object(raw) || !exactKeys(raw, AUTH_KEYS) ||
        typeof raw.authorizedForAutoUse !== 'boolean' ||
        (raw.authorizedForAutoUse && raw.rightsGrant === null)) fail('invalid_metadata');
    const index = this.records.findIndex((record) => record.entry.asset.id === id);
    if (index < 0) fail('asset_not_found');
    const previous = this.records[index];
    let entry: AssetCatalogEntry;
    try {
      entry = validateAssetCatalogEntry({
        ...previous.entry,
        asset: { ...previous.entry.asset, authorizedForAutoUse: raw.authorizedForAutoUse },
        rightsGrant: raw.rightsGrant,
      });
    } catch { fail('invalid_metadata'); }
    const record = validateStoredRecord({ entry, semanticText: previous.semanticText });
    const next = [...this.records];
    next[index] = record;
    this.commit(next);
    return record;
  }

  revokeAutoUse(id: string): LocalAssetRecord {
    const record = this.get(id);
    if (!record) fail('asset_not_found');
    return this.updateAuthorization(id, {
      rightsGrant: record.entry.rightsGrant,
      authorizedForAutoUse: false,
    });
  }

  async verifiedForUsage(id: string, context: AssetUsageContext): Promise<string> {
    this.assertOpen();
    const record = this.get(id);
    if (!record) fail('asset_not_found');
    if (!evaluateAssetEligibility(record.entry, context).eligible) fail('rights_blocked');
    const path = join(this.root, record.entry.mediaRef);
    if (!ordinaryFile(path)) fail('media_changed');
    try {
      if (await sha256File(path) !== record.entry.asset.sha256.toLowerCase()) fail('media_changed');
    } catch { fail('media_changed'); }
    if (this.get(id) !== record || !evaluateAssetEligibility(record.entry, context).eligible) {
      fail('rights_blocked');
    }
    return path;
  }
}

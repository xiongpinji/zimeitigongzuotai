/** Local text embeddings only. A user description is not verified visual understanding. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { NormalizedBrollQuery, SemanticSearchHit, SemanticSearchPort } from './asset-rights';
import type { LocalAssetRecord } from './local-asset-library';

const BASE_URL = 'http://127.0.0.1:11434';
const MODEL = 'nomic-embed-text-v2-moe:latest';
const INDEX_FILENAME = 'semantic-index.json';
const MAX_INDEX_BYTES = 200 * 1024 * 1024;
const MAX_RECORDS = 20_000;
const MAX_DIMENSIONS = 4096;
const BATCH_SIZE = 16;

export type OllamaAssetIndexErrorCode =
  | 'invalid_store' | 'invalid_records' | 'index_unavailable' | 'invalid_response'
  | 'stale_index' | 'invalid_index' | 'index_write_failed' | 'busy';

export class OllamaAssetIndexError extends Error {
  constructor(readonly code: OllamaAssetIndexErrorCode) {
    super(code);
    this.name = 'OllamaAssetIndexError';
  }
}

interface IndexRow {
  assetId: string;
  assetSha256: string;
  semanticHash: string;
  vector: number[];
}

interface IndexFile {
  schemaVersion: 1;
  model: string;
  modelDigest: string;
  dimensions: number;
  rows: IndexRow[];
}

export interface OllamaAssetIndexOptions {
  rootDir: string;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}

function fail(code: OllamaAssetIndexErrorCode): never { throw new OllamaAssetIndexError(code); }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function semanticInput(record: LocalAssetRecord): string {
  if (typeof record.semanticText !== 'string' || !record.semanticText.trim() ||
      record.semanticText.length > 4096 || !Array.isArray(record.entry?.asset?.tags) ||
      record.entry.asset.tags.length > 40 ||
      record.entry.asset.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 120)) {
    fail('invalid_records');
  }
  const value = [record.semanticText, ...record.entry.asset.tags].join('\n');
  if (value.length > 8192) fail('invalid_records');
  return value;
}

function checkedRecords(records: readonly LocalAssetRecord[]): Array<{
  id: string; sha: string; input: string; hash: string;
}> {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) fail('invalid_records');
  const ids = new Set<string>();
  const shas = new Set<string>();
  return records.map((record) => {
    const id = record?.entry?.asset?.id;
    const sha = record?.entry?.asset?.sha256;
    if (typeof id !== 'string' || !/^asset_[a-f0-9]{64}$/.test(id) ||
        typeof sha !== 'string' || !/^[a-f0-9]{64}$/.test(sha) ||
        id !== `asset_${sha}` || ids.has(id) || shas.has(sha)) fail('invalid_records');
    ids.add(id);
    shas.add(sha);
    const input = semanticInput(record);
    return { id, sha, input, hash: sha256(input) };
  });
}

function vector(value: unknown, dimensions?: number): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DIMENSIONS ||
      (dimensions !== undefined && value.length !== dimensions) ||
      value.some((part) => typeof part !== 'number' || !Number.isFinite(part))) fail('invalid_response');
  const result = value as number[];
  if (!result.some((part) => part !== 0)) fail('invalid_response');
  return result;
}

function validateIndex(raw: unknown): IndexFile {
  if (!object(raw) || !keys(raw, ['schemaVersion', 'model', 'modelDigest', 'dimensions', 'rows']) ||
      raw.schemaVersion !== 1 || raw.model !== MODEL ||
      typeof raw.modelDigest !== 'string' || !/^[a-f0-9]{64}$|^[\w.-]{1,128}$/.test(raw.modelDigest) ||
      !Number.isInteger(raw.dimensions) || (raw.dimensions as number) < 0 ||
      (raw.dimensions as number) > MAX_DIMENSIONS ||
      !Array.isArray(raw.rows) || raw.rows.length > MAX_RECORDS) fail('invalid_index');
  const dimensions = raw.dimensions as number;
  if (raw.rows.length > 0 && dimensions === 0) fail('invalid_index');
  const ids = new Set<string>();
  const rows = raw.rows.map((candidate) => {
    if (!object(candidate) || !keys(candidate, ['assetId', 'assetSha256', 'semanticHash', 'vector']) ||
        typeof candidate.assetId !== 'string' ||
        typeof candidate.assetSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.assetSha256) ||
        candidate.assetId !== `asset_${candidate.assetSha256}` || ids.has(candidate.assetId) ||
        typeof candidate.semanticHash !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.semanticHash)) {
      fail('invalid_index');
    }
    ids.add(candidate.assetId);
    let checked: number[];
    try { checked = vector(candidate.vector, dimensions); }
    catch { fail('invalid_index'); }
    return {
      assetId: candidate.assetId as string,
      assetSha256: candidate.assetSha256 as string,
      semanticHash: candidate.semanticHash as string,
      vector: checked,
    };
  });
  return {
    schemaVersion: 1, model: MODEL, modelDigest: raw.modelDigest as string,
    dimensions, rows,
  };
}

function ensureDirectory(root: string): void {
  try {
    mkdirSync(root, { recursive: true });
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_store');
  } catch (error) {
    if (error instanceof OllamaAssetIndexError) throw error;
    fail('invalid_store');
  }
}

function readIndex(path: string): IndexFile {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INDEX_BYTES) fail('invalid_index');
    return validateIndex(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error instanceof OllamaAssetIndexError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('index_unavailable');
    fail('invalid_index');
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!Number.isFinite(dot) || !Number.isFinite(normA) || !Number.isFinite(normB) ||
      normA <= 0 || normB <= 0) fail('invalid_response');
  return Math.max(0, Math.min(1, dot / Math.sqrt(normA * normB)));
}

export class OllamaAssetIndex {
  private readonly root: string;
  private readonly fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  private busy = false;

  constructor(options: OllamaAssetIndexOptions) {
    if (!options || typeof options.rootDir !== 'string' || !isAbsolute(options.rootDir)) fail('invalid_store');
    this.root = resolve(options.rootDir);
    this.fetcher = options.fetcher ?? fetch;
  }

  private async request(path: '/api/tags' | '/api/embed', body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${BASE_URL}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { fail('index_unavailable'); }
    if (!response.ok) fail('index_unavailable');
    try { return await response.json(); }
    catch { fail('invalid_response'); }
  }

  private async modelDigest(): Promise<string> {
    const raw = await this.request('/api/tags');
    if (!object(raw) || !Array.isArray(raw.models)) fail('invalid_response');
    const model = raw.models.find((item) => object(item) && item.name === MODEL);
    if (!object(model) || typeof model.digest !== 'string' ||
        !/^[a-f0-9]{64}$|^[\w.-]{1,128}$/.test(model.digest)) fail('index_unavailable');
    return model.digest;
  }

  private async embed(inputs: string[], dimensions?: number): Promise<number[][]> {
    const raw = await this.request('/api/embed', {
      model: MODEL, input: inputs, truncate: false,
    });
    if (!object(raw) || !Array.isArray(raw.embeddings) || raw.embeddings.length !== inputs.length) {
      fail('invalid_response');
    }
    const result = raw.embeddings.map((value) => vector(value, dimensions));
    if (result.some((value) => value.length !== result[0].length)) fail('invalid_response');
    return result;
  }

  async indexRecords(records: readonly LocalAssetRecord[]): Promise<{ indexedCount: number; modelDigest: string }> {
    if (this.busy) fail('busy');
    this.busy = true;
    try {
      const checked = checkedRecords(records);
      const digest = await this.modelDigest();
      const rows: IndexRow[] = [];
      let dimensions = 0;
      for (let i = 0; i < checked.length; i += BATCH_SIZE) {
        const batch = checked.slice(i, i + BATCH_SIZE);
        const vectors = await this.embed(batch.map((item) => `search_document: ${item.input}`), dimensions || undefined);
        dimensions = vectors[0].length;
        batch.forEach((item, index) => rows.push({
          assetId: item.id,
          assetSha256: item.sha,
          semanticHash: item.hash,
          vector: vectors[index],
        }));
      }
      if (await this.modelDigest() !== digest) fail('stale_index');
      const index: IndexFile = {
        schemaVersion: 1, model: MODEL, modelDigest: digest, dimensions, rows,
      };
      ensureDirectory(this.root);
      const text = JSON.stringify(index);
      if (Buffer.byteLength(text, 'utf8') > MAX_INDEX_BYTES) fail('index_write_failed');
      const temp = join(this.root, `semantic-index.${randomUUID()}.tmp`);
      let fd: number | null = null;
      try {
        fd = openSync(temp, 'wx', 0o600);
        writeFileSync(fd, text, 'utf8');
        fsyncSync(fd);
        closeSync(fd);
        fd = null;
        renameSync(temp, join(this.root, INDEX_FILENAME));
      } catch { fail('index_write_failed'); }
      finally {
        if (fd !== null) try { closeSync(fd); } catch { /* retain first failure */ }
        try { rmSync(temp, { force: true }); } catch { /* retain first failure */ }
      }
      return { indexedCount: rows.length, modelDigest: digest };
    } finally {
      this.busy = false;
    }
  }

  searchPort(records: readonly LocalAssetRecord[]): SemanticSearchPort {
    return async (candidateAssetIds: readonly string[], query: NormalizedBrollQuery): Promise<readonly SemanticSearchHit[]> => {
      if (this.busy) fail('busy');
      if (!Array.isArray(candidateAssetIds) || candidateAssetIds.length > MAX_RECORDS ||
          typeof query?.text !== 'string' || !query.text.trim() || query.text.length > 4096) {
        fail('invalid_records');
      }
      const checked = checkedRecords(records);
      const recordsById = new Map(checked.map((item) => [item.id, item]));
      const index = readIndex(join(this.root, INDEX_FILENAME));
      const indexById = new Map(index.rows.map((row) => [row.assetId, row]));
      const seen = new Set<string>();
      const candidates = candidateAssetIds.map((id) => {
        if (typeof id !== 'string' || seen.has(id)) fail('invalid_records');
        seen.add(id);
        const current = recordsById.get(id);
        const stored = indexById.get(id);
        if (!current || !stored || stored.assetSha256 !== current.sha ||
            stored.semanticHash !== current.hash) fail('stale_index');
        return stored;
      });
      if (await this.modelDigest() !== index.modelDigest) fail('stale_index');
      if (candidates.length === 0) return [];
      const [queryVector] = await this.embed([`search_query: ${query.text}`], index.dimensions);
      return candidates.map((row) => ({ assetId: row.assetId, score: cosine(row.vector, queryVector) }))
        .sort((a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId));
    };
  }
}

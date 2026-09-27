import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recommendBrollFromEntries, validateAssetCatalogEntry, type NormalizedBrollQuery } from '../../electron/assets/asset-rights';
import type { LocalAssetRecord } from '../../electron/assets/local-asset-library';
import { OllamaAssetIndex } from '../../electron/assets/ollama-asset-index';

const dirs: string[] = [];
const query: NormalizedBrollQuery = { text: '夜晚城市', maxResults: 5, minScore: 0, preferredTags: [] };

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'zmt-asset-index-'));
  dirs.push(root);
  return root;
}

function record(char: string, semanticText: string, authorized = true): LocalAssetRecord {
  const sha = char.repeat(64);
  return {
    semanticText,
    entry: validateAssetCatalogEntry({
      asset: {
        id: `asset_${sha}`, sha256: sha, mediaType: 'video', durationMs: 3000,
        tags: [semanticText], transcript: null, embeddingRef: null,
        source: 'source-secret', rightsHolder: 'holder-secret', license: 'proprietary',
        usageScope: 'scope-secret', authorizedForAutoUse: authorized,
        importedAt: '2026-09-27T00:00:00.000Z',
      },
      mediaRef: `media/${sha}.mp4`,
      rightsGrant: authorized ? {
        platforms: ['douyin'], regions: ['cn'], commercialShortVideoUse: 'allowed',
        validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
        evidence: [{ kind: 'written-approval', ref: 'evidence-secret',
          collectedAt: '2026-09-01T00:00:00.000Z', note: null }],
      } : null,
    }),
  };
}

function fakeOllama(vectors: Record<string, number[]>, digest = 'model-digest-1') {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null;
    calls.push({ url, body });
    if (url.endsWith('/api/tags')) {
      return Response.json({ models: [{ name: 'nomic-embed-text-v2-moe:latest', digest }] });
    }
    if (url.endsWith('/api/embed')) {
      const payload = body as { input: string | string[] };
      const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
      return Response.json({ embeddings: inputs.map((input) => vectors[input]) });
    }
    return new Response('missing', { status: 404 });
  });
  return { fetcher, calls };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('OllamaAssetIndex', () => {
  it('ranks selected local text embeddings and reopens a digest-bound index without leaking rights metadata', async () => {
    const root = fixture();
    const city = record('a', '霓虹街道');
    const kitchen = record('b', '厨房做饭');
    const records = [city, kitchen];
    const ollama = fakeOllama({
      'search_document: 霓虹街道\n霓虹街道': [1, 0],
      'search_document: 厨房做饭\n厨房做饭': [0, 1],
      'search_query: 夜晚城市': [0.9, 0.1],
    });
    const index = new OllamaAssetIndex({ rootDir: root, fetcher: ollama.fetcher });
    expect(await index.indexRecords(records)).toMatchObject({ indexedCount: 2, modelDigest: 'model-digest-1' });
    const hits = await index.searchPort(records)(records.map((item) => item.entry.asset.id), query);
    expect(hits.map((hit) => hit.assetId)).toEqual([city.entry.asset.id, kitchen.entry.asset.id]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(await index.searchPort(records)([kitchen.entry.asset.id], query)).toHaveLength(1);
    expect(JSON.stringify(ollama.calls.filter((call) => call.url.endsWith('/api/embed')))).not.toMatch(/secret|media\//);
    expect(ollama.calls.every((call) => call.url.startsWith('http://127.0.0.1:11434/'))).toBe(true);
    expect(ollama.calls.find((call) => call.url.endsWith('/api/embed'))?.body).toMatchObject({
      model: 'nomic-embed-text-v2-moe:latest', truncate: false,
    });
    expect((ollama.calls.find((call) => call.url.endsWith('/api/embed'))?.body as { input: string[] }).input)
      .toEqual(['search_document: 霓虹街道\n霓虹街道', 'search_document: 厨房做饭\n厨房做饭']);
    expect(readFileSync(join(root, 'semantic-index.json'), 'utf8')).not.toContain('source-secret');

    const reopened = new OllamaAssetIndex({ rootDir: root, fetcher: ollama.fetcher });
    expect(await reopened.searchPort(records)([city.entry.asset.id], query)).toHaveLength(1);
  });

  it('fails closed when description, tags, asset digest or model digest differs from indexed state', async () => {
    const root = fixture();
    const city = record('a', '霓虹街道');
    const ollama = fakeOllama({ 'search_document: 霓虹街道\n霓虹街道': [1, 0],
      'search_query: 夜晚城市': [1, 0] });
    const index = new OllamaAssetIndex({ rootDir: root, fetcher: ollama.fetcher });
    await index.indexRecords([city]);
    const changedText = { ...city, semanticText: '另一描述' };
    await expect(index.searchPort([changedText])([city.entry.asset.id], query)).rejects.toThrow();
    const changedTags = { ...city, entry: { ...city.entry,
      asset: { ...city.entry.asset, tags: ['其他'] } } };
    await expect(index.searchPort([changedTags])([city.entry.asset.id], query)).rejects.toThrow();
    const changedSha = { ...city, entry: { ...city.entry,
      asset: { ...city.entry.asset, sha256: 'c'.repeat(64) } } };
    await expect(index.searchPort([changedSha])([city.entry.asset.id], query)).rejects.toThrow();
    const changedModel = fakeOllama({ 'search_query: 夜晚城市': [1, 0] }, 'model-digest-2');
    const reopened = new OllamaAssetIndex({ rootDir: root, fetcher: changedModel.fetcher });
    await expect(reopened.searchPort([city])([city.entry.asset.id], query)).rejects.toThrow();
  });

  it('rejects missing or malformed embeddings, wrong dimensions, missing model, and unavailable local service', async () => {
    const root = fixture();
    const city = record('a', '霓虹街道');
    const absent = new OllamaAssetIndex({ rootDir: root, fetcher: fakeOllama({}).fetcher });
    await expect(absent.searchPort([city])([city.entry.asset.id], query)).rejects.toThrow();
    const bad = fakeOllama({ 'search_document: 霓虹街道\n霓虹街道': [1, Number.NaN] });
    await expect(new OllamaAssetIndex({ rootDir: root, fetcher: bad.fetcher }).indexRecords([city])).rejects.toThrow();
    const noModel = vi.fn(async (): Promise<Response> => Response.json({ models: [] }));
    await expect(new OllamaAssetIndex({ rootDir: root, fetcher: noModel }).indexRecords([city])).rejects.toThrow();
    const unreachable = vi.fn(async (): Promise<Response> => { throw new Error('offline'); });
    await expect(new OllamaAssetIndex({ rootDir: root, fetcher: unreachable }).indexRecords([city])).rejects.toThrow();
    const mismatch = fakeOllama({
      'search_document: 霓虹街道\n霓虹街道': [1, 0],
      'search_document: 厨房做饭\n厨房做饭': [1, 0, 0],
    });
    await expect(new OllamaAssetIndex({ rootDir: root, fetcher: mismatch.fetcher }).indexRecords([
      city, record('b', '厨房做饭'),
    ])).rejects.toThrow();
  });

  it('does not commit mixed embeddings if the local model changes during indexing', async () => {
    const root = fixture();
    let tagsCalls = 0;
    const fetcher = vi.fn(async (url: string): Promise<Response> => {
      if (url.endsWith('/api/tags')) {
        tagsCalls += 1;
        return Response.json({ models: [{ name: 'nomic-embed-text-v2-moe:latest',
          digest: tagsCalls === 1 ? 'digest-1' : 'digest-2' }] });
      }
      return Response.json({ embeddings: [[1, 0]] });
    });
    const index = new OllamaAssetIndex({ rootDir: root, fetcher });
    await expect(index.indexRecords([record('a', '霓虹街道')])).rejects.toThrow();
    expect(existsSync(join(root, 'semantic-index.json'))).toBe(false);
  });

  it('binds indexed vectors to an immutable asset identity snapshot across asynchronous inference', async () => {
    const root = fixture();
    const original = record('a', '霓虹街道');
    const mutable = { ...original, entry: { ...original.entry,
      asset: { ...original.entry.asset } } };
    let started!: () => void;
    const embeddingStarted = new Promise<void>((resolve) => { started = resolve; });
    let finish!: () => void;
    const embedding = new Promise<Response>((resolve) => {
      finish = () => resolve(Response.json({ embeddings: [[1, 0]] }));
    });
    const fetcher = vi.fn(async (url: string): Promise<Response> => {
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'nomic-embed-text-v2-moe:latest', digest: 'digest-1' }] });
      }
      started();
      return embedding;
    });
    const index = new OllamaAssetIndex({ rootDir: root, fetcher });
    const pending = index.indexRecords([mutable]);
    await embeddingStarted;
    mutable.entry.asset.sha256 = 'b'.repeat(64);
    finish();
    await pending;
    const stored = JSON.parse(readFileSync(join(root, 'semantic-index.json'), 'utf8')) as {
      rows: Array<{ assetId: string; assetSha256: string }>;
    };
    expect(stored.rows[0]).toMatchObject({
      assetId: original.entry.asset.id, assetSha256: original.entry.asset.sha256,
    });
  });

  it('lets the existing authorization gate exclude unapproved IDs before semantic search', async () => {
    const root = fixture();
    const allowed = record('a', '霓虹街道');
    const denied = record('b', '厨房做饭', false);
    const ollama = fakeOllama({
      'search_document: 霓虹街道\n霓虹街道': [1, 0],
      'search_document: 厨房做饭\n厨房做饭': [0, 1],
      'search_query: 夜晚城市': [1, 0],
    });
    const index = new OllamaAssetIndex({ rootDir: root, fetcher: ollama.fetcher });
    await index.indexRecords([allowed, denied]);
    const result = await recommendBrollFromEntries(
      [allowed.entry, denied.entry], query,
      { platform: 'douyin', region: 'cn', usedAt: '2026-09-27T12:00:00.000Z', commercialShortVideo: true },
      index.searchPort([allowed, denied]),
    );
    expect(result.status).toBe('ok');
    expect(result.candidateAssetIds).toEqual([allowed.entry.asset.id]);
    expect(result.recommendations.map((item) => item.assetId)).toEqual([allowed.entry.asset.id]);
  });
});

// tests/script-workspace-resources.test.ts
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/lib/electron-api';
import {
  collectScriptResources,
  filterResources,
  groupResources,
  hydratePreviewMeta,
  listUncachedPreviewPaths,
  type PreviewMetaCache,
} from '../src/lib/workspace-resources';

const previewContent = JSON.stringify({
  schema: 'video-import-preview',
  version: 1,
  title: '周杰伦新专辑回归',
  videoId: 'v_abc123',
  sourceType: 'douyin',
  media: { videoPath: '/v.mp4' },
  transcript: { text: '', segments: [] },
  metadata: { sourceUrl: 'https://douyin.com/x' },
});

function makeEntries(): FileEntry[] {
  return [
    { name: 'original.md', type: 'file' },
    { name: 'script.md', type: 'file' },
    { name: 'notes.md', type: 'file' },
    {
      name: 'douyin',
      type: 'directory',
      children: [
        {
          name: 'v_abc123',
          type: 'directory',
          children: [
            { name: 'preview.json', type: 'file' },
            { name: 'video.mp4', type: 'file' },
          ],
        },
        {
          name: 'v_def456',
          type: 'directory',
          children: [{ name: 'preview.json', type: 'file' }],
        },
      ],
    },
  ];
}

describe('collectScriptResources', () => {
  it('groups original / script / douyin files and skips unrelated ones', () => {
    const cache: PreviewMetaCache = new Map();
    const items = collectScriptResources(makeEntries(), cache);

    expect(items.map((i) => i.path)).toEqual([
      'original.md',
      'script.md',
      'douyin/v_abc123/preview.json',
      'douyin/v_def456/preview.json',
    ]);
    expect(items[0].displayName).toBe('原始文稿');
    expect(items[1].displayName).toBe('口播脚本');
    expect(items[2].displayName).toBe('v_abc123');
    expect(items[2].loading).toBe(true);
  });

  it('uses cached title for douyin previews', () => {
    const cache: PreviewMetaCache = new Map([
      ['douyin/v_abc123/preview.json', { title: '周杰伦新专辑回归', videoId: 'v_abc123' }],
    ]);
    const items = collectScriptResources(makeEntries(), cache);
    const hit = items.find((i) => i.path === 'douyin/v_abc123/preview.json');
    expect(hit?.displayName).toBe('周杰伦新专辑回归');
    expect(hit?.subtitle).toBe('抖音 · v_abc123');
    expect(hit?.loading).toBeUndefined();
  });

  it('falls back when cache marks a preview as failed', () => {
    const cache: PreviewMetaCache = new Map([
      ['douyin/v_abc123/preview.json', 'failed' as const],
    ]);
    const items = collectScriptResources(makeEntries(), cache);
    const hit = items.find((i) => i.path === 'douyin/v_abc123/preview.json');
    expect(hit?.displayName).toBe('v_abc123');
    expect(hit?.subtitle).toBe('抖音 · 解析失败');
  });
});

describe('hydratePreviewMeta', () => {
  it('parses valid preview and writes cache', async () => {
    const cache: PreviewMetaCache = new Map();
    const loader = async (_dir: string, rel: string) =>
      rel === 'douyin/v_abc123/preview.json' ? previewContent : null;
    await hydratePreviewMeta('/proj', ['douyin/v_abc123/preview.json'], cache, loader);
    expect(cache.get('douyin/v_abc123/preview.json')).toEqual({
      title: '周杰伦新专辑回归',
      videoId: 'v_abc123',
      sourceType: 'douyin',
    });
  });

  it('marks failed when file missing or schema invalid', async () => {
    const cache: PreviewMetaCache = new Map();
    const loader = async (_dir: string, rel: string) => (rel === 'a' ? null : '{"bad":true}');
    await hydratePreviewMeta('/proj', ['a', 'b'], cache, loader);
    expect(cache.get('a')).toBe('failed');
    expect(cache.get('b')).toBe('failed');
  });
});

describe('listUncachedPreviewPaths', () => {
  it('returns only douyin items missing from cache', () => {
    const cache: PreviewMetaCache = new Map([
      ['douyin/v_abc123/preview.json', { title: 't', videoId: 'v_abc123' }],
    ]);
    const items = collectScriptResources(makeEntries(), cache);
    expect(listUncachedPreviewPaths(items, cache)).toEqual(['douyin/v_def456/preview.json']);
  });
});

describe('filterResources', () => {
  it('matches displayName / subtitle / path case-insensitively', () => {
    const items = collectScriptResources(makeEntries(), new Map());
    expect(filterResources(items, '原始').length).toBe(1);
    expect(filterResources(items, 'ABC123').length).toBe(1);
    expect(filterResources(items, 'script.md').length).toBe(1);
    expect(filterResources(items, '')).toHaveLength(items.length);
  });
});

describe('groupResources', () => {
  it('splits items by group', () => {
    const items = collectScriptResources(makeEntries(), new Map());
    const g = groupResources(items);
    expect(g.original).toHaveLength(1);
    expect(g.script).toHaveLength(1);
    expect(g.douyin).toHaveLength(2);
    expect(g.local_video).toHaveLength(0);
    expect(g.local_audio).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildJimengImageRequest,
  extractJimengImageUrl,
  extractJimengImageUrls,
} from '../src/lib/jimeng-client';
import type { ImageProvider } from '../src/types/ai';

const provider: ImageProvider = {
  id: 'jimeng-default',
  name: '即梦',
  type: 'jimeng',
  baseUrl: 'https://jimeng.example.com/',
  apiKey: 'session-test',
  models: ['jimeng-5.0'],
};

describe('buildJimengImageRequest (legacy compat)', () => {
  it('builds a Jimeng generation request with the expected defaults', () => {
    const request = buildJimengImageRequest('一张科技感播客封面', provider, 'jimeng-5.0');
    expect(request.url).toBe('https://jimeng.example.com/v1/images/generations');
    expect(request.headers.Authorization).toBe('Bearer session-test');
    expect(request.body.model).toBe('jimeng-5.0');
    expect(request.body.ratio).toBe('16:9');
    expect(request.body.n).toBe(4);
  });

  it('uses the passed model argument', () => {
    const request = buildJimengImageRequest('封面', provider, 'jimeng-3.0');
    expect(request.body.model).toBe('jimeng-3.0');
  });

  it('falls back to DEFAULT_JIMENG_MODEL when model is empty', () => {
    const request = buildJimengImageRequest('封面', provider, '');
    expect(request.body.model).toBe('jimeng-5.0');
  });

  it('accepts a custom n parameter', () => {
    const request = buildJimengImageRequest('封面', provider, 'jimeng-5.0', 1);
    expect(request.body.n).toBe(1);
  });
});

describe('extractJimengImageUrls', () => {
  it('returns all image urls from the api response', () => {
    expect(
      extractJimengImageUrls({
        data: [
          { url: 'https://example.com/cover1.png' },
          { url: 'https://example.com/cover2.png' },
          { url: 'https://example.com/cover3.png' },
          { url: 'https://example.com/cover4.png' },
        ],
      }),
    ).toEqual([
      'https://example.com/cover1.png',
      'https://example.com/cover2.png',
      'https://example.com/cover3.png',
      'https://example.com/cover4.png',
    ]);
  });

  it('filters out null and empty urls', () => {
    expect(
      extractJimengImageUrls({
        data: [{ url: 'https://example.com/cover.png' }, { url: null }, null],
      }),
    ).toEqual(['https://example.com/cover.png']);
  });

  it('returns empty array for empty data', () => {
    expect(extractJimengImageUrls({ data: [] })).toEqual([]);
  });
});

describe('extractJimengImageUrl', () => {
  it('returns the first image url from the api response', () => {
    expect(
      extractJimengImageUrl({
        data: [{ url: 'https://example.com/cover.png' }],
      }),
    ).toBe('https://example.com/cover.png');
  });

  it('returns null for malformed api payloads', () => {
    expect(extractJimengImageUrl({ data: [] })).toBeNull();
  });
});

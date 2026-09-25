import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ImageProvider } from '../src/types/ai';

beforeEach(() => {
  vi.restoreAllMocks();
});

import { generateCoverImage } from '../src/lib/cover-generation';

describe('generateCoverImage dispatcher', () => {
  it('jimeng 类型走 jimeng provider', async () => {
    const provider: ImageProvider = {
      id: 'i',
      name: 'j',
      type: 'jimeng',
      baseUrl: 'http://jimeng.test',
      apiKey: 'k',
      models: ['m'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ url: 'http://x/y.png' }] }), { status: 200 }),
    );
    const url = await generateCoverImage('prompt', provider, 'm');
    expect(url).toBe('http://x/y.png');
  });

  it('未知 provider type 抛 ImageGenerationError', async () => {
    const provider = {
      id: 'i',
      name: 'd',
      type: 'nonexistent_provider' as never,
      baseUrl: 'u',
      apiKey: 'k',
      models: ['m'],
    } as ImageProvider;
    await expect(generateCoverImage('p', provider, 'm')).rejects.toThrow(/未注册/);
  });

  it('custom 类型回退到 openai_image adapter（已注册时命中）', async () => {
    const provider: ImageProvider = {
      id: 'i',
      name: 'c',
      type: 'custom',
      baseUrl: 'http://my.openai',
      apiKey: 'k',
      models: ['gpt-image-1'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: 'http://x/c.png' }] }),
        { status: 200 },
      ),
    );
    const url = await generateCoverImage('p', provider, 'gpt-image-1');
    expect(url).toBe('http://x/c.png');
  });
});

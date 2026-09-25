import { describe, expect, it } from 'vitest';
import {
  getImageProvider,
  listRegisteredImageProviderTypes,
  registerImageProvider,
} from '../../src/lib/image-gen/registry';
import { ImageGenerationError } from '../../src/lib/image-gen/errors';
import type { ImageGenerationProvider } from '../../src/lib/image-gen/types';

describe('image-gen registry', () => {
  it('返回已注册的 jimeng provider', () => {
    const p = getImageProvider('jimeng');
    expect(p.type).toBe('jimeng');
  });

  it('未知 type 抛 ImageGenerationError(invalid_request)', () => {
    try {
      getImageProvider('nonexistent_provider' as never);
      throw new Error('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(ImageGenerationError);
      expect((e as ImageGenerationError).code).toBe('invalid_request');
    }
  });

  it('listRegisteredImageProviderTypes 包含全部 7 种内置 provider', () => {
    const types = listRegisteredImageProviderTypes();
    expect(types).toEqual(
      expect.arrayContaining([
        'jimeng',
        'openai_image',
        'minimax',
        'doubao',
        'imagen',
        'wanx',
        'apimart',
      ]),
    );
  });

  it('custom 回退到 openai_image adapter', () => {
    const p = getImageProvider('custom');
    expect(p.type).toBe('openai_image');
  });

  it('registerImageProvider 可覆盖已注册项', () => {
    const fake: ImageGenerationProvider = {
      type: 'jimeng',
      capabilities: {
        aspectRatios: ['1:1'],
        maxN: 1,
        supportsImageToImage: false,
        isAsync: false,
        defaultModels: ['fake'],
      },
      generate: async () => ({ images: [{ url: 'fake' }] }),
    };
    const original = getImageProvider('jimeng');
    registerImageProvider(fake);
    expect(getImageProvider('jimeng')).toBe(fake);
    // 还原
    registerImageProvider(original);
  });
});

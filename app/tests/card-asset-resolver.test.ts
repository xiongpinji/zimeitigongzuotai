import { describe, expect, it } from 'vitest';
import { makeCardAssetResolver } from '../src/remotion/card-asset';

const deps = {
  staticFile: (rel: string) => `STATIC:${rel}`,
  toFileSrc: (abs: string) => `FILE:${abs}`,
};

describe('makeCardAssetResolver', () => {
  it('uses staticFile when rendering (export)', () => {
    const cardAsset = makeCardAssetResolver({ isRendering: true, projectDir: '/p', ...deps });
    expect(cardAsset('assets/x.png')).toBe('STATIC:assets/x.png');
    expect(cardAsset('./assets/x.png')).toBe('STATIC:assets/x.png');
  });

  it('uses file:// under project dir when previewing', () => {
    const cardAsset = makeCardAssetResolver({
      isRendering: false,
      projectDir: '/Users/me/proj/',
      ...deps,
    });
    expect(cardAsset('assets/x.png')).toBe('FILE:/Users/me/proj/assets/x.png');
  });

  it('falls back to staticFile in preview when no project dir', () => {
    const cardAsset = makeCardAssetResolver({ isRendering: false, projectDir: null, ...deps });
    expect(cardAsset('assets/x.png')).toBe('STATIC:assets/x.png');
  });

  it('passes through absolute/remote/data sources untouched', () => {
    const cardAsset = makeCardAssetResolver({ isRendering: false, projectDir: '/p', ...deps });
    expect(cardAsset('https://e.com/a.png')).toBe('https://e.com/a.png');
    expect(cardAsset('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(cardAsset('file:///x.png')).toBe('file:///x.png');
  });
});

import { describe, expect, it } from 'vitest';
import { fitPreviewStage, getPreviewCompositionSize } from '../src/lib/preview';

describe('getPreviewCompositionSize', () => {
  it('caps a 1080p timeline to a lighter preview resolution while keeping aspect ratio', () => {
    expect(getPreviewCompositionSize(1920, 1080)).toEqual({
      width: 960,
      height: 540,
      scale: 0.5,
    });
  });

  it('does not upscale smaller timelines', () => {
    expect(getPreviewCompositionSize(720, 1280)).toEqual({
      width: 720,
      height: 1280,
      scale: 1,
    });
  });
});

describe('fitPreviewStage', () => {
  it('fits a 16:9 preview by height when the container is wider than the content ratio', () => {
    expect(fitPreviewStage(1200, 500, 960, 540)).toEqual({
      width: 889,
      height: 500,
    });
  });

  it('fits a 16:9 preview by width when the container is narrower than the content ratio', () => {
    expect(fitPreviewStage(700, 600, 960, 540)).toEqual({
      width: 700,
      height: 394,
    });
  });
});

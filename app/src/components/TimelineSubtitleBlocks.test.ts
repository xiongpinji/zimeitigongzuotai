import { describe, expect, it } from 'vitest';
import { MANUAL_CARD_KIND_OPTIONS } from '../lib/manual-card-types';

describe('MANUAL_CARD_KIND_OPTIONS', () => {
  it('only exposes carrier card kinds in subtitle context menu', () => {
    expect(MANUAL_CARD_KIND_OPTIONS.map((item) => item.kind)).toEqual([
      'motion',
      'image',
      'video',
    ]);
    expect(MANUAL_CARD_KIND_OPTIONS.find((item) => item.kind === 'image')?.label).toBe('图片卡');
    expect(MANUAL_CARD_KIND_OPTIONS.find((item) => item.kind === 'video')?.label).toBe('视频卡');
  });
});

import { describe, expect, it } from 'vitest';
import { getVideoProvider, listRegisteredVideoProviderTypes } from '../src/lib/video-gen/registry';
import { VideoGenerationError } from '../src/lib/video-gen/errors';

describe('video-gen registry', () => {
  it('vidu 已注册', () => {
    const p = getVideoProvider('vidu');
    expect(p.type).toBe('vidu');
    expect(p.capabilities.durationOptions).toEqual(expect.arrayContaining([4, 6, 8]));
  });

  it('未知 type 抛 VideoGenerationError', () => {
    expect(() => getVideoProvider('not-exist' as never)).toThrow(VideoGenerationError);
  });

  it('listRegisteredVideoProviderTypes 包含 vidu', () => {
    expect(listRegisteredVideoProviderTypes()).toContain('vidu');
  });
});

import { describe, it, expect } from 'vitest';
import { extractVideoSources } from '@/adapter/source-extractor';

describe('extractVideoSources — url normalization', () => {
  it('upgrades protocol-relative urls to https', () => {
    const sources = extractVideoSources({
      play_addr: { url_list: ['//v3-web.douyinvod.com/fake/play.mp4?sign=X'], width: 720, height: 1280 },
    });
    expect(sources[0].url).toBe('https://v3-web.douyinvod.com/fake/play.mp4?sign=X');
  });

  it('upgrades bare http urls to https', () => {
    const sources = extractVideoSources({
      play_addr: { url_list: ['http://v3-web.douyinvod.com/fake/play.mp4'] },
    });
    expect(sources[0].url).toBe('https://v3-web.douyinvod.com/fake/play.mp4');
  });

  it('leaves https urls untouched and trims whitespace', () => {
    const sources = extractVideoSources({
      play_addr: { url_list: ['  https://v3-web.douyinvod.com/fake/play.mp4  '] },
    });
    expect(sources[0].url).toBe('https://v3-web.douyinvod.com/fake/play.mp4');
  });
});

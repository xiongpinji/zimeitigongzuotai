import { describe, it, expect } from 'vitest';
import { prependMuxedAudioSource } from '@/background/resolve-sources';
import type { VideoSource } from '@/domain/models';

const gear = (url: string): VideoSource => ({
  url,
  watermark: 'none',
  watermarkConfidence: 'high',
  watermarkEvidence: [],
  width: 1280,
  height: 720,
});

describe('prependMuxedAudioSource', () => {
  it('puts the snssdk play API muxed source first when a video_id is available', () => {
    const sources = [gear('https://v11-weba.douyinvod.com/video-only.mp4')];
    const out = prependMuxedAudioSource(sources, { play_addr: { uri: 'vid123' } });

    expect(out[0].url).toContain('aweme.snssdk.com/aweme/v1/play/');
    expect(out[0].url).toContain('video_id=vid123');
    expect(out).toHaveLength(2);
  });

  it('returns the sources unchanged when no video_id can be derived', () => {
    const sources = [gear('https://v11-weba.douyinvod.com/video-only.mp4')];
    expect(prependMuxedAudioSource(sources, {})).toEqual(sources);
    expect(prependMuxedAudioSource(sources, null)).toEqual(sources);
  });

  it('dedupes when the muxed url already exists in the list', () => {
    const muxedUrl = 'https://aweme.snssdk.com/aweme/v1/play/?video_id=vid123&ratio=1080p&line=0';
    const sources = [{ ...gear(muxedUrl), width: undefined, height: undefined }];
    const out = prependMuxedAudioSource(sources, { play_addr: { uri: 'vid123' } });

    expect(out).toHaveLength(1);
    expect(out[0].url).toBe(muxedUrl);
  });
});

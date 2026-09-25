import { describe, it, expect } from 'vitest';
import { detectPageFromUrl } from '@/adapter/page-detection';

describe('detectPageFromUrl', () => {
  it('detects a single video page and extracts the aweme id', () => {
    const r = detectPageFromUrl('https://www.douyin.com/video/7300000000000000001');
    expect(r.type).toBe('video');
    expect(r.awemeId).toBe('7300000000000000001');
  });

  it('detects a creator page and extracts the sec uid', () => {
    const r = detectPageFromUrl('https://www.douyin.com/user/MS4wLjABAAAAtestsecuid?foo=bar');
    expect(r.type).toBe('creator');
    expect(r.secUid).toBe('MS4wLjABAAAAtestsecuid');
  });

  it('detects a video modal via modal_id even on a creator url', () => {
    const r = detectPageFromUrl(
      'https://www.douyin.com/user/MS4wLjABAAAAtestsecuid?modal_id=7300000000000000002',
    );
    expect(r.type).toBe('video_modal');
    expect(r.awemeId).toBe('7300000000000000002');
  });

  it('detects a discover modal', () => {
    const r = detectPageFromUrl('https://www.douyin.com/discover?modal_id=7300000000000000003');
    expect(r.type).toBe('video_modal');
    expect(r.awemeId).toBe('7300000000000000003');
  });

  it('detects a short share link host', () => {
    const r = detectPageFromUrl('https://v.douyin.com/iAbCdEf/');
    expect(r.type).toBe('share_link');
  });

  it('returns unsupported for the douyin home page', () => {
    expect(detectPageFromUrl('https://www.douyin.com/').type).toBe('unsupported');
  });

  it('returns unsupported for non-douyin and malformed urls', () => {
    expect(detectPageFromUrl('https://example.com/video/123').type).toBe('unsupported');
    expect(detectPageFromUrl('::::not a url').type).toBe('unsupported');
  });

  it('ignores a non-numeric modal_id', () => {
    const r = detectPageFromUrl('https://www.douyin.com/user/MS4wabc?modal_id=notnumeric');
    expect(r.type).toBe('creator');
  });
});

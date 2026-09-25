import { describe, it, expect } from 'vitest';
import {
  matchTargetUrl,
  buildCapturedMessage,
  parseCapturedMessage,
  CAPTURE_MARKER_KEY,
} from '@/content/page-capture';

describe('matchTargetUrl', () => {
  it('recognizes the single-video detail endpoint', () => {
    expect(matchTargetUrl('https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7300')).toBe(
      'video_detail',
    );
  });

  it('recognizes the creator post-list endpoint', () => {
    expect(
      matchTargetUrl('https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=MS4wabc&count=18'),
    ).toBe('creator_videos');
  });

  it('recognizes the creator profile endpoint', () => {
    expect(
      matchTargetUrl('https://www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=MS4wabc'),
    ).toBe('creator_profile');
  });

  it('ignores unrelated douyin endpoints', () => {
    expect(matchTargetUrl('https://www.douyin.com/aweme/v1/web/im/spotlight/relation/')).toBeNull();
  });

  it('ignores non-douyin and malformed urls', () => {
    expect(matchTargetUrl('https://example.com/aweme/v1/web/aweme/detail/')).toBeNull();
    expect(matchTargetUrl('not a url')).toBeNull();
  });
});

describe('buildCapturedMessage', () => {
  it('wraps payload with the session marker, category and url', () => {
    const msg = buildCapturedMessage({
      sessionId: 'sess-1',
      category: 'video_detail',
      url: 'https://www.douyin.com/aweme/v1/web/aweme/detail/',
      payload: { aweme_detail: { aweme_id: '7300' } },
    });
    expect(msg).not.toBeNull();
    expect(msg![CAPTURE_MARKER_KEY]).toBe('sess-1');
    expect(msg!.category).toBe('video_detail');
    expect(msg!.payload).toEqual({ aweme_detail: { aweme_id: '7300' } });
  });

  it('returns null when the payload exceeds the byte budget', () => {
    const big = { blob: 'x'.repeat(2000) };
    const msg = buildCapturedMessage({
      sessionId: 'sess-1',
      category: 'video_detail',
      url: 'https://www.douyin.com/x',
      payload: big,
      maxBytes: 500,
    });
    expect(msg).toBeNull();
  });

  it('returns null when payload is not JSON-serializable', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const msg = buildCapturedMessage({
      sessionId: 'sess-1',
      category: 'video_detail',
      url: 'https://www.douyin.com/x',
      payload: circular,
    });
    expect(msg).toBeNull();
  });
});

describe('parseCapturedMessage', () => {
  const good = buildCapturedMessage({
    sessionId: 'sess-1',
    category: 'creator_videos',
    url: 'https://www.douyin.com/aweme/v1/web/aweme/post/',
    payload: { aweme_list: [] },
  })!;

  it('accepts a message with the expected session marker', () => {
    const parsed = parseCapturedMessage(good, 'sess-1');
    expect(parsed).not.toBeNull();
    expect(parsed!.category).toBe('creator_videos');
  });

  it('rejects a message whose session marker does not match', () => {
    expect(parseCapturedMessage(good, 'other-session')).toBeNull();
  });

  it('rejects a message with an unknown category', () => {
    const tampered = { ...good, category: 'evil' };
    expect(parseCapturedMessage(tampered, 'sess-1')).toBeNull();
  });

  it('rejects non-object input', () => {
    expect(parseCapturedMessage('nope', 'sess-1')).toBeNull();
    expect(parseCapturedMessage(null, 'sess-1')).toBeNull();
  });
});

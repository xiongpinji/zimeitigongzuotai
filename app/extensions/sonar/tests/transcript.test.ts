import { describe, it, expect } from 'vitest';
import { formatSrtTimestamp, segmentsToSrt, normalizeAsrResponse } from '@/processing/transcript';

describe('formatSrtTimestamp', () => {
  it('formats milliseconds as HH:MM:SS,mmm', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(2500)).toBe('00:00:02,500');
    expect(formatSrtTimestamp(3661001)).toBe('01:01:01,001');
  });
});

describe('segmentsToSrt', () => {
  it('produces numbered SRT blocks', () => {
    const srt = segmentsToSrt([
      { text: '片段一', startMs: 0, endMs: 2500 },
      { text: '片段二', startMs: 2500, endMs: 5000 },
    ]);
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:02,500\n片段一\n\n2\n00:00:02,500 --> 00:00:05,000\n片段二\n',
    );
  });

  it('returns empty string for no segments', () => {
    expect(segmentsToSrt([])).toBe('');
  });
});

describe('normalizeAsrResponse', () => {
  it('maps OpenAI verbose_json seconds to millisecond segments', () => {
    const doc = normalizeAsrResponse(
      {
        text: '全文内容',
        language: 'chinese',
        segments: [
          { start: 0, end: 2.5, text: ' 片段一 ' },
          { start: 2.5, end: 5.0, text: '片段二' },
        ],
      },
      { videoId: 'v1', provider: 'openai', now: 100 },
    );
    expect(doc.videoId).toBe('v1');
    expect(doc.segments).toEqual([
      { text: '片段一', startMs: 0, endMs: 2500 },
      { text: '片段二', startMs: 2500, endMs: 5000 },
    ]);
    expect(doc.fullText).toBe('全文内容');
    expect(doc.srtText).toContain('00:00:00,000 --> 00:00:02,500');
    expect(doc.createdAt).toBe(100);
    expect(doc.language).toBe('chinese');
  });

  it('falls back to joined segment text when top-level text is missing', () => {
    const doc = normalizeAsrResponse(
      { segments: [{ start: 0, end: 1, text: 'a' }, { start: 1, end: 2, text: 'b' }] },
      { videoId: 'v1', provider: 'openai', now: 0, languageFallback: 'zh' },
    );
    expect(doc.fullText).toBe('a b');
    expect(doc.language).toBe('zh');
  });

  it('handles a plain-text response with no segments', () => {
    const doc = normalizeAsrResponse({ text: '只有全文' }, { videoId: 'v1', provider: 'openai', now: 0 });
    expect(doc.fullText).toBe('只有全文');
    expect(doc.segments).toEqual([]);
    expect(doc.srtText).toBe('');
  });
});

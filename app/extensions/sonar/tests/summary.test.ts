import { describe, it, expect } from 'vitest';
import { chunkSegments, validateAnalysis } from '@/processing/summary';
import { SonarException } from '@/domain/errors';
import type { TranscriptSegment } from '@/domain/models';

const seg = (text: string, startMs: number, endMs: number): TranscriptSegment => ({ text, startMs, endMs });

describe('chunkSegments', () => {
  it('groups consecutive segments under the char budget', () => {
    const chunks = chunkSegments(
      [seg('aaaa', 0, 1000), seg('bbbb', 1000, 2000), seg('cccc', 2000, 3000)],
      8,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe('aaaa bbbb');
    expect(chunks[0].startMs).toBe(0);
    expect(chunks[0].endMs).toBe(2000);
    expect(chunks[1].text).toBe('cccc');
    expect(chunks[1].startMs).toBe(2000);
  });

  it('keeps a single chunk when everything fits', () => {
    const chunks = chunkSegments([seg('a', 0, 1), seg('b', 1, 2)], 1000);
    expect(chunks).toHaveLength(1);
  });

  it('returns empty for no segments', () => {
    expect(chunkSegments([], 100)).toEqual([]);
  });
});

describe('validateAnalysis', () => {
  const ctx = { videoId: 'v1', model: 'gpt-x', now: 42 };

  it('accepts a well-formed analysis', () => {
    const a = validateAnalysis(
      { category: '深度分析', summary: '这是摘要', keyPoints: ['点1', '点2'], tags: ['标签'] },
      ctx,
    );
    expect(a.videoId).toBe('v1');
    expect(a.category).toBe('深度分析');
    expect(a.keyPoints).toEqual(['点1', '点2']);
    expect(a.model).toBe('gpt-x');
    expect(a.createdAt).toBe(42);
  });

  it('rejects an unknown category', () => {
    expect(() => validateAnalysis({ category: '随便', summary: 's', keyPoints: [], tags: [] }, ctx)).toThrow(
      SonarException,
    );
  });

  it('rejects a missing or empty summary', () => {
    expect(() => validateAnalysis({ category: '深度分析', summary: '', keyPoints: [], tags: [] }, ctx)).toThrow();
  });

  it('coerces keyPoints and tags to string arrays, dropping non-strings', () => {
    const a = validateAnalysis(
      { category: '资讯快讯', summary: 's', keyPoints: ['ok', 1, null, '好'], tags: ['t', 2] },
      ctx,
    );
    expect(a.keyPoints).toEqual(['ok', '好']);
    expect(a.tags).toEqual(['t']);
  });

  it('throws SUMMARY_INVALID_RESPONSE code on invalid input', () => {
    try {
      validateAnalysis({ summary: 's' }, ctx);
      expect.unreachable();
    } catch (e) {
      expect((e as SonarException).error.code).toBe('SUMMARY_INVALID_RESPONSE');
    }
  });
});

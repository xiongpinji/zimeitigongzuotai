import { describe, it, expect } from 'vitest';
import { validateInsight } from '@/processing/insight';
import { SonarException } from '@/domain/errors';

const ctx = { videoId: 'v1', model: 'm', now: 123 };

describe('validateInsight', () => {
  it('收敛合法对象并补齐数组字段', () => {
    const r = validateInsight(
      {
        angle: ' 反常识 ',
        hook: '开头一句',
        structure: ['一', '', '二'],
        highlights: ['金句'],
        dataPoints: [],
        remixSuggestions: ['换案例', 123],
      },
      ctx,
    );
    expect(r).toEqual({
      videoId: 'v1',
      angle: '反常识',
      hook: '开头一句',
      structure: ['一', '二'],
      highlights: ['金句'],
      dataPoints: [],
      remixSuggestions: ['换案例'],
      model: 'm',
      createdAt: 123,
    });
  });

  it('缺 angle → INSIGHT_INVALID_RESPONSE', () => {
    try {
      validateInsight({ hook: 'h' }, ctx);
      expect.unreachable();
    } catch (e) {
      expect((e as SonarException).error.code).toBe('INSIGHT_INVALID_RESPONSE');
    }
  });

  it('缺 hook → INSIGHT_INVALID_RESPONSE', () => {
    expect(() => validateInsight({ angle: 'a' }, ctx)).toThrow();
  });

  it('非对象 → INSIGHT_INVALID_RESPONSE', () => {
    expect(() => validateInsight('x', ctx)).toThrow();
  });
});

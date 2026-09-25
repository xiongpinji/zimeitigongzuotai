import { describe, expect, it } from 'vitest';
import { parseSegmentPlanningResult } from '../src/lib/ai-analysis';

describe('segment analysis parsing', () => {
  it('parses semantic and visualization fields', () => {
    const result = parseSegmentPlanningResult({
      segments: [
        {
          id: 's1',
          title: '增长',
          summary: '讲增长',
          startMs: 0,
          endMs: 3000,
          semanticType: 'data',
          complexityLevel: 'medium',
          visualizationScore: 88,
          pacingNeed: 'accent',
          keywords: ['增长'],
          entities: ['营收'],
        },
      ],
      coverPrompts: [],
      summary: '',
      keywords: [],
    });

    expect(result?.segments[0].visualizationScore).toBe(88);
    expect(result?.segments[0].semanticType).toBe('data');
  });
});

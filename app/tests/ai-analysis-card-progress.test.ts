import { describe, it, expect } from 'vitest';
import { buildCardProgress } from '../src/lib/ai-analysis';

describe('buildCardProgress', () => {
  it('start 事件携带段信息', () => {
    expect(
      buildCardProgress({ segmentIndex: 2, segmentId: 's2', title: '三国', visualType: 'motion', status: 'start' }),
    ).toEqual({
      phase: 'cards',
      percent: 30,
      card: { segmentIndex: 2, segmentId: 's2', title: '三国', visualType: 'motion', status: 'start' },
    });
  });

  it('done 事件透传 status', () => {
    const p = buildCardProgress({ segmentIndex: 0, segmentId: 's0', status: 'done' });
    expect(p.card?.status).toBe('done');
    expect(p.phase).toBe('cards');
  });

  it('failed 事件带 error', () => {
    const p = buildCardProgress({ segmentIndex: 1, segmentId: 's1', status: 'failed', error: 'boom' });
    expect(p.card?.error).toBe('boom');
  });
});

import { describe, it, expect } from 'vitest';
import { buildEditResult } from '../electron/ai-edit/result-writer';

describe('buildEditResult', () => {
  it('无错误 → ok', () => {
    const r = buildEditResult([], '2026-06-13T00:00:00Z');
    expect(r).toEqual({ ok: true, at: '2026-06-13T00:00:00Z', errors: [] });
  });
  it('有错误 → not ok', () => {
    const r = buildEditResult([{ field: 'overlays[0].startMs', message: 'bad' }], 'T');
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
  });
});

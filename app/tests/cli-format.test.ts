// tests/cli-format.test.ts
import { describe, it, expect } from 'vitest';
import { output } from '../cli/src/format';

describe('output', () => {
  it('returns pretty JSON when json=true', () => {
    expect(output({ a: 1 }, true)).toBe('{\n  "a": 1\n}');
  });

  it('returns string as-is when human and data is string', () => {
    expect(output('hello', false)).toBe('hello');
  });

  it('renders array of objects one line each', () => {
    const out = output([{ id: 'x', status: 'running' }], false);
    expect(out).toContain('id: x');
    expect(out).toContain('status: running');
  });

  it('renders null as (空)', () => {
    expect(output(null, false)).toBe('(空)');
  });
});

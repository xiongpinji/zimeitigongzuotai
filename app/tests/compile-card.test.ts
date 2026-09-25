import { describe, expect, it } from 'vitest';
import { hasRenderableJsx, stripCodeFences, validateCardTsx } from '../src/remotion/compile-card';

describe('hasRenderableJsx', () => {
  it('returns true when the source contains a JSX tag', () => {
    expect(hasRenderableJsx('export default () => <AbsoluteFill>hi</AbsoluteFill>;')).toBe(true);
    expect(hasRenderableJsx('return <div className="x" />;')).toBe(true);
  });

  it('returns false for a stubbed / null-returning component (would render black)', () => {
    expect(hasRenderableJsx('export default function X(){ const f = 1; /* ... */ }')).toBe(false);
    expect(hasRenderableJsx('export default () => null;')).toBe(false);
  });
});

describe('validateCardTsx', () => {
  it('rejects empty source', () => {
    expect(validateCardTsx('').ok).toBe(false);
    expect(validateCardTsx('   ').ok).toBe(false);
  });

  it('requires a default export', () => {
    expect(validateCardTsx('const X = () => null;').ok).toBe(false);
    expect(validateCardTsx('export default function X(){ return null; }').ok).toBe(true);
  });

  it('strips code fences', () => {
    expect(stripCodeFences('```tsx\nexport default 1\n```')).toBe('export default 1');
    expect(stripCodeFences('```\nexport default 1\n```')).toBe('export default 1');
  });

  it('accepts fenced valid source', () => {
    expect(validateCardTsx('```tsx\nexport default () => null\n```').ok).toBe(true);
  });
});

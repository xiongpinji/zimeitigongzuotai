import { describe, expect, it } from 'vitest';
import { compileMotionSource } from '../src/lib/motion-compiler';

const VALID_REMOTION_MOTION = `import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
export default function MotionCard() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity }}>ok</AbsoluteFill>;
}`;

describe('motion-compiler', () => {
  it('accepts a Remotion TSX component with a default export', () => {
    const result = compileMotionSource(VALID_REMOTION_MOTION);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.tsx).toContain('export default');
      expect(result.tsx).toContain('useCurrentFrame');
    }
  });

  it('strips markdown tsx fences before validating', () => {
    const result = compileMotionSource(`\`\`\`tsx\n${VALID_REMOTION_MOTION}\n\`\`\``);

    expect(result.success).toBe(true);
  });

  it('rejects sources without a default export', () => {
    const result = compileMotionSource('const MotionComponent = () => null;');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('default export');
    }
  });

  it('rejects empty sources', () => {
    const result = compileMotionSource('   ');

    expect(result.success).toBe(false);
  });
});

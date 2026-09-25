import { describe, expect, it } from 'vitest';
import { durationFrames, framesToMs, msToFrames } from '../src/remotion/frames';

describe('frames util', () => {
  it('rounds ms to nearest frame at 30fps', () => {
    expect(msToFrames(0, 30)).toBe(0);
    expect(msToFrames(1000, 30)).toBe(30);
    expect(msToFrames(33, 30)).toBe(1); // 33ms ≈ 0.99 frame → 1
  });
  it('durationFrames is at least 1 for tiny positive spans', () => {
    expect(durationFrames(1, 30)).toBe(1);
    expect(durationFrames(0, 30)).toBe(1);
  });
  it('framesToMs inverts msToFrames at frame boundaries', () => {
    expect(framesToMs(30, 30)).toBe(1000);
  });
});

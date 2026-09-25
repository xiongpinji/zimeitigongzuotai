import { describe, expect, it } from 'vitest';
import { getTextAnimationStyle } from '../src/lib/text-animations';
import type { TextAnimation } from '../src/types';

const NO_ANIMATION: TextAnimation = {
  enter: 'none',
  enterDurationMs: 500,
  exit: 'none',
  exitDurationMs: 500,
  loop: 'none',
};

describe('getTextAnimationStyle', () => {
  it('returns identity style when all animations are none', () => {
    const result = getTextAnimationStyle({
      frame: 15,
      fps: 30,
      durationFrames: 150,
      animation: NO_ANIMATION,
    });
    expect(result.style.opacity).toBe(1);
    expect(result.style.transform).toBeUndefined();
    expect(result.visibleText).toBeUndefined();
  });

  it('fades in during enter phase', () => {
    const result = getTextAnimationStyle({
      frame: 0,
      fps: 30,
      durationFrames: 150,
      animation: { ...NO_ANIMATION, enter: 'fadeIn', enterDurationMs: 500 },
    });
    expect(result.style.opacity).toBe(0);
  });

  it('fully visible after enter phase completes', () => {
    const enterFrames = Math.ceil((500 / 1000) * 30); // 15 frames
    const result = getTextAnimationStyle({
      frame: enterFrames,
      fps: 30,
      durationFrames: 150,
      animation: { ...NO_ANIMATION, enter: 'fadeIn', enterDurationMs: 500 },
    });
    expect(result.style.opacity).toBe(1);
  });

  it('fades out during exit phase', () => {
    const durationFrames = 150;
    const exitFrames = Math.ceil((500 / 1000) * 30); // 15 frames
    const result = getTextAnimationStyle({
      frame: durationFrames - 1,
      fps: 30,
      durationFrames,
      animation: { ...NO_ANIMATION, exit: 'fadeOut', exitDurationMs: 500 },
    });
    expect(result.style.opacity).toBeLessThan(0.2);
  });

  it('applies slideInLeft with translateX', () => {
    const result = getTextAnimationStyle({
      frame: 0,
      fps: 30,
      durationFrames: 150,
      animation: { ...NO_ANIMATION, enter: 'slideInLeft', enterDurationMs: 500 },
    });
    expect(result.style.opacity).toBe(0);
    expect(result.style.transform).toContain('translateX');
  });

  it('applies scaleIn with scale transform', () => {
    const result = getTextAnimationStyle({
      frame: 0,
      fps: 30,
      durationFrames: 150,
      animation: { ...NO_ANIMATION, enter: 'scaleIn', enterDurationMs: 500 },
    });
    expect(result.style.opacity).toBe(0);
    expect(result.style.transform).toContain('scale(');
  });

  it('pulse loop modulates opacity', () => {
    const enterFrames = 15;
    const result = getTextAnimationStyle({
      frame: enterFrames + 10,
      fps: 30,
      durationFrames: 300,
      animation: { ...NO_ANIMATION, loop: 'pulse' },
    });
    expect(result.style.opacity).toBeGreaterThanOrEqual(0.6);
    expect(result.style.opacity).toBeLessThanOrEqual(1);
  });

  it('typewriter returns partial visibleText', () => {
    const result = getTextAnimationStyle({
      frame: 3,
      fps: 30,
      durationFrames: 300,
      animation: { ...NO_ANIMATION, loop: 'typewriter' },
      content: 'Hello World',
    });
    expect(result.visibleText).toBeDefined();
    expect(result.visibleText!.length).toBeLessThan('Hello World'.length);
  });

  it('clamps enterDuration + exitDuration to not exceed total duration', () => {
    const result = getTextAnimationStyle({
      frame: 0,
      fps: 30,
      durationFrames: 10, // very short: 333ms
      animation: {
        enter: 'fadeIn',
        enterDurationMs: 500,
        exit: 'fadeOut',
        exitDurationMs: 500,
        loop: 'none',
      },
    });
    expect(result.style.opacity).toBeGreaterThanOrEqual(0);
    expect(result.style.opacity).toBeLessThanOrEqual(1);
  });
});

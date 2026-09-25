import { describe, it, expect } from 'vitest';
import { computeAutoScrollDelta } from '../src/lib/timeline-autoscroll';

describe('computeAutoScrollDelta', () => {
  const viewport = { left: 100, right: 900, top: 0, bottom: 400 };
  const hotzone = 40;
  const maxSpeed = 800;
  const dtMs = 16;

  it('returns 0 when pointer is inside safe area', () => {
    expect(
      computeAutoScrollDelta({ x: 500, y: 200, viewport, hotzone, maxSpeed, dtMs }),
    ).toEqual({ dx: 0, dy: 0 });
  });

  it('scrolls left when pointer enters left hotzone', () => {
    const { dx } = computeAutoScrollDelta({
      x: 110, y: 200, viewport, hotzone, maxSpeed, dtMs,
    });
    expect(dx).toBeLessThan(0);
  });

  it('scrolls right when pointer enters right hotzone', () => {
    const { dx } = computeAutoScrollDelta({
      x: 890, y: 200, viewport, hotzone, maxSpeed, dtMs,
    });
    expect(dx).toBeGreaterThan(0);
  });

  it('accelerates linearly with depth', () => {
    const shallow = computeAutoScrollDelta({
      x: 880, y: 200, viewport, hotzone, maxSpeed, dtMs,
    }).dx;
    const deep = computeAutoScrollDelta({
      x: 899, y: 200, viewport, hotzone, maxSpeed, dtMs,
    }).dx;
    expect(deep).toBeGreaterThan(shallow);
  });

  it('caps at maxSpeed', () => {
    const { dx } = computeAutoScrollDelta({
      x: 900, y: 200, viewport, hotzone, maxSpeed, dtMs,
    });
    const expectedCap = (maxSpeed * dtMs) / 1000;
    expect(dx).toBeLessThanOrEqual(expectedCap + 1e-6);
  });
});

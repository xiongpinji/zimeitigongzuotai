import { describe, expect, it } from 'vitest';
import { computeFloatingPosition } from '../src/ui/components/floating';

describe('computeFloatingPosition', () => {
  it('keeps an end-aligned bottom popover inside the right viewport edge', () => {
    const position = computeFloatingPosition({
      triggerRect: {
        top: 24,
        left: 944,
        right: 984,
        bottom: 54,
        width: 40,
        height: 30,
      },
      contentRect: {
        width: 340,
        height: 220,
      },
      viewportRect: {
        width: 1000,
        height: 800,
      },
      side: 'bottom',
      align: 'end',
      sideOffset: 6,
      viewportPadding: 8,
    });

    expect(position.left).toBe(644);
    expect(position.top).toBe(60);
  });

  it('clamps a centered tooltip away from the left viewport edge', () => {
    const position = computeFloatingPosition({
      triggerRect: {
        top: 100,
        left: 4,
        right: 28,
        bottom: 124,
        width: 24,
        height: 24,
      },
      contentRect: {
        width: 120,
        height: 40,
      },
      viewportRect: {
        width: 800,
        height: 600,
      },
      side: 'bottom',
      align: 'center',
      sideOffset: 8,
      viewportPadding: 8,
    });

    expect(position.left).toBe(8);
    expect(position.top).toBe(132);
  });
});

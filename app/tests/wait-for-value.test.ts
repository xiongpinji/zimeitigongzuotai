import { describe, expect, it } from 'vitest';
import { waitForValue } from '../src/lib/wait-for-value';

describe('waitForValue', () => {
  it('returns immediately when getter already has a value', async () => {
    const result = await waitForValue(() => 'ready', {
      schedule: (resume) => resume(),
      maxAttempts: 3,
    });

    expect(result).toBe('ready');
  });

  it('keeps polling until the getter becomes available', async () => {
    let attempts = 0;

    const result = await waitForValue(
      () => {
        attempts += 1;
        return attempts >= 3 ? 'editor-view' : null;
      },
      {
        schedule: (resume) => resume(),
        maxAttempts: 5,
      },
    );

    expect(result).toBe('editor-view');
    expect(attempts).toBe(3);
  });

  it('returns null after exhausting the polling budget', async () => {
    let attempts = 0;

    const result = await waitForValue(
      () => {
        attempts += 1;
        return null;
      },
      {
        schedule: (resume) => resume(),
        maxAttempts: 2,
      },
    );

    expect(result).toBeNull();
    expect(attempts).toBe(3);
  });
});

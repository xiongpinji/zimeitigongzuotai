import { describe, expect, it } from 'vitest';
import { patchStatuses } from '@/ui/video-status';

describe('video status', () => {
  it('marks every requested video as read without losing other status fields', () => {
    const result = patchStatuses(
      {
        v1: { read: false, flagged: true },
        v2: { archived: true },
        untouched: { read: false },
      },
      ['v1', 'v2'],
      { read: true },
    );

    expect(result).toEqual({
      v1: { read: true, flagged: true },
      v2: { read: true, archived: true },
      untouched: { read: false },
    });
  });

  it('can switch an individual video back to unread', () => {
    expect(patchStatuses({ v1: { read: true } }, ['v1'], { read: false })).toEqual({
      v1: { read: false },
    });
  });
});

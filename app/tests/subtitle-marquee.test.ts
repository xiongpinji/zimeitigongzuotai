import { describe, expect, it } from 'vitest';
import type { SrtEntry } from '../src/types';
import {
  hitTestSubtitlesByRect,
  summarizeSubtitleSelection,
} from '../src/lib/subtitle-marquee';

function makeEntry(index: number, startMs: number, endMs: number, text = `text-${index}`): SrtEntry {
  return { index, startMs, endMs, text };
}

describe('hitTestSubtitlesByRect', () => {
  const entries: SrtEntry[] = [
    makeEntry(1, 0, 1_000),
    makeEntry(2, 1_200, 2_000),
    makeEntry(3, 2_500, 3_200),
    makeEntry(4, 4_000, 5_000),
  ];
  const pxPerMs = 0.1; // 10ms -> 1px

  it('returns indices whose projected rect overlaps the marquee', () => {
    // rect 50–250 px -> 500–2500 ms, covers entries 1 + 2 (3 starts at 2500)
    const hits = hitTestSubtitlesByRect({
      entries,
      pxPerMs,
      rect: { left: 50, width: 200 },
    });
    expect(hits).toEqual([1, 2]);
  });

  it('handles reversed drag (negative width) by normalizing', () => {
    const hits = hitTestSubtitlesByRect({
      entries,
      pxPerMs,
      rect: { left: 250, width: -200 },
    });
    expect(hits).toEqual([1, 2]);
  });

  it('returns empty list when rect is outside any subtitle', () => {
    const hits = hitTestSubtitlesByRect({
      entries,
      pxPerMs,
      rect: { left: 320, width: 70 },
    });
    expect(hits).toEqual([]);
  });

  it('includes non-contiguous subtitles when the rect spans a silence gap', () => {
    // rect 150–450 px -> 1500–4500ms, touches entries 2, 3, 4
    const hits = hitTestSubtitlesByRect({
      entries,
      pxPerMs,
      rect: { left: 150, width: 300 },
    });
    expect(hits).toEqual([2, 3, 4]);
  });

  it('returns empty list for invalid pxPerMs', () => {
    const hits = hitTestSubtitlesByRect({
      entries,
      pxPerMs: 0,
      rect: { left: 10, width: 50 },
    });
    expect(hits).toEqual([]);
  });

  it('respects minOverlapRatio for partial hits', () => {
    // rect 950–1050 px -> 9500–10500ms, no overlap anyway
    const hits = hitTestSubtitlesByRect({
      entries,
      pxPerMs,
      rect: { left: 950, width: 100 },
      minOverlapRatio: 0.2,
    });
    expect(hits).toEqual([]);
  });
});

describe('summarizeSubtitleSelection', () => {
  const entries: SrtEntry[] = [
    makeEntry(1, 0, 1_000, '第一条'),
    makeEntry(2, 1_200, 2_000, '第二条'),
    makeEntry(3, 2_500, 3_200, '第三条'),
  ];

  it('returns null for empty selection', () => {
    expect(summarizeSubtitleSelection(entries, [])).toBeNull();
  });

  it('summarises selected range using first startMs and last endMs', () => {
    const summary = summarizeSubtitleSelection(entries, [2, 1]);
    expect(summary).toEqual({
      indices: [1, 2],
      startMs: 0,
      endMs: 2_000,
      text: '第一条\n第二条',
      count: 2,
    });
  });

  it('skips indices that do not exist', () => {
    const summary = summarizeSubtitleSelection(entries, [2, 99]);
    expect(summary?.indices).toEqual([2]);
    expect(summary?.startMs).toBe(1_200);
    expect(summary?.endMs).toBe(2_000);
  });

  it('returns null when no index matches any entry', () => {
    expect(summarizeSubtitleSelection(entries, [99, 100])).toBeNull();
  });
});

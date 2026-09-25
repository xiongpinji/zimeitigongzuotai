import { describe, expect, it } from 'vitest';
import type { SrtEntry, SubtitleHighlight } from '../src/types';
import {
  filterValidSubtitleHighlights,
  isExpiredSubtitleHighlight,
  isValidSubtitleHighlight,
  remapHighlightsAfterResegment,
} from '../src/lib/subtitle-highlights';

function createEntry(overrides: Partial<SrtEntry> = {}): SrtEntry {
  return {
    index: 1,
    startMs: 0,
    endMs: 2_000,
    text: '中国品牌首次拿下世界冠军',
    ...overrides,
  };
}

function createHighlight(overrides: Partial<SubtitleHighlight> = {}): SubtitleHighlight {
  return {
    entryIndex: 1,
    start: 8,
    end: 12,
    highlightText: '世界冠军',
    sourceText: '中国品牌首次拿下世界冠军',
    ...overrides,
  };
}

describe('subtitle highlight helpers', () => {
  it('accepts a highlight when the slice matches the source text', () => {
    expect(isValidSubtitleHighlight(createEntry(), createHighlight())).toBe(true);
  });

  it('rejects a highlight when the coordinates do not match the text slice', () => {
    expect(
      isValidSubtitleHighlight(
        createEntry(),
        createHighlight({
          start: 2,
          end: 6,
          highlightText: '世界冠军',
        }),
      ),
    ).toBe(false);
  });

  it('marks a highlight as expired when the subtitle text changes', () => {
    expect(
      isExpiredSubtitleHighlight(
        createEntry({
          text: '中国品牌终于拿下世界冠军',
        }),
        createHighlight(),
      ),
    ).toBe(true);
  });

  it('filters out invalid and expired highlights', () => {
    const entries = [
      createEntry(),
      createEntry({
        index: 2,
        text: '第二句没有保留原文',
      }),
    ];
    const highlights = [
      createHighlight(),
      createHighlight({
        entryIndex: 2,
        sourceText: '第二句原文',
      }),
      createHighlight({
        entryIndex: 99,
      }),
    ];

    expect(filterValidSubtitleHighlights(entries, highlights)).toEqual([createHighlight()]);
  });
});

describe('remapHighlightsAfterResegment', () => {
  it('remaps highlight to new entry when highlightText still present', () => {
    const oldHighlight: SubtitleHighlight = {
      entryIndex: 1,
      start: 8,
      end: 12,
      highlightText: '世界冠军',
      sourceText: '中国品牌首次拿下世界冠军',
    };
    const newEntries: SrtEntry[] = [
      { index: 1, startMs: 0, endMs: 1_000, text: '中国品牌首次拿下' },
      { index: 2, startMs: 1_000, endMs: 2_000, text: '世界冠军' },
    ];
    const { remapped, dropped } = remapHighlightsAfterResegment([oldHighlight], newEntries);
    expect(remapped).toHaveLength(1);
    expect(dropped).toHaveLength(0);
    expect(remapped[0]).toEqual({
      entryIndex: 2,
      start: 0,
      end: 4,
      highlightText: '世界冠军',
      sourceText: '世界冠军',
    });
  });

  it('drops highlight when text spans across split point', () => {
    const oldHighlight: SubtitleHighlight = {
      entryIndex: 1,
      start: 6,
      end: 10,
      highlightText: '拿下世界',
      sourceText: '中国品牌首次拿下世界冠军',
    };
    const newEntries: SrtEntry[] = [
      { index: 1, startMs: 0, endMs: 1_000, text: '中国品牌首次拿下' },
      { index: 2, startMs: 1_000, endMs: 2_000, text: '世界冠军' },
    ];
    const { remapped, dropped } = remapHighlightsAfterResegment([oldHighlight], newEntries);
    expect(remapped).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it('picks the first matching entry when multiple candidates exist', () => {
    const oldHighlight: SubtitleHighlight = {
      entryIndex: 1,
      start: 0,
      end: 2,
      highlightText: '创新',
      sourceText: '创新驱动',
    };
    const newEntries: SrtEntry[] = [
      { index: 1, startMs: 0, endMs: 500, text: '创新驱动' },
      { index: 2, startMs: 500, endMs: 1_000, text: '创新精神' },
    ];
    const { remapped } = remapHighlightsAfterResegment([oldHighlight], newEntries);
    expect(remapped).toHaveLength(1);
    expect(remapped[0].entryIndex).toBe(1);
  });

  it('handles empty inputs gracefully', () => {
    expect(remapHighlightsAfterResegment([], [])).toEqual({ remapped: [], dropped: [] });
  });
});

import { describe, expect, it } from 'vitest';
import type { SrtEntry } from '../src/types';
import { parseSubtitleHighlightResponse } from '../src/lib/subtitle-highlight-service';

function createEntry(index: number, text: string): SrtEntry {
  return {
    index,
    startMs: (index - 1) * 2_000,
    endMs: index * 2_000,
    text,
  };
}

describe('parseSubtitleHighlightResponse', () => {
  it('keeps valid highlight results and attaches source text', () => {
    const entries = [createEntry(1, '中国品牌首次拿下世界冠军')];

    expect(
      parseSubtitleHighlightResponse(
        {
          highlights: [
            {
              entryIndex: 1,
              shouldHighlight: true,
              highlightText: '世界冠军',
              start: 8,
              end: 12,
            },
          ],
        },
        entries,
      ),
    ).toEqual([
      {
        entryIndex: 1,
        highlightText: '世界冠军',
        start: 8,
        end: 12,
        sourceText: '中国品牌首次拿下世界冠军',
      },
    ]);
  });

  it('drops no-highlight results and invalid text slices', () => {
    const entries = [
      createEntry(1, '这一句没有重点'),
      createEntry(2, '这句里真正的重点是世界冠军'),
    ];

    expect(
      parseSubtitleHighlightResponse(
        {
          highlights: [
            {
              entryIndex: 1,
              shouldHighlight: false,
              highlightText: '',
              start: -1,
              end: -1,
            },
            {
              entryIndex: 2,
              shouldHighlight: true,
              highlightText: '世界冠军',
              start: 0,
              end: 4,
            },
          ],
        },
        entries,
      ),
    ).toEqual([]);
  });
});

import type { SrtEntry, SubtitleHighlight } from '../types';

export function isValidSubtitleHighlight(
  entry: SrtEntry | undefined,
  highlight: SubtitleHighlight,
): boolean {
  if (!entry || entry.index !== highlight.entryIndex) {
    return false;
  }

  if (highlight.start < 0 || highlight.end <= highlight.start) {
    return false;
  }

  if (highlight.end > highlight.sourceText.length) {
    return false;
  }

  return highlight.highlightText === highlight.sourceText.slice(highlight.start, highlight.end);
}

export function isExpiredSubtitleHighlight(
  entry: SrtEntry | undefined,
  highlight: SubtitleHighlight,
): boolean {
  if (!entry || entry.index !== highlight.entryIndex) {
    return true;
  }

  return entry.text !== highlight.sourceText;
}

export function filterValidSubtitleHighlights(
  entries: SrtEntry[],
  highlights: SubtitleHighlight[],
): SubtitleHighlight[] {
  const entryMap = new Map(entries.map((entry) => [entry.index, entry]));

  return highlights.filter((highlight) => {
    const entry = entryMap.get(highlight.entryIndex);
    return isValidSubtitleHighlight(entry, highlight) && !isExpiredSubtitleHighlight(entry, highlight);
  });
}

/**
 * 在重分段后，把旧高亮映射到新条目上。
 * 规则：highlightText 必须作为子串出现在某个新条目的 text 中；
 * 找到第一个匹配的条目，更新 entryIndex 和 start/end；
 * 找不到则放入 dropped（通常是跨切分点的关键词）。
 */
export function remapHighlightsAfterResegment(
  oldHighlights: SubtitleHighlight[],
  newEntries: SrtEntry[],
): { remapped: SubtitleHighlight[]; dropped: SubtitleHighlight[] } {
  const remapped: SubtitleHighlight[] = [];
  const dropped: SubtitleHighlight[] = [];

  for (const highlight of oldHighlights) {
    const target = newEntries.find((entry) => entry.text.includes(highlight.highlightText));
    if (!target) {
      dropped.push(highlight);
      continue;
    }
    const start = target.text.indexOf(highlight.highlightText);
    remapped.push({
      entryIndex: target.index,
      start,
      end: start + highlight.highlightText.length,
      highlightText: highlight.highlightText,
      sourceText: target.text,
    });
  }

  return { remapped, dropped };
}

import type { SrtEntry } from '../types';

export interface MarqueeRect {
  /** 左上角 x（含内边距前，容器相对坐标） */
  left: number;
  /** 矩形宽度 */
  width: number;
}

export interface SubtitleHitTestOptions {
  entries: SrtEntry[];
  pxPerMs: number;
  rect: MarqueeRect;
  /** 最低命中覆盖比例（0~1），超过后视为命中。默认 0，表示任何接触即命中 */
  minOverlapRatio?: number;
}

function rectOverlap(
  aLeft: number,
  aWidth: number,
  bLeft: number,
  bWidth: number,
): number {
  const aRight = aLeft + aWidth;
  const bRight = bLeft + bWidth;
  return Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
}

/**
 * 将字幕条目映射为像素 layout，并返回与给定矩形相交的 index 列表。
 *
 * 仅按水平投影判定——字幕条带高度固定，矩形跨越纵向即视为覆盖整条字幕带。
 * 返回的 index 按字幕原始顺序升序排列，去重。
 */
export function hitTestSubtitlesByRect({
  entries,
  pxPerMs,
  rect,
  minOverlapRatio = 0,
}: SubtitleHitTestOptions): number[] {
  if (!Number.isFinite(pxPerMs) || pxPerMs <= 0) {
    return [];
  }
  const normalizedRect: MarqueeRect = {
    left: Math.min(rect.left, rect.left + rect.width),
    width: Math.abs(rect.width),
  };
  if (normalizedRect.width <= 0) {
    return [];
  }

  const hits: number[] = [];
  for (const entry of entries) {
    const start = Math.max(0, entry.startMs);
    const end = Math.max(start, entry.endMs);
    const entryLeft = start * pxPerMs;
    const entryWidth = (end - start) * pxPerMs;
    if (entryWidth <= 0) {
      continue;
    }

    const overlap = rectOverlap(entryLeft, entryWidth, normalizedRect.left, normalizedRect.width);
    if (overlap <= 0) {
      continue;
    }

    if (minOverlapRatio > 0) {
      const denom = Math.min(entryWidth, normalizedRect.width);
      if (denom <= 0) continue;
      if (overlap / denom < minOverlapRatio) {
        continue;
      }
    }

    hits.push(entry.index);
  }

  return Array.from(new Set(hits)).sort((a, b) => a - b);
}

export interface SubtitleSelectionSummary {
  indices: number[];
  startMs: number;
  endMs: number;
  text: string;
  count: number;
}

/**
 * 按选中 indices 从 entries 中整理出用于弹窗表单的默认值。
 * - startMs: 首条 startMs
 * - endMs: 末条 endMs（注意：连续区间使用末条，跨越间隙时以实际末条 endMs 为准）
 * - text: 按时间顺序以换行拼接，保持原始字符（不做额外清洗）
 */
export function summarizeSubtitleSelection(
  entries: SrtEntry[],
  indices: number[],
): SubtitleSelectionSummary | null {
  if (indices.length === 0 || entries.length === 0) {
    return null;
  }

  const indexSet = new Set(indices);
  const picked = entries
    .filter((entry) => indexSet.has(entry.index))
    .slice()
    .sort((a, b) => a.startMs - b.startMs);

  if (picked.length === 0) {
    return null;
  }

  const startMs = picked[0].startMs;
  const endMs = picked[picked.length - 1].endMs;
  const text = picked.map((entry) => entry.text).join('\n');

  return {
    indices: picked.map((entry) => entry.index),
    startMs,
    endMs,
    text,
    count: picked.length,
  };
}

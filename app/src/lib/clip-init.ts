import type { AudioClip, SrtEntry } from '../types';

function generateClipId(): string {
  return `clip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 按字幕条生成初始 AudioClip 数组：一字幕 = 一 Clip，source 引用原始音频。
 *
 * @param entries 字幕条目数组
 * @param _totalAudioDurationMs 原始音频总时长（保留参数以便后续校验/扩展使用）
 */
export function initAudioClipsFromSubtitles(
  entries: SrtEntry[],
  _totalAudioDurationMs: number,
): AudioClip[] {
  return entries.map((entry) => ({
    id: generateClipId(),
    source: { kind: 'origin', startMs: entry.startMs, endMs: entry.endMs },
    timelineStartMs: entry.startMs,
    durationMs: entry.endMs - entry.startMs,
    linkedSubtitleIndexes: [entry.index],
  }));
}

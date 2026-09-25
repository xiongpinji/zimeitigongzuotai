import type { SrtEntry, WordTimestamp } from '../types';

/** 中英文标点：用于在聚合字级时间戳时优先按句切分 */
const PUNCTUATION_REGEX = /[，。？！,.?!；;：:]/;
/** 兜底：单条字幕最多字符数 */
const MAX_BUCKET_CHARS = 20;
/** 兜底：单条字幕最长时长（毫秒） */
const MAX_BUCKET_MS = 3000;

/**
 * 把 MiniMax TTS 返回的字级时间戳聚合为 SrtEntry[]。
 *
 * 切分策略：
 * 1. 优先按标点切分（中英文标点：，。？！,.?!；;：:）
 * 2. 兜底：bucket 字符数 ≥ 20 强制切分
 * 3. 兜底：bucket 时长 ≥ 3000ms 强制切分
 *
 * 返回的每个 SrtEntry.index 占位为 -1，由调用方统一重编号。
 *
 * @param timestamps 字级时间戳数组
 * @param offsetMs 加到每个时间戳上的偏移量（毫秒）
 */
export function buildSubtitlesFromWordTimestamps(
  timestamps: WordTimestamp[],
  offsetMs: number,
): SrtEntry[] {
  const result: SrtEntry[] = [];
  let bucket: WordTimestamp[] = [];

  const flush = (): void => {
    if (bucket.length === 0) return;
    const startMs = bucket[0].startMs + offsetMs;
    const endMs = bucket[bucket.length - 1].endMs + offsetMs;
    result.push({
      index: -1,
      startMs,
      endMs,
      text: bucket.map((b) => b.text).join(''),
    });
    bucket = [];
  };

  for (const ts of timestamps) {
    bucket.push(ts);
    const isPunct = PUNCTUATION_REGEX.test(ts.text);
    const tooManyChars = bucket.length >= MAX_BUCKET_CHARS;
    const tooLong = bucket[bucket.length - 1].endMs - bucket[0].startMs >= MAX_BUCKET_MS;
    if (isPunct || tooManyChars || tooLong) {
      flush();
    }
  }

  flush();
  return result;
}

/**
 * 转录结果整形（设计文档 5.9 / 8.1）。
 *
 * 把 ASR Provider 的原始响应标准化为全文、时间轴片段与 SRT。纯逻辑，可单测。
 * OpenAI 兼容的 verbose_json 用秒计时，这里统一转毫秒。
 */
import type { TranscriptDocument, TranscriptSegment } from '@/domain/models';
import { asNumber, asString, isRecord } from '@/adapter/field';

export function formatSrtTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(millis, 3)}`;
}

export function segmentsToSrt(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return '';
  return (
    segments
      .map((seg, i) => {
        const range = `${formatSrtTimestamp(seg.startMs)} --> ${formatSrtTimestamp(seg.endMs)}`;
        return `${i + 1}\n${range}\n${seg.text}`;
      })
      .join('\n\n') + '\n'
  );
}

export interface NormalizeAsrOptions {
  videoId: string;
  provider: string;
  now: number;
  languageFallback?: string;
}

export function normalizeAsrResponse(raw: unknown, options: NormalizeAsrOptions): TranscriptDocument {
  const obj = isRecord(raw) ? raw : {};
  const rawSegments = Array.isArray(obj.segments) ? obj.segments : [];
  const segments: TranscriptSegment[] = [];
  for (const s of rawSegments) {
    const text = asString(isRecord(s) ? s.text : undefined)?.trim();
    const start = asNumber(isRecord(s) ? s.start : undefined);
    const end = asNumber(isRecord(s) ? s.end : undefined);
    if (text === undefined || start === undefined || end === undefined) continue;
    segments.push({ text, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
  }

  const topText = asString(obj.text)?.trim();
  const fullText = topText && topText.length > 0 ? topText : segments.map((s) => s.text).join(' ');
  const language = asString(obj.language) ?? options.languageFallback ?? 'unknown';

  return {
    videoId: options.videoId,
    provider: options.provider,
    language,
    fullText,
    srtText: segmentsToSrt(segments),
    segments,
    createdAt: options.now,
  };
}

/**
 * 由领域模型组装桥入队负载（设计文档第 7 节）。
 *
 * 二创口播只吃转录文本 + 元数据，不带原片。title 取作品文案（description）首行，
 * 截断到合理长度；缺转录则返回 null（不入队）。纯函数，便于单测。
 */
import type { Creator, Video, TranscriptDocument, ViralInsight } from '@/domain/models';
import type { BridgePayload } from './bridge-client';

const MAX_TITLE_LEN = 80;

function deriveTitle(description: string): string {
  const firstLine = (description ?? '').split('\n')[0]!.trim();
  const title = firstLine || '未命名作品';
  return title.length > MAX_TITLE_LEN ? `${title.slice(0, MAX_TITLE_LEN)}…` : title;
}

export function buildBridgePayload(
  video: Video,
  creator: Creator | null,
  transcript: TranscriptDocument | null,
  insight?: ViralInsight | null,
): BridgePayload | null {
  if (!transcript || !transcript.fullText) return null;
  return {
    source: 'douyin',
    awemeId: video.id,
    creatorId: video.creatorId,
    creatorName: creator?.nickname || '未知博主',
    title: deriveTitle(video.description),
    url: video.sourcePageUrl,
    ...(video.coverUrl ? { coverUrl: video.coverUrl } : {}),
    publishedAt: video.publishedAt,
    ...(video.durationMs !== undefined ? { durationMs: video.durationMs } : {}),
    transcript: {
      fullText: transcript.fullText,
      srtText: transcript.srtText,
      segments: transcript.segments.map((s) => ({ text: s.text, startMs: s.startMs, endMs: s.endMs })),
    },
    ...(insight
      ? {
          insight: {
            angle: insight.angle,
            hook: insight.hook,
            structure: insight.structure,
            highlights: insight.highlights,
            dataPoints: insight.dataPoints,
            remixSuggestions: insight.remixSuggestions,
          },
        }
      : {}),
  };
}

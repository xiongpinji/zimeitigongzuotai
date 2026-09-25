import type { AIAnalysisResult, AICard, AISegment, MediaCardContent } from '../types/ai';
import type { SubtitleCardDraftInput } from './ai-analysis';

/** image/video 卡转 motion 时的执行计划。 */
export type MotionConversionPlan =
  | { kind: 'segment'; segment: AISegment }
  | { kind: 'subtitles'; draft: SubtitleCardDraftInput }
  | { kind: 'noop' };

/** 手动卡无有效时长时的兜底展示时长（ms）。 */
const FALLBACK_DURATION_MS = 5000;

function getMediaPrompt(card: AICard): string {
  if (card.content && typeof card.content === 'object' && 'mediaType' in card.content) {
    return (card.content as MediaCardContent).prompt ?? '';
  }
  return '';
}

/**
 * 决定一张卡片转 motion 的路径：
 * - 非 image/video → 'noop'（已是 motion 家族，无需转换）。
 * - 命中 analysisResult.segments → 'segment'（用真实字幕逐字稿生成）。
 * - 否则（手动插入卡）→ 'subtitles'（用 title/prompt + 时间范围合成草稿）。
 */
export function planMotionConversion(
  card: AICard,
  analysis: AIAnalysisResult | null,
): MotionConversionPlan {
  if (card.type !== 'image' && card.type !== 'video') {
    return { kind: 'noop' };
  }

  const segment = analysis?.segments.find((s) => s.id === card.segmentId);
  if (segment) {
    return { kind: 'segment', segment };
  }

  const duration =
    Number.isFinite(card.displayDurationMs) && card.displayDurationMs > 0
      ? Math.round(card.displayDurationMs)
      : FALLBACK_DURATION_MS;
  const startMs =
    Number.isFinite(card.startMs) && card.startMs >= 0 ? Math.round(card.startMs) : 0;
  const endMs =
    Number.isFinite(card.endMs) && card.endMs > startMs ? Math.round(card.endMs) : startMs + duration;
  const text = getMediaPrompt(card).trim() || card.title?.trim() || '动画卡片';

  const draft: SubtitleCardDraftInput = {
    text,
    startMs,
    endMs,
    displayDurationMs: duration,
    type: 'motion',
    promptHint: card.cardPrompt?.trim() || card.title?.trim() || undefined,
  };
  return { kind: 'subtitles', draft };
}

/**
 * 把生成结果合并回原卡片：保号（id/segmentId/时间/displayMode/enabled/title），
 * 接管 motion 相关字段（type/renderMode/content/motionCard/style/template）。
 * 时间线 overlay 以 sourceCardId === card.id 关联，保号确保已上轨卡片不断链。
 */
export function mergeMotionConversionResult(original: AICard, generated: AICard): AICard {
  return {
    ...generated,
    id: original.id,
    segmentId: original.segmentId,
    title: original.title,
    startMs: original.startMs,
    endMs: original.endMs,
    displayMode: original.displayMode,
    enabled: original.enabled,
    displayDurationMs:
      Number.isFinite(original.displayDurationMs) && original.displayDurationMs > 0
        ? original.displayDurationMs
        : generated.displayDurationMs,
    cardPrompt: original.cardPrompt?.trim() || generated.cardPrompt,
    type:
      generated.type === 'image' || generated.type === 'video' ? 'motion' : generated.type,
    renderMode: 'motion-card',
  };
}

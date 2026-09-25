/**
 * 摘要生成的纯逻辑（设计文档 8.1 第 5–6 步）。
 *
 * - chunkSegments：长字幕按时间轴+字符预算分块，便于分块摘要后再汇总。
 * - validateAnalysis：用运行时 schema 校验 category/summary/keyPoints/tags，
 *   不合法抛 SUMMARY_INVALID_RESPONSE，避免脏数据进入存储与 UI。
 */
import type { TranscriptSegment, VideoAnalysis, VideoCategory } from '@/domain/models';
import { VIDEO_CATEGORIES } from '@/domain/models';
import { SonarException, makeError } from '@/domain/errors';
import { asString, isRecord } from '@/adapter/field';

export interface TranscriptChunk {
  text: string;
  startMs: number;
  endMs: number;
}

export function chunkSegments(segments: TranscriptSegment[], maxChars: number): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let current: TranscriptChunk | null = null;
  for (const seg of segments) {
    // 当前块累计已达预算就先封口，再开新块（允许末段轻微超出，保持片段完整）。
    if (current && current.text.length >= maxChars) {
      chunks.push(current);
      current = null;
    }
    if (!current) {
      current = { text: seg.text, startMs: seg.startMs, endMs: seg.endMs };
    } else {
      current.text += ` ${seg.text}`;
      current.endMs = seg.endMs;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const CATEGORY_SET = new Set<string>(VIDEO_CATEGORIES);

export interface ValidateAnalysisContext {
  videoId: string;
  model: string;
  now: number;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export function validateAnalysis(raw: unknown, ctx: ValidateAnalysisContext): VideoAnalysis {
  const fail = (msg: string): never => {
    throw new SonarException(makeError('SUMMARY_INVALID_RESPONSE', msg));
  };
  if (!isRecord(raw)) return fail('摘要响应不是对象');

  const category = asString(raw.category);
  if (!category || !CATEGORY_SET.has(category)) {
    return fail(`未知内容分类：${String(raw.category)}`);
  }
  const summary = asString(raw.summary)?.trim();
  if (!summary) return fail('摘要正文为空');

  return {
    videoId: ctx.videoId,
    category: category as VideoCategory,
    summary,
    keyPoints: toStringArray(raw.keyPoints),
    tags: toStringArray(raw.tags),
    model: ctx.model,
    createdAt: ctx.now,
  };
}

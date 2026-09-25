/**
 * 爆款拆解的纯校验逻辑。
 *
 * validateInsight：运行时 schema 校验 angle/hook（必需）+ 四个字符串数组（容错），
 * 不合法抛 INSIGHT_INVALID_RESPONSE，避免脏数据进入存储与 UI。
 */
import type { ViralInsight } from '@/domain/models';
import { SonarException, makeError } from '@/domain/errors';
import { asString, isRecord } from '@/adapter/field';

export interface ValidateInsightContext {
  videoId: string;
  model: string;
  now: number;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
}

export function validateInsight(raw: unknown, ctx: ValidateInsightContext): ViralInsight {
  const fail = (msg: string): never => {
    throw new SonarException(makeError('INSIGHT_INVALID_RESPONSE', msg));
  };
  if (!isRecord(raw)) return fail('拆解响应不是对象');

  const angle = asString(raw.angle)?.trim();
  if (!angle) return fail('选题角度（angle）为空');
  const hook = asString(raw.hook)?.trim();
  if (!hook) return fail('开头钩子（hook）为空');

  return {
    videoId: ctx.videoId,
    angle,
    hook,
    structure: toStringArray(raw.structure),
    highlights: toStringArray(raw.highlights),
    dataPoints: toStringArray(raw.dataPoints),
    remixSuggestions: toStringArray(raw.remixSuggestions),
    model: ctx.model,
    createdAt: ctx.now,
  };
}

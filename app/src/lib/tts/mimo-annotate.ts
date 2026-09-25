import type { AISettings } from '../../types/ai';
import { generateStructuredData } from '../llm';

export const MIMO_TAG_WHITELIST = [
  '强调', '停顿', '轻松', '认真', '好奇', '感叹', '加快', '放慢',
] as const;
export type MimoTag = (typeof MIMO_TAG_WHITELIST)[number];

export interface AnnotatedSentence {
  sentence: string;
  tag: MimoTag | string | null;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 校验：打标结果的句子拼接（忽略空白）必须与原句拼接完全一致，且句数相同。 */
export function isAnnotationFaithful(ann: AnnotatedSentence[], clean: string[]): boolean {
  if (ann.length !== clean.length) return false;
  return normalize(ann.map((a) => a.sentence).join('')) === normalize(clean.join(''));
}

/** 非白名单标签一律置 null。 */
export function sanitizeAnnotation(ann: AnnotatedSentence[]): Array<{ sentence: string; tag: MimoTag | null }> {
  const allow = new Set<string>(MIMO_TAG_WHITELIST);
  return ann.map((a) => ({
    sentence: a.sentence,
    tag: a.tag && allow.has(a.tag) ? (a.tag as MimoTag) : null,
  }));
}

export function buildAnnotateSystemPrompt(hint: string): string {
  const whitelist = MIMO_TAG_WHITELIST.join('、');
  const hintLine = hint.trim() ? `\n本节目风格偏好（在不违反上述规则前提下参考）：${hint.trim()}` : '';
  return `你是口播语气标注助手。给定按编号排列的句子，为每句可选地附加一个"演绎标签"，用于语音合成时调整语气。

标签白名单（只能从中选，或不打标）：${whitelist}

铁律：
1. 绝不改动任何字词、标点、顺序；sentence 必须与输入句逐字一致。
2. 多数句子应不打标（tag 为 null）；只在能真正增强表达时打标。
3. 按修辞角色选标签：转折/反问→强调或好奇；关键数据/结论/金句→强调或停顿；铺垫/过渡→轻松或放慢。
4. 只输出一个 JSON 对象：{"items":[{"sentence":"原句原文","tag":"强调"|null}, ...]}，items 顺序与数量必须与输入完全一致，不要 markdown、不要解释。${hintLine}`;
}

export interface AnnotateDeps {
  /** 注入点，默认用真实 LLM。测试传 mock。 */
  generate?: (
    settings: AISettings,
    systemPrompt: string,
    userMessage: string,
  ) => Promise<Record<string, unknown>>;
}

function buildAnnotateUserMessage(clean: string[]): string {
  return clean.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

/**
 * 返回与 clean 等长的标签数组（每项为白名单标签或 null）。
 * 开关关闭 / LLM 失败 / 校验不通过 → 全 null（永不抛错、永不阻断合成）。
 */
export async function annotateForMimo(
  clean: string[],
  hint: string,
  settings: AISettings,
  deps: AnnotateDeps = {},
): Promise<Array<MimoTag | null>> {
  const allNull = (): Array<MimoTag | null> => clean.map(() => null);
  if (clean.length === 0) return [];
  if (settings.ttsMimoAutoAnnotate === false) return allNull();

  const generate = deps.generate ?? ((s, sys, usr) => generateStructuredData(s, sys, usr));
  try {
    const raw = await generate(settings, buildAnnotateSystemPrompt(hint), buildAnnotateUserMessage(clean));
    const items = Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: AnnotatedSentence[] }).items)
      : [];
    if (!isAnnotationFaithful(items, clean)) return allNull();
    return sanitizeAnnotation(items).map((x) => x.tag);
  } catch {
    return allNull();
  }
}

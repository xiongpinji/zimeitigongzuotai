// B站分区（tid）的 AI 智能推荐。
// 根据标题 + 描述，从全量内置分区清单里挑一个 tid。提示词走配置中心
// （kind: publish.partition），主进程加载 effective 模板 + 解析每提示词模型绑定后
// 调 generateStructuredData，并对返回 tid 做服务端二次校验（必须在已知集合内）。

import type { AISettings } from '../types/ai';
import { generateStructuredData } from './llm';
import type { ResolvedBinding } from './llm/binding-resolver';
import { renderUserPromptWithLock, type PromptTemplate } from './prompts';
import { flattenPartitions, isValidTid } from './publish/bilibili-partitions';

export interface PartitionRecommendInput {
  /** 视频标题（主要依据） */
  title: string;
  /** 视频描述（主要依据，可空） */
  desc: string;
  /** 兜底素材：标题 / 描述均空时用 AI 分析摘要等补充（可空） */
  fallbackSource?: string;
}

/** 把标题 / 描述 / 全量分区清单拼成"内容消息"。 */
function buildPartitionRecommendContent(input: PartitionRecommendInput): string {
  const parts: string[] = [];
  if (input.title.trim()) parts.push(`【标题】\n${input.title.trim()}`);
  if (input.desc.trim()) parts.push(`【描述】\n${input.desc.trim()}`);
  if (!input.title.trim() && !input.desc.trim() && input.fallbackSource?.trim()) {
    parts.push(`【内容素材】\n${input.fallbackSource.trim()}`);
  }
  const list = flattenPartitions()
    .map((p) => `${p.tid}: ${p.label}`)
    .join('\n');
  parts.push(`【可选分区清单（只能从中选一个 tid）】\n${list}`);
  return parts.join('\n\n');
}

/**
 * 渲染 system / user 两段消息：
 * - systemPrompt：配置中心可编辑的约束规则（user 段）+ 末尾自动拼接的 JSON 输出契约；
 * - userMessage：本次请求的标题 / 描述 + 全量分区清单，由系统注入，不在模板里。
 */
export function buildPartitionRecommendMessages(
  template: PromptTemplate,
  input: PartitionRecommendInput,
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = renderUserPromptWithLock('publish.partition', template, {});
  const userMessage = buildPartitionRecommendContent(input);
  return { systemPrompt, userMessage };
}

/** 解析 { tid } 并校验在已知分区集合内；非法时抛错。 */
export function parsePartitionRecommend(payload: Record<string, unknown>): number {
  const raw = payload.tid;
  const tid = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(tid)) {
    throw new Error('AI 未返回有效的分区 tid');
  }
  if (!isValidTid(tid)) {
    throw new Error(`AI 返回的分区 tid（${tid}）不在 B站可投稿分区列表内`);
  }
  return tid;
}

export interface RecommendPartitionOptions {
  /** 配置中心解析出的 effective 模板（publish.partition）。 */
  template: PromptTemplate;
  /** 每提示词模型绑定；缺省时 generateStructuredData 回退到全局默认 LLM。 */
  binding?: ResolvedBinding;
  /** 注入点：默认使用 generateStructuredData，测试可替换。 */
  generateStructuredData?: typeof generateStructuredData;
}

export async function recommendBilibiliPartition(
  settings: AISettings,
  input: PartitionRecommendInput,
  options: RecommendPartitionOptions,
): Promise<{ tid: number }> {
  if (!input.title.trim() && !input.desc.trim() && !input.fallbackSource?.trim()) {
    throw new Error('请先填写或生成标题 / 描述');
  }
  if (!options.template) {
    throw new Error('缺少分区推荐提示词模板');
  }
  const generate = options.generateStructuredData ?? generateStructuredData;
  const { systemPrompt, userMessage } = buildPartitionRecommendMessages(options.template, input);
  const payload = await generate(settings, systemPrompt, userMessage, options.binding, {
    label: 'publish-partition',
  });
  return { tid: parsePartitionRecommend(payload) };
}

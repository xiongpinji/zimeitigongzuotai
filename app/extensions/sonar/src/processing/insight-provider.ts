/**
 * Insight Provider：把转录稿拆解为面向口播二创的「爆款拆解报告」。
 *
 * 复用与摘要相同的 LLM Provider 配置与共享调用层 llm-json，仅 prompt 与校验不同。
 * 错误：INSIGHT_FAILED（请求失败 / 响应非 ok）/ INSIGHT_INVALID_RESPONSE（非法 JSON 或不合 schema）。
 */
import type { LlmProtocol, TranscriptDocument, ViralInsight } from '@/domain/models';
import { SonarException, makeError } from '@/domain/errors';
import { callLlmJson, type LlmJsonErrorCodes } from './llm-json';
import { validateInsight } from './insight';

export interface InsightConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 默认 'openai'。 */
  protocol?: LlmProtocol;
  temperature?: number;
  maxInputChars?: number;
}

export interface InsightProvider {
  analyze(transcript: TranscriptDocument, opts: { videoId: string }): Promise<ViralInsight>;
}

export interface InsightProviderDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const DEFAULT_MAX_INPUT = 12000;

const INSIGHT_CODES: LlmJsonErrorCodes = {
  request: 'INSIGHT_FAILED',
  invalid: 'INSIGHT_INVALID_RESPONSE',
};

function systemPrompt(): string {
  return [
    '你是资深短视频选题策划。阅读一条爆款口播的转录文本，拆解它"为什么火、怎么改成自己的"，',
    '输出严格的 JSON 对象，所有内容用中文，字段：',
    '- angle：选题角度，一句话点破它切入的角度（如蹭热点/反常识/盘点清单/踩坑教训）',
    '- hook：开头钩子，摘出前几句原话并简述为什么抓人',
    '- structure：内容骨架，3–6 条分段提纲（字符串数组，每条一句话概括该段讲什么）',
    '- highlights：记忆点/金句，2–5 条可复用的句式或观点（字符串数组）',
    '- dataPoints：它引用的关键数据/事实/论据，0–6 条（字符串数组；没有就给空数组，提醒二创需核实）',
    '- remixSuggestions：二创改造建议，2–4 条把别人的内容改成自己版本的方向（换角度/换案例/换受众）',
    '只输出 JSON，不要额外文字。',
  ].join('\n');
}

export function createInsightProvider(
  config: InsightConfig,
  deps: InsightProviderDeps = {},
): InsightProvider {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const maxInput = config.maxInputChars ?? DEFAULT_MAX_INPUT;

  return {
    async analyze(transcript, opts) {
      const text = transcript.fullText.slice(0, maxInput);
      const parsed = await callLlmJson(
        fetchImpl,
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          ...(config.protocol ? { protocol: config.protocol } : {}),
          ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
          maxTokens: 2048,
        },
        INSIGHT_CODES,
        systemPrompt(),
        text,
      );
      try {
        return validateInsight(parsed, { videoId: opts.videoId, model: config.model, now: now() });
      } catch (e) {
        if (e instanceof SonarException) throw e;
        throw new SonarException(makeError('INSIGHT_INVALID_RESPONSE', '拆解内容不合规范'));
      }
    },
  };
}

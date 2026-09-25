/**
 * Summary Provider 契约与实现（设计文档 4.6 / 8.1）。
 *
 * 接收转录文本，调用 LLM 产出结构化 VideoAnalysis（经 validateAnalysis 运行时校验）。
 * Provider 调用走共享层 llm-json（openai/anthropic + 400 重试 + loose JSON 解析）。
 *
 * 错误：SUMMARY_FAILED（请求失败 / 响应非 ok）/ SUMMARY_INVALID_RESPONSE（非法 JSON 或不合 schema）。
 */
import type { LlmProtocol, TranscriptDocument, VideoAnalysis } from '@/domain/models';
import { VIDEO_CATEGORIES } from '@/domain/models';
import { SonarException, makeError } from '@/domain/errors';
import { callLlmJson, type LlmJsonErrorCodes } from './llm-json';
import { validateAnalysis } from './summary';

export interface SummaryConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 默认 'openai'。 */
  protocol?: LlmProtocol;
  temperature?: number;
  maxInputChars?: number;
  timeoutMs?: number;
}

export interface SummaryProvider {
  summarize(transcript: TranscriptDocument, opts: { videoId: string }): Promise<VideoAnalysis>;
}

export interface SummaryProviderDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const DEFAULT_MAX_INPUT = 12000;

const SUMMARY_CODES: LlmJsonErrorCodes = {
  request: 'SUMMARY_FAILED',
  invalid: 'SUMMARY_INVALID_RESPONSE',
};

function systemPrompt(): string {
  return [
    '你是中文短视频内容分析助手。阅读口播转录文本，输出严格的 JSON 对象，字段：',
    `- category：必须是以下之一：${VIDEO_CATEGORIES.join('、')}`,
    '- summary：100–200 字中文摘要',
    '- keyPoints：3–6 条关键要点（字符串数组）',
    '- tags：3–8 个话题标签（不带 # 的字符串数组）',
    '只输出 JSON，不要额外文字。',
  ].join('\n');
}

export function createSummaryProvider(
  config: SummaryConfig,
  deps: SummaryProviderDeps = {},
): SummaryProvider {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const maxInput = config.maxInputChars ?? DEFAULT_MAX_INPUT;

  return {
    async summarize(transcript, opts) {
      const text = transcript.fullText.slice(0, maxInput);
      const parsed = await callLlmJson(
        fetchImpl,
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          ...(config.protocol ? { protocol: config.protocol } : {}),
          ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        },
        SUMMARY_CODES,
        systemPrompt(),
        text,
      );
      try {
        return validateAnalysis(parsed, { videoId: opts.videoId, model: config.model, now: now() });
      } catch (e) {
        if (e instanceof SonarException) throw e;
        throw new SonarException(makeError('SUMMARY_INVALID_RESPONSE', '摘要内容不合规范'));
      }
    },
  };
}

/** @deprecated 用 createSummaryProvider（按 config.protocol 选择协议）。保留别名兼容既有调用与测试。 */
export const createOpenAiSummaryProvider = createSummaryProvider;

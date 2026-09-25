import { describe, expect, it } from 'vitest';
import { getAISettingsIssue } from '../src/lib/ai-settings';

describe('getAISettingsIssue', () => {
  it('returns a clear message when settings are missing', () => {
    expect(getAISettingsIssue(null)).toBe('请先完成 AI 配置后再开始分析');
  });

  it('validates required llm settings before analysis', () => {
    expect(
      getAISettingsIssue({
        llmBaseUrl: '',
        llmApiKey: 'sk-test',
        llmModel: 'gpt-4o',
        jimengApiUrl: '',
        jimengSessionId: '',
      }),
    ).toBe('请先填写 LLM API Base URL');

    expect(
      getAISettingsIssue({
        llmBaseUrl: 'https://api.openai.com/v1',
        llmApiKey: '',
        llmModel: 'gpt-4o',
        jimengApiUrl: '',
        jimengSessionId: '',
      }),
    ).toBe('请先填写 LLM API Key');
  });
});

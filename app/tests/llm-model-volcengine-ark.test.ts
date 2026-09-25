import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../src/types/ai';

const { chatOpenAIMock } = vi.hoisted(() => ({
  chatOpenAIMock: vi.fn().mockImplementation(() => ({ invoke: vi.fn(), stream: vi.fn() })),
}));

vi.mock('@langchain/openai', () => ({ ChatOpenAI: chatOpenAIMock }));
vi.mock('@langchain/google-genai', () => ({ ChatGoogleGenerativeAI: vi.fn() }));
vi.mock('@langchain/anthropic', () => ({ ChatAnthropic: vi.fn() }));

import { createChatModelFromProvider, VOLCENGINE_ARK_DEFAULT_BASE_URL } from '../src/lib/llm/model';

function makeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    id: 'ark',
    name: '火山引擎方舟',
    type: 'volcengine_ark',
    baseUrl: '',
    apiKey: 'sk-ark',
    models: ['doubao-seed-2-1-pro-260628'],
    ...overrides,
  };
}

function lastConfig(): Record<string, unknown> {
  return chatOpenAIMock.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('createChatModelFromProvider (volcengine_ark)', () => {
  beforeEach(() => {
    chatOpenAIMock.mockClear();
  });

  it('builds a ChatOpenAI against the default Ark endpoint when baseUrl is blank', () => {
    createChatModelFromProvider(makeProvider(), 'doubao-seed-2-1-pro-260628');

    expect(chatOpenAIMock).toHaveBeenCalledTimes(1);
    const config = lastConfig();
    expect(config).toMatchObject({
      apiKey: 'sk-ark',
      model: 'doubao-seed-2-1-pro-260628',
      temperature: 0.3,
    });
    expect((config.configuration as Record<string, unknown>).baseURL).toBe(
      VOLCENGINE_ARK_DEFAULT_BASE_URL,
    );
  });

  it('normalizes a custom baseUrl (trailing slash stripped)', () => {
    createChatModelFromProvider(
      makeProvider({ baseUrl: 'https://proxy.example.com/api/v3/' }),
      'doubao-seed-2-1-pro-260628',
    );
    expect((lastConfig().configuration as Record<string, unknown>).baseURL).toBe(
      'https://proxy.example.com/api/v3',
    );
  });

  it('defaults thinking.type to enabled and omits reasoning_effort / service_tier', () => {
    createChatModelFromProvider(makeProvider(), 'doubao-seed-2-1-pro-260628');
    expect(lastConfig().modelKwargs).toEqual({ thinking: { type: 'enabled' } });
  });

  it('passes through configured thinkingMode / reasoningEffort / serviceTier', () => {
    createChatModelFromProvider(
      makeProvider({
        volcengineArk: { thinkingMode: 'auto', reasoningEffort: 'high', serviceTier: 'fast' },
      }),
      'doubao-seed-2-1-pro-260628',
    );
    expect(lastConfig().modelKwargs).toEqual({
      thinking: { type: 'auto' },
      reasoning_effort: 'high',
      service_tier: 'fast',
    });
  });

  it('forces thinking.type=disabled when provider.enableThinking is false (overrides thinkingMode)', () => {
    createChatModelFromProvider(
      makeProvider({ enableThinking: false, volcengineArk: { thinkingMode: 'enabled' } }),
      'doubao-seed-2-1-pro-260628',
    );
    expect((lastConfig().modelKwargs as Record<string, unknown>).thinking).toEqual({
      type: 'disabled',
    });
  });

  it('forces thinking.type=disabled when the options override requests no thinking', () => {
    createChatModelFromProvider(
      makeProvider({ volcengineArk: { thinkingMode: 'auto' } }),
      'doubao-seed-2-1-pro-260628',
      { enableThinking: false },
    );
    expect((lastConfig().modelKwargs as Record<string, unknown>).thinking).toEqual({
      type: 'disabled',
    });
  });
});

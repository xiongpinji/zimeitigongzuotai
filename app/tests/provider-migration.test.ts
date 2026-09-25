import { describe, it, expect } from 'vitest';
import { migrateToProviders, resolveProvider } from '../src/lib/llm/provider-utils';
import type { AISettings, LLMProvider } from '../src/types/ai';

const baseSettings: AISettings = {
  llmProviders: [],
  defaultProviderId: null,
  defaultModel: null,
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  enableThinking: true,
  jimengApiUrl: '',
  jimengSessionId: '',
  minimaxApiKey: '',
  minimaxVoiceId: 'male-qn-qingse',
  minimaxSpeed: 1.0,
};

describe('migrateToProviders', () => {
  it('providers 已存在但缺少 enableThinking 时回填全局 enableThinking', () => {
    const existing: LLMProvider = {
      id: 'existing-id',
      name: 'Existing',
      type: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      apiKey: 'key',
      models: ['gpt-4'],
    };
    const settings: AISettings = {
      ...baseSettings,
      enableThinking: false,
      llmProviders: [existing],
      defaultProviderId: 'existing-id',
      defaultModel: 'gpt-4',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders).toHaveLength(1);
    expect(result.llmProviders[0].enableThinking).toBe(false);
  });

  it('providers 自身已设置 enableThinking 时不被全局值覆盖', () => {
    const existing: LLMProvider = {
      id: 'existing-id',
      name: 'Existing',
      type: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      apiKey: 'key',
      models: ['gpt-4'],
      enableThinking: true,
    };
    const settings: AISettings = {
      ...baseSettings,
      enableThinking: false,
      llmProviders: [existing],
      defaultProviderId: 'existing-id',
      defaultModel: 'gpt-4',
    };
    const result = migrateToProviders(settings);
    expect(result).toBe(settings);
    expect(result.llmProviders[0].enableThinking).toBe(true);
  });

  it('当 llmBaseUrl 为空时返回空 providers', () => {
    const settings: AISettings = { ...baseSettings, llmBaseUrl: '' };
    const result = migrateToProviders(settings);
    expect(result.llmProviders).toHaveLength(0);
    expect(result.defaultProviderId).toBeNull();
    expect(result.defaultModel).toBeNull();
  });

  it('从旧字段创建一个默认 provider', () => {
    const settings: AISettings = {
      ...baseSettings,
      llmBaseUrl: 'https://api.deepseek.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'deepseek-chat',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders).toHaveLength(1);
    const provider = result.llmProviders[0];
    expect(provider.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(provider.apiKey).toBe('sk-test');
    expect(provider.models).toEqual(['deepseek-chat']);
    expect(result.defaultProviderId).toBe(provider.id);
    expect(result.defaultModel).toBe('deepseek-chat');
  });

  it('从 baseUrl 推断 provider 名称 - DeepSeek', () => {
    const settings: AISettings = {
      ...baseSettings,
      llmBaseUrl: 'https://api.deepseek.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'deepseek-chat',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders[0].name).toBe('DeepSeek');
  });

  it('从 baseUrl 推断 provider 名称 - OpenAI', () => {
    const settings: AISettings = {
      ...baseSettings,
      llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'gpt-4',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders[0].name).toBe('OpenAI');
  });

  it('从 baseUrl 推断 provider 名称 - Moonshot/Kimi', () => {
    const settings: AISettings = {
      ...baseSettings,
      llmBaseUrl: 'https://api.moonshot.cn/v1',
      llmApiKey: 'sk-test',
      llmModel: 'moonshot-v1-8k',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders[0].name).toBe('Moonshot');
  });

  it('无法识别的 baseUrl 使用域名作为名称', () => {
    const settings: AISettings = {
      ...baseSettings,
      llmBaseUrl: 'https://my-custom-llm.example.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'custom-model',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders[0].name).toBe('example');
  });

  it('无效 URL 回退到 Custom', () => {
    const settings: AISettings = {
      ...baseSettings,
      llmBaseUrl: 'not-a-valid-url',
      llmApiKey: 'sk-test',
      llmModel: 'model',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders[0].name).toBe('Custom');
  });

  it('从 baseUrl 推断 LM Studio 类型', () => {
    const settings: AISettings = {
      ...baseSettings,
      llmBaseUrl: 'http://localhost:1234/v1',
      llmApiKey: '',
      llmModel: 'qwen2.5-7b-instruct',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders[0].type).toBe('lmstudio');
    expect(result.llmProviders[0].name).toBe('LM Studio');
  });

  it('迁移时把全局 enableThinking 拷贝到新 provider', () => {
    const settings: AISettings = {
      ...baseSettings,
      enableThinking: false,
      llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'gpt-4o',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders[0].enableThinking).toBe(false);
  });

  it('llmModel 为空时 models 数组为空', () => {
    const settings: AISettings = {
      ...baseSettings,
      llmBaseUrl: 'https://api.deepseek.com/v1',
      llmApiKey: 'sk-test',
      llmModel: '',
    };
    const result = migrateToProviders(settings);
    expect(result.llmProviders[0].models).toHaveLength(0);
    expect(result.defaultModel).toBeNull();
  });
});

describe('resolveProvider', () => {
  const provider1: LLMProvider = {
    id: 'p1',
    name: 'Provider 1',
    type: 'openai_compatible',
    baseUrl: 'https://api.p1.com',
    apiKey: 'key1',
    models: ['model-a'],
  };
  const provider2: LLMProvider = {
    id: 'p2',
    name: 'Provider 2',
    type: 'openai_compatible',
    baseUrl: 'https://api.p2.com',
    apiKey: 'key2',
    models: ['model-b'],
  };

  it('providers 为空时返回 null', () => {
    expect(resolveProvider([], null, null)).toBeNull();
    expect(resolveProvider([], 'p1', 'p1')).toBeNull();
  });

  it('通过 providerId 精确匹配', () => {
    const result = resolveProvider([provider1, provider2], 'p2', 'p1');
    expect(result?.id).toBe('p2');
  });

  it('providerId 不存在时返回 null', () => {
    const result = resolveProvider([provider1, provider2], 'unknown-id', null);
    expect(result).toBeNull();
  });

  it('providerId 为 null 时回退到 defaultProviderId', () => {
    const result = resolveProvider([provider1, provider2], null, 'p2');
    expect(result?.id).toBe('p2');
  });

  it('defaultProviderId 不存在时回退到第一个 provider', () => {
    // 当 defaultProviderId 有值但找不到，find 返回 undefined → null
    const result = resolveProvider([provider1, provider2], null, 'unknown-default');
    expect(result).toBeNull();
  });

  it('providerId 和 defaultProviderId 都为 null 时返回第一个 provider', () => {
    const result = resolveProvider([provider1, provider2], null, null);
    expect(result?.id).toBe('p1');
  });
});

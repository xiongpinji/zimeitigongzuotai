import { describe, it, expect } from 'vitest';
import {
  buildPiAuthJson,
  buildPiModelOptions,
  buildPiModelsJson,
  buildPiSettingsJson,
  llmTypeToPiApi,
  projectProviderToPi,
} from '../../electron/agent-runtime/pi-provider-projection';
import type { LLMProvider, AISettings } from '../../src/types/ai';

describe('llmTypeToPiApi', () => {
  it('maps known LLM types to pi api strings', () => {
    expect(llmTypeToPiApi('openai_compatible')).toBe('openai-completions');
    expect(llmTypeToPiApi('openai_responses')).toBe('openai-responses');
    expect(llmTypeToPiApi('lmstudio')).toBe('openai-completions');
    expect(llmTypeToPiApi('minimax')).toBe('anthropic-messages');
    expect(llmTypeToPiApi('anthropic')).toBe('anthropic-messages');
    expect(llmTypeToPiApi('gemini')).toBe('google-generative-ai');
  });
  it('returns null for claude_code_acp (not projected to pi)', () => {
    expect(llmTypeToPiApi('claude_code_acp')).toBeNull();
  });
});

describe('projectProviderToPi', () => {
  const base: LLMProvider = {
    id: 'p1', name: 'My OpenAI', type: 'openai_compatible',
    baseUrl: 'https://api.example.com/v1', apiKey: 'sk-xxx', models: ['gpt-x', 'gpt-y'],
  };
  it('projects an openai_compatible provider with full per-model schema', () => {
    const out = projectProviderToPi(base);
    expect(out).not.toBeNull();
    expect(out!.entry).toEqual({
      name: 'My OpenAI',
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-completions',
      apiKey: 'sk-xxx',
      models: [
        { id: 'gpt-x', name: 'gpt-x', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } },
        { id: 'gpt-y', name: 'gpt-y', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } },
      ],
    });
  });
  it('uses provider.id as the pi provider key', () => {
    expect(projectProviderToPi(base)!.key).toBe('p1');
  });
  it('marks reasoning:true and supportsReasoningEffort:true when enableThinking is set', () => {
    const out = projectProviderToPi({ ...base, enableThinking: true });
    expect(out!.entry.models[0].reasoning).toBe(true);
    expect(out!.entry.models[0].compat.supportsReasoningEffort).toBe(true);
  });
  it('projects pi-specific provider and model options', () => {
    const out = projectProviderToPi({
      ...base,
      pi: {
        api: 'openai-responses',
        authHeader: true,
        headers: { 'x-proxy-key': '$PROXY_KEY' },
        compat: {
          supportsDeveloperRole: true,
          supportsUsageInStreaming: false,
          maxTokensField: 'max_completion_tokens',
          thinkingFormat: 'qwen',
        },
        model: {
          input: ['text', 'image'],
          contextWindow: 262144,
          maxTokens: 32768,
          cost: { input: 1, output: 2 },
          thinkingLevelMap: { low: null, high: 'high', xhigh: 'max' },
        },
      },
    });

    expect(out!.entry.api).toBe('openai-responses');
    expect(out!.entry.authHeader).toBe(true);
    expect(out!.entry.headers).toEqual({ 'x-proxy-key': '$PROXY_KEY' });
    expect(out!.entry.compat?.supportsDeveloperRole).toBe(true);
    expect(out!.entry.models[0]).toMatchObject({
      input: ['text', 'image'],
      contextWindow: 262144,
      maxTokens: 32768,
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      thinkingLevelMap: { low: null, high: 'high', xhigh: 'max' },
      compat: {
        supportsDeveloperRole: true,
        supportsUsageInStreaming: false,
        maxTokensField: 'max_completion_tokens',
        thinkingFormat: 'qwen',
      },
    });
  });
  it('fills pi default base URLs for Gemini and LM Studio when app config leaves them blank', () => {
    const gemini = projectProviderToPi({
      ...base,
      id: 'g',
      type: 'gemini',
      baseUrl: '',
      models: ['gemini-2.5-pro'],
    });
    const lmstudio = projectProviderToPi({
      ...base,
      id: 'lm',
      type: 'lmstudio',
      baseUrl: '',
      apiKey: '',
      models: ['local-model'],
    });

    expect(gemini?.entry.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(lmstudio?.entry.baseUrl).toBe('http://localhost:1234/v1');
  });
  it('skips claude_code_acp providers', () => {
    expect(projectProviderToPi({ ...base, type: 'claude_code_acp' })).toBeNull();
  });
  it('skips providers with empty baseUrl or no models when no default base URL exists', () => {
    expect(projectProviderToPi({ ...base, baseUrl: '' })).toBeNull();
    expect(projectProviderToPi({ ...base, models: [] })).toBeNull();
  });
  it('skips providers with whitespace-only baseUrl when no default base URL exists', () => {
    expect(projectProviderToPi({ ...base, baseUrl: '   ' })).toBeNull();
  });
  it('skips pi built-in providers because pi already owns their models.json entry', () => {
    expect(
      projectProviderToPi({
        ...base,
        pi: { builtinProviderId: 'openai' },
      }),
    ).toBeNull();
  });
});

describe('buildPiModelsJson', () => {
  it('builds { providers } keyed by provider id, skipping unprojectable', () => {
    const ai = {
      llmProviders: [
        { id: 'a', name: 'A', type: 'openai_compatible', baseUrl: 'https://a/v1', apiKey: 'k', models: ['m1'] },
        { id: 'b', name: 'B', type: 'claude_code_acp', baseUrl: 'https://b', apiKey: '', models: [] },
      ],
      defaultProviderId: 'a', defaultModel: 'm1',
    } as unknown as AISettings;
    const out = buildPiModelsJson(ai);
    expect(Object.keys(out.providers)).toEqual(['a']);
    expect(out.providers.a.api).toBe('openai-completions');
  });
  it('returns empty providers when none projectable', () => {
    const ai = { llmProviders: [], defaultProviderId: null, defaultModel: null } as unknown as AISettings;
    expect(buildPiModelsJson(ai)).toEqual({ providers: {} });
  });
  it('omits pi built-in providers from models.json', () => {
    const ai = {
      llmProviders: [
        {
          id: 'openai-app',
          name: 'OpenAI',
          type: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-live',
          models: ['gpt-5.1'],
          pi: { builtinProviderId: 'openai' },
        },
        { id: 'custom', name: 'Custom', type: 'openai_compatible', baseUrl: 'https://c/v1', apiKey: 'k', models: ['m1'] },
      ],
      defaultProviderId: 'openai-app',
      defaultModel: 'gpt-5.1',
    } as unknown as AISettings;
    expect(Object.keys(buildPiModelsJson(ai).providers)).toEqual(['custom']);
  });
});

describe('buildPiSettingsJson', () => {
  it('derives defaultProvider/defaultModel from AISettings', () => {
    const ai = {
      llmProviders: [{ id: 'a', name: 'A', type: 'openai_compatible', baseUrl: 'https://a/v1', apiKey: 'k', models: ['m1'] }],
      defaultProviderId: 'a', defaultModel: 'm1',
    } as unknown as AISettings;
    expect(buildPiSettingsJson(ai)).toEqual({ defaultProvider: 'a', defaultModel: 'm1' });
  });
  it('no longer writes a hardcoded defaultThinkingLevel', () => {
    const ai = {
      llmProviders: [{ id: 'a', name: 'A', type: 'openai_compatible', baseUrl: 'https://a/v1', apiKey: 'k', models: ['m1'] }],
      defaultProviderId: 'a', defaultModel: 'm1',
    } as unknown as AISettings;
    expect(buildPiSettingsJson(ai)).not.toHaveProperty('defaultThinkingLevel');
  });
  it('omits defaultProvider when none resolves or it is unprojectable', () => {
    const none = { llmProviders: [], defaultProviderId: null, defaultModel: null } as unknown as AISettings;
    expect(buildPiSettingsJson(none).defaultProvider).toBeUndefined();
    const acpOnly = {
      llmProviders: [{ id: 'x', name: 'X', type: 'claude_code_acp', baseUrl: 'https://x', apiKey: '', models: [] }],
      defaultProviderId: 'x', defaultModel: null,
    } as unknown as AISettings;
    expect(buildPiSettingsJson(acpOnly).defaultProvider).toBeUndefined();
  });
  it('uses pi built-in provider id in settings.json defaults', () => {
    const ai = {
      llmProviders: [
        {
          id: 'openai-app',
          name: 'OpenAI',
          type: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-live',
          models: ['gpt-5.1'],
          pi: { builtinProviderId: 'openai' },
        },
      ],
      defaultProviderId: 'openai-app',
      defaultModel: 'gpt-5.1',
    } as unknown as AISettings;
    expect(buildPiSettingsJson(ai)).toEqual({
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.1',
    });
  });
});

describe('buildPiModelOptions', () => {
  it('expands projectable providers into providerId/model ids aligned with the projection key', () => {
    const ai = {
      llmProviders: [
        { id: 'a', name: 'A', type: 'openai_compatible', baseUrl: 'https://a/v1', apiKey: 'k', models: ['m1', 'm2'] },
        { id: 'b', name: 'B', type: 'claude_code_acp', baseUrl: 'https://b', apiKey: '', models: [] },
      ],
      defaultProviderId: 'a', defaultModel: 'm1',
    } as unknown as AISettings;
    const opts = buildPiModelOptions(ai);
    // 置顶项展示配置的默认模型名（不再是冗长的「默认（跟随配置）」），id 仍为 'default'。
    expect(opts[0]).toEqual({ id: 'default', label: 'm1' });
    expect(opts.map((o) => o.id)).toEqual(['default', 'a/m1', 'a/m2']);
    expect(opts.find((o) => o.id === 'a/m1')?.label).toBe('m1（A）');
  });
  it('returns only default when no projectable providers', () => {
    const ai = { llmProviders: [], defaultProviderId: null, defaultModel: null } as unknown as AISettings;
    expect(buildPiModelOptions(ai)).toEqual([{ id: 'default', label: '默认' }]);
  });
  it('expands pi built-in providers using the built-in provider id', () => {
    const ai = {
      llmProviders: [
        {
          id: 'openai-app',
          name: 'OpenAI',
          type: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-live',
          models: ['gpt-5.1', 'gpt-4.1'],
          pi: { builtinProviderId: 'openai' },
        },
      ],
      defaultProviderId: 'openai-app',
      defaultModel: 'gpt-5.1',
    } as unknown as AISettings;
    expect(buildPiModelOptions(ai).map((o) => o.id)).toEqual([
      'default',
      'openai/gpt-5.1',
      'openai/gpt-4.1',
    ]);
  });
});

describe('buildPiAuthJson', () => {
  it('writes api_key credentials for pi built-in providers only', () => {
    const ai = {
      llmProviders: [
        {
          id: 'openai-app',
          name: 'OpenAI',
          type: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: ' sk-live ',
          models: ['gpt-5.1'],
          pi: { builtinProviderId: 'openai' },
        },
        {
          id: 'custom',
          name: 'Custom',
          type: 'openai_compatible',
          baseUrl: 'https://c/v1',
          apiKey: 'custom-key',
          models: ['m1'],
        },
      ],
      defaultProviderId: 'openai-app',
      defaultModel: 'gpt-5.1',
    } as unknown as AISettings;
    expect(buildPiAuthJson(ai)).toEqual({
      openai: { type: 'api_key', key: 'sk-live' },
    });
  });
});

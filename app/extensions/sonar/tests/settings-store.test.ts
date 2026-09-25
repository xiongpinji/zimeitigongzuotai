import { describe, it, expect } from 'vitest';
import {
  applyAiSettingsUpdate,
  emptyAiSettings,
  migrateAiSettings,
  resolveDefaultProvider,
  toAiSettingsView,
  type AiSettingsInternal,
} from '@/background/settings-store';

const openaiProvider = {
  id: 'openai',
  name: 'OpenAI',
  protocol: 'openai' as const,
  baseUrl: 'https://api.openai.com/v1',
  models: ['gpt-5.5'],
  presetId: 'openai',
};

describe('migrateAiSettings', () => {
  it('returns empty settings for nullish/garbage input', () => {
    expect(migrateAiSettings(undefined)).toEqual(emptyAiSettings());
    expect(migrateAiSettings('nope')).toEqual(emptyAiSettings());
  });

  it('migrates the legacy { summary } shape into a default provider and drops asr', () => {
    const migrated = migrateAiSettings({
      asr: { baseUrl: 'https://asr.example', apiKey: 'sk-old', model: 'whisper-1' },
      summary: { baseUrl: 'https://llm.example', apiKey: 'sk-sum', model: 'gpt-x', temperature: 0.5 },
      dataSendConsent: true,
      autoAnalyze: true,
    });
    expect(migrated.llm.providers).toHaveLength(1);
    expect(migrated.llm.providers[0]).toMatchObject({
      protocol: 'openai',
      baseUrl: 'https://llm.example',
      apiKey: 'sk-sum',
      models: ['gpt-x'],
    });
    expect(migrated.llm.defaultProviderId).toBe('migrated-summary');
    expect(migrated.llm.defaultModel).toBe('gpt-x');
    expect(migrated.llm.temperature).toBe(0.5);
    expect(migrated.dataSendConsent).toBe(true);
    // 确认旧 asr 配置未被保留。
    expect(JSON.stringify(migrated)).not.toContain('whisper-1');
  });

  it('passes through the new { llm } shape', () => {
    const migrated = migrateAiSettings({
      llm: { providers: [openaiProvider], defaultProviderId: 'openai', defaultModel: 'gpt-5.5' },
    });
    expect(migrated.llm.providers).toHaveLength(1);
    expect(migrated.llm.defaultProviderId).toBe('openai');
  });
});

describe('resolveDefaultProvider', () => {
  it('prefers defaultProviderId then falls back to the first provider', () => {
    const a = { ...openaiProvider, id: 'a' };
    const b = { ...openaiProvider, id: 'b' };
    expect(resolveDefaultProvider({ providers: [a, b], defaultProviderId: 'b' })?.id).toBe('b');
    expect(resolveDefaultProvider({ providers: [a, b] })?.id).toBe('a');
    expect(resolveDefaultProvider({ providers: [] })).toBeUndefined();
  });
});

describe('applyAiSettingsUpdate', () => {
  const start: AiSettingsInternal = {
    llm: {
      providers: [{ ...openaiProvider, apiKey: 'sk-existing' }],
      defaultProviderId: 'openai',
      defaultModel: 'gpt-5.5',
    },
    autoAnalyze: false,
    dataSendConsent: false,
  };

  it('keeps an existing apiKey when the update omits it', () => {
    const next = applyAiSettingsUpdate(start, {
      llm: { providers: [openaiProvider] },
    });
    expect(next.llm.providers[0].apiKey).toBe('sk-existing');
  });

  it('overwrites the apiKey when the update provides one', () => {
    const next = applyAiSettingsUpdate(start, {
      llm: { providers: [{ ...openaiProvider, apiKey: 'sk-new' }] },
    });
    expect(next.llm.providers[0].apiKey).toBe('sk-new');
  });
});

describe('toAiSettingsView', () => {
  it('masks the key, never leaks plaintext, and marks configured', () => {
    const view = toAiSettingsView({
      llm: {
        providers: [{ ...openaiProvider, apiKey: 'sk-secret-9999' }],
        defaultProviderId: 'openai',
        defaultModel: 'gpt-5.5',
      },
      autoAnalyze: false,
      dataSendConsent: false,
    });
    expect(view.llm.configured).toBe(true);
    expect(view.llm.providers[0].apiKeyMasked).toBe('••••9999');
    expect(view.llm.providers[0].hasApiKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain('sk-secret-9999');
  });

  it('treats a no-key preset (lmstudio) as configured without a key', () => {
    const view = toAiSettingsView({
      llm: {
        providers: [
          {
            id: 'lmstudio',
            name: 'LM Studio',
            protocol: 'openai',
            baseUrl: 'http://localhost:1234/v1',
            models: ['local-model'],
            presetId: 'lmstudio',
          },
        ],
        defaultProviderId: 'lmstudio',
      },
      autoAnalyze: false,
      dataSendConsent: false,
    });
    expect(view.llm.configured).toBe(true);
  });
});

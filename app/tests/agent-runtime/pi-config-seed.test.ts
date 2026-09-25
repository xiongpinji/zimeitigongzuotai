import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writePiConfig } from '../../electron/agent-runtime/pi-config-seed';
import type { AISettings } from '../../src/types/ai';

describe('writePiConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(os.tmpdir(), `pi-cfg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes models.json, settings.json, and auth.json from AISettings', async () => {
    const ai = {
      llmProviders: [
        { id: 'a', name: 'A', type: 'openai_compatible', baseUrl: 'https://a/v1', apiKey: 'k', models: ['m1'] },
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
      defaultProviderId: 'openai-app', defaultModel: 'gpt-5.1',
    } as unknown as AISettings;
    await writePiConfig(dir, ai);
    const models = JSON.parse(await fs.readFile(path.join(dir, 'models.json'), 'utf-8'));
    const settings = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf-8'));
    const auth = JSON.parse(await fs.readFile(path.join(dir, 'auth.json'), 'utf-8'));
    expect(models.providers.a.api).toBe('openai-completions');
    expect(models.providers['openai-app']).toBeUndefined();
    expect(settings.defaultProvider).toBe('openai');
    expect(auth.openai).toEqual({ type: 'api_key', key: 'sk-live' });
    // defaultThinkingLevel 不再写死注入（思考程度走会话级 --thinking）
    expect(settings).not.toHaveProperty('defaultThinkingLevel');
  });

  it('creates the directory if missing and handles empty providers', async () => {
    const ai = { llmProviders: [], defaultProviderId: null, defaultModel: null } as unknown as AISettings;
    await writePiConfig(dir, ai);
    const models = JSON.parse(await fs.readFile(path.join(dir, 'models.json'), 'utf-8'));
    const auth = JSON.parse(await fs.readFile(path.join(dir, 'auth.json'), 'utf-8'));
    expect(models).toEqual({ providers: {} });
    expect(auth).toEqual({});
  });

  it('merges auth.json instead of replacing existing pi credentials', async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'auth.json'),
      JSON.stringify({
        anthropic: { type: 'api_key', key: 'sk-ant-existing' },
        customOauth: { type: 'oauth', refreshToken: 'keep-me' },
      }),
      'utf-8',
    );

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

    await writePiConfig(dir, ai);
    const auth = JSON.parse(await fs.readFile(path.join(dir, 'auth.json'), 'utf-8'));
    expect(auth).toEqual({
      anthropic: { type: 'api_key', key: 'sk-ant-existing' },
      customOauth: { type: 'oauth', refreshToken: 'keep-me' },
      openai: { type: 'api_key', key: 'sk-live' },
    });
  });
});

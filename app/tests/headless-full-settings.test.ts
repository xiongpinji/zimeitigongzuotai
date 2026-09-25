import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadFullHeadlessAISettings } from '../electron/pipeline/headless-settings';

describe('loadFullHeadlessAISettings', () => {
  it('returns fully-defaulted settings when settings.json missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-fs-'));
    try {
      const s = await loadFullHeadlessAISettings(dir);
      expect(Array.isArray(s.llmProviders)).toBe(true);
      expect(Array.isArray(s.imageProviders)).toBe(true);
      expect(Array.isArray(s.ttsProviders)).toBe(true);
      expect(typeof s.defaultStylePresetId).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges user aiSettings over defaults and runs migrations', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-fs-'));
    writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
      aiSettings: {
        llmProviders: [{ id: 'l1', name: 'OpenAI', type: 'openai_compatible', baseUrl: 'https://api', apiKey: 'sk-x', models: ['gpt-4o'] }],
        defaultProviderId: 'l1',
        defaultModel: 'gpt-4o',
      },
    }));
    try {
      const s = await loadFullHeadlessAISettings(dir);
      expect(s.defaultProviderId).toBe('l1');
      expect(s.llmProviders.find((p) => p.id === 'l1')?.apiKey).toBe('sk-x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

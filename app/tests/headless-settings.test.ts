import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadHeadlessTTSConfig } from '../electron/pipeline/headless-settings';

function userDataWith(aiSettings: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-hs-'));
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ aiSettings }));
  return dir;
}

const MINIMAX_PROVIDER = {
  id: 'p1', name: 'MiniMax', type: 'minimax', baseUrl: 'https://api.minimax.chat',
  apiKey: 'sk-test', models: ['speech-01'],
};
const VOICE = {
  id: 'v1', name: '女声', providerId: 'p1', providerType: 'minimax', model: 'speech-01',
  voiceId: 'female-1', source: 'preset', params: {},
};

describe('loadHeadlessTTSConfig', () => {
  it('returns provider+voice from settings.json', async () => {
    const dir = userDataWith({
      ttsProviders: [MINIMAX_PROVIDER],
      ttsVoices: [VOICE],
      defaultTtsProviderId: 'p1',
      defaultTtsVoiceId: 'v1',
    });
    try {
      const cfg = await loadHeadlessTTSConfig(dir);
      expect(cfg.provider.type).toBe('minimax');
      expect(cfg.provider.apiKey).toBe('sk-test');
      expect(cfg.voice.voiceId).toBe('female-1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws no_settings when settings.json missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-hs-'));
    try {
      await expect(loadHeadlessTTSConfig(dir)).rejects.toMatchObject({ code: 'no_settings' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws no_api_key when provider key blank', async () => {
    const dir = userDataWith({
      ttsProviders: [{ ...MINIMAX_PROVIDER, apiKey: '' }],
      ttsVoices: [VOICE],
      defaultTtsProviderId: 'p1',
      defaultTtsVoiceId: 'v1',
    });
    try {
      await expect(loadHeadlessTTSConfig(dir)).rejects.toMatchObject({ code: 'no_api_key' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

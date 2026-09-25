import { describe, expect, it } from 'vitest';
import type { TTSProvider, TTSVoicePreset } from '../types/ai';
import {
  buildXiaomiMimoTtsRequestBody,
  decodeXiaomiMimoAudioData,
  resolveXiaomiMimoTtsUrl,
} from './xiaomi-mimo-tts';

const provider: TTSProvider = {
  id: 'mimo',
  name: 'MiMo',
  type: 'xiaomi_mimo',
  baseUrl: 'https://api.xiaomimimo.com/',
  apiKey: 'key',
  models: ['mimo-v2.5-tts-voiceclone'],
};

const voice: TTSVoicePreset = {
  id: 'voice',
  name: '测试克隆',
  providerId: 'mimo',
  providerType: 'xiaomi_mimo',
  model: null,
  source: 'cloned',
  referenceAudioPath: '/tmp/ref.mp3',
  params: { speed: 1 },
  createdAt: 1,
  updatedAt: 1,
};

describe('xiaomi-mimo-tts', () => {
  it('builds the voice clone request body with data url voice', () => {
    const body = buildXiaomiMimoTtsRequestBody({
      text: '你好',
      provider,
      voice,
      referenceAudioBase64: 'YWJj',
      referenceAudioMime: 'audio/mpeg',
    });

    expect(body.model).toBe('mimo-v2.5-tts-voiceclone');
    expect(body.audio).toMatchObject({
      format: 'wav',
      voice: 'data:audio/mpeg;base64,YWJj',
    });
    expect(body.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: '你好' })]),
    );
  });

  it('decodes returned audio data', () => {
    const audio = decodeXiaomiMimoAudioData({
      choices: [{ message: { audio: { data: Buffer.from('wav').toString('base64') } } }],
    });

    expect(audio.toString('utf-8')).toBe('wav');
  });

  it('normalizes the endpoint URL', () => {
    expect(resolveXiaomiMimoTtsUrl(provider)).toBe(
      'https://api.xiaomimimo.com/v1/chat/completions',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { buildXiaomiMimoTtsRequestBody } from '../src/lib/xiaomi-mimo-tts';
import type { TTSProvider, TTSVoicePreset } from '../src/types/ai';

const provider = { id: 'p', name: 'mimo', type: 'xiaomi_mimo', baseUrl: '', apiKey: 'k', models: ['mimo-v2.5-tts-voiceclone'] } as TTSProvider;
const voice = { id: 'v', name: 'V', providerId: 'p', providerType: 'xiaomi_mimo', source: 'cloned', referenceAudioPath: '/a.wav', params: { speed: 1, vol: 1, pitch: 0, emotion: '' }, createdAt: 0, updatedAt: 0 } as TTSVoicePreset;

describe('buildXiaomiMimoTtsRequestBody styleInstruction/speak', () => {
  it('styleInstruction 作 user、speak 作 assistant', () => {
    const body = buildXiaomiMimoTtsRequestBody({
      text: '原文', provider, voice, referenceAudioBase64: 'AA', referenceAudioMime: 'audio/wav',
      styleInstruction: '沉稳清晰', speakText: '(强调)原文',
    }) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0]).toEqual({ role: 'user', content: '沉稳清晰' });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '(强调)原文' });
  });

  it('未传 styleInstruction/speakText 时回退默认指令 + text', () => {
    const body = buildXiaomiMimoTtsRequestBody({
      text: '原文', provider, voice, referenceAudioBase64: 'AA', referenceAudioMime: 'audio/wav',
    }) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0].content).toContain('朗读');
    expect(body.messages[1].content).toBe('原文');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildMinimaxTtsRequestBody,
  extractMinimaxSubtitleSentences,
  getMinimaxDurationMs,
  subtitleJsonToSRT,
} from '../src/lib/minimax-tts';

describe('MiniMax TTS helpers', () => {
  it('builds a non-streaming request body for sync tts generation', () => {
    expect(
      buildMinimaxTtsRequestBody({
        text: '化肥价格近期继续震荡。',
        voiceId: 'male-qn-qingse',
        speed: 1,
        vol: 1,
        pitch: 0,
        emotion: '',
        model: 'speech-2.8-hd',
      }),
    ).toMatchObject({
      model: 'speech-2.8-hd',
      text: '化肥价格近期继续震荡。',
      stream: false,
      output_format: 'hex',
      subtitle_enable: true,
      voice_setting: {
        voice_id: 'male-qn-qingse',
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    });
  });

  it('converts subtitle payloads with alternate field names into srt', () => {
    const srt = subtitleJsonToSRT([
      {
        time_begin: 0,
        time_end: 1500,
        pronounce_text: '第一句',
      },
      {
        begin_time: 1500,
        end_time: 3200,
        text: '第二句',
      },
    ]);

    expect(srt).toContain('00:00:00,000 --> 00:00:01,500');
    expect(srt).toContain('第一句');
    expect(srt).toContain('00:00:01,500 --> 00:00:03,200');
    expect(srt).toContain('第二句');
  });

  it('falls back to audio length when no subtitle timestamps are available', () => {
    expect(
      getMinimaxDurationMs(
        {
          extra_info: {
            audio_length: 314100,
          },
        },
        [],
      ),
    ).toBe(314100);
  });

  it('extracts subtitle arrays from both wrapped and raw payloads', () => {
    expect(
      extractMinimaxSubtitleSentences({
        subtitles: [{ begin_time: 0, end_time: 1000, text: 'wrapped' }],
      }),
    ).toEqual([{ begin_time: 0, end_time: 1000, text: 'wrapped' }]);

    expect(
      extractMinimaxSubtitleSentences([
        { begin_time: 1000, end_time: 2000, text: 'raw' },
      ]),
    ).toEqual([{ begin_time: 1000, end_time: 2000, text: 'raw' }]);
  });
});

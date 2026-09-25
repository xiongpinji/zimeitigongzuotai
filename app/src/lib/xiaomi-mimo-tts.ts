import fs from 'node:fs/promises';
import path from 'node:path';
import type { TTSProvider, TTSVoicePreset } from '../types/ai';
import {
  DEFAULT_MIMO_TTS_BASE_URL,
  DEFAULT_MIMO_TTS_MODEL,
} from './tts-settings';

export interface XiaomiMimoTtsResponse {
  choices?: Array<{
    message?: {
      audio?: {
        data?: string;
      };
    };
  }>;
  error?: {
    message?: string;
  };
}

export interface BuildXiaomiMimoTtsRequestOptions {
  text: string;
  provider: TTSProvider;
  voice: TTSVoicePreset;
  referenceAudioBase64: string;
  referenceAudioMime: 'audio/mpeg' | 'audio/wav';
  styleInstruction?: string;
  speakText?: string;
}

export interface ReferenceAudioData {
  data: Buffer;
  mime: 'audio/mpeg' | 'audio/wav';
  filename: string;
}

const MAX_REFERENCE_AUDIO_BASE64_BYTES = 10 * 1024 * 1024;

export function resolveXiaomiMimoTtsUrl(provider: TTSProvider): string {
  const baseUrl = provider.baseUrl.trim() || DEFAULT_MIMO_TTS_BASE_URL;
  return `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
}

export async function readXiaomiMimoReferenceAudio(
  referenceAudioPath: string | undefined,
): Promise<ReferenceAudioData> {
  if (!referenceAudioPath?.trim()) {
    throw new Error('MiMo 克隆音色缺少参考音频路径');
  }

  const filePath = referenceAudioPath.trim();
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : null;
  if (!mime) {
    throw new Error('MiMo 克隆音色仅支持 mp3 或 wav 参考音频');
  }

  let data: Buffer;
  try {
    data = await fs.readFile(filePath);
  } catch (error) {
    throw new Error(
      `MiMo 克隆音色参考音频不存在或不可读取: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const base64Bytes = Buffer.byteLength(data.toString('base64'), 'utf-8');
  if (base64Bytes > MAX_REFERENCE_AUDIO_BASE64_BYTES) {
    throw new Error('MiMo 克隆音色参考音频超过 10 MB Base64 限制');
  }

  return { data, mime, filename: path.basename(filePath) };
}

export function buildXiaomiMimoTtsRequestBody(
  options: BuildXiaomiMimoTtsRequestOptions,
): Record<string, unknown> {
  const model = options.voice.model?.trim() || options.provider.models[0] || DEFAULT_MIMO_TTS_MODEL;
  return {
    model,
    messages: [
      {
        role: 'user',
        content:
          options.styleInstruction?.trim() ||
          '请使用自然、清晰、适合视频口播的语气朗读下面的文本。',
      },
      {
        role: 'assistant',
        content: options.speakText?.trim() || options.text,
      },
    ],
    audio: {
      format: 'wav',
      voice: `data:${options.referenceAudioMime};base64,${options.referenceAudioBase64}`,
    },
  };
}

export function decodeXiaomiMimoAudioData(response: XiaomiMimoTtsResponse): Buffer {
  const errorMessage = response.error?.message;
  if (errorMessage) {
    throw new Error(`MiMo TTS 接口错误: ${errorMessage}`);
  }

  const audioData = response.choices?.[0]?.message?.audio?.data?.replace(/\s+/g, '') ?? '';
  if (!audioData) {
    throw new Error('MiMo TTS 未返回有效音频数据');
  }

  return Buffer.from(audioData, 'base64');
}

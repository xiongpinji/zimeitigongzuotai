/**
 * ASR Provider 契约与 OpenAI-compatible 实现（设计文档 4.6 / 8.1）。
 *
 * 接收压缩音频，POST 到 {baseUrl}/audio/transcriptions（verbose_json），
 * 返回标准化的全文 / 片段 / SRT。错误归类为 ASR_UPLOAD_FAILED（请求失败）/ ASR_FAILED（响应非 ok）。
 * 注入 fetchImpl 便于测试。
 */
import type { TranscriptDocument } from '@/domain/models';
import { SonarException, makeError } from '@/domain/errors';
import { normalizeAsrResponse } from './transcript';

export interface AsrConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  language?: string;
  timeoutMs?: number;
}

export interface AsrProvider {
  transcribe(audio: Blob, opts: { videoId: string }): Promise<TranscriptDocument>;
}

export interface AsrProviderDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
};

/** 由 Blob 的 MIME 推断上传文件名（部分 ASR 按扩展名识别格式）。 */
export function filenameForBlob(blob: Blob): string {
  const ext = MIME_EXT[blob.type?.toLowerCase()] ?? 'mp4';
  return `media.${ext}`;
}

export function createOpenAiAsrProvider(config: AsrConfig, deps: AsrProviderDeps = {}): AsrProvider {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());

  return {
    async transcribe(audio, opts) {
      const form = new FormData();
      form.append('file', audio, filenameForBlob(audio));
      form.append('model', config.model);
      form.append('response_format', 'verbose_json');
      if (config.language) form.append('language', config.language);

      let res: Response;
      try {
        res = await fetchImpl(joinUrl(config.baseUrl, 'audio/transcriptions'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: form,
        });
      } catch (e) {
        throw new SonarException(
          makeError('ASR_UPLOAD_FAILED', '上传音频失败', {
            retryable: true,
            detail: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      if (!res.ok) {
        throw new SonarException(
          makeError('ASR_FAILED', `转录失败（HTTP ${res.status}）`, { nextAction: '检查 ASR 配置' }),
        );
      }
      const json = (await res.json()) as unknown;
      return normalizeAsrResponse(json, {
        videoId: opts.videoId,
        provider: 'openai',
        now: now(),
        ...(config.language ? { languageFallback: config.language } : {}),
      });
    },
  };
}

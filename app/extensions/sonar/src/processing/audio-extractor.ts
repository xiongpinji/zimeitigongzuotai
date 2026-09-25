/**
 * 音频提取契约（设计文档 4.5 / 8.1）。
 *
 * 默认真实实现位于 offscreen-audio-extractor.ts：通过 OPFS 把视频交给 Offscreen
 * Document，使用 Web Audio 下混并重采样为 16kHz 单声道 WAV。
 */
import { SonarException, makeError } from '@/domain/errors';

export interface AudioExtractor {
  /** 把视频字节转成单声道、适合 ASR 的压缩音频。 */
  extract(video: Blob): Promise<Blob>;
}

export function createPendingAudioExtractor(): AudioExtractor {
  return {
    async extract() {
      throw new SonarException(
        makeError('AUDIO_EXTRACTION_FAILED', '音频提取（ffmpeg.wasm / Offscreen）尚未接入', {
          nextAction: '等待音频处理模块上线',
        }),
      );
    },
  };
}

/** 旧的直传回退实现保留 25MB 上限；bcut 主链路不再使用它。 */
export const DEFAULT_MEDIA_SIZE_LIMIT = 25 * 1024 * 1024;

/**
 * 直传提取器：短视频可直接把视频文件交给 ASR（Whisper 兼容端点接受 mp4），
 * 无需先用 ffmpeg 提取音频。超过单文件上限时抛 MEDIA_TOO_LARGE，提示后续用 ffmpeg 压缩。
 * 仅供兼容接受 MP4 的其它 ASR Provider；bcut 必须使用真实音频提取器。
 */
export function createPassthroughAudioExtractor(limit = DEFAULT_MEDIA_SIZE_LIMIT): AudioExtractor {
  return {
    async extract(video: Blob): Promise<Blob> {
      if (video.size > limit) {
        throw new SonarException(
          makeError('MEDIA_TOO_LARGE', '视频超过 ASR 单文件上限，需先压缩音频', {
            detail: `${Math.round(video.size / 1024 / 1024)}MB > ${Math.round(limit / 1024 / 1024)}MB`,
          }),
        );
      }
      return video;
    },
  };
}

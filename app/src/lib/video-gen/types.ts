import type { VideoAspectRatio, VideoProviderType } from '../../types/ai';

export type { VideoAspectRatio, VideoProviderType };

export interface VideoProviderCapabilities {
  aspectRatios: VideoAspectRatio[];
  /** 支持的固定时长档位（秒） */
  durationOptions: number[];
  maxResolution: '720p' | '1080p';
  /** 第一期不接，留位 */
  supportsImageToVideo: boolean;
  isAsync: boolean;
  defaultModels: string[];
}

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  model: string;
  aspectRatio: VideoAspectRatio;
  /** 必须 ∈ capabilities.durationOptions */
  durationSeconds: number;
  /** 第一期未使用，留位给图生视频 */
  referenceImageUrl?: string;
  extraParams?: Record<string, unknown>;
}

export interface VideoGenerationResult {
  videoUrl: string;
  posterUrl?: string;
  durationMs: number;
  width: number;
  height: number;
  raw?: unknown;
}

export interface VideoProviderConfig {
  baseUrl: string;
  apiKey: string;
  extras?: Record<string, unknown>;
}

export interface VideoGenerationProgressUpdate {
  percent?: number;
  phase?:
    | 'submitting'
    | 'queued'
    | 'rendering'
    | 'downloading'
    | 'postprocessing'
    | string;
  message?: string;
}

export interface VideoGenerationContext {
  taskId: string;
  signal: AbortSignal;
  onProgress: (update: VideoGenerationProgressUpdate) => void;
}

export interface VideoGenerationProvider {
  readonly type: VideoProviderType;
  readonly capabilities: VideoProviderCapabilities;
  generate(
    req: VideoGenerationRequest,
    config: VideoProviderConfig,
    ctx: VideoGenerationContext,
  ): Promise<VideoGenerationResult>;
}

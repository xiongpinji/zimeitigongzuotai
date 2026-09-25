import type {
  ImageAspectRatio,
  ImageProviderCapabilities,
  ImageProviderType,
} from '../../types/ai';

export type { ImageAspectRatio, ImageProviderCapabilities, ImageProviderType };

export interface ImageGenerationRequest {
  prompt: string;
  model: string;
  aspectRatio?: ImageAspectRatio;
  n?: number;
  extraParams?: Record<string, unknown>;
}

export interface ImageGenerationImage {
  url?: string;
  base64?: string;
  mimeType?: string;
}

export interface ImageGenerationResult {
  images: ImageGenerationImage[];
  raw?: unknown;
}

export interface ImageGenerationProgressUpdate {
  percent?: number;
  phase?: 'submitting' | 'queued' | 'rendering' | 'downloading' | string;
  message?: string;
}

export interface ImageGenerationContext {
  taskId: string;
  signal: AbortSignal;
  onProgress: (update: ImageGenerationProgressUpdate) => void;
}

export interface ImageProviderConfig {
  baseUrl: string;
  apiKey: string;
  extras?: Record<string, unknown>;
}

export interface ImageGenerationProvider {
  readonly type: ImageProviderType;
  readonly capabilities: ImageProviderCapabilities;
  generate(
    req: ImageGenerationRequest,
    config: ImageProviderConfig,
    ctx: ImageGenerationContext,
  ): Promise<ImageGenerationResult>;
}

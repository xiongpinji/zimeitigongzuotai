import type { ImageProviderCapabilities } from '../../../types/ai';
import { ImageGenerationError, httpStatusToErrorCode } from '../errors';
import type {
  ImageGenerationContext,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProviderConfig,
} from '../types';

const CAPABILITIES: ImageProviderCapabilities = {
  aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  maxN: 4,
  supportsImageToImage: false,
  isAsync: false,
  defaultModels: ['imagen-3.0-generate-002', 'imagen-4.0-generate-preview-06-06'],
};

interface ImagenPrediction {
  bytesBase64Encoded: string;
  mimeType?: string;
}

interface ImagenApiResponse {
  predictions?: ImagenPrediction[] | null;
  error?: {
    status?: string;
    message?: string;
    code?: number;
  };
}

export const imagenImageProvider: ImageGenerationProvider = {
  type: 'imagen',
  capabilities: CAPABILITIES,
  async generate(
    req: ImageGenerationRequest,
    config: ImageProviderConfig,
    ctx: ImageGenerationContext,
  ): Promise<ImageGenerationResult> {
    const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const model = req.model?.trim() || CAPABILITIES.defaultModels[0];
    const url = `${baseUrl}/v1beta/models/${model}:predict?key=${config.apiKey}`;

    ctx.onProgress({ percent: 10, phase: 'submitting', message: '提交 Imagen 生图请求…' });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: req.prompt }],
          parameters: {
            sampleCount: req.n ?? 1,
            aspectRatio: req.aspectRatio ?? '16:9',
          },
        }),
        signal: ctx.signal,
      });
    } catch (err) {
      if (ctx.signal.aborted) {
        throw new ImageGenerationError('cancelled', 'imagen', '任务已取消', err);
      }
      throw new ImageGenerationError('network', 'imagen', '网络错误，无法连接 Imagen API', err);
    }

    if (!response.ok) {
      // 尝试解析错误体，细化错误码
      let errorBody: ImagenApiResponse | null = null;
      try {
        errorBody = (await response.json()) as ImagenApiResponse;
      } catch {
        // 忽略解析失败
      }
      const errorStatus = errorBody?.error?.status;
      let code = httpStatusToErrorCode(response.status);
      if (errorStatus === 'PERMISSION_DENIED') code = 'auth';
      else if (errorStatus === 'RESOURCE_EXHAUSTED') code = 'quota';
      else if (errorStatus === 'INVALID_ARGUMENT') code = 'invalid_request';

      throw new ImageGenerationError(
        code,
        'imagen',
        `Imagen API 错误 ${response.status}: ${errorBody?.error?.message ?? ''}`,
        undefined,
        errorBody,
      );
    }

    ctx.onProgress({ percent: 80, phase: 'rendering', message: '解析返回结果…' });
    const payload = (await response.json()) as ImagenApiResponse;
    const predictions = payload.predictions ?? [];
    if (predictions.length === 0) {
      throw new ImageGenerationError('server', 'imagen', 'Imagen API 未返回图片数据', undefined, payload);
    }

    ctx.onProgress({ percent: 100, phase: 'rendering', message: '生成完成' });
    return {
      images: predictions.map((pred) => ({
        base64: pred.bytesBase64Encoded,
        mimeType: pred.mimeType ?? 'image/png',
      })),
      raw: payload,
    };
  },
};

import { DEFAULT_JIMENG_MODEL, type ImageProviderCapabilities } from '../../../types/ai';
import { ImageGenerationError, httpStatusToErrorCode } from '../errors';
import type {
  ImageAspectRatio,
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
  defaultModels: [DEFAULT_JIMENG_MODEL],
};

interface JimengApiResponse {
  data?: Array<{ url?: string | null } | null> | null;
}

export interface JimengImageRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    prompt: string;
    ratio: string;
    resolution: string;
    n?: number;
  };
}

export function buildJimengImageRequest(
  req: ImageGenerationRequest,
  config: ImageProviderConfig,
): JimengImageRequest {
  return {
    url: `${config.baseUrl.replace(/\/+$/, '')}/v1/images/generations`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: {
      model: req.model?.trim() || DEFAULT_JIMENG_MODEL,
      prompt: req.prompt,
      ratio: aspectRatioToJimeng(req.aspectRatio ?? '16:9'),
      resolution: '2k',
      n: req.n ?? 1,
    },
  };
}

export function extractJimengImageUrls(payload: JimengApiResponse): string[] {
  return (payload.data ?? [])
    .map((item) => item?.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

function aspectRatioToJimeng(ar: ImageAspectRatio): string {
  // 即梦使用 'W:H' 字符串，公共集与之一致
  return ar;
}

export const jimengProvider: ImageGenerationProvider = {
  type: 'jimeng',
  capabilities: CAPABILITIES,
  async generate(
    req: ImageGenerationRequest,
    config: ImageProviderConfig,
    ctx: ImageGenerationContext,
  ): Promise<ImageGenerationResult> {
    const request = buildJimengImageRequest(req, config);
    ctx.onProgress({ percent: 10, phase: 'submitting', message: '提交即梦生图请求…' });

    let response: Response;
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: ctx.signal,
      });
    } catch (err) {
      if (ctx.signal.aborted) {
        throw new ImageGenerationError('cancelled', 'jimeng', '任务已取消', err);
      }
      throw new ImageGenerationError('network', 'jimeng', '网络错误，无法连接即梦', err);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new ImageGenerationError(
        httpStatusToErrorCode(response.status),
        'jimeng',
        `即梦 API 错误 ${response.status}: ${errorText.slice(0, 200)}`,
        undefined,
        errorText,
      );
    }

    ctx.onProgress({ percent: 80, phase: 'rendering', message: '解析返回结果…' });
    const payload = (await response.json()) as JimengApiResponse;
    const urls = extractJimengImageUrls(payload);
    if (urls.length === 0) {
      throw new ImageGenerationError(
        'server',
        'jimeng',
        '即梦 API 未返回图片 URL',
        undefined,
        payload,
      );
    }

    ctx.onProgress({ percent: 100, phase: 'rendering', message: '生成完成' });
    return {
      images: urls.map((url) => ({ url, mimeType: 'image/png' })),
      raw: payload,
    };
  },
};

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
  maxN: 8,
  supportsImageToImage: false,
  isAsync: false,
  defaultModels: ['image-01'],
};

const DEFAULT_BASE_URL = 'https://api.minimax.chat';

interface MinimaxBaseResp {
  status_code: number;
  status_msg?: string;
}

interface MinimaxApiResponse {
  data?: {
    image_urls?: string[];
  };
  base_resp?: MinimaxBaseResp;
}

/** 将 MiniMax 业务错误码映射到统一错误码 */
function minimaxStatusCodeToErrorCode(
  statusCode: number,
): 'auth' | 'quota' | 'invalid_request' | 'server' {
  if (statusCode === 1004) return 'auth';
  if (statusCode === 1008) return 'quota';
  if (statusCode === 1013) return 'invalid_request';
  return 'server';
}

export const minimaxImageProvider: ImageGenerationProvider = {
  type: 'minimax',
  capabilities: CAPABILITIES,
  async generate(
    req: ImageGenerationRequest,
    config: ImageProviderConfig,
    ctx: ImageGenerationContext,
  ): Promise<ImageGenerationResult> {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const url = `${baseUrl}/v1/image_generation`;

    ctx.onProgress({ percent: 10, phase: 'submitting', message: '提交 MiniMax 生图请求…' });

    // 构造请求体
    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio ?? '16:9',
      n: req.n ?? 1,
      response_format: 'url',
    };

    // extraParams 透传（仅在传入时加入）
    const extra = req.extraParams ?? {};
    if (extra.prompt_optimizer !== undefined) {
      body.prompt_optimizer = extra.prompt_optimizer;
    }
    if (extra.seed !== undefined) {
      body.seed = extra.seed;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctx.signal,
      });
    } catch (err) {
      if (ctx.signal.aborted) {
        throw new ImageGenerationError('cancelled', 'minimax', '任务已取消', err);
      }
      throw new ImageGenerationError('network', 'minimax', '网络错误，无法连接 MiniMax', err);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new ImageGenerationError(
        httpStatusToErrorCode(response.status),
        'minimax',
        `MiniMax API 错误 ${response.status}: ${errorText.slice(0, 200)}`,
        undefined,
        errorText,
      );
    }

    ctx.onProgress({ percent: 80, phase: 'rendering', message: '解析返回结果…' });
    const payload = (await response.json()) as MinimaxApiResponse;

    // 检查业务层错误（MiniMax 常以 200 + base_resp.status_code !== 0 表示业务失败）
    if (payload.base_resp && payload.base_resp.status_code !== 0) {
      const { status_code, status_msg } = payload.base_resp;
      throw new ImageGenerationError(
        minimaxStatusCodeToErrorCode(status_code),
        'minimax',
        `MiniMax 业务错误 ${status_code}: ${status_msg ?? '未知错误'}`,
        undefined,
        payload,
      );
    }

    const imageUrls = payload.data?.image_urls ?? [];
    if (imageUrls.length === 0) {
      throw new ImageGenerationError(
        'server',
        'minimax',
        'MiniMax API 未返回图片 URL',
        undefined,
        payload,
      );
    }

    ctx.onProgress({ percent: 100, phase: 'rendering', message: '生成完成' });
    return {
      images: imageUrls.map((url) => ({ url, mimeType: 'image/png' })),
      raw: payload,
    };
  },
};

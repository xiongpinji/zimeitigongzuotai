import type { ImageProviderCapabilities } from '../../../types/ai';
import { ImageGenerationError, httpStatusToErrorCode } from '../errors';
import { pollUntilDone } from '../async-poller';
import type {
  ImageAspectRatio,
  ImageGenerationContext,
  ImageGenerationImage,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProviderConfig,
} from '../types';

const CAPABILITIES: ImageProviderCapabilities = {
  aspectRatios: ['1:1', '16:9', '9:16'],
  maxN: 1,
  supportsImageToImage: false,
  isAsync: true,
  defaultModels: ['doubao-seedream-3.0-t2i-250415'],
};

const INTERVAL_MS = 2000;
const TIMEOUT_MS = 180_000;

function aspectToSize(ar: ImageAspectRatio | undefined): string {
  switch (ar) {
    case '16:9':
      return '1664x936';
    case '9:16':
      return '936x1664';
    default:
      return '1024x1024';
  }
}

interface DoubaoSubmitResponse {
  id: string;
}

interface DoubaoStatusResponse {
  status: string;
  content?: {
    image_urls?: string[];
  };
  error?: {
    message?: string;
  };
}

export const doubaoImageProvider: ImageGenerationProvider = {
  type: 'doubao',
  capabilities: CAPABILITIES,

  async generate(
    req: ImageGenerationRequest,
    config: ImageProviderConfig,
    ctx: ImageGenerationContext,
  ): Promise<ImageGenerationResult> {
    const baseUrl = (config.baseUrl || 'https://ark.cn-beijing.volces.com').replace(/\/+$/, '');
    const submitUrl = `${baseUrl}/api/v3/contents/generations/tasks`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };

    const result = await pollUntilDone<{ images: ImageGenerationImage[] }>({
      submit: async () => {
        let response: Response;
        try {
          response = await fetch(submitUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: req.model?.trim() || 'doubao-seedream-3.0-t2i-250415',
              content: [{ type: 'text', text: req.prompt }],
              parameters: {
                size: aspectToSize(req.aspectRatio),
                n: req.n ?? 1,
              },
            }),
            signal: ctx.signal,
          });
        } catch (err) {
          if (ctx.signal.aborted) {
            throw new ImageGenerationError('cancelled', 'doubao', '任务已取消', err);
          }
          throw new ImageGenerationError('network', 'doubao', '网络错误，无法连接豆包 Ark', err);
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new ImageGenerationError(
            httpStatusToErrorCode(response.status),
            'doubao',
            `豆包 Ark API 错误 ${response.status}: ${errorText.slice(0, 200)}`,
            undefined,
            errorText,
          );
        }

        const payload = (await response.json()) as DoubaoSubmitResponse;
        return { taskId: payload.id };
      },

      fetchStatus: async (taskId: string) => {
        const statusUrl = `${baseUrl}/api/v3/contents/generations/tasks/${taskId}`;
        let response: Response;
        try {
          response = await fetch(statusUrl, {
            method: 'GET',
            headers,
            signal: ctx.signal,
          });
        } catch (err) {
          if (ctx.signal.aborted) {
            throw new ImageGenerationError('cancelled', 'doubao', '任务已取消', err);
          }
          throw new ImageGenerationError('network', 'doubao', '轮询任务状态失败', err);
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new ImageGenerationError(
            httpStatusToErrorCode(response.status),
            'doubao',
            `豆包 Ark 查询任务失败 ${response.status}: ${errorText.slice(0, 200)}`,
            undefined,
            errorText,
          );
        }

        const payload = (await response.json()) as DoubaoStatusResponse;

        if (payload.status === 'succeeded') {
          const imageUrls = payload.content?.image_urls ?? [];
          const images: ImageGenerationImage[] = imageUrls.map((url) => ({
            url,
            mimeType: 'image/jpeg',
          }));
          return { status: 'succeeded', result: { images } };
        }

        if (payload.status === 'failed') {
          return {
            status: 'failed',
            error: {
              code: 'server',
              message: payload.error?.message ?? '豆包 Ark 异步任务失败',
            },
          };
        }

        // queued | running → 继续轮询
        return { status: 'running' };
      },

      intervalMs: INTERVAL_MS,
      timeoutMs: TIMEOUT_MS,
      onProgress: ctx.onProgress,
      signal: ctx.signal,
      providerType: 'doubao',
    });

    return { images: result.images };
  },
};

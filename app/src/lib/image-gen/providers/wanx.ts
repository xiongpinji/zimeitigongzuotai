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
  maxN: 4,
  supportsImageToImage: false,
  isAsync: true,
  defaultModels: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus', 'wan2.2-t2i-flash'],
};

const INTERVAL_MS = 2000;
const TIMEOUT_MS = 180_000;

function aspectToSize(ar: ImageAspectRatio | undefined): string {
  switch (ar) {
    case '16:9':
      return '1280*720';
    case '9:16':
      return '720*1280';
    default:
      return '1024*1024';
  }
}

interface WanxSubmitResponse {
  output: {
    task_id: string;
    task_status: string;
  };
}

interface WanxStatusResponse {
  output: {
    task_status: string;
    results?: Array<{ url: string }>;
    message?: string;
  };
}

export const wanxImageProvider: ImageGenerationProvider = {
  type: 'wanx',
  capabilities: CAPABILITIES,

  async generate(
    req: ImageGenerationRequest,
    config: ImageProviderConfig,
    ctx: ImageGenerationContext,
  ): Promise<ImageGenerationResult> {
    const baseUrl = (config.baseUrl || 'https://dashscope.aliyuncs.com').replace(/\/+$/, '');
    const submitUrl = `${baseUrl}/api/v1/services/aigc/text2image/image-synthesis`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'X-DashScope-Async': 'enable',
    };

    const result = await pollUntilDone<{ images: ImageGenerationImage[] }>({
      submit: async () => {
        let response: Response;
        try {
          response = await fetch(submitUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: req.model?.trim() || 'wanx2.1-t2i-turbo',
              input: { prompt: req.prompt },
              parameters: {
                n: req.n ?? 1,
                size: aspectToSize(req.aspectRatio),
              },
            }),
            signal: ctx.signal,
          });
        } catch (err) {
          if (ctx.signal.aborted) {
            throw new ImageGenerationError('cancelled', 'wanx', '任务已取消', err);
          }
          throw new ImageGenerationError('network', 'wanx', '网络错误，无法连接通义万相', err);
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new ImageGenerationError(
            httpStatusToErrorCode(response.status),
            'wanx',
            `通义万相 API 错误 ${response.status}: ${errorText.slice(0, 200)}`,
            undefined,
            errorText,
          );
        }

        const payload = (await response.json()) as WanxSubmitResponse;
        return { taskId: payload.output.task_id };
      },

      fetchStatus: async (taskId: string) => {
        const statusUrl = `${baseUrl}/api/v1/tasks/${taskId}`;
        let response: Response;
        try {
          response = await fetch(statusUrl, {
            method: 'GET',
            headers: { Authorization: `Bearer ${config.apiKey}` },
            signal: ctx.signal,
          });
        } catch (err) {
          if (ctx.signal.aborted) {
            throw new ImageGenerationError('cancelled', 'wanx', '任务已取消', err);
          }
          throw new ImageGenerationError('network', 'wanx', '轮询任务状态失败', err);
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new ImageGenerationError(
            httpStatusToErrorCode(response.status),
            'wanx',
            `通义万相查询任务失败 ${response.status}: ${errorText.slice(0, 200)}`,
            undefined,
            errorText,
          );
        }

        const payload = (await response.json()) as WanxStatusResponse;
        const taskStatus = payload.output.task_status;

        if (taskStatus === 'SUCCEEDED') {
          const results = payload.output.results ?? [];
          const images: ImageGenerationImage[] = results.map((r) => ({
            url: r.url,
            mimeType: 'image/jpeg',
          }));
          return { status: 'succeeded', result: { images } };
        }

        if (taskStatus === 'FAILED') {
          return {
            status: 'failed',
            error: {
              code: 'server',
              message: payload.output.message ?? 'wanx 任务失败',
            },
          };
        }

        // PENDING | RUNNING → 继续轮询
        return { status: 'running' };
      },

      intervalMs: INTERVAL_MS,
      timeoutMs: TIMEOUT_MS,
      onProgress: ctx.onProgress,
      signal: ctx.signal,
      providerType: 'wanx',
    });

    return { images: result.images };
  },
};

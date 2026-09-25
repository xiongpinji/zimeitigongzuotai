import type { ImageProviderType } from '../../types/ai';

export type ImageGenerationErrorCode =
  | 'network'
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'invalid_request'
  | 'content_policy'
  | 'timeout'
  | 'cancelled'
  | 'server'
  | 'unknown';

export class ImageGenerationError extends Error {
  readonly code: ImageGenerationErrorCode;
  readonly providerType: ImageProviderType;
  readonly cause?: unknown;
  readonly raw?: unknown;

  constructor(
    code: ImageGenerationErrorCode,
    providerType: ImageProviderType,
    message: string,
    cause?: unknown,
    raw?: unknown,
  ) {
    super(message);
    this.name = 'ImageGenerationError';
    this.code = code;
    this.providerType = providerType;
    this.cause = cause;
    this.raw = raw;
  }
}

/** HTTP 状态码到统一错误码的映射；invalid_request 由调用方根据响应体细分 content_policy */
export function httpStatusToErrorCode(status: number): ImageGenerationErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  if (status >= 400) return 'invalid_request';
  return 'unknown';
}

export function isImageGenerationError(err: unknown): err is ImageGenerationError {
  return err instanceof ImageGenerationError;
}

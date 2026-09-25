import { describe, expect, it } from 'vitest';
import {
  ImageGenerationError,
  httpStatusToErrorCode,
  isImageGenerationError,
} from '../../src/lib/image-gen/errors';

describe('httpStatusToErrorCode', () => {
  it('映射常见 HTTP 状态码', () => {
    expect(httpStatusToErrorCode(401)).toBe('auth');
    expect(httpStatusToErrorCode(403)).toBe('auth');
    expect(httpStatusToErrorCode(402)).toBe('quota');
    expect(httpStatusToErrorCode(429)).toBe('rate_limited');
    expect(httpStatusToErrorCode(408)).toBe('timeout');
    expect(httpStatusToErrorCode(504)).toBe('timeout');
    expect(httpStatusToErrorCode(500)).toBe('server');
    expect(httpStatusToErrorCode(502)).toBe('server');
    expect(httpStatusToErrorCode(400)).toBe('invalid_request');
    expect(httpStatusToErrorCode(200)).toBe('unknown');
  });
});

describe('ImageGenerationError', () => {
  it('保留 code/providerType/cause/raw', () => {
    const cause = new Error('underlying');
    const raw = { foo: 'bar' };
    const err = new ImageGenerationError('auth', 'jimeng', '认证失败', cause, raw);
    expect(err.message).toBe('认证失败');
    expect(err.code).toBe('auth');
    expect(err.providerType).toBe('jimeng');
    expect(err.cause).toBe(cause);
    expect(err.raw).toBe(raw);
    expect(err.name).toBe('ImageGenerationError');
  });

  it('isImageGenerationError 类型守卫', () => {
    expect(isImageGenerationError(new ImageGenerationError('unknown', 'jimeng', 'x'))).toBe(true);
    expect(isImageGenerationError(new Error('x'))).toBe(false);
    expect(isImageGenerationError(null)).toBe(false);
  });
});

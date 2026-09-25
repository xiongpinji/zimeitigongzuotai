import { describe, it, expect } from 'vitest';
import {
  makeError,
  isMonitorCircuitBreaker,
  SonarException,
  toSonarError,
} from '@/domain/errors';

describe('makeError', () => {
  it('builds a standardized error with code and message', () => {
    const e = makeError('TIMEOUT', '请求超时', { retryable: true, nextAction: '稍后重试' });
    expect(e).toEqual({
      code: 'TIMEOUT',
      message: '请求超时',
      retryable: true,
      nextAction: '稍后重试',
    });
  });
});

describe('isMonitorCircuitBreaker', () => {
  it('flags login/captcha/access-restricted as circuit breakers', () => {
    expect(isMonitorCircuitBreaker('NOT_LOGGED_IN')).toBe(true);
    expect(isMonitorCircuitBreaker('CAPTCHA_REQUIRED')).toBe(true);
    expect(isMonitorCircuitBreaker('ACCESS_RESTRICTED')).toBe(true);
  });

  it('does not flag retryable network/timeout errors', () => {
    expect(isMonitorCircuitBreaker('NETWORK_ERROR')).toBe(false);
    expect(isMonitorCircuitBreaker('TIMEOUT')).toBe(false);
  });
});

describe('SonarException', () => {
  it('carries a SonarError and exposes it', () => {
    const ex = new SonarException(makeError('ASR_NOT_CONFIGURED', '未配置 ASR'));
    expect(ex).toBeInstanceOf(Error);
    expect(ex.error.code).toBe('ASR_NOT_CONFIGURED');
    expect(ex.message).toBe('未配置 ASR');
  });
});

describe('toSonarError', () => {
  it('returns the inner SonarError from a SonarException', () => {
    const ex = new SonarException(makeError('DOWNLOAD_FAILED', '下载失败'));
    expect(toSonarError(ex).code).toBe('DOWNLOAD_FAILED');
  });

  it('wraps an arbitrary thrown Error as NETWORK_ERROR by default', () => {
    const e = toSonarError(new Error('socket hang up'));
    expect(e.code).toBe('NETWORK_ERROR');
    expect(e.detail).toContain('socket hang up');
  });

  it('wraps unknown non-error throwables', () => {
    const e = toSonarError('boom');
    expect(e.code).toBe('NETWORK_ERROR');
  });
});

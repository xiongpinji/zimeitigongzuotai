/**
 * 标准化错误模型（设计文档第 10 节）。
 *
 * 抖音原始失败、网络异常与 Provider 返回都必须归类到固定 SonarErrorCode。
 * UI 只消费标准化错误，不直接看到底层异常细节。
 */

export type SonarErrorCode =
  // 登录态 / 风控（监控熔断类）
  | 'NOT_LOGGED_IN'
  | 'CAPTCHA_REQUIRED'
  | 'ACCESS_RESTRICTED'
  // 页面 / 作品识别
  | 'UNSUPPORTED_PAGE'
  | 'VIDEO_NOT_FOUND'
  // 视频源 / 下载
  | 'NO_DOWNLOADABLE_SOURCE'
  | 'NO_WATERMARK_SOURCE'
  | 'SOURCE_EXPIRED'
  | 'DOWNLOAD_FAILED'
  // 媒体处理
  | 'MEDIA_FETCH_FAILED'
  | 'MEDIA_TOO_LARGE'
  | 'AUDIO_EXTRACTION_FAILED'
  // ASR
  | 'ASR_NOT_CONFIGURED'
  | 'ASR_UPLOAD_FAILED'
  | 'ASR_FAILED'
  // 摘要
  | 'SUMMARY_NOT_CONFIGURED'
  | 'SUMMARY_FAILED'
  | 'SUMMARY_INVALID_RESPONSE'
  // 爆款拆解（工作流流水线）
  | 'INSIGHT_NOT_CONFIGURED'
  | 'INSIGHT_FAILED'
  | 'INSIGHT_INVALID_RESPONSE'
  // 桥（灵机剪影联动）
  | 'BRIDGE_UNREACHABLE'
  | 'BRIDGE_UNAUTHORIZED'
  | 'BRIDGE_FAILED'
  // 导出 / 通用
  | 'EXPORT_FAILED'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR'
  | 'TIMEOUT';

/**
 * 监控熔断类错误：出现即应暂停自动监控，不做连续重试。
 */
export const MONITOR_CIRCUIT_BREAKER_CODES = [
  'NOT_LOGGED_IN',
  'CAPTCHA_REQUIRED',
  'ACCESS_RESTRICTED',
] as const satisfies readonly SonarErrorCode[];

export interface SonarError {
  code: SonarErrorCode;
  /** 面向用户的简短说明（中文）。 */
  message: string;
  /** UI 应引导的下一步动作，如「重新登录抖音」「配置 ASR」「只重试摘要」。 */
  nextAction?: string;
  /** 是否可重试（网络类可指数退避；熔断类不可）。 */
  retryable?: boolean;
  /** 脱敏的诊断附注，不含 Cookie / Token / 短期签名参数。 */
  detail?: string;
}

/** 构造标准化错误。 */
export function makeError(
  code: SonarErrorCode,
  message: string,
  options: Omit<SonarError, 'code' | 'message'> = {},
): SonarError {
  return { code, message, ...options };
}

/** 面向用户的错误文案：附上脱敏 detail（如 ffmpeg / 底层报错），便于排查而非只看笼统提示。 */
export function sonarErrorText(error?: SonarError): string | undefined {
  if (!error) return undefined;
  return error.detail && error.detail !== error.message
    ? `${error.message}（${error.detail}）`
    : error.message;
}

/** 判断某错误是否应触发自动监控熔断（登录失效 / 验证码 / 访问限制）。 */
export function isMonitorCircuitBreaker(code: SonarErrorCode): boolean {
  return (MONITOR_CIRCUIT_BREAKER_CODES as readonly SonarErrorCode[]).includes(code);
}

/** 携带标准化 SonarError 的异常，供 handler 抛出、client / router 捕获。 */
export class SonarException extends Error {
  readonly error: SonarError;
  constructor(error: SonarError) {
    super(error.message);
    this.name = 'SonarException';
    this.error = error;
  }
}

/**
 * 把任意 throwable 归一化为标准化 SonarError。
 * SonarException 直接取内部错误；其余兜底为可重试的 NETWORK_ERROR 并附脱敏说明。
 */
export function toSonarError(thrown: unknown): SonarError {
  if (thrown instanceof SonarException) return thrown.error;
  if (thrown instanceof Error) {
    return makeError('NETWORK_ERROR', thrown.message || '未知错误', {
      retryable: true,
      detail: thrown.message,
    });
  }
  return makeError('NETWORK_ERROR', '未知错误', { retryable: true, detail: String(thrown) });
}

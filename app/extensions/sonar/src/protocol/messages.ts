/**
 * 跨上下文消息协议（设计文档第 6 节）。
 *
 * UI（DouyinClient）↔ Service Worker ↔ Content Script 之间用可判别联合类型通信。
 * 每条消息携带 protocolVersion / requestId / method / params，或标准成功结果 / 标准错误。
 * 未知协议版本与未知方法必须显式失败，不能静默忽略。
 */
import type { SonarError } from '@/domain/errors';
import { METHOD_SET, type MethodName } from './methods';

export const PROTOCOL_VERSION = 1 as const;

export interface RequestEnvelope<M extends MethodName = MethodName> {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  method: M;
  params: unknown;
}

export type ResponseEnvelope =
  | { protocolVersion: typeof PROTOCOL_VERSION; requestId: string; ok: true; result: unknown }
  | { protocolVersion: typeof PROTOCOL_VERSION; requestId: string; ok: false; error: SonarError };

/** 解码结果：成功带值，失败带标准化错误（不抛异常，便于跨上下文统一处理）。 */
export type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SonarError };

function generateRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRequest<M extends MethodName>(
  method: M,
  params: unknown,
  options: { requestId?: string } = {},
): RequestEnvelope<M> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId ?? generateRequestId(),
    method,
    params,
  };
}

export function createSuccess(requestId: string, result: unknown): ResponseEnvelope {
  return { protocolVersion: PROTOCOL_VERSION, requestId, ok: true, result };
}

export function createFailure(requestId: string, error: SonarError): ResponseEnvelope {
  return { protocolVersion: PROTOCOL_VERSION, requestId, ok: false, error };
}

function parseError(message: string, detail?: string): { ok: false; error: SonarError } {
  return { ok: false, error: { code: 'PARSE_ERROR', message, detail } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function decodeRequest(raw: unknown): DecodeResult<RequestEnvelope> {
  if (!isRecord(raw)) return parseError('消息负载不是对象');
  if (raw.protocolVersion !== PROTOCOL_VERSION) {
    return parseError(`未知协议版本：${String(raw.protocolVersion)}`);
  }
  if (typeof raw.requestId !== 'string' || raw.requestId.length === 0) {
    return parseError('缺少有效的 requestId');
  }
  if (!METHOD_SET.has(raw.method as string)) {
    return parseError(`未知方法：${String(raw.method)}`);
  }
  return {
    ok: true,
    value: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: raw.requestId,
      method: raw.method as MethodName,
      params: raw.params,
    },
  };
}

export function decodeResponse(raw: unknown): DecodeResult<ResponseEnvelope> {
  if (!isRecord(raw)) return parseError('响应负载不是对象');
  if (raw.protocolVersion !== PROTOCOL_VERSION) {
    return parseError(`未知协议版本：${String(raw.protocolVersion)}`);
  }
  if (typeof raw.requestId !== 'string' || raw.requestId.length === 0) {
    return parseError('缺少有效的 requestId');
  }
  if (raw.ok === true) {
    return {
      ok: true,
      value: { protocolVersion: PROTOCOL_VERSION, requestId: raw.requestId, ok: true, result: raw.result },
    };
  }
  if (raw.ok === false) {
    if (!isRecord(raw.error) || typeof raw.error.code !== 'string') {
      return parseError('失败响应缺少标准化 error');
    }
    return {
      ok: true,
      value: {
        protocolVersion: PROTOCOL_VERSION,
        requestId: raw.requestId,
        ok: false,
        error: raw.error as unknown as SonarError,
      },
    };
  }
  return parseError('响应缺少 ok 判别字段');
}

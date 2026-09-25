/**
 * Service Worker 消息路由（设计文档 5.4）。
 *
 * 把 UI 发来的类型化请求解码、按 method 分发到 handler，再把结果或标准化错误包成
 * ResponseEnvelope。未知协议版本 / 未知方法显式失败；handler 抛出的异常统一归一化。
 */
import {
  createFailure,
  createSuccess,
  decodeRequest,
  type ResponseEnvelope,
} from '@/protocol/messages';
import type { MethodName } from '@/protocol/methods';
import { makeError, toSonarError } from '@/domain/errors';

export type MethodHandler = (params: unknown) => Promise<unknown>;
export type HandlerMap = Partial<Record<MethodName, MethodHandler>>;

export interface Router {
  dispatch(raw: unknown): Promise<ResponseEnvelope>;
}

function bestEffortRequestId(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null) {
    const id = (raw as Record<string, unknown>).requestId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return 'unknown';
}

export function createRouter(handlers: HandlerMap): Router {
  return {
    async dispatch(raw: unknown): Promise<ResponseEnvelope> {
      const decoded = decodeRequest(raw);
      if (!decoded.ok) {
        return createFailure(bestEffortRequestId(raw), decoded.error);
      }
      const { requestId, method, params } = decoded.value;
      const handler = handlers[method];
      if (!handler) {
        return createFailure(requestId, makeError('PARSE_ERROR', `方法未注册：${method}`));
      }
      try {
        const result = await handler(params);
        return createSuccess(requestId, result);
      } catch (thrown) {
        return createFailure(requestId, toSonarError(thrown));
      }
    },
  };
}

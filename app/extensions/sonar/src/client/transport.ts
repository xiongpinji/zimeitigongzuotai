/**
 * 传输层：把请求 envelope 送达 Service Worker 并取回响应 envelope。
 *
 * UI 不直接调用 chrome.runtime，而是经此抽象，便于测试（用直连 router 的传输替换）。
 */
import type { RequestEnvelope, ResponseEnvelope } from '@/protocol/messages';
import type { Router } from '@/background/router';

export interface Transport {
  send(request: RequestEnvelope): Promise<ResponseEnvelope>;
}

/** 运行时实现：经 chrome.runtime.sendMessage 与 Service Worker 通信。 */
export function createChromeRuntimeTransport(): Transport {
  return {
    async send(request) {
      return (await chrome.runtime.sendMessage(request)) as ResponseEnvelope;
    },
  };
}

/** 测试 / 进程内实现：直接调用 router.dispatch，不经 chrome。 */
export function createDirectTransport(router: Router): Transport {
  return {
    async send(request) {
      return router.dispatch(request);
    },
  };
}

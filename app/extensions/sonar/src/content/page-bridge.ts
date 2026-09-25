/**
 * PageBridge（MAIN world）。
 *
 * 在页面主环境包装 fetch / XMLHttpRequest，只观察白名单 URL 的成功 JSON 响应，
 * 克隆并限制负载后，用带随机会话标识的 window.postMessage 发给 Content Script。
 *
 * 约束：
 * - 复用抖音网页已完成的登录、签名、风控流程；不读取或导出认证数据。
 * - 不持久化、不下载、不做业务判断。
 * - 保持原函数语义透明；支持重复注入保护与卸载。
 */
import {
  CAPTURE_MARKER_KEY,
  buildCapturedMessage,
  matchTargetUrl,
  type ResponseCategory,
} from './page-capture';

const INSTALL_FLAG = '__sonarBridgeInstalled';
const SESSION_ATTR = 'sonarSession';

interface BridgeWindow extends Window {
  [INSTALL_FLAG]?: boolean;
  __sonarBridgeTeardown?: () => void;
}

function readSessionId(): string | null {
  const el = document.documentElement;
  const id = el.dataset[SESSION_ATTR];
  if (id) {
    // 读取后立即清除，避免会话标识长期暴露在 DOM 上。
    delete el.dataset[SESSION_ATTR];
    return id;
  }
  return null;
}

function emit(sessionId: string, category: ResponseCategory, url: string, payload: unknown): void {
  const message = buildCapturedMessage({ sessionId, category, url, payload });
  if (!message) return;
  try {
    window.postMessage(message, window.location.origin);
  } catch {
    /* 负载含不可结构化克隆的数据时静默丢弃 */
  }
}

async function parseJsonSafely(text: string): Promise<unknown | undefined> {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function install(): void {
  const w = window as BridgeWindow;
  if (w[INSTALL_FLAG]) return;
  const sessionId = readSessionId();
  if (!sessionId) return; // 没有会话标识则不安装，避免被第三方脚本伪造触发
  w[INSTALL_FLAG] = true;

  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  // —— fetch 包装 ——
  window.fetch = async function patchedFetch(
    this: typeof window,
    ...args: Parameters<typeof fetch>
  ): Promise<Response> {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request | URL).toString();
      const category = matchTargetUrl(url);
      if (category && response.ok) {
        // 克隆后读取，保持原响应体对页面可用。
        void response
          .clone()
          .text()
          .then((text) => parseJsonSafely(text))
          .then((payload) => {
            if (payload !== undefined) emit(sessionId, category, url, payload);
          })
          .catch(() => undefined);
      }
    } catch {
      /* 观察失败不影响页面请求 */
    }
    return response;
  } as typeof fetch;

  // —— XHR 包装 ——
  const urlMap = new WeakMap<XMLHttpRequest, string>();
  const patchedOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    urlMap.set(this, typeof url === 'string' ? url : url.toString());
    return originalXhrOpen.apply(this, [method, url, ...rest] as never);
  };
  XMLHttpRequest.prototype.open = patchedOpen as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function patchedSend(
    this: XMLHttpRequest,
    ...sendArgs: Parameters<XMLHttpRequest['send']>
  ): void {
    const url = urlMap.get(this);
    if (url) {
      const category = matchTargetUrl(url);
      if (category) {
        this.addEventListener('load', () => {
          try {
            if (this.status >= 200 && this.status < 300 && typeof this.responseText === 'string') {
              void parseJsonSafely(this.responseText).then((payload) => {
                if (payload !== undefined) emit(sessionId, category, url, payload);
              });
            }
          } catch {
            /* ignore */
          }
        });
      }
    }
    return originalXhrSend.apply(this, sendArgs as never);
  };

  w.__sonarBridgeTeardown = () => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalXhrOpen;
    XMLHttpRequest.prototype.send = originalXhrSend;
    w[INSTALL_FLAG] = false;
    delete w.__sonarBridgeTeardown;
  };
}

install();

// 导出标记键，便于 Content Script 与本模块共用常量。
export { CAPTURE_MARKER_KEY };

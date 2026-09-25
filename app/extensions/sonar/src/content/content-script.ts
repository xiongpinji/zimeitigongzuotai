/**
 * Content Script（ISOLATED world）。
 *
 * 职责：生成随机会话标识并注入 MAIN world 的 PageBridge；校验来自页面的消息来源、
 * 会话标识与数据结构；把通过校验的捕获响应转交 Service Worker。
 *
 * 注意：这里只转发「页面自身成功返回的响应」，不主动发起抖音请求，也不触碰认证数据。
 */
import bridgeUrl from './page-bridge?script&module';
import { parseCapturedMessage } from './page-capture';
import { mountInjectedUi } from './inject-ui';
import { detectPageFromUrl } from '@/adapter/page-detection';
import { advanceCaptureStability, extractCreatorPageFromDom } from './dom-extractor';
import { runFullCollectInPage } from './collect-in-page';
import { isMatchingCreatorPage } from './scroll-collect';

function generateSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `sonar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const sessionId = generateSessionId();

function injectPageBridge(): void {
  // 通过 documentElement 的 data 属性把会话标识传给 MAIN world 的 bridge（共享 DOM）。
  document.documentElement.dataset.sonarSession = sessionId;
  const script = document.createElement('script');
  script.type = 'module';
  script.src = chrome.runtime.getURL(bridgeUrl);
  script.dataset.sonar = 'page-bridge';
  (document.head || document.documentElement).appendChild(script);
  script.addEventListener('load', () => script.remove());
}

// 接收页面 postMessage：只信任 source 为本窗口、origin 为当前页、且会话标识匹配的消息。
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const captured = parseCapturedMessage(event.data, sessionId);
  if (!captured) return;
  void chrome.runtime
    .sendMessage({
      kind: 'sonar/page-capture',
      category: captured.category,
      url: captured.url,
      payload: captured.payload,
      pageUrl: window.location.href,
    })
    .catch(() => {
      /* Service Worker 未就绪时丢弃单条捕获，下次页面响应会再次捕获 */
    });
});

injectPageBridge();

// —— 博主主页「主动提取」（DOM/SSR fallback）——
// 抖音新版主页用 RSC 流式 SSR 渲染，不再发起 /aweme/v1/web/aweme/post/ 与
// /aweme/v1/web/user/profile/other/，PageBridge 的被动拦截因此失效。这里在博主页
// 读取渲染后的 DOM，提取博主资料与作品列表，转发给 Service Worker 入库。
const DOM_CAPTURE_MAX_WAIT_MS = 15_000;
const DOM_CAPTURE_POLL_MS = 800;

function captureCreatorPageFromDom(): boolean {
  const page = detectPageFromUrl(window.location.href);
  if (page.type !== 'creator' || !page.secUid) return false;
  const extract = extractCreatorPageFromDom(document, page.secUid, Date.now());
  if (!extract) return false;
  void chrome.runtime
    .sendMessage({
      kind: 'sonar/dom-capture',
      creator: extract.creator,
      videos: extract.videos,
      pageUrl: window.location.href,
    })
    .catch(() => {
      /* Service Worker 未就绪时丢弃，下一轮轮询/导航会再次提取 */
    });
  return true;
}

let domCaptureTimer: ReturnType<typeof setTimeout> | null = null;
function startCreatorPageDomCapture(): void {
  if (domCaptureTimer) {
    clearTimeout(domCaptureTimer);
    domCaptureTimer = null;
  }
  const page = detectPageFromUrl(window.location.href);
  if (page.type !== 'creator') return;
  const deadline = Date.now() + DOM_CAPTURE_MAX_WAIT_MS;
  let stability = { lastCount: 0, stableRounds: 0 };
  const tick = (): void => {
    // 首屏会先出现 1–2 张卡片再渐进补齐，不能一看到 li 就停止，否则会稳定复现“只抓到 2 条”。
    captureCreatorPageFromDom();
    const itemCount = document.querySelectorAll('[data-e2e="user-post-list"] li').length;
    const advanced = advanceCaptureStability(stability, itemCount);
    stability = advanced.state;
    if (advanced.settled) return;
    if (Date.now() >= deadline) return;
    domCaptureTimer = setTimeout(tick, DOM_CAPTURE_POLL_MS);
  };
  tick();
}

// 抖音是 SPA，URL 变化时重新提取当前博主页。
let lastCaptureUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastCaptureUrl) {
    lastCaptureUrl = window.location.href;
    startCreatorPageDomCapture();
  }
}, 1500);

// —— 博主主页「全量滚动采集」消息入口 ——
// 兼容由 Service Worker（collectCreatorFully）向当前页发起的采集；实际滚动加载在
// collect-in-page.ts 内执行（当前可见页才能触发懒加载）。浮层按钮则直接调用同一函数。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    (message as { kind?: unknown }).kind === 'sonar/start-full-collect'
  ) {
    const page = detectPageFromUrl(window.location.href);
    const secUid = (message as { secUid?: unknown }).secUid;
    const targetSecUid = typeof secUid === 'string' && secUid ? secUid : page.secUid;
    if (page.type === 'creator' && targetSecUid && isMatchingCreatorPage(page.secUid, targetSecUid)) {
      // 立即回 ack（让发起方知道 Content Script 已就绪），采集在后台推进。
      sendResponse({ ok: true });
      void runFullCollectInPage(targetSecUid);
    } else {
      sendResponse({ ok: false });
    }
    return false;
  }
  return undefined;
});

// 页面注入 UI 需要 DOM 就绪。
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    mountInjectedUi();
    startCreatorPageDomCapture();
  }, { once: true });
} else {
  mountInjectedUi();
  startCreatorPageDomCapture();
}

export {};

/**
 * 当前页全量采集（Content Script 内执行）。
 *
 * 抖音主页作品懒加载，只有「正在渲染的可见标签页」滚动才会追加；因此采集在用户当前
 * 可见的主页内直接进行（Content Script 已运行于该页）。滚动加载全部、流式把
 * dom-capture（幂等入库）与 collect-progress（进度，供 SW 中枢/其它表面）发给 Service
 * Worker，并通过 onProgress 即时回调给浮层 UI。结束后滚回采集前的位置。
 *
 * 提供给 content-script.ts 的消息入口与 inject-ui.ts 的「采集全部」按钮共用，
 * 避免经 Service Worker 反查「激活标签页」（受窗口焦点影响、不可靠）。
 */
import { collectAllPostItems, findPostScrollContainer } from './scroll-collect';
import { extractCreatorPageFromDom } from './dom-extractor';

export interface InPageCollectProgress {
  collected: number;
  total?: number;
  round: number;
  done: boolean;
}

export interface InPageCollectResult {
  collected: number;
  total?: number;
}

let running = false;

/** 当前页是否正在全量采集（防重复触发）。 */
export function isFullCollectRunning(): boolean {
  return running;
}

/**
 * 在当前页滚动加载并采集某博主全部作品。
 * onProgress 即时回调（供浮层 UI 直接更新）；同时把 dom-capture / collect-progress 发给 SW。
 */
export async function runFullCollectInPage(
  secUid: string,
  onProgress?: (p: InPageCollectProgress) => void,
): Promise<InPageCollectResult> {
  if (running) return { collected: 0 };
  running = true;

  // 采集会滚动用户正在看的主页：记录初始位置，结束后滚回。
  const container = findPostScrollContainer(document);
  const initialScrollTop = container?.scrollTop ?? window.scrollY;

  const sendCapture = (): void => {
    const extract = extractCreatorPageFromDom(document, secUid, Date.now());
    if (!extract) return;
    void chrome.runtime
      .sendMessage({
        kind: 'sonar/dom-capture',
        creator: extract.creator,
        videos: extract.videos,
        pageUrl: window.location.href,
      })
      .catch(() => {});
  };
  const sendProgress = (collected: number, total: number | undefined, round: number, done: boolean): void => {
    void chrome.runtime
      .sendMessage({ kind: 'sonar/collect-progress', secUid, collected, total, round, done, pageUrl: window.location.href })
      .catch(() => {});
  };

  let lastTotal: number | undefined;
  try {
    const items = await collectAllPostItems(document, {
      onProgress: (p) => {
        // 结束或每 4 轮入库一次（不虚拟化时终态即全量，分批对未来虚拟化兜底）。
        if (p.done || p.round % 4 === 0) sendCapture();
        sendProgress(p.collected, p.total, p.round, p.done);
        lastTotal = p.total;
        onProgress?.(p);
      },
    });
    return { collected: items.length, ...(lastTotal !== undefined ? { total: lastTotal } : {}) };
  } catch (e) {
    console.warn('[Sonar] 全量采集失败', e);
    const fallback = document.querySelectorAll('[data-e2e="user-post-list"] li').length;
    sendProgress(fallback, lastTotal, 0, true);
    return { collected: fallback, ...(lastTotal !== undefined ? { total: lastTotal } : {}) };
  } finally {
    running = false;
    if (container) container.scrollTop = initialScrollTop;
    else window.scrollTo(0, initialScrollTop);
  }
}

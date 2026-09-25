/**
 * 博主主页作品「全量滚动采集」（completeness fix）。
 *
 * 抖音主页作品列表是懒加载的：首屏只渲染约 20 条，滚动到底才追加下一批，
 * 直到出现「暂时没有更多了」。旧的 DOM 提取只读首屏 `<li>`（见 dom-extractor.ts），
 * 因此 607 条只入库 ~71 条。这里反复滚动到底、累积去重，直到加载齐全。
 *
 * 实测（2026-06-22，合伙人Mike 607 作品）：
 * - 列表**不虚拟化**：滚动后早期 `<li>` 仍在 DOM，故 `readPostItems` 终态即可拿全量；
 *   仍按 awemeId 累积去重，对未来可能的虚拟化兜底。
 * - 滚动容器**不是 window**：需向上找首个可滚动祖先（`.parent-route-container`）。
 * - 总数读 `[data-e2e="user-tab-count"]`；结束哨兵文本「暂时没有更多了」。
 *
 * 设计：纯驱动 `runCollectLoop`（不触碰 DOM，注入 adapter，可在 node 下单测）+
 * 薄 DOM 适配层 `createDomCollectAdapter`（仅 Content Script 调用）。
 */
import type { RawPostItem } from './dom-extractor';
import { readPostItems } from './dom-extractor';

export interface CollectProgress {
  /** 已累积去重的作品数。 */
  collected: number;
  /** 主页声明的作品总数（读不到为 undefined）。 */
  total?: number;
  /** 已滚动轮次。 */
  round: number;
  /** 是否已结束（命中 total / 哨兵 / 停滞 / 上限 / 外部中止）。 */
  done: boolean;
}

/** 采集循环依赖的抽象（DOM 与测试各自实现）。 */
export interface CollectLoopAdapter {
  /** 读取当前已渲染的作品项。 */
  readItems(): RawPostItem[];
  /** 把列表滚动到底，触发下一批懒加载。 */
  scrollToBottom(): void;
  /** 是否已出现「没有更多了」结束哨兵。 */
  isEnd(): boolean;
  /** 主页声明的作品总数（读不到返回 undefined）。 */
  getTotal(): number | undefined;
}

export interface CollectLoopOptions {
  /** 每次滚动后等待懒加载的毫秒数（默认 1200）。 */
  scrollWaitMs?: number;
  /** 最大滚动轮次（安全上限，默认 300）。 */
  maxRounds?: number;
  /** 连续无新增达到此轮次判定结束（默认 6）。 */
  stagnantLimit?: number;
  /** 每轮进度回调（首轮与结束各回调一次）。 */
  onProgress?: (p: CollectProgress) => void | Promise<void>;
  /** 外部中止信号（如标签页关闭 / 用户取消）。 */
  shouldStop?: () => boolean;
  /** 等待实现（测试注入立即返回）。 */
  sleep?: (ms: number) => Promise<void>;
}

/** 结束哨兵文案（不同版本/语言）。 */
export const NO_MORE_PATTERNS: readonly RegExp[] = [
  /暂时没有更多了/,
  /没有更多了/,
  /已经到底了/,
  /到底啦/,
];

/** 文本是否包含「没有更多」结束哨兵（纯函数）。 */
export function hasNoMoreSentinel(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  return NO_MORE_PATTERNS.some((re) => re.test(text));
}

/** 解析作品总数标签文本（'作品607' / '607' / '1,234'），取首个整数（纯函数）。 */
export function parsePostTotal(text: string | null | undefined): number | undefined {
  if (typeof text !== 'string') return undefined;
  const m = text.replace(/[,\s]/g, '').match(/(\d+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 防止后台消息把 A 博主的 secUid 错套到当前打开的 B 博主页。 */
export function isMatchingCreatorPage(
  pageSecUid: string | undefined,
  requestedSecUid: string,
): boolean {
  return typeof pageSecUid === 'string' && pageSecUid === requestedSecUid;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 纯驱动：反复 scrollToBottom + 累积去重，直到加载齐全。
 * 终止条件（任一）：collected ≥ total / isEnd() / 连续 stagnantLimit 轮无新增 /
 * 达到 maxRounds / shouldStop()。返回去重后的全部作品项。
 */
export async function runCollectLoop(
  adapter: CollectLoopAdapter,
  options: CollectLoopOptions = {},
): Promise<RawPostItem[]> {
  const scrollWaitMs = options.scrollWaitMs ?? 1200;
  const maxRounds = options.maxRounds ?? 300;
  const stagnantLimit = options.stagnantLimit ?? 6;
  const sleep = options.sleep ?? defaultSleep;

  const acc = new Map<string, RawPostItem>();
  const merge = (): void => {
    for (const it of adapter.readItems()) {
      if (it.awemeId) acc.set(it.awemeId, it);
    }
  };

  const total = adapter.getTotal();
  let stagnant = 0;
  let round = 0;
  merge();
  await options.onProgress?.({ collected: acc.size, total, round, done: false });

  while (round < maxRounds) {
    if (options.shouldStop?.()) break;
    if (total !== undefined && acc.size >= total) break;
    if (adapter.isEnd()) break;
    if (stagnant >= stagnantLimit) break;

    const before = acc.size;
    adapter.scrollToBottom();
    await sleep(scrollWaitMs);
    round += 1;
    merge();
    if (acc.size > before) stagnant = 0;
    else stagnant += 1;
    await options.onProgress?.({ collected: acc.size, total, round, done: false });
  }

  const items = [...acc.values()];
  await options.onProgress?.({ collected: items.length, total, round, done: true });
  return items;
}

// —— 以下为 DOM 适配层：仅在 Content Script（浏览器）中调用 ——

/** 向上找首个可滚动祖先（懒加载真正的滚动容器），找不到退化到 scrollingElement。 */
export function findPostScrollContainer(doc: Document): Element | null {
  const list = doc.querySelector('[data-e2e="user-post-list"]');
  const view = doc.defaultView;
  let n: Element | null = list;
  while (n && n !== doc.body) {
    const s = view?.getComputedStyle(n);
    if (s && /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 50) return n;
    n = n.parentElement;
  }
  return doc.scrollingElement;
}

/** 读取主页作品总数（`[data-e2e="user-tab-count"]`）。 */
export function readPostTotal(doc: Document): number | undefined {
  return parsePostTotal(doc.querySelector('[data-e2e="user-tab-count"]')?.textContent);
}

/** 作品列表是否已到底（出现结束哨兵）。 */
export function isPostListEndReached(doc: Document): boolean {
  const list = doc.querySelector('[data-e2e="user-post-list"]');
  const scope = list?.parentElement ?? list;
  return hasNoMoreSentinel(scope?.textContent);
}

/** 构造基于真实 DOM 的采集 adapter。 */
export function createDomCollectAdapter(doc: Document): CollectLoopAdapter {
  const container = findPostScrollContainer(doc);
  return {
    readItems: () => readPostItems(doc),
    scrollToBottom: () => {
      if (container) container.scrollTop = container.scrollHeight;
      doc.defaultView?.scrollTo(0, doc.documentElement.scrollHeight);
    },
    isEnd: () => isPostListEndReached(doc),
    getTotal: () => readPostTotal(doc),
  };
}

/** 在真实主页 Document 上跑全量滚动采集，返回去重后的全部作品项。 */
export function collectAllPostItems(
  doc: Document,
  options?: CollectLoopOptions,
): Promise<RawPostItem[]> {
  return runCollectLoop(createDomCollectAdapter(doc), options);
}

/**
 * 全量采集进度中枢（Service Worker 侧）。
 *
 * Content Script 滚动采集时通过 sonar/collect-progress 上报进度，这里：
 * - 在内存与 chrome.storage.local 各存一份（UI 轮询 / SW 回收重建后仍可读）；
 * - 提供 waitForDone：后台 runner 等到某博主采集完成（done）或超时再关标签页。
 *
 * 纯逻辑（update / get / waitForDone）可单测；chrome.storage 写入 best-effort，无则跳过。
 */
export interface CollectProgressInfo {
  secUid: string;
  collected: number;
  total?: number;
  round: number;
  done: boolean;
  updatedAt: number;
}

export const COLLECT_PROGRESS_STORAGE_KEY = 'sonar.collectProgress';

type Listener = (info: CollectProgressInfo) => void;

export interface CollectProgressHub {
  /** 上报一条进度（done 时唤醒 waitForDone）。 */
  update(info: Omit<CollectProgressInfo, 'updatedAt'>): void;
  /** 读取某博主的最新进度。 */
  get(secUid: string): CollectProgressInfo | null;
  /** 等到某博主 done 或超时；返回最后已知进度（超时可能为 null）。 */
  waitForDone(secUid: string, timeoutMs: number): Promise<CollectProgressInfo | null>;
}

interface HubDeps {
  now: () => number;
  /** 持久化写入（默认尝试 chrome.storage.local，可注入测试桩）。 */
  persist?: (all: Record<string, CollectProgressInfo>) => void;
}

function defaultPersist(all: Record<string, CollectProgressInfo>): void {
  const storage = (globalThis as { chrome?: { storage?: { local?: { set?: (v: unknown) => Promise<void> } } } })
    .chrome?.storage?.local;
  if (storage?.set) {
    void storage.set({ [COLLECT_PROGRESS_STORAGE_KEY]: all }).catch(() => {});
  }
}

export function createCollectProgressHub(deps: HubDeps): CollectProgressHub {
  const persist = deps.persist ?? defaultPersist;
  const map = new Map<string, CollectProgressInfo>();
  const waiters = new Map<string, Set<Listener>>();

  return {
    update(info) {
      const full: CollectProgressInfo = { ...info, updatedAt: deps.now() };
      map.set(info.secUid, full);
      persist(Object.fromEntries(map));
      const ls = waiters.get(info.secUid);
      if (ls) for (const l of [...ls]) l(full);
    },
    get(secUid) {
      return map.get(secUid) ?? null;
    },
    waitForDone(secUid, timeoutMs) {
      const existing = map.get(secUid);
      if (existing?.done) return Promise.resolve(existing);
      return new Promise<CollectProgressInfo | null>((resolve) => {
        let settled = false;
        const cleanup = (): void => {
          waiters.get(secUid)?.delete(listener);
          clearTimeout(timer);
        };
        const finish = (v: CollectProgressInfo | null): void => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(v);
        };
        const listener: Listener = (info) => {
          if (info.done) finish(info);
        };
        if (!waiters.has(secUid)) waiters.set(secUid, new Set());
        waiters.get(secUid)!.add(listener);
        const timer = setTimeout(() => finish(map.get(secUid) ?? null), timeoutMs);
      });
    },
  };
}

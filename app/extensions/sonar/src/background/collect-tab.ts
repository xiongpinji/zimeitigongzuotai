/**
 * 全量采集驱动（设计：当前页采集）。
 *
 * 抖音主页作品是懒加载的，只有「正在渲染的可见标签页」滚动才会触发追加；隐藏后台标签页
 * 被 Chrome 暂停渲染，滚动不触发懒加载（实测只能拿到首屏 ~20 条）。因此这里驱动**当前
 * 激活标签页**（用户在主页点「采集全部」时即该页）：发 sonar/start-full-collect，由
 * Content Script 滚动加载全部作品并经 collect-progress 上报，等到 done（或超时）返回。
 *
 * 不开新标签页、不关标签页、不抢焦点；浏览器交互依赖注入，核心编排可单测。
 */
import type { CollectProgressHub } from './collect-progress';
import type { CollectCreatorInput, CollectCreatorResult } from '@/domain/api-types';

export type { CollectCreatorInput, CollectCreatorResult };

export interface CollectRunner {
  collectCreatorFully(input: CollectCreatorInput): Promise<CollectCreatorResult>;
}

export interface ActiveTabInfo {
  id?: number;
  url?: string;
}

export interface CollectRunnerDeps {
  hub: CollectProgressHub;
  /** 取当前激活标签页（默认 chrome.tabs.query active + lastFocusedWindow）。 */
  queryActiveTab?: () => Promise<ActiveTabInfo | undefined>;
  /** 向标签页 Content Script 发消息（期待 { ok } 应答）。 */
  sendMessage?: (tabId: number, message: unknown) => Promise<{ ok?: boolean } | undefined>;
  sleep?: (ms: number) => Promise<void>;
  /** 等 Content Script 就绪的最长时间（默认 15s；当前页通常立即就绪）。 */
  readyTimeoutMs?: number;
  /** 等采集完成的最长时间（默认 240s，607 条约需 30–60s）。 */
  collectTimeoutMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function profileUrlForSecUid(secUid: string): string {
  return `https://www.douyin.com/user/${secUid}`;
}

export function createFullCollectRunner(deps: CollectRunnerDeps): CollectRunner {
  const queryActiveTab =
    deps.queryActiveTab ??
    (async () => {
      const tabs = await (
        globalThis as {
          chrome?: { tabs?: { query: (q: unknown) => Promise<Array<{ id?: number; url?: string }>> } };
        }
      ).chrome!.tabs!.query({ active: true, lastFocusedWindow: true });
      const t = tabs[0];
      return t ? { id: t.id, url: t.url } : undefined;
    });
  const sendMessage =
    deps.sendMessage ??
    ((tabId: number, message: unknown) =>
      (globalThis as { chrome?: { tabs?: { sendMessage: (id: number, m: unknown) => Promise<{ ok?: boolean }> } } })
        .chrome!.tabs!.sendMessage(tabId, message));
  const sleep = deps.sleep ?? defaultSleep;
  const readyTimeoutMs = deps.readyTimeoutMs ?? 15_000;
  const collectTimeoutMs = deps.collectTimeoutMs ?? 240_000;

  return {
    async collectCreatorFully(input) {
      const tab = await queryActiveTab();
      if (tab?.id === undefined) return { ok: false, collected: 0, reason: 'no_tab' };
      const tabId = tab.id;

      // 复跑前重置进度，避免 waitForDone 命中上一轮残留的 done。
      deps.hub.update({ secUid: input.secUid, collected: 0, round: 0, done: false });

      // 发 start-full-collect 并等 ack（当前页 Content Script 通常立即就绪）。
      let acked = false;
      const readyDeadline = Date.now() + readyTimeoutMs;
      while (Date.now() < readyDeadline) {
        try {
          const r = await sendMessage(tabId, { kind: 'sonar/start-full-collect', secUid: input.secUid });
          if (r?.ok) {
            acked = true;
            break;
          }
        } catch {
          /* Content Script 尚未就绪 / 当前页非该博主主页，稍后重试 */
        }
        await sleep(1000);
      }
      if (!acked) return { ok: false, collected: 0, reason: 'not_ready' };

      const info = await deps.hub.waitForDone(input.secUid, collectTimeoutMs);
      if (info?.done) {
        return { ok: true, collected: info.collected, ...(info.total !== undefined ? { total: info.total } : {}) };
      }
      return {
        ok: false,
        collected: info?.collected ?? 0,
        ...(info?.total !== undefined ? { total: info.total } : {}),
        reason: 'timeout',
      };
    },
  };
}

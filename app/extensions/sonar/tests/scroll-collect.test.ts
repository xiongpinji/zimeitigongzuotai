import { describe, it, expect, vi } from 'vitest';
import {
  parsePostTotal,
  hasNoMoreSentinel,
  runCollectLoop,
  isMatchingCreatorPage,
  type CollectLoopAdapter,
  type CollectProgress,
} from '@/content/scroll-collect';
import type { RawPostItem } from '@/content/dom-extractor';

const noSleep = (_ms: number) => Promise.resolve();
const item = (id: string): RawPostItem => ({ awemeId: id });

describe('parsePostTotal', () => {
  it('parses 作品607 / 607 / 千分位', () => {
    expect(parsePostTotal('作品607')).toBe(607);
    expect(parsePostTotal('607')).toBe(607);
    expect(parsePostTotal('1,234')).toBe(1234);
    expect(parsePostTotal(' 88 ')).toBe(88);
  });
  it('returns undefined for no number / zero / nullish', () => {
    expect(parsePostTotal('作品')).toBeUndefined();
    expect(parsePostTotal('0')).toBeUndefined();
    expect(parsePostTotal(null)).toBeUndefined();
    expect(parsePostTotal(undefined)).toBeUndefined();
  });
});

describe('hasNoMoreSentinel', () => {
  it('matches end sentinels', () => {
    expect(hasNoMoreSentinel('暂时没有更多了')).toBe(true);
    expect(hasNoMoreSentinel('没有更多了')).toBe(true);
    expect(hasNoMoreSentinel('已经到底了')).toBe(true);
  });
  it('is false for ongoing list / nullish', () => {
    expect(hasNoMoreSentinel('加载中')).toBe(false);
    expect(hasNoMoreSentinel(null)).toBe(false);
  });
});

describe('isMatchingCreatorPage', () => {
  it('accepts only the requested creator homepage', () => {
    expect(isMatchingCreatorPage('target', 'target')).toBe(true);
    expect(isMatchingCreatorPage('other', 'target')).toBe(false);
    expect(isMatchingCreatorPage(undefined, 'target')).toBe(false);
  });
});

/** 构造一个随滚动逐批增长的假 adapter。 */
function growingAdapter(opts: {
  total?: number;
  batches: string[][]; // 每次 scrollToBottom 后新增的一批 id
  endAfter?: number; // 滚动到第 N 次后出现结束哨兵
}): CollectLoopAdapter {
  let visible = [...(opts.batches[0] ?? [])];
  let scrolls = 0;
  let nextBatch = 1;
  return {
    readItems: () => visible.map(item),
    scrollToBottom: () => {
      scrolls += 1;
      const b = opts.batches[nextBatch];
      if (b) {
        visible = [...visible, ...b];
        nextBatch += 1;
      }
    },
    isEnd: () => opts.endAfter !== undefined && scrolls >= opts.endAfter,
    getTotal: () => opts.total,
  };
}

describe('runCollectLoop', () => {
  it('accumulates across scrolls until total reached', async () => {
    const adapter = growingAdapter({
      total: 6,
      batches: [['1', '2'], ['3', '4'], ['5', '6'], ['7']],
    });
    const progress: CollectProgress[] = [];
    const items = await runCollectLoop(adapter, {
      sleep: noSleep,
      onProgress: (p) => void progress.push(p),
    });
    expect(items.map((i) => i.awemeId)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(progress.at(-1)).toMatchObject({ done: true, collected: 6, total: 6 });
  });

  it('dedupes overlapping ids', async () => {
    const adapter = growingAdapter({
      total: 4,
      batches: [['1', '2'], ['2', '3'], ['3', '4']],
    });
    const items = await runCollectLoop(adapter, { sleep: noSleep });
    expect(items.map((i) => i.awemeId).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('stops on end sentinel even without total', async () => {
    const adapter = growingAdapter({
      batches: [['1'], ['2'], ['3']], // 之后再滚不再增长
      endAfter: 3,
    });
    const items = await runCollectLoop(adapter, { sleep: noSleep, stagnantLimit: 99 });
    // 加载完 3 批后第 3 次滚动触发结束哨兵，停止；stagnantLimit 故意调高以证明是哨兵触发的退出。
    expect(items.map((i) => i.awemeId)).toEqual(['1', '2', '3']);
  });

  it('stops after stagnantLimit consecutive no-growth rounds', async () => {
    const adapter = growingAdapter({ batches: [['1', '2']] }); // 之后再滚也不增长
    const scrollSpy = vi.spyOn(adapter, 'scrollToBottom');
    const items = await runCollectLoop(adapter, { sleep: noSleep, stagnantLimit: 3 });
    expect(items).toHaveLength(2);
    expect(scrollSpy).toHaveBeenCalledTimes(3); // 连续 3 轮无增长后退出
  });

  it('respects shouldStop and maxRounds caps', async () => {
    const adapter = growingAdapter({ batches: [['1']] });
    let calls = 0;
    const items = await runCollectLoop(adapter, {
      sleep: noSleep,
      shouldStop: () => (++calls >= 2),
    });
    expect(items).toHaveLength(1);

    const adapter2 = growingAdapter({
      batches: Array.from({ length: 20 }, (_, i) => [`x${i}`]),
    });
    const items2 = await runCollectLoop(adapter2, { sleep: noSleep, maxRounds: 3, stagnantLimit: 99 });
    // 首批 1 + 3 轮各 +1 = 4
    expect(items2).toHaveLength(4);
  });
});

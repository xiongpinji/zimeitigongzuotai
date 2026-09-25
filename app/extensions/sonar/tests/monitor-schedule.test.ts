import { describe, it, expect } from 'vitest';
import { isSubscriptionDue, selectDueSubscriptions } from '@/monitor/schedule';
import type { Creator, CreatorSubscription } from '@/domain/models';

const creator = (id: string): Creator => ({
  id,
  secUid: `sec-${id}`,
  nickname: id,
  profileUrl: `https://www.douyin.com/user/sec-${id}`,
  updatedAt: 0,
});

const sub = (id: string, over: Partial<CreatorSubscription> = {}): CreatorSubscription => ({
  creator: creator(id),
  intervalMinutes: 30,
  paused: false,
  autoAnalyze: false,
  ...over,
});

const MIN = 60_000;

describe('isSubscriptionDue', () => {
  it('未检查过 → 到期', () => {
    expect(isSubscriptionDue(sub('a'), 1_000_000)).toBe(true);
  });
  it('暂停 → 永不到期', () => {
    expect(isSubscriptionDue(sub('a', { paused: true, lastCheckedAt: 0 }), 1e12)).toBe(false);
  });
  it('未过周期 → 未到期；过周期 → 到期', () => {
    const now = 100 * MIN;
    expect(isSubscriptionDue(sub('a', { intervalMinutes: 30, lastCheckedAt: now - 29 * MIN }), now)).toBe(false);
    expect(isSubscriptionDue(sub('a', { intervalMinutes: 30, lastCheckedAt: now - 31 * MIN }), now)).toBe(true);
  });
  it('按每个博主自己的周期判断', () => {
    const now = 100 * MIN;
    expect(isSubscriptionDue(sub('a', { intervalMinutes: 15, lastCheckedAt: now - 20 * MIN }), now)).toBe(true);
    expect(isSubscriptionDue(sub('a', { intervalMinutes: 60, lastCheckedAt: now - 20 * MIN }), now)).toBe(false);
  });
});

describe('selectDueSubscriptions', () => {
  it('只返回到期者，最久未检查优先', () => {
    const now = 100 * MIN;
    const subs = [
      sub('fresh', { lastCheckedAt: now - 5 * MIN }), // 未到期
      sub('old', { lastCheckedAt: now - 90 * MIN }),
      sub('never'), // 未检查 → 最久
      sub('paused', { paused: true }),
    ];
    const due = selectDueSubscriptions(subs, now);
    expect(due.map((s) => s.creator.id)).toEqual(['never', 'old']);
  });

  it('限批 batchSize', () => {
    const subs = [sub('a'), sub('b'), sub('c')];
    expect(selectDueSubscriptions(subs, 1e12, 2)).toHaveLength(2);
    expect(selectDueSubscriptions(subs, 1e12, 0)).toHaveLength(0);
  });

  it('全未到期 → 空', () => {
    const now = 100 * MIN;
    const subs = [sub('a', { lastCheckedAt: now - 1 * MIN }), sub('b', { lastCheckedAt: now - 2 * MIN })];
    expect(selectDueSubscriptions(subs, now)).toEqual([]);
  });
});

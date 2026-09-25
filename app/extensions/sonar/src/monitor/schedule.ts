/**
 * 监控调度选择器（设计文档第 9 节，P2.1 调度增强）。
 *
 * 旧实现每 tick 只查「最久未检查」的一个博主，博主多时覆盖很慢。
 * 这里按每个博主自己的 intervalMinutes 判断是否到期，一 tick 返回一批到期博主
 * （最久未检查优先，限批），从而「定时同步检查每个博主」。纯函数，便于单测。
 */
import type { CreatorSubscription } from '@/domain/models';

export const DEFAULT_INTERVAL_MINUTES = 30;
export const DEFAULT_BATCH_SIZE = 5;

/** 该订阅是否到期需要检查：未暂停且（从未检查 或 距上次检查已过其周期）。 */
export function isSubscriptionDue(sub: CreatorSubscription, now: number): boolean {
  if (sub.paused) return false;
  if (sub.lastCheckedAt == null) return true;
  const intervalMs = (sub.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES) * 60_000;
  return sub.lastCheckedAt + intervalMs <= now;
}

/**
 * 选出本 tick 应检查的一批订阅：到期者，最久未检查优先，限 batchSize。
 * 未检查过的视为最久（lastCheckedAt 视作 0）。
 */
export function selectDueSubscriptions(
  subs: CreatorSubscription[],
  now: number,
  batchSize: number = DEFAULT_BATCH_SIZE,
): CreatorSubscription[] {
  return subs
    .filter((s) => isSubscriptionDue(s, now))
    .sort((a, b) => (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0))
    .slice(0, Math.max(0, batchSize));
}

import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  openDurableQueue,
  type PublishAttemptInput,
  type PublishMatrixAccountInput,
  type QueuePlatform,
} from '../../electron/publish/durable-queue';

const PLATFORMS: QueuePlatform[] = ['douyin', 'kuaishou', 'wechat-channels', 'xiaohongshu'];
const ACCOUNT_COUNT = 100;
const VARIANT_COUNT = 10;
const TASK_COUNT = ACCOUNT_COUNT * VARIANT_COUNT;
// 8 的整倍数：首阶段每轮只占满提交 worker，不提前进入远端核对。
const PRE_RESTART_UNKNOWN_COUNT = 96;
const NOW = 1_700_000_000_000;

it('100 账号的 1000 个未知提交逐账号核对后推进，重开不盲目重发', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingji-queue-unknown-load-'));
  const storePath = join(dir, 'queue.json');
  const submitCounts = new Map<string, number>();
  const reconcileCounts = new Map<string, number>();
  const unresolvedAccounts = new Set<string>();
  let submittedWhileUnresolved = false;
  let preRestartReconciliations = 0;
  let activeSubmissions = 0;
  let peakSubmissions = 0;
  const startedAt = performance.now();
  const executor = async (input: PublishAttemptInput) => {
    if (unresolvedAccounts.has(input.accountId)) submittedWhileUnresolved = true;
    unresolvedAccounts.add(input.accountId);
    submitCounts.set(input.taskId, (submitCounts.get(input.taskId) ?? 0) + 1);
    activeSubmissions += 1;
    peakSubmissions = Math.max(peakSubmissions, activeSubmissions);
    await new Promise<void>((done) => setImmediate(done));
    activeSubmissions -= 1;
    return { kind: 'unknown' as const, errorCode: 'simulated_timeout' };
  };
  const common = {
    storePath,
    clock: () => NOW,
    executor,
    budgets: {
      global: 8,
      device: 8,
      perAccount: 1,
      perPlatform: {
        douyin: 2,
        kuaishou: 2,
        'wechat-channels': 2,
        xiaohongshu: 2,
      },
    },
  };

  try {
    const queue = openDurableQueue({
      ...common,
      reconciler: async () => {
        preRestartReconciliations += 1;
        return { finalState: 'unknown' as const };
      },
    });
    const accounts: PublishMatrixAccountInput[] = Array.from({ length: ACCOUNT_COUNT }, (_, index) => ({
      accountId: `account-${String(index).padStart(3, '0')}`,
      platform: PLATFORMS[index % PLATFORMS.length]!,
    }));
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      queue.enqueueMatrix({
        videoVariantId: `variant-${variant}`,
        videoRef: `local://renders/variant-${variant}.mp4`,
        metadata: {
          title: `未知提交测试 ${variant}`,
          description: '模拟超时，不调用平台',
          tags: [],
          coverRefs: [],
          scheduleAt: null,
        },
        accounts,
        commerceRequest: null,
      });
    }
    expect(queue.list()).toHaveLength(TASK_COUNT);

    let submitRounds = 0;
    while (submitCounts.size < PRE_RESTART_UNKNOWN_COUNT) {
      expect(submitRounds).toBeLessThan(200);
      await queue.tick();
      submitRounds += 1;
    }
    expect(queue.list().filter((task) => task.state === 'unknown_submission')).toHaveLength(PRE_RESTART_UNKNOWN_COUNT);
    expect(queue.list().filter((task) => task.state === 'queued')).toHaveLength(TASK_COUNT - PRE_RESTART_UNKNOWN_COUNT);
    expect(preRestartReconciliations).toBe(0);
    expect(peakSubmissions).toBe(8);
    expect(activeSubmissions).toBe(0);
    expect(submittedWhileUnresolved).toBe(false);
    expect([...submitCounts.values()].every((count) => count === 1)).toBe(true);

    const reopened = openDurableQueue({
      ...common,
      reconciler: async (input) => {
        expect(unresolvedAccounts.delete(input.accountId)).toBe(true);
        reconcileCounts.set(input.taskId, (reconcileCounts.get(input.taskId) ?? 0) + 1);
        return { finalState: 'published' as const, remoteId: `remote-${input.taskId}` };
      },
    });
    expect(reopened.list().filter((task) => task.state === 'unknown_submission')).toHaveLength(PRE_RESTART_UNKNOWN_COUNT);
    let reconcileRounds = 0;
    while (reopened.list().some((task) => task.state !== 'published')) {
      expect(reconcileRounds).toBeLessThan(500);
      await reopened.tick();
      reconcileRounds += 1;
    }
    const finalTasks = reopened.list();
    expect(finalTasks).toHaveLength(TASK_COUNT);
    expect(finalTasks.every((task) =>
      task.state === 'published' && task.attempt === 1 && task.reconcileAttempts === 1 &&
      task.remoteResult?.remoteId === `remote-${task.id}`,
    )).toBe(true);
    expect([...submitCounts.values()].every((count) => count === 1)).toBe(true);
    expect([...reconcileCounts.values()].every((count) => count === 1)).toBe(true);
    expect(submittedWhileUnresolved).toBe(false);
    expect(unresolvedAccounts.size).toBe(0);
    expect(openDurableQueue({ ...common, reconciler: async () => ({ finalState: 'unknown' }) })
      .list().filter((task) => task.state === 'published')).toHaveLength(TASK_COUNT);
    console.info('durable_queue_unknown_load', JSON.stringify({
      accounts: ACCOUNT_COUNT,
      tasks: TASK_COUNT,
      peakSubmissions,
      submitRounds,
      reconcileRounds,
      elapsedMs: Math.round(performance.now() - startedAt),
    }));
  } finally {
    const resolved = resolve(dir);
    if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith('lingji-queue-unknown-load-')) {
      throw new Error(`拒绝删除非预期的负载测试目录: ${resolved}`);
    }
    rmSync(resolved, { recursive: true, force: true, maxRetries: 5 });
  }
});

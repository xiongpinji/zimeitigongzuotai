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

it('100 个模拟账号 × 10 个版本在 8 worker 下全部核验且同账号不重叠', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingji-queue-load-'));
  const storePath = join(dir, 'queue.json');
  const activeByAccount = new Map<string, number>();
  const submittedIds = new Set<string>();
  const reconciledIds = new Set<string>();
  let active = 0;
  let maxActive = 0;
  let accountOverlap = false;
  const startedAt = performance.now();

  const executor = async (input: PublishAttemptInput) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const nextAccountActive = (activeByAccount.get(input.accountId) ?? 0) + 1;
    activeByAccount.set(input.accountId, nextAccountActive);
    if (nextAccountActive > 1) accountOverlap = true;
    submittedIds.add(input.taskId);
    await new Promise<void>((done) => setImmediate(done));
    active -= 1;
    activeByAccount.set(input.accountId, nextAccountActive - 1);
    return { kind: 'submitted' as const, remoteId: `remote-${input.taskId}` };
  };
  const reconciler = async (input: { taskId: string; remoteResult: { remoteId: string | null } | null }) => {
    reconciledIds.add(input.taskId);
    return { finalState: 'published' as const, remoteId: input.remoteResult?.remoteId ?? null };
  };
  const options = {
    storePath,
    clock: () => 1_700_000_000_000,
    executor,
    reconciler,
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
    const queue = openDurableQueue(options);
    const accounts: PublishMatrixAccountInput[] = Array.from({ length: ACCOUNT_COUNT }, (_, index) => ({
      accountId: `account-${String(index).padStart(3, '0')}`,
      platform: PLATFORMS[index % PLATFORMS.length]!,
    }));
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      queue.enqueueMatrix({
        videoVariantId: `variant-${variant}`,
        videoRef: `local://renders/variant-${variant}.mp4`,
        metadata: {
          title: `容量测试 ${variant}`,
          description: '合成任务，不调用平台',
          tags: [],
          coverRefs: [],
          scheduleAt: null,
        },
        accounts,
        commerceRequest: null,
      });
    }
    expect(queue.list()).toHaveLength(TASK_COUNT);

    let rounds = 0;
    while (queue.list().some((task) => task.state !== 'published')) {
      expect(rounds).toBeLessThan(500);
      await queue.tick();
      rounds += 1;
    }

    const tasks = queue.list();
    expect(tasks).toHaveLength(TASK_COUNT);
    expect(tasks.every((task) => task.state === 'published' && task.attempt === 1)).toBe(true);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(TASK_COUNT);
    expect(submittedIds.size).toBe(TASK_COUNT);
    expect(reconciledIds.size).toBe(TASK_COUNT);
    expect(accountOverlap).toBe(false);
    expect(maxActive).toBe(8);
    expect(active).toBe(0);
    expect(openDurableQueue(options).list().filter((task) => task.state === 'published')).toHaveLength(TASK_COUNT);
    console.info('durable_queue_load', JSON.stringify({
      accounts: ACCOUNT_COUNT,
      tasks: TASK_COUNT,
      workers: maxActive,
      rounds,
      elapsedMs: Math.round(performance.now() - startedAt),
    }));
  } finally {
    const resolved = resolve(dir);
    if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith('lingji-queue-load-')) {
      throw new Error(`拒绝删除非预期的负载测试目录: ${resolved}`);
    }
    rmSync(resolved, { recursive: true, force: true, maxRetries: 5 });
  }
});

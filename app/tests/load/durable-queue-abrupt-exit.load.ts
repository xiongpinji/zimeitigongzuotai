import { expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  openDurableQueue,
  type PublishAttemptInput,
  type PublishMatrixAccountInput,
  type QueuePlatform,
} from '../../electron/publish/durable-queue';

const PLATFORMS: QueuePlatform[] = ['douyin', 'kuaishou', 'wechat-channels', 'xiaohongshu'];
const ACCOUNT_COUNT = 100;
const TASK_COUNT = 1_000;
const NOW = 1_700_000_000_000;

it('子进程领取后退出：1000 任务重开先核对 8 条租约，不重复提交同账号任务', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingji-queue-abrupt-exit-load-'));
  const storePath = join(dir, 'queue.json');
  const childPath = join(dir, 'abrupt-exit.cjs');
  const startedAt = performance.now();
  let now = NOW;
  const submitCounts = new Map<string, number>();
  const reconcileCounts = new Map<string, number>();
  let active = 0;
  let maxActive = 0;
  let submittedBeforeCrashReconcile = false;
  const crashAccounts = new Set<string>();
  const common = {
    storePath,
    clock: () => now,
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
    retryPolicy: { leaseMs: 1_000 },
  };
  const executor = async (input: PublishAttemptInput) => {
    if (crashAccounts.has(input.accountId)) submittedBeforeCrashReconcile = true;
    submitCounts.set(input.taskId, (submitCounts.get(input.taskId) ?? 0) + 1);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((done) => setImmediate(done));
    active -= 1;
    return { kind: 'submitted' as const, remoteId: `remote-${input.taskId}` };
  };
  const reconciler = async (input: { taskId: string; accountId: string }) => {
    reconcileCounts.set(input.taskId, (reconcileCounts.get(input.taskId) ?? 0) + 1);
    crashAccounts.delete(input.accountId);
    return { finalState: 'published' as const, remoteId: `remote-${input.taskId}` };
  };

  try {
    const queue = openDurableQueue({ ...common, executor, reconciler });
    const accounts: PublishMatrixAccountInput[] = Array.from({ length: ACCOUNT_COUNT }, (_, index) => ({
      accountId: `account-${String(index).padStart(3, '0')}`,
      platform: PLATFORMS[index % PLATFORMS.length]!,
    }));
    for (let variant = 0; variant < TASK_COUNT / ACCOUNT_COUNT; variant += 1) {
      queue.enqueueMatrix({
        videoVariantId: `variant-${variant}`,
        videoRef: `local://renders/variant-${variant}.mp4`,
        metadata: {
          title: `进程退出模拟 ${variant}`,
          description: '本地合成任务，无平台调用',
          tags: [],
          coverRefs: [],
          scheduleAt: null,
        },
        accounts,
        commerceRequest: null,
      });
    }
    expect(queue.list()).toHaveLength(TASK_COUNT);

    const entry = fileURLToPath(new URL('./fixtures/durable-queue-abrupt-exit.ts', import.meta.url));
    const bundle = buildSync({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      outfile: childPath,
      write: false,
    });
    writeFileSync(childPath, bundle.outputFiles[0]!.contents);
    const child = spawnSync(process.execPath, [childPath, storePath], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1_000_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(73);
    const crashIds = new Set((JSON.parse(child.stdout) as { taskIds: string[] }).taskIds);
    expect(crashIds.size).toBe(8);

    const reopened = openDurableQueue({ ...common, executor, reconciler });
    const initiallyUploading = reopened.list().filter((task) => task.state === 'uploading');
    expect(new Set(initiallyUploading.map((task) => task.id))).toEqual(crashIds);
    for (const task of initiallyUploading) crashAccounts.add(task.accountId);
    expect(crashAccounts.size).toBe(8);

    await reopened.tick();
    expect(reopened.list().filter((task) => task.state === 'uploading' && crashIds.has(task.id))).toHaveLength(8);
    expect([...submitCounts.keys()].some((id) => crashIds.has(id))).toBe(false);
    expect(submittedBeforeCrashReconcile).toBe(false);

    now += 1_000;
    let rounds = 0;
    while (reopened.list().some((task) => task.state !== 'published')) {
      expect(rounds).toBeLessThan(500);
      await reopened.tick();
      rounds += 1;
    }
    const tasks = reopened.list();
    expect(tasks).toHaveLength(TASK_COUNT);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(TASK_COUNT);
    expect(tasks.every((task) => task.state === 'published' && task.attempt === 1 && task.reconcileAttempts === 1)).toBe(true);
    expect([...submitCounts.values()].every((count) => count === 1)).toBe(true);
    expect(submitCounts.size).toBe(TASK_COUNT - crashIds.size);
    expect(reconcileCounts.size).toBe(TASK_COUNT);
    expect(submittedBeforeCrashReconcile).toBe(false);
    expect(crashAccounts.size).toBe(0);
    expect(maxActive).toBe(8);
    expect(active).toBe(0);
    for (const id of crashIds) {
      expect(submitCounts.has(id)).toBe(false);
      expect(reopened.get(id)!.history.some((entry) => entry.errorCode === 'leased_upload_expired')).toBe(true);
    }
    expect(openDurableQueue({ ...common, executor, reconciler }).list()
      .filter((task) => task.state === 'published')).toHaveLength(TASK_COUNT);
    console.info('durable_queue_abrupt_exit_load', JSON.stringify({
      accounts: ACCOUNT_COUNT,
      tasks: TASK_COUNT,
      crashedLeases: crashIds.size,
      localPeakWorkers: maxActive,
      rounds,
      elapsedMs: Math.round(performance.now() - startedAt),
    }));
  } finally {
    const resolved = resolve(dir);
    if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith('lingji-queue-abrupt-exit-load-')) {
      throw new Error(`拒绝删除非预期的负载测试目录: ${resolved}`);
    }
    rmSync(resolved, { recursive: true, force: true, maxRetries: 5 });
  }
});

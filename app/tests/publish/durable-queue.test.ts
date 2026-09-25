import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DurableQueueError,
  openDurableQueue,
  type DurablePublishQueue,
  type PublishAttemptInput,
  type PublishAttemptOutcome,
  type PublishMatrixInput,
  type QueueBudgets,
  type QueueRetryPolicy,
  type ReconcileInput,
  type ReconcileResult,
} from '../../electron/publish/durable-queue';

const START = 1_700_000_000_000;

let dir = '';
let storePath = '';
let current = START;

const clock = () => current;
function advance(ms: number): void {
  current += ms;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'durable-queue-'));
  storePath = join(dir, 'queue.json');
  current = START;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function submitOk(remoteId: string): PublishAttemptOutcome {
  return { kind: 'submitted', remoteId, remoteUrl: `https://example.invalid/${remoteId}` };
}

function reconcilePublished(remoteId: string | null): ReconcileResult {
  return { finalState: 'published', remoteId, remoteUrl: remoteId ? `https://example.invalid/${remoteId}` : null };
}

function openQueue(overrides: {
  clock?: () => number;
  executor?: (input: PublishAttemptInput) => Promise<PublishAttemptOutcome>;
  reconciler?: (input: ReconcileInput) => Promise<ReconcileResult>;
  budgets?: QueueBudgets;
  retryPolicy?: QueueRetryPolicy;
} = {}): DurablePublishQueue {
  return openDurableQueue({
    storePath,
    clock: overrides.clock ?? clock,
    executor:
      overrides.executor ??
      (async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId.slice(0, 12)}`)),
    reconciler: overrides.reconciler ?? (async (input: ReconcileInput) => reconcilePublished(input.taskId)),
    budgets: overrides.budgets,
    retryPolicy: overrides.retryPolicy,
  });
}

function matrix(overrides: Partial<PublishMatrixInput> = {}): PublishMatrixInput {
  return {
    videoVariantId: 'variant-1',
    videoRef: 'local://renders/variant-1.mp4',
    metadata: {
      title: '测试标题',
      description: '测试描述',
      tags: ['tag-a'],
      coverRefs: ['local://covers/variant-1.png'],
      scheduleAt: null,
    },
    accounts: [
      { accountId: 'douyin_alpha', platform: 'douyin' },
      { accountId: 'douyin_beta', platform: 'douyin' },
    ],
    commerceRequest: null,
    ...overrides,
  };
}

function expectQueueError(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(DurableQueueError);
  expect((caught as DurableQueueError).code).toBe(code);
}

function readStore(): { schemaVersion: number; updatedAt: number; tasks: any[] } {
  return JSON.parse(readFileSync(storePath, 'utf-8'));
}

function taskOf(q: DurablePublishQueue, accountId: string) {
  const task = q.list().find((t) => t.accountId === accountId);
  if (!task) throw new Error(`task not found for ${accountId}`);
  return task;
}

describe('持久任务矩阵', () => {
  it('一个视频版本 × 多账号展开为独立任务，ID/幂等键稳定且重复入队不产生副本', () => {
    const q = openQueue();
    const first = q.enqueueMatrix(
      matrix({
        accounts: [
          { accountId: 'douyin_alpha', platform: 'douyin' },
          { accountId: 'douyin_beta', platform: 'douyin' },
          { accountId: 'kuaishou_gamma', platform: 'kuaishou', overrides: { title: '快手标题', tags: ['tag-k'] } },
        ],
      }),
    );

    expect(first.created).toHaveLength(3);
    expect(first.existing).toHaveLength(0);
    const keys = first.created.map((t) => t.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
    expect(new Set(first.created.map((t) => t.id)).size).toBe(3);
    for (const task of first.created) {
      expect(task.state).toBe('queued');
      expect(task.attempt).toBe(0);
      expect(task.commerceRequest).toBeNull();
      expect(task.remoteResult).toBeNull();
    }
    const kuaishou = taskOf(q, 'kuaishou_gamma');
    expect(kuaishou.metadata.title).toBe('快手标题');
    expect(kuaishou.metadata.tags).toEqual(['tag-k']);
    expect(kuaishou.metadata.description).toBe('测试描述');

    const again = q.enqueueMatrix(
      matrix({
        accounts: [
          { accountId: 'douyin_alpha', platform: 'douyin' },
          { accountId: 'douyin_beta', platform: 'douyin' },
          { accountId: 'kuaishou_gamma', platform: 'kuaishou', overrides: { title: '快手标题', tags: ['tag-k'] } },
        ],
      }),
    );
    expect(again.created).toHaveLength(0);
    expect(again.existing).toHaveLength(3);

    const reopened = openQueue();
    expect(reopened.list()).toHaveLength(3);
    const third = reopened.enqueueMatrix(
      matrix({
        accounts: [
          { accountId: 'douyin_alpha', platform: 'douyin' },
          { accountId: 'douyin_beta', platform: 'douyin' },
          { accountId: 'kuaishou_gamma', platform: 'kuaishou', overrides: { title: '快手标题', tags: ['tag-k'] } },
        ],
      }),
    );
    expect(third.created).toHaveLength(0);
    expect(third.existing).toHaveLength(3);
  });

  it('同一幂等键但指纹不同时显式拒绝，不静默覆盖', () => {
    const q = openQueue();
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    expectQueueError(
      () =>
        q.enqueueMatrix(
          matrix({
            metadata: {
              title: '换标题',
              description: '测试描述',
              tags: ['tag-a'],
              coverRefs: ['local://covers/variant-1.png'],
              scheduleAt: null,
            },
            accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }],
          }),
        ),
      'idempotency_conflict',
    );
    expect(q.list()).toHaveLength(1);
    expect(taskOf(q, 'douyin_alpha').metadata.title).toBe('测试标题');
  });
});

describe('并发预算与单账号互斥', () => {
  it('同一账号绝不并发执行，任务按顺序推进', async () => {
    const gates: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    let accountActive = 0;
    let maxAccountActive = 0;
    const executor = vi.fn(async (input: PublishAttemptInput) => {
      active += 1;
      accountActive += 1;
      maxActive = Math.max(maxActive, active);
      maxAccountActive = Math.max(maxAccountActive, accountActive);
      await new Promise<void>((resolve) => {
        gates.push(() => {
          active -= 1;
          accountActive -= 1;
          resolve();
        });
      });
      return submitOk(`remote-${input.taskId.slice(0, 8)}`);
    });
    const q = openQueue({ executor });
    const accounts = [{ accountId: 'douyin_solo', platform: 'douyin' as const }];
    q.enqueueMatrix(matrix({ accounts }));
    q.enqueueMatrix(matrix({ videoVariantId: 'variant-2', accounts }));

    const tick1 = q.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(gates).toHaveLength(1);
    const overlapping = q.tick();
    expect(overlapping).toBe(tick1);
    gates[0]!();
    await tick1;
    expect(maxAccountActive).toBe(1);

    const tick2 = q.tick();
    expect(executor).toHaveBeenCalledTimes(2);
    gates[1]!();
    await tick2;

    expect(maxAccountActive).toBe(1);
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });

  it('跨账号并发受平台预算与全局预算限制，默认每平台 1', async () => {
    const gates: Array<() => void> = [];
    const started: string[] = [];
    const executor = vi.fn(async (input: PublishAttemptInput) => {
      started.push(input.accountId);
      await new Promise<void>((resolve) => gates.push(resolve));
      return submitOk(`remote-${input.accountId}`);
    });
    const q = openQueue({ executor });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    advance(1);
    q.enqueueMatrix(matrix({ videoVariantId: 'variant-2', accounts: [{ accountId: 'douyin_beta', platform: 'douyin' }] }));
    advance(1);
    q.enqueueMatrix(matrix({ videoVariantId: 'variant-3', accounts: [{ accountId: 'kuaishou_gamma', platform: 'kuaishou' }] }));
    advance(1);
    q.enqueueMatrix(matrix({ videoVariantId: 'variant-4', accounts: [{ accountId: 'xiaohongshu_delta', platform: 'xiaohongshu' }] }));

    const tick1 = q.tick();
    expect(started).toEqual(['douyin_alpha', 'kuaishou_gamma']);
    gates.splice(0).forEach((release) => release());
    await tick1;

    const tick2 = q.tick();
    expect(started).toEqual(['douyin_alpha', 'kuaishou_gamma', 'douyin_beta', 'xiaohongshu_delta']);
    gates.splice(0).forEach((release) => release());
    await tick2;
  });

  it('全局 worker 上限为 1 时一次只执行一个任务', async () => {
    const started: string[] = [];
    const gates: Array<() => void> = [];
    const executor = vi.fn(async (input: PublishAttemptInput) => {
      started.push(input.accountId);
      await new Promise<void>((resolve) => gates.push(resolve));
      return submitOk(`remote-${input.accountId}`);
    });
    const q = openQueue({ executor, budgets: { global: 1, device: 4 } });
    q.enqueueMatrix(
      matrix({
        accounts: [
          { accountId: 'douyin_alpha', platform: 'douyin' },
          { accountId: 'kuaishou_gamma', platform: 'kuaishou' },
        ],
      }),
    );
    const tick = q.tick();
    expect(started).toHaveLength(1);
    gates.splice(0).forEach((release) => release());
    await tick;
    const next = q.tick();
    expect(started).toHaveLength(2);
    gates.splice(0).forEach((release) => release());
    await next;
  });
});

describe('计划时间、取消与退避', () => {
  it('计划时间未到的任务不被领取，到点后才领取', async () => {
    const executor = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    const q = openQueue({ executor });
    const scheduleAt = current + 3_600_000;
    q.enqueueMatrix(
      matrix({
        metadata: {
          title: '定时发布',
          description: '',
          tags: [],
          coverRefs: [],
          scheduleAt,
        },
        accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }],
      }),
    );

    await q.tick();
    expect(executor).not.toHaveBeenCalled();
    advance(3_599_999);
    await q.tick();
    expect(executor).not.toHaveBeenCalled();
    advance(1);
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(taskOf(q, 'douyin_alpha').state).toBe('verifying');
  });

  it('取消未提交任务后不再执行，重复取消与非法重试显式拒绝', async () => {
    const executor = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    const q = openQueue({ executor });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    expect(q.cancel(task.id)).toBe(true);
    expect(q.get(task.id)!.state).toBe('cancelled');
    expect(q.cancel(task.id)).toBe(false);
    expectQueueError(() => q.retryNow(task.id), 'invalid_transition');
    await q.tick();
    expect(executor).not.toHaveBeenCalled();
    expectQueueError(() => q.cancel('pubjob_missing'), 'task_not_found');
  });

  it('执行中取消：中止执行器，未知结果进入 unknown_submission 并等待核对', async () => {
    let observedAbort = false;
    let release!: () => void;
    const executor = vi.fn(async (input: PublishAttemptInput) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      observedAbort = input.signal.aborted;
      return { kind: 'unknown', errorCode: 'aborted_mid_upload' } satisfies PublishAttemptOutcome;
    });
    let reconcileMode: 'unknown' | 'failed' = 'unknown';
    const reconciler = vi.fn(async (input: ReconcileInput) => {
      expect(input.taskId).toBeTruthy();
      if (reconcileMode === 'unknown') {
        return { finalState: 'unknown', errorCode: 'remote_not_found_yet' } satisfies ReconcileResult;
      }
      return {
        finalState: 'failed',
        remoteId: null,
        confirmedNotPublished: true,
        retryable: true,
        errorCode: 'no_remote_artifact',
      } satisfies ReconcileResult;
    });
    const q = openQueue({ executor, reconciler });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    const tick = q.tick();
    expect(q.cancel(task.id)).toBe(true);
    expect(q.get(task.id)!.cancelRequested).toBe(true);
    release();
    await tick;
    expect(observedAbort).toBe(true);
    expect(q.get(task.id)!.state).toBe('unknown_submission');
    expect(executor).toHaveBeenCalledTimes(1);

    await q.tick();
    expect(reconciler).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(q.get(task.id)!.state).toBe('unknown_submission');

    reconcileMode = 'failed';
    advance(60_000);
    await q.tick();
    expect(reconciler).toHaveBeenCalledTimes(2);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(q.get(task.id)!.state).toBe('cancelled');
    expect(q.get(task.id)!.remoteResult!.finalState).toBe('failed');
  });

  it('执行中取消后即使适配器报告普通失败，仍须远端核对', async () => {
    let release!: () => void;
    const executor = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { kind: 'failed', errorCode: 'upload_interrupted', retryable: true } satisfies PublishAttemptOutcome;
    });
    const q = openQueue({ executor });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    const tick = q.tick();
    q.cancel(task.id);
    release();
    await tick;
    expect(q.get(task.id)!.state).toBe('unknown_submission');
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(q.get(task.id)!.state).toBe('published');
  });

  it('网络失败未证明远端未受理时不得自动重试', async () => {
    const executor = vi.fn(async (): Promise<PublishAttemptOutcome> => ({
      kind: 'failed', errorCode: 'network_timeout', retryable: true,
    }));
    const q = openQueue({ executor });
    const task = q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] })).created[0];
    await q.tick();
    expect(q.get(task.id)!.state).toBe('unknown_submission');
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(q.get(task.id)!.state).toBe('published');
  });

  it('远端核对只报告失败但未证明没有发布时仍保持未知，不盲重试', async () => {
    const executor = vi.fn(async (): Promise<PublishAttemptOutcome> => ({ kind: 'unknown' }));
    const reconciler = vi.fn(async (): Promise<ReconcileResult> => ({
      finalState: 'failed', remoteId: null, retryable: true, errorCode: 'lookup_failed',
    }));
    const q = openQueue({ executor, reconciler });
    const task = q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] })).created[0];
    await q.tick();
    await q.tick();
    expect(reconciler).toHaveBeenCalledTimes(1);
    expect(q.get(task.id)!.state).toBe('unknown_submission');
    expect(q.get(task.id)!.remoteResult?.finalState).not.toBe('failed');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('限流优先遵循 retry-after', async () => {
    let call = 0;
    const executor = vi.fn(async (): Promise<PublishAttemptOutcome> => {
      call += 1;
      if (call === 1) return { kind: 'throttled', confirmedNotSubmitted: true, retryAfterMs: 45_000, errorCode: 'rate_limited' };
      return { kind: 'submitted', remoteId: 'remote-after-throttle' };
    });
    const q = openQueue({ executor });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    await q.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    let stored = q.get(task.id)!;
    expect(stored.state).toBe('retryable_failure');
    expect(stored.nextAttemptAt).toBe(current + 45_000);
    expect(stored.lastErrorCode).toBe('rate_limited');
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    advance(44_999);
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    advance(1);
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(2);
    stored = q.get(task.id)!;
    expect(stored.state).toBe('verifying');
    expect(stored.attempt).toBe(2);
  });

  it('缺省 retry-after 时使用有界指数退避并在尝试上限停机', async () => {
    const executor = vi.fn(async (): Promise<PublishAttemptOutcome> => ({
      kind: 'failed',
      errorCode: 'network',
      confirmedNotSubmitted: true,
      retryable: true,
    }));
    const q = openQueue({
      executor,
      retryPolicy: { baseBackoffMs: 1_000, maxBackoffMs: 4_000, maxAttempts: 4 },
    });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    await q.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(q.get(task.id)!.nextAttemptAt).toBe(current + 1_000);
    advance(999);
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    advance(1);
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(2);
    expect(q.get(task.id)!.nextAttemptAt).toBe(current + 2_000);
    advance(2_000);
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(3);
    expect(q.get(task.id)!.nextAttemptAt).toBe(current + 4_000);
    advance(4_000);
    await q.tick();
    const stopped = q.get(task.id)!;
    expect(executor).toHaveBeenCalledTimes(4);
    expect(stopped.state).toBe('terminal_failure');
    expect(stopped.attempt).toBe(4);
    expect(stopped.lastErrorCode).toBe('attempts_exhausted');
    advance(1_000_000);
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(4);
  });
});

describe('崩溃恢复与未知提交', () => {
  it('重启时 uploading 任务转为 unknown_submission，只核对不重发', async () => {
    const executor = vi.fn(() => new Promise<PublishAttemptOutcome>(() => {}));
    const q1 = openQueue({ executor });
    q1.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q1, 'douyin_alpha');
    void q1.tick();
    expect(readStore().tasks[0].state).toBe('uploading');
    expect(q1.get(task.id)!.leaseUntil).toBe(START + 600_000);

    const executor2 = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    const reconciler2 = vi.fn(async () => ({ finalState: 'unknown', errorCode: 'remote_pending' }) as ReconcileResult);
    const q2 = openQueue({ executor: executor2, reconciler: reconciler2 });
    const recovered = q2.get(task.id)!;
    expect(recovered.state).toBe('unknown_submission');
    expect(recovered.lastErrorCode).toBe('recovered_uploading_restart');
    expect(recovered.attempt).toBe(1);

    await q2.tick();
    expect(reconciler2).toHaveBeenCalledTimes(1);
    expect(executor2).not.toHaveBeenCalled();
    expect(q2.get(task.id)!.state).toBe('unknown_submission');
    expectQueueError(() => q2.retryNow(task.id), 'invalid_transition');
  });

  it('未知提交经核对确认远端失败且无远端 ID 后才允许重新执行', async () => {
    const q1 = openQueue({ executor: vi.fn(() => new Promise<PublishAttemptOutcome>(() => {})) });
    q1.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q1, 'douyin_alpha');
    void q1.tick();

    const executor2 = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    const reconciler2 = vi.fn(
      async () => ({ finalState: 'failed', remoteId: null, confirmedNotPublished: true, retryable: true, errorCode: 'no_remote_artifact' }) as ReconcileResult,
    );
    const q2 = openQueue({ executor: executor2, reconciler: reconciler2, retryPolicy: { baseBackoffMs: 1_000 } });
    expect(q2.get(task.id)!.state).toBe('unknown_submission');

    expectQueueError(() => q2.retryNow(task.id), 'invalid_transition');
    await q2.tick();
    expect(reconciler2).toHaveBeenCalledTimes(1);
    expect(executor2).not.toHaveBeenCalled();
    expect(q2.get(task.id)!.state).toBe('retryable_failure');
    expect(q2.get(task.id)!.remoteResult!.finalState).toBe('failed');

    advance(1_000);
    await q2.tick();
    expect(executor2).toHaveBeenCalledTimes(1);
    expect(q2.get(task.id)!.state).toBe('verifying');
  });

  it('核对持续不明会停止自动核对并等待人工接管', async () => {
    const q1 = openQueue({ executor: vi.fn(() => new Promise<PublishAttemptOutcome>(() => {})) });
    q1.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q1, 'douyin_alpha');
    void q1.tick();

    const executor2 = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    const reconciler2 = vi.fn(async () => ({ finalState: 'unknown', errorCode: 'still_unknown' }) as ReconcileResult);
    const q2 = openQueue({
      executor: executor2,
      reconciler: reconciler2,
      retryPolicy: { baseBackoffMs: 1_000, maxReconcileAttempts: 2 },
    });

    await q2.tick();
    expect(reconciler2).toHaveBeenCalledTimes(1);
    expect(q2.get(task.id)!.reconcileAttempts).toBe(1);
    advance(1_000);
    await q2.tick();
    expect(reconciler2).toHaveBeenCalledTimes(2);
    advance(1_000_000);
    await q2.tick();
    expect(reconciler2).toHaveBeenCalledTimes(2);
    expect(q2.get(task.id)!.state).toBe('unknown_submission');
    expect(executor2).not.toHaveBeenCalled();

    const resolved = q2.applyManualResolution(task.id, {
      finalState: 'published',
      remoteId: 'remote-manual',
      resolvedBy: 'codex',
    });
    expect(resolved.state).toBe('published');
    expect(resolved.remoteResult).toMatchObject({ remoteId: 'remote-manual', finalState: 'published' });
    expect(resolved.history[resolved.history.length - 1]!.actor).toBe('codex');
    expectQueueError(
      () => q2.applyManualResolution(task.id, { finalState: 'failed', resolvedBy: 'codex' }),
      'invalid_transition',
    );
  });

  it('执行器抛异常按未知提交处理，且不把异常文本落盘', async () => {
    const executor = vi.fn(async () => {
      throw new Error('token=super-secret cookie=abc');
    });
    const reconciler = vi.fn(async () => ({ finalState: 'unknown' }) as ReconcileResult);
    const q = openQueue({ executor, reconciler });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    await q.tick();
    expect(q.get(task.id)!.state).toBe('unknown_submission');
    expect(q.get(task.id)!.lastErrorCode).toBe('executor_threw');
    const raw = readFileSync(storePath, 'utf-8');
    expect(raw).not.toContain('super-secret');
    expect(raw).not.toContain('cookie');
  });
});

describe('CommerceRequest 与停机状态', () => {
  it('CommerceRequest 非空时 fail closed，绝不降级为普通发布', async () => {
    const executor = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    const q = openQueue({ executor });
    const commerce = {
      platform: 'douyin' as const,
      accountId: 'douyin_alpha',
      kind: 'shop' as const,
      platformProductId: 'product-42',
      required: true,
    };
    const report = q.enqueueMatrix(
      matrix({
        accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }],
        commerceRequest: commerce,
      }),
    );
    const task = report.created[0]!;
    expect(task.state).toBe('needs_user_action');
    expect(task.lastErrorCode).toBe('commerce_not_configured');
    expect(task.commerceRequest).toEqual(commerce);

    await q.tick();
    expect(executor).not.toHaveBeenCalled();
    expectQueueError(() => q.resumeTask(task.id), 'commerce_blocked');

    const reopened = openQueue({ executor });
    expect(reopened.get(task.id)!.commerceRequest).toEqual(commerce);
    await reopened.tick();
    expect(executor).not.toHaveBeenCalled();

    const optional = reopened.enqueueMatrix(
      matrix({
        videoVariantId: 'variant-optional',
        accounts: [{ accountId: 'douyin_beta', platform: 'douyin' }],
        commerceRequest: { ...commerce, accountId: 'douyin_beta', required: false },
      }),
    );
    expect(optional.created[0]!.state).toBe('needs_user_action');
    await reopened.tick();
    expect(executor).not.toHaveBeenCalled();
  });

  it('缺失或与任务不一致的 CommerceRequest 显式拒绝', () => {
    const q = openQueue();
    const withoutField = matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }) as Record<string, unknown>;
    delete withoutField.commerceRequest;
    expectQueueError(() => q.enqueueMatrix(withoutField as unknown as PublishMatrixInput), 'invalid_commerce_request');

    expectQueueError(
      () =>
        q.enqueueMatrix(
          matrix({
            accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }],
            commerceRequest: {
              platform: 'douyin',
              accountId: 'douyin_other',
              kind: 'shop',
              platformProductId: 'product-42',
              required: true,
            },
          }),
        ),
      'invalid_commerce_request',
    );

    expectQueueError(
      () =>
        q.enqueueMatrix(
          matrix({
            accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }],
            commerceRequest: {
              platform: 'douyin',
              accountId: 'douyin_alpha',
              kind: 'shop',
              platformProductId: 'https://example.invalid/product/42',
              required: true,
            },
          }),
        ),
      'invalid_commerce_request',
    );
    expect(q.list()).toHaveLength(0);
  });

  it('needs_login / needs_user_action 停机等待恢复，恢复后重新排队执行', async () => {
    let douyinNeedsLogin = true;
    let kuaishouNeedsAction = true;
    const executor = vi.fn(async (input: PublishAttemptInput): Promise<PublishAttemptOutcome> => {
      if (input.platform === 'douyin') {
        return douyinNeedsLogin
          ? { kind: 'needs_login', confirmedNotSubmitted: true, errorCode: 'login_required' }
          : submitOk(`remote-${input.taskId.slice(0, 8)}`);
      }
      return kuaishouNeedsAction
        ? { kind: 'needs_user_action', confirmedNotSubmitted: true, errorCode: 'captcha_required' }
        : submitOk(`remote-${input.taskId.slice(0, 8)}`);
    });
    const q = openQueue({ executor });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    q.enqueueMatrix(matrix({ videoVariantId: 'variant-2', accounts: [{ accountId: 'kuaishou_gamma', platform: 'kuaishou' }] }));
    const loginTask = taskOf(q, 'douyin_alpha');
    const actionTask = taskOf(q, 'kuaishou_gamma');

    await q.tick();
    expect(executor).toHaveBeenCalledTimes(2);
    expect(q.get(loginTask.id)!.state).toBe('needs_login');
    expect(q.get(actionTask.id)!.state).toBe('needs_user_action');
    expect(q.get(loginTask.id)!.lastErrorCode).toBe('login_required');
    expect(q.get(actionTask.id)!.lastErrorCode).toBe('captcha_required');

    await q.tick();
    expect(executor).toHaveBeenCalledTimes(2);

    douyinNeedsLogin = false;
    kuaishouNeedsAction = false;
    expect(q.resumeTask(loginTask.id)).toBe(true);
    expect(q.get(loginTask.id)!.state).toBe('queued');
    expect(q.resumeTask(actionTask.id)).toBe(true);
    await q.tick();
    expect(executor).toHaveBeenCalledTimes(4);
    expect(q.get(loginTask.id)!.state).toBe('verifying');
    expect(q.get(actionTask.id)!.state).toBe('verifying');
  });
});

describe('挂车请求持久化隔离', () => {
  const commerce = {
    platform: 'douyin' as const,
    accountId: 'douyin_alpha',
    kind: 'shop' as const,
    platformProductId: 'product-42',
    required: true,
  };

  function seedCommerceTask(
    state: 'queued' | 'retryable_failure' | 'uploading' | 'submitted' | 'verifying' | 'unknown_submission',
  ): string {
    const seed = openQueue();
    const report = seed.enqueueMatrix(
      matrix({
        accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }],
        commerceRequest: commerce,
      }),
    );
    const taskId = report.created[0]?.id ?? report.existing[0]!.id;
    const store = readStore();
    const task = store.tasks.find((candidate) => candidate.id === taskId)!;
    task.state = state;
    task.leaseUntil = state === 'uploading' ? START + 600_000 : null;
    writeFileSync(storePath, JSON.stringify(store), 'utf-8');
    return taskId;
  }

  it('commerceRequest 非空却处于 queued/retryable_failure/uploading 的任务加载即隔离，tick 永不调用普通发布执行器', async () => {
    const executor = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    for (const state of ['queued', 'retryable_failure', 'uploading'] as const) {
      const taskId = seedCommerceTask(state);
      const q = openQueue({ executor });
      const loaded = q.get(taskId)!;
      expect(loaded.state).toBe('needs_user_action');
      expect(loaded.commerceRequest).toEqual(commerce);
      expect(loaded.history.some((entry) => entry.errorCode === 'commerce_blocked_recovered')).toBe(true);

      await q.tick();
      await q.tick();
      expect(executor).not.toHaveBeenCalled();
      expect(q.get(taskId)!.state).toBe('needs_user_action');
      expectQueueError(() => q.resumeTask(taskId), 'commerce_blocked');
      expect(readStore().tasks.find((task) => task.id === taskId)!.state).toBe('needs_user_action');
    }
  });

  it('旧文件被改成可核对状态时加载即隔离，核对器不能把挂车请求误标为已发布', async () => {
    const executor = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    const reconciler = vi.fn(async () => reconcilePublished('remote-mistaken'));
    for (const state of ['submitted', 'verifying', 'unknown_submission'] as const) {
      const taskId = seedCommerceTask(state);
      const q = openQueue({ executor, reconciler });
      expect(q.get(taskId)!.state).toBe('needs_user_action');
      await q.tick();
      expect(q.get(taskId)!.state).toBe('needs_user_action');
    }
    expect(executor).not.toHaveBeenCalled();
    expect(reconciler).not.toHaveBeenCalled();
  });
});

describe('持久化 submitted 状态核对', () => {
  function seedSubmitted(): string {
    const seed = openQueue();
    seed.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const taskId = taskOf(seed, 'douyin_alpha').id;
    const store = readStore();
    store.tasks[0]!.state = 'submitted';
    writeFileSync(storePath, JSON.stringify(store), 'utf-8');
    return taskId;
  }

  it('submitted 任务经核对 published 可进入 published，不再每轮 tick 抛错', async () => {
    const taskId = seedSubmitted();
    const executor = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    const reconciler = vi.fn(async () => reconcilePublished('remote-confirmed'));
    const q = openQueue({ executor, reconciler });
    expect(q.get(taskId)!.state).toBe('submitted');

    const report = await q.tick();
    expect(report.reconciled).toEqual([taskId]);
    expect(reconciler).toHaveBeenCalledTimes(1);
    const done = q.get(taskId)!;
    expect(done.state).toBe('published');
    expect(done.remoteResult).toMatchObject({ remoteId: 'remote-confirmed', finalState: 'published' });
    expect(executor).not.toHaveBeenCalled();

    await q.tick();
    expect(q.get(taskId)!.state).toBe('published');
    expect(reconciler).toHaveBeenCalledTimes(1);
  });

  it('submitted 任务的未证实失败仍进入未知提交，不盲重发', async () => {
    const taskId = seedSubmitted();
    const executor = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId}`));
    const reconciler = vi.fn(
      async () =>
        ({ finalState: 'failed', remoteId: null, retryable: true, errorCode: 'lookup_failed' }) as ReconcileResult,
    );
    const q = openQueue({ executor, reconciler });

    await q.tick();
    const task = q.get(taskId)!;
    expect(task.state).toBe('unknown_submission');
    expect(task.remoteResult?.finalState).toBe('unknown');
    expect(task.lastErrorCode).toBe('remote_failure_unconfirmed');
    expect(executor).not.toHaveBeenCalled();
    await q.tick();
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('同进程租约回收', () => {
  it('uploading 超过租约且无在途执行器时转 unknown_submission，只核对不重发', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executor = vi.fn(async (input: PublishAttemptInput) => {
      await gate;
      return submitOk(`remote-${input.taskId}`);
    });
    const reconciler = vi.fn(async () => ({ finalState: 'unknown', errorCode: 'remote_pending' }) as ReconcileResult);
    const q = openQueue({ executor, reconciler });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    const tick1 = q.tick();
    expect(readStore().tasks[0]!.state).toBe('uploading');
    expect(executor).toHaveBeenCalledTimes(1);

    // 模拟“执行器已结束但结果落盘失败”：把 storePath 换成目录，令 rename 原子替换失败。
    rmSync(storePath, { force: true });
    mkdirSync(storePath, { recursive: true });
    release();
    await expect(tick1).rejects.toMatchObject({ code: 'store_write_failed' });
    rmSync(storePath, { recursive: true, force: true });

    const stuck = q.get(task.id)!;
    expect(stuck.state).toBe('uploading');
    expect(stuck.leaseUntil).toBe(START + 600_000);
    expect(reconciler).not.toHaveBeenCalled();

    // 租约未到期：不回收、不核对。
    advance(599_999);
    await q.tick();
    expect(q.get(task.id)!.state).toBe('uploading');
    expect(reconciler).not.toHaveBeenCalled();

    // 租约到期：转未知提交并只核对，执行器不得再次调用。
    advance(1);
    const report = await q.tick();
    const recovered = q.get(task.id)!;
    expect(report.claimed).toEqual([]);
    expect(reconciler).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(recovered.state).toBe('unknown_submission');
    expect(recovered.history.some((entry) => entry.errorCode === 'leased_upload_expired')).toBe(true);
  });

  it('在途执行器即使租约超时也不会被并发补发，tick 合并等待', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executor = vi.fn(async (input: PublishAttemptInput) => {
      await gate;
      return submitOk(`remote-${input.taskId}`);
    });
    const q = openQueue({ executor });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    const tick1 = q.tick();
    advance(600_000 + 1);
    const tick2 = q.tick();
    expect(tick2).toBe(tick1);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(q.get(task.id)!.state).toBe('uploading');

    release();
    await tick1;
    expect(executor).toHaveBeenCalledTimes(1);
    expect(q.get(task.id)!.state).toBe('verifying');
  });
});

describe('人工决议与在途核对竞态', () => {
  it('人工决议成功后在途核对迟到，保留终态且该轮 tick 平稳结束', async () => {
    let release!: () => void;
    const reconciler = vi.fn(
      () =>
        new Promise<ReconcileResult>((resolve) => {
          release = () => resolve({ finalState: 'unknown', errorCode: 'late_reconcile' });
        }),
    );
    const executor = vi.fn(async (): Promise<PublishAttemptOutcome> => ({ kind: 'unknown', errorCode: 'first_unknown' }));
    const q = openQueue({ executor, reconciler });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    await q.tick();
    expect(q.get(task.id)!.state).toBe('unknown_submission');

    const tick2 = q.tick();
    expect(reconciler).toHaveBeenCalledTimes(1);
    const resolved = q.applyManualResolution(task.id, {
      finalState: 'published',
      remoteId: 'remote-manual',
      resolvedBy: 'codex',
    });
    expect(resolved.state).toBe('published');

    release();
    await expect(tick2).resolves.toBeDefined();
    const final = q.get(task.id)!;
    expect(final.state).toBe('published');
    expect(final.remoteResult).toMatchObject({ remoteId: 'remote-manual', finalState: 'published' });
    expect(final.nextReconcileAt).toBeNull();
    expect(final.reconcileAttempts).toBe(1);
  });

  it('人工决议判定可重试后迟到的核对结果不得触发非法迁移，队列平稳结束', async () => {
    let release!: () => void;
    const reconciler = vi.fn(
      () =>
        new Promise<ReconcileResult>((resolve) => {
          release = () => resolve(reconcilePublished('remote-late'));
        }),
    );
    const executor = vi.fn(async (): Promise<PublishAttemptOutcome> => ({ kind: 'unknown', errorCode: 'first_unknown' }));
    const q = openQueue({ executor, reconciler });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    await q.tick();
    const tick2 = q.tick();
    q.applyManualResolution(task.id, {
      finalState: 'failed',
      remoteId: null,
      confirmedNotPublished: true,
      retryable: true,
      resolvedBy: 'codex',
    });
    expect(q.get(task.id)!.state).toBe('retryable_failure');

    release();
    await expect(tick2).resolves.toBeDefined();
    const final = q.get(task.id)!;
    expect(final.state).toBe('retryable_failure');
    expect(final.remoteResult!.finalState).toBe('failed');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('迟到的 published 核对不得用另一个远端 ID 覆盖人工终态', async () => {
    let release!: () => void;
    const reconciler = vi.fn(
      () =>
        new Promise<ReconcileResult>((resolve) => {
          release = () => resolve(reconcilePublished('remote-late'));
        }),
    );
    const executor = vi.fn(async (): Promise<PublishAttemptOutcome> => ({ kind: 'unknown', errorCode: 'first_unknown' }));
    const q = openQueue({ executor, reconciler });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    await q.tick();
    const tick2 = q.tick();
    q.applyManualResolution(task.id, { finalState: 'published', remoteId: 'remote-manual', resolvedBy: 'codex' });
    release();
    await tick2;

    const final = q.get(task.id)!;
    expect(final.state).toBe('published');
    expect(final.remoteResult!.remoteId).toBe('remote-manual');
    expect(final.remoteResult!.remoteUrl).toBeNull();
  });
});

describe('人工决议返回值隔离', () => {
  it('applyManualResolution 返回副本，调用方改写不影响内部状态与磁盘', () => {
    const seed = openQueue();
    seed.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const taskId = taskOf(seed, 'douyin_alpha').id;
    const store = readStore();
    store.tasks[0]!.state = 'unknown_submission';
    writeFileSync(storePath, JSON.stringify(store), 'utf-8');

    const q = openQueue();
    const resolved = q.applyManualResolution(taskId, {
      finalState: 'published',
      remoteId: 'remote-manual',
      resolvedBy: 'codex',
    });
    resolved.state = 'queued';
    resolved.lastErrorCode = 'tampered';
    resolved.metadata.tags.push('tampered-tag');
    resolved.remoteResult!.remoteId = 'tampered';
    resolved.history.length = 0;

    const internal = q.get(taskId)!;
    expect(internal.state).toBe('published');
    expect(internal.lastErrorCode).toBeNull();
    expect(internal.metadata.tags).toEqual(['tag-a']);
    expect(internal.remoteResult!.remoteId).toBe('remote-manual');
    expect(internal.history.length).toBeGreaterThan(0);

    const persisted = readStore().tasks.find((task) => task.id === taskId)!;
    expect(persisted.state).toBe('published');
    expect(persisted.remoteResult.remoteId).toBe('remote-manual');
    expect(persisted.history.length).toBeGreaterThan(0);
  });
});

describe('持久化健壮性', () => {
  it('坏 JSON 与未来 schema 显式拒绝，且不清空旧任务', () => {
    const q = openQueue();
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));

    const good = readFileSync(storePath, 'utf-8');
    writeFileSync(storePath, '{ not-json', 'utf-8');
    expectQueueError(() => openQueue(), 'corrupt_store');
    expect(readFileSync(storePath, 'utf-8')).toBe('{ not-json');

    writeFileSync(storePath, JSON.stringify({ schemaVersion: 2, tasks: [] }), 'utf-8');
    expectQueueError(() => openQueue(), 'unsupported_schema_version');
    expect(readFileSync(storePath, 'utf-8')).toBe(JSON.stringify({ schemaVersion: 2, tasks: [] }));

    writeFileSync(storePath, good, 'utf-8');
    expect(openQueue().list()).toHaveLength(1);
  });

  it('重复幂等键或非法任务字段的 store 显式拒绝', () => {
    const q = openQueue();
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const store = readStore();
    const duplicated = structuredClone(store);
    duplicated.tasks.push({ ...structuredClone(duplicated.tasks[0]), id: 'pubjob_dup', accountId: 'douyin_beta' });
    writeFileSync(storePath, JSON.stringify(duplicated), 'utf-8');
    expectQueueError(() => openQueue(), 'invalid_store');

    const badState = structuredClone(store);
    badState.tasks[0].state = 'not_a_state';
    writeFileSync(storePath, JSON.stringify(badState), 'utf-8');
    expectQueueError(() => openQueue(), 'invalid_store');
  });

  it('每次变更都原子落盘：磁盘 JSON 合法且无临时文件残留', async () => {
    const q = openQueue();
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');
    await q.tick();
    await q.tick();
    q.cancel(task.id);

    const files = readdirSync(dir);
    expect(files).toEqual(['queue.json']);
    const parsed = readStore();
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.tasks).toHaveLength(1);
  });

  it('审计记录状态时间、尝试次数、远端 ID 与安全错误码', async () => {
    const executor = vi.fn(async (input: PublishAttemptInput) => submitOk(`remote-${input.taskId.slice(0, 8)}`));
    const q = openQueue({ executor });
    q.enqueueMatrix(matrix({ accounts: [{ accountId: 'douyin_alpha', platform: 'douyin' }] }));
    const task = taskOf(q, 'douyin_alpha');

    await q.tick();
    const verifying = q.get(task.id)!;
    expect(verifying.state).toBe('verifying');
    expect(verifying.attempt).toBe(1);
    expect(verifying.remoteResult).toMatchObject({ finalState: 'unknown', verifiedAt: null });
    expect(verifying.remoteResult!.remoteId).toMatch(/^remote-/);
    expect(verifying.history.map((h) => h.to)).toEqual(['queued', 'uploading', 'verifying']);

    await q.tick();
    const published = q.get(task.id)!;
    expect(published.state).toBe('published');
    expect(published.remoteResult!.finalState).toBe('published');
    expect(published.remoteResult!.verifiedAt).toBe(current);
    expect(published.leaseUntil).toBeNull();
    expect(published.history[published.history.length - 1]!.to).toBe('published');
    expect(published.history.every((h) => h.at <= current)).toBe(true);

    const raw = readFileSync(storePath, 'utf-8');
    for (const forbidden of ['storageState', 'cookie', 'token', 'password', 'sessionRef']) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

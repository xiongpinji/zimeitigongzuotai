/**
 * Q2-R3b2b 产品发布队列引导（bootstrap）单元测试（离线，不启动 Electron）。
 *
 * 覆盖：
 * 1. 只有单实例锁 owner 能构造产品队列：未过门槛 / loser / owner 加载失败被
 *    撤销所有权时一律抛出，且绝不读取或创建队列存储；
 * 2. owner 的 store 固定为 <userData>/publish-v2/queue.json，构造阶段只读不写；
 * 3. 合成任务只在 owner 的隔离 fixture 中入队、按稳定路径持久化，重新打开新
 *    队列实例仍可见；
 * 4. 惰性 executor fail closed 到 needs_user_action（确认未提交），惰性
 *    reconciler 只报 unknown，绝不宣称远端状态；
 * 5. 源码级契约：bootstrap 只用 openOwnedDurableQueue、无 electron / 平台 /
 *    账号 / 网络 / 定时器依赖；main.ts 只在 ready 后、首个窗口前调用一次，
 *    且不 import 通用 openDurableQueue。
 *
 * 边界：全部为合成数据，不接触真实平台 / 账号 / userData；不证明打包启动路径。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { runSingleInstanceGate } from '../../electron/single-instance-gate';
import {
  PRODUCT_QUEUE_INERT_EXECUTOR_ERROR_CODE,
  PRODUCT_QUEUE_INERT_RECONCILER_ERROR_CODE,
  bootstrapProductQueue,
  resolveProductQueueStorePath,
} from '../../electron/publish/product-queue-bootstrap';
import type { DurablePublishQueue, PublishMatrixInput } from '../../electron/publish/durable-queue';

const electronDir = resolve(__dirname, '../../electron');

let tempDir = '';

function fakeApp(lockGranted: boolean) {
  return {
    requestSingleInstanceLock: () => lockGranted,
    quit: () => undefined,
    on: (_event: 'second-instance', _listener: () => void) => undefined,
  };
}

function syntheticMatrix(): PublishMatrixInput {
  return {
    videoVariantId: 'variant-bootstrap-synthetic',
    videoRef: 'local://synthetic/variant-bootstrap-synthetic.mp4',
    metadata: {
      title: '合成引导测试',
      description: '仅用于离线测试，不提交任何平台',
      tags: ['synthetic'],
      coverRefs: ['local://synthetic/cover.png'],
      scheduleAt: null,
    },
    accounts: [{ accountId: 'synthetic_account_alpha', platform: 'douyin' }],
    commerceRequest: null,
  };
}

async function runOwnerBootstrap(userDataPath: string): Promise<DurablePublishQueue> {
  let queue: DurablePublishQueue | null = null;
  await runSingleInstanceGate({
    app: fakeApp(true),
    loadMainRuntime: () => {
      queue = bootstrapProductQueue(userDataPath);
    },
  });
  if (!queue) {
    throw new Error('owner bootstrap did not construct a queue');
  }
  return queue;
}

function readStore(storePath: string): { tasks: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(storePath, 'utf-8'));
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'product-queue-bootstrap-'));
  // 先经一次 loser 门槛重置 owner 断言，避免上一个用例的所有权泄漏到下一个。
  await runSingleInstanceGate({ app: fakeApp(false), loadMainRuntime: () => undefined });
});

afterEach(() => {
  if (!tempDir) return;
  const resolved = resolve(tempDir);
  if (
    dirname(resolved) !== resolve(tmpdir()) ||
    !basename(resolved).startsWith('product-queue-bootstrap-')
  ) {
    throw new Error('Refusing to remove a path outside the product queue test fixture');
  }
  rmSync(resolved, { recursive: true, force: true });
});

describe('bootstrapProductQueue 所有权门槛', () => {
  it('未取得锁时拒绝构造，且不读取或创建队列存储', () => {
    expect(() => bootstrapProductQueue(tempDir)).toThrow('Single-instance lock owner required');
    expect(existsSync(resolveProductQueueStorePath(tempDir))).toBe(false);
    expect(existsSync(join(tempDir, 'publish-v2'))).toBe(false);
  });

  it('loser 拒绝构造并保持存储未创建', async () => {
    const outcome = await runSingleInstanceGate({
      app: fakeApp(false),
      loadMainRuntime: () => {
        throw new Error('loser 绝不能加载主运行时');
      },
    });
    expect(outcome).toEqual({ acquiredLock: false, loadedMainRuntime: false, quitRequested: true });
    expect(() => bootstrapProductQueue(tempDir)).toThrow('Single-instance lock owner required');
    expect(existsSync(join(tempDir, 'publish-v2'))).toBe(false);
  });

  it('owner 加载主运行时失败被撤销所有权后拒绝构造', async () => {
    await expect(
      runSingleInstanceGate({
        app: fakeApp(true),
        loadMainRuntime: () => {
          throw new Error('synthetic owner load failure');
        },
      }),
    ).rejects.toThrow('synthetic owner load failure');
    expect(() => bootstrapProductQueue(tempDir)).toThrow('Single-instance lock owner required');
    expect(existsSync(join(tempDir, 'publish-v2'))).toBe(false);
  });
});

describe('resolveProductQueueStorePath', () => {
  it('固定指向 <userData>/publish-v2/queue.json', () => {
    expect(resolveProductQueueStorePath(tempDir)).toBe(join(tempDir, 'publish-v2', 'queue.json'));
  });

  it('拒绝空 userDataPath 而不是静默退化为相对路径', () => {
    expect(() => resolveProductQueueStorePath('   ')).toThrow('userDataPath is required');
  });

  it('拒绝相对 userDataPath，避免把产品队列写到进程工作目录', () => {
    expect(() => resolveProductQueueStorePath('relative-user-data')).toThrow(
      'userDataPath must be absolute',
    );
  });
});

describe('bootstrapProductQueue owner 构造与持久化', () => {
  it('在稳定路径构造空队列，首次写入前不创建存储', async () => {
    const queue = await runOwnerBootstrap(tempDir);
    expect(queue.list()).toEqual([]);
    expect(queue.snapshot().tasks).toEqual([]);
    expect(existsSync(resolveProductQueueStorePath(tempDir))).toBe(false);
    expect(existsSync(join(tempDir, 'publish-v2'))).toBe(false);
  });

  it('合成入队只在 owner fixture 持久化，重新打开新实例仍可见', async () => {
    const queue = await runOwnerBootstrap(tempDir);
    const report = queue.enqueueMatrix(syntheticMatrix());
    expect(report.created).toHaveLength(1);
    expect(report.existing).toHaveLength(0);

    const storePath = resolveProductQueueStorePath(tempDir);
    expect(existsSync(storePath)).toBe(true);
    // 只有固定存储一个产物：没有上传 / 核对 / 渲染临时文件。
    expect(readdirSync(join(tempDir, 'publish-v2'))).toEqual(['queue.json']);

    const reopened = await runOwnerBootstrap(tempDir);
    const tasks = reopened.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe(report.created[0]!.id);
    expect(tasks[0]!.state).toBe('queued');
    expect(tasks[0]!.accountId).toBe('synthetic_account_alpha');
  });

  it('惰性 executor 把合成任务停在 needs_user_action，确认未提交且无远端结果', async () => {
    const queue = await runOwnerBootstrap(tempDir);
    const task = queue.enqueueMatrix(syntheticMatrix()).created[0]!;

    const report = await queue.tick();
    expect(report.claimed).toEqual([task.id]);
    expect(report.reconciled).toEqual([]);

    const parked = queue.get(task.id)!;
    expect(parked.state).toBe('needs_user_action');
    expect(parked.attempt).toBe(1);
    expect(parked.lastErrorCode).toBe(PRODUCT_QUEUE_INERT_EXECUTOR_ERROR_CODE);
    expect(parked.remoteResult).toBeNull();
  });

  it('惰性 reconciler 对未知提交只报 unknown，绝不宣称已发布', async () => {
    const seed = await runOwnerBootstrap(tempDir);
    const task = seed.enqueueMatrix(syntheticMatrix()).created[0]!;

    const storePath = resolveProductQueueStorePath(tempDir);
    const store = readStore(storePath);
    const seeded = store.tasks.find((candidate) => candidate.id === task.id)!;
    seeded.state = 'unknown_submission';
    writeFileSync(storePath, JSON.stringify(store), 'utf-8');

    const queue = await runOwnerBootstrap(tempDir);
    const report = await queue.tick();
    expect(report.reconciled).toEqual([task.id]);

    const reconciled = queue.get(task.id)!;
    expect(reconciled.state).toBe('unknown_submission');
    expect(reconciled.attempt).toBe(0);
    expect(reconciled.reconcileAttempts).toBe(1);
    expect(reconciled.lastErrorCode).toBe(PRODUCT_QUEUE_INERT_RECONCILER_ERROR_CODE);
    expect(reconciled.remoteResult?.finalState).toBe('unknown');
    expect(reconciled.remoteResult?.remoteId).toBeNull();
  });
});

describe('源码级接线契约', () => {
  it('bootstrap 只用 openOwnedDurableQueue，不依赖 electron / 平台 / 账号 / 网络 / 定时器', () => {
    const source = readFileSync(join(electronDir, 'publish/product-queue-bootstrap.ts'), 'utf8');
    expect(source).toMatch(/from\s+['"]\.\/owned-durable-queue['"]/);
    expect(source).toMatch(/openOwnedDurableQueue\(/);
    // 通用工厂不能作为产品替代路径出现（"openDurableQueue(" 不是
    // "openOwnedDurableQueue(" 的子串）。
    expect(source).not.toMatch(/openDurableQueue\(/);
    expect(source).not.toMatch(/from\s+['"]electron['"]/);
    expect(source).not.toMatch(/require\(\s*['"]electron['"]\s*\)/);
    expect(source).not.toMatch(/setInterval\s*\(|setTimeout\s*\(/);
    expect(source).not.toMatch(/\.tick\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(|node:http|node:https|axios|undici/);
    expect(source).not.toMatch(/publish\/platforms|publish\/accounts|biliup|chromium|puppeteer|playwright/);
  });

  it('main.ts 在 ready 后、首个窗口前调用 bootstrap 恰好一次并保留引用', () => {
    const source = readFileSync(join(electronDir, 'main.ts'), 'utf8');
    expect(source).toMatch(/from\s+['"]\.\/publish\/product-queue-bootstrap['"]/);
    expect(source).not.toMatch(/openDurableQueue/);
    expect(source).not.toMatch(/from\s+['"]\.\/publish\/durable-queue['"]/);

    const whenReadyIndex = source.indexOf('app.whenReady()');
    const bootstrapIndex = source.indexOf('bootstrapProductQueue(');
    const firstWindowIndex = source.indexOf('createWindow();');
    expect(whenReadyIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeGreaterThan(whenReadyIndex);
    expect(firstWindowIndex).toBeGreaterThan(bootstrapIndex);
    // 主运行时只调用一次引导（锁只允许一个写者）。
    expect(source.split('bootstrapProductQueue(').length - 1).toBe(1);
    // 保留模块级引用供后续接线任务使用，但本子任务不驱动 tick。
    expect(source).toMatch(/let productPublishQueue:/);
    expect(source.split('productPublishQueue = bootstrapProductQueue(').length - 1).toBe(1);
    expect(source).not.toMatch(/productPublishQueue[^\n]*\.tick\s*\(/);
    // owner 断言失败 / 存储不可读必须显式非零退出，绝不静默继续。
    expect(source.slice(bootstrapIndex, firstWindowIndex)).toMatch(/app\.exit\(1\)/);
  });
});

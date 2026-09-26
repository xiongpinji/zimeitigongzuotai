/**
 * Q2-R3b: two independent Windows Node processes, synthetic queue only.
 * Process A is killed while its injected executor is pending. Process B must
 * retain the lease until expiry and then reconcile unknown submission without
 * invoking the executor again. This is not a concurrent-writer CAS test.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

const START = 1_700_000_000_000;
const LEASE_MS = 10_000;
const appRoot = path.resolve(__dirname, '../..');

interface FixtureEvent {
  event: string;
  role: string;
  pid: number;
  taskId?: string;
}

const FIXTURE_SOURCE = String.raw`
const { appendFileSync, writeFileSync } = require('node:fs');
const { openDurableQueue } = require('./durable-queue.cjs');

const role = process.env.FIXTURE_ROLE;
const eventLog = process.env.FIXTURE_EVENT_LOG;
const resultPath = process.env.FIXTURE_RESULT_PATH;
const storePath = process.env.FIXTURE_STORE_PATH;
const start = Number(process.env.FIXTURE_START);
const leaseMs = Number(process.env.FIXTURE_LEASE_MS);
let now = start;
let executorCalls = 0;
let reconcilerCalls = 0;

function emit(event, extra = {}) {
  appendFileSync(eventLog, JSON.stringify({ event, role, pid: process.pid, ...extra }) + '\n');
}

const queue = openDurableQueue({
  storePath,
  clock: () => now,
  retryPolicy: { leaseMs },
  executor: async () => {
    executorCalls += 1;
    emit('executor-entered');
    await new Promise(() => {});
    throw new Error('unreachable');
  },
  reconciler: async () => {
    reconcilerCalls += 1;
    emit('reconciler-entered');
    return { finalState: 'unknown', errorCode: 'remote_pending' };
  },
});

async function main() {
  if (role === 'owner') {
    const created = queue.enqueueMatrix({
      videoVariantId: 'synthetic-variant',
      videoRef: 'local://synthetic-variant.mp4',
      metadata: {
        title: 'synthetic title', description: 'synthetic description',
        tags: [], coverRefs: [], scheduleAt: null,
      },
      accounts: [{ accountId: 'douyin_synthetic', platform: 'douyin' }],
      commerceRequest: null,
    });
    emit('enqueued', { taskId: created.created[0].id });
    setInterval(() => {}, 1000);
    await queue.tick();
    emit('owner-completed-unexpectedly');
    return;
  }

  const taskId = queue.list()[0].id;
  const initial = queue.get(taskId);
  now = start + leaseMs - 1;
  await queue.tick();
  const beforeExpiry = queue.get(taskId);
  now = start + leaseMs;
  await queue.tick();
  const afterExpiry = queue.get(taskId);
  let retryCode = null;
  try { queue.retryNow(taskId); } catch (error) { retryCode = error?.code ?? 'unknown'; }
  writeFileSync(resultPath, JSON.stringify({
    taskId,
    initialState: initial.state,
    initialLeaseUntil: initial.leaseUntil,
    beforeExpiryState: beforeExpiry.state,
    beforeExpiryLeaseUntil: beforeExpiry.leaseUntil,
    afterExpiryState: afterExpiry.state,
    afterExpiryAttempt: afterExpiry.attempt,
    historyCodes: afterExpiry.history.map((entry) => entry.errorCode),
    retryCode,
    executorCalls,
    reconcilerCalls,
  }));
  emit('restart-completed');
}

main().catch((error) => {
  emit('fixture-failed', { code: typeof error?.code === 'string' ? error.code : 'unknown' });
  process.exit(1);
});
`;

function removeFixtureRoot(root: string): void {
  const resolved = path.resolve(root);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith('lingji-q2r3b-')
  ) {
    throw new Error(`拒绝删除非预期的临时目录: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 5 });
}

function readEvents(eventLog: string): FixtureEvent[] {
  if (!existsSync(eventLog)) return [];
  return readFileSync(eventLog, 'utf8')
    .split('\n')
    .flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line) as FixtureEvent];
      } catch {
        return [];
      }
    });
}

function terminateTree(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/tree', '/force'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (result.status !== 0) child.kill('SIGKILL');
  } else {
    child.kill('SIGKILL');
  }
}

async function waitExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  if (child.signalCode !== null) return null;
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      terminateTree(child);
      reject(new Error(`fixture 进程 ${child.pid} 未在 ${timeoutMs}ms 内退出`));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitForEvent(
  eventLog: string,
  event: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readEvents(eventLog).some((entry) => entry.event === event && entry.pid === child.pid)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`fixture 在 ${event} 之前退出`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待 fixture 事件 ${event} 超时`);
}

describe.skipIf(process.platform !== 'win32')('Windows two-process durable queue crash/restart', () => {
  it('never resubmits an uncertain upload after process death and lease expiry', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lingji-q2r3b-'));
    const eventLog = path.join(root, 'events.jsonl');
    const storePath = path.join(root, 'queue.json');
    const resultPath = path.join(root, 'restart-result.json');
    const fixturePath = path.join(root, 'fixture.cjs');
    const bundlePath = path.join(root, 'durable-queue.cjs');
    let owner: ChildProcess | null = null;
    let restart: ChildProcess | null = null;
    let hadPrimaryError = false;
    try {
      writeFileSync(eventLog, '');
      writeFileSync(fixturePath, FIXTURE_SOURCE);
      buildSync({
        entryPoints: [path.join(appRoot, 'electron', 'publish', 'durable-queue.ts')],
        outfile: bundlePath,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        logLevel: 'silent',
      });

      const launch = (role: 'owner' | 'restart'): ChildProcess => {
        const env: NodeJS.ProcessEnv = {};
        for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
          if (process.env[key] !== undefined) env[key] = process.env[key];
        }
        Object.assign(env, {
          FIXTURE_ROLE: role,
          FIXTURE_EVENT_LOG: eventLog,
          FIXTURE_RESULT_PATH: resultPath,
          FIXTURE_STORE_PATH: storePath,
          FIXTURE_START: String(START),
          FIXTURE_LEASE_MS: String(LEASE_MS),
        });
        const child = spawn(process.execPath, [fixturePath], {
          cwd: root,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout?.on('data', () => {});
        child.stderr?.on('data', () => {});
        return child;
      };

      owner = launch('owner');
      await waitForEvent(eventLog, 'executor-entered', owner, 15_000);
      const persistedBeforeDeath = JSON.parse(readFileSync(storePath, 'utf8')) as {
        tasks: Array<{ state: string; attempt: number; leaseUntil: number }>;
      };
      expect(persistedBeforeDeath.tasks).toHaveLength(1);
      expect(persistedBeforeDeath.tasks[0]).toMatchObject({
        state: 'uploading',
        attempt: 1,
        leaseUntil: START + LEASE_MS,
      });

      terminateTree(owner);
      await waitExit(owner, 15_000);
      expect(readEvents(eventLog).some((event) => event.event === 'owner-completed-unexpectedly')).toBe(false);

      restart = launch('restart');
      expect(await waitExit(restart, 15_000)).toBe(0);
      expect(readEvents(eventLog).some((event) => event.event === 'fixture-failed')).toBe(false);
      const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
        initialState: string;
        initialLeaseUntil: number;
        beforeExpiryState: string;
        beforeExpiryLeaseUntil: number;
        afterExpiryState: string;
        afterExpiryAttempt: number;
        historyCodes: Array<string | null>;
        retryCode: string | null;
        executorCalls: number;
        reconcilerCalls: number;
      };
      expect(result.initialState).toBe('uploading');
      expect(result.initialLeaseUntil).toBe(START + LEASE_MS);
      expect(result.beforeExpiryState).toBe('uploading');
      expect(result.beforeExpiryLeaseUntil).toBe(START + LEASE_MS);
      expect(result.afterExpiryState).toBe('unknown_submission');
      expect(result.afterExpiryAttempt).toBe(1);
      expect(result.historyCodes).toContain('leased_upload_expired');
      expect(result.retryCode).toBe('invalid_transition');
      expect(result.executorCalls).toBe(0);
      expect(result.reconcilerCalls).toBe(1);
    } catch (error) {
      hadPrimaryError = true;
      throw error;
    } finally {
      terminateTree(owner);
      terminateTree(restart);
      const pending = [owner, restart]
        .filter((child): child is ChildProcess =>
          child !== null && child.exitCode === null && child.signalCode === null,
        )
        .map((child) => waitExit(child, 15_000));
      const exitResults = await Promise.allSettled(pending);
      let cleanupFailed = exitResults.some((result) => result.status === 'rejected');
      try {
        removeFixtureRoot(root);
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed && !hadPrimaryError) {
        throw new Error('fixture 清理失败');
      }
    }
  }, 60_000);
});

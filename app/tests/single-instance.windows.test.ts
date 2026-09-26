/**
 * Q2-R3a Windows 真双进程单实例锁测试。
 *
 * 用仓内 Electron 二进制（node_modules/electron/path.txt 或 ELECTRON_BINARY_PATH）
 * 启动同一个无 BrowserWindow 的临时 fixture 应用（OS 临时目录，绝不触碰真实
 * userData），以两个真实 OS 进程证明：
 * - 恰好一个 owner 取得锁并加载「主运行时」（fixture 用写者构造标记文件模拟）；
 * - loser 拿不到锁、被 gate quit，从未加载主运行时、没有任何写者构造标记；
 * - owner 收到 second-instance 事件（fixture 经 registerSecondInstanceFocus 记录）；
 * - owner 进程退出后，第三个实例可以重新取得锁。
 *
 * fixture 直接运行从 electron/single-instance-gate.ts 用 Node 内置
 * stripTypeScriptTypes 转出的真实 gate 代码，不是重写副本。
 *
 * 显式 skip 语义（诚实报告）：
 * - 非 win32 平台、找不到 Electron 二进制、或 Node < 22.13（无
 *   stripTypeScriptTypes）时整个双进程 describe 被 skipIf 跳过；
 *   「跳过」不等于「通过」，验证文档必须区分二者。
 *
 * 范围声明：本测试证明的是产品入口门槛在 Windows 上对同应用双进程的行为，
 * 不构成 DurablePublishQueue 通用 API 的跨进程安全证明；不假设 Electron 锁
 * 的作用域等同于 userData 路径（fixture 只是让两个进程共享全部应用身份）。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import nodeModule from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(__dirname, '..');
const gateSourcePath = path.join(appRoot, 'electron', 'single-instance-gate.ts');

type StripFn = ((code: string, options?: { mode?: string }) => string) | undefined;
const stripTypeScriptTypes = (nodeModule as { stripTypeScriptTypes?: StripFn }).stripTypeScriptTypes;

function stripGateSource(): string | null {
  if (typeof stripTypeScriptTypes !== 'function') {
    return null;
  }
  return stripTypeScriptTypes(readFileSync(gateSourcePath, 'utf8'), { mode: 'strip' });
}

function resolveElectronBinary(): string | null {
  const candidates: string[] = [];
  if (process.env.ELECTRON_BINARY_PATH) {
    candidates.push(process.env.ELECTRON_BINARY_PATH);
  }
  const electronPkgDir = path.join(appRoot, 'node_modules', 'electron');
  const pathTxt = path.join(electronPkgDir, 'path.txt');
  if (existsSync(pathTxt)) {
    candidates.push(path.join(electronPkgDir, 'dist', readFileSync(pathTxt, 'utf8').trim()));
  }
  candidates.push(path.join(electronPkgDir, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'));
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const electronBinary = resolveElectronBinary();
const canRunDualProcess =
  process.platform === 'win32' && electronBinary !== null && typeof stripTypeScriptTypes === 'function';

function removeFixtureDirectory(dir: string, prefix: string): void {
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error(`拒绝删除非预期的临时 fixture 目录: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 5 });
}

interface FixtureEvent {
  event: string;
  role: string;
  pid: number;
  ts: number;
  acquiredLock?: boolean;
  loadedMainRuntime?: boolean;
  quitRequested?: boolean;
}

// fixture 主脚本：ESM + 顶层 await；所有断言信号经 appendFileSync 同步写入
// events.jsonl（不依赖 stdout 管道在进程退出前的冲刷）。
const FIXTURE_MAIN_SOURCE = [
  "import { app } from 'electron';",
  "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "import { runSingleInstanceGate, registerSecondInstanceFocus } from './single-instance-gate.mjs';",
  '',
  "const role = process.env.FIXTURE_ROLE || 'owner';",
  'const userData = process.env.FIXTURE_USER_DATA;',
  'const resultDir = process.env.FIXTURE_RESULT_DIR;',
  "const eventLogPath = join(resultDir, 'events.jsonl');",
  "const ttlMs = Number(process.env.FIXTURE_OWNER_TTL_MS || '60000');",
  '',
  'function emit(event, extra) {',
  '  const line = JSON.stringify(',
  "    Object.assign({ event: event, role: role, pid: process.pid, ts: Date.now() }, extra || {}),",
  '  );',
  "  appendFileSync(eventLogPath, line + '\\n');",
  '}',
  '',
  "app.setName('lingji-single-instance-fixture');",
  "app.setPath('userData', userData);",
  'app.disableHardwareAcceleration();',
  '',
  'const outcome = await runSingleInstanceGate({',
  '  app: app,',
  '  loadMainRuntime: async () => {',
  "    emit('main-runtime-load-start');",
  "    const writersDir = join(userData, 'writers');",
  '    mkdirSync(writersDir, { recursive: true });',
  "    writeFileSync(join(writersDir, 'writer-constructed-' + process.pid + '.flag'), String(process.pid));",
  '    registerSecondInstanceFocus(() => {',
  "      emit('second-instance-focus');",
  '    });',
  "    emit('main-runtime-loaded');",
  '  },',
  '});',
  '',
  "emit('gate-outcome', outcome);",
  '',
  'if (outcome.acquiredLock) {',
  "  if (process.env.FIXTURE_EXIT_AFTER_OUTCOME === '1') {",
  '    app.exit(0);',
  "  } else if (role === 'owner') {",
  '    setTimeout(() => {',
  "      emit('owner-ttl-exit');",
  '      app.exit(0);',
  '    }, ttlMs);',
  '  }',
  '}',
  '',
].join('\n');

function readEvents(logPath: string): FixtureEvent[] {
  if (!existsSync(logPath)) {
    return [];
  }
  const events: FixtureEvent[] = [];
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed) as FixtureEvent);
    } catch {
      // 半行（进程被强杀时可能出现）：忽略
    }
  }
  return events;
}

function terminateTree(child: ChildProcess | null | undefined): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32' && child.pid) {
    const killed = spawnSync('taskkill', ['/pid', String(child.pid), '/tree', '/force'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (killed.status !== 0) {
      child.kill('SIGKILL');
    }
  } else {
    child.kill('SIGKILL');
  }
}

function onceExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null) {
      resolveExit(child.exitCode);
      return;
    }
    if (child.signalCode !== null) {
      resolveExit(null);
      return;
    }
    child.once('exit', (code) => resolveExit(code));
  });
}

async function waitExit(child: ChildProcess, timeoutMs: number, what: string): Promise<number | null> {
  const result = await Promise.race([
    onceExit(child),
    new Promise<'timeout'>((resolveTimeout) => setTimeout(() => resolveTimeout('timeout'), timeoutMs)),
  ]);
  if (result === 'timeout') {
    terminateTree(child);
    throw new Error(`等待 ${what} 退出超时（${timeoutMs}ms）`);
  }
  return result;
}

async function waitForEvents(
  logPath: string,
  predicate: (events: FixtureEvent[]) => boolean,
  timeoutMs: number,
  what: string,
): Promise<FixtureEvent[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = readEvents(logPath);
    if (predicate(events)) {
      return events;
    }
    if (Date.now() > deadline) {
      throw new Error(`等待 ${what} 超时（${timeoutMs}ms）；已收到事件：${JSON.stringify(events)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

describe('fixture transpile pipeline (platform-independent)', () => {
  it.skipIf(typeof stripTypeScriptTypes !== 'function')(
    'strips the real gate source into loadable ESM with the same loser semantics',
    async () => {
      const stripped = stripGateSource();
      expect(stripped).not.toBeNull();
      expect(stripped).toContain('runSingleInstanceGate');
      expect(stripped).toContain('registerSecondInstanceFocus');
      expect(stripped).not.toMatch(/interface\s+SingleInstanceGateApp/);

      const tmp = mkdtempSync(path.join(tmpdir(), 'lingji-gate-strip-'));
      try {
        const jsPath = path.join(tmp, 'single-instance-gate.mjs');
        writeFileSync(jsPath, stripped!);
        const mod = (await import(pathToFileURL(jsPath).href)) as {
          runSingleInstanceGate: (options: unknown) => Promise<Record<string, boolean>>;
        };
        expect(typeof mod.runSingleInstanceGate).toBe('function');

        const calls: string[] = [];
        const outcome = await mod.runSingleInstanceGate({
          app: {
            requestSingleInstanceLock: () => false,
            quit: () => calls.push('quit'),
            on: () => calls.push('on'),
          },
          loadMainRuntime: () => {
            calls.push('loadMainRuntime');
          },
        });
        // 转出产物与 TS 源语义一致：loser quit、绝不加载主运行时
        expect(outcome.acquiredLock).toBe(false);
        expect(outcome.loadedMainRuntime).toBe(false);
        expect(calls).toEqual(['quit']);
      } finally {
        removeFixtureDirectory(tmp, 'lingji-gate-strip-');
      }
    },
  );
});

describe.skipIf(!canRunDualProcess)('Windows dual-process single-instance gate (real Electron)', () => {
  it(
    'one owner holds the lock, loser quits without constructing writers, owner gets second-instance, lock is re-acquirable',
    async () => {
      const baseDir = mkdtempSync(path.join(tmpdir(), 'lingji-single-instance-win-'));
      const children: ChildProcess[] = [];
      try {
        const fixtureDir = path.join(baseDir, 'fixture');
        const userData = path.join(baseDir, 'user-data');
        const resultDir = path.join(baseDir, 'results');
        mkdirSync(fixtureDir, { recursive: true });
        mkdirSync(userData, { recursive: true });
        mkdirSync(resultDir, { recursive: true });
        const eventLog = path.join(resultDir, 'events.jsonl');
        writeFileSync(eventLog, '');

        const strippedGate = stripGateSource();
        expect(strippedGate).not.toBeNull();
        writeFileSync(path.join(fixtureDir, 'single-instance-gate.mjs'), strippedGate!);
        writeFileSync(path.join(fixtureDir, 'fixture-main.mjs'), FIXTURE_MAIN_SOURCE);
        writeFileSync(
          path.join(fixtureDir, 'package.json'),
          JSON.stringify(
            {
              name: 'lingji-single-instance-fixture',
              productName: 'lingji-single-instance-fixture',
              version: '0.0.0',
              type: 'module',
              main: 'fixture-main.mjs',
            },
            null,
            2,
          ),
        );

        const launch = (role: string, extraEnv: Record<string, string> = {}): ChildProcess => {
          const env: Record<string, string> = {};
          for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') {
              env[key] = value;
            }
          }
          Object.assign(env, {
            FIXTURE_ROLE: role,
            FIXTURE_USER_DATA: userData,
            FIXTURE_RESULT_DIR: resultDir,
            FIXTURE_OWNER_TTL_MS: '120000',
          }, extraEnv);
          const child = spawn(electronBinary!, [fixtureDir], {
            cwd: fixtureDir,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          // 排空 stdout/stderr，避免管道缓冲区填满导致 fixture 进程阻塞
          child.stdout?.on('data', () => {});
          child.stderr?.on('data', () => {});
          children.push(child);
          return child;
        };

        // 1) owner 启动并取得锁、加载主运行时（写者构造标记就绪）
        const owner = launch('owner');
        await waitForEvents(
          eventLog,
          (events) =>
            events.some((e) => e.role === 'owner' && e.event === 'main-runtime-loaded') &&
            events.some((e) => e.role === 'owner' && e.event === 'gate-outcome'),
          60_000,
          'owner 加载主运行时',
        );
        let events = readEvents(eventLog);
        const ownerOutcome = events.find((e) => e.role === 'owner' && e.event === 'gate-outcome');
        expect(ownerOutcome).toBeTruthy();
        expect(ownerOutcome!.acquiredLock).toBe(true);
        expect(ownerOutcome!.loadedMainRuntime).toBe(true);
        expect(ownerOutcome!.quitRequested).toBe(false);
        const ownerPid = ownerOutcome!.pid;

        // 2) 第二个实例：拿不到锁、quit、从不加载主运行时
        const loser = launch('loser');
        const loserExitCode = await waitExit(loser, 60_000, 'loser');
        expect(loserExitCode).toBe(0);

        events = readEvents(eventLog);
        const loserEvents = events.filter((e) => e.role === 'loser');
        const loserOutcome = loserEvents.find((e) => e.event === 'gate-outcome');
        expect(loserOutcome).toBeTruthy();
        expect(loserOutcome!.acquiredLock).toBe(false);
        expect(loserOutcome!.loadedMainRuntime).toBe(false);
        expect(loserOutcome!.quitRequested).toBe(true);
        const loserPid = loserOutcome!.pid;
        // loser 没有任何「主运行时已加载 / 写者已构造 / second-instance」信号
        expect(
          loserEvents.some(
            (e) => e.event === 'main-runtime-load-start' || e.event === 'main-runtime-loaded',
          ),
        ).toBe(false);
        expect(loserEvents.some((e) => e.event === 'second-instance-focus')).toBe(false);

        // 3) owner 因第二次启动收到 second-instance 事件（经 focus 注册表）
        await waitForEvents(
          eventLog,
          (evts) => evts.some((e) => e.role === 'owner' && e.event === 'second-instance-focus'),
          60_000,
          'owner 收到 second-instance',
        );

        // 4) 终止 owner（Windows 树杀），等待退出释放锁
        terminateTree(owner);
        await waitExit(owner, 15_000, '被强制终止的 owner');
        expect(readEvents(eventLog).some((e) => e.role === 'owner' && e.event === 'owner-ttl-exit')).toBe(false);

        // 5) 第三实例应能重新取得锁（证明锁随 owner 退出释放，非永久残留）
        const third = launch('third', { FIXTURE_EXIT_AFTER_OUTCOME: '1' });
        const thirdExitCode = await waitExit(third, 60_000, 'third');
        expect(thirdExitCode).toBe(0);
        events = readEvents(eventLog);
        const thirdEvents = events.filter((e) => e.role === 'third');
        const thirdOutcome = thirdEvents.find((e) => e.event === 'gate-outcome');
        expect(thirdOutcome).toBeTruthy();
        expect(thirdOutcome!.acquiredLock).toBe(true);
        expect(thirdOutcome!.loadedMainRuntime).toBe(true);
        const thirdPid = thirdOutcome!.pid;

        // 6) 写者构造标记只属于取得过锁的进程；loser 从未构造写者
        const writersDir = path.join(userData, 'writers');
        const flags = existsSync(writersDir) ? readdirSync(writersDir) : [];
        expect(flags.length).toBeGreaterThan(0);
        const flagPids = flags.map((name) => Number(name.replace('writer-constructed-', '').replace('.flag', '')));
        expect(flagPids).toContain(ownerPid);
        expect(flagPids).not.toContain(loserPid);
        for (const pid of flagPids) {
          expect([ownerPid, thirdPid]).toContain(pid);
        }
      } finally {
        for (const child of children) {
          terminateTree(child);
        }
        removeFixtureDirectory(baseDir, 'lingji-single-instance-win-');
      }
    },
    300_000,
  );
});

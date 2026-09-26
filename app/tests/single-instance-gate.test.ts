/**
 * Q2-R3a 单实例门槛单元测试（注入式，不启动 Electron）。
 *
 * 覆盖三层契约：
 * 1. gate 行为：loser 立即 quit 且绝不调用 loadMainRuntime / 不注册 second-instance；
 *    owner 先注册 second-instance 监听，再恰好一次加载主运行时；加载失败向上抛出。
 * 2. focus 注册表：主运行时加载后经 registerSecondInstanceFocus 注册回调，
 *    second-instance 事件触发回调；回调未注册时事件被安全忽略。
 * 3. 源码级入口契约：single-instance-entry.ts 不得静态导入 './main'，
 *    必须在 runSingleInstanceGate 内以动态 import('./main') 晚加载；
 *    gate 模块自身不得运行时依赖 electron；main.ts 不得重复请求锁。
 *
 * 边界：这些测试证明的是 gate/入口的加载顺序契约，不证明 DurablePublishQueue
 * 的通用 API 跨进程安全（指纹核验仍非跨进程 CAS，见 durable-queue.ts 文件头）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  clearSecondInstanceFocusHandler,
  getRegisteredSecondInstanceFocusHandler,
  registerSecondInstanceFocus,
  runSingleInstanceGate,
} from '../electron/single-instance-gate';

const electronDir = path.resolve(__dirname, '../electron');

function readSource(fileName: string): string {
  return readFileSync(path.join(electronDir, fileName), 'utf8');
}

function createFakeApp(lockGranted: boolean) {
  const calls: string[] = [];
  const secondInstanceListeners: Array<() => void> = [];
  const app = {
    requestSingleInstanceLock(): boolean {
      calls.push('requestSingleInstanceLock');
      return lockGranted;
    },
    quit(): void {
      calls.push('quit');
    },
    on(event: string, listener: () => void): unknown {
      calls.push(`on:${event}`);
      if (event === 'second-instance') {
        secondInstanceListeners.push(listener);
      }
      return undefined;
    },
    emitSecondInstance(): void {
      for (const listener of [...secondInstanceListeners]) {
        listener();
      }
    },
  };
  return { app, calls, secondInstanceListeners };
}

describe('runSingleInstanceGate', () => {
  beforeEach(() => {
    clearSecondInstanceFocusHandler();
  });

  it('loser quits immediately and never loads the main runtime or registers listeners', async () => {
    const { app, calls } = createFakeApp(false);
    let loadCalls = 0;

    const outcome = await runSingleInstanceGate({
      app,
      loadMainRuntime: () => {
        loadCalls += 1;
      },
    });

    expect(outcome).toEqual({
      acquiredLock: false,
      loadedMainRuntime: false,
      quitRequested: true,
    });
    // loser 绝不调用主运行时加载器（即不会注册旧 publish IPC / account-v2 / 未来队列写者）
    expect(loadCalls).toBe(0);
    // 精确调用序列：请求锁一次 → quit 一次；没有 second-instance 监听注册
    expect(calls).toEqual(['requestSingleInstanceLock', 'quit']);
  });

  it('owner registers second-instance before loading the runtime exactly once', async () => {
    const { app, calls } = createFakeApp(true);
    let loadCalls = 0;

    const outcome = await runSingleInstanceGate({
      app,
      loadMainRuntime: () => {
        loadCalls += 1;
        calls.push('loadMainRuntime');
      },
    });

    expect(outcome).toEqual({
      acquiredLock: true,
      loadedMainRuntime: true,
      quitRequested: false,
    });
    expect(loadCalls).toBe(1);
    // 顺序契约：锁 → second-instance 监听 → 加载主运行时；owner 不 quit
    expect(calls).toEqual(['requestSingleInstanceLock', 'on:second-instance', 'loadMainRuntime']);
    expect(calls).not.toContain('quit');
  });

  it('dispatches second-instance to the focus handler registered by the loaded runtime', async () => {
    const { app } = createFakeApp(true);
    let focusCalls = 0;

    await runSingleInstanceGate({
      app,
      loadMainRuntime: () => {
        registerSecondInstanceFocus(() => {
          focusCalls += 1;
        });
      },
    });

    expect(getRegisteredSecondInstanceFocusHandler()).not.toBeNull();
    app.emitSecondInstance();
    app.emitSecondInstance();
    expect(focusCalls).toBe(2);
  });

  it('safely ignores second-instance events that arrive before the runtime registers focus', async () => {
    const { app } = createFakeApp(true);
    let loaded = false;

    const gatePromise = runSingleInstanceGate({
      app,
      loadMainRuntime: async () => {
        // 模拟主运行时异步加载期间收到 second-instance（尚无窗口可聚焦）
        await new Promise((resolve) => setTimeout(resolve, 0));
        app.emitSecondInstance();
        loaded = true;
        registerSecondInstanceFocus(() => {
          // 注册后的事件才会到这里
        });
      },
    });

    await expect(gatePromise).resolves.toEqual({
      acquiredLock: true,
      loadedMainRuntime: true,
      quitRequested: false,
    });
    expect(loaded).toBe(true);
  });

  it('propagates main runtime load failures instead of leaving a half-started owner', async () => {
    const { app } = createFakeApp(true);

    await expect(
      runSingleInstanceGate({
        app,
        loadMainRuntime: () => {
          throw new Error('main runtime load failed');
        },
      }),
    ).rejects.toThrow('main runtime load failed');
  });

  it('clears and re-registers the focus handler through the registry API', () => {
    expect(getRegisteredSecondInstanceFocusHandler()).toBeNull();
    const handler = () => {};
    registerSecondInstanceFocus(handler);
    expect(getRegisteredSecondInstanceFocusHandler()).toBe(handler);
    clearSecondInstanceFocusHandler();
    expect(getRegisteredSecondInstanceFocusHandler()).toBeNull();
  });
});

describe('source-level entry contracts', () => {
  it('gate module has no runtime dependency on electron', () => {
    const gateSource = readSource('single-instance-gate.ts');
    expect(gateSource).not.toMatch(/from\s+['"]electron['"]/);
    expect(gateSource).not.toMatch(/require\(\s*['"]electron['"]\s*\)/);
  });

  it('thin entry never statically imports the main runtime', () => {
    const entrySource = readSource('single-instance-entry.ts');
    // 任何形式的静态导入 / require / re-export 都会让 main.ts 顶层副作用先于锁执行
    expect(entrySource).not.toMatch(/^\s*import[^;\n]*from\s+['"]\.\/main['"]/m);
    expect(entrySource).not.toMatch(/^\s*export[^;\n]*from\s+['"]\.\/main['"]/m);
    expect(entrySource).not.toMatch(/require\(\s*['"]\.\/main['"]\s*\)/);
    // 必须是运行时动态 import
    expect(entrySource).toMatch(/import\(\s*['"]\.\/main['"]\s*\)/);
  });

  it('thin entry requests the lock via the gate before the dynamic import textually and semantically', () => {
    const entrySource = readSource('single-instance-entry.ts');
    expect(entrySource).toMatch(/import\s+\{\s*app\s*\}\s+from\s+['"]electron['"]/);
    expect(entrySource).toMatch(/from\s+['"]\.\/single-instance-gate['"]/);
    const gateCallIndex = entrySource.indexOf('runSingleInstanceGate(');
    const dynamicImportIndex = entrySource.search(/import\(\s*['"]\.\/main['"]\s*\)/);
    expect(gateCallIndex).toBeGreaterThan(-1);
    expect(dynamicImportIndex).toBeGreaterThan(-1);
    // 动态 import 只能作为 gate 的 loadMainRuntime 注入项出现在 gate 调用之后
    expect(dynamicImportIndex).toBeGreaterThan(gateCallIndex);
    // gate 在入口中只被调用一次（恰好一次锁请求）
    expect(entrySource.split('runSingleInstanceGate(').length - 1).toBe(1);
  });

  it('main.ts registers second-instance focus through the gate registry and never requests the lock itself', () => {
    const mainSource = readSource('main.ts');
    expect(mainSource).toMatch(/from\s+['"]\.\/single-instance-gate['"]/);
    expect(mainSource).toMatch(/registerSecondInstanceFocus\(/);
    // 锁只由薄入口请求一次；main.ts 也不得自行注册 second-instance 监听
    expect(mainSource).not.toMatch(/requestSingleInstanceLock/);
    expect(mainSource).not.toMatch(/app\.on\(\s*['"]second-instance['"]/);
  });
});

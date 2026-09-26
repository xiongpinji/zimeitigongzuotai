/**
 * Q2-R3a 产品入口单实例门槛（注入式，无 electron 运行时依赖，便于单测）。
 *
 * 职责：
 * - 请求 Electron 单实例锁（requestSingleInstanceLock）；loser 实例只 quit，
 *   绝不调用 loadMainRuntime，也绝不注册 second-instance 监听；
 * - owner 实例先注册 second-instance 监听，再（恰好一次）延迟加载主运行时，
 *   保证锁取得前不执行 main.ts 的任何顶层副作用（旧 publish:* IPC 注册、
 *   account-v2 bootstrap、<userData>/publish-v2 构造、app.whenReady 调度等）；
 * - 提供 registerSecondInstanceFocus 注册表：主运行时加载完成后注册
 *   「聚焦/恢复已有窗口」回调，second-instance 事件到达时转发给它。
 *
 * 边界与免责：
 * - 本模块不 import electron（App 以结构化接口注入），可脱离 Electron 单测；
 * - Electron 官方文档只保证：requestSingleInstanceLock 返回布尔、第二个实例
 *   触发 owner 的 second-instance 事件、失败实例应退出。本模块不假设锁的
 *   作用域等同于 userData 路径，也不做任何跨 userData 的锁语义推断；
 * - 本门槛不使 DurablePublishQueue 的通用 API 变成跨进程安全：其读指纹→rename
 *   仍非跨进程 CAS（见 durable-queue.ts 文件头）。队列接线（P1）只允许在
 *   取得锁的 Electron main 内构造写者；任何 CLI / sidecar 写者需要另行设计
 *   存储级锁（Q2-R3b 与 P1 接线门槛）。
 * - second-instance 在主运行时加载完成前到达时安全忽略（此时尚无窗口可聚焦）。
 */

/** Electron App 的最小结构化子集；真实 app 对象满足该接口（方法参数双变）。 */
export interface SingleInstanceGateApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance', listener: () => void): unknown;
}

export interface SingleInstanceGateOptions {
  app: SingleInstanceGateApp;
  /**
   * 仅由取得锁的 owner 调用，且恰好一次。必须是运行时延迟加载
   * （例如 () => import('./main')），不得改为静态导入。
   */
  loadMainRuntime: () => Promise<unknown> | unknown;
}

export interface SingleInstanceGateOutcome {
  readonly acquiredLock: boolean;
  readonly loadedMainRuntime: boolean;
  readonly quitRequested: boolean;
}

export type SecondInstanceFocusHandler = () => void;

let secondInstanceFocusHandler: SecondInstanceFocusHandler | null = null;

/** 主运行时（main.ts）加载后注册二次启动时的聚焦/恢复回调。 */
export function registerSecondInstanceFocus(handler: SecondInstanceFocusHandler): void {
  secondInstanceFocusHandler = handler;
}

/** 主要供测试与异常路径使用：清空已注册的聚焦回调。 */
export function clearSecondInstanceFocusHandler(): void {
  secondInstanceFocusHandler = null;
}

/** 主要供测试使用：读取当前注册的聚焦回调。 */
export function getRegisteredSecondInstanceFocusHandler(): SecondInstanceFocusHandler | null {
  return secondInstanceFocusHandler;
}

/**
 * 执行单实例门槛。必须在任何主运行时模块副作用之前调用（薄入口
 * single-instance-entry.ts 是 main 构建入口，静态导入本模块并调用本函数）。
 *
 * - loser：调用 app.quit() 后立即返回，不加载主运行时、不注册任何监听；
 * - owner：注册 second-instance 监听 → await loadMainRuntime()（恰好一次）。
 *   loadMainRuntime 抛错时原样向上传播，由入口显式失败退出，绝不静默
 *   保留半初始化的 owner 进程。
 */
export async function runSingleInstanceGate(
  options: SingleInstanceGateOptions,
): Promise<SingleInstanceGateOutcome> {
  const acquiredLock = options.app.requestSingleInstanceLock();

  if (!acquiredLock) {
    // loser：只退出。不调用 loader、不注册监听、不触碰 userData，
    // 因此不可能构造账号仓 / 旧 publish 仓 / 未来队列写者。
    options.app.quit();
    return { acquiredLock: false, loadedMainRuntime: false, quitRequested: true };
  }

  // owner：先注册 second-instance，再加载主运行时——保证即使第二个实例在
  // 主运行时加载期间启动，事件也不会丢在 gate 层（focus 回调未注册时忽略）。
  options.app.on('second-instance', () => {
    const handler = secondInstanceFocusHandler;
    if (handler) {
      handler();
    }
  });

  await options.loadMainRuntime();
  return { acquiredLock: true, loadedMainRuntime: true, quitRequested: false };
}

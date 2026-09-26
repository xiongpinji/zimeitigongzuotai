/**
 * Q2-R3a Electron main 构建入口（薄层）。产物仍为 dist-electron/main.js
 * （package.json "main" 不变）；electron/main.ts 作为第二构建入口产出
 * dist-electron/app-main.js，只能被本文件动态 import。
 *
 * 顺序契约（构建产物必须可证伪地满足）：
 * 1. 本文件绝不静态导入 './main'——否则 main.ts 顶层副作用（旧 publish:* IPC
 *    注册、account-v2 bootstrap 调度、app.whenReady、ipcMain.handle 等）会在
 *    请求锁之前执行；
 * 2. 先经 runSingleInstanceGate 请求单实例锁：loser 实例立即 app.quit()，
 *    不加载任何主运行时模块、不触碰 userData；
 * 3. 仅 owner 通过 loadMainRuntime 以动态 import 晚加载 ./main，恰好一次。
 *
 * electron.vite.config.ts 将本文件与 electron/main.ts 配成多入口构建并显式
 * inlineDynamicImports:false——多入口在构造上禁止把动态导入内联压平；若
 * bundler 行为回退，构建会显式报错而不是静默提前执行 main.ts。
 *
 * 构建后核验（见 docs/validation/p1-2-single-writer-gate.md）：
 * - dist-electron/main.js 含指向 ./app-main.js 的懒加载（import() 或等价
 *   Promise+require），且不含 main.ts 顶层标记（如 ipcMain.handle 通道字符串、
 *   'account-v2' 日志文案）；
 * - dist-electron/app-main.js 存在且包含主运行时；共享的 gate 模块位于独立
 *   chunk 或按 rollup 规则被两个入口 require（同一模块实例，注册表共享）。
 */
import { app } from 'electron';
import { runSingleInstanceGate } from './single-instance-gate';

void runSingleInstanceGate({
  app,
  loadMainRuntime: () => import('./main'),
}).catch((error: unknown) => {
  // owner 加载主运行时失败必须显式退出（非零码），绝不静默保活半初始化进程。
  try {
    console.error('[single-instance-entry] 加载主运行时失败:', error);
  } finally {
    app.exit(1);
  }
});

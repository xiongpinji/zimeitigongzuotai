/**
 * B 站扫码登录（伪终端驱动）。
 *
 * biliup 1.x 的 `login` 是 dialoguer 交互式 TUI：没有任何 flag 能指定登录方式，
 * 且无 TTY 时直接报错 `IO error: not a terminal`（uploader.rs:87），根本走不到扫码。
 * 因此应用内必须给 biliup 一个伪终端（node-pty），并驱动菜单选「扫码登录」，
 * biliup 随后把 qrcode.png 写到 cwd —— 与既有轮询逻辑对接。
 *
 * 菜单（biliup 1.1.x ~ 1.2.x 一致）：
 *   账号密码 / [短信登录(默认高亮)] / 扫码登录 / 浏览器登录 / 网页Cookie登录1 / 网页Cookie登录2
 * 从默认「短信登录」下移一行即「扫码登录」，故 Down + Enter 即可。
 *
 * node-pty 是原生模块，仅在登录时按需 require（顶层 import 会拖垮纯函数单测的可加载性）。
 */

import { join } from 'node:path';
import * as fs from 'node:fs';
import { resolveBiliupPath } from './biliup-runtime';

const MENU_MARKER = '选择一种登录方式';
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000; // 二维码有效期内未扫码则放弃，避免 PTY 僵尸

type PtyModule = typeof import('node-pty');

/**
 * npm 安装的 node-pty 预编译 spawn-helper 常丢失可执行位（macOS 下表现为
 * `posix_spawnp failed`）。登录前对当前平台的 spawn-helper 补 +x。Windows 走
 * conpty，无 spawn-helper，直接跳过。
 */
function ensureSpawnHelperExecutable(ptyModuleDir: string): void {
  if (process.platform === 'win32') return;
  const key = `${process.platform}-${process.arch}`;
  const helper = join(ptyModuleDir, 'prebuilds', key, 'spawn-helper');
  try {
    fs.chmodSync(helper, 0o755);
  } catch {
    // 不存在 / 已可执行 / 无权限都不致命，交由后续 spawn 报错
  }
}

export interface BiliupLoginOptions {
  /** -u 指向的 cookie 文件路径，登录成功后 biliup 写入此处 */
  storageStatePath: string;
  /** 工作目录：biliup 把 qrcode.png 写到这里 */
  cwd: string;
  /** qrcode.png 出现时回调，供 UI 展示备用二维码图片 */
  onQrcode?: (pngPath: string) => void;
}

/** 通过伪终端执行 biliup 扫码登录，始终 resolve（不 reject）。 */
export function loginBiliupViaPty(
  opts: BiliupLoginOptions,
): Promise<{ success: boolean; message: string }> {
  let pty: PtyModule;
  let ptyDir: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pty = require('node-pty') as PtyModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyDir = join(require.resolve('node-pty/package.json'), '..');
  } catch (e) {
    return Promise.resolve({
      success: false,
      message: 'node-pty 不可用，无法在应用内完成 B 站扫码登录：' + (e as Error).message,
    });
  }
  ensureSpawnHelperExecutable(ptyDir);

  const binaryPath = resolveBiliupPath();
  const qrPath = join(opts.cwd, 'qrcode.png');

  return new Promise((resolve) => {
    let child: import('node-pty').IPty;
    try {
      child = pty.spawn(binaryPath, ['-u', opts.storageStatePath, 'login'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: opts.cwd,
      });
    } catch (e) {
      resolve({ success: false, message: '启动 biliup 登录失败：' + (e as Error).message });
      return;
    }

    let buf = '';
    let navigated = false;
    let qrSurfaced = false;
    let settled = false;

    const surfaceQr = () => {
      if (qrSurfaced) return;
      if (fs.existsSync(qrPath)) {
        qrSurfaced = true;
        opts.onQrcode?.(qrPath);
      }
    };
    const poll = setInterval(surfaceQr, 400);

    const finish = (result: { success: boolean; message: string }) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      try {
        child.kill();
      } catch {
        // 已退出
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({ success: false, message: '登录超时：二维码已失效，请重试' });
    }, LOGIN_TIMEOUT_MS);

    child.onData((d) => {
      buf += d;
      // 检测登录方式菜单 → 从默认「短信登录」下移到「扫码登录」并回车
      if (!navigated && buf.includes(MENU_MARKER)) {
        navigated = true;
        setTimeout(() => {
          try {
            child.write('\x1b[B'); // Down
          } catch {
            /* ignore */
          }
        }, 400);
        setTimeout(() => {
          try {
            child.write('\r'); // Enter
          } catch {
            /* ignore */
          }
        }, 900);
      }
    });

    child.onExit(({ exitCode }) => {
      surfaceQr();
      const cookieOk = fs.existsSync(opts.storageStatePath);
      if (exitCode === 0 && cookieOk) {
        finish({ success: true, message: '登录完成' });
      } else {
        const tail = buf
          .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
          .replace(/[\r]/g, '')
          .trim()
          .slice(-200);
        finish({ success: false, message: tail || 'B站登录失败' });
      }
    });
  });
}

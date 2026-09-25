import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

// chromium-install.ts 顶层 import { app } from 'electron'；node 环境下需 mock。
import { vi } from 'vitest';
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/tmp/userData-${name}` },
}));

import {
  getChromiumRoot,
  findChromiumExecutable,
  isChromiumInstalled,
  resolvePlaywrightCli,
  parseInstallProgress,
} from '../../electron/publish/chromium-install';

describe('getChromiumRoot', () => {
  it('落在 userData/publish/chromium', () => {
    expect(getChromiumRoot()).toBe('/tmp/userData-userData/publish/chromium');
  });
});

describe('findChromiumExecutable', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(join(os.tmpdir(), 'chromium-find-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('darwin: 命中 chromium-<rev> 下的 Chromium.app 可执行', () => {
    const exe = join(root, 'chromium-1194', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    fs.mkdirSync(join(exe, '..'), { recursive: true });
    fs.writeFileSync(exe, 'x');
    expect(findChromiumExecutable(root, 'darwin')).toBe(exe);
  });

  it('win32: 命中 chrome-win/chrome.exe', () => {
    const exe = join(root, 'chromium-1194', 'chrome-win', 'chrome.exe');
    fs.mkdirSync(join(exe, '..'), { recursive: true });
    fs.writeFileSync(exe, 'x');
    expect(findChromiumExecutable(root, 'win32')).toBe(exe);
  });

  it('排除 headless_shell，未安装时返回 null', () => {
    fs.mkdirSync(join(root, 'chromium_headless_shell-1194', 'chrome-mac'), { recursive: true });
    expect(findChromiumExecutable(root, 'darwin')).toBeNull();
    expect(findChromiumExecutable('/no/such/dir', 'darwin')).toBeNull();
  });

  it('多版本时选最高 revision', () => {
    for (const rev of ['1100', '1300', '1200']) {
      const exe = join(root, `chromium-${rev}`, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
      fs.mkdirSync(join(exe, '..'), { recursive: true });
      fs.writeFileSync(exe, 'x');
    }
    expect(findChromiumExecutable(root, 'darwin')).toContain('chromium-1300');
  });

  it('darwin: 命中 Chrome for Testing 新布局（chrome-mac-arm64）', () => {
    const exe = join(
      root, 'chromium-1228', 'chrome-mac-arm64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing',
    );
    fs.mkdirSync(join(exe, '..'), { recursive: true });
    fs.writeFileSync(exe, 'x');
    expect(findChromiumExecutable(root, 'darwin')).toBe(exe);
  });

  it('win32: 命中 chrome-win64/chrome.exe（CfT 新布局）', () => {
    const exe = join(root, 'chromium-1228', 'chrome-win64', 'chrome.exe');
    fs.mkdirSync(join(exe, '..'), { recursive: true });
    fs.writeFileSync(exe, 'x');
    expect(findChromiumExecutable(root, 'win32')).toBe(exe);
  });
});

describe('isChromiumInstalled', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(join(os.tmpdir(), 'chromium-mark-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('有 INSTALLATION_COMPLETE 标记 → 已安装（不依赖可执行布局）', () => {
    fs.mkdirSync(join(root, 'chromium-1228'), { recursive: true });
    fs.writeFileSync(join(root, 'chromium-1228', 'INSTALLATION_COMPLETE'), '');
    expect(isChromiumInstalled(root)).toBe(true);
  });

  it('仅有 chromium 目录但无标记 → 未完成', () => {
    fs.mkdirSync(join(root, 'chromium-1228', 'chrome-mac-arm64'), { recursive: true });
    expect(isChromiumInstalled(root)).toBe(false);
  });

  it('仅 headless_shell 带标记 → 不算 chromium 已装', () => {
    fs.mkdirSync(join(root, 'chromium_headless_shell-1228'), { recursive: true });
    fs.writeFileSync(join(root, 'chromium_headless_shell-1228', 'INSTALLATION_COMPLETE'), '');
    expect(isChromiumInstalled(root)).toBe(false);
  });

  it('目录不存在 → false', () => {
    expect(isChromiumInstalled('/no/such/dir')).toBe(false);
  });
});

describe('resolvePlaywrightCli', () => {
  it('packaged: 命中 app.asar.unpacked 下的 cli.js', () => {
    const res = fs.mkdtempSync(join(os.tmpdir(), 'res-'));
    const cli = join(res, 'app.asar.unpacked', 'node_modules', 'playwright', 'cli.js');
    fs.mkdirSync(join(cli, '..'), { recursive: true });
    fs.writeFileSync(cli, '// cli');
    expect(resolvePlaywrightCli(res)).toBe(cli);
    fs.rmSync(res, { recursive: true, force: true });
  });

  it('无 resourcesPath: 回退 require.resolve（dev）', () => {
    expect(resolvePlaywrightCli(undefined)).toMatch(/playwright[/\\]cli\.js$/);
  });
});

describe('parseInstallProgress', () => {
  it('百分比 + 总大小 → download 阶段', () => {
    const p = parseInstallProgress('|████████| 45% of 168.6 MiB');
    expect(p).toEqual({ phase: 'download', percent: 45, total: Math.round(168.6 * 1024 * 1024) });
  });
  it('Downloading Chromium → resolve 阶段', () => {
    expect(parseInstallProgress('Downloading Chromium 141.0.7390 (playwright build v1194)')).toEqual({ phase: 'resolve' });
  });
  it('无关行 → null', () => {
    expect(parseInstallProgress('some noise')).toBeNull();
  });
});

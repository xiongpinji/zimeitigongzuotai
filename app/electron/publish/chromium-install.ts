/**
 * Chromium 运行时按需安装（对标 biliup-install.ts）。
 *
 * Chromium 不再随安装包内置，改为运行时用捆绑的 playwright `cli.js install chromium`
 * 下载到用户可写目录 `<userData>/publish/chromium`（= PLAYWRIGHT_BROWSERS_PATH），
 * 与发布账号同处 userData，不触碰签名包。
 *
 * 下载源：使用 playwright 官方 CDN（cdn.playwright.dev，自带微软 prss 回退）。
 * 不再注入 npmmirror 镜像——playwright 1.61 起 chromium 改为 Chrome for Testing
 * 布局（builds/cft/...），npmmirror 不托管该路径会 404，且自定义 DOWNLOAD_HOST
 * 会同时禁用官方回退源。如需镜像，由使用方通过 PLAYWRIGHT_DOWNLOAD_HOST 环境变量覆盖。
 */
import { app } from 'electron';
import { join } from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';

export type ChromiumDownloadPhase = 'resolve' | 'download' | 'install';

export interface ChromiumDownloadProgress {
  phase: ChromiumDownloadPhase;
  percent?: number;
  received?: number;
  total?: number;
}

export interface ChromiumStatus {
  installed: boolean;
  path: string;
  executablePath?: string;
}

export interface DownloadChromiumResult {
  success: boolean;
  error?: string;
}

/** chromium 根目录（= PLAYWRIGHT_BROWSERS_PATH）。 */
export function getChromiumRoot(): string {
  return join(app.getPath('userData'), 'publish', 'chromium');
}

/**
 * 某个 chrome-xxx 子目录内的可执行相对路径（Chrome for Testing 布局，arch 由目录名携带）。
 * - win:   chrome-win64 内 chrome.exe（旧布局 chrome-win 也兼容）
 * - mac:   chrome-mac-arm64 / chrome-mac-x64 内 "Google Chrome for Testing.app"（旧布局 Chromium.app 也兼容）
 * - linux: chrome-linux64 内 chrome
 */
function execCandidates(chromeDir: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return [join(chromeDir, 'chrome.exe')];
  if (platform === 'darwin') {
    return [
      join(chromeDir, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      join(chromeDir, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ];
  }
  return [join(chromeDir, 'chrome')];
}

/** 列出 root 下已安装的 chromium-<rev> 目录，按 revision 从高到低。 */
function listChromiumRevDirs(root: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .map((name) => /^chromium-(\d+)$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map((m) => m[0]);
}

/**
 * 在 root 下定位已安装的完整 Chromium 可执行文件（排除 headless_shell）。
 * 适配 Chrome for Testing 布局：扫描 chromium-<rev> 下 chrome-xxx 子目录内的可执行文件。
 * 多版本取最高 revision；未命中返回 null（纯函数，便于单测）。
 */
export function findChromiumExecutable(
  root: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  for (const revDir of listChromiumRevDirs(root)) {
    const revPath = join(root, revDir);
    let children: string[];
    try {
      children = fs.readdirSync(revPath);
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.startsWith('chrome-')) continue;
      for (const exe of execCandidates(join(revPath, child), platform)) {
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

/**
 * 判断 root 下是否有“安装完成”的 chromium——以 playwright 写入的 INSTALLATION_COMPLETE
 * 标记为准（与 playwright 自身判定一致，跨平台/架构/布局变更稳定）。
 */
export function isChromiumInstalled(root: string): boolean {
  return listChromiumRevDirs(root).some((revDir) =>
    fs.existsSync(join(root, revDir, 'INSTALLATION_COMPLETE')),
  );
}

/** 定位捆绑的 playwright cli.js：packaged 用 app.asar.unpacked，否则 require.resolve。 */
export function resolvePlaywrightCli(
  resourcesPath: string | undefined = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
): string {
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'playwright', 'cli.js');
    if (fs.existsSync(packaged)) return packaged;
  }
  // dev 回退：playwright 的 exports 未暴露 './cli.js'，无法直接 require.resolve('playwright/cli.js')，
  // 经 package.json（已暴露）定位包根目录后拼出 cli.js。
  const pkgDir = join(require.resolve('playwright/package.json'), '..');
  return join(pkgDir, 'cli.js');
}

/** 解析 `playwright install` 单行输出 → 进度（容错：无法识别返回 null）。 */
export function parseInstallProgress(line: string): ChromiumDownloadProgress | null {
  const pct = /(\d{1,3})%/.exec(line);
  if (pct) {
    const percent = Math.min(100, Number(pct[1]));
    const tot = /of\s+([\d.]+)\s*MiB/i.exec(line);
    const total = tot ? Math.round(parseFloat(tot[1]) * 1024 * 1024) : undefined;
    return total != null ? { phase: 'download', percent, total } : { phase: 'download', percent };
  }
  if (/downloading chromium/i.test(line)) return { phase: 'resolve' };
  if (/install|extract/i.test(line)) return { phase: 'install' };
  return null;
}

/** 查询 Chromium 是否已安装到用户目录（以 INSTALLATION_COMPLETE 标记为准）。 */
export function getChromiumStatus(): ChromiumStatus {
  const root = getChromiumRoot();
  return {
    installed: isChromiumInstalled(root),
    path: root,
    executablePath: findChromiumExecutable(root) ?? undefined,
  };
}

/**
 * 下载并安装 Chromium 到用户目录。始终 resolve（不 reject），失败经 result.error 返回。
 * spawn 捆绑 playwright cli.js（ELECTRON_RUN_AS_NODE），镜像走 npmmirror。
 */
export function downloadChromium(
  onProgress?: (p: ChromiumDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadChromiumResult> {
  return new Promise((resolve) => {
    const root = getChromiumRoot();
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch {
      /* 目录创建失败下游会报错 */
    }
    let cli: string;
    try {
      cli = resolvePlaywrightCli();
    } catch (err) {
      resolve({ success: false, error: `未找到 playwright cli.js：${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    onProgress?.({ phase: 'resolve' });
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PLAYWRIGHT_BROWSERS_PATH: root,
      },
    });

    const onLine = (buf: Buffer) => {
      for (const line of buf.toString('utf-8').split(/\r?\n|\r/)) {
        if (!line.trim()) continue;
        const p = parseInstallProgress(line);
        if (p) onProgress?.(p);
      }
    };
    child.stdout?.on('data', onLine);
    child.stderr?.on('data', onLine);

    const onAbort = () => {
      child.kill();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        // 取消：清理半成品，保证可重试
        try {
          fs.rmSync(root, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        resolve({ success: false, error: '已取消' });
        return;
      }
      if (code === 0 && isChromiumInstalled(root)) {
        onProgress?.({ phase: 'install', percent: 100 });
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `安装失败（退出码 ${code}）` });
      }
    });
  });
}

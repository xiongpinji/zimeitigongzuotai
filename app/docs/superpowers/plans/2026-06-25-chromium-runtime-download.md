# Chromium 运行时按需下载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把发布视频用的 Chromium 从构建期随包改为运行时按需下载到用户目录，瘦身安装包，并在发布前检测/门控+统一进度。

**Architecture:** 新增 `chromium-install.ts`（对标现有 `biliup-install.ts`），用 `ELECTRON_RUN_AS_NODE` spawn 捆绑的 playwright `cli.js install chromium`，下载到 `userData/publish/chromium`（即 `PLAYWRIGHT_BROWSERS_PATH`），走 npmmirror 镜像。打包脚本不再安装/打包 `playwright-browsers`。运行时 `engine.ts` 指向用户目录并预检；IPC 三件套 + 发布账号 Tab 复用 biliup 的状态卡 / 门控 / 底部进度模式。

**Tech Stack:** Electron 41, playwright 1.61, React 19, TS, Vitest, electron-builder。

---

## 共享契约（LOCKED — 所有任务以此为准）

新文件 `electron/publish/chromium-install.ts` 导出：

```ts
export type ChromiumDownloadPhase = 'resolve' | 'download' | 'install';

export interface ChromiumDownloadProgress {
  phase: ChromiumDownloadPhase;
  percent?: number;   // 0-100，仅 download 阶段有；其余 indeterminate
  received?: number;  // 已下载字节（可缺）
  total?: number;     // 总字节（可缺）
}

export interface ChromiumStatus {
  installed: boolean;
  path: string;             // chromium 根目录（= PLAYWRIGHT_BROWSERS_PATH）
  executablePath?: string;  // 命中的可执行文件
}

export interface DownloadChromiumResult {
  success: boolean;
  error?: string;
}

export function getChromiumRoot(): string;
export function findChromiumExecutable(root: string, platform?: NodeJS.Platform): string | null;
export function resolvePlaywrightCli(resourcesPath?: string): string;
export function parseInstallProgress(line: string): ChromiumDownloadProgress | null;
export function getChromiumStatus(): ChromiumStatus;
export function downloadChromium(
  onProgress?: (p: ChromiumDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadChromiumResult>;
```

IPC 通道（`electron/publish/ipc.ts`）：
- `publish:chromium-status` → `ChromiumStatus`
- `publish:download-chromium` → `DownloadChromiumResult`，进度事件 `publish:chromium-download-progress`（payload = `ChromiumDownloadProgress`）
- `publish:cancel-chromium-download` → void

镜像环境变量：`PLAYWRIGHT_DOWNLOAD_HOST` 与 `PLAYWRIGHT_DOWNLOAD_BASE_URL` 同设为 `https://cdn.npmmirror.com/binaries/playwright`；`PLAYWRIGHT_BROWSERS_PATH` = `getChromiumRoot()`。

平台可执行相对路径（`findChromiumExecutable` 命中规则，目录名匹配 `^chromium-\d+$`，**排除** `chromium_headless_shell-*`）：
- `darwin`: `chrome-mac/Chromium.app/Contents/MacOS/Chromium`
- `win32`: `chrome-win/chrome.exe`
- `linux`: `chrome-linux/chrome`

---

## 文件结构与责任

| 文件 | 动作 | 责任 |
| --- | --- | --- |
| `electron/publish/chromium-install.ts` | 新建 | 状态检测 + 按需下载（spawn cli.js）+ 进度解析（核心模块） |
| `tests/publish/chromium-install.test.ts` | 新建 | 纯函数单测：检测 / cli 解析 / 进度解析 / 根目录 |
| `scripts/package-mac.cjs` | 改 | 删除随包安装 Chromium 步骤 |
| `scripts/package-windows.cjs` | 改 | 删除随包安装 Chromium 步骤 |
| `scripts/package-mac-helpers.cjs` | 改 | unpack 清单移除 `playwright-browsers`（保留 `playwright`/`playwright-core`） |
| `electron/publish/ipc.ts` | 改 | 新增 chromium status/download/cancel 三 IPC |
| `electron/preload.ts` | 改 | `publishAPI` 暴露 chromium 四方法 |
| `src/lib/electron-api.ts` | 改 | chromium 类型契约 |
| `electron/publish/engine.ts` | 改 | 运行时指向 userData/publish/chromium + 预检 |
| `src/components/settings/PublishAccountsTab.tsx` | 改 | Chromium 状态卡 + 发布前门控 + 底部进度 |

---

## 执行波次（并行）

- **Wave 1（并行，互不依赖）：Task 1（核心模块）、Task 2（打包脚本）**
- **Wave 2（并行，依赖 Wave 1 的 `chromium-install.ts`）：Task 3（IPC 三件套）、Task 4（engine）、Task 5（UI）**

每个 Task 拥有不相交的文件集合。子 agent **不要 git commit、不要跑 `npm run build`**（由编排者在每个波次结束统一构建并提交，避免 git/构建竞争）。Task 1 可单独跑自己的 vitest 文件。

---

### Task 1: chromium-install 核心模块（Wave 1）

**Files:**
- Create: `electron/publish/chromium-install.ts`
- Test: `tests/publish/chromium-install.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/publish/chromium-install.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/publish/chromium-install.test.ts`
Expected: FAIL（模块不存在 / 导出未定义）

- [ ] **Step 3: 实现核心模块**

`electron/publish/chromium-install.ts`：

```ts
/**
 * Chromium 运行时按需安装（对标 biliup-install.ts）。
 *
 * Chromium 不再随安装包内置，改为运行时用捆绑的 playwright `cli.js install chromium`
 * 下载到用户可写目录 `<userData>/publish/chromium`（= PLAYWRIGHT_BROWSERS_PATH），
 * 走 npmmirror 镜像加速；与发布账号同处 userData，不触碰签名包。
 */
import { app } from 'electron';
import { join } from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';

const MIRROR = 'https://cdn.npmmirror.com/binaries/playwright';

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

/** 各平台 chromium-<rev> 目录内的可执行相对路径。 */
function execRelPath(platform: NodeJS.Platform): string {
  if (platform === 'win32') return join('chrome-win', 'chrome.exe');
  if (platform === 'darwin') return join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
  return join('chrome-linux', 'chrome');
}

/**
 * 在 root 下定位已安装的完整 Chromium 可执行文件（排除 headless_shell）。
 * 多版本取最高 revision；未命中返回 null（纯函数，便于单测）。
 */
export function findChromiumExecutable(
  root: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return null;
  }
  const dirs = entries
    .map((name) => /^chromium-(\d+)$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const rel = execRelPath(platform);
  for (const m of dirs) {
    const exe = join(root, m[0], rel);
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

/** 定位捆绑的 playwright cli.js：packaged 用 app.asar.unpacked，否则 require.resolve。 */
export function resolvePlaywrightCli(
  resourcesPath: string | undefined = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
): string {
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'playwright', 'cli.js');
    if (fs.existsSync(packaged)) return packaged;
  }
  return require.resolve('playwright/cli.js');
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

/** 查询 Chromium 是否已安装到用户目录。 */
export function getChromiumStatus(): ChromiumStatus {
  const root = getChromiumRoot();
  const executablePath = findChromiumExecutable(root) ?? undefined;
  return { installed: executablePath != null, path: root, executablePath };
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
        PLAYWRIGHT_DOWNLOAD_HOST: MIRROR,
        PLAYWRIGHT_DOWNLOAD_BASE_URL: MIRROR,
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
      if (code === 0 && findChromiumExecutable(root)) {
        onProgress?.({ phase: 'install', percent: 100 });
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `安装失败（退出码 ${code}）` });
      }
    });
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/publish/chromium-install.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5（Wave 1 收尾由编排者执行）**：不在子 agent 内 commit。

---

### Task 2: 打包脚本停止随包 Chromium（Wave 1）

**Files:**
- Modify: `scripts/package-mac.cjs`（删除 `installPlaywrightChromium` 调用，约 line 179；可一并删除函数定义 line 140-153 或保留为未使用）
- Modify: `scripts/package-windows.cjs`（删除 `await installPlaywrightChromium(stageDir)` 调用，约 line 378；函数定义 line 286-293 同理）
- Modify: `scripts/package-mac-helpers.cjs`（unpack 清单 line 14 移除 `playwright-browsers`）

- [ ] **Step 1: 全仓定位所有 `playwright-browsers` 引用**

Run: `grep -rn "playwright-browsers\|installPlaywrightChromium" scripts/ package.json electron-builder* 2>/dev/null`
预期命中：两脚本的函数定义+调用、helpers 清单字符串。若 `package.json` 的 `build.asarUnpack` 或任何 electron-builder 配置里也含 `playwright-browsers`，一并在本任务移除（保留 `playwright`/`playwright-core`）。

- [ ] **Step 2: mac 脚本删除调用**

`scripts/package-mac.cjs` 删除第 179 行附近：

```js
  installPlaywrightChromium(stageDir);
```

并删除函数定义（line 140-153 的 `function installPlaywrightChromium(stageDir) { ... }` 及其上方注释块）。若 `execFileSync` 仅此处使用则其 import 保留无害，不强求清理。

- [ ] **Step 3: windows 脚本删除调用**

`scripts/package-windows.cjs` 删除第 378 行附近：

```js
  await installPlaywrightChromium(stageDir);
```

并删除函数定义（line 286-293 的 `async function installPlaywrightChromium(stageDir) { ... }` 及其上方注释块）。

- [ ] **Step 4: helpers 清单移除 playwright-browsers**

`scripts/package-mac-helpers.cjs` 第 14 行：把 `,playwright-browsers}` 去掉，保留 `node_modules/playwright,node_modules/playwright-core`。改后结尾应为 `...node_modules/node-pty}`。同时更新上方注释（line 10-11），把「+ playwright-browsers（随包 Chromium）」改为说明「Chromium 已改为运行时下载到 userData，不再随包」。

改后该常量为：

```js
const RENDER_RUNTIME_ASAR_UNPACK_DIRS = '{dist-cli,vendor/ffmpeg,node_modules/@earendil-works,node_modules/@mariozechner,node_modules/@remotion,node_modules/esbuild,node_modules/@esbuild,node_modules/@puppeteer,node_modules/puppeteer-core,node_modules/sharp,node_modules/onnxruntime-node,node_modules/ffmpeg-static,node_modules/ffprobe-static,node_modules/playwright,node_modules/playwright-core,node_modules/node-pty}';
```

- [ ] **Step 5: 语法校验**

Run: `node -c scripts/package-mac.cjs && node -c scripts/package-windows.cjs && node -c scripts/package-mac-helpers.cjs && echo OK`
Expected: `OK`（无语法错误）。

---

### Task 3: IPC 三件套（Wave 2，依赖 Task 1）

**Files:**
- Modify: `electron/publish/ipc.ts`
- Modify: `electron/preload.ts:733-784`
- Modify: `src/lib/electron-api.ts:694-726`

- [ ] **Step 1: ipc.ts 新增三个 handler**

`electron/publish/ipc.ts` 顶部 import 增加：

```ts
import { getChromiumStatus, downloadChromium } from './chromium-install';
```

在 `registerPublishIpc()` 内 biliup handler 之后追加：

```ts
  // ─── Chromium 运行时按需下载（抖音/视频号/小红书/快手自动化所需） ───────────────
  ipcMain.handle('publish:chromium-status', () => getChromiumStatus());

  let chromiumAbort: AbortController | null = null;
  ipcMain.handle('publish:download-chromium', async (e) => {
    if (chromiumAbort) {
      return { success: false, error: '正在下载中，请稍候' };
    }
    chromiumAbort = new AbortController();
    try {
      return await downloadChromium(
        (p) => e.sender.send('publish:chromium-download-progress', p),
        chromiumAbort.signal,
      );
    } finally {
      chromiumAbort = null;
    }
  });
  ipcMain.handle('publish:cancel-chromium-download', () => {
    chromiumAbort?.abort();
  });
```

- [ ] **Step 2: preload.ts 暴露四方法**

`electron/preload.ts` 在 `publishAPI` 对象内（`onBiliupDownloadProgress` 之后、闭合 `}` 之前）追加：

```ts
  getChromiumStatus: () => ipcRenderer.invoke('publish:chromium-status'),
  downloadChromium: () => ipcRenderer.invoke('publish:download-chromium'),
  cancelChromiumDownload: () => ipcRenderer.invoke('publish:cancel-chromium-download'),
  onChromiumDownloadProgress: (
    cb: (p: { phase: string; percent?: number; received?: number; total?: number }) => void,
  ) => {
    const handler = (
      _e: unknown,
      p: { phase: string; percent?: number; received?: number; total?: number },
    ) => cb(p);
    ipcRenderer.on('publish:chromium-download-progress', handler);
    return () => ipcRenderer.removeListener('publish:chromium-download-progress', handler);
  },
```

- [ ] **Step 3: electron-api.ts 类型契约**

`src/lib/electron-api.ts` 在 `PublishAPI` 接口内（`onBiliupDownloadProgress` 之后）追加：

```ts
  /** 查询 Chromium（playwright 浏览器）是否已安装到用户目录。 */
  getChromiumStatus(): Promise<ChromiumStatus>;
  /** 下载并安装 Chromium 到用户目录；过程经 onChromiumDownloadProgress 回报。 */
  downloadChromium(): Promise<ChromiumDownloadResult>;
  cancelChromiumDownload(): Promise<void>;
  onChromiumDownloadProgress(cb: (p: ChromiumDownloadProgress) => void): () => void;
```

并在 `BiliupDownloadProgress` 接口之后新增类型：

```ts
export interface ChromiumStatus {
  installed: boolean;
  path: string;
  executablePath?: string;
}

export interface ChromiumDownloadResult {
  success: boolean;
  error?: string;
}

export interface ChromiumDownloadProgress {
  phase: 'resolve' | 'download' | 'install' | string;
  percent?: number;
  received?: number;
  total?: number;
}
```

- [ ] **Step 4: 类型校验（由编排者在 Wave 2 收尾统一跑 `npm run build`）**

子 agent 内可跑：`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i chromium || echo "no chromium type errors"`（若项目 tsconfig 支持）；否则交编排者构建校验。

---

### Task 4: engine 运行时指向 + 预检（Wave 2，依赖 Task 1）

**Files:**
- Modify: `electron/publish/engine.ts`

- [ ] **Step 1: 改 ensurePlaywrightBrowsersPath 指向 userData**

`electron/publish/engine.ts` 把 `ensurePlaywrightBrowsersPath` 内设置路径那行从 `app.asar.unpacked/playwright-browsers` 改为用户目录。替换函数体内 packaged 分支：

```ts
  try {
    const { app } = await import('electron');
    if (!app.isPackaged) return; // 开发模式，playwright 用系统已安装浏览器
    const { join } = await import('node:path');
    // Chromium 改为运行时下载到 userData/publish/chromium（见 chromium-install.ts getChromiumRoot）
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(app.getPath('userData'), 'publish', 'chromium');
  } catch {
    // 非 Electron 运行时（理论上不会到这里），忽略
  }
```

（注意：顶部已 `import { join } from 'node:path'`，可直接用顶部 `join` 而非再 import；若用顶部 `join` 则删掉上面这行动态 import。保持与文件现有风格一致即可。）

- [ ] **Step 2: withContext 启动前预检**

`electron/publish/engine.ts` 顶部 import 增加：

```ts
import { getChromiumStatus } from './chromium-install';
```

在 `withContext` 内、`ensurePlaywrightBrowsersPath()` 之后、`await import('playwright')` 之前插入预检（仅生产路径，即未注入 `playwrightModule` 时）：

```ts
  if (!playwrightModule) {
    await ensurePlaywrightBrowsersPath();
    if (!getChromiumStatus().installed) {
      throw new Error('CHROMIUM_NOT_INSTALLED');
    }
  }
```

替换原来的：

```ts
  if (!playwrightModule) {
    await ensurePlaywrightBrowsersPath();
  }
```

> 注意：`getChromiumStatus` 顶层依赖 `import { app } from 'electron'`。engine.ts 现有测试通过注入 `playwrightModule` 走测试路径、不触发该分支；但顶层 import 会让 engine 在纯 node 测试下加载 electron。若 engine 已有测试且未 mock electron，请在该测试文件加 `vi.mock('electron', ...)`（同 Task 1 模式）。先 `grep -rl "from.*publish/engine" tests/` 确认。

- [ ] **Step 3: 校验**

Run: `grep -rl "publish/engine" tests/ || echo "no engine tests"`，若有则 `npx vitest run <该测试文件>`，确保仍通过（必要时补 electron mock）。否则交编排者 `npm run build` 校验。

---

### Task 5: 发布账号 Tab — 状态卡 + 门控 + 进度（Wave 2，依赖契约）

**Files:**
- Modify: `src/components/settings/PublishAccountsTab.tsx`

按 biliup 现有实现（state / effect / handler / 门控 / notice）原样镜像一份 chromium 版。

- [ ] **Step 1: 常量与平台集合**

文件顶部 `BILIUP_TASK_ID` 旁新增：

```ts
const CHROMIUM_TASK_ID = 'chromium-download';
// 需要 Chromium 自动化的平台（B 站走 biliup，不在此列）
const CHROMIUM_PLATFORMS = new Set<PublishPlatform>(['douyin', 'tencent', 'xiaohongshu', 'kuaishou']);
```

（`PublishPlatform` 的取值以本文件已 import 的类型为准；若实际平台标识不同，以 `PLATFORM_OPTIONS` / `PLATFORM_LABEL` 的 key 为准对齐。）

- [ ] **Step 2: 组件内 state**

在 `biliupDownloading` state 之后新增：

```tsx
  // Chromium 自动化组件安装状态：null=未知/检测中
  const [chromiumInstalled, setChromiumInstalled] = useState<boolean | null>(null);
  const [chromiumDownloading, setChromiumDownloading] = useState(false);
```

- [ ] **Step 3: 选中相关平台时检测**

在 biliup 检测 effect 之后新增：

```tsx
  // 选中需要 Chromium 的平台时检测是否已安装
  useEffect(() => {
    if (!CHROMIUM_PLATFORMS.has(platform)) return;
    let cancelled = false;
    setChromiumInstalled(null);
    window.publishAPI
      .getChromiumStatus()
      .then((s) => {
        if (!cancelled) setChromiumInstalled(s.installed);
      })
      .catch(() => {
        if (!cancelled) setChromiumInstalled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform]);
```

- [ ] **Step 4: 下载 handler（复用底部进度）**

在 `handleDownloadBiliup` 之后新增：

```tsx
  const handleDownloadChromium = async () => {
    const { startTask, updateTask, completeTask, failTask } = useTaskProgressStore.getState();
    setChromiumDownloading(true);
    startTask({
      id: CHROMIUM_TASK_ID,
      category: 'publish',
      label: '下载浏览器组件（Chromium）',
      mode: 'indeterminate',
      progress: 0,
      phase: '准备中',
      level: 0,
      canCancel: false,
    });
    const unsub = window.publishAPI.onChromiumDownloadProgress((p) => {
      if (p.phase === 'download' && typeof p.percent === 'number') {
        updateTask(CHROMIUM_TASK_ID, {
          mode: 'determinate',
          progress: Math.min(100, Math.round(p.percent)),
          phase: p.total ? `下载中 · 共 ${formatMB(p.total)}` : '下载中',
        });
      } else {
        const phaseLabel = p.phase === 'resolve' ? '解析版本' : p.phase === 'install' ? '安装中' : '下载中';
        updateTask(CHROMIUM_TASK_ID, { mode: 'indeterminate', phase: phaseLabel });
      }
    });
    try {
      const res = await window.publishAPI.downloadChromium();
      if (res.success) {
        completeTask(CHROMIUM_TASK_ID);
        setChromiumInstalled(true);
        setLoginMsg({ text: '浏览器组件安装完成，可以登录/发布了', isError: false });
      } else {
        failTask(CHROMIUM_TASK_ID, res.error || '下载失败');
        setLoginMsg({ text: res.error || '浏览器组件下载失败', isError: true });
      }
    } catch (err: unknown) {
      failTask(CHROMIUM_TASK_ID, err instanceof Error ? err.message : '下载异常');
      setLoginMsg({ text: err instanceof Error ? err.message : '下载异常', isError: true });
    } finally {
      unsub();
      setChromiumDownloading(false);
    }
  };
```

- [ ] **Step 5: 门控变量 + 登录按钮 disabled**

在 `const biliupMissing = ...`（约 line 270）旁新增：

```tsx
  // 需要 Chromium 的平台：未安装时禁用登录，引导先下载
  const chromiumMissing = CHROMIUM_PLATFORMS.has(platform) && chromiumInstalled === false;
```

把登录按钮（约 line 376）的 `disabled={loginBusy || biliupMissing}` 改为：

```tsx
            disabled={loginBusy || biliupMissing || chromiumMissing}
```

- [ ] **Step 6: Chromium notice 区块**

在 biliup notice 区块（约 line 389-411 的 `{biliupMissing ? (...) : null}`）之后新增并列区块（复用 `styles.biliupNotice` 等同款样式类，沿用 `Download`/`Spinner` 图标）：

```tsx
        {chromiumMissing ? (
          <div className={styles.biliupNotice}>
            <span className={styles.biliupNoticeText}>
              抖音 / 视频号 / 小红书 / 快手发布需要浏览器组件（Chromium），首次使用请先下载（约 150MB，已走国内镜像加速）。
            </span>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => void handleDownloadChromium()}
              disabled={chromiumDownloading}
              leftIcon={
                chromiumDownloading ? (
                  <Spinner size={12} className={styles.spinning} />
                ) : (
                  <Download size={12} />
                )
              }
            >
              {chromiumDownloading ? '下载中…' : '下载浏览器组件'}
            </Button>
          </div>
        ) : null}
```

- [ ] **Step 7: 校验（交编排者统一构建）**

`npm run build` 通过、发布账号 Tab 渲染正常；选中抖音且未安装 Chromium 时登录禁用并出现下载提示。

---

## Wave 收尾（编排者执行，非子 agent）

- [ ] Wave 1 完成后：`npx vitest run tests/publish/chromium-install.test.ts` 通过；`node -c` 三脚本通过；`git add` 相关文件并提交 `feat(publish): Chromium 运行时下载核心模块 + 打包脚本停止随包`。
- [ ] Wave 2 完成后：`npm run build` 通过（类型契约一致、UI 编译通过）；`npx vitest run`（发布相关）通过；提交 `feat(publish): Chromium 按需下载 IPC + 运行时预检 + 发布账号 Tab 门控`。
- [ ] 最终：更新 `CHANGELOG.md` 与 Release notes（项目规则：发版必须同步）。

---

## Self-Review

**Spec 覆盖：** ① 不随包打包 Chromium → Task 2；② 设置中心按需下载 → Task 3+5；③ 跨平台 → Task 1 `execRelPath`/`resolvePlaywrightCli` 覆盖 darwin/win32/linux + npmmirror；④ 发布前检测+门控 → Task 4 预检 + Task 5 门控；⑤ 统一进度 → Task 5 task-progress。全覆盖。

**占位符：** 无 TBD/TODO；每个改动给出具体代码。

**类型一致：** `ChromiumStatus` / `ChromiumDownloadProgress` / `DownloadChromiumResult` 在 Task 1（实现）、Task 3（preload 字面量 + electron-api 类型）、Task 5（UI 消费）三处字段一致（`installed/path/executablePath`、`phase/percent/received/total`、`success/error`）。IPC 通道名三处一致（`publish:chromium-status` / `publish:download-chromium` / `publish:cancel-chromium-download` / `publish:chromium-download-progress`）。

**风险：** ① engine.ts 顶层 import chromium-install 引入 electron，需确认 engine 测试有 electron mock（Task 4 Step 2 已标注）；② `parseInstallProgress` 格式随 playwright 版本可能变，已容错降级；③ packaged cli.js 路径靠 `resolvePlaywrightCli` fallback，留打包实机验收。

/**
 * biliup 运行时按需安装。
 *
 * biliup 二进制不再随安装包内置，改为运行时从 GitHub release 按需下载到
 * 用户可写目录（`<userData>/publish/biliup/<平台key>/<biliup|biliup.exe>`），
 * 与发布账号同处 `userData/publish/` 下，三端可写、不触碰签名包。
 *
 * 下载策略（用户决策）：代理优先 + GitHub 兜底。
 *   1. 解析资产：优先调 GitHub releases API 拿到当前平台「带版本号」的资产名与
 *      下载 URL；API 不可达（国内常见）时回退到内置 pin 版本构造直链。
 *   2. 下载二进制：把 github.com 下载 URL 依次套上代理前缀（ghproxy 类）尝试，
 *      全部失败再回退官方直连。
 *
 * 资产命名（已实测 biliup/biliup releases）：
 *   biliupR-v1.2.1-x86_64-macos.tar.xz
 *   biliupR-v1.2.1-aarch64-macos.tar.xz
 *   biliupR-v1.2.1-x86_64-windows.zip   等
 */

import { app } from 'electron';
import { join, dirname, basename } from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as https from 'node:https';
import { execFileSync } from 'node:child_process';
import * as yauzl from 'yauzl';
import { buildPlatformKey, biliupBinaryName, resolveBiliupPath } from './biliup-runtime';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const GITHUB_RELEASE_API = 'https://api.github.com/repos/biliup/biliup/releases/latest';

/** 兜底 pin 版本：API 不可达时用它构造直链（实测可下载）。 */
const PINNED_TAG = 'v1.2.1';

/**
 * GitHub release 代理候选（前缀式：`<proxy><完整 github URL>`）。
 * 代理优先依次尝试，全部失败后回退官方直连。
 */
const PROXY_CANDIDATES = [
  'https://ghproxy.net/',
  'https://mirror.ghproxy.com/',
  'https://ghproxy.com/',
];

/** key = buildPlatformKey() 输出，value = 资产文件名中必须包含的子串（也用于 pin 直链）。 */
const ASSET_PATTERNS: Record<string, string> = {
  'windows-x86_64': 'x86_64-windows.zip',
  'linux-x86_64': 'x86_64-linux.tar.xz',
  'linux-aarch64': 'aarch64-linux.tar.xz',
  'linux-arm': 'arm-linux.tar.xz',
  'macos-x86_64': 'x86_64-macos.tar.xz',
  'macos-aarch64': 'aarch64-macos.tar.xz',
};

// ---------------------------------------------------------------------------
// 纯函数（import-safe，便于单测）
// ---------------------------------------------------------------------------

export interface ResolvedAsset {
  assetName: string;
  downloadUrl: string;
}

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

/**
 * 从 release assets 列表里挑出当前平台的资产。
 * 与构建期脚本 selectAsset 逻辑保持一致（子串匹配，避开 *-musl 误命中）。
 */
export function selectAsset(assets: ReleaseAsset[], platformKey: string): ResolvedAsset {
  const pattern = ASSET_PATTERNS[platformKey];
  if (!pattern) {
    throw new Error(
      `不支持的 biliup 平台: ${platformKey}。支持: ${Object.keys(ASSET_PATTERNS).join(', ')}`,
    );
  }
  const asset = assets.find((a) => (a.name || '').includes(pattern));
  if (!asset || !asset.browser_download_url) {
    throw new Error(
      `未找到匹配的 biliup release 资产（平台: ${platformKey}，pattern: ${pattern}）`,
    );
  }
  return { assetName: asset.name as string, downloadUrl: asset.browser_download_url };
}

/**
 * 用 pin 版本构造资产名与官方直链（API 不可达时的兜底）。
 * 命名模板：`biliupR-<tag>-<pattern>`，例如 biliupR-v1.2.1-aarch64-macos.tar.xz。
 */
export function pinnedAsset(platformKey: string, tag: string = PINNED_TAG): ResolvedAsset {
  const pattern = ASSET_PATTERNS[platformKey];
  if (!pattern) {
    throw new Error(`不支持的 biliup 平台: ${platformKey}`);
  }
  const assetName = `biliupR-${tag}-${pattern}`;
  const downloadUrl = `https://github.com/biliup/biliup/releases/download/${tag}/${assetName}`;
  return { assetName, downloadUrl };
}

/** 把 github.com 下载 URL 套上代理前缀。 */
export function withProxy(proxyBase: string, url: string): string {
  return `${proxyBase}${url}`;
}

/**
 * 按「代理优先 + 官方兜底」生成候选下载 URL 列表。
 * 顺序：所有代理前缀（按候选顺序）→ 官方直链。
 */
export function buildDownloadCandidates(downloadUrl: string): string[] {
  return [...PROXY_CANDIDATES.map((p) => withProxy(p, downloadUrl)), downloadUrl];
}

// ---------------------------------------------------------------------------
// 安装位置（依赖 electron app，非纯函数）
// ---------------------------------------------------------------------------

/**
 * biliup 安装根目录（= destRoot）。二进制最终落在
 * `<root>/biliup/<平台key>/<binary>`，与 resolveBiliupPath(root) 对齐。
 */
export function getBiliupDestRoot(): string {
  return join(app.getPath('userData'), 'publish');
}

export interface BiliupStatus {
  installed: boolean;
  path: string;
}

/** 查询 biliup 是否已安装到用户目录。 */
export function getBiliupStatus(): BiliupStatus {
  const path = resolveBiliupPath(getBiliupDestRoot());
  let installed = false;
  try {
    installed = fs.statSync(path).isFile();
  } catch {
    installed = false;
  }
  return { installed, path };
}

// ---------------------------------------------------------------------------
// HTTP（Node 内置 https，支持重定向）
// ---------------------------------------------------------------------------

function httpsGetBuffer(url: string, redirectCount = 0): Promise<Buffer> {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`重定向次数超过上限: ${url}`));
  }
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'lingji-biliup-install', Accept: 'application/vnd.github+json' } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          resolve(httpsGetBuffer(res.headers.location, redirectCount + 1));
          return;
        }
        if (status !== 200) {
          reject(new Error(`HTTP ${status} from ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}

export interface DownloadProgress {
  phase: 'resolve' | 'download' | 'extract' | 'install';
  /** 已下载字节数 */
  received?: number;
  /** 总字节数（content-length，可能缺失） */
  total?: number;
  /** 瞬时下载速度（字节/秒） */
  speed?: number;
}

function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (p: DownloadProgress) => void,
  redirectCount = 0,
  signal?: AbortSignal,
): Promise<void> {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`重定向次数超过上限: ${url}`));
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('已取消'));
      return;
    }
    let onAbort: (() => void) | null = null;
    const cleanup = () => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = (err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const req = https.get(url, { headers: { 'User-Agent': 'lingji-biliup-install' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        cleanup();
        resolve(downloadToFile(res.headers.location, destPath, onProgress, redirectCount + 1, signal));
        return;
      }
      if (status !== 200) {
        fail(new Error(`HTTP ${status} 下载 ${url}`));
        return;
      }
      const total = Number(res.headers['content-length']) || undefined;
      let received = 0;
      // 节流：最多每 200ms 上报一次，并据上次上报计算瞬时速度，避免刷屏 / 小文件秒下看不到过程
      let lastTs = Date.now();
      let lastBytes = 0;
      const out = fs.createWriteStream(destPath);
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        const now = Date.now();
        const dt = now - lastTs;
        if (dt >= 200) {
          const speed = dt > 0 ? ((received - lastBytes) * 1000) / dt : 0;
          onProgress?.({ phase: 'download', received, total, speed });
          lastTs = now;
          lastBytes = received;
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        // 收尾再补一帧 100%，确保 UI 不停在中途百分比
        onProgress?.({ phase: 'download', received, total: total ?? received, speed: 0 });
        ok();
      });
      out.on('error', fail);
      res.on('error', fail);
    });
    req.on('error', fail);
    if (signal) {
      onAbort = () => req.destroy(new Error('已取消'));
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// ---------------------------------------------------------------------------
// 解压
// ---------------------------------------------------------------------------

function extractTarXz(archivePath: string, extractDir: string): void {
  execFileSync('tar', ['-xJf', archivePath, '-C', extractDir], { stdio: 'ignore' });
}

function extractZip(archivePath: string, extractDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('zip 打开失败'));
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const entryPath = join(extractDir, entry.fileName);
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(entryPath, { recursive: true });
          zipfile.readEntry();
        } else {
          fs.mkdirSync(dirname(entryPath), { recursive: true });
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr || !readStream) return reject(streamErr ?? new Error('zip 读取失败'));
            const out = fs.createWriteStream(entryPath);
            readStream.pipe(out);
            out.on('finish', () => zipfile.readEntry());
            out.on('error', reject);
          });
        }
      });
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
    });
  });
}

/** 在解压目录里定位 biliup 可执行文件（biliup / biliupR 等，取路径最短者）。 */
function findBiliupExecutable(extractDir: string): string {
  const targets = new Set(['biliup', 'biliup.exe', 'biliupr', 'biliupr.exe']);
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (targets.has(entry.name.toLowerCase())) results.push(full);
    }
  };
  walk(extractDir);
  if (results.length === 0) throw new Error('解压目录中未找到 biliup 可执行文件');
  results.sort((a, b) => a.length - b.length);
  return results[0];
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/** 解析当前平台资产：API 优先（代理→直连），失败回退 pin 直链。 */
async function resolveAsset(platformKey: string, signal?: AbortSignal): Promise<ResolvedAsset> {
  const apiCandidates = [
    ...PROXY_CANDIDATES.map((p) => withProxy(p, GITHUB_RELEASE_API)),
    GITHUB_RELEASE_API,
  ];
  for (const apiUrl of apiCandidates) {
    if (signal?.aborted) break;
    try {
      const buf = await httpsGetBuffer(apiUrl);
      const release = JSON.parse(buf.toString('utf-8')) as { assets?: ReleaseAsset[] };
      if (release.assets && release.assets.length > 0) {
        return selectAsset(release.assets, platformKey);
      }
    } catch {
      // 试下一个候选
    }
  }
  // 全部失败 → pin 兜底
  return pinnedAsset(platformKey);
}

export interface DownloadBiliupResult {
  success: boolean;
  path?: string;
  error?: string;
}

/**
 * 下载并安装 biliup 到用户目录。始终 resolve（不 reject），失败经 result.error 返回。
 * @param onProgress 进度回调（resolve / download / extract / install 各阶段）。
 * @param signal 取消信号；中途 abort 时清理临时文件并以 error='已取消' 返回。
 */
export async function downloadBiliup(
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadBiliupResult> {
  const platform = process.platform;
  const platformKey = buildPlatformKey();
  const isWindows = biliupBinaryName(platform) === 'biliup.exe';
  const destRoot = getBiliupDestRoot();
  const binaryDest = resolveBiliupPath(destRoot);
  const binaryDestDir = dirname(binaryDest);

  const tmpDir = await fsp.mkdtemp(join(os.tmpdir(), 'lingji-biliup-dl-'));
  try {
    if (signal?.aborted) throw new Error('已取消');
    onProgress?.({ phase: 'resolve' });
    const { assetName, downloadUrl } = await resolveAsset(platformKey, signal);

    // 代理优先依次尝试下载
    const archivePath = join(tmpDir, basename(assetName));
    const candidates = buildDownloadCandidates(downloadUrl);
    let downloaded = false;
    let lastErr: unknown = null;
    for (const url of candidates) {
      if (signal?.aborted) break;
      try {
        await downloadToFile(url, archivePath, onProgress, 0, signal);
        downloaded = true;
        break;
      } catch (err) {
        if (signal?.aborted) throw err; // 取消则不再尝试其他候选
        lastErr = err;
      }
    }
    if (signal?.aborted) throw new Error('已取消');
    if (!downloaded) {
      throw new Error(
        `下载失败（代理与直连均不可达）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      );
    }

    // 解压
    onProgress?.({ phase: 'extract' });
    const extractDir = join(tmpDir, 'extract');
    await fsp.mkdir(extractDir, { recursive: true });
    if (assetName.endsWith('.zip')) {
      await extractZip(archivePath, extractDir);
    } else {
      extractTarXz(archivePath, extractDir);
    }

    // 安装
    onProgress?.({ phase: 'install' });
    const extractedBinary = findBiliupExecutable(extractDir);
    await fsp.mkdir(binaryDestDir, { recursive: true });
    await fsp.copyFile(extractedBinary, binaryDest);
    if (!isWindows) {
      await fsp.chmod(binaryDest, 0o755);
    }

    return { success: true, path: binaryDest };
  } catch (err) {
    if (signal?.aborted) return { success: false, error: '已取消' };
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

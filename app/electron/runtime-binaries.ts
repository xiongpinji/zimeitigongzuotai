import { existsSync } from 'node:fs';
import path from 'node:path';

export interface RuntimeBinaryResolutionOptions {
  appPath: string;
  resourcesPath: string;
  cwd: string;
  moduleDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  existsSync?: (candidate: string) => boolean;
  readdirSync?: (candidate: string) => string[];
}

function appAsarUnpackedPath(appPath: string): string | null {
  if (!appPath.includes('app.asar')) return null;
  return appPath.replace(/app\.asar(?:[/\\].*)?$/, 'app.asar.unpacked');
}

function ffmpegRelativePaths(platform: NodeJS.Platform, arch: string): string[] {
  if (platform === 'win32') {
    return [
      path.join('vendor', 'ffmpeg', 'win32', arch, 'ffmpeg.exe'),
      path.join('node_modules', '@ffmpeg-installer', `win32-${arch}`, 'ffmpeg.exe'),
      path.join('node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    ];
  }

  return [path.join('node_modules', 'ffmpeg-static', 'ffmpeg')];
}

function ffprobeRelativePaths(platform: NodeJS.Platform, arch: string): string[] {
  // @ffprobe-installer 按 <platform>-<arch> 发布真原生二进制（含 darwin-arm64），
  // 与 @ffmpeg-installer 同系列布局；取代仅含 x86_64 的 ffprobe-static。
  const binary = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  return [path.join('node_modules', '@ffprobe-installer', `${platform}-${arch}`, binary)];
}

function gsapRelativePath(): string {
  return path.join('node_modules', 'gsap', 'dist', 'gsap.min.js');
}

function candidateRoots(options: RuntimeBinaryResolutionOptions): string[] {
  const roots: string[] = [];
  const unpackedAppPath = appAsarUnpackedPath(options.appPath);
  if (unpackedAppPath) roots.push(unpackedAppPath);
  if (options.resourcesPath) roots.push(path.join(options.resourcesPath, 'app.asar.unpacked'));
  roots.push(options.appPath);
  roots.push(options.cwd);
  roots.push(path.resolve(options.moduleDir, '..'));
  return Array.from(new Set(roots));
}

function findFirstExisting(
  relativePath: string,
  options: RuntimeBinaryResolutionOptions,
): string | null {
  const hasFile = options.existsSync ?? existsSync;
  return (
    candidateRoots(options)
      .map((root) => path.join(root, relativePath))
      .find((candidate) => hasFile(candidate)) ?? null
  );
}

function findFirstExistingFromList(
  relativePaths: string[],
  options: RuntimeBinaryResolutionOptions,
): string | null {
  for (const relativePath of relativePaths) {
    const hit = findFirstExisting(relativePath, options);
    if (hit) return hit;
  }
  return null;
}

export function resolveFfmpegPath(options: RuntimeBinaryResolutionOptions): string | null {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  return findFirstExistingFromList(ffmpegRelativePaths(platform, arch), options);
}

export function resolveFfprobePath(options: RuntimeBinaryResolutionOptions): string | null {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  return findFirstExistingFromList(ffprobeRelativePaths(platform, arch), options);
}

export function resolveGsapPath(options: RuntimeBinaryResolutionOptions): string | null {
  return findFirstExisting(gsapRelativePath(), options);
}

function parseVersionSegments(versionDir: string): number[] | null {
  const dashIndex = versionDir.indexOf('-');
  const versionPart = dashIndex >= 0 ? versionDir.slice(dashIndex + 1) : versionDir;
  const parsed = versionPart
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .filter((segment) => Number.isFinite(segment));
  return parsed.length > 0 ? parsed : null;
}

function compareVersionDirsDescending(left: string, right: string): number {
  const leftParts = parseVersionSegments(left);
  const rightParts = parseVersionSegments(right);
  if (!leftParts && !rightParts) return 0;
  if (!leftParts) return 1;
  if (!rightParts) return -1;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  return 0;
}

function chromeCacheCandidates(
  cacheDir: string,
  platform: NodeJS.Platform,
  arch: string,
  readdirSync: (candidate: string) => string[],
): string[] {
  let versions: string[];
  try {
    versions = readdirSync(cacheDir).sort(compareVersionDirsDescending);
  } catch {
    return [];
  }

  const binaryName = platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  const platformFolders =
    platform === 'darwin'
      ? [arch === 'arm64' ? 'chrome-headless-shell-mac-arm64' : 'chrome-headless-shell-mac-x64']
      : platform === 'win32'
        ? ['chrome-headless-shell-win64']
        : ['chrome-headless-shell-linux64'];

  return versions.flatMap((version) =>
    platformFolders.map((folder) => path.join(cacheDir, version, folder, binaryName)),
  );
}

function systemChromeCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }
  if (platform === 'win32') {
    const roots = [
      env.PROGRAMFILES,
      env['PROGRAMFILES(X86)'],
      env.LOCALAPPDATA,
    ].filter((value): value is string => Boolean(value));
    return roots.flatMap((root) => [
      path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(root, 'Chromium', 'Application', 'chrome.exe'),
    ]);
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

export interface RuntimeBrowserResolution {
  executablePath: string;
  source: 'env' | 'cache' | 'system';
}

export function resolveChromePath(
  options: RuntimeBinaryResolutionOptions,
): RuntimeBrowserResolution | null {
  const hasFile = options.existsSync ?? existsSync;
  const readDir = options.readdirSync;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const homeDir = options.homeDir;

  for (const envName of ['HYPERFRAMES_BROWSER_PATH', 'PRODUCER_HEADLESS_SHELL_PATH']) {
    const envPath = env[envName];
    if (envPath && hasFile(envPath)) return { executablePath: envPath, source: 'env' };
  }

  if (homeDir && readDir) {
    const cacheRoots = [
      path.join(homeDir, '.cache', 'hyperframes', 'chrome'),
      path.join(homeDir, '.cache', 'puppeteer', 'chrome-headless-shell'),
    ];
    for (const cacheRoot of cacheRoots) {
      const hit = chromeCacheCandidates(cacheRoot, platform, arch, readDir).find((candidate) =>
        hasFile(candidate),
      );
      if (hit) return { executablePath: hit, source: 'cache' };
    }
  }

  const systemHit = systemChromeCandidates(platform, env).find((candidate) => hasFile(candidate));
  return systemHit ? { executablePath: systemHit, source: 'system' } : null;
}

export function buildPathWithRuntimeBinaries(
  envPath: string | undefined,
  binaryPaths: Array<string | null | undefined>,
): string {
  const dirs = binaryPaths
    .filter((binaryPath): binaryPath is string => Boolean(binaryPath))
    .map((binaryPath) => path.dirname(binaryPath));
  const parts = [...new Set(dirs)];
  if (envPath) parts.push(envPath);
  return parts.join(path.delimiter);
}

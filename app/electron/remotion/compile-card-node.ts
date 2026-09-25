import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { transform as esbuildTransform } from 'esbuild';

const requireFromHere = createRequire(import.meta.url);

type EsbuildModule = {
  transform: typeof esbuildTransform;
};

type CompileErrorsReporter = (errors: CompiledCard[], total: number) => void;

const ESBUILD_BINARY_PACKAGES: Partial<Record<NodeJS.Platform, Partial<Record<string, string>>>> = {
  darwin: {
    arm64: '@esbuild/darwin-arm64',
    x64: '@esbuild/darwin-x64',
  },
  win32: {
    arm64: '@esbuild/win32-arm64',
    ia32: '@esbuild/win32-ia32',
    x64: '@esbuild/win32-x64',
  },
  linux: {
    arm: '@esbuild/linux-arm',
    arm64: '@esbuild/linux-arm64',
    ia32: '@esbuild/linux-ia32',
    loong64: '@esbuild/linux-loong64',
    mips64el: '@esbuild/linux-mips64el',
    ppc64: '@esbuild/linux-ppc64',
    riscv64: '@esbuild/linux-riscv64',
    s390x: '@esbuild/linux-s390x',
    x64: '@esbuild/linux-x64',
  },
};

let cachedEsbuild: EsbuildModule | null = null;

export interface PackagedEsbuildRuntime {
  nodeModulesDir: string;
  esbuildPackageDir: string;
  binaryPath?: string;
}

function getEsbuildBinaryPackageName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  return ESBUILD_BINARY_PACKAGES[platform]?.[arch] ?? null;
}

export function resolvePackagedEsbuildRuntime(options: {
  resourcesPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  existsSync?: (candidate: string) => boolean;
} = {}): PackagedEsbuildRuntime | null {
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const existsSync = options.existsSync ?? fs.existsSync;
  if (!resourcesPath) return null;

  const nodeModulesDir = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules');
  if (!existsSync(nodeModulesDir)) return null;

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const packageName = getEsbuildBinaryPackageName(platform, arch);
  const binaryName = platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild';
  const esbuildPackageDir = path.join(nodeModulesDir, 'esbuild');
  if (!packageName) return { nodeModulesDir, esbuildPackageDir };
  const binaryPath = path.join(nodeModulesDir, ...packageName.split('/'), binaryName);
  return {
    nodeModulesDir,
    esbuildPackageDir,
    binaryPath: existsSync(binaryPath) ? binaryPath : undefined,
  };
}

function loadEsbuild(): EsbuildModule {
  if (cachedEsbuild) return cachedEsbuild;

  const packagedRuntime = resolvePackagedEsbuildRuntime();
  if (packagedRuntime) {
    if (packagedRuntime.binaryPath) {
      process.env.ESBUILD_BINARY_PATH = packagedRuntime.binaryPath;
    }

    if (fs.existsSync(packagedRuntime.esbuildPackageDir)) {
      cachedEsbuild = requireFromHere(packagedRuntime.esbuildPackageDir) as EsbuildModule;
      return cachedEsbuild;
    }
  }

  cachedEsbuild = requireFromHere('esbuild') as EsbuildModule;
  return cachedEsbuild;
}

export interface CompiledCard {
  overlayId: string;
  js?: string;
  error?: string;
}

/**
 * 把单段 Motion Card TSX 编译为 CJS 模块字符串。
 * react / react/jsx-runtime / remotion 设为运行时注入（不打包），
 * 由渲染侧 / 导出侧的 require 垫片提供，保证与宿主共享同一 React + Remotion 实例，
 * useCurrentFrame 等 hooks 才能在 Remotion 渲染上下文内正常工作。
 */
export async function compileCardTsx(overlayId: string, tsx: string): Promise<CompiledCard> {
  const source = (tsx ?? '').trim();
  if (!source) return { overlayId, error: 'Motion Card TSX 为空' };
  try {
    const result = await loadEsbuild().transform(source, {
      loader: 'tsx',
      format: 'cjs',
      jsx: 'automatic',
      target: 'es2020',
      sourcemap: false,
      logLevel: 'silent',
    });
    return { overlayId, js: result.code };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { overlayId, error: message };
  }
}

/** 批量编译，返回 overlayId → 编译后 JS 的映射（失败项记录 error 但不抛）。 */
export async function compileCards(
  cards: { overlayId: string; tsx: string }[],
  options: { onCompileErrors?: CompileErrorsReporter } = {},
): Promise<Record<string, string>> {
  const compiled = await Promise.all(cards.map((c) => compileCardTsx(c.overlayId, c.tsx)));
  const map: Record<string, string> = {};
  const errors: CompiledCard[] = [];
  for (const c of compiled) {
    if (c.js) {
      map[c.overlayId] = c.js;
    } else if (c.error) {
      errors.push(c);
    }
  }
  if (errors.length > 0) {
    options.onCompileErrors?.(errors, cards.length);
  }
  return map;
}

import { describe, expect, it } from 'vitest';
import config from '../electron.vite.config';

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

type MainLibShape = {
  entry?: unknown;
  formats?: unknown;
  fileName?: unknown;
};

describe('electron-vite build config', () => {
  it('keeps dist-electron artifacts when rebuilding main and preload', () => {
    expect(config.main?.build?.outDir).toBe('dist-electron');
    expect(config.preload?.build?.outDir).toBe('dist-electron');
    expect(config.main?.build?.emptyOutDir).toBe(false);
    expect(config.preload?.build?.emptyOutDir).toBe(false);
  });

  // Q2-R3a：main 构建入口改为单实例薄入口；electron/main.ts 变为第二入口，
  // 只能被薄入口动态 import（多入口构造上禁止 inlineDynamicImports，
  // bundler 无法把 main.ts 顶层副作用静默压平进 main.js）。
  it('builds main from the thin single-instance entry with the runtime as a second entry', () => {
    const lib = config.main?.build?.lib as MainLibShape | undefined;
    expect(lib).toBeTruthy();
    const entry = lib?.entry;
    expect(typeof entry).toBe('object');
    expect(Array.isArray(entry)).toBe(false);
    const entryRecord = entry as Record<string, string>;
    expect(normalizeSlashes(entryRecord.main)).toMatch(/electron\/single-instance-entry\.ts$/);
    expect(normalizeSlashes(entryRecord['app-main'])).toMatch(/electron\/main\.ts$/);
    expect(lib?.formats).toEqual(['cjs']);
  });

  it('keeps the packaged main artifact at dist-electron/main.js', () => {
    const lib = config.main?.build?.lib as MainLibShape | undefined;
    const fileName = lib?.fileName;
    expect(typeof fileName).toBe('function');
    const resolveName = fileName as (format: string, entryName: string) => string;
    // package.json "main" 仍指向 dist-electron/main.js（薄入口产物）
    expect(resolveName('cjs', 'main')).toBe('main.js');
    // 主运行时产物名固定，供构建后核验动态加载顺序与 chunk 完整性
    expect(resolveName('cjs', 'app-main')).toBe('app-main.js');
  });

  it('explicitly forbids inlining dynamic imports in the main build', () => {
    const rollupOptions = config.main?.build?.rollupOptions as
      | { output?: Record<string, unknown>; external?: unknown }
      | undefined;
    expect(rollupOptions?.output?.inlineDynamicImports).toBe(false);
    // 既有 external 契约保持不变
    expect(rollupOptions?.external).toEqual(['zod', 'node-pty', /^@earendil-works\//]);
  });

  it('keeps preload and renderer contracts unchanged', () => {
    const preloadLib = config.preload?.build?.lib as MainLibShape | undefined;
    expect(normalizeSlashes(String(preloadLib?.entry))).toMatch(/electron\/preload\.ts$/);
    expect(preloadLib?.formats).toEqual(['cjs']);
    const preloadFileName = preloadLib?.fileName;
    expect(typeof preloadFileName).toBe('function');
    expect((preloadFileName as (format: string, entryName: string) => string)('cjs', 'preload')).toBe('preload.js');
    expect(config.renderer?.root).toBe('.');
    expect(config.renderer?.build?.outDir).toBe('dist');
  });
});

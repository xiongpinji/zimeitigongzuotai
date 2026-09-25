import path from 'node:path';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  obfuscationOptions,
  shouldSkipObfuscation,
} = require('../scripts/obfuscate-build.cjs');

describe('obfuscate build script', () => {
  it('does not enable self-defending code in packaged renderer chunks', () => {
    expect(obfuscationOptions.selfDefending).toBe(false);
  });

  it('skips chunks that host Motion Card dynamic runtime code', () => {
    const reason = shouldSkipObfuscation(
      path.resolve(__dirname, '../dist/assets/index-test.js'),
      `console.error('[lingji motion-card] 编译产物求值失败');`,
    );

    expect(reason).toContain('动态运行时代码');
  });

  it('keeps ordinary chunks eligible for obfuscation', () => {
    const reason = shouldSkipObfuscation(
      path.resolve(__dirname, '../dist/assets/plain.js'),
      'export const value = 1;',
    );

    expect(reason).toBeNull();
  });

  it('skips main process artifacts that host Motion Card dynamic runtime code', () => {
    const reason = shouldSkipObfuscation(
      path.resolve(__dirname, '../dist-electron/main.js'),
      `console.error('[lingji motion-card] 主进程日志');`,
    );

    expect(reason).toContain('动态运行时代码');
  });
});

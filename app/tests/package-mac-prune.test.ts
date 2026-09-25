import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isForeignArchPackage,
  listForeignArchPrunePaths,
} from '../scripts/package-mac-helpers.cjs';

describe('isForeignArchPackage', () => {
  it('keeps target arch and universal (cpu unspecified) packages', () => {
    expect(isForeignArchPackage({ os: ['darwin'], cpu: ['arm64'] }, 'darwin', 'arm64')).toBe(false);
    expect(isForeignArchPackage({ os: ['darwin'], cpu: null }, 'darwin', 'arm64')).toBe(false);
    expect(isForeignArchPackage({}, 'darwin', 'arm64')).toBe(false);
  });

  it('flags foreign os or cpu', () => {
    expect(isForeignArchPackage({ os: ['darwin'], cpu: ['x64'] }, 'darwin', 'arm64')).toBe(true);
    expect(isForeignArchPackage({ os: ['win32'], cpu: ['x64'] }, 'darwin', 'arm64')).toBe(true);
  });

  it('honors negated os lists', () => {
    expect(isForeignArchPackage({ os: ['!win32'] }, 'darwin', 'arm64')).toBe(false);
    expect(isForeignArchPackage({ os: ['!darwin'] }, 'darwin', 'arm64')).toBe(true);
  });
});

describe('listForeignArchPrunePaths', () => {
  let rootDir: string;
  let nodeModulesDir: string;

  const writePackage = (relDir: string, pkg: Record<string, unknown>) => {
    const dir = path.join(nodeModulesDir, relDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  };
  const mkPrebuild = (relPrebuildsDir: string, archName: string) => {
    fs.mkdirSync(path.join(nodeModulesDir, relPrebuildsDir, archName), { recursive: true });
  };

  beforeAll(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-test-'));
    nodeModulesDir = path.join(rootDir, 'node_modules');
    fs.mkdirSync(nodeModulesDir, { recursive: true });

    // prebuilds 多架构（node-pty 风格）
    mkPrebuild('node-pty/prebuilds', 'darwin-arm64');
    mkPrebuild('node-pty/prebuilds', 'darwin-x64');
    mkPrebuild('node-pty/prebuilds', 'win32-x64');
    // 嵌套深层 prebuilds（pi-tui 风格）
    mkPrebuild('pkg/node_modules/pi-tui/native/darwin/prebuilds', 'darwin-arm64');
    mkPrebuild('pkg/node_modules/pi-tui/native/darwin/prebuilds', 'darwin-x64');

    // 平台专属包（clipboard 风格，含嵌套）
    writePackage('@x/clipboard-darwin-arm64', { os: ['darwin'], cpu: ['arm64'] });
    writePackage('@x/clipboard-darwin-universal', { os: ['darwin'] });
    writePackage('@x/clipboard-darwin-x64', { os: ['darwin'], cpu: ['x64'] });
    writePackage('@x/clipboard-win32-x64-msvc', { os: ['win32'], cpu: ['x64'] });
    // 普通包（无 os/cpu）保留
    writePackage('plain-pkg', { name: 'plain-pkg' });
    // installer 子包（目标架构）保留
    writePackage('@ffprobe-installer/darwin-arm64', { os: ['darwin'], cpu: ['arm64'] });
  });

  afterAll(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('collects only foreign-arch prebuild subdirs and packages for darwin-arm64', () => {
    const targets = listForeignArchPrunePaths(nodeModulesDir, 'darwin', 'arm64')
      .map((p) => path.relative(nodeModulesDir, p))
      .sort();

    expect(targets).toEqual(
      [
        '@x/clipboard-darwin-x64',
        '@x/clipboard-win32-x64-msvc',
        'node-pty/prebuilds/darwin-x64',
        'node-pty/prebuilds/win32-x64',
        'pkg/node_modules/pi-tui/native/darwin/prebuilds/darwin-x64',
      ].sort(),
    );
  });

  it('keeps target arch, universal, plain, and installer packages', () => {
    const targets = listForeignArchPrunePaths(nodeModulesDir, 'darwin', 'arm64').map((p) =>
      path.relative(nodeModulesDir, p),
    );

    expect(targets).not.toContain('@x/clipboard-darwin-arm64');
    expect(targets).not.toContain('@x/clipboard-darwin-universal');
    expect(targets).not.toContain('plain-pkg');
    expect(targets).not.toContain('@ffprobe-installer/darwin-arm64');
    expect(targets).not.toContain(path.join('node-pty', 'prebuilds', 'darwin-arm64'));
  });
});

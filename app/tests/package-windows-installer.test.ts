import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  UNINSTALL_REGISTRY_ROOT,
  resolveInstallerOutputName,
  resolveMakensisCommand,
  buildMakensisArgs,
  assertSafeInstallerRelativePath,
  collectInstallerFileManifest,
  deriveInstallerDirectoryManifest,
  buildNsisScript,
  makensisMissingMessage,
  withShortWindowsReleaseDir,
} from '../scripts/package-windows-installer.cjs';

// P6-2 合成临时目录：只测试脚本生成的纯逻辑与合成文件树，绝不触碰真实安装目录或用户数据。
const tempRoots: string[] = [];

function createTempAppDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-2-installer-'));
  tempRoots.push(dir);
  return dir;
}

function writeFileTree(root: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
}

afterAll(() => {
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveInstallerOutputName', () => {
  it('matches the <appName>-<version>-<arch>-setup.exe release naming', () => {
    expect(
      resolveInstallerOutputName({ appName: '灵机剪影', version: '1.3.1', arch: 'x64' }),
    ).toBe('灵机剪影-1.3.1-x64-setup.exe');
  });
});

describe('resolveMakensisCommand', () => {
  it('falls back to makensis on PATH', () => {
    expect(resolveMakensisCommand({})).toBe('makensis');
  });

  it('prefers the MAKENSIS env override', () => {
    expect(resolveMakensisCommand({ MAKENSIS: '/opt/nsis/makensis' })).toBe('/opt/nsis/makensis');
  });

  it('ignores blank MAKENSIS', () => {
    expect(resolveMakensisCommand({ MAKENSIS: '   ' })).toBe('makensis');
  });
});

describe('buildMakensisArgs', () => {
  it('reads the generated NSIS script as UTF-8 so Chinese paths remain intact', () => {
    expect(buildMakensisArgs('D:/项目/installer.nsi')).toEqual([
      '/INPUTCHARSET',
      'UTF8',
      'D:/项目/installer.nsi',
    ]);
  });
});

describe('buildNsisScript', () => {
  const manifest = [
    'locales/zh-CN.pak',
    'resources/app.asar',
    'resources/nested/deep.bin',
    '灵机剪影.exe',
  ];
  const script = buildNsisScript({
    appName: '灵机剪影',
    version: '1.3.1',
    arch: 'x64',
    appDir: '/root/release/灵机剪影-win32-x64',
    exeName: '灵机剪影.exe',
    iconPath: '/root/build/icon.ico',
    outFile: '/root/release/灵机剪影-1.3.1-x64-setup.exe',
    manifest,
  });

  it('installs into a short Program Files root to avoid MAX_PATH', () => {
    expect(script).toContain('InstallDir "$PROGRAMFILES64\\灵机剪影"');
  });

  it('enables Unicode for chinese paths and requires admin', () => {
    expect(script).toContain('Unicode true');
    expect(script).toContain('RequestExecutionLevel admin');
  });

  it('bundles the packaged app folder recursively with windows separators', () => {
    expect(script).toContain('File /r "\\root\\release\\灵机剪影-win32-x64\\*.*"');
  });

  it('registers uninstall metadata and shortcuts', () => {
    expect(script).toContain(`${UNINSTALL_REGISTRY_ROOT}\\灵机剪影`);
    expect(script).toContain('WriteUninstaller "$INSTDIR\\Uninstall.exe"');
    expect(script).toContain('CreateShortcut "$DESKTOP\\灵机剪影.lnk" "$INSTDIR\\灵机剪影.exe"');
  });

  it('uses the icon when provided', () => {
    expect(script).toContain('!define MUI_ICON "\\root\\build\\icon.ico"');
  });

  it('omits icon defines when no icon is given', () => {
    const noIcon = buildNsisScript({
      appName: 'App',
      version: '1.0.0',
      arch: 'x64',
      appDir: '/a',
      exeName: 'App.exe',
      outFile: '/o/App-setup.exe',
      manifest: ['App.exe'],
    });
    expect(noIcon).not.toContain('MUI_ICON');
  });

  it('never recursively wipes the user-selectable install root (P6-2)', () => {
    expect(script).not.toContain('RMDir /r "$INSTDIR"');
    expect(script).not.toMatch(/RMDir\s+\/r\s+"\$INSTDIR/);
    // 卸载段内不允许出现任何针对 $INSTDIR 的通配 Delete 或递归删除。
    const uninstall = script.slice(
      script.indexOf('Section "Uninstall"'),
      script.indexOf('SectionEnd', script.indexOf('Section "Uninstall"')),
    );
    expect(uninstall).not.toMatch(/Delete "\$INSTDIR[^"]*[*?]/);
    expect(uninstall).not.toMatch(/RMDir \/r "\$INSTDIR/);
    expect(uninstall).toContain('RMDir "$INSTDIR"');
  });

  it('deletes exactly the manifest files plus Uninstall.exe in the uninstall section', () => {
    const uninstall = script.slice(
      script.indexOf('Section "Uninstall"'),
      script.indexOf('SectionEnd', script.indexOf('Section "Uninstall"')),
    );
    const deleted = [...uninstall.matchAll(/^\s*Delete "(\$INSTDIR\\[^"]*)"$/gm)].map((m) => m[1]);
    expect(deleted).toEqual([
      '$INSTDIR\\locales\\zh-CN.pak',
      '$INSTDIR\\resources\\app.asar',
      '$INSTDIR\\resources\\nested\\deep.bin',
      '$INSTDIR\\灵机剪影.exe',
      '$INSTDIR\\Uninstall.exe',
    ]);
  });

  it('removes installer-created directories deepest-first with nonrecursive RMDir', () => {
    const uninstall = script.slice(
      script.indexOf('Section "Uninstall"'),
      script.indexOf('SectionEnd', script.indexOf('Section "Uninstall"')),
    );
    const removed = [...uninstall.matchAll(/^\s*RMDir "(\$INSTDIR[^"]*)"$/gm)].map((m) => m[1]);
    expect(removed).toEqual([
      '$INSTDIR\\resources\\nested',
      '$INSTDIR\\locales',
      '$INSTDIR\\resources',
      '$INSTDIR',
    ]);
  });

  it('keeps shortcut and registry cleanup intact', () => {
    const uninstall = script.slice(script.indexOf('Section "Uninstall"'));
    expect(uninstall).toContain('Delete "$DESKTOP\\灵机剪影.lnk"');
    expect(uninstall).toContain('RMDir /r "$SMPROGRAMS\\灵机剪影"');
    expect(uninstall).toContain(`DeleteRegKey HKLM "${UNINSTALL_REGISTRY_ROOT}\\灵机剪影"`);
    expect(uninstall).toContain('DeleteRegKey HKLM "Software\\灵机剪影"');
  });

  it('refuses to build a script without an explicit manifest', () => {
    expect(() => buildNsisScript({
      appName: 'App',
      version: '1.0.0',
      arch: 'x64',
      appDir: '/a',
      exeName: 'App.exe',
      outFile: '/o/App-setup.exe',
    })).toThrow(/manifest/);
  });

  it('rejects unsafe manifest entries instead of embedding them in NSIS script', () => {
    for (const bad of ['../escape.txt', 'a/../../b', '$INSTDIR', 'quo"te.txt', 'wild*card.txt']) {
      expect(() => buildNsisScript({
        appName: 'App',
        version: '1.0.0',
        arch: 'x64',
        appDir: '/a',
        exeName: 'App.exe',
        outFile: '/o/App-setup.exe',
        manifest: [bad],
      })).toThrow();
    }
  });
});

describe('assertSafeInstallerRelativePath', () => {
  it('accepts deterministic packaged relative paths', () => {
    expect(assertSafeInstallerRelativePath('resources/app.asar')).toBe('resources/app.asar');
    expect(assertSafeInstallerRelativePath('灵机剪影.exe')).toBe('灵机剪影.exe');
  });

  it('rejects traversal, absolute, empty-segment and metacharacter paths', () => {
    const unsafe = [
      '../evil.txt',
      'a/../b.txt',
      './a.txt',
      'a//b.txt',
      'a/',
      '/etc/passwd',
      'C:\\Windows\\system32',
      'a\\b.txt',
      '$INSTDIR\\evil',
      'evil".txt',
      'evil`.txt',
      'evil*.txt',
      'evil?.txt',
      'evil\nRMDir /r "$INSTDIR"',
      '',
    ];
    for (const entry of unsafe) {
      expect(() => assertSafeInstallerRelativePath(entry)).toThrow();
    }
    expect(() => assertSafeInstallerRelativePath(42 as unknown as string)).toThrow();
  });
});

describe('deriveInstallerDirectoryManifest', () => {
  it('returns all parent directories deepest-first, deterministic', () => {
    expect(deriveInstallerDirectoryManifest([
      'a/b/c.txt',
      'a/d.txt',
      'e.txt',
      'z/y/x/w.bin',
    ])).toEqual(['z/y/x', 'a/b', 'z/y', 'a', 'z']);
  });

  it('returns an empty list for root-level-only manifests', () => {
    expect(deriveInstallerDirectoryManifest(['app.exe'])).toEqual([]);
  });
});

describe('collectInstallerFileManifest', () => {
  it('walks a synthetic app dir deterministically and returns sorted relative paths', () => {
    const appDir = createTempAppDir();
    writeFileTree(appDir, {
      '灵机剪影.exe': 'exe',
      'resources/app.asar': 'asar',
      'resources/nested/deep/file.bin': 'bin',
      'locales/zh-CN.pak': 'pak',
      'locales/en-US.pak': 'pak',
    });

    const first = collectInstallerFileManifest(appDir);
    const second = collectInstallerFileManifest(appDir);
    expect(first).toEqual(second);
    expect(first).toEqual([
      'locales/en-US.pak',
      'locales/zh-CN.pak',
      'resources/app.asar',
      'resources/nested/deep/file.bin',
      '灵机剪影.exe',
    ]);
  });

  it('skips nothing silently: empty dirs contribute no entries but do not fail', () => {
    const appDir = createTempAppDir();
    writeFileTree(appDir, { 'app.exe': 'exe' });
    fs.mkdirSync(path.join(appDir, 'empty-dir'), { recursive: true });
    expect(collectInstallerFileManifest(appDir)).toEqual(['app.exe']);
  });

  it('refuses to follow symlinks pointing outside the app dir', () => {
    const appDir = createTempAppDir();
    const outsideDir = createTempAppDir();
    writeFileTree(appDir, { 'app.exe': 'exe' });
    writeFileTree(outsideDir, { 'sentinel.txt': 'user data' });

    const linkPath = path.join(appDir, 'escape');
    let linkCreated = false;
    try {
      fs.symlinkSync(outsideDir, linkPath, 'junction');
      linkCreated = true;
    } catch {
      try {
        fs.symlinkSync(outsideDir, linkPath, 'dir');
        linkCreated = true;
      } catch {
        linkCreated = false;
      }
    }
    if (!linkCreated) {
      // 平台禁止创建符号链接（Windows 非开发者模式）：外部哨兵文件天然不可达，视为通过。
      expect(fs.existsSync(path.join(outsideDir, 'sentinel.txt'))).toBe(true);
      return;
    }

    expect(() => collectInstallerFileManifest(appDir)).toThrow(/符号链接/);
    expect(fs.existsSync(path.join(outsideDir, 'sentinel.txt'))).toBe(true);
  });
});

describe('makensisMissingMessage', () => {
  it('explains how to install NSIS', () => {
    const message = makensisMissingMessage('makensis');
    expect(message).toContain('choco install nsis');
    expect(message).toContain('brew install makensis');
    expect(message).toContain('MAKENSIS');
  });
});

describe('withShortWindowsReleaseDir', () => {
  it('maps a deep Windows release directory to a free drive and unmaps it after success', async () => {
    const calls: Array<[string, string[]]> = [];
    const result = await withShortWindowsReleaseDir('D:\\deep\\release', async (shortDir: string) => {
      expect(shortDir).toBe('Z:\\');
      return 'built';
    }, {
      platform: 'win32',
      existsSync: () => false,
      spawnSync: (command: string, args: string[]) => {
        calls.push([command, args]);
        return { status: 0 };
      },
    });
    expect(result).toBe('built');
    expect(calls).toEqual([
      ['subst', ['Z:', 'D:\\deep\\release']],
      ['subst', ['Z:', '/D']],
    ]);
  });

  it('unmaps the drive when installer generation fails', async () => {
    const calls: string[][] = [];
    await expect(withShortWindowsReleaseDir('D:\\deep\\release', async () => {
      throw new Error('makensis failed');
    }, {
      platform: 'win32',
      existsSync: () => false,
      spawnSync: (_command: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      },
    })).rejects.toThrow('makensis failed');
    expect(calls).toEqual([
      ['Z:', 'D:\\deep\\release'],
      ['Z:', '/D'],
    ]);
  });

  it('skips occupied drives and fails clearly if no drive can be mapped', async () => {
    const calls: string[][] = [];
    await expect(withShortWindowsReleaseDir('D:\\deep\\release', async () => 'unused', {
      platform: 'win32',
      existsSync: (drive: string) => drive === 'Z:\\',
      spawnSync: (_command: string, args: string[]) => {
        calls.push(args);
        return { status: 1, stderr: 'failed' };
      },
    })).rejects.toThrow('短盘符');
    expect(calls[0]).toEqual(['Y:', 'D:\\deep\\release']);
  });

  it('does not call subst outside Windows', async () => {
    const result = await withShortWindowsReleaseDir('/deep/release', async (dir: string) => dir, {
      platform: 'linux',
      spawnSync: () => { throw new Error('unexpected subst'); },
    });
    expect(result).toBe('/deep/release');
  });
});

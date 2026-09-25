import { describe, expect, it } from 'vitest';

import {
  UNINSTALL_REGISTRY_ROOT,
  resolveInstallerOutputName,
  resolveMakensisCommand,
  buildMakensisArgs,
  buildNsisScript,
  makensisMissingMessage,
  withShortWindowsReleaseDir,
} from '../scripts/package-windows-installer.cjs';

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
  const script = buildNsisScript({
    appName: '灵机剪影',
    version: '1.3.1',
    arch: 'x64',
    appDir: '/root/release/灵机剪影-win32-x64',
    exeName: '灵机剪影.exe',
    iconPath: '/root/build/icon.ico',
    outFile: '/root/release/灵机剪影-1.3.1-x64-setup.exe',
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
    });
    expect(noIcon).not.toContain('MUI_ICON');
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

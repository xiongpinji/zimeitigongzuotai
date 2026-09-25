import { describe, expect, it } from 'vitest';

import {
  UNINSTALL_REGISTRY_ROOT,
  resolveInstallerOutputName,
  resolveMakensisCommand,
  buildNsisScript,
  makensisMissingMessage,
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

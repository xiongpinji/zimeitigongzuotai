import { describe, expect, it } from 'vitest';
import {
  buildElectronInstallEnv,
  getPlatformExecutable,
  isElectronInstalled,
} from '../scripts/ensure-electron-binary.cjs';

describe('ensure-electron-binary helpers', () => {
  it('sets npmmirror for Electron when no mirror is configured', () => {
    const env = buildElectronInstallEnv({});

    expect(env.ELECTRON_MIRROR).toBe('https://npmmirror.com/mirrors/electron/');
    expect(env.npm_config_electron_mirror).toBe('https://npmmirror.com/mirrors/electron/');
  });

  it('keeps an explicitly configured Electron mirror', () => {
    const env = buildElectronInstallEnv({
      ELECTRON_MIRROR: 'https://example.test/electron/',
    });

    expect(env.ELECTRON_MIRROR).toBe('https://example.test/electron/');
    expect(env.npm_config_electron_mirror).toBe('https://example.test/electron/');
  });

  it('resolves the expected Electron executable per platform', () => {
    expect(getPlatformExecutable('win32')).toBe('electron.exe');
    expect(getPlatformExecutable('darwin')).toBe('Electron.app/Contents/MacOS/Electron');
    expect(getPlatformExecutable('linux')).toBe('electron');
  });

  it('requires both path.txt and the platform executable to consider Electron installed', () => {
    expect(isElectronInstalled({
      pathTxt: 'electron.exe',
      executableExists: true,
      versionFileExists: true,
      expectedExecutable: 'electron.exe',
    })).toBe(true);

    expect(isElectronInstalled({
      pathTxt: undefined,
      executableExists: true,
      versionFileExists: true,
      expectedExecutable: 'electron.exe',
    })).toBe(false);
  });
});

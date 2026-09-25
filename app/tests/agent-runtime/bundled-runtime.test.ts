import { describe, it, expect } from 'vitest';
import { resolveBundledEntry, buildBundledNodeSpawn } from '../../electron/agent-runtime/bundled-runtime';

describe('resolveBundledEntry', () => {
  it('prefers app.asar.unpacked when appPath is inside app.asar', () => {
    const existing = '/App/Contents/Resources/app.asar.unpacked/resources/pi/dist/cli.js';
    const hit = resolveBundledEntry('resources/pi/dist/cli.js', {
      appPath: '/App/Contents/Resources/app.asar',
      resourcesPath: '/App/Contents/Resources',
      cwd: '/cwd',
      existsSync: (p) => p === existing,
    });
    expect(hit).toBe(existing);
  });
  it('falls back to appPath in dev (no asar)', () => {
    const existing = '/repo/resources/pi/dist/cli.js';
    const hit = resolveBundledEntry('resources/pi/dist/cli.js', {
      appPath: '/repo', resourcesPath: '', cwd: '/repo',
      existsSync: (p) => p === existing,
    });
    expect(hit).toBe(existing);
  });
  it('returns null when nothing exists', () => {
    expect(resolveBundledEntry('resources/pi/dist/cli.js', {
      appPath: '/repo', resourcesPath: '', cwd: '/repo', existsSync: () => false,
    })).toBeNull();
  });
});

describe('buildBundledNodeSpawn', () => {
  it('runs entry via process.execPath with ELECTRON_RUN_AS_NODE=1', () => {
    const out = buildBundledNodeSpawn('/abs/cli.js', ['--mode', 'rpc'], {
      execPath: '/abs/electron', baseEnv: { PATH: '/usr/bin' },
    });
    expect(out.command).toBe('/abs/electron');
    expect(out.args).toEqual(['/abs/cli.js', '--mode', 'rpc']);
    expect(out.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(out.env.PATH).toBe('/usr/bin');
  });
});

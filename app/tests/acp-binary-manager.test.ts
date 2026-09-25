import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BinaryManager } from '../electron/acp/binary-manager';

/**
 * 回归测试：macOS 打包 .app 场景下，nvm default 版本没装 claude-agent-acp
 * 而其他版本装了时，`getSpawnCommand` 必须跨版本扫描定位到真实二进制，
 * 避免 `spawn claude-agent-acp ENOENT`。
 */
describe('BinaryManager nvm 多版本解析', () => {
  const savedHome = process.env.HOME;
  const savedNvmDir = process.env.NVM_DIR;
  const savedPath = process.env.PATH;
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lingji-acp-'));
    process.env.HOME = tmpHome;
    delete process.env.NVM_DIR;
    // 模拟 macOS .app 的最小 PATH
    process.env.PATH = path.join(tmpHome, 'empty-bin');
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (savedHome !== undefined) process.env.HOME = savedHome;
    if (savedNvmDir !== undefined) process.env.NVM_DIR = savedNvmDir;
    else delete process.env.NVM_DIR;
    if (savedPath !== undefined) process.env.PATH = savedPath;
  });

  function scaffoldNvm(options: {
    defaultAlias?: string;
    versions: Array<{ dir: string; bins: string[] }>;
  }): void {
    const nvmRoot = path.join(tmpHome, '.nvm');
    const versionsRoot = path.join(nvmRoot, 'versions', 'node');
    fs.mkdirSync(versionsRoot, { recursive: true });
    if (options.defaultAlias) {
      const aliasDir = path.join(nvmRoot, 'alias');
      fs.mkdirSync(aliasDir, { recursive: true });
      fs.writeFileSync(path.join(aliasDir, 'default'), options.defaultAlias);
    }
    for (const version of options.versions) {
      const binDir = path.join(versionsRoot, version.dir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      for (const bin of version.bins) {
        fs.writeFileSync(path.join(binDir, bin), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      }
    }
  }

  it('default 版本缺少 claude-agent-acp 时，回退扫描其他 nvm 版本', () => {
    scaffoldNvm({
      defaultAlias: 'v20.16.0',
      versions: [
        { dir: 'v20.16.0', bins: ['node', 'npm', 'npx'] },
        { dir: 'v22.13.0', bins: ['node', 'npm', 'npx', 'claude-agent-acp'] },
      ],
    });

    const bm = new BinaryManager(path.join(tmpHome, '.lingji', 'acp'));
    bm.ensureNodeInPath();

    const { command, args } = bm.getSpawnCommand('0.25.0');
    expect(args).toEqual([]);
    expect(command).toBe(
      path.join(tmpHome, '.nvm', 'versions', 'node', 'v22.13.0', 'bin', 'claude-agent-acp'),
    );
    // 同步把该版本 bin 目录并入 PATH，避免子进程内部再次 spawn 同目录工具失败
    expect(process.env.PATH?.split(path.delimiter)).toContain(
      path.join(tmpHome, '.nvm', 'versions', 'node', 'v22.13.0', 'bin'),
    );
  });

  it('默认版本自身装有 claude-agent-acp 时，优先使用默认版本', () => {
    scaffoldNvm({
      defaultAlias: 'v22.13.0',
      versions: [
        { dir: 'v20.16.0', bins: ['node', 'claude-agent-acp'] },
        { dir: 'v22.13.0', bins: ['node', 'claude-agent-acp'] },
      ],
    });

    const bm = new BinaryManager(path.join(tmpHome, '.lingji', 'acp'));
    bm.ensureNodeInPath();
    const { command } = bm.getSpawnCommand('0.25.0');
    expect(command).toBe(
      path.join(tmpHome, '.nvm', 'versions', 'node', 'v22.13.0', 'bin', 'claude-agent-acp'),
    );
  });

  it('所有 nvm 版本都没有 claude-agent-acp 时，回退用户 prefix', () => {
    scaffoldNvm({
      defaultAlias: 'v20.16.0',
      versions: [{ dir: 'v20.16.0', bins: ['node'] }],
    });
    const userBin = path.join(tmpHome, '.lingji', 'npm-global', 'bin');
    fs.mkdirSync(userBin, { recursive: true });
    fs.writeFileSync(path.join(userBin, 'claude-agent-acp'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const bm = new BinaryManager(path.join(tmpHome, '.lingji', 'acp'));
    bm.ensureNodeInPath();
    const { command } = bm.getSpawnCommand('0.25.0');
    expect(command).toBe(path.join(userBin, 'claude-agent-acp'));
  });

  it.skipIf(process.platform !== 'win32')('Windows user prefix can resolve npm .cmd shims', () => {
    const userPrefix = path.join(tmpHome, '.lingji', 'npm-global');
    fs.mkdirSync(userPrefix, { recursive: true });
    fs.writeFileSync(path.join(userPrefix, 'claude-agent-acp.cmd'), '@echo off\r\nexit /b 0\r\n');

    const bm = new BinaryManager(path.join(tmpHome, '.lingji', 'acp'));
    const { command } = bm.getSpawnCommand('0.25.0');

    expect(command).toBe(path.join(userPrefix, 'claude-agent-acp.cmd'));
  });
});

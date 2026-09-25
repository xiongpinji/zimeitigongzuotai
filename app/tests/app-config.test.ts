import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getDebugConfigFilePath,
  loadRuntimeDebugConfigSync,
  resolveAppConfig,
  saveRuntimeDebugConfig,
} from '../electron/app-config';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-config-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('resolveAppConfig', () => {
  it('在没有任何配置时使用默认值', () => {
    const config = resolveAppConfig({
      userDataPath: tmpDir,
      env: {},
      now: () => new Date('2026-04-15T08:00:00.000Z'),
    });

    expect(config.debugMode).toBe(false);
    expect(config.logLevel).toBe('info');
    expect(config.logDirPath).toBe(path.join(tmpDir, 'logs'));
    expect(config.logFilePath).toBe(path.join(tmpDir, 'logs', 'app-2026-04-15.log'));
  });

  it('读取构建期环境变量', () => {
    const config = resolveAppConfig({
      userDataPath: tmpDir,
      env: {
        MAIN_VITE_DEBUG_MODE: 'true',
        MAIN_VITE_LOG_LEVEL: 'warn',
      },
      now: () => new Date('2026-04-15T08:00:00.000Z'),
    });

    expect(config.debugMode).toBe(true);
    expect(config.logLevel).toBe('warn');
  });

  it('运行时配置优先级高于环境变量', () => {
    const config = resolveAppConfig({
      userDataPath: tmpDir,
      env: {
        MAIN_VITE_DEBUG_MODE: 'false',
        MAIN_VITE_LOG_LEVEL: 'error',
      },
      runtimeConfig: {
        debugMode: true,
        logLevel: 'info',
      },
      now: () => new Date('2026-04-15T08:00:00.000Z'),
    });

    expect(config.debugMode).toBe(true);
    expect(config.logLevel).toBe('info');
  });
});

describe('runtime debug config', () => {
  it('不存在时返回 null', () => {
    expect(loadRuntimeDebugConfigSync(tmpDir)).toBeNull();
  });

  it('写入后可同步读取', async () => {
    await saveRuntimeDebugConfig(tmpDir, {
      debugMode: true,
      logLevel: 'warn',
    });

    const filePath = getDebugConfigFilePath(tmpDir);
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      debugMode: boolean;
      logLevel: string;
      updatedAt: string;
    };

    expect(parsed.debugMode).toBe(true);
    expect(parsed.logLevel).toBe('warn');
    expect(typeof parsed.updatedAt).toBe('string');
    expect(loadRuntimeDebugConfigSync(tmpDir)).toMatchObject({
      debugMode: true,
      logLevel: 'warn',
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addAppLog,
  configureAppLogger,
  getAppLogFilePath,
  getAppLogs,
  resetAppLoggerForTests,
} from '../electron/app-logger';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-logger-test-'));
  resetAppLoggerForTests();
});

afterEach(async () => {
  resetAppLoggerForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('app logger', () => {
  it('按日期写入日志文件', async () => {
    configureAppLogger({
      logDirPath: tmpDir,
      logLevel: 'info',
      now: () => new Date('2026-04-15T08:00:00.000Z'),
    });

    const entry = addAppLog('info', 'app', '主窗口已创建');

    expect(entry).not.toBeNull();
    expect(getAppLogFilePath()).toBe(path.join(tmpDir, 'app-2026-04-15.log'));

    const raw = await fs.readFile(path.join(tmpDir, 'app-2026-04-15.log'), 'utf8');
    expect(raw).toContain('主窗口已创建');
  });

  it('会按日志级别过滤写盘与内存缓存', async () => {
    configureAppLogger({
      logDirPath: tmpDir,
      logLevel: 'warn',
      now: () => new Date('2026-04-15T08:00:00.000Z'),
    });

    const ignored = addAppLog('info', 'app', '这条不应落盘');
    const kept = addAppLog('error', 'app', '这条应保留');

    expect(ignored).toBeNull();
    expect(kept).not.toBeNull();
    expect(getAppLogs()).toHaveLength(1);

    const raw = await fs.readFile(path.join(tmpDir, 'app-2026-04-15.log'), 'utf8');
    expect(raw).toContain('这条应保留');
    expect(raw).not.toContain('这条不应落盘');
  });

  it('只保留最近 7 天日志文件', async () => {
    for (let day = 1; day <= 9; day += 1) {
      await fs.writeFile(
        path.join(tmpDir, `app-2026-04-0${day}.log`),
        `day-${day}\n`,
        'utf8',
      );
    }

    configureAppLogger({
      logDirPath: tmpDir,
      logLevel: 'info',
      retentionDays: 7,
      now: () => new Date('2026-04-10T08:00:00.000Z'),
    });

    addAppLog('warn', 'cleanup', '触发清理');

    const files = (await fs.readdir(tmpDir)).sort();
    expect(files).toEqual([
      'app-2026-04-04.log',
      'app-2026-04-05.log',
      'app-2026-04-06.log',
      'app-2026-04-07.log',
      'app-2026-04-08.log',
      'app-2026-04-09.log',
      'app-2026-04-10.log',
    ]);
  });
});

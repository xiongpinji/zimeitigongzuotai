import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { AppLogEntry, AppLogLevel } from '../src/lib/app-log';
import { formatLogLine } from '../src/lib/app-log';

const MAX_LOG_ENTRIES = 200;
const entries: AppLogEntry[] = [];
const LEVEL_PRIORITY: Record<AppLogLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
};

interface AppLoggerConfig {
  logDirPath: string;
  logLevel: AppLogLevel;
  retentionDays: number;
  now: () => Date;
}

let loggerConfig: AppLoggerConfig = {
  logDirPath: '',
  logLevel: 'info',
  retentionDays: 7,
  now: () => new Date(),
};

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getLogDirectory(): string {
  return loggerConfig.logDirPath;
}

export function getAppLogFilePath(): string {
  return path.join(getLogDirectory(), `app-${formatDateKey(loggerConfig.now())}.log`);
}

function shouldPersistLevel(level: AppLogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[loggerConfig.logLevel];
}

function cleanupExpiredLogs(): void {
  try {
    const files = readdirSync(getLogDirectory())
      .filter((fileName) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(fileName))
      .sort();
    const currentFileName = path.basename(getAppLogFilePath());
    const projectedCount = files.includes(currentFileName) ? files.length : files.length + 1;
    const expiredCount = Math.max(0, projectedCount - loggerConfig.retentionDays);
    const expiredFiles = files.slice(0, expiredCount);

    for (const fileName of expiredFiles) {
      rmSync(path.join(getLogDirectory(), fileName), { force: true });
    }
  } catch {
    // 日志清理失败不应阻断主流程。
  }
}

function persistLog(entry: AppLogEntry): void {
  try {
    mkdirSync(getLogDirectory(), { recursive: true });
    cleanupExpiredLogs();
    appendFileSync(getAppLogFilePath(), `${formatLogLine(entry)}\n`, 'utf-8');
  } catch {
    // 日志写盘失败不应阻断主流程。
  }
}

export function configureAppLogger(config: {
  logDirPath: string;
  logLevel: AppLogLevel;
  retentionDays?: number;
  now?: () => Date;
}): void {
  loggerConfig = {
    logDirPath: config.logDirPath,
    logLevel: config.logLevel,
    retentionDays: config.retentionDays ?? 7,
    now: config.now ?? (() => new Date()),
  };
}

export function addAppLog(
  level: AppLogLevel,
  scope: string,
  message: string,
  details?: string,
): AppLogEntry | null {
  if (!shouldPersistLevel(level)) {
    return null;
  }

  const entry: AppLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    details,
  };

  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) {
    entries.shift();
  }

  persistLog(entry);
  return entry;
}

export function getAppLogs(): AppLogEntry[] {
  return [...entries];
}

export function resetAppLoggerForTests(): void {
  entries.length = 0;
  loggerConfig = {
    logDirPath: '',
    logLevel: 'info',
    retentionDays: 7,
    now: () => new Date(),
  };
}

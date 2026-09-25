import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppLogLevel } from '../src/lib/app-log';

export interface RuntimeDebugConfig {
  debugMode?: boolean;
  logLevel?: AppLogLevel;
  updatedAt?: string;
}

export interface ResolvedAppConfig {
  debugMode: boolean;
  logLevel: AppLogLevel;
  logDirPath: string;
  logFilePath: string;
  runtimeConfigPath: string;
}

interface ResolveAppConfigOptions {
  userDataPath: string;
  env?: Record<string, string | undefined>;
  runtimeConfig?: RuntimeDebugConfig | null;
  now?: () => Date;
}

const DEBUG_CONFIG_FILE = 'debug-config.json';
const DEFAULT_LOG_LEVEL: AppLogLevel = 'info';
const ALLOWED_LOG_LEVELS: AppLogLevel[] = ['info', 'warn', 'error'];

function normalizeBoolean(value: string | undefined): boolean | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function normalizeLogLevel(value: string | undefined): AppLogLevel | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase() as AppLogLevel;
  return ALLOWED_LOG_LEVELS.includes(normalized) ? normalized : undefined;
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getDebugConfigFilePath(userDataPath: string): string {
  return path.join(userDataPath, DEBUG_CONFIG_FILE);
}

export function getLogDirectoryPath(userDataPath: string): string {
  return path.join(userDataPath, 'logs');
}

export function getLogFilePathForDate(userDataPath: string, date: Date): string {
  return path.join(getLogDirectoryPath(userDataPath), `app-${formatDateKey(date)}.log`);
}

export function loadRuntimeDebugConfigSync(userDataPath: string): RuntimeDebugConfig | null {
  try {
    const raw = fs.readFileSync(getDebugConfigFilePath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw) as RuntimeDebugConfig;
    return {
      debugMode: typeof parsed.debugMode === 'boolean' ? parsed.debugMode : undefined,
      logLevel: normalizeLogLevel(parsed.logLevel),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function saveRuntimeDebugConfig(
  userDataPath: string,
  config: RuntimeDebugConfig,
): Promise<RuntimeDebugConfig> {
  const normalized: RuntimeDebugConfig = {
    debugMode: typeof config.debugMode === 'boolean' ? config.debugMode : false,
    logLevel: normalizeLogLevel(config.logLevel) ?? DEFAULT_LOG_LEVEL,
    updatedAt: new Date().toISOString(),
  };

  await fsp.mkdir(userDataPath, { recursive: true });
  await fsp.writeFile(
    getDebugConfigFilePath(userDataPath),
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf8',
  );

  return normalized;
}

export function resolveAppConfig(options: ResolveAppConfigOptions): ResolvedAppConfig {
  const now = options.now?.() ?? new Date();
  const env = options.env ?? {};
  const runtimeConfig = options.runtimeConfig ?? loadRuntimeDebugConfigSync(options.userDataPath);

  const envDebugMode =
    normalizeBoolean(env.MAIN_VITE_DEBUG_MODE) ??
    normalizeBoolean(env.DEBUG_MODE) ??
    false;
  const envLogLevel =
    normalizeLogLevel(env.MAIN_VITE_LOG_LEVEL) ??
    normalizeLogLevel(env.LOG_LEVEL) ??
    DEFAULT_LOG_LEVEL;

  const debugMode =
    typeof runtimeConfig?.debugMode === 'boolean'
      ? runtimeConfig.debugMode
      : envDebugMode;
  const logLevel = runtimeConfig?.logLevel ?? envLogLevel;

  return {
    debugMode,
    logLevel,
    logDirPath: getLogDirectoryPath(options.userDataPath),
    logFilePath: getLogFilePathForDate(options.userDataPath, now),
    runtimeConfigPath: getDebugConfigFilePath(options.userDataPath),
  };
}

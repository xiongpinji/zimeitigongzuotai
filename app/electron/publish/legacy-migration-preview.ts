/**
 * A2-S4b: read-only preview of the legacy publish registry.
 * No AccountStore/AccountVault construction, session-file reads or migration.
 */
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { AccountIpcMainLike } from './accounts-v2-ipc';

export const LEGACY_MIGRATION_PREVIEW_CHANNEL = 'account-v2:migration-preview';
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;
const PLATFORMS = ['douyin', 'kuaishou', 'tencent', 'xiaohongshu', 'bilibili'] as const;
type LegacyPlatform = (typeof PLATFORMS)[number];
type LegacyStatus = 'valid' | 'expired' | 'unknown';

export type LegacyMigrationPreviewErrorCode =
  | 'invalid_root'
  | 'invalid_request'
  | 'registry_missing'
  | 'registry_unsafe'
  | 'registry_read_failed'
  | 'registry_too_large'
  | 'registry_corrupt';

const ERROR_MESSAGES: Readonly<Record<LegacyMigrationPreviewErrorCode, string>> = {
  invalid_root: '旧账号目录无效，无法预览',
  invalid_request: '预览请求无效',
  registry_missing: '旧账号注册表不存在，无法预览',
  registry_unsafe: '旧账号注册表类型不安全，无法预览',
  registry_read_failed: '旧账号注册表读取失败，无法预览',
  registry_too_large: '旧账号注册表超出预览上限',
  registry_corrupt: '旧账号注册表内容无效，无法预览',
};

export interface LegacyPreviewAccount {
  /** Transient ordinal in this registry snapshot, not an account identifier. */
  index: number;
  platform: LegacyPlatform;
  status: LegacyStatus;
  eligibility: 'eligible' | 'unsupported_platform';
}

export type LegacyMigrationPreviewResult =
  | {
      ok: true;
      total: number;
      eligible: number;
      excluded: number;
      byPlatform: Record<LegacyPlatform, number>;
      accounts: LegacyPreviewAccount[];
    }
  | { ok: false; code: LegacyMigrationPreviewErrorCode; message: string };

function failure(code: LegacyMigrationPreviewErrorCode): LegacyMigrationPreviewResult {
  return { ok: false, code, message: ERROR_MESSAGES[code] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLegacyPlatform(value: unknown): value is LegacyPlatform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is LegacyStatus {
  return value === 'valid' || value === 'expired' || value === 'unknown';
}

/**
 * Only read registry.json from the explicitly supplied old root. The caller
 * never provides a path across IPC; main closes over app userData/publish.
 */
export function previewLegacyMigration(legacyRoot: string): LegacyMigrationPreviewResult {
  if (typeof legacyRoot !== 'string' || !isAbsolute(legacyRoot)) return failure('invalid_root');
  const registryPath = join(legacyRoot, 'registry.json');
  let rootStat;
  let fileStat;
  try {
    rootStat = lstatSync(legacyRoot);
    fileStat = lstatSync(registryPath);
  } catch (error) {
    return failure((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'registry_missing' : 'registry_read_failed');
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || fileStat.isSymbolicLink() || !fileStat.isFile()) {
    return failure('registry_unsafe');
  }
  if (fileStat.size > MAX_REGISTRY_BYTES) return failure('registry_too_large');

  let fd: number;
  try {
    fd = openSync(registryPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return failure('registry_read_failed');
  }
  let raw: string;
  let closeFailed = false;
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.size > MAX_REGISTRY_BYTES ||
      opened.dev !== fileStat.dev ||
      opened.ino !== fileStat.ino
    ) {
      return failure('registry_unsafe');
    }
    raw = readFileSync(fd, 'utf8');
  } catch {
    return failure('registry_read_failed');
  } finally {
    try { closeSync(fd); } catch { closeFailed = true; }
  }
  if (closeFailed) return failure('registry_read_failed');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure('registry_corrupt');
  }
  if (!Array.isArray(parsed)) return failure('registry_corrupt');

  const byPlatform: Record<LegacyPlatform, number> = {
    douyin: 0,
    kuaishou: 0,
    tencent: 0,
    xiaohongshu: 0,
    bilibili: 0,
  };
  const accounts: LegacyPreviewAccount[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < parsed.length; index += 1) {
    const row: unknown = parsed[index];
    if (!isRecord(row)) return failure('registry_corrupt');
    const keys = Object.keys(row);
    if (
      keys.some((key) => !['platform', 'accountName', 'status', 'lastCheckedAt'].includes(key)) ||
      !isLegacyPlatform(row.platform) ||
      typeof row.accountName !== 'string' ||
      row.accountName.trim().length === 0 ||
      /[\\/\u0000]/.test(row.accountName) ||
      !isStatus(row.status) ||
      (row.lastCheckedAt !== undefined && row.lastCheckedAt !== null &&
        (typeof row.lastCheckedAt !== 'number' || !Number.isFinite(row.lastCheckedAt) || row.lastCheckedAt < 0))
    ) return failure('registry_corrupt');
    const identity = `${row.platform}\u0000${row.accountName}`;
    if (seen.has(identity)) return failure('registry_corrupt');
    seen.add(identity);
    byPlatform[row.platform] += 1;
    accounts.push({
      index: index + 1,
      platform: row.platform,
      status: row.status,
      eligibility: row.platform === 'bilibili' ? 'unsupported_platform' : 'eligible',
    });
  }
  const excluded = byPlatform.bilibili;
  return { ok: true, total: accounts.length, eligible: accounts.length - excluded, excluded, byPlatform, accounts };
}

/** Fixed no-argument IPC surface. Renderer can neither choose a root nor start migration. */
export function registerLegacyMigrationPreviewIpc(options: {
  ipc: AccountIpcMainLike;
  legacyRoot: string;
}): void {
  options.ipc.handle(LEGACY_MIGRATION_PREVIEW_CHANNEL, (_event, ...args) => {
    if (args.length !== 0) return failure('invalid_request');
    return previewLegacyMigration(options.legacyRoot);
  });
}

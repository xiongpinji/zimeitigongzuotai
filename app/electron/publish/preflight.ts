/**
 * Legacy publish:run whole-job preflight. This module only binds existing
 * legacy accounts; account-v2 UUIDs never enter the legacy upload path.
 */
import { buildAccountId } from './account-id';
import type { PublishAccount, PublishJob, PublishPlatform, PublishTarget } from './types';

const LEGACY_PLATFORMS = new Set<PublishPlatform>([
  'douyin',
  'kuaishou',
  'tencent',
  'xiaohongshu',
  'bilibili',
]);

export const PUBLISH_PREFLIGHT_ERROR_CODES = [
  'publish_preflight_job_invalid',
  'publish_preflight_targets_invalid',
  'publish_preflight_target_malformed',
  'publish_preflight_duplicate_target',
  'publish_preflight_accounts_unavailable',
  'publish_preflight_account_mismatch',
  'publish_preflight_account_missing',
] as const;

export type PublishPreflightErrorCode = (typeof PUBLISH_PREFLIGHT_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<PublishPreflightErrorCode, string>> = {
  publish_preflight_job_invalid: '发布任务信息无效，已取消整单发布',
  publish_preflight_targets_invalid: '发布目标列表无效，已取消整单发布',
  publish_preflight_target_malformed: '发布目标格式无效，已取消整单发布',
  publish_preflight_duplicate_target: '发布目标重复，已取消整单发布',
  publish_preflight_accounts_unavailable: '账号列表暂不可用，已取消整单发布',
  publish_preflight_account_mismatch: '账号记录不一致，已取消整单发布',
  publish_preflight_account_missing: '发布目标账号不存在，已取消整单发布',
};

/** Error text is independent of untrusted job, account and filesystem data. */
export class PublishPreflightError extends Error {
  readonly code: PublishPreflightErrorCode;

  constructor(code: PublishPreflightErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'PublishPreflightError';
    this.code = code;
  }
}

const issuedErrors = new WeakSet<PublishPreflightError>();

function reject(code: PublishPreflightErrorCode): never {
  const error = new PublishPreflightError(code);
  issuedErrors.add(error);
  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// IPC jobs and the legacy JSON registry are data records. Reject accessors
// before validation so a field cannot validate as one value and later resolve
// to a different account, path or upload option.
function hasOwnData(record: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && 'value' in descriptor;
}

function hasOptionalData(record: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor === undefined ? !(key in record) : 'value' in descriptor;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isLegacyPlatform(value: unknown): value is PublishPlatform {
  return typeof value === 'string' && LEGACY_PLATFORMS.has(value as PublishPlatform);
}

function validateJob(job: unknown): asserts job is PublishJob {
  if (
    !isRecord(job) ||
    !hasOwnData(job, 'id') ||
    !hasOwnData(job, 'filePath') ||
    !hasOwnData(job, 'shared') ||
    !isNonEmptyString(job.id) ||
    !isNonEmptyString(job.filePath)
  ) {
    reject('publish_preflight_job_invalid');
  }
  const shared = job.shared;
  if (
    !isRecord(shared) ||
    !hasOwnData(shared, 'title') ||
    !hasOwnData(shared, 'desc') ||
    !hasOwnData(shared, 'tags') ||
    !hasOptionalData(shared, 'thumbnail') ||
    !hasOptionalData(shared, 'scheduleAt') ||
    !hasOptionalData(shared, 'covers') ||
    typeof shared.title !== 'string' ||
    typeof shared.desc !== 'string' ||
    !isStringArray(shared.tags) ||
    (shared.thumbnail !== undefined && typeof shared.thumbnail !== 'string') ||
    (shared.scheduleAt !== undefined &&
      (typeof shared.scheduleAt !== 'number' || !Number.isFinite(shared.scheduleAt)))
  ) {
    reject('publish_preflight_job_invalid');
  }
  if (shared.covers !== undefined) {
    if (!isRecord(shared.covers)) reject('publish_preflight_job_invalid');
    for (const [ratio, ref] of Object.entries(shared.covers)) {
      if (!['16:9', '4:3', '3:4'].includes(ratio) || typeof ref !== 'string') {
        reject('publish_preflight_job_invalid');
      }
    }
  }
}

function validateTarget(raw: unknown): asserts raw is PublishTarget {
  if (
    !isRecord(raw) ||
    !hasOwnData(raw, 'accountId') ||
    !hasOptionalData(raw, 'overrides') ||
    !hasOptionalData(raw, 'bilibili') ||
    !isNonEmptyString(raw.accountId)
  ) {
    reject('publish_preflight_target_malformed');
  }
  // Trim only for shape checking; the later map lookup uses the original full
  // ID. Thus whitespace variants can never resolve to a different account.
  const shapeId = raw.accountId.trim();
  const separator = shapeId.indexOf('_');
  if (
    separator <= 0 ||
    separator === shapeId.length - 1 ||
    !isLegacyPlatform(shapeId.slice(0, separator))
  ) {
    reject('publish_preflight_target_malformed');
  }
  if (raw.overrides !== undefined) {
    if (!isRecord(raw.overrides)) reject('publish_preflight_target_malformed');
    const overrides = raw.overrides;
    if (
      !hasOptionalData(overrides, 'title') ||
      !hasOptionalData(overrides, 'desc') ||
      !hasOptionalData(overrides, 'tags') ||
      (overrides.title !== undefined && typeof overrides.title !== 'string') ||
      (overrides.desc !== undefined && typeof overrides.desc !== 'string') ||
      (overrides.tags !== undefined && !isStringArray(overrides.tags))
    ) {
      reject('publish_preflight_target_malformed');
    }
  }
  if (raw.bilibili !== undefined) {
    if (
      !isRecord(raw.bilibili) ||
      !hasOwnData(raw.bilibili, 'tid') ||
      !Number.isSafeInteger(raw.bilibili.tid) ||
      (raw.bilibili.tid as number) < 0
    ) {
      reject('publish_preflight_target_malformed');
    }
  }
}

export interface BoundLegacyPublishTarget {
  readonly target: PublishTarget;
  readonly account: PublishAccount;
}

/** Validate the entire batch before the caller resolves any platform module. */
export function preflightPublishTargets(
  job: unknown,
  accountSnapshot: unknown,
): BoundLegacyPublishTarget[] {
  let phase: 'job' | 'targets' | 'accounts' = 'job';
  try {
    validateJob(job);
    phase = 'targets';
    if (!hasOwnData(job, 'targets') || !Array.isArray(job.targets) || job.targets.length === 0) {
      reject('publish_preflight_targets_invalid');
    }
    const targets = job.targets as unknown[];
    const seenTargets = new Set<string>();
    for (const rawTarget of targets) {
      validateTarget(rawTarget);
      if (seenTargets.has(rawTarget.accountId)) reject('publish_preflight_duplicate_target');
      seenTargets.add(rawTarget.accountId);
    }

    phase = 'accounts';
    if (!Array.isArray(accountSnapshot)) reject('publish_preflight_accounts_unavailable');
    const byId = new Map<string, PublishAccount>();
    for (const rawAccount of accountSnapshot as unknown[]) {
      if (!isRecord(rawAccount)) reject('publish_preflight_accounts_unavailable');
      if (
        !hasOwnData(rawAccount, 'id') ||
        !hasOwnData(rawAccount, 'platform') ||
        !hasOwnData(rawAccount, 'accountName') ||
        !hasOwnData(rawAccount, 'storageStatePath') ||
        !hasOwnData(rawAccount, 'status') ||
        !hasOptionalData(rawAccount, 'lastCheckedAt') ||
        !isLegacyPlatform(rawAccount.platform) ||
        !isNonEmptyString(rawAccount.accountName) ||
        /[\\/\u0000]/.test(rawAccount.accountName) ||
        !isNonEmptyString(rawAccount.id) ||
        !isNonEmptyString(rawAccount.storageStatePath) ||
        (rawAccount.status !== 'valid' &&
          rawAccount.status !== 'expired' &&
          rawAccount.status !== 'unknown') ||
        (rawAccount.lastCheckedAt !== undefined &&
          (typeof rawAccount.lastCheckedAt !== 'number' ||
            !Number.isFinite(rawAccount.lastCheckedAt) ||
            rawAccount.lastCheckedAt < 0)) ||
        rawAccount.id !== buildAccountId(rawAccount.platform, rawAccount.accountName) ||
        byId.has(rawAccount.id)
      ) {
        reject('publish_preflight_account_mismatch');
      }
      byId.set(rawAccount.id, rawAccount as unknown as PublishAccount);
    }

    return targets.map((rawTarget) => {
      const target = rawTarget as PublishTarget;
      const account = byId.get(target.accountId);
      if (!account) reject('publish_preflight_account_missing');
      return { target, account };
    });
  } catch (error) {
    // Getters/iterators in untrusted runtime inputs can throw arbitrary text,
    // including a forged PublishPreflightError. Only errors created by this
    // module are allowed to escape; everything else becomes a fixed code.
    if (error instanceof PublishPreflightError && issuedErrors.has(error)) throw error;
    reject(
      phase === 'job'
        ? 'publish_preflight_job_invalid'
        : phase === 'targets'
          ? 'publish_preflight_target_malformed'
          : 'publish_preflight_accounts_unavailable',
    );
  }
}

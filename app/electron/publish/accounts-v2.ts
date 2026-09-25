/**
 * P1-1 账号核心（v2）：内部 UUID 元数据 registry + 加密会话仓。
 *
 * 设计边界（与旧 accounts.ts 的差异）：
 * - 账号身份是独立生成的 UUID，**不由平台 + 昵称拼出**；同平台多账号、
 *   同名跨平台账号天然隔离。
 * - registry.json 只保存元数据（id / platform / displayName / owner / status /
 *   sessionRef / lastCheckedAt / createdAt / migratedFrom），Cookie、Token、
 *   Playwright storageState 内容一律不进 registry。
 * - 会话内容经注入的 SessionCipher 加密后写入 sessions/<sessionRef>.bin，
 *   sessionRef 为随机生成的不可预测引用（s1-<32 hex>），不含昵称或路径信息。
 * - 加密不可用时 fail closed：不存在任何明文回退路径。
 * - 所有磁盘写入原子替换（tmp + rename）；读取 / 解密失败显式抛
 *   AccountVaultError，绝不吞错后当作空账号。
 * - 平台调用只能通过 withDecryptedStorageState 拿到**短时明文**：明文只存在
 *   于每次调用独立创建的临时目录，finally 中连同目录一并删除。
 * - 错误与日志只包含 accountId / sessionRef / 错误码，不包含会话内容。
 *
 * 平台范围：阶段一仅抖音 / 快手 / 视频号（上游 tencent）/ 小红书；
 * 其他平台（如 bilibili）显式拒绝。
 *
 * 本模块不接 IPC、不做平台登录 / 发布；接线由后续任务完成。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PublishPlatform } from './types';
import { buildAccountId } from './account-id';

// ─── 常量与类型 ───────────────────────────────────────────────────────────────

export const ACCOUNT_VAULT_SCHEMA_VERSION = 1;

/** 加密会话文件扩展名；文件名为不可预测的 sessionRef。 */
export const SESSION_FILE_EXT = '.bin';

/** 阶段一账号核心支持的四平台（上游 tencent 即微信视频号）。 */
export const ACCOUNT_VAULT_PLATFORMS: readonly PublishPlatform[] = [
  'douyin',
  'tencent',
  'xiaohongshu',
  'kuaishou',
];

export type AccountVaultPlatform = 'douyin' | 'tencent' | 'xiaohongshu' | 'kuaishou';

/** 与上游 PublishAccount.status 对齐；契约 AccountV1 的映射由适配层完成。 */
export type AccountVaultStatus = 'valid' | 'expired' | 'unknown';

export interface AccountV2 {
  /** 内部不透明 UUID；同平台多账号各自独立，绝不等于 displayName。 */
  id: string;
  platform: AccountVaultPlatform;
  /** 展示昵称（仅 UI 用途，不作唯一键，不参与任何路径）。 */
  displayName: string;
  /** 账号持有人标识（审计用，非凭证）。 */
  owner: string;
  status: AccountVaultStatus;
  /** 加密会话仓的不透明引用；未登录 / 已删除时为 null。 */
  sessionRef: string | null;
  /** 最近一次探针 / 登录核验时间（epoch ms）；从未核验为 null。 */
  lastCheckedAt: number | null;
  /** 创建时间（epoch ms）。 */
  createdAt: number;
  /** 旧 registry 迁移溯源标记（旧 id `platform_accountName`）；非迁移账号为 null。 */
  migratedFrom: string | null;
}

export interface CreateAccountInput {
  /** 运行时校验：仅接受四平台，其他值抛 invalid_platform。 */
  platform: string;
  displayName: string;
  owner?: string;
}

/**
 * 可注入的会话加密接口。
 * 生产实现见 session-cipher-electron.ts（Electron safeStorage，fail closed）；
 * 测试可用假加密器验证边界，但假加密器严禁进入生产路径。
 */
export interface SessionCipher {
  isAvailable(): boolean;
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer): Buffer;
}

export type AccountVaultErrorCode =
  | 'invalid_platform'
  | 'invalid_account'
  | 'invalid_storage_state'
  | 'account_not_found'
  | 'registry_corrupt'
  | 'registry_unsupported_version'
  | 'registry_read_failed'
  | 'registry_write_failed'
  | 'session_missing'
  | 'session_file_missing'
  | 'session_decrypt_failed'
  | 'session_encrypt_failed'
  | 'session_verify_failed'
  | 'cipher_unavailable'
  | 'legacy_registry_corrupt'
  | 'legacy_registry_write_failed';

export interface AccountVaultErrorOptions {
  accountId?: string;
  cause?: unknown;
}

/**
 * 账号核心显式错误。message 只包含 accountId / 引用 / 错误码等元信息，
 * 绝不包含会话内容。
 */
export class AccountVaultError extends Error {
  readonly code: AccountVaultErrorCode;
  readonly accountId?: string;
  readonly cause?: { code: string };

  constructor(code: AccountVaultErrorCode, message: string, opts: AccountVaultErrorOptions = {}) {
    super(message);
    this.name = 'AccountVaultError';
    this.code = code;
    this.accountId = opts.accountId;
    // 原始异常可能含 Cookie / Token 或平台返回体，不允许从错误对象向日志泄露。
    const causeCode = (opts.cause as NodeJS.ErrnoException | undefined)?.code;
    if (typeof causeCode === 'string' && /^[A-Z0-9_]{1,32}$/.test(causeCode)) {
      this.cause = { code: causeCode };
    }
  }
}

export interface LegacyMigrationResult {
  legacyId: string;
  accountId: string;
}

export interface LegacyMigrationSkip {
  legacyId: string;
  reason: 'unsupported_platform' | 'already_migrated';
}

export interface LegacyMigrationFailure {
  legacyId: string;
  /** 机器可读原因；不含会话内容。 */
  reason: 'legacy_read_failed' | 'cipher_unavailable' | 'encrypt_failed' | 'verify_failed';
}

export interface LegacyMigrationReport {
  migrated: LegacyMigrationResult[];
  /** 旧条目存在但明文 storageState 缺失：仅迁移元数据（无会话）。 */
  migratedWithoutSession: LegacyMigrationResult[];
  skipped: LegacyMigrationSkip[];
  failed: LegacyMigrationFailure[];
}

export interface AccountVaultDeps {
  /** 默认 crypto.randomUUID；测试可注入。 */
  randomUUID?: () => string;
  /** 默认 Date.now；测试可注入。 */
  now?: () => number;
  /** 短时明文临时目录的基目录，默认 os.tmpdir()。 */
  tmpBaseDir?: string;
}

interface RegistryFile {
  schemaVersion: number;
  accounts: AccountV2[];
}

interface LegacyRegistryEntry {
  platform: string;
  accountName: string;
  status: AccountVaultStatus;
  lastCheckedAt: number | null;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

function isAccountVaultPlatform(value: unknown): value is AccountVaultPlatform {
  return (
    typeof value === 'string' &&
    (ACCOUNT_VAULT_PLATFORMS as readonly string[]).includes(value)
  );
}

function isAccountVaultStatus(value: unknown): value is AccountVaultStatus {
  return value === 'valid' || value === 'expired' || value === 'unknown';
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 原子写：先写同目录 tmp 文件再 rename。Windows 上目标被索引器 / 监听器
 * 短暂占用时（EPERM/EBUSY 等）做短退避重试，与 project-file.ts 的语义一致；
 * 重试耗尽或不可重试错误时清理 tmp 并抛出原始错误。
 */
function atomicWriteFileSync(targetPath: string, data: string | Buffer): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmpPath, data);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      renameSync(tmpPath, targetPath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EEXIST' || code === 'ENOTEMPTY') {
        lastErr = err;
        sleepSync(20 * (attempt + 1));
        continue;
      }
      rmSync(tmpPath, { force: true });
      throw err;
    }
  }
  rmSync(tmpPath, { force: true });
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ─── AccountVault ─────────────────────────────────────────────────────────────

export class AccountVault {
  private readonly root: string;
  private readonly cipher: SessionCipher;
  private readonly registryPath: string;
  private readonly sessionsDir: string;
  private readonly tmpBaseDir: string;
  private readonly randomUUIDFn: () => string;
  private readonly nowFn: () => number;

  // 显式字段赋值（不用 TS parameter properties），保持 Node type-stripping
  // 与 esbuild 等“仅擦除”工具链的兼容性。
  constructor(root: string, cipher: SessionCipher, deps: AccountVaultDeps = {}) {
    this.root = root;
    this.cipher = cipher;
    this.registryPath = join(root, 'registry.json');
    this.sessionsDir = join(root, 'sessions');
    this.tmpBaseDir = deps.tmpBaseDir ?? tmpdir();
    this.randomUUIDFn = deps.randomUUID ?? (() => randomUUID());
    this.nowFn = deps.now ?? (() => Date.now());
    mkdirSync(this.sessionsDir, { recursive: true });
    mkdirSync(this.tmpBaseDir, { recursive: true });
  }

  // ── 元数据 API ──────────────────────────────────────────────────────────────

  createAccount(input: CreateAccountInput): AccountV2 {
    if (!isAccountVaultPlatform(input.platform)) {
      throw new AccountVaultError(
        'invalid_platform',
        `platform not in phase-1 account vault scope: ${String(input.platform)}`,
      );
    }
    if (typeof input.displayName !== 'string' || input.displayName.trim() === '') {
      throw new AccountVaultError('invalid_account', 'displayName must be a non-empty string');
    }
    const account: AccountV2 = {
      id: this.randomUUIDFn(),
      platform: input.platform,
      displayName: input.displayName,
      owner: typeof input.owner === 'string' && input.owner.trim() !== '' ? input.owner : 'local',
      status: 'unknown',
      sessionRef: null,
      lastCheckedAt: null,
      createdAt: this.nowFn(),
      migratedFrom: null,
    };
    const accounts = this.readAccounts();
    accounts.push(account);
    this.writeAccounts(accounts);
    return { ...account };
  }

  getAccount(accountId: string): AccountV2 {
    return { ...this.findAccountOrThrow(accountId) };
  }

  listAccounts(): AccountV2[] {
    return this.readAccounts().map((a) => ({ ...a }));
  }

  /**
   * 按探针结果更新单个账号状态（valid / expired）与核验时间。
   * 只写目标账号，其他账号元数据与会话不受影响。
   */
  updateStatusFromProbe(accountId: string, ok: boolean, checkedAt?: number): AccountV2 {
    const accounts = this.readAccounts();
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx < 0) {
      throw new AccountVaultError('account_not_found', `unknown account id: ${accountId}`, {
        accountId,
      });
    }
    accounts[idx] = {
      ...accounts[idx],
      status: ok ? 'valid' : 'expired',
      lastCheckedAt: checkedAt ?? this.nowFn(),
    };
    this.writeAccounts(accounts);
    return { ...accounts[idx] };
  }

  /** 删除账号及其加密会话文件；其余账号不受影响。重复删除显式报错。 */
  removeAccount(accountId: string): void {
    const accounts = this.readAccounts();
    const target = accounts.find((a) => a.id === accountId);
    if (!target) {
      throw new AccountVaultError('account_not_found', `unknown account id: ${accountId}`, {
        accountId,
      });
    }
    this.writeAccounts(accounts.filter((a) => a.id !== accountId));
    if (target.sessionRef) {
      rmSync(this.sessionPathFor(target.sessionRef), { force: true });
    }
  }

  // ── 会话 API ────────────────────────────────────────────────────────────────

  /**
   * 保存 Playwright storageState（JSON 文本）：加密 → 原子写入新引用文件 →
   * 回读解密核验一致 → 更新 registry（status=valid）→ 删除旧引用密文。
   * 加密不可用或核验失败都显式抛错，registry 保持原状，绝不落明文。
   */
  saveStorageState(accountId: string, storageStateJson: string): AccountV2 {
    const accounts = this.readAccounts();
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx < 0) {
      throw new AccountVaultError('account_not_found', `unknown account id: ${accountId}`, {
        accountId,
      });
    }
    let storageState: unknown;
    try {
      storageState = JSON.parse(storageStateJson);
    } catch {
      throw new AccountVaultError('invalid_storage_state', 'storageState must be valid JSON', { accountId });
    }
    if (
      typeof storageState !== 'object' || storageState === null || Array.isArray(storageState) ||
      !Array.isArray((storageState as Record<string, unknown>).cookies) ||
      !Array.isArray((storageState as Record<string, unknown>).origins)
    ) {
      throw new AccountVaultError('invalid_storage_state', 'storageState must contain cookies and origins arrays', { accountId });
    }
    if (!this.cipher.isAvailable()) {
      throw new AccountVaultError(
        'cipher_unavailable',
        `session cipher unavailable; refusing to store session for account ${accountId} (fail closed, no plaintext fallback)`,
        { accountId },
      );
    }

    let encrypted: Buffer;
    try {
      encrypted = this.cipher.encrypt(Buffer.from(storageStateJson, 'utf-8'));
    } catch (err) {
      throw new AccountVaultError(
        'session_encrypt_failed',
        `failed to encrypt session for account ${accountId}`,
        { accountId, cause: err },
      );
    }

    const sessionRef = this.newSessionRef();
    const sessionPath = this.sessionPathFor(sessionRef);
    this.writeVerifiedSessionFile(sessionPath, encrypted, Buffer.from(storageStateJson, 'utf-8'), accountId);

    const oldRef = accounts[idx].sessionRef;
    accounts[idx] = {
      ...accounts[idx],
      sessionRef,
      status: 'valid',
      lastCheckedAt: this.nowFn(),
    };
    this.writeAccounts(accounts);
    if (oldRef && oldRef !== sessionRef) {
      rmSync(this.sessionPathFor(oldRef), { force: true });
    }
    return { ...accounts[idx] };
  }

  /**
   * 短时解密供平台调用：明文只写入本次调用独立创建的临时目录，
   * 回调结束（含抛错）后 finally 中连同目录一并删除。
   * 明文路径与内容不进入任何错误信息或日志。
   */
  async withDecryptedStorageState<T>(
    accountId: string,
    use: (plaintextPath: string) => Promise<T> | T,
  ): Promise<T> {
    const account = this.findAccountOrThrow(accountId);
    if (!account.sessionRef) {
      throw new AccountVaultError(
        'session_missing',
        `account ${accountId} has no stored session`,
        { accountId },
      );
    }
    const sessionPath = this.sessionPathFor(account.sessionRef);
    if (!existsSync(sessionPath)) {
      throw new AccountVaultError(
        'session_file_missing',
        `encrypted session file missing for account ${accountId} (ref ${account.sessionRef})`,
        { accountId },
      );
    }
    let plaintext: Buffer;
    try {
      plaintext = this.cipher.decrypt(readFileSync(sessionPath));
    } catch (err) {
      throw new AccountVaultError(
        'session_decrypt_failed',
        `failed to decrypt session for account ${accountId} (ref ${account.sessionRef})`,
        { accountId, cause: err },
      );
    }

    const tempDir = mkdtempSync(join(this.tmpBaseDir, 'session-'));
    const plaintextPath = join(tempDir, 'storageState.json');
    try {
      writeFileSync(plaintextPath, plaintext, { mode: 0o600 });
      return await use(plaintextPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // ── 旧 registry 显式迁移 ────────────────────────────────────────────────────

  /**
   * 从旧 AccountStore 数据目录（userData/publish）显式迁移：
   * - 每条旧条目生成全新 UUID 账号；明文 storageState 加密进新会话仓，
   *   写入并**回读核验一致后**才删除旧明文文件与旧 registry 条目。
   * - 加密不可用且存在待迁移明文时整体拒绝（cipher_unavailable），不触碰旧数据。
   * - 单条失败记录进 report.failed 并保留该条旧数据，不阻断其他条目。
   * - 范围外平台（bilibili）保守跳过；已迁移条目（migratedFrom 标记）幂等跳过，
   *   并顺带清理崩溃残留的旧 registry 条目 / 明文文件。
   * - 旧 registry 损坏显式抛 legacy_registry_corrupt，不做任何迁移。
   */
  migrateFromLegacy(legacyRoot: string): LegacyMigrationReport {
    const report: LegacyMigrationReport = {
      migrated: [],
      migratedWithoutSession: [],
      skipped: [],
      failed: [],
    };
    const legacyRegistryPath = join(legacyRoot, 'registry.json');
    if (!existsSync(legacyRegistryPath)) return report;

    let rawEntries: unknown;
    try {
      rawEntries = JSON.parse(readFileSync(legacyRegistryPath, 'utf-8'));
    } catch (err) {
      throw new AccountVaultError(
        'legacy_registry_corrupt',
        `legacy registry is not valid JSON: ${legacyRegistryPath}`,
        { cause: err },
      );
    }
    if (!Array.isArray(rawEntries)) {
      throw new AccountVaultError(
        'legacy_registry_corrupt',
        `legacy registry is not an array: ${legacyRegistryPath}`,
      );
    }
    const entries = rawEntries.map((raw, i) => this.parseLegacyEntry(raw, i));

    const legacyStatePathFor = (legacyId: string): string =>
      join(legacyRoot, 'accounts', `${legacyId}.json`);
    const legacyIdFor = (entry: LegacyRegistryEntry): string =>
      buildAccountId(entry.platform as PublishPlatform, entry.accountName);

    const existingMarkers = new Set(
      this.readAccounts()
        .map((a) => a.migratedFrom)
        .filter((v): v is string => v != null),
    );

    // fail closed：存在需要加密的明文会话而加密不可用时，整体拒绝，不动旧数据。
    if (!this.cipher.isAvailable()) {
      const needsCipher = entries.some(
        (e) =>
          isAccountVaultPlatform(e.platform) &&
          !existingMarkers.has(legacyIdFor(e)) &&
          existsSync(legacyStatePathFor(legacyIdFor(e))),
      );
      if (needsCipher) {
        throw new AccountVaultError(
          'cipher_unavailable',
          'session cipher unavailable; refusing legacy migration (fail closed, no plaintext fallback)',
        );
      }
    }

    const consumedLegacyIds = new Set<string>();

    for (const entry of entries) {
      const legacyId = legacyIdFor(entry);
      if (!isAccountVaultPlatform(entry.platform)) {
        report.skipped.push({ legacyId, reason: 'unsupported_platform' });
        continue;
      }
      if (existingMarkers.has(legacyId)) {
        report.skipped.push({ legacyId, reason: 'already_migrated' });
        consumedLegacyIds.add(legacyId);
        continue;
      }

      const legacyStatePath = legacyStatePathFor(legacyId);
      let plaintext: string | null = null;
      if (existsSync(legacyStatePath)) {
        try {
          plaintext = readFileSync(legacyStatePath, 'utf-8');
        } catch {
          report.failed.push({ legacyId, reason: 'legacy_read_failed' });
          continue;
        }
      }

      let sessionRef: string | null = null;
      if (plaintext !== null) {
        if (!this.cipher.isAvailable()) {
          report.failed.push({ legacyId, reason: 'cipher_unavailable' });
          continue;
        }
        let encrypted: Buffer;
        try {
          encrypted = this.cipher.encrypt(Buffer.from(plaintext, 'utf-8'));
        } catch {
          report.failed.push({ legacyId, reason: 'encrypt_failed' });
          continue;
        }
        const ref = this.newSessionRef();
        try {
          this.writeVerifiedSessionFile(
            this.sessionPathFor(ref),
            encrypted,
            Buffer.from(plaintext, 'utf-8'),
            legacyId,
          );
        } catch {
          report.failed.push({ legacyId, reason: 'verify_failed' });
          continue;
        }
        sessionRef = ref;
      }

      const account: AccountV2 = {
        id: this.randomUUIDFn(),
        platform: entry.platform,
        displayName: entry.accountName,
        owner: 'legacy-migration',
        // 明文缺失时无法核验会话，保守降级为 unknown 且不挂 sessionRef。
        status: plaintext !== null ? entry.status : 'unknown',
        sessionRef,
        lastCheckedAt: entry.lastCheckedAt,
        createdAt: this.nowFn(),
        migratedFrom: legacyId,
      };
      const accounts = this.readAccounts();
      accounts.push(account);
      this.writeAccounts(accounts);
      existingMarkers.add(legacyId);
      consumedLegacyIds.add(legacyId);

      if (plaintext !== null) report.migrated.push({ legacyId, accountId: account.id });
      else report.migratedWithoutSession.push({ legacyId, accountId: account.id });
    }

    if (consumedLegacyIds.size === 0) return report;

    // 清理旧侧：原子重写旧 registry（剔除已消费条目），随后仅对
    // “新仓中确有已核验密文副本”的条目删除旧明文文件。
    const remaining = rawEntries.filter(
      (_raw, i) => !consumedLegacyIds.has(legacyIdFor(entries[i])),
    );
    try {
      atomicWriteFileSync(legacyRegistryPath, JSON.stringify(remaining, null, 2));
    } catch (err) {
      throw new AccountVaultError(
        'legacy_registry_write_failed',
        `failed to rewrite legacy registry after migration: ${legacyRegistryPath}`,
        { cause: err },
      );
    }

    const accountsByMarker = new Map(
      this.readAccounts()
        .filter((a) => a.migratedFrom != null)
        .map((a) => [a.migratedFrom as string, a]),
    );
    for (const legacyId of consumedLegacyIds) {
      const account = accountsByMarker.get(legacyId);
      const hasVerifiedCipherCopy =
        account?.sessionRef != null && existsSync(this.sessionPathFor(account.sessionRef));
      if (account && (hasVerifiedCipherCopy || account.sessionRef === null)) {
        rmSync(legacyStatePathFor(legacyId), { force: true });
      }
    }

    return report;
  }

  // ── 内部实现 ────────────────────────────────────────────────────────────────

  private findAccountOrThrow(accountId: string): AccountV2 {
    const account = this.readAccounts().find((a) => a.id === accountId);
    if (!account) {
      throw new AccountVaultError('account_not_found', `unknown account id: ${accountId}`, {
        accountId,
      });
    }
    return account;
  }

  private newSessionRef(): string {
    return `s1-${randomBytes(16).toString('hex')}`;
  }

  private sessionPathFor(sessionRef: string): string {
    if (!/^s1-[0-9a-f]{32}$/.test(sessionRef)) {
      throw new AccountVaultError('registry_corrupt', 'invalid encrypted session reference');
    }
    return join(this.sessionsDir, `${sessionRef}${SESSION_FILE_EXT}`);
  }

  /** 原子写入密文并回读解密核验一致；失败时清理新文件并抛 session_verify_failed。 */
  private writeVerifiedSessionFile(
    sessionPath: string,
    encrypted: Buffer,
    expectedPlaintext: Buffer,
    contextId: string,
  ): void {
    try {
      atomicWriteFileSync(sessionPath, encrypted);
      const roundTrip = this.cipher.decrypt(readFileSync(sessionPath));
      if (!roundTrip.equals(expectedPlaintext)) {
        throw new Error('round-trip plaintext mismatch');
      }
    } catch (err) {
      rmSync(sessionPath, { force: true });
      throw new AccountVaultError(
        'session_verify_failed',
        `session write verification failed (${contextId})`,
        { cause: err },
      );
    }
  }

  private readAccounts(): AccountV2[] {
    if (!existsSync(this.registryPath)) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.registryPath, 'utf-8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      if (err instanceof SyntaxError) {
        throw new AccountVaultError(
          'registry_corrupt',
          `account registry is not valid JSON: ${this.registryPath}`,
          { cause: err },
        );
      }
      throw new AccountVaultError(
        'registry_read_failed',
        `failed to read account registry: ${this.registryPath}`,
        { cause: err },
      );
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new AccountVaultError(
        'registry_corrupt',
        `account registry root must be an object: ${this.registryPath}`,
      );
    }
    const file = raw as Partial<RegistryFile>;
    if (file.schemaVersion !== ACCOUNT_VAULT_SCHEMA_VERSION) {
      throw new AccountVaultError(
        'registry_unsupported_version',
        `unsupported account registry schemaVersion: ${String(file.schemaVersion)}`,
      );
    }
    if (!Array.isArray(file.accounts)) {
      throw new AccountVaultError(
        'registry_corrupt',
        `account registry "accounts" must be an array: ${this.registryPath}`,
      );
    }
    return file.accounts.map((a, i) => this.parseAccountRecord(a, i));
  }

  private parseAccountRecord(raw: unknown, index: number): AccountV2 {
    if (typeof raw !== 'object' || raw === null) {
      throw new AccountVaultError(
        'registry_corrupt',
        `account registry entry #${index} is not an object`,
      );
    }
    const e = raw as Record<string, unknown>;
    const valid =
      typeof e.id === 'string' &&
      e.id !== '' &&
      isAccountVaultPlatform(e.platform) &&
      typeof e.displayName === 'string' &&
      typeof e.owner === 'string' &&
      isAccountVaultStatus(e.status) &&
      (e.sessionRef === null || (typeof e.sessionRef === 'string' && /^s1-[0-9a-f]{32}$/.test(e.sessionRef))) &&
      (e.lastCheckedAt === null || typeof e.lastCheckedAt === 'number') &&
      typeof e.createdAt === 'number' &&
      (e.migratedFrom === null || typeof e.migratedFrom === 'string' || e.migratedFrom === undefined);
    if (!valid) {
      throw new AccountVaultError(
        'registry_corrupt',
        `account registry entry #${index} has invalid fields`,
      );
    }
    return {
      id: e.id as string,
      platform: e.platform as AccountVaultPlatform,
      displayName: e.displayName as string,
      owner: e.owner as string,
      status: e.status as AccountVaultStatus,
      sessionRef: (e.sessionRef ?? null) as string | null,
      lastCheckedAt: (e.lastCheckedAt ?? null) as number | null,
      createdAt: e.createdAt as number,
      migratedFrom: (e.migratedFrom ?? null) as string | null,
    };
  }

  private writeAccounts(accounts: AccountV2[]): void {
    const payload: RegistryFile = {
      schemaVersion: ACCOUNT_VAULT_SCHEMA_VERSION,
      accounts,
    };
    try {
      atomicWriteFileSync(this.registryPath, JSON.stringify(payload, null, 2));
    } catch (err) {
      throw new AccountVaultError(
        'registry_write_failed',
        `failed to write account registry: ${this.registryPath}`,
        { cause: err },
      );
    }
  }

  private parseLegacyEntry(raw: unknown, index: number): LegacyRegistryEntry {
    if (typeof raw !== 'object' || raw === null) {
      throw new AccountVaultError(
        'legacy_registry_corrupt',
        `legacy registry entry #${index} is not an object`,
      );
    }
    const e = raw as Record<string, unknown>;
    if (
      typeof e.platform !== 'string' ||
      e.platform === '' ||
      typeof e.accountName !== 'string' ||
      e.accountName === '' ||
      /[\\/]/.test(e.accountName) ||
      !isAccountVaultStatus(e.status) ||
      (e.lastCheckedAt != null && typeof e.lastCheckedAt !== 'number')
    ) {
      throw new AccountVaultError(
        'legacy_registry_corrupt',
        `legacy registry entry #${index} has invalid fields`,
      );
    }
    return {
      platform: e.platform,
      accountName: e.accountName,
      status: e.status,
      lastCheckedAt: typeof e.lastCheckedAt === 'number' ? e.lastCheckedAt : null,
    };
  }
}

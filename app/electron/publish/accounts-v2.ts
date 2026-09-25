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
 * - 加密不可用时 fail closed：不存在任何明文回退路径；加密子系统不可用一律
 *   分类为 cipher_unavailable，与密文损坏（session_decrypt_failed）严格区分。
 * - 所有磁盘写入原子替换（tmp + fsync + rename）：rename 前对 tmp 文件 fsync，
 *   降低异常退出造成的目标文件损坏风险；读取 /
 *   解密失败显式抛 AccountVaultError，绝不吞错后当作空账号。
 * - 平台调用只能通过 withDecryptedStorageState 拿到**短时明文**：明文只存在
 *   于每次调用独立创建的临时目录，回调结束（含抛错）后连同目录一并删除；
 *   删除对 Windows 常见 EPERM/EBUSY 做有界退避重试，重试耗尽显式抛
 *   temp_cleanup_failed，绝不静默当作成功。
 * - 旧数据迁移崩溃后可安全续清理：只有新仓 marker 对应账号存在、密文文件
 *   存在且解密结果与旧明文逐字节一致时才删除旧明文；任何核验失败一律保留。
 * - 错误与日志只包含 accountId / sessionRef / 错误码，不包含会话内容。
 *
 * 平台范围：阶段一仅抖音 / 快手 / 视频号（上游 tencent）/ 小红书；
 * 其他平台（如 bilibili）显式拒绝。
 *
 * 本模块不接 IPC、不做平台登录 / 发布；接线由后续任务完成。
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PublishPlatform } from './types';
import { buildAccountId } from './account-id';

// ─── 常量与类型 ───────────────────────────────────────────────────────────────

export const ACCOUNT_VAULT_SCHEMA_VERSION = 1;

/** 加密会话文件扩展名；文件名为不可预测的 sessionRef。 */
export const SESSION_FILE_EXT = '.bin';

/**
 * 临时明文目录删除的有界重试次数与退避基数（ms）。
 * Windows 上杀毒 / 索引器 / 文件监听器可能短暂占用刚写入的明文文件
 * （EPERM/EBUSY），一次失败就放弃会遗留明文；重试耗尽必须显式报错。
 */
const TEMP_DIR_REMOVE_ATTEMPTS = 5;
const TEMP_DIR_REMOVE_BACKOFF_MS = 25;

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
  | 'temp_cleanup_failed'
  | 'legacy_registry_corrupt'
  | 'legacy_registry_write_failed'
  | 'legacy_scan_failed';

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
  /**
   * 崩溃续清理：上次迁移在“旧 registry 已剔除条目（或整个文件缺失）”之后、
   * 删除旧明文之前中断，本次重跑经新仓密文逐字节核验一致后删除残留旧明文
   * 的记录。不含本轮新迁移的条目（它们已在 migrated / migratedWithoutSession）。
   */
  recovered: LegacyMigrationResult[];
  /**
   * 迁移调用结束后仍在旧 accounts 目录中的四平台明文文件。此列表仅用于提示
   * 人工处置；无法核验旧密文副本时绝不自动删除。旧账号已删除也会列出文件名。
   */
  retainedResiduals: Array<{
    legacyId: string;
    accountId: string | null;
    reason: 'cannot_verify' | 'untracked';
  }>;
}

export interface AccountVaultDeps {
  /** 默认 crypto.randomUUID；测试可注入。 */
  randomUUID?: () => string;
  /** 默认 Date.now；测试可注入。 */
  now?: () => number;
  /** 短时明文临时目录的基目录，默认 os.tmpdir()。 */
  tmpBaseDir?: string;
  /**
   * 临时明文目录的删除函数，默认 rmSync(recursive, force)。
   * 仅作为故障注入测试点（模拟 Windows EPERM/EBUSY）；生产路径不得注入
   * 弱化或删除该行为的实现，否则短时明文会失去清理保证。
   */
  removeDirSync?: (dir: string) => void;
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
 * 原子写：先写同目录 tmp 文件，**rename 前对 tmp 文件 fsync**；失败时保留
 * 既有目标文件。掉电持久性还取决于文件系统及目录元数据提交，不能在这里保证。
 * Windows 上目标被索引器 / 监听器短暂占用时（EPERM/EBUSY 等）做短退避重试，
 * 与 project-file.ts 的语义一致；写入 / fsync / rename 失败一律清理 tmp 并
 * 抛出原始错误（目标文件不被触碰）。有意不引入备份 / 回滚文件：崩溃时旧
 * registry 指向的旧密文尚未删除，天然一致；孤儿密文 GC 留给后续任务。
 */
function atomicWriteFileSync(targetPath: string, data: string | Buffer): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const fd = openSync(tmpPath, 'w');
  let writeError: unknown;
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } catch (err) {
    writeError = err;
  }
  try {
    closeSync(fd);
  } catch (err) {
    writeError ??= err;
  }
  if (writeError) {
    rmSync(tmpPath, { force: true });
    throw writeError;
  }
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
  private readonly removeDirSync: (dir: string) => void;

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
    this.removeDirSync = deps.removeDirSync ?? ((dir) => rmSync(dir, { recursive: true, force: true }));
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
      if (err instanceof AccountVaultError && err.code === 'cipher_unavailable') throw err;
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
    if (!this.cipher.isAvailable()) {
      throw new AccountVaultError('cipher_unavailable', `session cipher unavailable for account ${accountId}`, {
        accountId,
      });
    }
    let plaintext: Buffer;
    try {
      plaintext = this.cipher.decrypt(readFileSync(sessionPath));
    } catch (err) {
      if (err instanceof AccountVaultError && err.code === 'cipher_unavailable') throw err;
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
      this.removeTempDir(accountId, tempDir);
    }
  }

  private removeTempDir(accountId: string, tempDir: string): void {
    for (let attempt = 0; attempt < TEMP_DIR_REMOVE_ATTEMPTS; attempt += 1) {
      try {
        this.removeDirSync(tempDir);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const retryable = code === 'EBUSY' || code === 'EPERM';
        if (retryable && attempt + 1 < TEMP_DIR_REMOVE_ATTEMPTS) {
          sleepSync(TEMP_DIR_REMOVE_BACKOFF_MS * (attempt + 1));
          continue;
        }
        throw new AccountVaultError(
          'temp_cleanup_failed',
          `temporary session cleanup failed for account ${accountId}`,
          { accountId, cause: err },
        );
      }
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
      recovered: [],
      retainedResiduals: [],
    };
    const legacyRegistryPath = join(legacyRoot, 'registry.json');
    if (!existsSync(legacyRegistryPath)) {
      this.cleanupVerifiedLegacyResiduals(legacyRoot, report, new Set());
      return report;
    }

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

    const existingAccounts = this.readAccounts();
    const existingMarkers = new Set(
      existingAccounts
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
        const matches = existingAccounts.filter(
          (account) => account.migratedFrom === legacyId && account.platform === entry.platform,
        );
        const oldPath = legacyStatePathFor(legacyId);
        if (matches.length === 1 && (
          !existsSync(oldPath) || this.hasVerifiedLegacyCopy(legacyRoot, matches[0])
        )) {
          consumedLegacyIds.add(legacyId);
        }
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

    if (consumedLegacyIds.size === 0) {
      this.cleanupVerifiedLegacyResiduals(legacyRoot, report, new Set());
      return report;
    }

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

    this.cleanupVerifiedLegacyResiduals(
      legacyRoot,
      report,
      new Set(report.migrated.map((item) => item.legacyId)),
    );

    return report;
  }

  private legacyResidualPath(legacyRoot: string, account: AccountV2): string | null {
    const marker = account.migratedFrom;
    const prefix = `${account.platform}_`;
    if (!marker?.startsWith(prefix)) return null;
    const accountName = marker.slice(prefix.length);
    if (!accountName || /[\\/\0]/.test(accountName)) return null;
    const accountsRoot = resolve(legacyRoot, 'accounts');
    const candidate = resolve(accountsRoot, `${marker}.json`);
    const candidateRelative = relative(accountsRoot, candidate);
    if (!candidateRelative || candidateRelative.startsWith('..') || isAbsolute(candidateRelative)) {
      return null;
    }
    if (!existsSync(candidate)) return candidate;
    try {
      const realRoot = realpathSync(accountsRoot);
      const realCandidate = realpathSync(candidate);
      const realRelative = relative(realRoot, realCandidate);
      if (!realRelative || realRelative.startsWith('..') || isAbsolute(realRelative)) return null;
    } catch {
      return null;
    }
    return candidate;
  }

  private hasVerifiedLegacyCopy(legacyRoot: string, account: AccountV2): boolean {
    const legacyPath = this.legacyResidualPath(legacyRoot, account);
    if (!legacyPath || !existsSync(legacyPath) || !account.sessionRef || !this.cipher.isAvailable()) {
      return false;
    }
    try {
      const oldPlaintext = readFileSync(legacyPath);
      const newPlaintext = this.cipher.decrypt(readFileSync(this.sessionPathFor(account.sessionRef)));
      return oldPlaintext.equals(newPlaintext);
    } catch {
      return false;
    }
  }

  private cleanupVerifiedLegacyResiduals(
    legacyRoot: string,
    report: LegacyMigrationReport,
    migratedNow: ReadonlySet<string>,
  ): void {
    const accounts = this.readAccounts().filter((account) => account.migratedFrom !== null);
    const markerCounts = new Map<string, number>();
    for (const account of accounts) {
      const marker = account.migratedFrom as string;
      markerCounts.set(marker, (markerCounts.get(marker) ?? 0) + 1);
    }
    for (const account of accounts) {
      const marker = account.migratedFrom as string;
      if (markerCounts.get(marker) !== 1 || !this.hasVerifiedLegacyCopy(legacyRoot, account)) {
        continue;
      }
      const oldPath = this.legacyResidualPath(legacyRoot, account);
      if (!oldPath) continue;
      try {
        rmSync(oldPath, { force: true });
        if (!migratedNow.has(marker)) report.recovered.push({ legacyId: marker, accountId: account.id });
      } catch {
        // 保留旧明文供下一次迁移重试；不能仅凭 marker 报告已清理。
      }
    }

    // 清理后的残留也必须可见。会话轮换、账号删除或 cipher 不可用时，旧明文
    // 不能再通过当前密文核验；保守保留文件，并把线索交给调用者人工处置。
    const accountsRoot = resolve(legacyRoot, 'accounts');
    let filenames: string[];
    try {
      filenames = readdirSync(accountsRoot);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new AccountVaultError(
        'legacy_scan_failed',
        'failed to scan legacy account session files',
        { cause: err },
      );
    }
    for (const filename of filenames) {
      if (!filename.endsWith('.json')) continue;
      const legacyId = filename.slice(0, -'.json'.length);
      const platform = ACCOUNT_VAULT_PLATFORMS.find((value) =>
        legacyId.startsWith(`${value}_`) && legacyId.length > value.length + 1,
      );
      if (!platform) continue;
      const matches = accounts.filter(
        (account) => account.platform === platform && account.migratedFrom === legacyId,
      );
      report.retainedResiduals.push({
        legacyId,
        accountId: matches.length === 1 ? matches[0].id : null,
        reason: matches.length === 1 ? 'cannot_verify' : 'untracked',
      });
    }
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
      if (err instanceof AccountVaultError && err.code === 'cipher_unavailable') throw err;
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

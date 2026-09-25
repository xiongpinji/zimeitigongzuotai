/**
 * A2-S1：account-v2 主进程账号服务 / IPC 注册工厂（可注入，未接线）。
 *
 * 边界声明：
 * - 本模块**不导入 electron**（连类型导入也没有）：ipcMain 与事件发送器由调用方
 *   按结构化接口注入。生产接线（A2-S2）传入 electron `ipcMain` 与
 *   `webContents.send` / invoke 事件 `sender.send`；测试传入假 IPC。纯 Node 可加载。
 * - 只注册 `account-v2:*` 通道；不触旧 `publish:*`、AccountStore、runner、
 *   queue-platform-adapter；不调用 migrateFromLegacy（只读迁移预览是 S4，破坏性
 *   迁移在 P1 之前不可达）。
 * - 一切返回值 / 事件都是以 UUID 为键的安全 DTO：绝不含 sessionRef、
 *   storageStatePath、Cookie / Token、任何文件系统路径、平台或异常的原始文本；
 *   错误只返回固定错误码与常量消息（ACCOUNT_V2_ERROR_MESSAGES）。
 * - `login` 同时服务首次登录与既有 UUID 账号的续登：平台调用只能经
 *   AccountVault.withLoginStorageState（A1 事务）；成功提交由 A1 的加密 + 回读
 *   核验完成，失败 / 异常 / 畸形输出一律不覆盖既有密文。调用方在 invoke 前生成
 *   UUID 格式 requestId，二维码事件据此在 Promise 落定前完成关联。
 * - 二维码回调只读**本次登录临时 storageState 所在真实目录**内的普通 PNG：
 *   lstat 拒绝 symlink / 非普通文件，realpath 父目录必须与临时目录一致，
 *   同一 fd 上有界读取（≤512 KiB）并校验 PNG 魔数，每次登录最多 64 个事件。
 *   任何违规（含事件发送失败）置失败闩锁并抛出固定文案异常；即便平台代码吞掉
 *   该异常并报 success:true，回调结果也被强制为 success:false（绝不提交会话），
 *   IPC 返回固定 qrcode_failed。事件只携带 data:image/png;base64,...，绝不携带
 *   磁盘路径。lstat → open → fstat/read 之间存在理论 TOCTOU 窗口，以“同 fd
 *   有界读取 + 魔数校验 + 尺寸上限”收敛危害（见验证文档披露）。
 * - 平台登录 Promise 一旦落定（成功、失败或抛错）立即关闭本次二维码闸门：
 *   平台保留的迟到回调此后安静返回——不发送事件、不抛出异常、不改变已提交
 *   结果；登录进行中仍按 S1 的失败闩锁约束处理。
 * - 单账号登录互斥：同账号并发登录、登录进行中删除该账号 → login_busy；
 *   不同账号完全独立。探针不阻塞登录，但在解密前快照 sessionRef，await 平台
 *   返回后重读账号：期间重登轮换（或删除）则该过期探针结果一律拒绝
 *   （session_changed / account_not_found），绝不写入新提交的会话。每账号维护
 *   探针启动单调序号：同账号一旦有更晚启动的探针，较早探针的结果一律作废
 *   并返回固定 probe_superseded（不写状态），保证“最近开始的探针”独占写权；
 *   不同账号各自独立。
 * - create 在 IPC 入口对 displayName / owner 实施保守长度上限与控制字符
 *   （C0/C1）拒绝，固定 invalid_request；同平台同名合法实例仍分别持有独立 UUID。
 * - 平台原始 message、Error.message、AccountVaultError.message 一律不作为
 *   IPC 载荷；AccountVaultError.code 经固定映射表脱敏为稳定错误码。
 */
import { closeSync, fstatSync, lstatSync, openSync, realpathSync, readSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ACCOUNT_VAULT_PLATFORMS,
  AccountVaultError,
  type AccountV2,
  type AccountVault,
  type AccountVaultErrorCode,
  type AccountVaultPlatform,
  type AccountVaultStatus,
} from './accounts-v2';
import type { LoginOptions } from './types';

// ─── 通道与策略常量 ───────────────────────────────────────────────────────────

export const ACCOUNT_V2_IPC_CHANNELS = {
  create: 'account-v2:create',
  list: 'account-v2:list',
  login: 'account-v2:login',
  check: 'account-v2:check',
  delete: 'account-v2:delete',
  /** 二维码数据事件（主进程 → Renderer）；载荷见 AccountV2QrcodeEvent。 */
  qrcode: 'account-v2:qrcode',
} as const;

/** PNG 魔数（8 字节文件头）。 */
const QR_PNG_MAGIC: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 单个二维码 PNG 的尺寸上限（计划固定策略：512 KiB）。 */
const QR_MAX_BYTES = 512 * 1024;
/** 单次登录请求允许发送的二维码事件上限（计划固定策略：64）。 */
const QR_MAX_EVENTS = 64;

/** 通用 UUID 格式：accountId 由 vault 生成，requestId 由调用方预先生成。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * displayName / owner 的保守文本上限（UTF-16 code units）与控制字符拒绝集。
 * 上限只约束 IPC 入口；同平台同名合法实例仍各自持有独立 UUID。
 */
export const ACCOUNT_V2_MAX_DISPLAY_NAME_LENGTH = 64;
export const ACCOUNT_V2_MAX_OWNER_LENGTH = 64;

/** C0（U+0000–U+001F）与 C1（U+007F–U+009F）控制字符拒绝集。 */
const ACCOUNT_TEXT_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

// ─── 错误码与固定消息 ─────────────────────────────────────────────────────────

export type AccountV2ErrorCode =
  | 'invalid_request'
  | 'unsupported_platform'
  | 'account_not_found'
  | 'login_busy'
  | 'cipher_unavailable'
  | 'session_missing'
  | 'session_file_missing'
  | 'session_decrypt_failed'
  | 'session_changed'
  | 'temp_cleanup_failed'
  | 'login_failed'
  | 'login_result_invalid'
  | 'qrcode_failed'
  | 'probe_failed'
  | 'probe_superseded'
  | 'vault_error'
  | 'internal_error';

/**
 * 每个错误码对应且仅对应一条常量消息（无插值、无路径、无原文）。
 * Renderer（S3）按 code 自行本地化；message 仅供日志与调试。
 */
export const ACCOUNT_V2_ERROR_MESSAGES: Readonly<Record<AccountV2ErrorCode, string>> = {
  invalid_request: 'The request payload is malformed.',
  unsupported_platform: 'This platform is not supported by the phase-1 account service.',
  account_not_found: 'The account does not exist.',
  login_busy: 'A login is already in progress for this account.',
  cipher_unavailable: 'Session encryption is unavailable; the operation was refused.',
  session_missing: 'The account has no stored session.',
  session_file_missing: 'The stored session file is missing.',
  session_decrypt_failed: 'The stored session could not be decrypted.',
  session_changed: 'The stored session changed during login; the commit was refused.',
  temp_cleanup_failed: 'Temporary session cleanup failed.',
  login_failed: 'The login did not complete successfully.',
  login_result_invalid: 'The login produced no verifiable session output.',
  qrcode_failed: 'QR code delivery violated the security policy; the login was refused.',
  probe_failed: 'The session probe failed.',
  probe_superseded: 'A newer session probe superseded this result.',
  vault_error: 'Account storage failed the operation.',
  internal_error: 'An internal error occurred.',
};

/**
 * AccountVaultError.code → IPC 稳定错误码的固定映射（穷举，新增 vault 错误码
 * 必须在此显式归类）。vault 的 message 绝不透传；映射只依赖 code。
 */
const VAULT_CODE_TO_IPC: Readonly<Record<AccountVaultErrorCode, AccountV2ErrorCode>> = {
  invalid_platform: 'unsupported_platform',
  invalid_account: 'invalid_request',
  invalid_storage_state: 'login_result_invalid',
  account_not_found: 'account_not_found',
  registry_corrupt: 'vault_error',
  registry_unsupported_version: 'vault_error',
  registry_read_failed: 'vault_error',
  registry_write_failed: 'vault_error',
  session_missing: 'session_missing',
  session_file_missing: 'session_file_missing',
  session_decrypt_failed: 'session_decrypt_failed',
  session_encrypt_failed: 'vault_error',
  session_verify_failed: 'vault_error',
  cipher_unavailable: 'cipher_unavailable',
  temp_cleanup_failed: 'temp_cleanup_failed',
  login_callback_failed: 'login_failed',
  login_result_invalid: 'login_result_invalid',
  session_changed: 'session_changed',
  legacy_registry_corrupt: 'vault_error',
  legacy_registry_write_failed: 'vault_error',
  legacy_scan_failed: 'vault_error',
};

// ─── 安全 DTO 与结果形状 ─────────────────────────────────────────────────────

/**
 * 跨 IPC 的账号安全投影：以 UUID 为唯一键；displayName 仅 UI 展示（非唯一、
 * 不参与任何路径）；sessionRef 以 hasSession 布尔替代；不含 migratedFrom、
 * 任何路径、Cookie / Token。
 */
export interface AccountV2Dto {
  id: string;
  platform: AccountVaultPlatform;
  displayName: string;
  owner: string;
  status: AccountVaultStatus;
  hasSession: boolean;
  lastCheckedAt: number | null;
  createdAt: number;
}

/** 二维码数据事件：绝不含磁盘路径；imageDataUrl 为 data:image/png;base64,...。 */
export interface AccountV2QrcodeEvent {
  /** 调用方在 invoke login 之前生成的 UUID，用于 Promise 落定前关联事件。 */
  requestId: string;
  accountId: string;
  /** 本次登录内从 1 开始递增。 */
  sequence: number;
  imageDataUrl: string;
}

export interface AccountV2ErrorResult {
  ok: false;
  code: AccountV2ErrorCode;
  message: string;
}

export type AccountV2CreateResult = { ok: true; account: AccountV2Dto } | AccountV2ErrorResult;
export type AccountV2ListResult = { ok: true; accounts: AccountV2Dto[] } | AccountV2ErrorResult;
export type AccountV2LoginResult = { ok: true; account: AccountV2Dto } | AccountV2ErrorResult;
export type AccountV2CheckResult =
  | { ok: true; valid: boolean; account: AccountV2Dto }
  | AccountV2ErrorResult;
export type AccountV2DeleteResult = { ok: true; accountId: string } | AccountV2ErrorResult;

export function toAccountV2Dto(account: AccountV2): AccountV2Dto {
  return {
    id: account.id,
    platform: account.platform,
    displayName: account.displayName,
    owner: account.owner,
    status: account.status,
    hasSession: account.sessionRef !== null,
    lastCheckedAt: account.lastCheckedAt,
    createdAt: account.createdAt,
  };
}

// ─── 依赖注入接口（结构化，electron 零依赖） ─────────────────────────────────

/** 结构化 ipcMain：electron 的 `ipcMain` 直接满足（方法参数双变）。 */
export interface AccountIpcSenderLike {
  send(channel: string, ...args: unknown[]): void;
}

export interface AccountIpcEventLike {
  sender: AccountIpcSenderLike;
}

export interface AccountIpcMainLike {
  handle(
    channel: string,
    listener: (event: AccountIpcEventLike, ...args: unknown[]) => unknown,
  ): void;
}

/** AccountVault 的本服务消费面；生产实现即 AccountVault 实例。 */
export type AccountVaultPort = Pick<
  AccountVault,
  | 'createAccount'
  | 'listAccounts'
  | 'getAccount'
  | 'updateStatusFromProbe'
  | 'removeAccount'
  | 'withDecryptedStorageState'
  | 'withLoginStorageState'
>;

/** 平台模块消费面（四平台模块结构上满足；绝不消费 uploadVideo）。 */
export interface AccountPlatformLike {
  login(opts: LoginOptions): Promise<{ success: boolean; message: string }>;
  checkCookie(storageStatePath: string): Promise<boolean>;
}

/** 返回 null / undefined 表示该平台模块不可用 → unsupported_platform。 */
export type AccountPlatformFactory = (
  platform: AccountVaultPlatform,
) => AccountPlatformLike | null | undefined;

export interface AccountsV2IpcDeps {
  ipc: AccountIpcMainLike;
  vault: AccountVaultPort;
  platformFactory: AccountPlatformFactory;
  /**
   * 事件发送器（生产为 webContents.send 兼容签名）。缺省时回退到 invoke 事件
   * 自带的 sender.send（与旧 download-ipc 的进度转发方式一致）。
   */
  sendEvent?: (channel: string, payload: AccountV2QrcodeEvent) => void;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

function errorResult(code: AccountV2ErrorCode): AccountV2ErrorResult {
  return { ok: false, code, message: ACCOUNT_V2_ERROR_MESSAGES[code] };
}

/**
 * 任意异常 → 固定错误载荷。AccountVaultError 只消费 code（固定映射表）；
 * 其他一切异常（平台原始 Error、字符串抛出等）按调用上下文回退为稳定码，
 * err.message 绝不进入返回值。
 */
function mapThrownError(err: unknown, fallback: AccountV2ErrorCode): AccountV2ErrorResult {
  if (err instanceof AccountVaultError) {
    return errorResult(VAULT_CODE_TO_IPC[err.code] ?? 'vault_error');
  }
  return errorResult(fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuidString(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** IPC 入口的保守文本校验：类型、长度上限与控制字符（C0/C1）拒绝。 */
function isSafeAccountText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    !ACCOUNT_TEXT_CONTROL_RE.test(value)
  );
}

interface QrGate {
  /** 事务回调开始时绑定本次临时 storageState 路径（决定合法二维码目录）。 */
  bind(storageStatePath: string): void;
  /** 平台登录 Promise 落定后的静默关闭点；此后迟到回调一律安静丢弃。 */
  close(): void;
  isLatched(): boolean;
  onQrcode(pngPath: string): void;
}

/**
 * 单次登录的二维码闸门：目录约束 + symlink / 普通文件判定 + 有界读取 +
 * PNG 魔数 + 事件上限；任何违规置闩锁并抛出固定文案异常（平台可能吞掉，
 * 闩锁仍会在回调返回处强制登录失败）。事件发送失败同样 fail closed。
 */
function createQrGate(
  requestId: string,
  accountId: string,
  send: (payload: AccountV2QrcodeEvent) => void,
): QrGate {
  let realDir: string | null = null;
  let latched = false;
  let closed = false;
  let sentCount = 0;

  const rejectQrcode = (): never => {
    latched = true;
    throw new Error('account-v2: qrcode callback rejected');
  };

  return {
    bind(storageStatePath: string): void {
      try {
        realDir = realpathSync(dirname(storageStatePath));
      } catch {
        realDir = null;
      }
    },

    close(): void {
      closed = true;
    },

    isLatched(): boolean {
      return latched;
    },

    onQrcode(pngPath: string): void {
      // 迟到回调：平台登录 Promise 已落定，安静丢弃（不发送、不抛出、不改变
      // 已提交结果）；登录进行中的违规仍走闩锁 + 固定异常。
      if (closed) return;
      if (latched) return rejectQrcode();
      if (sentCount >= QR_MAX_EVENTS) return rejectQrcode();
      if (typeof pngPath !== 'string' || pngPath.length === 0 || realDir === null) {
        return rejectQrcode();
      }
      // 1) symlink / 非普通文件：lstat 不跟随链接。
      try {
        const stats = lstatSync(pngPath);
        if (stats.isSymbolicLink() || !stats.isFile()) return rejectQrcode();
      } catch {
        return rejectQrcode();
      }
      // 2) 真实父目录必须与本次临时 storageState 的真实目录完全一致。
      try {
        if (realpathSync(dirname(resolve(pngPath))) !== realDir) return rejectQrcode();
      } catch {
        return rejectQrcode();
      }
      // 3) 同一 fd 上有界读取（open → fstat → read），尺寸 / 魔数校验；
      //    发送失败一并 fail closed。
      let fd = -1;
      try {
        fd = openSync(pngPath, 'r');
        const fdStats = fstatSync(fd);
        if (
          !fdStats.isFile() ||
          fdStats.size > QR_MAX_BYTES ||
          fdStats.size < QR_PNG_MAGIC.length
        ) {
          return rejectQrcode();
        }
        const bytes = Buffer.alloc(fdStats.size);
        let offset = 0;
        while (offset < bytes.length) {
          const read = readSync(fd, bytes, offset, bytes.length - offset, null);
          if (read <= 0) return rejectQrcode();
          offset += read;
        }
        if (!bytes.subarray(0, QR_PNG_MAGIC.length).equals(QR_PNG_MAGIC)) {
          return rejectQrcode();
        }
        sentCount += 1;
        send({
          requestId,
          accountId,
          sequence: sentCount,
          imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        });
      } catch {
        return rejectQrcode();
      } finally {
        if (fd >= 0) {
          try {
            closeSync(fd);
          } catch {
            // close 失败不改变已决定的事件 / 闩锁语义。
          }
        }
      }
    },
  };
}

// ─── 注册工厂 ─────────────────────────────────────────────────────────────────

/**
 * 注册 account-v2 IPC（每次调用独立闭包状态，可重复注册到不同假 ipc 做测试）。
 * handler 一律返回结果对象、绝不向 ipcMain 抛异常（避免 electron 序列化
 * 未知异常文本）。
 */
export function registerAccountsV2Ipc(deps: AccountsV2IpcDeps): void {
  const { ipc, vault, platformFactory } = deps;
  /** 单账号登录互斥；不同账号互不影响。 */
  const loginsInFlight = new Set<string>();
  /** 每账号探针启动序号（同账号乱序探针只有最新启动者的结果能写状态）。 */
  const probeStartSeq = new Map<string, number>();

  const qrcodeSenderFor = (
    event: AccountIpcEventLike,
  ): ((payload: AccountV2QrcodeEvent) => void) => {
    const injected = deps.sendEvent;
    if (injected) {
      return (payload) => injected(ACCOUNT_V2_IPC_CHANNELS.qrcode, payload);
    }
    return (payload) => event.sender.send(ACCOUNT_V2_IPC_CHANNELS.qrcode, payload);
  };

  const resolvePlatformModule = (
    platform: AccountVaultPlatform,
  ): AccountPlatformLike | undefined => {
    let resolved: AccountPlatformLike | null | undefined;
    try {
      resolved = platformFactory(platform);
    } catch {
      return undefined;
    }
    return resolved ?? undefined;
  };

  // ── create ──────────────────────────────────────────────────────────────────
  const handleCreate = (payload: unknown): AccountV2CreateResult => {
    if (!isRecord(payload)) return errorResult('invalid_request');
    const { platform, displayName, owner } = payload;
    if (typeof platform !== 'string') return errorResult('invalid_request');
    // 四平台白名单前置校验（bilibili / 别名映射名在触到 vault 之前拒绝）。
    if (!(ACCOUNT_VAULT_PLATFORMS as readonly string[]).includes(platform)) {
      return errorResult('unsupported_platform');
    }
    if (
      !isSafeAccountText(displayName, ACCOUNT_V2_MAX_DISPLAY_NAME_LENGTH) ||
      displayName.trim() === ''
    ) {
      return errorResult('invalid_request');
    }
    if (owner !== undefined && !isSafeAccountText(owner, ACCOUNT_V2_MAX_OWNER_LENGTH)) {
      return errorResult('invalid_request');
    }
    try {
      const account = vault.createAccount({
        platform,
        displayName,
        ...(typeof owner === 'string' ? { owner } : {}),
      });
      return { ok: true, account: toAccountV2Dto(account) };
    } catch (err) {
      return mapThrownError(err, 'internal_error');
    }
  };

  // ── list ────────────────────────────────────────────────────────────────────
  const handleList = (): AccountV2ListResult => {
    try {
      return { ok: true, accounts: vault.listAccounts().map(toAccountV2Dto) };
    } catch (err) {
      return mapThrownError(err, 'internal_error');
    }
  };

  // ── login（首登与续登共用；requestId 由调用方预先生成用于事件关联） ────────
  const handleLogin = async (
    event: AccountIpcEventLike,
    payload: unknown,
  ): Promise<AccountV2LoginResult> => {
    if (!isRecord(payload)) return errorResult('invalid_request');
    const accountIdRaw: unknown = payload.accountId;
    const requestIdRaw: unknown = payload.requestId;
    if (!isUuidString(accountIdRaw) || !isUuidString(requestIdRaw)) {
      return errorResult('invalid_request');
    }
    const accountId: string = accountIdRaw;
    const requestId: string = requestIdRaw;
    let headless = true;
    const headlessRaw: unknown = payload.headless;
    if (headlessRaw !== undefined) {
      if (typeof headlessRaw !== 'boolean') return errorResult('invalid_request');
      headless = headlessRaw;
    }
    // 平台调用前的互斥与存在性校验。
    if (loginsInFlight.has(accountId)) return errorResult('login_busy');
    let account: AccountV2;
    try {
      account = vault.getAccount(accountId);
    } catch (err) {
      return mapThrownError(err, 'internal_error');
    }
    const platformModule = resolvePlatformModule(account.platform);
    if (!platformModule) return errorResult('unsupported_platform');

    loginsInFlight.add(accountId);
    const gate = createQrGate(requestId, accountId, qrcodeSenderFor(event));
    try {
      let result: { success: boolean };
      try {
        result = await vault.withLoginStorageState<{ success: boolean }>(
          accountId,
          async (storageStatePath) => {
            gate.bind(storageStatePath);
            let raw: { success: boolean };
            try {
              raw = await platformModule.login({
                storageStatePath,
                headless,
                onQrcode: gate.onQrcode,
              });
            } finally {
              // 平台登录 Promise 一旦落定（成功、失败或抛错）立即关闭二维码
              // 闸门：平台保留的迟到回调从此安静返回，绝不发送事件 / 抛入
              // 异步上下文 / 改变本次登录已提交的结果。
              gate.close();
            }
            // 失败闩锁：任何二维码回调违规（含平台吞掉回调异常后报成功）
            // 都强制按失败返回，A1 事务因此绝不提交本次候选明文。
            return gate.isLatched() ? { success: false } : raw;
          },
        );
      } catch (err) {
        if (gate.isLatched()) return errorResult('qrcode_failed');
        return mapThrownError(err, 'login_failed');
      }
      if (gate.isLatched()) return errorResult('qrcode_failed');
      if (result.success !== true) return errorResult('login_failed');
      // success:true 且未被闩锁 → A1 事务已完成加密 + 回读核验提交。
      try {
        return { ok: true, account: toAccountV2Dto(vault.getAccount(accountId)) };
      } catch (err) {
        return mapThrownError(err, 'internal_error');
      }
    } finally {
      loginsInFlight.delete(accountId);
    }
  };

  // ── check（探针：仅明确布尔结果才更新目标账号） ────────────────────────────
  const handleCheck = async (payload: unknown): Promise<AccountV2CheckResult> => {
    if (!isRecord(payload)) return errorResult('invalid_request');
    const accountIdRaw: unknown = payload.accountId;
    if (!isUuidString(accountIdRaw)) return errorResult('invalid_request');
    const accountId: string = accountIdRaw;
    let account: AccountV2;
    try {
      account = vault.getAccount(accountId);
    } catch (err) {
      return mapThrownError(err, 'internal_error');
    }
    const platformModule = resolvePlatformModule(account.platform);
    if (!platformModule) return errorResult('unsupported_platform');
    // 探针只对读取时看到的那一代会话（sessionRef）有效：回调返回前账号可能已经
    // 重登提交（A1 事务轮换 sessionRef）或被删除。withDecryptedStorageState 的
    // 同步段与本次 getAccount 之间没有 await 点，快照即探针实际解密的那一代。
    const probedSessionRef = account.sessionRef;
    // 每账号探针启动单调序号：同账号一旦有更晚启动的探针，本探针结果一律作废
    // （probe_superseded），保证“最近开始的探针”独占状态写权。
    const probeSeq = (probeStartSeq.get(accountId) ?? 0) + 1;
    probeStartSeq.set(accountId, probeSeq);
    let probe: unknown;
    try {
      // 明文只存在于 vault 的短时临时事务内；平台异常 / vault 异常都不更新状态。
      probe = await vault.withDecryptedStorageState<unknown>(accountId, (plaintextPath) =>
        platformModule.checkCookie(plaintextPath),
      );
    } catch (err) {
      return mapThrownError(err, 'probe_failed');
    }
    if (typeof probe !== 'boolean') return errorResult('probe_failed');
    try {
      // await 之后、写状态之前重读账号：sessionRef 已轮换 → 过期探针结果一律
      // 拒绝（session_changed），绝不把旧会话的探针写入新提交的会话；账号已被
      // 删除则 getAccount 抛 account_not_found，保持删除且不写状态。
      const current = vault.getAccount(accountId);
      if (current.sessionRef !== probedSessionRef) return errorResult('session_changed');
      if (probeStartSeq.get(accountId) !== probeSeq) return errorResult('probe_superseded');
      const updated = vault.updateStatusFromProbe(accountId, probe);
      return { ok: true, valid: probe, account: toAccountV2Dto(updated) };
    } catch (err) {
      return mapThrownError(err, 'internal_error');
    }
  };

  // ── delete（登录进行中 → login_busy，不触 vault） ──────────────────────────
  const handleDelete = (payload: unknown): AccountV2DeleteResult => {
    if (!isRecord(payload)) return errorResult('invalid_request');
    const accountIdRaw: unknown = payload.accountId;
    if (!isUuidString(accountIdRaw)) return errorResult('invalid_request');
    const accountId: string = accountIdRaw;
    if (loginsInFlight.has(accountId)) return errorResult('login_busy');
    try {
      vault.removeAccount(accountId);
    } catch (err) {
      return mapThrownError(err, 'internal_error');
    }
    // 账号已删除：其探针序号无意义；在途探针在 await 后重读账号时先得到
    // account_not_found，不会触碰该序号。
    probeStartSeq.delete(accountId);
    return { ok: true, accountId };
  };

  ipc.handle(ACCOUNT_V2_IPC_CHANNELS.create, (_event, payload) => handleCreate(payload));
  ipc.handle(ACCOUNT_V2_IPC_CHANNELS.list, () => handleList());
  ipc.handle(ACCOUNT_V2_IPC_CHANNELS.login, (event, payload) => handleLogin(event, payload));
  ipc.handle(ACCOUNT_V2_IPC_CHANNELS.check, (_event, payload) => handleCheck(payload));
  ipc.handle(ACCOUNT_V2_IPC_CHANNELS.delete, (_event, payload) => handleDelete(payload));
}

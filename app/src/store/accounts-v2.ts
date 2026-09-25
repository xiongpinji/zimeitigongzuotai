/**
 * A2-S3：安全账号（account-v2）的 Renderer 端**仅内存**状态。
 *
 * 边界声明：
 * - 只消费 `window.accountV2API` 的脱敏 DTO；内部以 UUID 为键（`byId` + 顺序
 *   数组），绝不以 `platform/displayName` 去重、绝不写回旧 `publish` store。
 * - 不持久化：账号状态（含二维码）只活在当前渲染进程内存里，不写 localStorage
 *   / sessionStorage / 任何磁盘。
 * - 错误只保留主进程固定错误码，并映射为仓内固定中文文案；主进程 message、
 *   平台原文、路径、Cookie / Token 一律不进入状态与界面。
 * - 旧发布链（`window.publishAPI`、`store/publish.ts`）与旧账号 ID 完全隔离：
 *   本模块不引用、不调用旧桥。
 */
import { create } from 'zustand';
import type {
  AccountV2API,
  AccountV2CheckResult,
  AccountV2CreateResult,
  AccountV2DeleteResult,
  AccountV2Dto,
  AccountV2ListResult,
  AccountV2LoginResult,
  AccountV2Platform,
} from '../lib/electron-api';

/** 主进程固定错误码（从桥的返回联合类型推导，避免渲染层直接依赖 electron 模块）。 */
export type AccountV2ErrorCode = Extract<AccountV2CheckResult, { ok: false }>['code'];

/** 每个错误码对应的固定中文文案；不做插值，不含路径 / 平台原文。 */
export const ACCOUNT_V2_ERROR_TEXT: Readonly<Record<AccountV2ErrorCode, string>> = {
  invalid_request: '请求参数不合法，请检查账号名称后重试。',
  unsupported_platform: '该平台暂不支持安全账号服务。',
  account_not_found: '账号不存在或已被删除。',
  login_busy: '该账号正在登录中，请稍后再试。',
  cipher_unavailable: '会话加密不可用，本次操作已被拒绝。',
  session_missing: '该账号尚无已保存的登录会话。',
  session_file_missing: '本地会话文件缺失，请重新登录。',
  session_decrypt_failed: '本地会话无法解密，请重新登录。',
  session_changed: '登录期间会话已被更换，本次结果未写入。',
  temp_cleanup_failed: '临时会话清理失败。',
  login_failed: '扫码登录未完成，账号已保留，可重试或删除。',
  login_result_invalid: '登录未产生可用的会话，请重试。',
  qrcode_failed: '二维码安全校验未通过，本次登录已被拒绝。',
  probe_failed: '会话检查失败，请稍后重试。',
  probe_superseded: '已有更新的检查结果覆盖了本次结果。',
  vault_error: '账号存储操作失败。',
  internal_error: '发生内部错误，请稍后重试。',
};

const FALLBACK_ERROR_TEXT = '操作失败，请稍后重试。';
const BRIDGE_MISSING_TEXT = '安全账号服务不可用，请重启应用后再试。';

export interface AccountsV2UiError {
  code: AccountV2ErrorCode;
  /** 仓内固定中文文案（绝不透传主进程 / 平台原文）。 */
  message: string;
}

export type AccountsV2Result<T> =
  | ({ ok: true } & T)
  | ({ ok: false } & AccountsV2UiError);

interface AccountsV2State {
  /** 账号列表，顺序为首次出现顺序；UUID 是唯一键。 */
  accounts: AccountV2Dto[];
  /** UUID → DTO 投影；同名账号各自独立。 */
  byId: Record<string, AccountV2Dto>;
  loading: boolean;

  /** 仅供测试与页面重置使用：清空内存状态。 */
  reset: () => void;

  load: () => Promise<AccountsV2Result<{ accounts: AccountV2Dto[] }>>;
  create: (
    platform: AccountV2Platform,
    displayName: string,
    owner?: string,
  ) => Promise<AccountsV2Result<{ account: AccountV2Dto }>>;
  login: (
    accountId: string,
    requestId: string,
    headless?: boolean,
  ) => Promise<AccountsV2Result<{ account: AccountV2Dto }>>;
  check: (accountId: string) => Promise<AccountsV2Result<{ valid: boolean; account: AccountV2Dto }>>;
  remove: (accountId: string) => Promise<AccountsV2Result<{ accountId: string }>>;
}

function safeErrorCode(code: unknown): AccountV2ErrorCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(ACCOUNT_V2_ERROR_TEXT, code)
    ? (code as AccountV2ErrorCode)
    : 'internal_error';
}

/** ok=false 结果统一脱敏：只消费 code，message 一律用仓内固定文案。 */
function errorFromResult(result: { code: unknown }): { ok: false } & AccountsV2UiError {
  const code = safeErrorCode(result.code);
  return { ok: false, code, message: ACCOUNT_V2_ERROR_TEXT[code] };
}

function internalError(): { ok: false } & AccountsV2UiError {
  return { ok: false, code: 'internal_error', message: ACCOUNT_V2_ERROR_TEXT.internal_error };
}

function bridgeMissing(): { ok: false } & AccountsV2UiError {
  return { ok: false, code: 'internal_error', message: BRIDGE_MISSING_TEXT };
}

function getApi(): AccountV2API | null {
  if (typeof window === 'undefined') return null;
  return window.accountV2API ?? null;
}

interface AccountsV2Snapshot {
  accounts: AccountV2Dto[];
  byId: Record<string, AccountV2Dto>;
}

/** 只更新对应 UUID：同 UUID 覆盖，新 UUID 追加，其他行原样保留。 */
function withAccount(snapshot: AccountsV2Snapshot, account: AccountV2Dto): AccountsV2Snapshot {
  const existing = snapshot.byId[account.id];
  return {
    byId: { ...snapshot.byId, [account.id]: account },
    accounts: existing
      ? snapshot.accounts.map((item) => (item.id === account.id ? account : item))
      : [...snapshot.accounts, account],
  };
}

function withoutAccount(snapshot: AccountsV2Snapshot, accountId: string): AccountsV2Snapshot {
  const byId = { ...snapshot.byId };
  delete byId[accountId];
  return { byId, accounts: snapshot.accounts.filter((item) => item.id !== accountId) };
}

let latestLoadRequest = 0;

export const useAccountsV2Store = create<AccountsV2State>((set, get) => ({
  accounts: [],
  byId: {},
  loading: false,

  reset: () => {
    latestLoadRequest += 1;
    set({ accounts: [], byId: {}, loading: false });
  },

  load: async () => {
    const api = getApi();
    if (!api) return bridgeMissing();
    const request = ++latestLoadRequest;
    set({ loading: true });
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const beforeList = get().byId;
        const result: AccountV2ListResult = await api.list();
        if (request !== latestLoadRequest) {
          return { ok: true, accounts: get().accounts };
        }
        if (!result.ok) {
          set({ loading: false });
          return errorFromResult(result);
        }
        // 若 list 请求期间本页完成创建/登录/检查/删除，旧快照不能覆盖新状态。
        // 重读主进程最新列表；持续变化时保留当前内存投影，避免无界重试。
        if (get().byId !== beforeList) {
          if (attempt < 2) continue;
          set({ loading: false });
          return { ok: true, accounts: get().accounts };
        }
        const byId: Record<string, AccountV2Dto> = {};
        const accounts: AccountV2Dto[] = [];
        for (const account of result.accounts) {
          if (!account || typeof account.id !== 'string' || account.id.length === 0) continue;
          // 只按 UUID 防重；同平台同名不做任何合并。
          if (byId[account.id]) continue;
          byId[account.id] = account;
          accounts.push(account);
        }
        set({ accounts, byId, loading: false });
        return { ok: true, accounts };
      }
      return { ok: true, accounts: get().accounts };
    } catch {
      if (request === latestLoadRequest) set({ loading: false });
      return internalError();
    }
  },

  create: async (platform, displayName, owner) => {
    const api = getApi();
    if (!api) return bridgeMissing();
    try {
      const result: AccountV2CreateResult = await api.create(platform, displayName, owner);
      if (!result.ok) return errorFromResult(result);
      set((state) => withAccount(state, result.account));
      return { ok: true, account: result.account };
    } catch {
      return internalError();
    }
  },

  login: async (accountId, requestId, headless) => {
    const api = getApi();
    if (!api) return bridgeMissing();
    try {
      const result: AccountV2LoginResult = await api.login({ accountId, requestId, headless });
      if (!result.ok) return errorFromResult(result);
      set((state) => withAccount(state, result.account));
      return { ok: true, account: result.account };
    } catch {
      return internalError();
    }
  },

  check: async (accountId) => {
    const api = getApi();
    if (!api) return bridgeMissing();
    try {
      const result: AccountV2CheckResult = await api.check(accountId);
      if (!result.ok) return errorFromResult(result);
      set((state) => withAccount(state, result.account));
      return { ok: true, valid: result.valid, account: result.account };
    } catch {
      return internalError();
    }
  },

  remove: async (accountId) => {
    const api = getApi();
    if (!api) return bridgeMissing();
    try {
      const result: AccountV2DeleteResult = await api.delete(accountId);
      if (!result.ok) return errorFromResult(result);
      set((state) => withoutAccount(state, result.accountId));
      return { ok: true, accountId: result.accountId };
    } catch {
      return internalError();
    }
  },
}));

// @vitest-environment jsdom
/**
 * A2-S3 合成 RED 测试：account-v2 安全账号的 Renderer 端仅内存 store。
 *
 * 全部数据合成：假 `window.accountV2API`（不触真实 IPC / 平台 / userData）。
 * 断言锁定以下契约：
 * - 同平台同名账号按 UUID 独立存放，绝不以 platform/displayName 去重；
 * - create/login/check/delete 的结果只合并到目标 UUID，其他行对象不受影响；
 * - 登录失败保留原 unknown 账号（不删除、不改 hasSession）；
 * - 错误只暴露固定 code + 固定中文文案，平台/主进程原文与路径绝不进入状态；
 * - 仅内存：不写 localStorage。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountV2Dto } from '../src/lib/electron-api';
import {
  ACCOUNT_V2_ERROR_TEXT,
  useAccountsV2Store,
} from '../src/store/accounts-v2';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const RAW_PLATFORM_TEXT = 'RAW-PLATFORM-TEXT cookie=SECRET path=/secret/tmp/qr.png';

interface FakeApi {
  create: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  onQrcode: ReturnType<typeof vi.fn>;
}

function makeDto(overrides: Partial<AccountV2Dto> = {}): AccountV2Dto {
  return {
    id: UUID_A,
    platform: 'douyin',
    displayName: '主账号',
    owner: '运营',
    status: 'unknown',
    hasSession: false,
    lastCheckedAt: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function created(id: string, displayName = '主账号') {
  return { ok: true as const, account: makeDto({ id, displayName }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function installApi(overrides: Partial<FakeApi> = {}): FakeApi {
  const api: FakeApi = {
    create: vi.fn(async () => created(UUID_A)),
    list: vi.fn(async () => ({ ok: true as const, accounts: [] as AccountV2Dto[] })),
    login: vi.fn(async () => created(UUID_A)),
    check: vi.fn(async () => ({
      ok: true as const,
      valid: true,
      account: makeDto({ id: UUID_A }),
    })),
    delete: vi.fn(async () => ({ ok: true as const, accountId: UUID_A })),
    onQrcode: vi.fn(() => () => undefined),
    ...overrides,
  };
  (window as unknown as { accountV2API: unknown }).accountV2API = api;
  return api;
}

async function seedTwo(overrides: Partial<FakeApi> = {}): Promise<FakeApi> {
  const api = installApi({
    create: vi
      .fn()
      .mockResolvedValueOnce(created(UUID_A))
      .mockResolvedValueOnce(created(UUID_B)),
    ...overrides,
  });
  await useAccountsV2Store.getState().create('douyin', '主账号', '运营');
  await useAccountsV2Store.getState().create('douyin', '主账号', '运营');
  return api;
}

beforeEach(() => {
  useAccountsV2Store.getState().reset();
  window.localStorage.clear();
});

afterEach(() => {
  delete (window as unknown as { accountV2API?: unknown }).accountV2API;
});

describe('accounts-v2 store', () => {
  it('同平台同名的两个 UUID 各自成行，且不写 localStorage', async () => {
    const api = installApi({
      create: vi
        .fn()
        .mockResolvedValueOnce(created(UUID_A))
        .mockResolvedValueOnce(created(UUID_B)),
    });

    const first = await useAccountsV2Store.getState().create('douyin', '主账号', '运营');
    const second = await useAccountsV2Store.getState().create('douyin', '主账号', '运营');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(api.create).toHaveBeenNthCalledWith(1, 'douyin', '主账号', '运营');
    expect(api.create).toHaveBeenNthCalledWith(2, 'douyin', '主账号', '运营');

    const state = useAccountsV2Store.getState();
    expect(state.accounts.map((account) => account.id)).toEqual([UUID_A, UUID_B]);
    // 同名不被合并：两行 displayName 相同，但键是各自的 UUID。
    expect(state.byId[UUID_A].displayName).toBe(state.byId[UUID_B].displayName);
    expect(Object.keys(state.byId).sort()).toEqual([UUID_A, UUID_B].sort());
    // 仅内存：二维码 / 账号状态都不落浏览器持久化。
    expect(window.localStorage.length).toBe(0);
  });

  it('创建失败不新增账号，且错误只返回固定中文文案', async () => {
    installApi({
      create: vi.fn(async () => ({
        ok: false as const,
        code: 'vault_error' as const,
        message: RAW_PLATFORM_TEXT,
      })),
    });

    const result = await useAccountsV2Store.getState().create('douyin', '主账号');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('vault_error');
      expect(result.message).toBe(ACCOUNT_V2_ERROR_TEXT.vault_error);
      expect(result.message).not.toContain('SECRET');
      expect(result.message).not.toContain('/secret');
    }
    const state = useAccountsV2Store.getState();
    expect(state.accounts).toHaveLength(0);
    expect(JSON.stringify(state)).not.toContain('SECRET');
    expect(JSON.stringify(state)).not.toContain(RAW_PLATFORM_TEXT);
  });

  it('登录成功只更新目标 UUID 的 DTO', async () => {
    const api = await seedTwo({
      login: vi.fn(async () => ({
        ok: true as const,
        account: makeDto({ id: UUID_B, status: 'valid', hasSession: true }),
      })),
    });

    const result = await useAccountsV2Store.getState().login(UUID_B, REQUEST_ID, true);

    expect(result.ok).toBe(true);
    expect(api.login).toHaveBeenCalledWith({
      accountId: UUID_B,
      requestId: REQUEST_ID,
      headless: true,
    });
    const state = useAccountsV2Store.getState();
    expect(state.byId[UUID_B].status).toBe('valid');
    expect(state.byId[UUID_B].hasSession).toBe(true);
    // 另一 UUID 完全不受影响。
    expect(state.byId[UUID_A].status).toBe('unknown');
    expect(state.byId[UUID_A].hasSession).toBe(false);
    // 顺序保持不变（续登不重新排序）。
    expect(state.accounts.map((account) => account.id)).toEqual([UUID_A, UUID_B]);
  });

  it('登录失败保留原 unknown 账号，只返回安全错误文案', async () => {
    const api = await seedTwo({
      login: vi.fn(async () => ({
        ok: false as const,
        code: 'login_failed' as const,
        message: RAW_PLATFORM_TEXT,
      })),
    });

    const result = await useAccountsV2Store.getState().login(UUID_A, REQUEST_ID, false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('login_failed');
      expect(result.message).toBe(ACCOUNT_V2_ERROR_TEXT.login_failed);
      expect(result.message).not.toContain('SECRET');
    }
    const state = useAccountsV2Store.getState();
    expect(api.login).toHaveBeenCalledTimes(1);
    expect(state.accounts.map((account) => account.id)).toEqual([UUID_A, UUID_B]);
    expect(state.byId[UUID_A].status).toBe('unknown');
    expect(state.byId[UUID_A].hasSession).toBe(false);
    expect(JSON.stringify(state)).not.toContain('SECRET');
  });

  it('检查只写目标 UUID 的状态与最后检查时间', async () => {
    const api = await seedTwo({
      check: vi.fn(async () => ({
        ok: true as const,
        valid: false,
        account: makeDto({
          id: UUID_A,
          status: 'expired',
          hasSession: true,
          lastCheckedAt: 1_700_000_000_123,
        }),
      })),
    });

    const result = await useAccountsV2Store.getState().check(UUID_A);

    expect(result.ok).toBe(true);
    expect(api.check).toHaveBeenCalledTimes(1);
    expect(api.check).toHaveBeenCalledWith(UUID_A);
    const state = useAccountsV2Store.getState();
    expect(state.byId[UUID_A].status).toBe('expired');
    expect(state.byId[UUID_A].lastCheckedAt).toBe(1_700_000_000_123);
    expect(state.byId[UUID_B].status).toBe('unknown');
    expect(state.byId[UUID_B].lastCheckedAt).toBeNull();
  });

  it('按 UUID 精确删除；删除失败不改内存状态', async () => {
    const api = await seedTwo({
      delete: vi.fn(async () => ({ ok: true as const, accountId: UUID_A })),
    });

    const removed = await useAccountsV2Store.getState().remove(UUID_A);
    expect(removed.ok).toBe(true);
    expect(api.delete).toHaveBeenCalledWith(UUID_A);
    let state = useAccountsV2Store.getState();
    expect(state.accounts.map((account) => account.id)).toEqual([UUID_B]);
    expect(state.byId[UUID_A]).toBeUndefined();

    api.delete.mockResolvedValueOnce({
      ok: false as const,
      code: 'account_not_found' as const,
      message: RAW_PLATFORM_TEXT,
    });
    const failed = await useAccountsV2Store.getState().remove(UUID_A);
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe('account_not_found');
      expect(failed.message).toBe(ACCOUNT_V2_ERROR_TEXT.account_not_found);
    }
    state = useAccountsV2Store.getState();
    expect(state.accounts.map((account) => account.id)).toEqual([UUID_B]);
    expect(JSON.stringify(state)).not.toContain('SECRET');
  });

  it('list 不按同名去重；list 失败保留现有内存状态', async () => {
    const api = installApi();

    api.list.mockResolvedValueOnce({
      ok: true as const,
      accounts: [
        makeDto({ id: UUID_A, displayName: '主账号' }),
        makeDto({ id: UUID_B, displayName: '主账号' }),
      ],
    });
    const loaded = await useAccountsV2Store.getState().load();
    expect(loaded.ok).toBe(true);
    expect(useAccountsV2Store.getState().accounts.map((account) => account.id)).toEqual([
      UUID_A,
      UUID_B,
    ]);

    api.list.mockResolvedValueOnce({
      ok: false as const,
      code: 'vault_error' as const,
      message: RAW_PLATFORM_TEXT,
    });
    const failed = await useAccountsV2Store.getState().load();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.message).toBe(ACCOUNT_V2_ERROR_TEXT.vault_error);
    }
    expect(useAccountsV2Store.getState().accounts).toHaveLength(2);
    expect(useAccountsV2Store.getState().loading).toBe(false);
  });

  it('旧 list 快照返回时不会覆盖同时创建的新账号', async () => {
    const firstList = deferred<{ ok: true; accounts: AccountV2Dto[] }>();
    const api = installApi({
      list: vi.fn()
        .mockReturnValueOnce(firstList.promise)
        .mockResolvedValueOnce({ ok: true, accounts: [
          makeDto({ id: UUID_A, displayName: '旧账号' }),
          makeDto({ id: UUID_B, displayName: '新账号' }),
        ] }),
      create: vi.fn(async () => created(UUID_B, '新账号')),
    });

    const loading = useAccountsV2Store.getState().load();
    await useAccountsV2Store.getState().create('douyin', '新账号');
    firstList.resolve({ ok: true, accounts: [makeDto({ id: UUID_A, displayName: '旧账号' })] });
    const result = await loading;

    expect(result.ok).toBe(true);
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(useAccountsV2Store.getState().accounts.map((item) => item.id)).toEqual([UUID_A, UUID_B]);
  });

  it('未知错误码归一到 internal_error，仍不透传原文', async () => {
    installApi({
      create: vi.fn(async () => ({
        ok: false as const,
        code: 'brand_new_backend_code' as never,
        message: RAW_PLATFORM_TEXT,
      })),
    });

    const result = await useAccountsV2Store.getState().create('douyin', '主账号');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('internal_error');
      expect(result.message).toBe(ACCOUNT_V2_ERROR_TEXT.internal_error);
      expect(result.message).not.toContain(RAW_PLATFORM_TEXT);
    }
    expect(JSON.stringify(useAccountsV2Store.getState())).not.toContain('SECRET');
  });

  it('桥抛异常时不新增状态，只返回 internal_error', async () => {
    installApi({
      create: vi.fn(async () => {
        throw new Error(RAW_PLATFORM_TEXT);
      }),
    });

    const result = await useAccountsV2Store.getState().create('douyin', '主账号');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('internal_error');
      expect(result.message).toBe(ACCOUNT_V2_ERROR_TEXT.internal_error);
      expect(result.message).not.toContain('SECRET');
      expect(result.message).not.toContain(RAW_PLATFORM_TEXT);
    }
    expect(useAccountsV2Store.getState().accounts).toHaveLength(0);
  });
});

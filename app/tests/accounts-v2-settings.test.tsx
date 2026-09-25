// @vitest-environment jsdom
/**
 * A2-S3 合成 RED 测试：安全账号设置页（SecureAccountsTab）与旧发布页边界。
 *
 * 全部数据合成：假 `window.accountV2API` / 假 `window.publishAPI`（不触真实 IPC /
 * 平台 / userData / 真实二维码）。沿用仓内 createRoot + act 手动渲染约定。
 *
 * 断言锁定以下契约：
 * - 同平台同名创建出两行独立 UUID；行内动作只作用于点选 UUID；
 * - login 的 requestId 在 invoke 前生成且先订阅二维码，只接收 accountId +
 *   requestId 匹配且 sequence 递增的事件；Promise 落定与卸载都真实退订并清除
 *   二维码（绝不写入 store / 持久化）；
 * - 登录失败 / login_busy 保留账号并显示固定中文文案，错误原文不进入 DOM；
 * - create→login→check→delete 全程零次旧 publishAPI 调用；
 * - 新页、旧账号页、旧发布工作台都有“未切换”边界提示；
 * - 对 BiDi 方向控制符做安全展示并始终附带 UUID 身份。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SecureAccountsTab } from '../src/components/settings/SecureAccountsTab';
import { PublishAccountsTab } from '../src/components/settings/PublishAccountsTab';
import { ACCOUNT_V2_ERROR_TEXT, useAccountsV2Store } from '../src/store/accounts-v2';
import type { AccountV2Dto, AccountV2QrcodeEvent } from '../src/lib/electron-api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ui 库依赖链在渲染时可能引用 window.matchMedia（jsdom 默认不实现）。
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const RAW_PLATFORM_TEXT = 'RAW-PLATFORM-TEXT cookie=SECRET path=/secret/tmp/qr.png';
const BOUNDARY_NOTICE = '新安全账号暂未接入发布';

interface FakeAccountV2Api {
  create: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  onQrcode: ReturnType<typeof vi.fn>;
  emit(event: AccountV2QrcodeEvent): void;
  listeners(): number;
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

function installAccountV2Api(): FakeAccountV2Api {
  const listeners = new Set<(event: AccountV2QrcodeEvent) => void>();
  const api: FakeAccountV2Api = {
    create: vi.fn(),
    list: vi.fn(async () => ({ ok: true as const, accounts: [] as AccountV2Dto[] })),
    login: vi.fn(),
    check: vi.fn(),
    delete: vi.fn(),
    onQrcode: vi.fn((callback: (event: AccountV2QrcodeEvent) => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    }),
    emit(event: AccountV2QrcodeEvent) {
      for (const listener of Array.from(listeners)) listener(event);
    },
    listeners: () => listeners.size,
  };
  (window as unknown as { accountV2API: unknown }).accountV2API = api;
  return api;
}

function installPublishApi() {
  const api = {
    listAccounts: vi.fn(async () => []),
    deleteAccount: vi.fn(async () => undefined),
    login: vi.fn(async () => ({ success: true, message: '' })),
    check: vi.fn(async () => true),
    getSettings: vi.fn(async () => ({ headlessLogin: true })),
    setSettings: vi.fn(async () => ({ headlessLogin: true })),
    run: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    onQrcode: vi.fn(() => () => undefined),
    onProgress: vi.fn(() => () => undefined),
    getBiliupStatus: vi.fn(async () => ({ installed: true, path: '' })),
    downloadBiliup: vi.fn(async () => ({ success: true })),
    cancelBiliupDownload: vi.fn(async () => undefined),
    onBiliupDownloadProgress: vi.fn(() => () => undefined),
    getChromiumStatus: vi.fn(async () => ({ installed: true, path: '' })),
    downloadChromium: vi.fn(async () => ({ success: true })),
    cancelChromiumDownload: vi.fn(async () => undefined),
    onChromiumDownloadProgress: vi.fn(() => () => undefined),
  };
  (window as unknown as { publishAPI: unknown }).publishAPI = api;
  return api;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function emitQrcode(api: FakeAccountV2Api, event: AccountV2QrcodeEvent): Promise<void> {
  await act(async () => {
    api.emit(event);
    await Promise.resolve();
  });
  await flush();
}

async function mount(element: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  root = createRoot(host);
  await act(async () => {
    root!.render(element);
  });
  await flush();
  return host;
}

function unmount(): void {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
}

function buttonIn(scope: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find((button) =>
    (button.textContent ?? '').includes(text),
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function actionIn(scope: ParentNode, action: string): HTMLButtonElement {
  const labels: Record<string, string> = {
    login: '扫码登录或续登',
    check: '检查会话',
    delete: '删除账号',
  };
  const label = labels[action];
  if (!label) throw new Error(`unknown action: ${action}`);
  const found = scope.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`action button not found: ${action}`);
  return found;
}

function row(host: HTMLElement, accountId: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-account-id="${accountId}"]`);
  if (!found) throw new Error(`row not found: ${accountId}`);
  return found;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('HTMLInputElement value setter unavailable');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await flush();
}

async function createViaUi(host: HTMLElement, displayName: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="新账号名称"]');
  if (!input) throw new Error('create name input not found');
  await act(async () => {
    setInputValue(input, displayName);
    await Promise.resolve();
  });
  await click(buttonIn(host, '创建账号'));
}

beforeEach(() => {
  useAccountsV2Store.getState().reset();
  window.localStorage.clear();
});

afterEach(() => {
  unmount();
  delete (window as unknown as { accountV2API?: unknown }).accountV2API;
  delete (window as unknown as { publishAPI?: unknown }).publishAPI;
  window.localStorage.clear();
});

describe('SecureAccountsTab', () => {
  it('同平台同名创建出两行独立 UUID，删除只移除点选行', async () => {
    const api = installAccountV2Api();
    api.create
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_A, displayName: '主账号' }) })
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_B, displayName: '主账号' }) });

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '主账号');
    await createViaUi(host, '主账号');

    expect(api.create).toHaveBeenCalledTimes(2);
    expect(api.create.mock.calls[0][0]).toBe('douyin');
    expect(api.create.mock.calls[1][0]).toBe('douyin');
    expect(api.create.mock.calls[0][1]).toBe('主账号');
    expect(api.create.mock.calls[1][1]).toBe('主账号');

    expect(host.querySelectorAll('[data-account-id]')).toHaveLength(2);
    expect(row(host, UUID_A).textContent).toContain('主账号');
    expect(row(host, UUID_B).textContent).toContain('主账号');
    expect(row(host, UUID_A).textContent).toContain(UUID_A);
    expect(row(host, UUID_B).textContent).toContain(UUID_B);

    api.delete.mockResolvedValue({ ok: true, accountId: UUID_A });
    await click(actionIn(row(host, UUID_A), 'delete'));
    await click(buttonIn(document.body, '确认删除'));

    expect(api.delete).toHaveBeenCalledTimes(1);
    expect(api.delete).toHaveBeenCalledWith(UUID_A);
    expect(host.querySelector(`[data-account-id="${UUID_A}"]`)).toBeNull();
    expect(host.querySelector(`[data-account-id="${UUID_B}"]`)).not.toBeNull();
  });

  it('创建后登录失败仍保留 unknown 账号，且错误原文不进入 DOM', async () => {
    const api = installAccountV2Api();
    api.create.mockResolvedValue({ ok: true, account: makeDto({ id: UUID_A, displayName: '主账号' }) });
    const deferred = createDeferred<{ ok: false; code: 'login_failed'; message: string }>();
    api.login.mockReturnValue(deferred.promise);

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '主账号');
    const accountRow = row(host, UUID_A);
    expect(accountRow.textContent).toContain('未知');

    await click(actionIn(accountRow, 'login'));
    expect(api.listeners()).toBe(1);
    const call = api.login.mock.calls[0][0] as { accountId: string; requestId: string };
    expect(call.accountId).toBe(UUID_A);
    expect(call.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    await emitQrcode(api, {
      requestId: call.requestId,
      accountId: UUID_A,
      sequence: 1,
      imageDataUrl: 'data:image/png;base64,ONE',
    });
    expect(row(host, UUID_A).querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,ONE',
    );

    // 请求进行中：本行容易冲突的动作被禁用。
    expect(actionIn(row(host, UUID_A), 'login').disabled).toBe(true);
    expect(actionIn(row(host, UUID_A), 'check').disabled).toBe(true);
    expect(actionIn(row(host, UUID_A), 'delete').disabled).toBe(true);

    await act(async () => {
      deferred.resolve({ ok: false, code: 'login_failed', message: RAW_PLATFORM_TEXT });
      await Promise.resolve();
    });
    await flush();

    // 账号保留（unknown、无会话），只显示固定中文文案。
    const kept = row(host, UUID_A);
    expect(kept.textContent).toContain('未知');
    expect(kept.textContent).toContain(ACCOUNT_V2_ERROR_TEXT.login_failed);
    expect(kept.querySelector('img')).toBeNull();
    expect(host.textContent).not.toContain('SECRET');
    expect(host.textContent).not.toContain(RAW_PLATFORM_TEXT);
    // Promise 落定后真实退订，迟到事件不再进入 DOM。
    expect(api.listeners()).toBe(0);
    await emitQrcode(api, {
      requestId: call.requestId,
      accountId: UUID_A,
      sequence: 2,
      imageDataUrl: 'data:image/png;base64,LATE',
    });
    expect(row(host, UUID_A).querySelector('img')).toBeNull();
  });

  it('login 抛异常时真实退订、清除二维码并保留账号', async () => {
    const api = installAccountV2Api();
    api.create.mockResolvedValue({ ok: true, account: makeDto({ id: UUID_A, displayName: '主账号' }) });
    let listenersAtReject = -1;
    api.login.mockImplementation(() => {
      listenersAtReject = api.listeners();
      return Promise.reject(new Error(RAW_PLATFORM_TEXT));
    });

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '主账号');
    await click(actionIn(row(host, UUID_A), 'login'));

    expect(listenersAtReject).toBe(1);
    expect(api.listeners()).toBe(0);
    const kept = row(host, UUID_A);
    expect(kept.textContent).toContain('未知');
    expect(kept.textContent).toContain(ACCOUNT_V2_ERROR_TEXT.internal_error);
    expect(kept.querySelector('img')).toBeNull();
    expect(host.textContent).not.toContain('SECRET');
    expect(host.textContent).not.toContain(RAW_PLATFORM_TEXT);
  });

  it('二维码在 invoke 前订阅；跨账号/跨 requestId/乱序事件全部被过滤', async () => {
    const api = installAccountV2Api();
    api.create
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_A, displayName: '账号A' }) })
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_B, displayName: '账号B' }) });

    const deferred = createDeferred<{ ok: true; account: AccountV2Dto }>();
    let listenersAtInvoke = -1;
    api.login.mockImplementation(() => {
      listenersAtInvoke = api.listeners();
      return deferred.promise;
    });

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '账号A');
    await createViaUi(host, '账号B');

    await click(actionIn(row(host, UUID_A), 'login'));
    expect(listenersAtInvoke).toBe(1);
    const call = api.login.mock.calls[0][0] as { accountId: string; requestId: string };

    // 跨账号事件被过滤。
    await emitQrcode(api, {
      requestId: call.requestId,
      accountId: UUID_B,
      sequence: 1,
      imageDataUrl: 'data:image/png;base64,OTHER-ACCOUNT',
    });
    expect(row(host, UUID_A).querySelector('img')).toBeNull();

    // 跨 requestId 事件被过滤。
    await emitQrcode(api, {
      requestId: '99999999-9999-4999-8999-999999999999',
      accountId: UUID_A,
      sequence: 1,
      imageDataUrl: 'data:image/png;base64,OTHER-REQUEST',
    });
    expect(row(host, UUID_A).querySelector('img')).toBeNull();

    // 匹配事件：sequence 1 生效。
    await emitQrcode(api, {
      requestId: call.requestId,
      accountId: UUID_A,
      sequence: 1,
      imageDataUrl: 'data:image/png;base64,SEQ1',
    });
    expect(row(host, UUID_A).querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,SEQ1',
    );

    // 递增到 3 后，乱序的 2 / 重复的 3 都不覆盖当前二维码。
    await emitQrcode(api, {
      requestId: call.requestId,
      accountId: UUID_A,
      sequence: 3,
      imageDataUrl: 'data:image/png;base64,SEQ3',
    });
    expect(row(host, UUID_A).querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,SEQ3',
    );
    await emitQrcode(api, {
      requestId: call.requestId,
      accountId: UUID_A,
      sequence: 2,
      imageDataUrl: 'data:image/png;base64,SEQ2',
    });
    expect(row(host, UUID_A).querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,SEQ3',
    );

    await act(async () => {
      deferred.resolve({ ok: true, account: makeDto({ id: UUID_A, status: 'valid', hasSession: true }) });
      await Promise.resolve();
    });
    await flush();
    expect(api.listeners()).toBe(0);
    expect(row(host, UUID_A).querySelector('img')).toBeNull();
  });

  it('组件卸载时真实退订并清理二维码', async () => {
    const api = installAccountV2Api();
    api.create.mockResolvedValue({ ok: true, account: makeDto({ id: UUID_A, displayName: '主账号' }) });
    const deferred = createDeferred<{ ok: true; account: AccountV2Dto }>();
    api.login.mockReturnValue(deferred.promise);

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '主账号');
    await click(actionIn(row(host, UUID_A), 'login'));
    expect(api.listeners()).toBe(1);
    const call = api.login.mock.calls[0][0] as { accountId: string; requestId: string };
    await emitQrcode(api, {
      requestId: call.requestId,
      accountId: UUID_A,
      sequence: 1,
      imageDataUrl: 'data:image/png;base64,UNMOUNT',
    });
    expect(row(host, UUID_A).querySelector('img')).not.toBeNull();

    unmount();
    expect(api.listeners()).toBe(0);

    // 卸载后的事件与迟到的 Promise 落定不得抛错或写回 UI。
    await emitQrcode(api, {
      requestId: call.requestId,
      accountId: UUID_A,
      sequence: 2,
      imageDataUrl: 'data:image/png;base64,AFTER-UNMOUNT',
    });
    await act(async () => {
      deferred.resolve({ ok: true, account: makeDto({ id: UUID_A, status: 'valid', hasSession: true }) });
      await Promise.resolve();
    });
    await flush();
    expect(api.listeners()).toBe(0);
  });

  it('登录进行中阻止离开设置页，完成后解除离开保护', async () => {
    const api = installAccountV2Api();
    api.create.mockResolvedValue({ ok: true, account: makeDto({ id: UUID_A }) });
    const login = createDeferred<{ ok: true; account: AccountV2Dto }>();
    api.login.mockReturnValue(login.promise);
    let leaveGuard: (() => Promise<boolean>) | null = null;
    const host = await mount(<SecureAccountsTab onRegisterLeaveGuard={(guard) => { leaveGuard = guard; }} />);
    await createViaUi(host, '主账号');
    await click(actionIn(row(host, UUID_A), 'login'));

    expect(leaveGuard).not.toBeNull();
    let canLeave = true;
    await act(async () => { canLeave = await leaveGuard!(); });
    expect(canLeave).toBe(false);
    expect(api.listeners()).toBe(1);

    await act(async () => {
      login.resolve({ ok: true, account: makeDto({ id: UUID_A, status: 'valid', hasSession: true }) });
      await Promise.resolve();
    });
    await flush();
    expect(await leaveGuard!()).toBe(true);
    unmount();
    expect(leaveGuard).toBeNull();
  });

  it('同一渲染批次重复点击登录只发起一次请求', async () => {
    const api = installAccountV2Api();
    api.create.mockResolvedValue({ ok: true, account: makeDto({ id: UUID_A }) });
    const login = createDeferred<{ ok: true; account: AccountV2Dto }>();
    api.login.mockReturnValue(login.promise);
    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '主账号');

    await act(async () => {
      const button = actionIn(row(host, UUID_A), 'login');
      button.click();
      button.click();
      await Promise.resolve();
    });
    expect(api.login).toHaveBeenCalledTimes(1);
    expect(api.listeners()).toBe(1);

    await act(async () => {
      login.resolve({ ok: true, account: makeDto({ id: UUID_A, status: 'valid', hasSession: true }) });
      await Promise.resolve();
    });
    await flush();
    expect(api.listeners()).toBe(0);
  });

  it('续登只针对点选 UUID，requestId 每次不同', async () => {
    const api = installAccountV2Api();
    api.create
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_A, displayName: '账号A' }) })
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_B, displayName: '账号B' }) });
    api.login
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_B, status: 'valid', hasSession: true }) })
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_A, status: 'valid', hasSession: true }) });

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '账号A');
    await createViaUi(host, '账号B');

    await click(actionIn(row(host, UUID_B), 'login'));
    await click(actionIn(row(host, UUID_A), 'login'));

    expect(api.login).toHaveBeenCalledTimes(2);
    expect(api.login).toHaveBeenNthCalledWith(1, {
      accountId: UUID_B,
      requestId: expect.any(String),
      headless: true,
    });
    expect(api.login).toHaveBeenNthCalledWith(2, {
      accountId: UUID_A,
      requestId: expect.any(String),
      headless: true,
    });
    const firstRequestId = (api.login.mock.calls[0][0] as { requestId: string }).requestId;
    const secondRequestId = (api.login.mock.calls[1][0] as { requestId: string }).requestId;
    expect(firstRequestId).not.toBe(secondRequestId);
  });

  it('检查只作用于点选 UUID，并更新该行状态', async () => {
    const api = installAccountV2Api();
    api.create
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_A, displayName: '账号A' }) })
      .mockResolvedValueOnce({ ok: true, account: makeDto({ id: UUID_B, displayName: '账号B' }) });
    api.check.mockResolvedValue({
      ok: true,
      valid: false,
      account: makeDto({
        id: UUID_A,
        displayName: '账号A',
        status: 'expired',
        hasSession: true,
        lastCheckedAt: 1_700_000_000_123,
      }),
    });

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '账号A');
    await createViaUi(host, '账号B');

    await click(actionIn(row(host, UUID_A), 'check'));

    expect(api.check).toHaveBeenCalledTimes(1);
    expect(api.check).toHaveBeenCalledWith(UUID_A);
    expect(row(host, UUID_A).textContent).toContain('已过期');
    expect(row(host, UUID_B).textContent).toContain('未知');
  });

  it('login_busy 显示固定中文文案而非错误码原文', async () => {
    const api = installAccountV2Api();
    api.create.mockResolvedValue({ ok: true, account: makeDto({ id: UUID_A, displayName: '主账号' }) });
    api.login.mockResolvedValue({ ok: false, code: 'login_busy', message: RAW_PLATFORM_TEXT });

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '主账号');
    await click(actionIn(row(host, UUID_A), 'login'));

    expect(row(host, UUID_A).textContent).toContain(ACCOUNT_V2_ERROR_TEXT.login_busy);
    expect(host.textContent).not.toContain('login_busy');
    expect(host.textContent).not.toContain('SECRET');
  });

  it('BiDi 方向控制符被安全展示，且始终显示 UUID 身份', async () => {
    const api = installAccountV2Api();
    api.create.mockResolvedValue({
      ok: true,
      account: makeDto({ id: UUID_A, displayName: '主账号\u202Egnp.exe\u061C' }),
    });

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '主账号');

    const accountRow = row(host, UUID_A);
    expect(accountRow.textContent).toContain('主账号');
    expect(accountRow.textContent).toContain(UUID_A);
    expect(accountRow.textContent).not.toContain('\u202E');
    expect(accountRow.textContent).not.toContain('\u061C');
  });

  it('新安全账号操作全程零次旧 publishAPI 调用，三处均有未切换提示', async () => {
    const publishApi = installPublishApi();
    const api = installAccountV2Api();
    api.create.mockResolvedValue({ ok: true, account: makeDto({ id: UUID_A, displayName: '主账号' }) });
    api.login.mockResolvedValue({
      ok: true,
      account: makeDto({ id: UUID_A, status: 'valid', hasSession: true }),
    });

    const host = await mount(<SecureAccountsTab />);
    await createViaUi(host, '主账号');
    await click(actionIn(row(host, UUID_A), 'login'));

    expect(host.textContent).toContain(BOUNDARY_NOTICE);
    for (const spy of Object.values(publishApi)) {
      expect(spy).not.toHaveBeenCalled();
    }

    // 旧账号 tab 保留旧行为（仍调用旧 publishAPI），但显示未切换提示。
    unmount();
    const oldHost = await mount(<PublishAccountsTab />);
    expect(oldHost.textContent).toContain(BOUNDARY_NOTICE);
    expect(publishApi.listAccounts).toHaveBeenCalled();

    // 旧发布工作台与新设置 tab 注册：源码级契约（组件渲染见上方行为测试）。
    const workbenchSource = readFileSync(
      resolve(__dirname, '../src/components/publish/PublishWorkbench.tsx'),
      'utf8',
    );
    expect(workbenchSource).toContain(BOUNDARY_NOTICE);

    const settingsSource = readFileSync(resolve(__dirname, '../src/pages/Settings.tsx'), 'utf8');
    expect(settingsSource).toContain('secure-accounts');
    expect(settingsSource).toContain('SecureAccountsTab');
    expect(settingsSource).toContain('安全账号');
  });
});

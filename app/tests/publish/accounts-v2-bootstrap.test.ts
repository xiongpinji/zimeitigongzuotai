/**
 * A2-S2 合成测试：account-v2 生产桥组合根 + preload `accountV2API` 契约。
 *
 * 全部数据合成：假 userData 路径（临时目录）、假 IPC、假 cipher（可逆编码，
 * 非加密）、假平台模块。不触真实平台 / 浏览器 / 网络 / 生产 userData / 旧仓。
 *
 * 断言锁定 A2-S2 验收点：
 * - 组合根只注册 `account-v2:*` 五个 invoke 通道；不触旧 `publish:*`。
 * - 新仓固定 `<userData>/publish-v2`；旧 `<userData>/publish` 不被创建 / 读写。
 * - 注入的 cipher 实际用于加密入仓（假 cipher 字节可解、绝无明文）。
 * - 四平台工厂只解析 douyin/kuaishou/tencent/xiaohongshu；bilibili 在解析前拒绝。
 * - 同平台同名经桥各自独立 UUID / 密文。
 * - 二维码事件只回发起 invoke 的 sender；载荷无路径 / sessionRef / 明文。
 * - 注册失败直接抛给调用方（不吞错、不回退旧仓）。
 * - preload 方法只映射固定 account-v2 通道；onQrcode 退订真实移除 listener。
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AccountVaultPlatform, SessionCipher } from '../../electron/publish/accounts-v2';
import {
  ACCOUNT_V2_ERROR_MESSAGES,
  ACCOUNT_V2_IPC_CHANNELS,
  type AccountPlatformLike,
} from '../../electron/publish/accounts-v2-ipc';
import {
  ACCOUNT_V2_DATA_DIR_NAME,
  ACCOUNT_V2_LEGACY_DATA_DIR_NAME,
  ACCOUNT_V2_PLATFORM_WHITELIST,
  bootstrapAccountsV2,
  createAccountsV2PlatformFactory,
} from '../../electron/publish/accounts-v2-bootstrap';
import { LEGACY_MIGRATION_PREVIEW_CHANNEL } from '../../electron/publish/legacy-migration-preview';
import type { LoginOptions } from '../../electron/publish/types';

// ─── preload electron 假注入（vi.mock 提升；假 contextBridge / ipcRenderer） ──

const preloadBridge = vi.hoisted(() => {
  const exposed: Record<string, unknown> = {};
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const invocations: Array<{ channel: string; args: unknown[] }> = [];
  const ipcRenderer = {
    invoke: (channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args });
      return Promise.resolve({ ok: true });
    },
    on: (channel: string, handler: (...args: unknown[]) => void) => {
      const set = listeners.get(channel) ?? new Set<(...args: unknown[]) => void>();
      set.add(handler);
      listeners.set(channel, set);
    },
    removeListener: (channel: string, handler: (...args: unknown[]) => void) => {
      listeners.get(channel)?.delete(handler);
    },
    send: () => undefined,
    sendSync: () => null,
  };
  const contextBridge = {
    exposeInMainWorld: (name: string, api: unknown) => {
      exposed[name] = api;
    },
  };
  return { exposed, listeners, invocations, ipcRenderer, contextBridge };
});

vi.mock('electron', () => ({
  contextBridge: preloadBridge.contextBridge,
  ipcRenderer: preloadBridge.ipcRenderer,
  webUtils: { getPathForFile: () => '' },
}));

async function loadPreload(): Promise<void> {
  await import('../../electron/preload');
}

// ─── 合成夹具 ─────────────────────────────────────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SECRET_TAG = 'SECRET-BRIDGE-COOKIE-VALUE';

/** 测试专用假加密器：只做可逆编码，没有任何安全性；严禁进入生产路径。 */
class FakeCipher implements SessionCipher {
  available = true;
  encryptCalls = 0;
  decryptCalls = 0;

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(plaintext: Buffer): Buffer {
    this.encryptCalls += 1;
    return Buffer.from(`fake1:${plaintext.toString('base64')}`, 'utf-8');
  }

  decrypt(ciphertext: Buffer): Buffer {
    this.decryptCalls += 1;
    const text = ciphertext.toString('utf-8');
    if (!text.startsWith('fake1:')) throw new Error('not a fake cipher payload');
    return Buffer.from(text.slice('fake1:'.length), 'base64');
  }
}

function storageStateFixture(tag: string): string {
  return JSON.stringify({
    cookies: [{ name: 'sid', value: `${SECRET_TAG}-${tag}`, domain: '.example.test' }],
    origins: [],
  });
}

function pngFixture(tag: string): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.from(`bridge-qr-${tag}`, 'utf-8')]);
}

interface BridgeHarnessOptions {
  resolvePlatform?: (platform: AccountVaultPlatform) => AccountPlatformLike | undefined;
  ipcHandle?: (channel: string, listener: (...args: never[]) => unknown) => void;
}

function makeBridge(options: BridgeHarnessOptions = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'a2s2-userdata-'));
  const cipher = new FakeCipher();
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipc = {
    handle: (channel: string, listener: (...args: never[]) => unknown) => {
      if (options.ipcHandle) {
        options.ipcHandle(channel, listener);
        return;
      }
      handlers.set(channel, listener as unknown as (event: unknown, ...args: unknown[]) => unknown);
    },
  };
  const resolverCalls: string[] = [];
  const loginOpts: LoginOptions[] = [];
  const checkPaths: string[] = [];
  let loginCount = 0;
  const defaultResolver = (platform: AccountVaultPlatform): AccountPlatformLike => {
    resolverCalls.push(platform);
    return {
      login: async (opts: LoginOptions) => {
        loginOpts.push(opts);
        loginCount += 1;
        writeFileSync(opts.storageStatePath, storageStateFixture(`bridge-${platform}-${loginCount}`));
        return { success: true, message: `bridge-login-${platform}` };
      },
      checkCookie: async (storageStatePath: string): Promise<boolean> => {
        checkPaths.push(storageStatePath);
        return true;
      },
    };
  };
  const resolvePlatform = options.resolvePlatform ?? defaultResolver;
  const sent: Array<{ sender: string; channel: string; payload: unknown }> = [];

  bootstrapAccountsV2({
    userDataPath: userData,
    ipc: ipc as never,
    createCipher: () => cipher,
    resolvePlatform,
  });

  const dataRoot = join(userData, ACCOUNT_V2_DATA_DIR_NAME);
  return {
    userData,
    dataRoot,
    cipher,
    handlers,
    resolverCalls,
    loginOpts,
    checkPaths,
    sent,
    registryPath: join(dataRoot, 'registry.json'),
    sessionsDir: join(dataRoot, 'sessions'),
    registry(): { accounts: Array<Record<string, unknown>> } {
      return JSON.parse(readFileSync(this.registryPath, 'utf-8'));
    },
    sessionBytes(sessionRef: string): Buffer {
      return readFileSync(join(this.sessionsDir, `${sessionRef}.bin`));
    },
    invoke(channel: string, payload?: unknown, senderId = 'window-A'): Promise<any> {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`test setup: no handler for ${channel}`);
      const event = {
        sender: {
          send: (ch: string, p: unknown) => {
            sent.push({ sender: senderId, channel: ch, payload: p });
          },
        },
      };
      return Promise.resolve(handler(event, payload) as never);
    },
  };
}

type BridgeHarness = ReturnType<typeof makeBridge>;

async function createAccountViaBridge(
  h: BridgeHarness,
  input: { platform: string; displayName: string; owner?: string },
): Promise<{ id: string }> {
  const res = await h.invoke(ACCOUNT_V2_IPC_CHANNELS.create, input);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  return res.account as { id: string };
}

// ─── 组合根：注册、仓隔离、加密绑定 ──────────────────────────────────────────

describe('account-v2 bootstrap：注册与仓隔离', () => {
  it('恰好注册五个 account-v2 invoke 通道；不注册 qrcode handler、不触旧 publish:*', () => {
    const h = makeBridge();
    expect([...h.handlers.keys()].sort()).toEqual([
      'account-v2:check',
      'account-v2:create',
      'account-v2:delete',
      'account-v2:list',
      'account-v2:login',
    ]);
    expect(h.handlers.has(ACCOUNT_V2_IPC_CHANNELS.qrcode)).toBe(false);
    expect([...h.handlers.keys()].some((c) => c.startsWith('publish:'))).toBe(false);
  });

  it('新仓固定 <userData>/publish-v2；旧 <userData>/publish 不被创建', async () => {
    const h = makeBridge();
    const dto = await createAccountViaBridge(h, { platform: 'douyin', displayName: '桥账号' });
    expect(existsSync(h.registryPath)).toBe(true);
    expect(existsSync(join(h.userData, ACCOUNT_V2_LEGACY_DATA_DIR_NAME))).toBe(false);
    expect(h.registry().accounts).toHaveLength(1);
    expect(h.registry().accounts[0].id).toBe(dto.id);
    expect(h.registry().accounts[0].displayName).toBe('桥账号');
  });

  it('注入的 SessionCipher 实际用于加密入仓：假密文可解、磁盘绝无明文 / 路径', async () => {
    const h = makeBridge();
    const dto = await createAccountViaBridge(h, { platform: 'douyin', displayName: '加密绑定' });
    const res = await h.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res.ok).toBe(true);
    expect(h.cipher.encryptCalls).toBeGreaterThan(0);
    const entry = h.registry().accounts[0];
    expect(typeof entry.sessionRef).toBe('string');
    const raw = h.sessionBytes(entry.sessionRef as string).toString('utf-8');
    expect(raw.startsWith('fake1:')).toBe(true);
    expect(raw).not.toContain('cookies');
    expect(h.cipher.decrypt(Buffer.from(raw, 'utf-8')).toString('utf-8')).toContain('"cookies"');
    const serializedResult = JSON.stringify(res);
    expect(serializedResult).not.toContain(h.userData);
    expect(serializedResult).not.toContain('sessionRef');
    expect(serializedResult).not.toContain('storageState.json');
  });

  it('cipher 不可用：经桥登录 fail closed（cipher_unavailable），零会话文件、零明文临时残留', async () => {
    const h = makeBridge();
    const dto = await createAccountViaBridge(h, { platform: 'douyin', displayName: '无加密' });
    h.cipher.available = false;
    const res = await h.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'cipher_unavailable',
      message: ACCOUNT_V2_ERROR_MESSAGES.cipher_unavailable,
    });
    expect(readdirSync(h.sessionsDir)).toEqual([]);
    expect(h.registry().accounts[0].sessionRef).toBeNull();
  });

  it('注册失败（ipc.handle 抛错）直接抛给调用方；不吞错、不创建旧仓', () => {
    const userData = mkdtempSync(join(tmpdir(), 'a2s2-userdata-'));
    const expected = new Error('duplicate handler');
    let thrown: unknown = null;
    try {
      bootstrapAccountsV2({
        userDataPath: userData,
        ipc: {
          handle: () => {
            throw expected;
          },
        },
        createCipher: () => new FakeCipher(),
        resolvePlatform: () => undefined,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBe(expected);
    expect(existsSync(join(userData, ACCOUNT_V2_LEGACY_DATA_DIR_NAME))).toBe(false);
  });
});

// ─── 四平台白名单 ─────────────────────────────────────────────────────────────

describe('account-v2 bootstrap：四平台白名单', () => {
  it('工厂只解析白名单四平台；bilibili / 别名在解析器之前拒绝', () => {
    const resolved: string[] = [];
    const factory = createAccountsV2PlatformFactory((platform) => {
      resolved.push(platform);
      return {
        login: async () => ({ success: false, message: '' }),
        checkCookie: async () => false,
      };
    });
    for (const platform of ACCOUNT_V2_PLATFORM_WHITELIST) {
      expect(factory(platform) === undefined).toBe(false);
    }
    expect(resolved).toEqual([...ACCOUNT_V2_PLATFORM_WHITELIST]);
    expect(factory('bilibili' as never) === undefined).toBe(true);
    expect(factory('wechat-channels' as never) === undefined).toBe(true);
    // 非白名单平台绝不到达解析器。
    expect(resolved).toEqual([...ACCOUNT_V2_PLATFORM_WHITELIST]);
  });

  it('解析器抛错 → 平台视为不可用（undefined），异常不冒泡', () => {
    const factory = createAccountsV2PlatformFactory(() => {
      throw new Error('resolve boom');
    });
    expect(factory('tencent') === undefined).toBe(true);
  });

  it('IPC create bilibili → unsupported_platform，平台解析零调用', async () => {
    const h = makeBridge();
    const res = await h.invoke(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 'bilibili',
      displayName: 'B 站',
    });
    expect(res).toEqual({
      ok: false,
      code: 'unsupported_platform',
      message: ACCOUNT_V2_ERROR_MESSAGES.unsupported_platform,
    });
    expect(h.resolverCalls).toEqual([]);
  });
});

// ─── 同平台同名隔离与 sender-only 事件 ────────────────────────────────────────

describe('account-v2 bootstrap：账号隔离与事件回发', () => {
  it('同平台同名两账号经桥各自独立 UUID 与独立密文', async () => {
    const h = makeBridge();
    const first = await createAccountViaBridge(h, {
      platform: 'tencent',
      displayName: '同名',
      owner: 'tester',
    });
    const second = await createAccountViaBridge(h, {
      platform: 'tencent',
      displayName: '同名',
      owner: 'tester',
    });
    expect(first.id === second.id).toBe(false);
    const loginFirst = await h.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: first.id,
      requestId: randomUUID(),
    });
    const loginSecond = await h.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: second.id,
      requestId: randomUUID(),
    });
    expect(loginFirst.ok).toBe(true);
    expect(loginSecond.ok).toBe(true);
    const refs = h.registry().accounts.map((a) => a.sessionRef);
    expect(refs).toHaveLength(2);
    expect(refs[0] === refs[1]).toBe(false);
    expect(h.sessionBytes(refs[0] as string).equals(h.sessionBytes(refs[1] as string))).toBe(false);
  });

  it('二维码事件只回发起 invoke 的 sender；载荷无路径 / sessionRef / 明文', async () => {
    let loginCount = 0;
    const h = makeBridge({
      resolvePlatform: () => ({
        login: async (opts: LoginOptions) => {
          loginCount += 1;
          const png = join(dirname(opts.storageStatePath), 'qr-bridge.png');
          writeFileSync(png, pngFixture(String(loginCount)));
          opts.onQrcode?.(png);
          writeFileSync(opts.storageStatePath, storageStateFixture(`qr-${loginCount}`));
          return { success: true, message: 'qr bridge ok' };
        },
        checkCookie: async () => true,
      }),
    });
    const dto = await createAccountViaBridge(h, { platform: 'kuaishou', displayName: '扫码桥' });
    const first = await h.invoke(
      ACCOUNT_V2_IPC_CHANNELS.login,
      { accountId: dto.id, requestId: randomUUID() },
      'window-A',
    );
    expect(first.ok).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].sender).toBe('window-A');
    expect(h.sent[0].channel).toBe(ACCOUNT_V2_IPC_CHANNELS.qrcode);
    const payload = h.sent[0].payload as { sequence: number; imageDataUrl: string };
    expect(payload.sequence).toBe(1);
    expect(payload.imageDataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const second = await h.invoke(
      ACCOUNT_V2_IPC_CHANNELS.login,
      { accountId: dto.id, requestId: randomUUID() },
      'window-B',
    );
    expect(second.ok).toBe(true);
    expect(h.sent.filter((e) => e.sender === 'window-A')).toHaveLength(1);
    expect(h.sent.filter((e) => e.sender === 'window-B')).toHaveLength(1);

    const serialized = JSON.stringify([first, second, h.sent]);
    expect(serialized).not.toContain(h.userData);
    expect(serialized).not.toContain(ACCOUNT_V2_DATA_DIR_NAME);
    expect(serialized).not.toContain('sessionRef');
    expect(serialized).not.toContain('storageState.json');
    expect(serialized).not.toContain(SECRET_TAG);
    expect(serialized).not.toContain('qr-bridge');
  });
});

// ─── preload 桥契约 ───────────────────────────────────────────────────────────

describe('accountV2 preload 桥：通道映射与退订', () => {
  it('accountV2API 独立于 publishAPI；方法只映射固定 account-v2 通道，登录参数携 accountId/requestId/headless?', async () => {
    await loadPreload();
    const api = preloadBridge.exposed.accountV2API as {
      create: (...args: unknown[]) => Promise<unknown>;
      list: () => Promise<unknown>;
      login: (input: unknown) => Promise<unknown>;
      check: (id: string) => Promise<unknown>;
      delete: (id: string) => Promise<unknown>;
      migrationPreview: () => Promise<unknown>;
    };
    expect(Object.keys(api).sort()).toEqual(['check', 'create', 'delete', 'list', 'login', 'migrationPreview', 'onQrcode']);
    expect(preloadBridge.exposed.accountV2API === preloadBridge.exposed.publishAPI).toBe(false);

    preloadBridge.invocations.length = 0;
    await api.create('douyin', '桥账号', 'tester');
    await api.list();
    await api.login({ accountId: 'a', requestId: 'r' });
    await api.login({ accountId: 'a', requestId: 'r', headless: false });
    await api.check('a');
    await api.delete('a');
    await api.migrationPreview();
    expect(preloadBridge.invocations.map((i) => i.channel)).toEqual([
      ACCOUNT_V2_IPC_CHANNELS.create,
      ACCOUNT_V2_IPC_CHANNELS.list,
      ACCOUNT_V2_IPC_CHANNELS.login,
      ACCOUNT_V2_IPC_CHANNELS.login,
      ACCOUNT_V2_IPC_CHANNELS.check,
      ACCOUNT_V2_IPC_CHANNELS.delete,
      LEGACY_MIGRATION_PREVIEW_CHANNEL,
    ]);
    expect(preloadBridge.invocations[0].args[0]).toEqual({
      platform: 'douyin',
      displayName: '桥账号',
      owner: 'tester',
    });
    expect(preloadBridge.invocations[1].args[0]).toEqual({});
    expect(preloadBridge.invocations[2].args[0]).toEqual({ accountId: 'a', requestId: 'r' });
    expect(preloadBridge.invocations[3].args[0]).toEqual({
      accountId: 'a',
      requestId: 'r',
      headless: false,
    });
    expect(preloadBridge.invocations[4].args[0]).toEqual({ accountId: 'a' });
    expect(preloadBridge.invocations[5].args[0]).toEqual({ accountId: 'a' });
    expect(preloadBridge.invocations[6].args).toEqual([]);
    expect(preloadBridge.invocations.every((i) => i.channel.startsWith('account-v2:'))).toBe(true);
  });

  it('onQrcode 订阅 account-v2:qrcode 并交付载荷；退订实际移除 listener', async () => {
    await loadPreload();
    const api = preloadBridge.exposed.accountV2API as {
      onQrcode: (callback: (event: unknown) => void) => () => void;
    };
    const received: unknown[] = [];
    const unsubscribe = api.onQrcode((event) => {
      received.push(event);
    });
    const channel = ACCOUNT_V2_IPC_CHANNELS.qrcode;
    const listeners = preloadBridge.listeners.get(channel);
    expect(listeners?.size).toBe(1);

    const payload = {
      requestId: 'r',
      accountId: 'a',
      sequence: 1,
      imageDataUrl: 'data:image/png;base64,AA==',
    };
    for (const handler of listeners ?? []) handler({}, payload);
    expect(received).toEqual([payload]);

    unsubscribe();
    expect(preloadBridge.listeners.get(channel)?.size ?? 0).toBe(0);
    for (const handler of preloadBridge.listeners.get(channel) ?? []) handler({}, payload);
    expect(received).toHaveLength(1);
  });
});

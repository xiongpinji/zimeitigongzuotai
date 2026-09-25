/**
 * A2-S1 合成 RED 测试：account-v2 主进程账号服务 / IPC 注册工厂。
 *
 * 全部数据合成：FakeCipher（可逆编码，非加密）、假平台模块、假 IPC、临时目录
 * fixture。不触真实平台 / 浏览器 / 网络 / 生产 userData / 迁移。
 *
 * 断言锁定以下契约（与任务验收标准一一对应）：
 * - 同平台同名两账号：UUID DTO / 加密 sessionRef 各自独立；删除其一，另一份
 *   字节不变；序列化输出不含 sessionRef / 密文引用 / 路径 / Cookie / 原文。
 * - 首次登录与续登都经 A1 事务写入不同的合成 storageState；success:false、
 *   平台异常、畸形成功输出都不替换既有密文。
 * - cipher 不可用在平台回调之前拒绝登录（回调零次、无明文回退、固定错误载荷）。
 * - 二维码回调：递增 sequence 事件（预知 requestId/accountId + data URL）；
 *   越界路径 / symlink / 非 PNG / 超限 / 第 65 次回调 → qrcode_failed 且
 *   绝不提交会话；平台吞掉回调异常仍报成功也强制失败。
 * - 探针 false 只使目标过期；探针异常保持原状态；登录中删除 → login_busy；
 *   不同账号互不影响；畸形 UUID / requestId / bilibili 在平台调用前拒绝。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccountVault, type SessionCipher } from '../../electron/publish/accounts-v2';
import type { LoginOptions } from '../../electron/publish/types';
import {
  ACCOUNT_V2_ERROR_MESSAGES,
  ACCOUNT_V2_IPC_CHANNELS,
  registerAccountsV2Ipc,
  type AccountPlatformFactory,
  type AccountV2Dto,
  type AccountV2QrcodeEvent,
} from '../../electron/publish/accounts-v2-ipc';

// ─── node:fs 定向拦截 ─────────────────────────────────────────────────────────
// 仅对特定文件名拦截 lstatSync 以模拟 symlink：真实 symlinkSync 在 Windows 上
// 需要管理员权限 / 开发者模式，mock 保证 Codex 的 Windows Node 22 复跑确定性。
// 其余全部透传真实 node:fs（vault 的原子写 / 临时目录语义不受影响）。
// vi.mock 工厂被提升到 import 之前执行，常量必须经 vi.hoisted 提供（避免 TDZ）。
const SYMLINK_QR_BASENAME = vi.hoisted(() => 'qr-symlink.png');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const lstatSync = ((p: unknown, ...rest: unknown[]) => {
    if (String(p).endsWith(SYMLINK_QR_BASENAME)) {
      return {
        isSymbolicLink: () => true,
        isFile: () => false,
      } as unknown as import('node:fs').Stats;
    }
    return (actual.lstatSync as (...args: unknown[]) => unknown)(p, ...rest);
  }) as unknown as typeof actual.lstatSync;
  return { ...actual, lstatSync };
});

// ─── 合成夹具 ─────────────────────────────────────────────────────────────────

// ⚠️ 测试专用假加密器：只做可逆编码，没有任何安全性；严禁进入生产路径。
class FakeCipher implements SessionCipher {
  available = true;

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(plaintext: Buffer): Buffer {
    return Buffer.from(`fake1:${plaintext.toString('base64')}`, 'utf-8');
  }

  decrypt(ciphertext: Buffer): Buffer {
    const text = ciphertext.toString('utf-8');
    if (!text.startsWith('fake1:')) throw new Error('not a fake cipher payload');
    return Buffer.from(text.slice('fake1:'.length), 'base64');
  }
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_REF_RE = /^s1-[0-9a-f]{32}$/;
const SECRET_COOKIE_VALUE = 'SECRET-SESSIONID-VALUE-DO-NOT-LEAK';
const RAW_PLATFORM_TEXT = 'RAW-PLATFORM-TEXT cookie=abc123 path=/secret/tmp/dir';
const NOW0 = 1_700_000_000_000;
const QR_LIMIT_BYTES = 512 * 1024;
const QR_EVENT_LIMIT = 64;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DTO_KEYS = [
  'createdAt',
  'displayName',
  'hasSession',
  'id',
  'lastCheckedAt',
  'owner',
  'platform',
  'status',
];
const QR_EVENT_KEYS = ['accountId', 'imageDataUrl', 'requestId', 'sequence'];

function storageStateFixture(tag: string): string {
  return JSON.stringify({
    cookies: [{ name: 'sessionid', value: `${SECRET_COOKIE_VALUE}-${tag}`, domain: '.example.test' }],
    origins: [],
  });
}

function pngFixture(tag: string): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.from(`synthetic-qr-${tag}`, 'utf-8')]);
}

function dataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

function fakeIpc() {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  return {
    handle: (ch: string, fn: (...args: never[]) => unknown) => {
      handlers.set(ch, fn);
    },
    _get: (ch: string) => {
      const fn = handlers.get(ch);
      if (!fn) throw new Error(`test setup: no handler registered for ${ch}`);
      return fn as (...args: unknown[]) => unknown;
    },
    _has: (ch: string) => handlers.has(ch),
    _channels: () => [...handlers.keys()],
  };
}

interface Behavior {
  login?: (platform: string, opts: LoginOptions) => Promise<{ success: boolean; message: string }>;
  check?: (platform: string, storageStatePath: string) => Promise<unknown> | unknown;
  missingPlatforms?: string[];
  /** true 时不注入 sendEvent：二维码事件必须走调用事件 sender.send 回退。 */
  useSenderFallback?: boolean;
}

function makeContext(behavior: Behavior = {}) {
  const root = mkdtempSync(join(tmpdir(), 'a2s1-vault-'));
  const tmpBase = mkdtempSync(join(tmpdir(), 'a2s1-tmp-'));
  const cipher = new FakeCipher();
  let clock = NOW0;
  const vault = new AccountVault(root, cipher, {
    now: () => clock,
    tmpBaseDir: tmpBase,
  });
  const ipc = fakeIpc();
  const events: Array<{ channel: string; payload: unknown }> = [];
  const factoryCalls: string[] = [];
  const loginOptsLog: LoginOptions[] = [];
  const platformSpies: Record<string, { loginCalls: number; checkCalls: number }> = {};

  const platformFactory: AccountPlatformFactory = (platform) => {
    factoryCalls.push(platform);
    if ((behavior.missingPlatforms ?? []).includes(platform)) return undefined;
    const spy = (platformSpies[platform] ??= { loginCalls: 0, checkCalls: 0 });
    return {
      login: async (opts: LoginOptions) => {
        spy.loginCalls += 1;
        loginOptsLog.push(opts);
        if (!behavior.login) return { success: false, message: 'no login behavior configured' };
        return behavior.login(platform, opts);
      },
      checkCookie: async (storageStatePath: string): Promise<boolean> => {
        spy.checkCalls += 1;
        if (!behavior.check) return false;
        return (await behavior.check(platform, storageStatePath)) as boolean;
      },
    };
  };

  registerAccountsV2Ipc({
    ipc: ipc as never,
    vault,
    platformFactory,
    ...(behavior.useSenderFallback
      ? {}
      : {
          sendEvent: (channel: string, payload: AccountV2QrcodeEvent) => {
            events.push({ channel, payload });
          },
        }),
  });

  const registryJson = (): { schemaVersion: number; accounts: Record<string, unknown>[] } =>
    JSON.parse(readFileSync(join(root, 'registry.json'), 'utf-8'));
  const registryEntry = (id: string): Record<string, unknown> => {
    const entry = registryJson().accounts.find((a) => a.id === id);
    if (!entry) throw new Error(`test setup: no registry entry for ${id}`);
    return entry;
  };
  const sessionFileNames = (): string[] => {
    const dir = join(root, 'sessions');
    return existsSync(dir) ? readdirSync(dir) : [];
  };
  const sessionBytes = (ref: string): Buffer => readFileSync(join(root, 'sessions', `${ref}.bin`));
  const decryptSession = (id: string): string => {
    const ref = registryEntry(id).sessionRef as string | null;
    if (!ref) throw new Error(`test setup: account ${id} has no sessionRef`);
    return cipher.decrypt(sessionBytes(ref)).toString('utf-8');
  };

  return {
    root,
    tmpBase,
    cipher,
    vault,
    ipc,
    events,
    factoryCalls,
    loginOptsLog,
    platformSpies,
    behavior,
    advanceClock(ms: number) {
      clock += ms;
    },
    now(): number {
      return clock;
    },
    invoke(channel: string, payload?: unknown): Promise<any> {
      const event = {
        sender: {
          send: (ch: string, p: unknown) => {
            events.push({ channel: ch, payload: p });
          },
        },
      };
      return Promise.resolve(ipc._get(channel)(event, payload));
    },
    registryJson,
    registryEntry,
    sessionFileNames,
    sessionBytes,
    decryptSession,
  };
}

type TestContext = ReturnType<typeof makeContext>;

/** 序列化输出安全扫描：IPC 载荷绝不含密文引用 / 路径 / 合成 Cookie / 平台原文。 */
function expectNoSecrets(serialized: string, ctx: TestContext, extra: string[] = []): void {
  for (const secret of [
    'sessionRef',
    'migratedFrom',
    's1-',
    SECRET_COOKIE_VALUE,
    RAW_PLATFORM_TEXT,
    'storageState.json',
    '.png',
    'boom',
    ctx.root,
    ctx.tmpBase,
    '/secret/tmp/dir',
    '/tmp/secret',
    ...extra,
  ]) {
    expect(serialized, `serialized IPC payload must not contain ${JSON.stringify(secret)}`).not.toContain(
      secret,
    );
  }
}

function makeOutsideDir(): string {
  return mkdtempSync(join(tmpdir(), 'a2s1-outside-'));
}

/** 便捷：create → 返回 DTO（要求 ok:true）。 */
async function createAccount(
  ctx: TestContext,
  input: { platform?: string; displayName?: string; owner?: string } = {},
): Promise<AccountV2Dto> {
  const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.create, {
    platform: 'douyin',
    displayName: '合成账号',
    ...input,
  });
  expect(res.ok, JSON.stringify(res)).toBe(true);
  return res.account as AccountV2Dto;
}

/** 便捷：登录成功并写入指定 fixture。 */
async function loginWithFixture(
  ctx: TestContext,
  accountId: string,
  tag: string,
): Promise<unknown> {
  ctx.behavior.login = async (_platform, opts) => {
    writeFileSync(opts.storageStatePath, storageStateFixture(tag));
    return { success: true, message: `${RAW_PLATFORM_TEXT}-${tag}` };
  };
  const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
    accountId,
    requestId: randomUUID(),
  });
  expect(res.ok, JSON.stringify(res)).toBe(true);
  return res;
}

// ─── 注册 ─────────────────────────────────────────────────────────────────────

describe('account-v2 IPC：注册', () => {
  it('恰好注册五个 account-v2 通道；不注册任何旧 publish:* 通道；通道命名锁定', () => {
    const ctx = makeContext();
    expect(ctx.ipc._channels().sort()).toEqual([
      'account-v2:check',
      'account-v2:create',
      'account-v2:delete',
      'account-v2:list',
      'account-v2:login',
    ]);
    expect(ctx.ipc._has('publish:login')).toBe(false);
    expect(ctx.ipc._has('publish:list-accounts')).toBe(false);
    expect(ctx.ipc._has('publish:check')).toBe(false);
    expect(ctx.ipc._has('publish:delete-account')).toBe(false);
    expect(ACCOUNT_V2_IPC_CHANNELS).toEqual({
      create: 'account-v2:create',
      list: 'account-v2:list',
      login: 'account-v2:login',
      check: 'account-v2:check',
      delete: 'account-v2:delete',
      qrcode: 'account-v2:qrcode',
    });
  });
});

// ─── create / list：安全 DTO 与同平台同名隔离 ────────────────────────────────

describe('account-v2 IPC：create / list 安全 DTO', () => {
  it('两个同名 tencent 账号：UUID DTO 与加密 sessionRef 各自独立；删除其一，另一份字节不变', async () => {
    const ctx = makeContext();
    const fixtures = ['twin-A', 'twin-B'];
    let loginIndex = 0;
    ctx.behavior.login = async (_platform, opts) => {
      const tag = fixtures[loginIndex];
      loginIndex += 1;
      writeFileSync(opts.storageStatePath, storageStateFixture(tag));
      return { success: true, message: `${RAW_PLATFORM_TEXT}-${tag}` };
    };

    const createA = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 'tencent',
      displayName: '同名账号',
      owner: 'tester',
    });
    const createB = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 'tencent',
      displayName: '同名账号',
      owner: 'tester',
    });
    expect(createA.ok).toBe(true);
    expect(createB.ok).toBe(true);
    const dtoA: AccountV2Dto = createA.account;
    const dtoB: AccountV2Dto = createB.account;
    expect(dtoA.id).not.toBe(dtoB.id);
    expect(dtoA.id).toMatch(UUID_V4_RE);
    expect(dtoB.id).toMatch(UUID_V4_RE);
    expect(dtoA.displayName).toBe('同名账号');
    expect(dtoB.displayName).toBe(dtoA.displayName);
    expect(dtoA.platform).toBe('tencent');
    expect(Object.keys(dtoA).sort()).toEqual(DTO_KEYS);
    expect('sessionRef' in dtoA).toBe(false);
    expect('migratedFrom' in dtoA).toBe(false);
    expect(dtoA.hasSession).toBe(false);
    expect(dtoA.status).toBe('unknown');
    expect(dtoA.createdAt).toBe(NOW0);

    const loginA = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dtoA.id,
      requestId: randomUUID(),
    });
    const loginB = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dtoB.id,
      requestId: randomUUID(),
    });
    expect(loginA.ok).toBe(true);
    expect(loginB.ok).toBe(true);

    const entryA = ctx.registryEntry(dtoA.id);
    const entryB = ctx.registryEntry(dtoB.id);
    expect(entryA.sessionRef).toMatch(SESSION_REF_RE);
    expect(entryB.sessionRef).toMatch(SESSION_REF_RE);
    expect(entryA.sessionRef).not.toBe(entryB.sessionRef);
    expect(
      ctx.sessionBytes(entryA.sessionRef as string).equals(ctx.sessionBytes(entryB.sessionRef as string)),
    ).toBe(false);
    expect(ctx.decryptSession(dtoA.id)).toBe(storageStateFixture('twin-A'));
    expect(ctx.decryptSession(dtoB.id)).toBe(storageStateFixture('twin-B'));

    const listBefore = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.list, {});
    const dtoBAfterLogin: AccountV2Dto = listBefore.accounts.find(
      (a: AccountV2Dto) => a.id === dtoB.id,
    );
    const entryBBefore = ctx.registryEntry(dtoB.id);
    const bytesBBefore = ctx.sessionBytes(entryB.sessionRef as string);

    const deleteA = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.delete, { accountId: dtoA.id });
    expect(deleteA).toEqual({ ok: true, accountId: dtoA.id });

    const listAfter = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.list, {});
    expect(listAfter.accounts).toHaveLength(1);
    expect(listAfter.accounts[0]).toEqual(dtoBAfterLogin);
    expect(ctx.registryEntry(dtoB.id)).toEqual(entryBBefore);
    expect(ctx.sessionBytes(entryBBefore.sessionRef as string).equals(bytesBBefore)).toBe(true);
    expect(ctx.sessionFileNames()).toEqual([`${entryBBefore.sessionRef}.bin`]);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);

    expectNoSecrets(
      JSON.stringify([createA, createB, loginA, loginB, deleteA, listBefore, listAfter]),
      ctx,
    );
  });

  it('create 在平台工厂调用前拒绝 bilibili / 别名平台与畸形输入', async () => {
    const ctx = makeContext();
    const bilibili = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 'bilibili',
      displayName: 'B 站账号',
    });
    expect(bilibili).toEqual({
      ok: false,
      code: 'unsupported_platform',
      message: ACCOUNT_V2_ERROR_MESSAGES.unsupported_platform,
    });
    // tencent 在本层保持 tencent；发布目标映射（wechat-channels）不属于账号服务。
    const alias = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 'wechat-channels',
      displayName: '视频号别名',
    });
    expect(alias.code).toBe('unsupported_platform');
    const blankName = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 'tencent',
      displayName: '   ',
    });
    expect(blankName.code).toBe('invalid_request');
    const numericPlatform = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 42,
      displayName: 'x',
    });
    expect(numericPlatform.code).toBe('invalid_request');
    const nullPayload = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.create, null);
    expect(nullPayload.code).toBe('invalid_request');
    expect(await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.list, {})).toEqual({ ok: true, accounts: [] });
    expect(ctx.factoryCalls).toEqual([]);
    expect(ctx.sessionFileNames()).toEqual([]);
  });

  it('create 省略 owner 时由 vault 归一为 local；DTO 投影字段锁定', async () => {
    const ctx = makeContext();
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 'xiaohongshu',
      displayName: '无 owner',
    });
    expect(res.ok).toBe(true);
    const dto: AccountV2Dto = res.account;
    expect(dto.owner).toBe('local');
    expect(dto.platform).toBe('xiaohongshu');
    expect(Object.keys(dto).sort()).toEqual(DTO_KEYS);
    expect(dto.lastCheckedAt).toBeNull();
    expectNoSecrets(JSON.stringify(res), ctx);
  });
});

// ─── login：A1 事务（首登 / 续登 / 失败保持旧密文） ──────────────────────────

describe('account-v2 IPC：login 经 A1 事务', () => {
  it('首次登录：合成 storageState 加密入仓；DTO valid；平台原文不返回；临时目录零残留；headless 默认 true', async () => {
    const ctx = makeContext();
    ctx.behavior.login = async (_platform, opts) => {
      writeFileSync(opts.storageStatePath, storageStateFixture('first'));
      return { success: true, message: RAW_PLATFORM_TEXT };
    };
    const dto = await createAccount(ctx, { platform: 'douyin', displayName: '首登账号' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({ ok: true, account: res.account });
    expect(res.account.id).toBe(dto.id);
    expect(res.account.status).toBe('valid');
    expect(res.account.hasSession).toBe(true);
    expect(res.account.lastCheckedAt).toBe(NOW0);
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('first'));
    expect(ctx.platformSpies['douyin'].loginCalls).toBe(1);
    expect(ctx.loginOptsLog[0].headless).toBe(true);
    expect(typeof ctx.loginOptsLog[0].onQrcode).toBe('function');
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expectNoSecrets(JSON.stringify(res), ctx);

    // 续登必须写出与种子不同的字节（A1 新鲜度校验），否则 login_result_invalid。
    ctx.behavior.login = async (_platform, opts) => {
      writeFileSync(opts.storageStatePath, storageStateFixture('first-headed'));
      return { success: true, message: 'ok' };
    };
    const headed = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
      headless: false,
    });
    expect(headed.ok).toBe(true);
    expect(ctx.loginOptsLog[1].headless).toBe(false);
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('first-headed'));
  });

  it('续登：新的合成 storageState 覆盖旧密文并轮换 sessionRef，旧密文文件删除', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '续登账号' });
    await loginWithFixture(ctx, dto.id, 'renew-1');
    const ref1 = ctx.registryEntry(dto.id).sessionRef as string;
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('renew-1'));

    ctx.advanceClock(5_000);
    await loginWithFixture(ctx, dto.id, 'renew-2');
    const entry2 = ctx.registryEntry(dto.id);
    const ref2 = entry2.sessionRef as string;
    expect(ref2).toMatch(SESSION_REF_RE);
    expect(ref2).not.toBe(ref1);
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('renew-2'));
    expect(ctx.decryptSession(dto.id)).not.toBe(storageStateFixture('renew-1'));
    expect(ctx.sessionFileNames()).toEqual([`${ref2}.bin`]);
    expect(entry2.status).toBe('valid');
    expect(entry2.lastCheckedAt).toBe(NOW0 + 5_000);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
  });

  it('success:false：保留旧会话（密文字节与 registry 不变），返回固定 login_failed', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '取消登录' });
    await loginWithFixture(ctx, dto.id, 'keep-1');
    const entryBefore = ctx.registryEntry(dto.id);
    const bytesBefore = ctx.sessionBytes(entryBefore.sessionRef as string);

    ctx.behavior.login = async () => ({
      success: false,
      message: `${RAW_PLATFORM_TEXT}-user-cancelled`,
    });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'login_failed',
      message: ACCOUNT_V2_ERROR_MESSAGES.login_failed,
    });
    expect(ctx.registryEntry(dto.id)).toEqual(entryBefore);
    expect(ctx.sessionBytes(entryBefore.sessionRef as string).equals(bytesBefore)).toBe(true);
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('keep-1'));
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expectNoSecrets(JSON.stringify(res), ctx, ['user-cancelled']);
  });

  it('平台抛异常（message 携带路径与 Cookie）：login_failed，Error.message 不泄露，会话保持', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '异常登录' });
    await loginWithFixture(ctx, dto.id, 'throw-1');
    const entryBefore = ctx.registryEntry(dto.id);
    const bytesBefore = ctx.sessionBytes(entryBefore.sessionRef as string);

    ctx.behavior.login = async (_platform, opts) => {
      throw new Error(
        `boom storageState=${opts.storageStatePath} cookie=${SECRET_COOKIE_VALUE} ${RAW_PLATFORM_TEXT}`,
      );
    };
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'login_failed',
      message: ACCOUNT_V2_ERROR_MESSAGES.login_failed,
    });
    expect(ctx.registryEntry(dto.id)).toEqual(entryBefore);
    expect(ctx.sessionBytes(entryBefore.sessionRef as string).equals(bytesBefore)).toBe(true);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expectNoSecrets(JSON.stringify([res, ctx.events]), ctx);
  });

  it('畸形成功输出（success 非严格布尔）：login_result_invalid，不提交任何会话', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '畸形输出' });
    ctx.behavior.login = async (_platform, opts) => {
      writeFileSync(opts.storageStatePath, storageStateFixture('malformed'));
      return { success: 1 as unknown as boolean, message: 'truthy success' };
    };
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'login_result_invalid',
      message: ACCOUNT_V2_ERROR_MESSAGES.login_result_invalid,
    });
    const entry = ctx.registryEntry(dto.id);
    expect(entry.sessionRef).toBeNull();
    expect(entry.status).toBe('unknown');
    expect(ctx.sessionFileNames()).toEqual([]);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expectNoSecrets(JSON.stringify(res), ctx, ['truthy success']);
  });

  it('续登 success:true 但未写新输出（种子未变）：login_result_invalid，旧密文逐字节不变', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '假成功续登' });
    await loginWithFixture(ctx, dto.id, 'stale-1');
    const entryBefore = ctx.registryEntry(dto.id);
    const bytesBefore = ctx.sessionBytes(entryBefore.sessionRef as string);

    ctx.behavior.login = async () => ({ success: true, message: 'no output written' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'login_result_invalid',
      message: ACCOUNT_V2_ERROR_MESSAGES.login_result_invalid,
    });
    expect(ctx.registryEntry(dto.id)).toEqual(entryBefore);
    expect(ctx.sessionBytes(entryBefore.sessionRef as string).equals(bytesBefore)).toBe(true);
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('stale-1'));
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expectNoSecrets(JSON.stringify(res), ctx, ['no output written']);
  });

  it('cipher 不可用：平台回调之前拒绝登录，固定错误载荷，无明文回退', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '无加密登录' });
    ctx.cipher.available = false;
    let platformReached = false;
    ctx.behavior.login = async (_platform, opts) => {
      platformReached = true;
      writeFileSync(opts.storageStatePath, storageStateFixture('plaintext-leak'));
      return { success: true, message: 'should never run' };
    };
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'cipher_unavailable',
      message: ACCOUNT_V2_ERROR_MESSAGES.cipher_unavailable,
    });
    expect(platformReached).toBe(false);
    expect(ctx.platformSpies['douyin']?.loginCalls ?? 0).toBe(0);
    // 无明文回退：临时目录未创建、会话目录为空、registry 元数据不变。
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expect(ctx.sessionFileNames()).toEqual([]);
    const entry = ctx.registryEntry(dto.id);
    expect(entry.sessionRef).toBeNull();
    expect(entry.status).toBe('unknown');
    expectNoSecrets(JSON.stringify(res), ctx, ['should never run', 'plaintext-leak']);
  });
});

// ─── login：单账号互斥与多账号独立 ───────────────────────────────────────────

describe('account-v2 IPC：登录互斥', () => {
  it('同账号登录进行中：第二次登录返回 login_busy；完成后锁释放', async () => {
    const ctx = makeContext();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    ctx.behavior.login = async (_platform, opts) => {
      await gate;
      writeFileSync(opts.storageStatePath, storageStateFixture('gated'));
      return { success: true, message: 'gated done' };
    };
    const dto = await createAccount(ctx, { displayName: '互斥账号' });

    const first = ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    const second = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(second).toEqual({
      ok: false,
      code: 'login_busy',
      message: ACCOUNT_V2_ERROR_MESSAGES.login_busy,
    });
    expect(ctx.platformSpies['douyin'].loginCalls).toBe(1);

    releaseGate();
    const firstRes = await first;
    expect(firstRes.ok).toBe(true);

    // 锁已释放：可再次登录。
    await loginWithFixture(ctx, dto.id, 'after-gate');
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('after-gate'));
  });

  it('登录进行中：删除该账号返回 login_busy；不同账号登录 / 删除 / list 互不影响', async () => {
    const ctx = makeContext();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    ctx.behavior.login = async (platform, opts) => {
      await gate;
      writeFileSync(opts.storageStatePath, storageStateFixture(`busy-${platform}`));
      return { success: true, message: 'done' };
    };
    const dtoA = await createAccount(ctx, { platform: 'douyin', displayName: '忙碌 A' });
    const dtoB = await createAccount(ctx, { platform: 'tencent', displayName: '独立 B' });
    const dtoC = await createAccount(ctx, { platform: 'kuaishou', displayName: '可删 C' });

    const loginA = ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dtoA.id,
      requestId: randomUUID(),
    });
    const loginB = ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dtoB.id,
      requestId: randomUUID(),
    });
    // 两个不同账号可同时进入平台回调（互不阻塞）。
    expect(ctx.platformSpies['douyin'].loginCalls).toBe(1);
    expect(ctx.platformSpies['tencent'].loginCalls).toBe(1);

    expect(
      (await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.delete, { accountId: dtoA.id })).code,
    ).toBe('login_busy');
    expect(
      (await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.delete, { accountId: dtoB.id })).code,
    ).toBe('login_busy');
    const deleteC = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.delete, { accountId: dtoC.id });
    expect(deleteC).toEqual({ ok: true, accountId: dtoC.id });
    const listMid = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.list, {});
    expect(listMid.accounts.map((a: AccountV2Dto) => a.id).sort()).toEqual(
      [dtoA.id, dtoB.id].sort(),
    );

    releaseGate();
    expect((await loginA).ok).toBe(true);
    expect((await loginB).ok).toBe(true);
    expect(ctx.decryptSession(dtoA.id)).toBe(storageStateFixture('busy-douyin'));
    expect(ctx.decryptSession(dtoB.id)).toBe(storageStateFixture('busy-tencent'));
  });
});

// ─── login：二维码受限数据事件 ───────────────────────────────────────────────

describe('account-v2 IPC：二维码事件约束', () => {
  it('两次合法回调 → 递增 sequence 事件，携带预知 requestId/accountId 与 data URL，不含路径', async () => {
    const ctx = makeContext();
    const requestId = randomUUID();
    ctx.behavior.login = async (_platform, opts) => {
      const dir = dirname(opts.storageStatePath);
      const p1 = join(dir, 'qr-1.png');
      const p2 = join(dir, 'qr-2.png');
      writeFileSync(p1, pngFixture('1'));
      opts.onQrcode?.(p1);
      writeFileSync(p2, pngFixture('2'));
      opts.onQrcode?.(p2);
      writeFileSync(opts.storageStatePath, storageStateFixture('qr-ok'));
      return { success: true, message: 'done' };
    };
    const dto = await createAccount(ctx, { displayName: '扫码账号' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId,
    });
    expect(res.ok).toBe(true);
    expect(ctx.events).toHaveLength(2);
    expect(ctx.events.map((e) => e.channel)).toEqual([
      ACCOUNT_V2_IPC_CHANNELS.qrcode,
      ACCOUNT_V2_IPC_CHANNELS.qrcode,
    ]);
    const payloads = ctx.events.map((e) => e.payload as AccountV2QrcodeEvent);
    expect(payloads[0]).toEqual({
      requestId,
      accountId: dto.id,
      sequence: 1,
      imageDataUrl: dataUrl(pngFixture('1')),
    });
    expect(payloads[1]).toEqual({
      requestId,
      accountId: dto.id,
      sequence: 2,
      imageDataUrl: dataUrl(pngFixture('2')),
    });
    expect(Object.keys(payloads[0]).sort()).toEqual(QR_EVENT_KEYS);
    expect(payloads[0].imageDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expectNoSecrets(JSON.stringify([res, ctx.events]), ctx, ['qr-1', 'qr-2']);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
  });

  it('未注入 sendEvent 时二维码事件经调用事件 sender.send 发送', async () => {
    const ctx = makeContext({ useSenderFallback: true });
    const requestId = randomUUID();
    ctx.behavior.login = async (_platform, opts) => {
      const dir = dirname(opts.storageStatePath);
      const png = join(dir, 'qr-fallback.png');
      writeFileSync(png, pngFixture('fallback'));
      opts.onQrcode?.(png);
      writeFileSync(opts.storageStatePath, storageStateFixture('fallback-ok'));
      return { success: true, message: 'done' };
    };
    const dto = await createAccount(ctx, { displayName: '回退 sender' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, { accountId: dto.id, requestId });
    expect(res.ok).toBe(true);
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0].channel).toBe('account-v2:qrcode');
    expect(ctx.events[0].payload).toEqual({
      requestId,
      accountId: dto.id,
      sequence: 1,
      imageDataUrl: dataUrl(pngFixture('fallback')),
    });
  });

  it('越界路径（临时目录之外 / 穿越路径）→ qrcode_failed：零事件、写了输出也不提交', async () => {
    const ctx = makeContext();
    const outside = makeOutsideDir();
    ctx.behavior.login = async (_platform, opts) => {
      // 先写出合法新输出，再触发二维码违规：验证即便有可提交候选也绝不入仓。
      writeFileSync(opts.storageStatePath, storageStateFixture('outside'));
      const ghost = join(dirname(opts.storageStatePath), '..', 'ghost-traversal.png');
      try {
        opts.onQrcode?.(ghost);
      } catch {
        // 平台可能吞掉第一次违规；继续第二次不可吞的违规。
      }
      const evil = join(outside, 'evil.png');
      writeFileSync(evil, pngFixture('evil'));
      opts.onQrcode?.(evil); // 抛出且不被平台捕获
      return { success: true, message: 'unreachable' };
    };
    const dto = await createAccount(ctx, { displayName: '越界二维码' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'qrcode_failed',
      message: ACCOUNT_V2_ERROR_MESSAGES.qrcode_failed,
    });
    expect(ctx.events).toEqual([]);
    const entry = ctx.registryEntry(dto.id);
    expect(entry.sessionRef).toBeNull();
    expect(entry.status).toBe('unknown');
    expect(ctx.sessionFileNames()).toEqual([]);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expectNoSecrets(JSON.stringify([res, ctx.events]), ctx, ['evil', 'ghost', 'unreachable']);
  });

  it('symlink PNG（lstat 判定）→ qrcode_failed，不读取、不发送', async () => {
    const ctx = makeContext();
    ctx.behavior.login = async (_platform, opts) => {
      const dir = dirname(opts.storageStatePath);
      const link = join(dir, SYMLINK_QR_BASENAME);
      // 真实普通文件；mock 的 lstatSync 对该文件名判定为 symlink（跨平台确定性）。
      writeFileSync(link, pngFixture('sym'));
      opts.onQrcode?.(link);
      return { success: true, message: 'unreachable' };
    };
    const dto = await createAccount(ctx, { displayName: 'symlink 二维码' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'qrcode_failed',
      message: ACCOUNT_V2_ERROR_MESSAGES.qrcode_failed,
    });
    expect(ctx.events).toEqual([]);
    expect(ctx.registryEntry(dto.id).sessionRef).toBeNull();
    expect(ctx.sessionFileNames()).toEqual([]);
  });

  it('非 PNG 魔数 → qrcode_failed', async () => {
    const ctx = makeContext();
    ctx.behavior.login = async (_platform, opts) => {
      const dir = dirname(opts.storageStatePath);
      const fake = join(dir, 'qr-not-png.png');
      writeFileSync(fake, 'definitely-not-a-png-payload');
      opts.onQrcode?.(fake);
      return { success: true, message: 'unreachable' };
    };
    const dto = await createAccount(ctx, { displayName: '非 PNG' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res.code).toBe('qrcode_failed');
    expect(ctx.events).toEqual([]);
    expect(ctx.registryEntry(dto.id).sessionRef).toBeNull();
  });

  it('超过 512 KiB 的 PNG → qrcode_failed', async () => {
    const ctx = makeContext();
    ctx.behavior.login = async (_platform, opts) => {
      const dir = dirname(opts.storageStatePath);
      const big = join(dir, 'qr-big.png');
      // 合法魔数 + 填充至 512 KiB + 1 字节：尺寸上限必须拒绝。
      writeFileSync(big, Buffer.concat([PNG_MAGIC, Buffer.alloc(QR_LIMIT_BYTES + 1 - PNG_MAGIC.length, 0x41)]));
      opts.onQrcode?.(big);
      return { success: true, message: 'unreachable' };
    };
    const dto = await createAccount(ctx, { displayName: '超限二维码' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res.code).toBe('qrcode_failed');
    expect(ctx.events).toEqual([]);
    expect(ctx.registryEntry(dto.id).sessionRef).toBeNull();
  });

  it('第 65 次回调 → 前 64 个事件正常、第 65 次失败：qrcode_failed 且合法输出也不提交', async () => {
    const ctx = makeContext();
    const requestId = randomUUID();
    ctx.behavior.login = async (_platform, opts) => {
      const dir = dirname(opts.storageStatePath);
      writeFileSync(opts.storageStatePath, storageStateFixture('loop'));
      const png = join(dir, 'qr-loop.png');
      writeFileSync(png, pngFixture('loop'));
      for (let i = 0; i < QR_EVENT_LIMIT + 1; i += 1) {
        opts.onQrcode?.(png); // 第 65 次抛出，平台不捕获
      }
      return { success: true, message: 'unreachable' };
    };
    const dto = await createAccount(ctx, { displayName: '事件洪泛' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId,
    });
    expect(res).toEqual({
      ok: false,
      code: 'qrcode_failed',
      message: ACCOUNT_V2_ERROR_MESSAGES.qrcode_failed,
    });
    expect(ctx.events).toHaveLength(QR_EVENT_LIMIT);
    const payloads = ctx.events.map((e) => e.payload as AccountV2QrcodeEvent);
    expect(payloads.map((p) => p.sequence)).toEqual(
      Array.from({ length: QR_EVENT_LIMIT }, (_unused, i) => i + 1),
    );
    expect(payloads.every((p) => p.requestId === requestId && p.accountId === dto.id)).toBe(true);
    expect(payloads[0].imageDataUrl).toBe(dataUrl(pngFixture('loop')));
    // 已写出的合法候选绝不被提交。
    expect(ctx.registryEntry(dto.id).sessionRef).toBeNull();
    expect(ctx.sessionFileNames()).toEqual([]);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
  });

  it('平台吞掉回调异常并报 success:true（新账号）→ 强制 qrcode_failed，不提交会话', async () => {
    const ctx = makeContext();
    const outside = makeOutsideDir();
    const evil = join(outside, 'evil-swallow.png');
    writeFileSync(evil, pngFixture('evil'));
    ctx.behavior.login = async (_platform, opts) => {
      writeFileSync(opts.storageStatePath, storageStateFixture('swallow-1'));
      try {
        opts.onQrcode?.(evil);
      } catch {
        // 平台吞掉回调异常。
      }
      return { success: true, message: `${RAW_PLATFORM_TEXT}-swallowed` };
    };
    const dto = await createAccount(ctx, { displayName: '吞异常账号' });
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'qrcode_failed',
      message: ACCOUNT_V2_ERROR_MESSAGES.qrcode_failed,
    });
    expect(ctx.events).toEqual([]);
    const entry = ctx.registryEntry(dto.id);
    expect(entry.sessionRef).toBeNull();
    expect(entry.status).toBe('unknown');
    expect(ctx.sessionFileNames()).toEqual([]);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expectNoSecrets(JSON.stringify(res), ctx, ['swallowed']);
  });

  it('平台吞掉回调异常并报 success:true（续登）→ qrcode_failed，旧密文逐字节不变', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '吞异常续登' });
    await loginWithFixture(ctx, dto.id, 'swallow-old');
    const entryBefore = ctx.registryEntry(dto.id);
    const bytesBefore = ctx.sessionBytes(entryBefore.sessionRef as string);

    const outside = makeOutsideDir();
    const evil = join(outside, 'evil-swallow-2.png');
    writeFileSync(evil, pngFixture('evil2'));
    ctx.behavior.login = async (_platform, opts) => {
      writeFileSync(opts.storageStatePath, storageStateFixture('swallow-new'));
      try {
        opts.onQrcode?.(evil);
      } catch {
        // 吞掉。
      }
      return { success: true, message: 'swallowed again' };
    };
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(res.code).toBe('qrcode_failed');
    expect(ctx.events).toEqual([]);
    expect(ctx.registryEntry(dto.id)).toEqual(entryBefore);
    expect(ctx.sessionBytes(entryBefore.sessionRef as string).equals(bytesBefore)).toBe(true);
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('swallow-old'));
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expectNoSecrets(JSON.stringify(res), ctx, ['swallowed again']);
  });
});

// ─── check / 探针 ────────────────────────────────────────────────────────────

describe('account-v2 IPC：check 探针', () => {
  it('探针 false 只使目标账号 expired，其他账号不受影响', async () => {
    const ctx = makeContext();
    const dtoA = await createAccount(ctx, { displayName: '探针 A' });
    const dtoB = await createAccount(ctx, { displayName: '探针 B' });
    await loginWithFixture(ctx, dtoA.id, 'probe-A');
    await loginWithFixture(ctx, dtoB.id, 'probe-B');
    ctx.behavior.check = async () => false;

    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: dtoA.id });
    expect(res.ok).toBe(true);
    expect(res.valid).toBe(false);
    expect(res.account.status).toBe('expired');
    expect(res.account.id).toBe(dtoA.id);

    const list = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.list, {});
    const byId = new Map(list.accounts.map((a: AccountV2Dto) => [a.id, a]));
    expect(byId.get(dtoA.id)?.status).toBe('expired');
    expect(byId.get(dtoB.id)?.status).toBe('valid');
    expect(ctx.decryptSession(dtoB.id)).toBe(storageStateFixture('probe-B'));
    expectNoSecrets(JSON.stringify([res, list]), ctx);
  });

  it('探针 true → valid 且 lastCheckedAt 更新', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '探针有效' });
    await loginWithFixture(ctx, dto.id, 'probe-ok');
    ctx.advanceClock(7_000);
    ctx.behavior.check = async () => true;
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: dto.id });
    expect(res).toEqual({
      ok: true,
      valid: true,
      account: res.account,
    });
    expect(res.account.status).toBe('valid');
    expect(res.account.lastCheckedAt).toBe(NOW0 + 7_000);
  });

  it('探针异常（原文携带路径 / Cookie）→ probe_failed，状态与核验时间保持不变', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '探针异常' });
    await loginWithFixture(ctx, dto.id, 'probe-throw');
    const listBefore = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.list, {});
    const dtoBefore = listBefore.accounts.find((a: AccountV2Dto) => a.id === dto.id);

    ctx.behavior.check = async () => {
      throw new Error(`RAW probe failure ${SECRET_COOKIE_VALUE} at /tmp/secret`);
    };
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: dto.id });
    expect(res).toEqual({
      ok: false,
      code: 'probe_failed',
      message: ACCOUNT_V2_ERROR_MESSAGES.probe_failed,
    });
    const listAfter = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.list, {});
    const dtoAfter = listAfter.accounts.find((a: AccountV2Dto) => a.id === dto.id);
    expect(dtoAfter).toEqual(dtoBefore);
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('probe-throw'));
    expectNoSecrets(JSON.stringify([res, listAfter]), ctx, ['RAW probe failure']);
  });

  it('探针结果非布尔 → probe_failed，不更新状态', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '探针非布尔' });
    await loginWithFixture(ctx, dto.id, 'probe-nonbool');
    ctx.behavior.check = async () => 'yes';
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: dto.id });
    expect(res).toEqual({
      ok: false,
      code: 'probe_failed',
      message: ACCOUNT_V2_ERROR_MESSAGES.probe_failed,
    });
    expect(ctx.registryEntry(dto.id).status).toBe('valid');
  });

  it('无加密会话 → session_missing，checkCookie 不被调用，状态保持 unknown', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '无会话探针' });
    let checkReached = false;
    ctx.behavior.check = async () => {
      checkReached = true;
      return true;
    };
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: dto.id });
    expect(res).toEqual({
      ok: false,
      code: 'session_missing',
      message: ACCOUNT_V2_ERROR_MESSAGES.session_missing,
    });
    expect(checkReached).toBe(false);
    expect(ctx.platformSpies['douyin'].checkCalls).toBe(0);
    const entry = ctx.registryEntry(dto.id);
    expect(entry.status).toBe('unknown');
    expect(entry.lastCheckedAt).toBeNull();
  });

  it('探针挂起期间重登轮换 sessionRef：旧探针 false 返回 session_changed，新会话保持 valid 且密文不变', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '探针竞态' });
    await loginWithFixture(ctx, dto.id, 'race-old');
    const refOld = ctx.registryEntry(dto.id).sessionRef as string;
    expect(refOld).toMatch(SESSION_REF_RE);

    // 探针读到旧明文后挂起；挂起期间完成一次成功重登（A1 事务轮换 sessionRef）。
    let releaseProbe!: () => void;
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    let markProbeStarted!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    let probedPlaintext: string | null = null;
    ctx.behavior.check = async (_platform, storageStatePath) => {
      probedPlaintext = readFileSync(storageStatePath, 'utf-8');
      markProbeStarted();
      await probeGate;
      return false;
    };

    const checkPending = ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: dto.id });
    await probeStarted;
    expect(probedPlaintext).toBe(storageStateFixture('race-old'));
    expect(ctx.platformSpies['douyin'].checkCalls).toBe(1);

    await loginWithFixture(ctx, dto.id, 'race-new');
    const entryNew = ctx.registryEntry(dto.id);
    const refNew = entryNew.sessionRef as string;
    const bytesNew = ctx.sessionBytes(refNew);
    expect(refNew).toMatch(SESSION_REF_RE);
    expect(refNew).not.toBe(refOld);
    expect(entryNew.status).toBe('valid');
    expect(ctx.sessionFileNames()).toEqual([`${refNew}.bin`]);

    releaseProbe();
    const res = await checkPending;
    expect(res).toEqual({
      ok: false,
      code: 'session_changed',
      message: ACCOUNT_V2_ERROR_MESSAGES.session_changed,
    });
    // 过期探针结果绝不写入新会话：新 registry 元数据、新密文、解密结果逐字节不变。
    expect(ctx.registryEntry(dto.id)).toEqual(entryNew);
    expect(ctx.sessionBytes(refNew).equals(bytesNew)).toBe(true);
    expect(ctx.decryptSession(dto.id)).toBe(storageStateFixture('race-new'));
    expect(ctx.sessionFileNames()).toEqual([`${refNew}.bin`]);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
    expectNoSecrets(JSON.stringify(res), ctx);
  });
});

// ─── delete 与非法输入（平台调用前拒绝） ─────────────────────────────────────

describe('account-v2 IPC：delete 与输入校验', () => {
  it('delete 畸形 / 未知 accountId → invalid_request / account_not_found（固定消息）', async () => {
    const ctx = makeContext();
    const malformed = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.delete, { accountId: 'nope' });
    expect(malformed).toEqual({
      ok: false,
      code: 'invalid_request',
      message: ACCOUNT_V2_ERROR_MESSAGES.invalid_request,
    });
    const missing = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.delete, {
      accountId: randomUUID(),
    });
    expect(missing).toEqual({
      ok: false,
      code: 'account_not_found',
      message: ACCOUNT_V2_ERROR_MESSAGES.account_not_found,
    });
    const nullPayload = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.delete, null);
    expect(nullPayload.code).toBe('invalid_request');
  });

  it('login 畸形 accountId / requestId / headless → invalid_request，平台工厂与登录零调用', async () => {
    const ctx = makeContext();
    const dto = await createAccount(ctx, { displayName: '输入校验' });
    ctx.factoryCalls.length = 0;

    const badId = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: 'not-a-uuid',
      requestId: randomUUID(),
    });
    expect(badId).toEqual({
      ok: false,
      code: 'invalid_request',
      message: ACCOUNT_V2_ERROR_MESSAGES.invalid_request,
    });
    const badRequestId = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: '42',
    });
    expect(badRequestId.code).toBe('invalid_request');
    const badHeadless = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
      headless: 'false',
    });
    expect(badHeadless.code).toBe('invalid_request');
    const nullPayload = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, null);
    expect(nullPayload.code).toBe('invalid_request');
    const emptyPayload = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {});
    expect(emptyPayload.code).toBe('invalid_request');

    expect(ctx.factoryCalls).toEqual([]);
    expect(ctx.platformSpies['douyin']?.loginCalls ?? 0).toBe(0);
    expect(readdirSync(ctx.tmpBase)).toEqual([]);
  });

  it('login 未知但格式合法的 accountId → account_not_found，平台工厂零调用', async () => {
    const ctx = makeContext();
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: randomUUID(),
      requestId: randomUUID(),
    });
    expect(res).toEqual({
      ok: false,
      code: 'account_not_found',
      message: ACCOUNT_V2_ERROR_MESSAGES.account_not_found,
    });
    expect(ctx.factoryCalls).toEqual([]);
  });

  it('账号平台模块缺失 → unsupported_platform，login / checkCookie 零调用；delete 仍可用', async () => {
    const ctx = makeContext({ missingPlatforms: ['kuaishou'] });
    const dto = await createAccount(ctx, { platform: 'kuaishou', displayName: '缺模块' });
    const login = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: dto.id,
      requestId: randomUUID(),
    });
    expect(login).toEqual({
      ok: false,
      code: 'unsupported_platform',
      message: ACCOUNT_V2_ERROR_MESSAGES.unsupported_platform,
    });
    const check = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: dto.id });
    expect(check.code).toBe('unsupported_platform');
    expect(ctx.factoryCalls).toEqual(['kuaishou', 'kuaishou']);
    expect(ctx.platformSpies['kuaishou']).toBeUndefined();
    const del = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.delete, { accountId: dto.id });
    expect(del).toEqual({ ok: true, accountId: dto.id });
  });

  it('check 畸形 accountId → invalid_request', async () => {
    const ctx = makeContext();
    const res = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: 'x' });
    expect(res.code).toBe('invalid_request');
    const nullPayload = await ctx.invoke(ACCOUNT_V2_IPC_CHANNELS.check, null);
    expect(nullPayload.code).toBe('invalid_request');
    expect(ctx.factoryCalls).toEqual([]);
  });
});

// ─── 全量序列化扫描 ──────────────────────────────────────────────────────────

describe('account-v2 IPC：序列化安全扫描', () => {
  it('所有操作的结果与事件的 JSON 序列化不含 sessionRef / 密文引用 / 临时路径 / 合成 Cookie / 原始失败文本', async () => {
    const ctx = makeContext();
    const results: unknown[] = [];
    const call = async (channel: string, payload?: unknown): Promise<any> => {
      const res = await ctx.invoke(channel, payload);
      results.push(res);
      return res;
    };

    ctx.behavior.login = async (_platform, opts) => {
      const dir = dirname(opts.storageStatePath);
      const png = join(dir, 'qr-sweep.png');
      writeFileSync(png, pngFixture('sweep'));
      opts.onQrcode?.(png);
      writeFileSync(opts.storageStatePath, storageStateFixture('sweep-1'));
      return { success: true, message: RAW_PLATFORM_TEXT };
    };
    const a = await call(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 'douyin',
      displayName: '扫描同名',
    });
    const b = await call(ACCOUNT_V2_IPC_CHANNELS.create, {
      platform: 'tencent',
      displayName: '扫描同名',
    });
    const aId: string = a.account.id;
    const bId: string = b.account.id;

    await call(ACCOUNT_V2_IPC_CHANNELS.login, { accountId: aId, requestId: randomUUID() });

    ctx.behavior.login = async (_platform, opts) => {
      throw new Error(`boom ${RAW_PLATFORM_TEXT} at /tmp/secret state=${opts.storageStatePath}`);
    };
    await call(ACCOUNT_V2_IPC_CHANNELS.login, { accountId: bId, requestId: randomUUID() });

    ctx.behavior.check = async () => true;
    await call(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: aId });
    ctx.behavior.check = async () => {
      throw new Error(`RAW probe text ${SECRET_COOKIE_VALUE} /tmp/secret`);
    };
    await call(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: aId });
    await call(ACCOUNT_V2_IPC_CHANNELS.check, { accountId: bId }); // session_missing

    await call(ACCOUNT_V2_IPC_CHANNELS.list, {});
    await call(ACCOUNT_V2_IPC_CHANNELS.delete, { accountId: bId });
    await call(ACCOUNT_V2_IPC_CHANNELS.login, {
      accountId: 'not-a-uuid',
      requestId: randomUUID(),
    });
    await call(ACCOUNT_V2_IPC_CHANNELS.create, { platform: 'bilibili', displayName: 'x' });

    const serialized = JSON.stringify(results) + JSON.stringify(ctx.events);
    expectNoSecrets(serialized, ctx, [
      'RAW probe text',
      'qr-sweep',
      'user-cancelled',
      'swallowed',
    ]);
    // 事件只允许出现在 qrcode 通道。
    expect(ctx.events.every((e) => e.channel === ACCOUNT_V2_IPC_CHANNELS.qrcode)).toBe(true);
  });
});

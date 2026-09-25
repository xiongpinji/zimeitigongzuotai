import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  AccountVault,
  type AccountVaultDeps,
  type AccountVaultPlatform,
  type SessionCipher,
} from '../../electron/publish/accounts-v2';
import {
  createQueuePlatformExecutor,
  QUEUE_PLATFORM_ADAPTER_ERROR_CODES,
  type QueuePlatformAdapterDeps,
  type QueuePlatformAdapterPlatform,
} from '../../electron/publish/queue-platform-adapter';
import type {
  PublishAttemptInput,
  PublishAttemptOutcome,
  QueuePlatform,
} from '../../electron/publish/durable-queue';
import type { PlatformModule, PublishPlatform, UploadVideoOptions } from '../../electron/publish/types';

// ─── 离线测试支架（不触网、不读真实账号 / 素材；生产模块不依赖本文件） ─────────

const SECRET_COOKIE = 'SECRET-COOKIE-VALUE-DO-NOT-LEAK';
const SECRET_RAW_ERROR = 'RAW-EXCEPTION-TEXT-DO-NOT-LEAK';

const cleanupRoots: string[] = [];

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const target = cleanupRoots.pop();
    if (target) rmSync(target, { recursive: true, force: true });
  }
});

/**
 * 测试专用假加密器：仅做可逆编码，没有任何安全性；严禁进入生产路径。
 * 与 accounts-v2.test.ts 同模式，用于驱动真实 AccountVault 的短时明文路径。
 */
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

function storageState(tag: string): string {
  return JSON.stringify({
    cookies: [{ name: 'sessionid', value: `${SECRET_COOKIE}-${tag}`, domain: '.example.test' }],
    origins: [],
  });
}

interface UploadCall {
  options: UploadVideoOptions;
  storageStateContent: string | null;
}

class FakePlatformModule implements PlatformModule {
  readonly platform: PublishPlatform;
  uploadCalls: UploadCall[] = [];
  cookieChecks: string[] = [];
  cookieResult: boolean | Error = true;
  uploadImpl: ((options: UploadVideoOptions) => Promise<void>) | null = null;
  uploadCompleted = false;

  constructor(platform: PublishPlatform) {
    this.platform = platform;
  }

  async login(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'fake-login-unused' };
  }

  async checkCookie(storageStatePath: string): Promise<boolean> {
    this.cookieChecks.push(storageStatePath);
    if (this.cookieResult instanceof Error) throw this.cookieResult;
    return this.cookieResult;
  }

  async uploadVideo(options: UploadVideoOptions): Promise<void> {
    let storageStateContent: string | null = null;
    try {
      storageStateContent = readFileSync(options.storageStatePath, 'utf-8');
    } catch {
      storageStateContent = null;
    }
    this.uploadCalls.push({
      options: { ...options, tags: [...options.tags] },
      storageStateContent,
    });
    if (this.uploadImpl) await this.uploadImpl(options);
    this.uploadCompleted = true;
  }
}

interface ResolveCall {
  videoRef: string;
  context: { accountId: string; platform: QueuePlatformAdapterPlatform; videoVariantId: string };
  resolved: string;
}

interface World {
  root: string;
  tmpBase: string;
  cipher: FakeCipher;
  vault: AccountVault;
  spy: {
    getAccount: (accountId: string) => ReturnType<AccountVault['getAccount']>;
    withDecryptedStorageState: AccountVault['withDecryptedStorageState'];
  };
  douyin: FakePlatformModule;
  kuaishou: FakePlatformModule;
  /** 上游名 'tencent' 的假模块;注入键是队列契约名 'wechat-channels'。 */
  tencent: FakePlatformModule;
  xiaohongshu: FakePlatformModule;
  executor: ReturnType<typeof createQueuePlatformExecutor>;
  resolveCalls: ResolveCall[];
  resolveVideoRef: QueuePlatformAdapterDeps['resolveVideoRef'];
}

function busyError(): NodeJS.ErrnoException {
  const err = new Error(SECRET_RAW_ERROR) as NodeJS.ErrnoException;
  err.code = 'EBUSY';
  return err;
}

function makeWorld(
  options: {
    removeDirSync?: AccountVaultDeps['removeDirSync'];
    headless?: boolean;
    resolveVideoRef?: QueuePlatformAdapterDeps['resolveVideoRef'];
  } = {},
): World {
  const root = mkdtempSync(join(tmpdir(), 'qpa-vault-'));
  const tmpBase = mkdtempSync(join(tmpdir(), 'qpa-tmp-'));
  cleanupRoots.push(root, tmpBase);
  const cipher = new FakeCipher();
  const vault = new AccountVault(root, cipher, {
    tmpBaseDir: tmpBase,
    ...(options.removeDirSync ? { removeDirSync: options.removeDirSync } : {}),
  });
  const spy = {
    getAccount: vi.fn((accountId: string) => vault.getAccount(accountId)),
    withDecryptedStorageState: vi.fn(
      <T,>(accountId: string, use: (plaintextPath: string) => Promise<T> | T) =>
        vault.withDecryptedStorageState(accountId, use),
    ) as AccountVault['withDecryptedStorageState'],
  };
  const douyin = new FakePlatformModule('douyin');
  const kuaishou = new FakePlatformModule('kuaishou');
  const tencent = new FakePlatformModule('tencent');
  const xiaohongshu = new FakePlatformModule('xiaohongshu');
  const resolveCalls: ResolveCall[] = [];
  const resolveVideoRef: QueuePlatformAdapterDeps['resolveVideoRef'] =
    options.resolveVideoRef ??
    ((videoRef, context) => {
      const resolved = `C:\\resolved\\${videoRef.split('/').pop() ?? 'video.mp4'}`;
      resolveCalls.push({ videoRef, context, resolved });
      return resolved;
    });
  const executor = createQueuePlatformExecutor({
    vault: spy,
    // 注入键一律用队列契约名;视频号模块自报 platform 是上游名 'tencent'。
    platformModules: { douyin, kuaishou, 'wechat-channels': tencent, xiaohongshu },
    resolveVideoRef,
    headless: options.headless,
  });
  return {
    root,
    tmpBase,
    cipher,
    vault,
    spy,
    douyin,
    kuaishou,
    tencent,
    xiaohongshu,
    executor,
    resolveCalls,
    resolveVideoRef,
  };
}

/**
 * 队列契约平台名 → 账号仓 / 平台模块上游名。测试侧**独立声明**期望映射
 * （不 import 适配层的映射表），避免映射断言变成同义反复。
 */
const QUEUE_TO_VAULT_PLATFORM: Record<QueuePlatformAdapterPlatform, AccountVaultPlatform> = {
  douyin: 'douyin',
  kuaishou: 'kuaishou',
  'wechat-channels': 'tencent',
  xiaohongshu: 'xiaohongshu',
};

function moduleFor(world: World, platform: QueuePlatformAdapterPlatform): FakePlatformModule {
  switch (platform) {
    case 'douyin':
      return world.douyin;
    case 'kuaishou':
      return world.kuaishou;
    case 'wechat-channels':
      return world.tencent;
    case 'xiaohongshu':
      return world.xiaohongshu;
  }
}

function addAccount(
  world: World,
  platform: AccountVaultPlatform, // 账号仓用上游名:视频号账号注册为 'tencent'
  tag: string,
  options: { save?: boolean } = {},
) {
  const created = world.vault.createAccount({ platform, displayName: `账号-${tag}` });
  if (options.save !== false) world.vault.saveStorageState(created.id, storageState(tag));
  return world.vault.getAccount(created.id);
}

function attemptInput(
  platform: QueuePlatform,
  accountId: string,
  overrides: Partial<PublishAttemptInput> = {},
): PublishAttemptInput {
  return {
    taskId: `pubjob_${accountId}`,
    accountId,
    platform,
    videoVariantId: 'variant-1',
    idempotencyKey: `publish-v1:${accountId}`,
    videoRef: 'local://renders/variant-1.mp4',
    metadata: {
      title: '测试标题',
      description: '测试描述',
      tags: ['tag-a', 'tag-b'],
      coverRefs: ['local://covers/variant-1.png'],
      scheduleAt: null,
    },
    attempt: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** 所有返回结果必须：错误码属于稳定枚举、不泄露路径 / Cookie / 原始异常文本、不宣称 submitted。 */
function expectSafeOutcome(
  outcome: PublishAttemptOutcome,
  world: Pick<World, 'root' | 'tmpBase'>,
  extraSecrets: string[] = [],
): void {
  if ('errorCode' in outcome && outcome.errorCode !== undefined) {
    expect(outcome.errorCode).toMatch(/^[a-z0-9][a-z0-9_.-]{0,63}$/);
    expect(QUEUE_PLATFORM_ADAPTER_ERROR_CODES as readonly string[]).toContain(outcome.errorCode);
  }
  const serialized = JSON.stringify(outcome);
  for (const secret of [SECRET_COOKIE, SECRET_RAW_ERROR, world.root, world.tmpBase, ...extraSecrets]) {
    expect(serialized).not.toContain(secret);
  }
  expect(outcome.kind).not.toBe('submitted');
  if (outcome.kind === 'unknown') {
    expect((outcome as { confirmedNotSubmitted?: boolean }).confirmedNotSubmitted).not.toBe(true);
  }
}

function sessionsDir(world: World): string {
  return join(world.root, 'sessions');
}

// ─── 工厂注入边界 ────────────────────────────────────────────────────────────

describe('工厂注入边界', () => {
  it('缺少 vault / resolveVideoRef，或平台模块 platform 标记与注入键的映射上游名不一致时拒绝创建', () => {
    const world = makeWorld();
    expect(() =>
      createQueuePlatformExecutor({
        vault: undefined as unknown as QueuePlatformAdapterDeps['vault'],
        platformModules: { douyin: world.douyin },
        resolveVideoRef: world.resolveVideoRef,
      }),
    ).toThrow();
    expect(() =>
      createQueuePlatformExecutor({
        vault: world.spy,
        platformModules: { douyin: world.douyin },
        resolveVideoRef: undefined as unknown as QueuePlatformAdapterDeps['resolveVideoRef'],
      }),
    ).toThrow();
    expect(() =>
      createQueuePlatformExecutor({
        vault: world.spy,
        platformModules: { douyin: new FakePlatformModule('kuaishou') },
        resolveVideoRef: world.resolveVideoRef,
      }),
    ).toThrow();
    // 视频号注入键是契约名 'wechat-channels'，模块必须自报上游名 'tencent'。
    expect(() =>
      createQueuePlatformExecutor({
        vault: world.spy,
        platformModules: { 'wechat-channels': new FakePlatformModule('douyin') },
        resolveVideoRef: world.resolveVideoRef,
      }),
    ).toThrow();
    // 小红书两侧同名：注入错误平台标记的模块同样拒绝。
    expect(() =>
      createQueuePlatformExecutor({
        vault: world.spy,
        platformModules: { xiaohongshu: new FakePlatformModule('tencent') },
        resolveVideoRef: world.resolveVideoRef,
      }),
    ).toThrow();
    // 正确映射（wechat-channels→tencent、xiaohongshu→xiaohongshu）允许创建。
    expect(() =>
      createQueuePlatformExecutor({
        vault: world.spy,
        platformModules: {
          'wechat-channels': new FakePlatformModule('tencent'),
          xiaohongshu: new FakePlatformModule('xiaohongshu'),
        },
        resolveVideoRef: world.resolveVideoRef,
      }),
    ).not.toThrow();
  });
});

// ─── 平台 / 账号预检（不触碰短时会话） ──────────────────────────────────────

describe('平台与账号预检', () => {
  it('只接受四平台契约名：上游 tencent / bilibili 等非契约名在触碰账号仓前被显式拒绝，绝不反向隐式映射', async () => {
    const world = makeWorld();
    for (const platform of ['tencent', 'bilibili'] as const) {
      const outcome = await world.executor(
        attemptInput(platform as unknown as QueuePlatform, 'account-out-of-scope'),
      );
      expect(outcome).toEqual({
        kind: 'needs_user_action',
        errorCode: 'adapter_unsupported_platform',
        confirmedNotSubmitted: true,
      });
      expectSafeOutcome(outcome, world);
    }
    expect(world.spy.getAccount).not.toHaveBeenCalled();
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    for (const mod of [world.douyin, world.kuaishou, world.tencent, world.xiaohongshu]) {
      expect(mod.cookieChecks).toHaveLength(0);
      expect(mod.uploadCalls).toHaveLength(0);
    }
  });

  it('未注入对应平台模块时拒绝，且不触碰账号仓', async () => {
    const world = makeWorld();
    const executor = createQueuePlatformExecutor({
      vault: world.spy,
      platformModules: { douyin: world.douyin },
      resolveVideoRef: world.resolveVideoRef,
    });
    const outcome = await executor(attemptInput('kuaishou', 'account-ks'));
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_platform_module_missing',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.getAccount).not.toHaveBeenCalled();
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
  });

  it('内部 UUID 在账号仓中不存在时给出需人工处理的保守结果', async () => {
    const world = makeWorld();
    const outcome = await world.executor(attemptInput('douyin', 'missing-internal-uuid'));
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_account_not_found',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('账号仓损坏时保守归为需人工处理，不误报账号不存在', async () => {
    const world = makeWorld();
    writeFileSync(join(world.root, 'registry.json'), '{ not json', 'utf-8');
    const outcome = await world.executor(attemptInput('douyin', 'whatever'));
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_account_unreadable',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('账号平台与任务平台不一致时拒绝，不打开会话、不上传', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'kuaishou', 'platform-mix');
    const outcome = await world.executor(attemptInput('douyin', account.id));
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_account_platform_mismatch',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.douyin.uploadCalls).toHaveLength(0);
    expect(world.kuaishou.uploadCalls).toHaveLength(0);
  });

  it('未保存会话（sessionRef 为空）时返回 needs_login 且不上传', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'douyin', 'no-session', { save: false });
    expect(account.sessionRef).toBeNull();
    const outcome = await world.executor(attemptInput('douyin', account.id));
    expect(outcome).toEqual({
      kind: 'needs_login',
      errorCode: 'adapter_session_missing',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('账号状态为 expired 时返回 needs_login 且不打开会话', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'douyin', 'expired-session');
    world.vault.updateStatusFromProbe(account.id, false);
    const outcome = await world.executor(attemptInput('douyin', account.id));
    expect(outcome).toEqual({
      kind: 'needs_login',
      errorCode: 'adapter_session_expired',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('未注入视频号 / 小红书模块时拒绝，且不触碰账号仓', async () => {
    const world = makeWorld();
    const executor = createQueuePlatformExecutor({
      vault: world.spy,
      platformModules: {
        douyin: world.douyin,
        kuaishou: world.kuaishou,
        xiaohongshu: world.xiaohongshu,
      },
      resolveVideoRef: world.resolveVideoRef,
    });
    const outcome = await executor(attemptInput('wechat-channels', 'account-wc'));
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_platform_module_missing',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.getAccount).not.toHaveBeenCalled();
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.tencent.uploadCalls).toHaveLength(0);
    expect(world.xiaohongshu.uploadCalls).toHaveLength(0);
  });

  it('视频号 / 小红书账号平台错配（tencent ↔ xiaohongshu 互串）时拒绝，不打开会话、不上传', async () => {
    const world = makeWorld();
    const wcAccount = addAccount(world, 'tencent', 'wc-mismatch');
    const xhsAccount = addAccount(world, 'xiaohongshu', 'xhs-mismatch');

    // 小红书任务拿到视频号（tencent）账号：必须拒绝，绝不因同属"新平台"而混用。
    const xhsTaskOutcome = await world.executor(attemptInput('xiaohongshu', wcAccount.id));
    expect(xhsTaskOutcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_account_platform_mismatch',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(xhsTaskOutcome, world);

    // 视频号任务拿到小红书账号：同样拒绝。
    const wcTaskOutcome = await world.executor(attemptInput('wechat-channels', xhsAccount.id));
    expect(wcTaskOutcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_account_platform_mismatch',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(wcTaskOutcome, world);

    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.tencent.cookieChecks).toHaveLength(0);
    expect(world.tencent.uploadCalls).toHaveLength(0);
    expect(world.xiaohongshu.cookieChecks).toHaveLength(0);
    expect(world.xiaohongshu.uploadCalls).toHaveLength(0);
  });

  it('视频号账号未保存会话（sessionRef 为空）时返回 needs_login 且不调用 tencent 模块', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'tencent', 'wc-no-session', { save: false });
    expect(account.sessionRef).toBeNull();
    const outcome = await world.executor(attemptInput('wechat-channels', account.id));
    expect(outcome).toEqual({
      kind: 'needs_login',
      errorCode: 'adapter_session_missing',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.tencent.cookieChecks).toHaveLength(0);
    expect(world.tencent.uploadCalls).toHaveLength(0);
  });

  it('小红书账号状态为 expired 时返回 needs_login 且不打开会话', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'xiaohongshu', 'xhs-expired');
    world.vault.updateStatusFromProbe(account.id, false);
    const outcome = await world.executor(attemptInput('xiaohongshu', account.id));
    expect(outcome).toEqual({
      kind: 'needs_login',
      errorCode: 'adapter_session_expired',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.xiaohongshu.cookieChecks).toHaveLength(0);
    expect(world.xiaohongshu.uploadCalls).toHaveLength(0);
  });
});

// ─── 视频引用预检 ────────────────────────────────────────────────────────────

describe('视频引用预检', () => {
  it('解析器抛错（含原始异常文本）时在上传前阻止，且不泄露异常文本', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'douyin', 'video-throw');
    const executor = createQueuePlatformExecutor({
      vault: world.spy,
      platformModules: { douyin: world.douyin, kuaishou: world.kuaishou },
      resolveVideoRef: () => {
        throw new Error(SECRET_RAW_ERROR);
      },
    });
    const outcome = await executor(
      attemptInput('douyin', account.id, { videoRef: 'local://renders/越界/../../secret.mp4' }),
    );
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_video_preflight_failed',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('解析器返回空路径时同样在上传前阻止', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'kuaishou', 'video-empty');
    const executor = createQueuePlatformExecutor({
      vault: world.spy,
      platformModules: { douyin: world.douyin, kuaishou: world.kuaishou },
      resolveVideoRef: () => '   ',
    });
    const outcome = await executor(attemptInput('kuaishou', account.id));
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_video_preflight_failed',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.kuaishou.uploadCalls).toHaveLength(0);
  });

  it('视频号视频引用解析抛错（含敏感异常文本）时在调用 tencent 模块前阻止', async () => {
    const world = makeWorld({
      resolveVideoRef: () => {
        throw new Error(SECRET_RAW_ERROR);
      },
    });
    const account = addAccount(world, 'tencent', 'wc-video-throw');
    const outcome = await world.executor(
      attemptInput('wechat-channels', account.id, { videoRef: 'local://renders/越界/../../secret.mp4' }),
    );
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_video_preflight_failed',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.tencent.cookieChecks).toHaveLength(0);
    expect(world.tencent.uploadCalls).toHaveLength(0);
  });
});

// ─── 短时会话、探针与错误分类 ────────────────────────────────────────────────

describe('短时会话与登录探针', () => {
  it('checkCookie 返回 false 时返回 needs_login，明文在调用后清理且不上传', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'douyin', 'probe-false');
    world.douyin.cookieResult = false;
    const outcome = await world.executor(attemptInput('douyin', account.id));
    expect(outcome).toEqual({
      kind: 'needs_login',
      errorCode: 'adapter_session_probe_failed',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.douyin.cookieChecks).toHaveLength(1);
    expect(world.douyin.cookieChecks[0]?.startsWith(world.tmpBase + sep)).toBe(true);
    expect(existsSync(world.douyin.cookieChecks[0] as string)).toBe(false);
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('登录探针自身抛错时按可重试且已确认未提交处理，异常文本不泄露', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'kuaishou', 'probe-throw');
    world.kuaishou.cookieResult = new Error(SECRET_RAW_ERROR);
    const outcome = await world.executor(attemptInput('kuaishou', account.id));
    expect(outcome).toEqual({
      kind: 'failed',
      errorCode: 'adapter_session_probe_error',
      retryable: true,
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.kuaishou.uploadCalls).toHaveLength(0);
    expect(existsSync(world.kuaishou.cookieChecks[0] as string)).toBe(false);
  });

  it('密文文件丢失时返回 needs_login，不尝试上传', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'douyin', 'cipher-file-gone');
    for (const file of readdirSync(sessionsDir(world))) {
      rmSync(join(sessionsDir(world), file), { force: true });
    }
    const outcome = await world.executor(attemptInput('douyin', account.id));
    expect(outcome).toEqual({
      kind: 'needs_login',
      errorCode: 'adapter_session_unreadable',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.douyin.cookieChecks).toHaveLength(0);
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('加密子系统不可用时需人工处理，不降级明文、不上传', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'douyin', 'cipher-off');
    world.cipher.available = false;
    const outcome = await world.executor(attemptInput('douyin', account.id));
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_vault_cipher_unavailable',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('小红书探针返回 false（扫码会话失效 / 风控需人工）时返回 needs_login，明文清理且不上传', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'xiaohongshu', 'xhs-probe-false');
    world.xiaohongshu.cookieResult = false;
    const outcome = await world.executor(attemptInput('xiaohongshu', account.id));
    expect(outcome).toEqual({
      kind: 'needs_login',
      errorCode: 'adapter_session_probe_failed',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.xiaohongshu.cookieChecks).toHaveLength(1);
    expect(world.xiaohongshu.cookieChecks[0]?.startsWith(world.tmpBase + sep)).toBe(true);
    expect(existsSync(world.xiaohongshu.cookieChecks[0] as string)).toBe(false);
    expect(world.xiaohongshu.uploadCalls).toHaveLength(0);
  });
});

// ─── 上传调用与未知提交语义 ──────────────────────────────────────────────────

describe('上传调用与未知提交语义', () => {
  it('抖音 / 快手上传 void 返回一律 unknown，不宣称 submitted / published', async () => {
    const world = makeWorld();
    const douyinAccount = addAccount(world, 'douyin', 'happy-dy');
    const kuaishouAccount = addAccount(world, 'kuaishou', 'happy-ks');

    const dyOutcome = await world.executor(
      attemptInput('douyin', douyinAccount.id, {
        metadata: {
          title: '抖音标题',
          description: '抖音描述',
          tags: ['d1', 'd2'],
          coverRefs: ['local://covers/dy.png'],
          scheduleAt: 1_800_000_000_000,
        },
      }),
    );
    const ksOutcome = await world.executor(attemptInput('kuaishou', kuaishouAccount.id));

    expect(dyOutcome).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_unverified' });
    expect(ksOutcome).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_unverified' });
    expect('remoteId' in dyOutcome).toBe(false);
    expect('remoteId' in ksOutcome).toBe(false);
    expectSafeOutcome(dyOutcome, world);
    expectSafeOutcome(ksOutcome, world);

    expect(world.douyin.uploadCalls).toHaveLength(1);
    expect(world.kuaishou.uploadCalls).toHaveLength(1);
    expect(world.douyin.cookieChecks).toHaveLength(1);
    expect(world.kuaishou.cookieChecks).toHaveLength(1);

    const dyCall = world.douyin.uploadCalls[0] as UploadCall;
    const ksCall = world.kuaishou.uploadCalls[0] as UploadCall;
    expect(dyCall.options.title).toBe('抖音标题');
    expect(dyCall.options.desc).toBe('抖音描述');
    expect(dyCall.options.tags).toEqual(['d1', 'd2']);
    expect(dyCall.options.scheduleAt).toBe(1_800_000_000_000);
    expect(dyCall.options.headless).toBe(true);
    expect(dyCall.options.filePath).toBe(world.resolveCalls[0]?.resolved);
    expect(dyCall.options.storageStatePath).toBe(world.douyin.cookieChecks[0]);
    expect(ksCall.options.title).toBe('测试标题');
    expect(ksCall.options.desc).toBe('测试描述');
    expect(ksCall.options.tags).toEqual(['tag-a', 'tag-b']);
    expect(ksCall.options.scheduleAt).toBeUndefined();
    expect(ksCall.options.filePath).toBe(world.resolveCalls[1]?.resolved);
    expect(world.resolveCalls[0]?.context).toEqual({
      accountId: douyinAccount.id,
      platform: 'douyin',
      videoVariantId: 'variant-1',
    });
    expect(dyCall.storageStateContent).toContain(`${SECRET_COOKIE}-happy-dy`);
    expect(ksCall.storageStateContent).toContain(`${SECRET_COOKIE}-happy-ks`);
    expect(existsSync(dyCall.options.storageStatePath)).toBe(false);
    expect(existsSync(ksCall.options.storageStatePath)).toBe(false);
  });

  it('视频号 / 小红书上传 void 返回一律 unknown，且分别路由到 tencent / xiaohongshu 模块', async () => {
    const world = makeWorld();
    const wcAccount = addAccount(world, 'tencent', 'wc-happy');
    const xhsAccount = addAccount(world, 'xiaohongshu', 'xhs-happy');

    const wcOutcome = await world.executor(
      attemptInput('wechat-channels', wcAccount.id, {
        metadata: {
          title: '视频号标题',
          description: '视频号描述',
          tags: ['w1', 'w2'],
          coverRefs: ['local://covers/wc.png'],
          scheduleAt: 1_800_000_000_000,
        },
      }),
    );
    const xhsOutcome = await world.executor(attemptInput('xiaohongshu', xhsAccount.id));

    expect(wcOutcome).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_unverified' });
    expect(xhsOutcome).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_unverified' });
    expect('remoteId' in wcOutcome).toBe(false);
    expect('remoteId' in xhsOutcome).toBe(false);
    expectSafeOutcome(wcOutcome, world);
    expectSafeOutcome(xhsOutcome, world);

    // 路由正确性：视频号只进 tencent 模块，小红书只进 xiaohongshu 模块，其余平台零调用。
    expect(world.tencent.cookieChecks).toHaveLength(1);
    expect(world.tencent.uploadCalls).toHaveLength(1);
    expect(world.xiaohongshu.cookieChecks).toHaveLength(1);
    expect(world.xiaohongshu.uploadCalls).toHaveLength(1);
    expect(world.douyin.uploadCalls).toHaveLength(0);
    expect(world.kuaishou.uploadCalls).toHaveLength(0);

    const wcCall = world.tencent.uploadCalls[0] as UploadCall;
    const xhsCall = world.xiaohongshu.uploadCalls[0] as UploadCall;
    expect(wcCall.options.title).toBe('视频号标题');
    expect(wcCall.options.desc).toBe('视频号描述');
    expect(wcCall.options.tags).toEqual(['w1', 'w2']);
    expect(wcCall.options.scheduleAt).toBe(1_800_000_000_000);
    expect(wcCall.options.headless).toBe(true);
    expect(wcCall.options.filePath).toBe(world.resolveCalls[0]?.resolved);
    expect(wcCall.options.storageStatePath).toBe(world.tencent.cookieChecks[0]);
    expect(xhsCall.options.title).toBe('测试标题');
    expect(xhsCall.options.desc).toBe('测试描述');
    expect(xhsCall.options.tags).toEqual(['tag-a', 'tag-b']);
    expect(xhsCall.options.scheduleAt).toBeUndefined();
    expect(xhsCall.options.filePath).toBe(world.resolveCalls[1]?.resolved);
    expect(xhsCall.options.storageStatePath).toBe(world.xiaohongshu.cookieChecks[0]);
    // resolveVideoRef 上下文携带队列契约名（视频号是 'wechat-channels'，不是 'tencent'）。
    expect(world.resolveCalls[0]?.context).toEqual({
      accountId: wcAccount.id,
      platform: 'wechat-channels',
      videoVariantId: 'variant-1',
    });
    expect(world.resolveCalls[1]?.context).toEqual({
      accountId: xhsAccount.id,
      platform: 'xiaohongshu',
      videoVariantId: 'variant-1',
    });
    // 两账号短时明文互不串用，调用后全部清理。
    expect(wcCall.storageStateContent).toContain(`${SECRET_COOKIE}-wc-happy`);
    expect(wcCall.storageStateContent).not.toContain(`${SECRET_COOKIE}-xhs-happy`);
    expect(xhsCall.storageStateContent).toContain(`${SECRET_COOKIE}-xhs-happy`);
    expect(xhsCall.storageStateContent).not.toContain(`${SECRET_COOKIE}-wc-happy`);
    expect(existsSync(wcCall.options.storageStatePath)).toBe(false);
    expect(existsSync(xhsCall.options.storageStatePath)).toBe(false);
    expect(readdirSync(world.tmpBase)).toEqual([]);
  });

  it('headless 由依赖注入透传，默认无头', async () => {
    const world = makeWorld({ headless: false });
    const account = addAccount(world, 'douyin', 'headful');
    await world.executor(attemptInput('douyin', account.id));
    expect(world.douyin.uploadCalls[0]?.options.headless).toBe(false);
  });

  it('调用前信号已取消时确认未提交，不打开会话、不上传', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'douyin', 'abort-before');
    const controller = new AbortController();
    controller.abort();
    const outcome = await world.executor(attemptInput('douyin', account.id, { signal: controller.signal }));
    expect(outcome).toEqual({
      kind: 'failed',
      errorCode: 'adapter_aborted_before_upload',
      retryable: true,
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.spy.getAccount).not.toHaveBeenCalled();
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.resolveCalls).toHaveLength(0);
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('上传调用开始后取消：等待上传结束、返回 unknown，不假定未发布', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'douyin', 'abort-during');
    const controller = new AbortController();
    world.douyin.uploadImpl = async () => {
      controller.abort();
    };
    const outcome = await world.executor(attemptInput('douyin', account.id, { signal: controller.signal }));
    expect(outcome).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_aborted_unconfirmed' });
    expect((outcome as { confirmedNotSubmitted?: boolean }).confirmedNotSubmitted).toBeUndefined();
    expectSafeOutcome(outcome, world);
    expect(world.douyin.uploadCalls).toHaveLength(1);
    expect(world.douyin.uploadCompleted).toBe(true);
  });

  it('视频号上传开始后取消：等待 tencent 模块结束、返回 unknown，不盲重发', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'tencent', 'wc-abort-during');
    const controller = new AbortController();
    world.tencent.uploadImpl = async () => {
      controller.abort();
    };
    const outcome = await world.executor(
      attemptInput('wechat-channels', account.id, { signal: controller.signal }),
    );
    expect(outcome).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_aborted_unconfirmed' });
    expect((outcome as { confirmedNotSubmitted?: boolean }).confirmedNotSubmitted).toBeUndefined();
    expectSafeOutcome(outcome, world);
    expect(world.tencent.uploadCalls).toHaveLength(1);
    expect(world.tencent.uploadCompleted).toBe(true);
  });

  it('上传过程中抛异常：返回 unknown，异常文本不泄露，不能确认未提交', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'kuaishou', 'upload-throw');
    world.kuaishou.uploadImpl = async () => {
      throw new Error(SECRET_RAW_ERROR);
    };
    const outcome = await world.executor(attemptInput('kuaishou', account.id));
    expect(outcome).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_failed_unconfirmed' });
    expect((outcome as { confirmedNotSubmitted?: boolean }).confirmedNotSubmitted).toBeUndefined();
    expectSafeOutcome(outcome, world);
    expect(world.kuaishou.uploadCalls).toHaveLength(1);
    const usedPath = world.kuaishou.uploadCalls[0]?.options.storageStatePath as string;
    expect(existsSync(usedPath)).toBe(false);
  });

  it('小红书上传中抛异常（验证码 / 风控等原始文本）：返回 unknown 且脱敏，明文已清理', async () => {
    const world = makeWorld();
    const account = addAccount(world, 'xiaohongshu', 'xhs-upload-throw');
    world.xiaohongshu.uploadImpl = async () => {
      throw new Error(SECRET_RAW_ERROR);
    };
    const outcome = await world.executor(attemptInput('xiaohongshu', account.id));
    expect(outcome).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_failed_unconfirmed' });
    expect((outcome as { confirmedNotSubmitted?: boolean }).confirmedNotSubmitted).toBeUndefined();
    expectSafeOutcome(outcome, world);
    expect(world.xiaohongshu.uploadCalls).toHaveLength(1);
    const usedPath = world.xiaohongshu.uploadCalls[0]?.options.storageStatePath as string;
    expect(usedPath.startsWith(world.tmpBase + sep)).toBe(true);
    expect(existsSync(usedPath)).toBe(false);
  });

  it('上传完成后短时会话清理失败：返回 unknown，绝不宣称已发布或未提交', async () => {
    const world = makeWorld({
      removeDirSync: () => {
        throw busyError();
      },
    });
    const account = addAccount(world, 'douyin', 'release-fail');
    const outcome = await world.executor(attemptInput('douyin', account.id));
    expect(outcome).toEqual({ kind: 'unknown', errorCode: 'adapter_session_release_failed' });
    expect((outcome as { confirmedNotSubmitted?: boolean }).confirmedNotSubmitted).toBeUndefined();
    expectSafeOutcome(outcome, world);
    expect(world.douyin.uploadCalls).toHaveLength(1);
  });

  it('未开始上传但短时会话清理失败：需人工处理，可确认未提交', async () => {
    const world = makeWorld({
      removeDirSync: () => {
        throw busyError();
      },
    });
    const account = addAccount(world, 'douyin', 'release-fail-pre');
    world.douyin.cookieResult = false;
    const outcome = await world.executor(attemptInput('douyin', account.id));
    expect(outcome).toEqual({
      kind: 'needs_user_action',
      errorCode: 'adapter_session_release_failed',
      confirmedNotSubmitted: true,
    });
    expectSafeOutcome(outcome, world);
    expect(world.douyin.uploadCalls).toHaveLength(0);
  });

  it('同平台两个内部 UUID 的短时明文路径彼此独立，且互不串用会话', async () => {
    const world = makeWorld();
    const accountA = addAccount(world, 'douyin', 'uuid-a');
    const accountB = addAccount(world, 'douyin', 'uuid-b');
    expect(accountA.id).not.toBe(accountB.id);

    const outcomeA = await world.executor(attemptInput('douyin', accountA.id));
    const outcomeB = await world.executor(attemptInput('douyin', accountB.id));
    expect(outcomeA.kind).toBe('unknown');
    expect(outcomeB.kind).toBe('unknown');
    expectSafeOutcome(outcomeA, world);
    expectSafeOutcome(outcomeB, world);

    expect(world.douyin.uploadCalls).toHaveLength(2);
    const callA = world.douyin.uploadCalls[0] as UploadCall;
    const callB = world.douyin.uploadCalls[1] as UploadCall;
    const pathA = callA.options.storageStatePath;
    const pathB = callB.options.storageStatePath;
    expect(pathA).not.toBe(pathB);
    expect(pathA.startsWith(world.tmpBase + sep)).toBe(true);
    expect(pathB.startsWith(world.tmpBase + sep)).toBe(true);
    expect(callA.storageStateContent).toContain(`${SECRET_COOKIE}-uuid-a`);
    expect(callA.storageStateContent).not.toContain(`${SECRET_COOKIE}-uuid-b`);
    expect(callB.storageStateContent).toContain(`${SECRET_COOKIE}-uuid-b`);
    expect(callB.storageStateContent).not.toContain(`${SECRET_COOKIE}-uuid-a`);
    expect(existsSync(pathA)).toBe(false);
    expect(existsSync(pathB)).toBe(false);
    expect(readdirSync(world.tmpBase)).toEqual([]);
    expectSafeOutcome(outcomeA, world, [pathA, pathB]);
    expectSafeOutcome(outcomeB, world, [pathA, pathB]);
  });

  it('快手 / 视频号 / 小红书：同平台两个内部 UUID 的短时明文路径彼此独立且互不串用', async () => {
    for (const platform of ['kuaishou', 'wechat-channels', 'xiaohongshu'] as const) {
      const world = makeWorld();
      const vaultPlatform = QUEUE_TO_VAULT_PLATFORM[platform];
      const accountA = addAccount(world, vaultPlatform, `${platform}-uuid-a`);
      const accountB = addAccount(world, vaultPlatform, `${platform}-uuid-b`);
      expect(accountA.id).not.toBe(accountB.id);
      expect(accountA.platform).toBe(vaultPlatform);

      const outcomeA = await world.executor(attemptInput(platform, accountA.id));
      const outcomeB = await world.executor(attemptInput(platform, accountB.id));
      expect(outcomeA).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_unverified' });
      expect(outcomeB).toEqual({ kind: 'unknown', errorCode: 'adapter_upload_unverified' });

      const mod = moduleFor(world, platform);
      expect(mod.cookieChecks).toHaveLength(2);
      expect(mod.uploadCalls).toHaveLength(2);
      const callA = mod.uploadCalls[0] as UploadCall;
      const callB = mod.uploadCalls[1] as UploadCall;
      const pathA = callA.options.storageStatePath;
      const pathB = callB.options.storageStatePath;
      expect(pathA).not.toBe(pathB);
      expect(pathA.startsWith(world.tmpBase + sep)).toBe(true);
      expect(pathB.startsWith(world.tmpBase + sep)).toBe(true);
      expect(callA.storageStateContent).toContain(`${SECRET_COOKIE}-${platform}-uuid-a`);
      expect(callA.storageStateContent).not.toContain(`${SECRET_COOKIE}-${platform}-uuid-b`);
      expect(callB.storageStateContent).toContain(`${SECRET_COOKIE}-${platform}-uuid-b`);
      expect(callB.storageStateContent).not.toContain(`${SECRET_COOKIE}-${platform}-uuid-a`);
      expect(existsSync(pathA)).toBe(false);
      expect(existsSync(pathB)).toBe(false);
      expect(readdirSync(world.tmpBase)).toEqual([]);
      expectSafeOutcome(outcomeA, world, [pathA, pathB]);
      expectSafeOutcome(outcomeB, world, [pathA, pathB]);
    }
  });
});
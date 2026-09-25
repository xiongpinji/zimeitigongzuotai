import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  AccountVault,
  type AccountVaultDeps,
  type SessionCipher,
} from '../../electron/publish/accounts-v2';
import {
  createQueuePlatformExecutor,
  QUEUE_PLATFORM_ADAPTER_ERROR_CODES,
  type QueuePlatformAdapterDeps,
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
  context: { accountId: string; platform: 'douyin' | 'kuaishou'; videoVariantId: string };
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
    platformModules: { douyin, kuaishou },
    resolveVideoRef,
    headless: options.headless,
  });
  return { root, tmpBase, cipher, vault, spy, douyin, kuaishou, executor, resolveCalls, resolveVideoRef };
}

function addAccount(
  world: World,
  platform: 'douyin' | 'kuaishou',
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
  it('缺少 vault / resolveVideoRef，或平台模块 platform 标记与注入键不一致时拒绝创建', () => {
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
  });
});

// ─── 平台 / 账号预检（不触碰短时会话） ──────────────────────────────────────

describe('平台与账号预检', () => {
  it('只支持抖音 / 快手：视频号 / 小红书任务在触碰账号仓前被拒绝', async () => {
    const world = makeWorld();
    for (const platform of ['tencent', 'xiaohongshu'] as const) {
      const outcome = await world.executor(attemptInput(platform, 'account-out-of-scope'));
      expect(outcome).toEqual({
        kind: 'needs_user_action',
        errorCode: 'adapter_unsupported_platform',
        confirmedNotSubmitted: true,
      });
      expectSafeOutcome(outcome, world);
    }
    expect(world.spy.getAccount).not.toHaveBeenCalled();
    expect(world.spy.withDecryptedStorageState).not.toHaveBeenCalled();
    expect(world.douyin.uploadCalls).toHaveLength(0);
    expect(world.kuaishou.uploadCalls).toHaveLength(0);
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
});
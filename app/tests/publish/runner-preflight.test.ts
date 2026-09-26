/**
 * A2-S4a 合成测试：旧发布 runner 在任何上传前的整单预检。
 *
 * 全部账号 / 平台 / sender 均为合成假件：不触真实账号、Cookie、媒体、平台，不触网。
 * 锁定的契约：
 * - 未知旧账号、新 account-v2 UUID、畸形 / 空 / 重复目标、混合有效+无效目标，
 *   一律整单拒绝：零 uploadVideo、零 getPlatform、零进度事件、函数 reject；
 * - 拒绝错误只携带固定 code + 固定中文文案，绝不拼接目标 ID、账号名、会话路径
 *   或底层原始异常；store.list() 抛错同样归一为固定错误；
 * - 预检按完整旧 ID（platform_accountName）精确匹配，不按前缀 / 姓名 / 平台模糊命中；
 * - 有效旧目标按原顺序、原参数各上传一次；进度、取消、单目标 failed /
 *   login-expired 行为与旧链保持兼容；store.list() 只读取一次（一次性快照）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAccountId } from '../../electron/publish/account-id';
import { LoginExpiredError } from '../../electron/publish/errors';
import {
  PUBLISH_PREFLIGHT_ERROR_CODES,
  PublishPreflightError,
  preflightPublishTargets,
} from '../../electron/publish/preflight';
import { runPublishJob } from '../../electron/publish/runner';
import type {
  PublishAccount,
  PublishJob,
  PublishPlatform,
  PublishTarget,
  UploadVideoOptions,
} from '../../electron/publish/types';

// ─── platforms 模块假件（runner 唯一平台入口；vi.mock 提升注入） ─────────────

const platformStub = vi.hoisted(() => ({
  getCalls: [] as string[],
  modules: new Map<string, { uploadVideo: ReturnType<typeof vi.fn> }>(),
}));

vi.mock('../../electron/publish/platforms', () => ({
  getPlatform: (p: string) => {
    platformStub.getCalls.push(p);
    const mod = platformStub.modules.get(p);
    if (!mod) throw new Error(`平台未实现: ${p}`);
    return mod;
  },
}));

// ─── 合成夹具（不触真实数据） ────────────────────────────────────────────────

const SECRET_ACCOUNT_NAME = '昵称-SECRET-DO-NOT-LEAK';
const SECRET_SESSION_PATH = '/private/publish/SECRET-DO-NOT-LEAK/storageState.json';
const SECRET_RAW_ERROR = 'RAW-PLATFORM-ERROR cookie=SECRET-DO-NOT-LEAK path=/secret/s.json';
/** 新 account-v2 账号 ID 形态：裸 UUID，无下划线，绝不进入旧上传链。 */
const V2_UUID = '7f9c2a1e-5b3d-4e8f-9a0b-1c2d3e4f5a6b';

const SHARED = {
  title: '共享标题',
  desc: '共享描述',
  tags: ['tag-a', 'tag-b'],
  thumbnail: '/covers/main.png',
  covers: { '3:4': '/covers/vertical.png' } as const,
  scheduleAt: 1_800_000_000_000,
};

function makeAccount(
  platform: PublishPlatform,
  accountName: string,
  overrides: Partial<PublishAccount> = {},
): PublishAccount {
  return {
    id: buildAccountId(platform, accountName),
    platform,
    accountName,
    storageStatePath: `/data/publish/accounts/${platform}_${accountName}.json`,
    status: 'valid',
    ...overrides,
  };
}

function makeJob(targets: PublishTarget[], overrides: Partial<PublishJob> = {}): PublishJob {
  return {
    id: 'job-test-1',
    filePath: '/videos/demo.mp4',
    shared: { ...SHARED },
    targets,
    results: {},
    ...overrides,
  };
}

interface SentEvent {
  channel: string;
  payload: {
    jobId: string;
    accountId: string;
    state: string;
    percent?: number;
    message?: string;
  };
}

function makeSender() {
  const sent: SentEvent[] = [];
  const send = vi.fn((channel: string, payload: SentEvent['payload']) => {
    sent.push({ channel, payload });
  });
  return { sent, send, sender: { send } as unknown as Parameters<typeof runPublishJob>[2] };
}

function makeStore(accounts: PublishAccount[]) {
  return { list: vi.fn(() => accounts) };
}

function makeThrowingStore(err: unknown) {
  return {
    list: vi.fn((): PublishAccount[] => {
      throw err;
    }),
  };
}

function registerPlatform(
  platform: PublishPlatform,
  impl?: (opts: UploadVideoOptions) => Promise<void>,
) {
  const uploadVideo = vi.fn(async (opts: UploadVideoOptions) => {
    if (impl) await impl(opts);
  });
  platformStub.modules.set(platform, { uploadVideo });
  return uploadVideo;
}

beforeEach(() => {
  platformStub.getCalls = [];
  platformStub.modules = new Map();
});

/** 断言 runPublishJob 以固定安全预检错误整单拒绝，且零平台解析 / 零上传 / 零进度事件。 */
async function expectRejection(
  job: unknown,
  store: { list: () => PublishAccount[] },
  expectedCode: (typeof PUBLISH_PREFLIGHT_ERROR_CODES)[number],
): Promise<PublishPreflightError> {
  const { sent, send, sender } = makeSender();
  const err = await runPublishJob(
    job as PublishJob,
    store,
    sender,
    () => false,
    true,
  ).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PublishPreflightError);
  const preflightErr = err as PublishPreflightError;
  expect(preflightErr.code).toBe(expectedCode);
  expect(PUBLISH_PREFLIGHT_ERROR_CODES).toContain(expectedCode);
  // 整批校验结束前不得调用 getPlatform / uploadVideo；也不得发虚假 success / 任何进度
  expect(platformStub.getCalls).toHaveLength(0);
  for (const mod of platformStub.modules.values()) {
    expect(mod.uploadVideo).not.toHaveBeenCalled();
  }
  expect(send).not.toHaveBeenCalled();
  expect(sent).toHaveLength(0);
  return preflightErr;
}

/** 固定安全文案：不含任何目标 / 账号 / 路径 / 原始异常片段。 */
function expectSafeMessage(err: PublishPreflightError, banned: string[]): void {
  const serialized = `${err.name}|${err.code}|${err.message}`;
  for (const secret of banned) {
    expect(serialized).not.toContain(secret);
  }
  expect(err.message.length).toBeGreaterThan(0);
}

// ─── 整单拒绝：零上传 ────────────────────────────────────────────────────────

describe('整单预检拒绝（零上传 / 零 getPlatform / 零进度事件）', () => {
  it('未知旧账号（形态合法但快照不存在）→ account_missing，错误不拼接目标 ID', async () => {
    registerPlatform('douyin');
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    const job = makeJob([{ accountId: 'douyin_不存在' }]);
    const err = await expectRejection(job, store, 'publish_preflight_account_missing');
    expectSafeMessage(err, ['douyin_不存在', '存在的号']);
  });

  it('新 account-v2 UUID → 整单拒绝（UUID 无下划线，不是旧 ID 形态）', async () => {
    registerPlatform('douyin');
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    const err = await expectRejection(
      makeJob([{ accountId: V2_UUID }]),
      store,
      'publish_preflight_target_malformed',
    );
    expectSafeMessage(err, [V2_UUID]);
  });

  it('空目标数组 → targets_invalid，零上传', async () => {
    registerPlatform('douyin');
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    await expectRejection(makeJob([]), store, 'publish_preflight_targets_invalid');
  });

  it('job 为 null / 非对象 → job_invalid，零上传', async () => {
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    for (const bad of [null, undefined, 'job', 42]) {
      await expectRejection(bad, store, 'publish_preflight_job_invalid');
    }
  });

  it('job 骨架畸形（id / filePath / shared 缺失或非法）→ job_invalid', async () => {
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    const targets: PublishTarget[] = [{ accountId: 'douyin_存在的号' }];
    await expectRejection(
      { ...makeJob(targets), id: '' },
      store,
      'publish_preflight_job_invalid',
    );
    await expectRejection(
      { ...makeJob(targets), filePath: 123 },
      store,
      'publish_preflight_job_invalid',
    );
    await expectRejection(
      { ...makeJob(targets), shared: null },
      store,
      'publish_preflight_job_invalid',
    );
  });

  it('targets 非数组 → targets_invalid', async () => {
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    for (const bad of ['nope', 42, null, undefined, {}]) {
      await expectRejection(
        { ...makeJob([]), targets: bad },
        store,
        'publish_preflight_targets_invalid',
      );
    }
  });

  it('空 ID / 无下划线 / 非字符串 accountId / 非对象 target → target_malformed', async () => {
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    const badTargets: unknown[] = [
      { accountId: '' },
      { accountId: 'douyin' },            // 无下划线：parseAccountId 不校验，这里必须拒绝
      { accountId: '_存在的号' },          // 平台段为空
      { accountId: 'douyin_' },            // 名称为空
      { accountId: 'weibo_张三' },         // 平台不在旧白名单
      { accountId: 42 },
      { accountId: null },
      {},
      null,
      'douyin_存在的号',
    ];
    for (const target of badTargets) {
      const err = await expectRejection(
        { ...makeJob([]), targets: [target] },
        store,
        'publish_preflight_target_malformed',
      );
      expectSafeMessage(err, ['weibo', '张三', '存在的号']);
    }
  });

  it('重复目标（同 accountId 两次，含不同 overrides）→ duplicate_target，零上传', async () => {
    registerPlatform('douyin');
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    const err = await expectRejection(
      makeJob([
        { accountId: 'douyin_存在的号' },
        { accountId: 'douyin_存在的号', overrides: { title: '另一标题' } },
      ]),
      store,
      'publish_preflight_duplicate_target',
    );
    expectSafeMessage(err, ['存在的号', '另一标题']);
  });

  it('混合有效+无效目标（有效在前 / 在后）→ 整单零上传，有效账号也绝不上传', async () => {
    const douyinUpload = registerPlatform('douyin');
    const tencentUpload = registerPlatform('tencent');
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    const valid: PublishTarget = { accountId: 'douyin_存在的号' };
    const unknown: PublishTarget = { accountId: 'tencent_幽灵号' };

    await expectRejection(makeJob([valid, unknown]), store, 'publish_preflight_account_missing');
    await expectRejection(makeJob([unknown, valid]), store, 'publish_preflight_account_missing');

    expect(douyinUpload).not.toHaveBeenCalled();
    expect(tencentUpload).not.toHaveBeenCalled();
    expect(platformStub.getCalls).toHaveLength(0);
  });

  it('新 UUID 混入有效旧目标 → 整单拒绝，有效账号零上传', async () => {
    const douyinUpload = registerPlatform('douyin');
    const store = makeStore([makeAccount('douyin', '存在的号')]);
    await expectRejection(
      makeJob([{ accountId: 'douyin_存在的号' }, { accountId: V2_UUID }]),
      store,
      'publish_preflight_target_malformed',
    );
    expect(douyinUpload).not.toHaveBeenCalled();
  });

  it('store.list() 抛错（含敏感原文）→ accounts_unavailable，异常文本不泄露', async () => {
    registerPlatform('douyin');
    const store = makeThrowingStore(new Error(SECRET_RAW_ERROR));
    const err = await expectRejection(
      makeJob([{ accountId: 'douyin_存在的号' }]),
      store,
      'publish_preflight_accounts_unavailable',
    );
    expectSafeMessage(err, [SECRET_RAW_ERROR, 'SECRET-DO-NOT-LEAK', '/secret/s.json']);
  });

  it('任务与账号快照的抛错 getter 也只返回固定错误，不泄露原文', async () => {
    const marker = 'SECRET-PREFLIGHT-GETTER-PATH';
    const shared = { ...SHARED };
    Object.defineProperty(shared, 'title', {
      get() {
        throw new Error(marker);
      },
    });
    const jobError = await expectRejection(
      { ...makeJob([{ accountId: 'douyin_存在的号' }]), shared },
      makeStore([makeAccount('douyin', '存在的号')]),
      'publish_preflight_job_invalid',
    );
    expectSafeMessage(jobError, [marker]);

    const account = makeAccount('douyin', '存在的号');
    Object.defineProperty(account, 'id', {
      get() {
        throw new Error(marker);
      },
    });
    const accountError = await expectRejection(
      makeJob([{ accountId: 'douyin_存在的号' }]),
      makeStore([account]),
      'publish_preflight_account_mismatch',
    );
    expectSafeMessage(accountError, [marker]);
  });

  it('目标 ID 访问器在预检中翻转时整单拒绝，不能绑定第二个账号', async () => {
    const firstUpload = registerPlatform('douyin');
    let reads = 0;
    const target = {} as PublishTarget;
    Object.defineProperty(target, 'accountId', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 'douyin_甲' : 'douyin_乙';
      },
    });
    await expectRejection(
      makeJob([target]),
      makeStore([makeAccount('douyin', '甲'), makeAccount('douyin', '乙')]),
      'publish_preflight_target_malformed',
    );
    expect(firstUpload).not.toHaveBeenCalled();
  });

  it('空快照（损坏 registry 被吞为空）不得当作可发布 → account_missing', async () => {
    registerPlatform('douyin');
    const store = makeStore([]);
    await expectRejection(
      makeJob([{ accountId: 'douyin_存在的号' }]),
      store,
      'publish_preflight_account_missing',
    );
    expect(store.list).toHaveBeenCalledTimes(1);
  });

  it('账号记录与 ID 不一致（平台 / 名称对不上、平台不在旧白名单）→ account_mismatch', async () => {
    registerPlatform('douyin');
    const targets: PublishTarget[] = [{ accountId: 'douyin_存在的号' }];
    // id 声称 douyin，记录平台却是 kuaishou
    await expectRejection(
      makeJob(targets),
      makeStore([
        makeAccount('douyin', '存在的号', { platform: 'kuaishou' as PublishPlatform }),
      ]),
      'publish_preflight_account_mismatch',
    );
    // id 声称 douyin_存在的号，记录名称却不同
    await expectRejection(
      makeJob(targets),
      makeStore([makeAccount('douyin', '存在的号', { accountName: '别的名字' })]),
      'publish_preflight_account_mismatch',
    );
    // 记录自洽（weibo_张三）但平台不在旧白名单
    await expectRejection(
      { ...makeJob([]), targets: [{ accountId: 'weibo_张三' }] },
      makeStore([
        {
          id: 'weibo_张三',
          platform: 'weibo' as PublishPlatform,
          accountName: '张三',
          storageStatePath: '/data/publish/accounts/weibo_张三.json',
          status: 'valid' as const,
        },
      ]),
      // 目标平台前缀本身就不合法 → 先在 target 结构层被拒
      'publish_preflight_target_malformed',
    );
  });

  it('快照中未被引用的损坏条目同样整单拒绝（fail-closed）', async () => {
    registerPlatform('douyin');
    const valid = makeAccount('douyin', '存在的号');
    // null 条目 → 快照不可用
    await expectRejection(
      makeJob([{ accountId: 'douyin_存在的号' }]),
      makeStore([valid, null as unknown as PublishAccount]),
      'publish_preflight_accounts_unavailable',
    );
    // 字段损坏但未被目标引用 → 仍拒绝
    await expectRejection(
      makeJob([{ accountId: 'douyin_存在的号' }]),
      makeStore([
        valid,
        {
          id: '123_坏条目',
          platform: 123 as unknown as PublishPlatform,
          accountName: '坏条目',
          storageStatePath: '/data/publish/accounts/123_坏条目.json',
          status: 'valid' as const,
        },
      ]),
      'publish_preflight_account_mismatch',
    );
  });

  it('同 code 的错误文案固定一致，且不含账号名 / 会话路径等敏感片段', async () => {
    // 快照里放一个带敏感昵称与会话路径的真实账号，但目标指向未知账号：
    // 错误文案不得因快照内容 / 目标 ID 而变化，也不得携带任何敏感片段。
    const store = () =>
      makeStore([
        makeAccount('douyin', SECRET_ACCOUNT_NAME, { storageStatePath: SECRET_SESSION_PATH }),
      ]);
    const err1 = await expectRejection(
      makeJob([{ accountId: 'douyin_未知甲' }]),
      store(),
      'publish_preflight_account_missing',
    );
    const err2 = await expectRejection(
      makeJob([{ accountId: 'douyin_未知乙' }]),
      store(),
      'publish_preflight_account_missing',
    );
    expect(err1.message).toBe(err2.message);
    expectSafeMessage(err1, [
      SECRET_ACCOUNT_NAME,
      SECRET_SESSION_PATH,
      'douyin_未知甲',
      SECRET_RAW_ERROR,
    ]);
    expectSafeMessage(err2, [SECRET_ACCOUNT_NAME, SECRET_SESSION_PATH, 'douyin_未知乙']);
  });
});

// ─── 纯预检函数：顺序与精确绑定 ──────────────────────────────────────────────

describe('preflightPublishTargets 纯函数：按目标顺序绑定精确账号快照', () => {
  const douyinAcc = makeAccount('douyin', '甲');
  const kuaishouAcc = makeAccount('kuaishou', '甲'); // 同名不同平台
  const bilibiliAcc = makeAccount('bilibili', '乙');
  const snapshot = [douyinAcc, kuaishouAcc, bilibiliAcc];

  it('有效 job 返回按目标顺序绑定的数组，account 为快照中的同一对象（全 ID 相等）', () => {
    const t1: PublishTarget = { accountId: 'bilibili_乙', bilibili: { tid: 7 } };
    const t2: PublishTarget = { accountId: 'douyin_甲', overrides: { title: 'x' } };
    const t3: PublishTarget = { accountId: 'kuaishou_甲' };
    const bound = preflightPublishTargets(makeJob([t1, t2, t3]), snapshot);
    expect(bound).toHaveLength(3);
    expect(bound[0].target).toBe(t1);
    expect(bound[1].target).toBe(t2);
    expect(bound[2].target).toBe(t3);
    expect(bound[0].account).toBe(bilibiliAcc);
    expect(bound[1].account).toBe(douyinAcc);
    expect(bound[2].account).toBe(kuaishouAcc);
    expect(bound.map((b) => b.account.platform)).toEqual(['bilibili', 'douyin', 'kuaishou']);
  });

  it('前缀 / 首尾空白 / 同名异平台变体不模糊命中 → account_missing', () => {
    for (const accountId of ['douyin', 'douyin_', 'douyin_甲 ', ' douyin_甲', 'douyin_甲乙']) {
      let err: unknown = null;
      try {
        preflightPublishTargets(makeJob([{ accountId } as PublishTarget]), snapshot);
      } catch (e) {
        err = e;
      }
      if (accountId === 'douyin' || accountId === 'douyin_') {
        expect(err).toBeInstanceOf(PublishPreflightError);
        expect((err as PublishPreflightError).code).toBe('publish_preflight_target_malformed');
      } else {
        expect(err).toBeInstanceOf(PublishPreflightError);
        expect((err as PublishPreflightError).code).toBe('publish_preflight_account_missing');
      }
    }
    // 同名异平台：目标 kuaishou_甲 只能绑定 kuaishou 的快照对象
    const bound = preflightPublishTargets(makeJob([{ accountId: 'kuaishou_甲' }]), snapshot);
    expect(bound[0].account).toBe(kuaishouAcc);
    expect(bound[0].account).not.toBe(douyinAcc);
  });

  it('快照非数组 → accounts_unavailable（不把损坏输入当作空列表放行）', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) {
      let err: unknown = null;
      try {
        preflightPublishTargets(makeJob([{ accountId: 'douyin_甲' }]), bad as never);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PublishPreflightError);
      expect((err as PublishPreflightError).code).toBe('publish_preflight_accounts_unavailable');
    }
  });
});

// ─── 有效旧账号兼容路径 ──────────────────────────────────────────────────────

describe('有效旧账号：上传顺序、平台入参、进度与取消契约保持兼容', () => {
  it('两个有效不同旧目标各上传一次，入参与旧契约逐字段一致（含 overrides 优先与 B 站 tid）', async () => {
    const douyinAcc = makeAccount('douyin', '甲');
    const bilibiliAcc = makeAccount('bilibili', '乙', {
      storageStatePath: '/data/publish/accounts/bilibili_乙.json',
    });
    const store = makeStore([douyinAcc, bilibiliAcc]);
    const order: string[] = [];
    const douyinUpload = registerPlatform('douyin', async () => {
      order.push('douyin');
    });
    const bilibiliUpload = registerPlatform('bilibili', async () => {
      order.push('bilibili');
    });
    const { sent, sender } = makeSender();

    const targets: PublishTarget[] = [
      { accountId: 'douyin_甲' },
      {
        accountId: 'bilibili_乙',
        overrides: { title: '覆盖标题', desc: '覆盖描述', tags: ['only-tag'] },
        bilibili: { tid: 123 },
      },
    ];
    await expect(
      runPublishJob(makeJob(targets), store, sender, () => false, true),
    ).resolves.toBeUndefined();

    // 一次性快照：list 只读一次；顺序与目标一致，各恰好一次
    expect(store.list).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['douyin', 'bilibili']);
    expect(douyinUpload).toHaveBeenCalledTimes(1);
    expect(bilibiliUpload).toHaveBeenCalledTimes(1);

    const douyinOpts = douyinUpload.mock.calls[0][0];
    expect(douyinOpts).toEqual(
      expect.objectContaining({
        storageStatePath: douyinAcc.storageStatePath,
        filePath: '/videos/demo.mp4',
        title: '共享标题',
        desc: '共享描述',
        tags: ['tag-a', 'tag-b'],
        thumbnail: '/covers/main.png',
        covers: { '3:4': '/covers/vertical.png' },
        scheduleAt: 1_800_000_000_000,
        headless: true,
        tid: undefined,
      }),
    );
    expect(typeof douyinOpts.onProgress).toBe('function');

    const bilibiliOpts = bilibiliUpload.mock.calls[0][0];
    expect(bilibiliOpts).toEqual(
      expect.objectContaining({
        storageStatePath: bilibiliAcc.storageStatePath,
        title: '覆盖标题',
        desc: '覆盖描述',
        tags: ['only-tag'],
        thumbnail: '/covers/main.png',
        scheduleAt: 1_800_000_000_000,
        headless: true,
        tid: 123,
      }),
    );

    // 进度事件：running(0) → success(100)，channel / jobId / accountId 与旧契约一致
    expect(sent.map((e) => [e.channel, e.payload.accountId, e.payload.state, e.payload.percent])).toEqual([
      ['publish:progress', 'douyin_甲', 'running', 0],
      ['publish:progress', 'douyin_甲', 'success', 100],
      ['publish:progress', 'bilibili_乙', 'running', 0],
      ['publish:progress', 'bilibili_乙', 'success', 100],
    ]);
    for (const e of sent) expect(e.payload.jobId).toBe('job-test-1');
  });

  it('uploadVideo 的 onProgress 回调路由为 running 进度事件（percent / message 透传）', async () => {
    const store = makeStore([makeAccount('douyin', '甲')]);
    registerPlatform('douyin', async (opts) => {
      opts.onProgress?.(42, '上传中 42%');
    });
    const { sent, sender } = makeSender();
    await runPublishJob(
      makeJob([{ accountId: 'douyin_甲' }]),
      store,
      sender,
      () => false,
      false,
    );
    expect(sent.map((e) => [e.payload.state, e.payload.percent, e.payload.message])).toEqual([
      ['running', 0, undefined],
      ['running', 42, '上传中 42%'],
      ['success', 100, undefined],
    ]);
  });

  it('开始前已取消：预检仍执行、零上传、函数正常 resolve（不抛错）', async () => {
    const store = makeStore([makeAccount('douyin', '甲')]);
    const douyinUpload = registerPlatform('douyin');
    const { sent, sender } = makeSender();
    await expect(
      runPublishJob(makeJob([{ accountId: 'douyin_甲' }]), store, sender, () => true, true),
    ).resolves.toBeUndefined();
    expect(store.list).toHaveBeenCalledTimes(1);
    expect(douyinUpload).not.toHaveBeenCalled();
    expect(platformStub.getCalls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('中途取消：已完成目标保留 success，后续目标不再上传', async () => {
    const store = makeStore([makeAccount('douyin', '甲'), makeAccount('kuaishou', '乙')]);
    let cancelAfter = false;
    registerPlatform('douyin', async () => {
      cancelAfter = true;
    });
    const kuaishouUpload = registerPlatform('kuaishou');
    const { sent, sender } = makeSender();
    await runPublishJob(
      makeJob([{ accountId: 'douyin_甲' }, { accountId: 'kuaishou_乙' }]),
      store,
      sender,
      () => cancelAfter,
      true,
    );
    expect(kuaishouUpload).not.toHaveBeenCalled();
    expect(sent.map((e) => [e.payload.accountId, e.payload.state])).toEqual([
      ['douyin_甲', 'running'],
      ['douyin_甲', 'success'],
    ]);
  });

  it('单目标平台普通错误：failed 进度携带平台消息，不中断后续目标，函数 resolve', async () => {
    const store = makeStore([makeAccount('douyin', '甲'), makeAccount('kuaishou', '乙')]);
    registerPlatform('douyin', async () => {
      throw new Error('平台报错文本');
    });
    const kuaishouUpload = registerPlatform('kuaishou');
    const { sent, sender } = makeSender();
    await expect(
      runPublishJob(
        makeJob([{ accountId: 'douyin_甲' }, { accountId: 'kuaishou_乙' }]),
        store,
        sender,
        () => false,
        true,
      ),
    ).resolves.toBeUndefined();
    expect(kuaishouUpload).toHaveBeenCalledTimes(1);
    expect(sent.map((e) => [e.payload.accountId, e.payload.state, e.payload.message])).toEqual([
      ['douyin_甲', 'running', undefined],
      ['douyin_甲', 'failed', '平台报错文本'],
      ['kuaishou_乙', 'running', undefined],
      ['kuaishou_乙', 'success', undefined],
    ]);
  });

  it('LoginExpiredError：login-expired 进度，后续目标继续，函数 resolve', async () => {
    const store = makeStore([makeAccount('douyin', '甲'), makeAccount('kuaishou', '乙')]);
    registerPlatform('douyin', async () => {
      throw new LoginExpiredError('登录态失效');
    });
    const kuaishouUpload = registerPlatform('kuaishou');
    const { sent, sender } = makeSender();
    await expect(
      runPublishJob(
        makeJob([{ accountId: 'douyin_甲' }, { accountId: 'kuaishou_乙' }]),
        store,
        sender,
        () => false,
        true,
      ),
    ).resolves.toBeUndefined();
    expect(kuaishouUpload).toHaveBeenCalledTimes(1);
    expect(sent.map((e) => [e.payload.accountId, e.payload.state, e.payload.message])).toEqual([
      ['douyin_甲', 'running', undefined],
      ['douyin_甲', 'login-expired', '登录态失效'],
      ['kuaishou_乙', 'running', undefined],
      ['kuaishou_乙', 'success', undefined],
    ]);
  });
});

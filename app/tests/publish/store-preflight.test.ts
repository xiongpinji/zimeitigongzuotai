// @vitest-environment jsdom
/**
 * A2-S4a 合成测试：整单发布失败时 Renderer publish store 的兜底行为。
 *
 * 全部数据合成：假 `window.publishAPI`（不触真实 IPC / 主进程 / 平台 / 账号）。
 * 锁定的契约：
 * - `publishAPI.run` 拒绝（同步抛出或异步 reject，例如主进程整单预检失败）时，
 *   本次仍 pending / running 的目标行必须转为明确 failed，携带固定安全文案与
 *   finishedAt；历史读取不再看到永久 pending；
 * - 已是终态的行（success / failed / login-expired）保留，不被覆盖；
 * - 行消息绝不携带原始异常文本、路径或会话信息；
 * - startPublish 不向上抛错（工作台依赖它落入历史），底部任务标记失败，
 *   进度事件订阅在结束后退订；
 * - 正常成功路径行为不变。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLISH_JOB_FAILED_MESSAGE,
  usePublishStore,
  type PublishResult,
} from '../../src/store/publish';
import { useTaskProgressStore } from '../../src/store/task-progress';
import type { PublishProgressPayload, PublishShared, PublishTarget } from '../../src/lib/electron-api';

const SECRET_RAW_ERROR =
  'MAIN-PROCESS-RAW cookie=SECRET-DO-NOT-LEAK path=/secret/storageState.json';

const SHARED: PublishShared = {
  title: '标题',
  desc: '描述',
  tags: ['t1'],
};

const TARGET_A: PublishTarget = { accountId: 'douyin_甲' };
const TARGET_B: PublishTarget = { accountId: 'bilibili_乙' };
const TARGET_C: PublishTarget = { accountId: 'kuaishou_丙' };
const TARGET_D: PublishTarget = { accountId: 'xiaohongshu_丁' };

interface FakeApi {
  run: ReturnType<typeof vi.fn>;
  onProgress: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

let progressCbs: ((payload: PublishProgressPayload) => void)[] = [];
let unsubscribeCalls = 0;
let jobSeq = 0;

function installApi(runImpl: (...args: unknown[]) => unknown): FakeApi {
  const api: FakeApi = {
    run: vi.fn(runImpl),
    onProgress: vi.fn((cb: (payload: PublishProgressPayload) => void) => {
      progressCbs.push(cb);
      return () => {
        unsubscribeCalls += 1;
      };
    }),
    cancel: vi.fn(async () => {}),
  };
  (window as unknown as { publishAPI: unknown }).publishAPI = api;
  return api;
}

/** 以当前 jobId 向已订阅的进度回调发事件（模拟主进程 publish:progress）。 */
function emit(
  jobId: string,
  accountId: string,
  state: string,
  percent?: number,
  message?: string,
): void {
  for (const cb of progressCbs) cb({ jobId, accountId, state, percent, message });
}

function currentJobId(): string {
  return `job-test-${jobSeq}`;
}

function resultsOf(): Record<string, PublishResult> {
  return usePublishStore.getState().results;
}

function taskOf(jobId: string) {
  return useTaskProgressStore.getState().tasks.get(`publish-job-${jobId}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  progressCbs = [];
  unsubscribeCalls = 0;
  jobSeq = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `job-test-${(jobSeq += 1)}`,
  });
  usePublishStore.setState({
    accounts: [],
    job: null,
    results: {},
    settings: { headlessLogin: true },
    lastExportPath: null,
  });
  const { tasks } = useTaskProgressStore.getState();
  tasks.forEach((_, id) => useTaskProgressStore.getState().removeTask(id));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as { publishAPI?: unknown }).publishAPI;
});

describe('publish store：整单失败时 pending 行不得悬挂', () => {
  it('run 异步 reject：全部 pending 目标转为 failed（固定文案 + finishedAt），不向上抛错', async () => {
    installApi(async () => {
      throw new Error(SECRET_RAW_ERROR);
    });

    await expect(
      usePublishStore.getState().startPublish('/videos/demo.mp4', SHARED, [TARGET_A, TARGET_B]),
    ).resolves.toBeUndefined();

    const jobId = currentJobId();
    const results = resultsOf();
    for (const target of [TARGET_A, TARGET_B]) {
      const row = results[target.accountId];
      expect(row.state).toBe('failed');
      expect(row.message).toBe(PUBLISH_JOB_FAILED_MESSAGE);
      expect(typeof row.finishedAt).toBe('number');
      expect(row.finishedAt).toBeGreaterThan(0);
      expect(typeof row.startedAt).toBe('number');
    }
    // 行消息不携带原始异常 / 路径 / 会话信息
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain(SECRET_RAW_ERROR);
    expect(serialized).not.toContain('SECRET-DO-NOT-LEAK');
    expect(serialized).not.toContain('/secret/storageState.json');
    // 底部任务被标记失败；订阅退订；job 清空
    expect(taskOf(jobId)?.status).toBe('error');
    expect(unsubscribeCalls).toBe(1);
    expect(usePublishStore.getState().job).toBeNull();
  });

  it('run 同步抛出：同样整单兜底为 failed，无 pending 悬挂', async () => {
    installApi(() => {
      throw new Error(SECRET_RAW_ERROR);
    });

    await usePublishStore
      .getState()
      .startPublish('/videos/demo.mp4', SHARED, [TARGET_A, TARGET_B, TARGET_C]);

    const results = resultsOf();
    expect(Object.keys(results)).toHaveLength(3);
    for (const row of Object.values(results)) {
      expect(row.state).toBe('failed');
      expect(row.message).toBe(PUBLISH_JOB_FAILED_MESSAGE);
      expect(typeof row.finishedAt).toBe('number');
    }
    // 历史 runPublish 读取结果时应看到失败而非 pending
    expect(Object.values(results).some((r) => r.state === 'pending')).toBe(false);
    expect(unsubscribeCalls).toBe(1);
  });

  it('已终态行保留：success / login-expired 不被覆盖，running / pending → failed', async () => {
    installApi(async () => {
      const jobId = currentJobId();
      emit(jobId, TARGET_A.accountId, 'success', 100);
      emit(jobId, TARGET_B.accountId, 'login-expired', undefined, '登录态失效');
      emit(jobId, TARGET_C.accountId, 'running', 40, '上传中');
      // TARGET_D 保持 pending
      throw new Error(SECRET_RAW_ERROR);
    });

    await usePublishStore
      .getState()
      .startPublish('/videos/demo.mp4', SHARED, [TARGET_A, TARGET_B, TARGET_C, TARGET_D]);

    const results = resultsOf();
    expect(results[TARGET_A.accountId].state).toBe('success');
    expect(results[TARGET_A.accountId].percent).toBe(100);
    expect(results[TARGET_B.accountId].state).toBe('login-expired');
    expect(results[TARGET_B.accountId].message).toBe('登录态失效');
    expect(results[TARGET_C.accountId].state).toBe('failed');
    expect(results[TARGET_C.accountId].message).toBe(PUBLISH_JOB_FAILED_MESSAGE);
    expect(results[TARGET_D.accountId].state).toBe('failed');
    expect(results[TARGET_D.accountId].message).toBe(PUBLISH_JOB_FAILED_MESSAGE);
    expect(JSON.stringify(results)).not.toContain('SECRET-DO-NOT-LEAK');
    expect(unsubscribeCalls).toBe(1);
  });

  it('部分成功后整单失败：已有 failed 行消息保留，pending 行兜底', async () => {
    installApi(async () => {
      const jobId = currentJobId();
      emit(jobId, TARGET_A.accountId, 'failed', undefined, '平台报错文本');
      throw new Error(SECRET_RAW_ERROR);
    });

    await usePublishStore
      .getState()
      .startPublish('/videos/demo.mp4', SHARED, [TARGET_A, TARGET_B]);

    const results = resultsOf();
    // 已有平台级失败消息按原样保留（既有契约），不被固定文案覆盖
    expect(results[TARGET_A.accountId].state).toBe('failed');
    expect(results[TARGET_A.accountId].message).toBe('平台报错文本');
    expect(results[TARGET_B.accountId].state).toBe('failed');
    expect(results[TARGET_B.accountId].message).toBe(PUBLISH_JOB_FAILED_MESSAGE);
  });

  it('固定文案本身不含敏感占位；结果 map 中不出现原始异常字符串', async () => {
    installApi(async () => {
      throw new Error(SECRET_RAW_ERROR);
    });
    await usePublishStore.getState().startPublish('/videos/demo.mp4', SHARED, [TARGET_A]);
    expect(PUBLISH_JOB_FAILED_MESSAGE.length).toBeGreaterThan(0);
    expect(PUBLISH_JOB_FAILED_MESSAGE).not.toContain('SECRET');
    expect(PUBLISH_JOB_FAILED_MESSAGE).not.toContain('/');
    for (const row of Object.values(resultsOf())) {
      expect(row.message).not.toContain(SECRET_RAW_ERROR);
    }
  });
});

describe('publish store：成功路径与订阅生命周期不受影响', () => {
  it('run 正常 resolve：success 行保留、任务 completed、订阅退订、无兜底覆盖', async () => {
    installApi(async () => {
      const jobId = currentJobId();
      emit(jobId, TARGET_A.accountId, 'running', 10, '上传中');
      emit(jobId, TARGET_A.accountId, 'success', 100);
      emit(jobId, TARGET_B.accountId, 'running', 0);
      emit(jobId, TARGET_B.accountId, 'success', 100);
    });

    await usePublishStore
      .getState()
      .startPublish('/videos/demo.mp4', SHARED, [TARGET_A, TARGET_B]);

    const jobId = currentJobId();
    const results = resultsOf();
    expect(results[TARGET_A.accountId].state).toBe('success');
    expect(results[TARGET_B.accountId].state).toBe('success');
    expect(results[TARGET_A.accountId].message).not.toBe(PUBLISH_JOB_FAILED_MESSAGE);
    expect(taskOf(jobId)?.status).toBe('completed');
    expect(unsubscribeCalls).toBe(1);
    expect(usePublishStore.getState().job).toBeNull();
  });

  it('其他 jobId 的进度事件被忽略；本单事件正常入账', async () => {
    installApi(async () => {
      emit('job-other', TARGET_A.accountId, 'failed', undefined, '别单事件');
      emit(currentJobId(), TARGET_A.accountId, 'success', 100);
    });
    await usePublishStore.getState().startPublish('/videos/demo.mp4', SHARED, [TARGET_A]);
    expect(resultsOf()[TARGET_A.accountId].state).toBe('success');
    expect(resultsOf()[TARGET_A.accountId].message).not.toBe('别单事件');
  });
});

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordingV1 } from '../../src/types/production-contracts';
import type { HotClipHighlightCandidate } from '../../electron/highlights/hotclip-sidecar';
import { HighlightBatchQueue } from '../../electron/highlights/highlight-batch-queue';
import { HighlightBatchScheduler } from '../../electron/highlights/highlight-batch-scheduler';
import {
  HighlightArtifactStore,
  HighlightArtifactStoreError,
  createDurableHotClipRunner,
  recoverHighlightBatch,
} from '../../electron/highlights/highlight-batch-artifacts';
import { createAuthorizedLocalHotClipRunner } from '../../electron/highlights/local-source-observer';

const HASH = 'a'.repeat(64);
const MARKER = 'RAW-VISUAL-PAYLOAD-DO-NOT-STORE';
const roots: string[] = [];
const queues: HighlightBatchQueue[] = [];
const stores: HighlightArtifactStore[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lingji-h1s2c-'));
  roots.push(root);
  const queuePath = join(root, 'queue.json');
  const artifactRoot = join(root, 'artifacts');
  const queue = new HighlightBatchQueue({ storePath: queuePath, now: () => 1_000 });
  const artifacts = new HighlightArtifactStore({ rootDir: artifactRoot });
  queues.push(queue);
  stores.push(artifacts);
  return { root, queuePath, artifactRoot, queue, artifacts };
}

function reopenQueue(path: string) {
  const queue = new HighlightBatchQueue({ storePath: path, now: () => 1_000 });
  queues.push(queue);
  return queue;
}

function reopenArtifacts(path: string) {
  const store = new HighlightArtifactStore({ rootDir: path });
  stores.push(store);
  return store;
}

function input(id = 'rec-1') {
  const recording: RecordingV1 = {
    id, sourceRef: `media://${id}`, sourceSha256: HASH,
    capturedAt: null, durationMs: 120_000, mimeType: 'video/mp4',
    transcriptRef: null, importedAt: '2026-09-26T00:00:00Z',
  };
  return { recording, observedSourceSha256: HASH, options: { maxClips: 4 } };
}

function candidate(id = 'upstream-private-id', startMs = 12_000): HotClipHighlightCandidate {
  return {
    id, startSec: startMs / 1_000, endSec: (startMs + 8_000) / 1_000,
    startMs, endMs: startMs + 8_000,
    title: '合成高光', hook: '合成片段', score: 0.8,
    reason: '合成理由', recommended: true, reviewNote: null,
    visualEvidence: { secret: MARKER },
  };
}

function expectCode(fn: () => unknown, code: string) {
  let error: unknown;
  try { fn(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(HighlightArtifactStoreError);
  expect((error as HighlightArtifactStoreError).code).toBe(code);
  expect(String((error as Error).message)).not.toContain(MARKER);
}

afterEach(() => {
  for (const queue of queues.splice(0)) queue.close();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) {
    const checked = resolve(root);
    if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-h1s2c-')) {
      throw new Error('unsafe artifact test cleanup path');
    }
    rmSync(checked, { recursive: true, force: true });
  }
});

describe('HighlightArtifactStore / recovery（仅合成候选）', () => {
  it('原子落地候选契约并重开重投影；上游 ID 和视觉载荷不落盘', () => {
    const { queue, artifacts, artifactRoot } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const running = queue.claim(task.id, 3);
    const committed = artifacts.commit(running, [candidate()], '2026-09-26T00:00:00Z');
    expect(committed.candidateIds).toEqual([expect.stringMatching(/^hcand_[a-f0-9]{64}$/)]);
    expect(committed.highlightIds).toEqual([expect.stringMatching(/^hlcv1-[a-f0-9]{64}$/)]);
    expect(committed.highlights[0]).toMatchObject({
      recordingId: 'rec-1', startMs: 12_000, endMs: 20_000,
      boundaryOrigin: 'auto', adjustedAt: null,
    });
    expect(committed.reviewRequired).toBe(true);
    const bytes = readFileSync(join(artifactRoot, `${task.id}.json`), 'utf8');
    expect(bytes).not.toContain('upstream-private-id');
    expect(bytes).not.toContain(MARKER);
    artifacts.close();
    const reopened = reopenArtifacts(artifactRoot);
    expect(reopened.read(running)).toEqual(committed);
  });

  it('相同尝试重复提交幂等，冲突提交与损坏文件拒绝且不覆盖', () => {
    const { queue, artifacts, artifactRoot } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const running = queue.claim(task.id, 3);
    const first = artifacts.commit(running, [candidate()], '2026-09-26T00:00:00Z');
    const path = join(artifactRoot, `${task.id}.json`);
    const bytes = readFileSync(path, 'utf8');
    expect(artifacts.commit(running, [candidate()], '2026-09-26T00:00:00Z')).toEqual(first);
    expectCode(() => artifacts.commit(running, [candidate('changed-id')], '2026-09-26T00:00:00Z'), 'artifact_conflict');
    expect(readFileSync(path, 'utf8')).toBe(bytes);
    writeFileSync(path, '{corrupt}', 'utf8');
    expectCode(() => artifacts.read(running), 'artifact_corrupt');
  });

  it('结构仍合法的候选正文被外部改写后，读回不能静默接受', () => {
    const { queue, artifacts, artifactRoot } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const running = queue.claim(task.id, 3);
    artifacts.commit(running, [candidate()], '2026-09-26T00:00:00Z');
    const path = join(artifactRoot, `${task.id}.json`);
    const altered = JSON.parse(readFileSync(path, 'utf8'));
    altered.candidates[0].title = '外部替换的正文';
    writeFileSync(path, JSON.stringify(altered), 'utf8');
    expectCode(() => artifacts.read(running), 'artifact_corrupt');
  });

  it('产物根目录被替换为普通文件后，读取拒绝且不跟随错误路径', () => {
    const { queue, artifacts, artifactRoot } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    writeFileSync(artifactRoot, 'not-a-directory', 'utf8');
    expectCode(() => artifacts.read(task), 'invalid_root');
  });

  it('四个持久点：排队不自启、未提交中断、产物已提交补任务、回执丢失不重复', () => {
    const { queue, artifacts, queuePath, artifactRoot } = fixture();
    const [queued, withoutArtifact, withArtifact, committed] = queue.enqueueBatch([
      input('queued'), input('without-artifact'), input('with-artifact'), input('committed'),
    ]);
    const runningNoArtifact = queue.claim(withoutArtifact.id, 3);
    const runningWithArtifact = queue.claim(withArtifact.id, 3);
    const runningCommitted = queue.claim(committed.id, 3);
    const recoveredReceipt = artifacts.commit(runningWithArtifact, [candidate('candidate-c')], '2026-09-26T00:00:00Z');
    const completeReceipt = artifacts.commit(runningCommitted, [candidate('candidate-d')], '2026-09-26T00:00:00Z');
    writeFileSync(join(artifactRoot, `${withoutArtifact.id}.crash.tmp`), '{partial write}', 'utf8');
    queue.complete(committed.id, runningCommitted.attempt, {
      candidateIds: completeReceipt.candidateIds, highlightIds: completeReceipt.highlightIds,
    });
    queue.close();
    artifacts.close();

    const reopenedQueue = reopenQueue(queuePath);
    const reopenedArtifacts = reopenArtifacts(artifactRoot);
    const first = recoverHighlightBatch(reopenedQueue, reopenedArtifacts);
    expect(first).toMatchObject({ queued: 1, interrupted: 1, completedFromArtifact: 1, confirmedCompleted: 1 });
    expect(reopenedQueue.get(queued.id)?.state).toBe('queued');
    expect(reopenedQueue.get(withoutArtifact.id)).toMatchObject({ state: 'interrupted', attempt: runningNoArtifact.attempt });
    expect(reopenedQueue.get(withArtifact.id)).toMatchObject({
      state: 'completed', candidateIds: recoveredReceipt.candidateIds, highlightIds: recoveredReceipt.highlightIds,
    });
    expect(reopenedQueue.get(committed.id)).toMatchObject({
      state: 'completed', candidateIds: completeReceipt.candidateIds, highlightIds: completeReceipt.highlightIds,
    });
    const second = recoverHighlightBatch(reopenedQueue, reopenedArtifacts);
    expect(second).toMatchObject({ queued: 1, interrupted: 0, completedFromArtifact: 0, confirmedCompleted: 2 });
  });

  it('已完成任务缺少对应产物必须拒绝验收，不假报高光可用', () => {
    const { queue, artifacts } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const running = queue.claim(task.id, 3);
    queue.complete(task.id, running.attempt, { candidateIds: [], highlightIds: [] });
    expectCode(() => recoverHighlightBatch(queue, artifacts), 'artifact_missing');
    expect(queue.get(task.id)?.state).toBe('completed');
  });

  it('取消后留下的已提交产物不复活任务，列为孤儿待人工处理', () => {
    const { queue, artifacts } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const running = queue.claim(task.id, 3);
    artifacts.commit(running, [candidate()], '2026-09-26T00:00:00Z');
    queue.cancel(task.id);
    const summary = recoverHighlightBatch(queue, artifacts);
    expect(summary.orphanedArtifacts).toBe(1);
    expect(queue.get(task.id)?.state).toBe('cancelled');
  });

  it('合成 sidecar → 产物仓 → 调度队列端到端提交候选，无原始视觉载荷落盘', async () => {
    const { root, queue, artifacts, artifactRoot } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const script = join(root, 'fake-hotclip.cjs');
    writeFileSync(script, `process.stdout.write(${JSON.stringify(JSON.stringify([candidate()]))});`, 'utf8');
    const runner = createDurableHotClipRunner({
      artifacts,
      createdAt: () => '2026-09-26T00:00:00Z',
      resolveRunOptions: () => ({
        executable: process.execPath, argsPrefix: [script], cwd: root,
        videoPath: join(root, 'synthetic.mp4'), timeoutMs: 5_000,
      }),
      observeSourceSha256: async () => HASH,
    });
    const scheduler = new HighlightBatchScheduler({ queue, concurrency: 1, maxAttempts: 2, runner });
    await scheduler.runQueued();
    const saved = queue.get(task.id)!;
    const bundle = artifacts.read(saved)!;
    expect(saved.state).toBe('completed');
    expect(saved.candidateIds).toEqual(bundle.candidateIds);
    expect(saved.highlightIds).toEqual(bundle.highlightIds);
    expect(bundle.highlights[0]).toMatchObject({ startMs: 12_000, endMs: 20_000 });
    const bytes = readFileSync(join(artifactRoot, `${task.id}.json`), 'utf8');
    expect(bytes).not.toContain(MARKER);
    expect(bytes).not.toContain('upstream-private-id');
  });

  it('执行前源摘要失配直接拒绝，不启动 sidecar 或生成产物', async () => {
    const { root, queue, artifacts } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const marker = join(root, 'sidecar-started');
    const script = join(root, 'fake-hotclip.cjs');
    writeFileSync(script,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); process.stdout.write('[]');`,
      'utf8');
    const runner = createDurableHotClipRunner({
      artifacts, createdAt: () => '2026-09-26T00:00:00Z',
      resolveRunOptions: () => ({
        executable: process.execPath, argsPrefix: [script], cwd: root,
        videoPath: join(root, 'synthetic.mp4'), timeoutMs: 5_000,
      }),
      observeSourceSha256: async () => 'b'.repeat(64),
    });
    await new HighlightBatchScheduler({ queue, concurrency: 1, maxAttempts: 2, runner }).runQueued();
    expect(queue.get(task.id)).toMatchObject({ state: 'failed', lastErrorCode: 'source_hash_mismatch' });
    expect(existsSync(marker)).toBe(false);
    expect(artifacts.read(queue.get(task.id)!)).toBeNull();
  });

  it('真实本地字节观察器接入 sidecar；源文件改写后不再次启动子进程', async () => {
    const { root, queue, artifacts } = fixture();
    const mediaRootDir = join(root, 'media');
    mkdirSync(mediaRootDir);
    const videoPath = join(mediaRootDir, 'synthetic.mp4');
    const original = Buffer.from('synthetic-live-recording');
    writeFileSync(videoPath, original);
    const observedHash = createHash('sha256').update(original).digest('hex');
    const recordingInput = (id: string) => {
      const value = input(id);
      value.recording.sourceSha256 = observedHash;
      value.observedSourceSha256 = observedHash;
      return value;
    };
    const script = join(root, 'fake-hotclip.cjs');
    const marker = join(root, 'started.txt');
    writeFileSync(script,
      `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'started\\n'); process.stdout.write(${JSON.stringify(JSON.stringify([candidate()]))});`,
      'utf8');
    const runner = createAuthorizedLocalHotClipRunner({
      artifacts, mediaRootDir,
      createdAt: () => '2026-09-26T00:00:00Z',
      resolveRunOptions: () => ({
        executable: process.execPath, argsPrefix: [script], cwd: root,
        videoPath, timeoutMs: 5_000,
      }),
    });
    const scheduler = new HighlightBatchScheduler({ queue, concurrency: 1, maxAttempts: 2, runner });
    const [first] = queue.enqueueBatch([recordingInput('actual-bytes-1')]);
    await scheduler.runQueued();
    expect(queue.get(first.id)?.state).toBe('completed');
    expect(readFileSync(marker, 'utf8')).toBe('started\n');
    const [second] = queue.enqueueBatch([recordingInput('actual-bytes-2')]);
    writeFileSync(videoPath, 'different-recording');
    await scheduler.runQueued();
    expect(queue.get(second.id)).toMatchObject({ state: 'failed', lastErrorCode: 'source_hash_mismatch' });
    expect(readFileSync(marker, 'utf8')).toBe('started\n');
  });

  it('源摘要观察失败只落固定错误码，不泄露观察器原始异常', async () => {
    const { root, queue, artifacts, queuePath } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const runner = createDurableHotClipRunner({
      artifacts, createdAt: () => '2026-09-26T00:00:00Z',
      resolveRunOptions: () => ({
        executable: process.execPath, argsPrefix: [], cwd: root,
        videoPath: join(root, 'synthetic.mp4'), timeoutMs: 5_000,
      }),
      observeSourceSha256: async () => { throw new Error('PRIVATE-SOURCE-PATH'); },
    });
    await new HighlightBatchScheduler({ queue, concurrency: 1, maxAttempts: 2, runner }).runQueued();
    expect(queue.get(task.id)).toMatchObject({ state: 'failed', lastErrorCode: 'source_unavailable' });
    expect(readFileSync(queuePath, 'utf8')).not.toContain('PRIVATE-SOURCE-PATH');
    queue.close();
    const reopened = reopenQueue(queuePath);
    expect(reopened.get(task.id)?.lastErrorCode).toBe('source_unavailable');
  });

  it('预检发现后续产物损坏时，不先修改前面 running 任务', () => {
    const { queue, artifacts, artifactRoot } = fixture();
    const [first, second] = queue.enqueueBatch([input('first'), input('second')]);
    queue.claim(first.id, 3);
    const runningSecond = queue.claim(second.id, 3);
    artifacts.commit(runningSecond, [candidate()], '2026-09-26T00:00:00Z');
    writeFileSync(join(artifactRoot, `${second.id}.json`), '{corrupt}', 'utf8');
    expectCode(() => recoverHighlightBatch(queue, artifacts), 'artifact_corrupt');
    expect(queue.get(first.id)?.state).toBe('running');
    expect(queue.get(second.id)?.state).toBe('running');
  });

  it('队列完成 ID 与产物不一致时拒绝验收', () => {
    const { queue, artifacts } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const running = queue.claim(task.id, 3);
    artifacts.commit(running, [candidate()], '2026-09-26T00:00:00Z');
    queue.complete(task.id, running.attempt, {
      candidateIds: ['forged_candidate'], highlightIds: [`hlcv1-${HASH}`],
    });
    expectCode(() => recoverHighlightBatch(queue, artifacts), 'artifact_mismatch');
  });

  it('旧尝试产物不能被新尝试的恢复器当成成功结果', () => {
    const { queue, artifacts } = fixture();
    const [task] = queue.enqueueBatch([input()]);
    const first = queue.claim(task.id, 3);
    artifacts.commit(first, [candidate()], '2026-09-26T00:00:00Z');
    queue.interrupt(task.id, first.attempt);
    queue.retry(task.id, 3);
    const second = queue.claim(task.id, 3);
    expectCode(() => recoverHighlightBatch(queue, artifacts), 'artifact_conflict');
    expect(queue.get(task.id)).toMatchObject({ state: 'running', attempt: second.attempt });
  });
});

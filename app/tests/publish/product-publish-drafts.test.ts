import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDurableQueue } from '../../electron/publish/durable-queue';
import { createProductPublishDraftService } from '../../electron/publish/product-publish-drafts';

let root: string;
let projectDir: string;

const metadata = { title: '已复核视频', description: '内容说明', tags: ['直播切片'],
  coverRefs: [], scheduleAt: null };
const account = (id: string, platform: 'douyin' | 'kuaishou' | 'tencent' | 'xiaohongshu'):
  { id: string; platform: typeof platform; status: 'valid' | 'expired' | 'unknown'; sessionRef: string | null } =>
  ({ id, platform, status: 'valid', sessionRef: `session-${id}` });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'product-publish-drafts-'));
  projectDir = join(root, 'project');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixture() {
  const accounts = new Map([
    ['douyin-a', account('douyin-a', 'douyin')],
    ['douyin-b', account('douyin-b', 'douyin')],
    ['wechat-c', account('wechat-c', 'tencent')],
  ]);
  const queue = openDurableQueue({ storePath: join(root, 'queue.json'),
    executor: async () => ({ kind: 'unknown' }),
    reconciler: async () => ({ finalState: 'unknown' }) });
  const review = vi.fn(async (_project: string, batchId: string, planId: string) => ({
    batchId, planId, outputPath: join(projectDir, 'compositions', batchId, planId, 'render.mp4'),
    outputSha256: 'a'.repeat(64), evidenceSha256: 'b'.repeat(64),
    platform: planId === 'wechat' ? 'wechat-channels' : 'douyin', region: 'cn',
    commercialShortVideo: true, platformOriginality: 'unverified' as const,
  }));
  const service = createProductPublishDraftService({
    activeProjectDir: () => projectDir,
    accounts: { getAccount: (id: string) => {
      const found = accounts.get(id);
      if (!found) throw new Error('not found');
      return found;
    } },
    review: { readPassingReviewEvidence: review }, queue,
  });
  return { service, queue, review, accounts };
}

const assignment = (accountId: string, planId: string) => ({
  accountId, batchId: 'batch-1', planId, metadata, commerceRequest: null,
});

describe('安全账号 × 已复核版本的产品草稿', () => {
  it('只列出当前工程的安全草稿投影，取消后不会再被列出', async () => {
    const { service, queue } = fixture();
    await service.stage([assignment('douyin-a', 'plan-a')]);
    const task = queue.list()[0]!;
    expect(await service.listDrafts()).toEqual([{ taskId: task.id, accountId: 'douyin-a',
      platform: 'douyin', batchId: 'batch-1', planId: 'plan-a',
      title: metadata.title, createdAt: task.createdAt }]);
    expect(JSON.stringify(await service.listDrafts())).not.toContain('videoRef');
    expect(JSON.stringify(await service.listDrafts())).not.toContain(projectDir);
    const firstProject = projectDir;
    projectDir = join(root, 'other-project');
    expect(await service.listDrafts()).toEqual([]);
    await expect(service.cancelDraft({ taskId: task.id })).rejects.toMatchObject({ code: 'draft_not_found' });
    projectDir = firstProject;
    expect(await service.cancelDraft({ taskId: task.id })).toBe(true);
    expect(queue.get(task.id)?.state).toBe('cancelled');
    expect(await service.listDrafts()).toEqual([]);
    await expect(service.cancelDraft({ taskId: task.id })).rejects.toMatchObject({ code: 'draft_not_cancellable' });
  });

  it('同平台多账号可选不同版本，草稿持久化且不会调度', async () => {
    const { service, queue } = fixture();
    const input = [assignment('douyin-a', 'plan-a'), assignment('douyin-b', 'plan-b'),
      assignment('wechat-c', 'wechat')];
    const preview = await service.preview(input);
    expect(preview.entries.map((item) => [item.accountId, item.platform, item.planId])).toEqual([
      ['douyin-a', 'douyin', 'plan-a'], ['douyin-b', 'douyin', 'plan-b'],
      ['wechat-c', 'wechat-channels', 'wechat'],
    ]);
    expect(preview.duplicateVersionRisks).toEqual([]);
    const staged = await service.stage(input);
    expect(staged.created).toBe(3);
    expect(queue.list().map((task) => task.state)).toEqual(['draft', 'draft', 'draft']);
    expect((await queue.tick()).claimed).toEqual([]);
    expect((await service.stage(input)).existing).toBe(3);
  });

  it('同版本投向多个账号必须提示重复风险；引用解析重新查证据和账号', async () => {
    const { service, queue, review, accounts } = fixture();
    const input = [assignment('douyin-a', 'plan-a'), assignment('douyin-b', 'plan-a')];
    const preview = await service.preview(input);
    expect(preview.duplicateVersionRisks).toEqual([{ batchId: 'batch-1', planId: 'plan-a',
      accountIds: ['douyin-a', 'douyin-b'] }]);
    await service.stage(input);
    const task = queue.list()[0]!;
    const path = await service.resolveVideoRef(task.videoRef, { accountId: task.accountId,
      platform: task.platform, videoVariantId: task.videoVariantId });
    expect(path).toContain('render.mp4');
    expect(review).toHaveBeenCalledTimes(5);
    accounts.set(task.accountId, { ...accounts.get(task.accountId)!, status: 'expired' });
    await expect(service.resolveVideoRef(task.videoRef, { accountId: task.accountId,
      platform: task.platform, videoVariantId: task.videoVariantId }))
      .rejects.toMatchObject({ code: 'account_not_ready' });
    accounts.set(task.accountId, account(task.accountId, 'douyin'));
    review.mockRejectedValueOnce(new Error('rights revoked'));
    await expect(service.resolveVideoRef(task.videoRef, { accountId: task.accountId,
      platform: task.platform, videoVariantId: task.videoVariantId }))
      .rejects.toMatchObject({ code: 'review_not_ready' });
  });

  it('一个账号或版本预检失败时整批不写入；页面不得自报文件路径', async () => {
    const { service, queue, accounts } = fixture();
    const valid = assignment('douyin-a', 'plan-a');
    await expect(service.stage([valid, assignment('wechat-c', 'plan-a')]))
      .rejects.toMatchObject({ code: 'platform_mismatch' });
    expect(queue.list()).toEqual([]);
    accounts.set('douyin-b', { ...account('douyin-b', 'douyin'), status: 'expired' });
    await expect(service.stage([valid, assignment('douyin-b', 'plan-b')]))
      .rejects.toMatchObject({ code: 'account_not_ready' });
    expect(queue.list()).toEqual([]);
    await expect(service.preview([{ ...valid, filePath: 'C:\\arbitrary.mp4' }]))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.stage([valid, valid])).rejects.toMatchObject({ code: 'invalid_input' });
    expect(queue.list()).toEqual([]);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createMonitorService } from '@/monitor/monitor-service';
import { createMemoryRepository } from '@/background/repository';
import type { Creator, Video } from '@/domain/models';

const creator: Creator = {
  id: 'c1',
  secUid: 'MS4w',
  nickname: '博主',
  profileUrl: 'https://www.douyin.com/user/MS4w',
  updatedAt: 0,
};
const v = (id: string): Video => ({
  id,
  creatorId: 'c1',
  description: id,
  publishedAt: Number(id),
  sourcePageUrl: `https://www.douyin.com/video/${id}`,
});

function setup(over: Record<string, unknown> = {}) {
  let seq = 0;
  const repo = createMemoryRepository({ now: () => 1000, newId: () => `id-${++seq}` });
  const notify = vi.fn(async () => {});
  const deps = {
    repo,
    notify,
    now: () => 1000,
    fetchCreatorVideos: vi.fn(async () => ({ videos: [v('3'), v('2'), v('1')] })),
    ...over,
  };
  return { repo, notify, deps };
}

describe('createMonitorService.runOnce', () => {
  it('notifies for videos newer than the known latest and updates the subscription', async () => {
    const { repo, notify, deps } = setup();
    await repo.followCreator({ creator, intervalMinutes: 30 });
    await repo.updateSubscription('c1', { latestVideoId: '1' });

    const svc = createMonitorService(deps as never);
    const result = await svc.runOnce('c1');

    expect(result.circuitBroken).toBe(false);
    expect(result.newVideoIds).toEqual(['3', '2']);
    expect(notify).toHaveBeenCalledTimes(2);
    const sub = await repo.getSubscription('c1');
    expect(sub?.latestVideoId).toBe('3');
    expect(sub?.lastCheckedAt).toBe(1000);
  });

  it('treats the first sync as a baseline without notifications', async () => {
    const { repo, notify, deps } = setup();
    await repo.followCreator({ creator, intervalMinutes: 30 });

    const result = await createMonitorService(deps as never).runOnce('c1');
    expect(result.newVideoIds).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect((await repo.getSubscription('c1'))?.latestVideoId).toBe('3');
  });

  it('trips the circuit breaker on login/captcha errors', async () => {
    const { repo, notify, deps } = setup({
      fetchCreatorVideos: vi.fn(async () => ({ errorCode: 'CAPTCHA_REQUIRED' })),
    });
    await repo.followCreator({ creator, intervalMinutes: 30 });

    const result = await createMonitorService(deps as never).runOnce('c1');
    expect(result.circuitBroken).toBe(true);
    expect(result.error?.code).toBe('CAPTCHA_REQUIRED');
    expect(notify).not.toHaveBeenCalled();
  });

  it('enqueues each newly detected video for processing via onNewVideo', async () => {
    const onNewVideo = vi.fn();
    const { repo, deps } = setup({ onNewVideo });
    await repo.followCreator({ creator, intervalMinutes: 30 });
    await repo.updateSubscription('c1', { latestVideoId: '1' });

    await createMonitorService(deps as never).runOnce('c1');

    expect(onNewVideo.mock.calls.map((c) => (c[0] as Video).id)).toEqual(['3', '2']);
  });

  it('does not call onNewVideo on the first-sync baseline', async () => {
    const onNewVideo = vi.fn();
    const { repo, deps } = setup({ onNewVideo });
    await repo.followCreator({ creator, intervalMinutes: 30 });

    await createMonitorService(deps as never).runOnce('c1');

    expect(onNewVideo).not.toHaveBeenCalled();
  });

  it('picks the least-recently-checked active subscription when no id is given', async () => {
    const { repo, deps } = setup();
    await repo.followCreator({ creator, intervalMinutes: 30 });
    await repo.followCreator({
      creator: { ...creator, id: 'c2', secUid: 'MS4w2' },
      intervalMinutes: 30,
    });
    await repo.updateSubscription('c1', { lastCheckedAt: 5000 });
    await repo.updateSubscription('c2', { lastCheckedAt: 100 });

    const result = await createMonitorService(deps as never).runOnce();
    expect(result.checkedCreatorIds).toEqual(['c2']);
  });
});

describe('createMonitorService.runDueBatch', () => {
  const NOW = 100 * 60_000;

  it('检查所有到期博主（最久未检查优先），跳过未到期', async () => {
    const { repo, deps } = setup({ now: () => NOW });
    await repo.followCreator({ creator, intervalMinutes: 30 });
    await repo.followCreator({ creator: { ...creator, id: 'c2', secUid: 's2' }, intervalMinutes: 30 });
    await repo.followCreator({ creator: { ...creator, id: 'c3', secUid: 's3' }, intervalMinutes: 30 });
    await repo.updateSubscription('c1', { lastCheckedAt: NOW - 90 * 60_000 }); // 到期
    await repo.updateSubscription('c2', { lastCheckedAt: NOW - 5 * 60_000 }); // 未到期
    await repo.updateSubscription('c3', { lastCheckedAt: NOW - 40 * 60_000 }); // 到期

    const result = await createMonitorService(deps as never).runDueBatch();
    expect(result.checkedCreatorIds).toEqual(['c1', 'c3']); // c2 未到期被跳过
  });

  it('单条熔断即中止整批', async () => {
    const fetchCreatorVideos = vi.fn(async (sub: { creator: { id: string } }) =>
      sub.creator.id === 'c1' ? { errorCode: 'NOT_LOGGED_IN' as const } : { videos: [v('1')] },
    );
    const { repo, deps } = setup({ now: () => NOW, fetchCreatorVideos });
    await repo.followCreator({ creator, intervalMinutes: 30 }); // c1：从未检查→最久→先查→熔断
    await repo.followCreator({ creator: { ...creator, id: 'c2', secUid: 's2' }, intervalMinutes: 30 });

    const result = await createMonitorService(deps as never).runDueBatch();
    expect(result.circuitBroken).toBe(true);
    expect(result.checkedCreatorIds).not.toContain('c2'); // 熔断后不再查 c2
    expect(fetchCreatorVideos).toHaveBeenCalledTimes(1);
  });

  it('限批 batchSize', async () => {
    const { repo, deps } = setup({ now: () => NOW });
    for (const id of ['c1', 'c2', 'c3']) {
      await repo.followCreator({ creator: { ...creator, id, secUid: `s-${id}` }, intervalMinutes: 30 });
    }
    const result = await createMonitorService(deps as never).runDueBatch({ batchSize: 2 });
    expect(result.checkedCreatorIds).toHaveLength(2);
  });
});

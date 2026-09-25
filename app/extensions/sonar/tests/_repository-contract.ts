import { describe, it, expect } from 'vitest';
import type { Repository } from '@/background/repository';
import type { Creator, Video, VideoSource } from '@/domain/models';

const now = () => 1_700_000_000_000;

export function creator(over: Partial<Creator> = {}): Creator {
  return {
    id: 'c1',
    secUid: 'MS4wsec',
    nickname: '博主',
    profileUrl: 'https://www.douyin.com/user/MS4wsec',
    updatedAt: now(),
    ...over,
  };
}

export function video(over: Partial<Video> = {}): Video {
  return {
    id: 'v1',
    creatorId: 'c1',
    description: '描述',
    publishedAt: 1000,
    sourcePageUrl: 'https://www.douyin.com/video/v1',
    ...over,
  };
}

/**
 * Repository 行为契约。内存实现与 IndexedDB 实现都跑同一套断言，保证可替换且语义一致。
 * makeRepo 每次调用返回一个全新、空的 Repository。
 */
export function repositoryContract(label: string, makeRepo: () => Repository): void {
  describe(`${label} — creators & subscriptions`, () => {
    it('upserts and reads a creator', async () => {
      const repo = makeRepo();
      await repo.upsertCreator(creator());
      expect((await repo.getCreator('c1'))?.nickname).toBe('博主');
      expect(await repo.getCreator('missing')).toBeNull();
    });

    it('looks up a creator by secUid', async () => {
      const repo = makeRepo();
      await repo.upsertCreator(creator({ secUid: 'MS4w-real' }));
      expect((await repo.getCreatorBySecUid('MS4w-real'))?.id).toBe('c1');
      expect(await repo.getCreatorBySecUid('nope')).toBeNull();
    });

    it('follows, lists and unfollows creators', async () => {
      const repo = makeRepo();
      await repo.followCreator({ creator: creator(), intervalMinutes: 30 });
      let subs = await repo.listSubscriptions();
      expect(subs).toHaveLength(1);
      expect(subs[0].intervalMinutes).toBe(30);
      expect(subs[0].paused).toBe(false);
      await repo.unfollowCreator('c1');
      expect(await repo.listSubscriptions()).toHaveLength(0);
    });

    it('reads and patches a subscription', async () => {
      const repo = makeRepo();
      await repo.followCreator({ creator: creator(), intervalMinutes: 60 });
      expect((await repo.getSubscription('c1'))?.intervalMinutes).toBe(60);
      await repo.updateSubscription('c1', { lastCheckedAt: 999, latestVideoId: 'vX', paused: true });
      const sub = await repo.getSubscription('c1');
      expect(sub?.lastCheckedAt).toBe(999);
      expect(sub?.latestVideoId).toBe('vX');
      expect(sub?.paused).toBe(true);
      expect(await repo.getSubscription('missing')).toBeNull();
    });
  });

  describe(`${label} — videos`, () => {
    it('lists a creator videos newest-first with paging', async () => {
      const repo = makeRepo();
      await repo.upsertVideos([
        video({ id: 'a', publishedAt: 100 }),
        video({ id: 'b', publishedAt: 300 }),
        video({ id: 'c', publishedAt: 200 }),
      ]);
      const page = await repo.listCreatorVideos('c1', { count: 2 });
      expect(page.videos.map((v) => v.id)).toEqual(['b', 'c']);
      expect(page.hasMore).toBe(true);

      const next = await repo.listCreatorVideos('c1', { count: 2, cursor: page.cursor });
      expect(next.videos.map((v) => v.id)).toEqual(['a']);

      const allRecent = await repo.listRecentVideos();
      expect(allRecent).toHaveLength(3);
    });

    it('caches and reads ranked sources and raw video', async () => {
      const repo = makeRepo();
      const sources: VideoSource[] = [
        { url: 'u', watermark: 'none', watermarkConfidence: 'high', watermarkEvidence: [] },
      ];
      await repo.cacheSources('v1', sources);
      expect(await repo.getCachedSources('v1')).toEqual(sources);
      expect(await repo.getCachedSources('nope')).toBeNull();
      await repo.cacheRawVideo('v1', { play_addr: {} });
      expect(await repo.getRawVideo('v1')).toEqual({ play_addr: {} });
    });
  });

  describe(`${label} — workflow pipeline`, () => {
    it('adds as collected, advances stages and removes', async () => {
      const repo = makeRepo();
      const item = await repo.addWorkflowItem({ videoId: 'v1', note: '初始' });
      expect(item.stage).toBe('collected');
      const moved = await repo.setWorkflowStage(item.id, 'preparing');
      expect(moved.stage).toBe('preparing');
      const ready = await repo.setWorkflowStage(item.id, 'ready');
      expect(ready.stage).toBe('ready');
      expect((await repo.getWorkflowItem(item.id))?.stage).toBe('ready');
      expect(await repo.removeWorkflowItem(item.id)).toBe(true);
      expect(await repo.listWorkflowItems()).toHaveLength(0);
    });

    it('records error on failed stage and clears it when advancing', async () => {
      const repo = makeRepo();
      const item = await repo.addWorkflowItem({ videoId: 'v1' });
      const failed = await repo.setWorkflowStage(item.id, 'failed', { error: '转录失败' });
      expect(failed.stage).toBe('failed');
      expect(failed.error).toBe('转录失败');
      const retried = await repo.setWorkflowStage(item.id, 'preparing');
      expect(retried.error).toBeUndefined();
    });

    it('hydrates insight onto workflow items when present', async () => {
      const repo = makeRepo();
      const item = await repo.addWorkflowItem({ videoId: 'v1' });
      await repo.putInsight({
        videoId: 'v1',
        angle: '反常识',
        hook: '开头一句',
        structure: ['一', '二'],
        highlights: [],
        dataPoints: [],
        remixSuggestions: ['换案例'],
        model: 'm',
        createdAt: 1,
      });
      const hydrated = await repo.getWorkflowItem(item.id);
      expect(hydrated?.insight?.angle).toBe('反常识');
      expect((await repo.listWorkflowItems())[0]?.insight?.hook).toBe('开头一句');
    });

    it('throws when advancing a missing workflow item', async () => {
      const repo = makeRepo();
      await expect(repo.setWorkflowStage('nope', 'ready')).rejects.toBeTruthy();
    });
  });

  describe(`${label} — tasks, transcript, analysis`, () => {
    it('stores download/processing tasks and chrome-id lookup', async () => {
      const repo = makeRepo();
      await repo.putDownloadTask({ id: 'd1', videoId: 'v1', status: 'downloading', chromeDownloadId: 77 });
      await repo.putDownloadTask({ id: 'd2', videoId: 'v2', status: 'queued' });
      expect((await repo.getDownloadTask('d1'))?.status).toBe('downloading');
      expect((await repo.findDownloadTaskByChromeId(77))?.id).toBe('d1');
      expect(await repo.findDownloadTaskByChromeId(999)).toBeNull();
      expect(await repo.listDownloadTasks()).toHaveLength(2);
      await repo.putProcessingTask({ id: 'p1', videoId: 'v1', stage: 'queued', progress: 0 });
      expect((await repo.getProcessingTask('p1'))?.stage).toBe('queued');
    });

    it('stores transcript and analysis, null when absent', async () => {
      const repo = makeRepo();
      expect(await repo.getTranscript('v1')).toBeNull();
      await repo.putTranscript({
        videoId: 'v1',
        provider: 'p',
        language: 'zh',
        fullText: 'hi',
        srtText: '',
        segments: [],
        createdAt: now(),
      });
      expect((await repo.getTranscript('v1'))?.fullText).toBe('hi');
      expect(await repo.getAnalysis('v1')).toBeNull();
      await repo.putAnalysis({
        videoId: 'v1',
        category: '深度分析',
        summary: 's',
        keyPoints: [],
        tags: [],
        model: 'm',
        createdAt: now(),
      });
      expect((await repo.getAnalysis('v1'))?.summary).toBe('s');
    });

    it('lists all analyses in one call', async () => {
      const repo = makeRepo();
      expect(await repo.listAnalyses()).toEqual([]);
      await repo.putAnalysis({
        videoId: 'v1', category: '深度分析', summary: 's1', keyPoints: [], tags: [], model: 'm', createdAt: now(),
      });
      await repo.putAnalysis({
        videoId: 'v2', category: '深度分析', summary: 's2', keyPoints: [], tags: [], model: 'm', createdAt: now(),
      });
      const all = await repo.listAnalyses();
      expect(all.map((a) => a.videoId).sort()).toEqual(['v1', 'v2']);
    });
  });
}

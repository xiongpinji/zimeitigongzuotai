import { describe, expect, it } from 'vitest';
import { ingestCapture, ingestDomCreatorPage } from '@/background/ingest';
import { createMemoryRepository } from '@/background/repository';

describe('ingestDomCreatorPage', () => {
  it('reuses the existing creator id for the same secUid', async () => {
    const repo = createMemoryRepository({ now: () => 1, newId: () => 'x' });
    // 模拟旧版 DOM fallback 已错误创建过一个以 secUid 为 id 的重复 Creator。
    await repo.upsertCreator({
      id: 'sec-uid',
      secUid: 'sec-uid',
      nickname: '重复记录',
      profileUrl: 'https://www.douyin.com/user/sec-uid',
      updatedAt: 1,
    });
    await repo.upsertCreator({
      id: 'internal-creator-id',
      secUid: 'sec-uid',
      nickname: '旧名称',
      profileUrl: 'https://www.douyin.com/user/sec-uid',
      updatedAt: 1,
    });
    await repo.followCreator({
      creator: (await repo.getCreator('internal-creator-id'))!,
      intervalMinutes: 30,
    });

    await ingestDomCreatorPage(
      repo,
      {
        id: 'sec-uid',
        secUid: 'sec-uid',
        nickname: '新名称',
        profileUrl: 'https://www.douyin.com/user/sec-uid',
        updatedAt: 2,
      },
      [{ id: 'video-1', creatorId: 'sec-uid', description: '作品', publishedAt: 2, sourcePageUrl: 'u' }],
    );

    expect((await repo.getVideo('video-1'))?.creatorId).toBe('internal-creator-id');
    expect((await repo.getCreator('internal-creator-id'))?.nickname).toBe('新名称');
    expect((await repo.getCreator('sec-uid'))?.nickname).toBe('重复记录');
  });
});

describe('ingestCapture creator dedup by secUid', () => {
  // 反向：DOM 捕获先以 secUid 建过 Creator（新版主页 RSC 下唯一可得 id），随后 PageBridge
  // 被动 API 捕获（aweme_list，作者带内部 uid）到达。必须复用 secUid 记录、把作品挂在它名下，
  // 否则会产生第二条以 uid 为 id 的 Creator，作品被重挂走，已按 secUid 订阅的工作台显示 0 条。
  it('reuses an existing secUid-keyed creator instead of creating a uid duplicate', async () => {
    const repo = createMemoryRepository({ now: () => 1, newId: () => 'x' });
    await repo.upsertCreator({
      id: 'sec-uid',
      secUid: 'sec-uid',
      nickname: '罗心荣',
      profileUrl: 'https://www.douyin.com/user/sec-uid',
      updatedAt: 1,
    });
    await repo.upsertVideos([
      { id: 'video-1', creatorId: 'sec-uid', description: '旧', publishedAt: 1, sourcePageUrl: 'u' },
    ]);

    await ingestCapture(
      repo,
      'creator_videos',
      {
        aweme_list: [
          {
            aweme_id: 'video-1',
            desc: '新',
            author: { uid: 'internal-uid', sec_uid: 'sec-uid', nickname: '罗心荣' },
            video: {},
          },
          {
            aweme_id: 'video-2',
            desc: '另一条',
            author: { uid: 'internal-uid', sec_uid: 'sec-uid', nickname: '罗心荣' },
            video: {},
          },
        ],
      },
      () => 2,
    );

    // 作品仍挂在 secUid 名下（订阅按 secUid 过滤可见），未被重挂到内部 uid。
    expect((await repo.getVideo('video-1'))?.creatorId).toBe('sec-uid');
    expect((await repo.getVideo('video-2'))?.creatorId).toBe('sec-uid');
    // 未产生第二条以内部 uid 为 id 的重复 Creator。
    expect(await repo.getCreator('internal-uid')).toBeNull();
    expect((await repo.getCreatorBySecUid('sec-uid'))?.id).toBe('sec-uid');
  });
});

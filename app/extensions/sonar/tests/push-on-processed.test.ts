import { describe, it, expect, vi } from 'vitest';
import { createPushOnProcessed } from '@/bridge/push-on-processed';
import { createMemoryBridgeSettingsStore } from '@/bridge/bridge-settings';
import type { Creator, TranscriptDocument, Video, ViralInsight } from '@/domain/models';

const video: Video = {
  id: 'v1',
  creatorId: 'c1',
  description: '标题',
  publishedAt: 1,
  sourcePageUrl: 'https://www.douyin.com/video/v1',
};
const creator: Creator = { id: 'c1', secUid: 's', nickname: '王', profileUrl: 'u', updatedAt: 0 };
const transcript: TranscriptDocument = {
  videoId: 'v1',
  provider: 'bcut',
  language: 'zh',
  fullText: '转录',
  srtText: 's',
  segments: [{ text: '转录', startMs: 0, endMs: 1 }],
  createdAt: 0,
};

function repo(
  over: Partial<{
    video: Video | null;
    creator: Creator | null;
    transcript: TranscriptDocument | null;
    insight: ViralInsight | null;
  }> = {},
) {
  return {
    getVideo: vi.fn(async () => (over.video !== undefined ? over.video : video)),
    getCreator: vi.fn(async () => (over.creator !== undefined ? over.creator : creator)),
    getTranscript: vi.fn(async () => (over.transcript !== undefined ? over.transcript : transcript)),
    getInsight: vi.fn(async () => (over.insight !== undefined ? over.insight : null)),
  };
}

describe('createPushOnProcessed', () => {
  it('启用时组装负载并入队', async () => {
    const enqueue = vi.fn(async () => ({ status: 'sent', duplicate: false }) as const);
    const push = createPushOnProcessed({
      repo: repo(),
      bridgeSettings: createMemoryBridgeSettingsStore({ enabled: true, token: 't' }),
      bridgeClient: { enqueue },
    });
    const res = await push('v1');
    expect(res).toEqual({ pushed: true, outcome: { status: 'sent', duplicate: false } });
    expect(enqueue).toHaveBeenCalledOnce();
    const args = enqueue.mock.calls[0] as unknown as [unknown, { awemeId: string; creatorName: string }];
    expect(args[1]).toMatchObject({ awemeId: 'v1', creatorName: '王' });
  });

  it('未启用 → 跳过，不调 enqueue', async () => {
    const enqueue = vi.fn();
    const push = createPushOnProcessed({
      repo: repo(),
      bridgeSettings: createMemoryBridgeSettingsStore({ enabled: false }),
      bridgeClient: { enqueue },
    });
    expect(await push('v1')).toEqual({ pushed: false, reason: 'disabled' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('作品缺失 → no-video', async () => {
    const push = createPushOnProcessed({
      repo: repo({ video: null }),
      bridgeSettings: createMemoryBridgeSettingsStore({ enabled: true, token: 't' }),
      bridgeClient: { enqueue: vi.fn() },
    });
    expect(await push('v1')).toEqual({ pushed: false, reason: 'no-video' });
  });

  it('转录缺失 → no-payload', async () => {
    const push = createPushOnProcessed({
      repo: repo({ transcript: null }),
      bridgeSettings: createMemoryBridgeSettingsStore({ enabled: true, token: 't' }),
      bridgeClient: { enqueue: vi.fn() },
    });
    expect(await push('v1')).toEqual({ pushed: false, reason: 'no-payload' });
  });

  it('force 手动推送：开关关闭也推送，并把 refresh 透传给 enqueue', async () => {
    const enqueue = vi.fn(async () => ({ status: 'sent', duplicate: false }) as const);
    const push = createPushOnProcessed({
      repo: repo(),
      bridgeSettings: createMemoryBridgeSettingsStore({ enabled: false, endpoint: 'http://x', token: 't' }),
      bridgeClient: { enqueue },
    });
    const res = await push('v1', { force: true, refresh: true });
    expect(res).toEqual({ pushed: true, outcome: { status: 'sent', duplicate: false } });
    // 传入 enqueue 的 config.enabled 被强制为 true，且 opts.refresh 透传
    const call = enqueue.mock.calls[0] as unknown as [{ enabled: boolean }, unknown, unknown];
    expect(call[0]).toMatchObject({ enabled: true });
    expect(call[2]).toEqual({ refresh: true });
  });
});

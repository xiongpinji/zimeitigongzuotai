import { describe, it, expect } from 'vitest';
import { createInMemoryContext } from '@/background/context';
import { createHandlers } from '@/background/handlers';
import { createRouter } from '@/background/router';
import { ingestCapture } from '@/background/ingest';
import { createDirectTransport } from '@/client/transport';
import { createDouyinClient, type DouyinClient } from '@/client/douyin-client';
import type { Services } from '@/background/services';
import type { HandlerContext } from '@/background/handlers';
import { createMemoryRepository, type Repository } from '@/background/repository';
import detailFixture from './fixtures/aweme-detail.json';

const VIDEO_ID = '7300000000000000001';
const CREATOR_ID = '100000001';
const VIDEO_URL = `https://www.douyin.com/video/${VIDEO_ID}`;
const NOW = 1_700_000_000_000;

function fakeServices(repo: Repository): Services {
  return {
    download: {
      async download(req) {
        return { id: 'dl-1', videoId: req.video.id, status: 'queued' };
      },
      async cancel() {},
    },
    processing: {
      async process(videoId) {
        const task = { id: 'pr-1', videoId, stage: 'queued' as const, progress: 0 };
        await repo.putProcessingTask(task);
        return task;
      },
      // 真实 start 会立即持久化 queued 任务，后台推进；fake 同样持久化以供 getter 验证。
      async start(videoId) {
        const task = { id: 'pr-1', videoId, stage: 'queued' as const, progress: 0 };
        await repo.putProcessingTask(task);
        return task;
      },
      async cancel() {},
    },
    monitor: {
      async runOnce() {
        return { checkedCreatorIds: [CREATOR_ID], newVideoIds: ['x'], circuitBroken: false };
      },
      async runDueBatch() {
        return { checkedCreatorIds: [CREATOR_ID], newVideoIds: ['x'], circuitBroken: false };
      },
    },
    export: {
      async exportMarkdown() {
        return { id: 'ex-1', status: 'completed', filename: '灵机采风/导出/a.md' };
      },
    },
    aiTester: {
      async test() {
        return { ok: true, latencyMs: 5 };
      },
    },
    collect: {
      async collectCreatorFully() {
        return { ok: true, collected: 0 };
      },
      getProgress() {
        return null;
      },
    },
    workflow: {
      async run() {},
    },
  };
}

async function setup(): Promise<{ client: DouyinClient; ctx: HandlerContext }> {
  let seq = 0;
  const repo = createMemoryRepository({ now: () => NOW, newId: () => `wf-${++seq}` });
  const ctx = createInMemoryContext({
    now: () => NOW,
    newId: () => `wf-${++seq}`,
    getActivePageUrl: async () => VIDEO_URL,
    repo,
    services: fakeServices(repo),
  });
  // 模拟页面捕获入库，让 resolveVideo/download 有数据可用。
  await ingestCapture(ctx.repo, 'video_detail', detailFixture, ctx.now);
  // 直接灌入字幕与分析，验证 getter。
  await ctx.repo.putTranscript({
    videoId: VIDEO_ID,
    provider: 'test',
    language: 'zh',
    fullText: '全文',
    srtText: '1\n00:00:00,000 --> 00:00:01,000\n全文\n',
    segments: [{ text: '全文', startMs: 0, endMs: 1000 }],
    createdAt: NOW,
  });
  await ctx.repo.putAnalysis({
    videoId: VIDEO_ID,
    category: '深度分析',
    summary: '摘要',
    keyPoints: ['点1'],
    tags: ['标签'],
    model: 'gpt-test',
    createdAt: NOW,
  });

  const router = createRouter(createHandlers(ctx));
  const client = createDouyinClient(createDirectTransport(router));
  return { client, ctx };
}

describe('e2e — page & creator', () => {
  it('detectCurrentPage resolves the active tab', async () => {
    const { client } = await setup();
    const page = await client.detectCurrentPage();
    expect(page.type).toBe('video');
    expect(page.awemeId).toBe(VIDEO_ID);
  });

  it('getCreator returns the ingested creator', async () => {
    const { client } = await setup();
    expect((await client.getCreator(CREATOR_ID)).nickname).toBe('测试博主');
  });

  it('listCreatorVideos returns the ingested video', async () => {
    const { client } = await setup();
    const page = await client.listCreatorVideos(CREATOR_ID);
    expect(page.videos.map((v) => v.id)).toContain(VIDEO_ID);
  });
});

describe('e2e — resolve & download', () => {
  it('resolveVideo returns ranked sources', async () => {
    const { client } = await setup();
    const resolved = await client.resolveVideo({ videoId: VIDEO_ID });
    expect(resolved.video.id).toBe(VIDEO_ID);
    // 折叠后只暴露"最优无水印 + 带水印"两个候选，而非 4 个原始档位。
    expect(resolved.sources.length).toBe(2);
    expect(resolved.sources[0].watermark).toBe('none');
  });

  it('downloadVideo selects a source, returns and persists the task', async () => {
    const { client } = await setup();
    const task = await client.downloadVideo(VIDEO_ID);
    expect(task.id).toBe('dl-1');
    expect(task.status).toBe('queued');
    expect((await client.getDownloadTask('dl-1')).videoId).toBe(VIDEO_ID);
    await expect(client.cancelDownload('dl-1')).resolves.toBeUndefined();
  });
});

describe('e2e — follow & monitor', () => {
  it('follows, lists and unfollows a creator', async () => {
    const { client } = await setup();
    const creator = await client.getCreator(CREATOR_ID);
    await client.followCreator({ creator, intervalMinutes: 30 });
    expect(await client.listFollowedCreators()).toHaveLength(1);
    await client.unfollowCreator(CREATOR_ID);
    expect(await client.listFollowedCreators()).toHaveLength(0);
  });

  it('runMonitorOnce returns a structured result', async () => {
    const { client } = await setup();
    const result = await client.runMonitorOnce();
    expect(result.circuitBroken).toBe(false);
    expect(result.checkedCreatorIds).toContain(CREATOR_ID);
  });
});

describe('e2e — processing, transcript, analysis', () => {
  it('processVideo returns and persists a processing task', async () => {
    const { client } = await setup();
    const task = await client.processVideo(VIDEO_ID);
    expect(task.id).toBe('pr-1');
    expect((await client.getProcessingTask('pr-1')).stage).toBe('queued');
    await expect(client.cancelProcessingTask('pr-1')).resolves.toBeUndefined();
  });

  it('reads transcript and analysis, regenerates via processing', async () => {
    const { client } = await setup();
    expect((await client.getTranscript(VIDEO_ID))?.fullText).toBe('全文');
    expect((await client.getAnalysis(VIDEO_ID))?.category).toBe('深度分析');
    expect((await client.regenerateTranscript(VIDEO_ID)).id).toBe('pr-1');
    expect((await client.regenerateAnalysis(VIDEO_ID)).id).toBe('pr-1');
  });
});

describe('e2e — export & workflow', () => {
  it('exportMarkdown returns a task', async () => {
    const { client } = await setup();
    const task = await client.exportMarkdown({ videoIds: [VIDEO_ID] });
    expect(task.status).toBe('completed');
  });

  it('adds, lists and removes workflow items', async () => {
    const { client } = await setup();
    const item = await client.addToWorkflow({ videoId: VIDEO_ID, note: 'n' });
    expect(item.stage).toBe('collected');
    expect(await client.listWorkflowItems()).toHaveLength(1);
    expect(await client.removeWorkflowItem(item.id)).toBe(true);
    expect(await client.listWorkflowItems()).toHaveLength(0);
  });
});

describe('e2e — AI settings', () => {
  it('updates and reads masked AI settings without leaking the key', async () => {
    const { client } = await setup();
    await client.updateAiSettings({
      llm: {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            protocol: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-summary-9876',
            models: ['gpt-5.5'],
            presetId: 'openai',
          },
        ],
        defaultProviderId: 'openai',
        defaultModel: 'gpt-5.5',
      },
      dataSendConsent: true,
    });
    const view = await client.getAiSettings();
    expect(view.llm.configured).toBe(true);
    expect(view.llm.providers).toHaveLength(1);
    expect(view.llm.defaultProviderId).toBe('openai');
    expect(view.dataSendConsent).toBe(true);
    expect(view.llm.providers[0].apiKeyMasked).toBe('••••9876');
    expect(view.llm.providers[0].hasApiKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain('sk-summary-9876');
  });

  it('preserves an existing API key when an update omits it', async () => {
    const { client } = await setup();
    const base = {
      id: 'openai',
      name: 'OpenAI',
      protocol: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-5.5'],
      presetId: 'openai',
    };
    await client.updateAiSettings({
      llm: { providers: [{ ...base, apiKey: 'sk-keep-4321' }], defaultProviderId: 'openai' },
    });
    // 再次保存但不带 apiKey（UI 遮罩回写场景）：Key 不应被清空。
    await client.updateAiSettings({ llm: { providers: [base], defaultProviderId: 'openai' } });
    const view = await client.getAiSettings();
    expect(view.llm.providers[0].hasApiKey).toBe(true);
    expect(view.llm.providers[0].apiKeyMasked).toBe('••••4321');
  });

  it('testAiProvider round-trips', async () => {
    const { client } = await setup();
    expect((await client.testAiProvider({ target: 'summary' })).ok).toBe(true);
  });
});

describe('e2e — error propagation', () => {
  it('surfaces a standardized SonarError when a video is unknown', async () => {
    const { client } = await setup();
    await expect(client.resolveVideo({ videoId: 'unknown-id' })).rejects.toMatchObject({
      error: { code: 'VIDEO_NOT_FOUND' },
    });
  });
});

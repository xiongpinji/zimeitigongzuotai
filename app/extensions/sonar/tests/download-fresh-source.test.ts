/**
 * 回归：下载必须现解析新鲜源，而不是复用捕获时缓存的带签名地址。
 *
 * 抖音 CDN 的 play_addr 带时间签名，过期后返回 403 text/html；chrome.downloads 会把这段
 * HTML 当文件存下（用户表现为「下载的是 html 不是 mp4」）。捕获入库只缓存了 raw video，
 * resolveVideo 每次都从同一份 raw 重新提取同一个会过期的地址，因此下载路径必须强制走分享页
 * 重新解析（对齐参考脚本 run_single_file.py 的「现解析、立即下载」）。
 */
import { describe, it, expect } from 'vitest';
import { createInMemoryContext } from '@/background/context';
import { createHandlers } from '@/background/handlers';
import { createRouter } from '@/background/router';
import { ingestCapture } from '@/background/ingest';
import { createDirectTransport } from '@/client/transport';
import { createDouyinClient } from '@/client/douyin-client';
import type { Services } from '@/background/services';

const VIDEO_ID = '7300000000000000001';
const NOW = 1_700_000_000_000;

/** 捕获入库时拿到的地址（带签名，会过期）。 */
const STALE_URL = 'https://v3-web.douyinvod.com/fake/play_main.mp4?ratio=1080p&sign=EXPIRED';
/** 分享页现解析得到的新鲜地址。 */
const FRESH_URL = 'https://aweme.snssdk.com/aweme/v1/play/?video_id=FRESH&ratio=720p';

const STALE_DETAIL = {
  status_code: 0,
  aweme_detail: {
    aweme_id: VIDEO_ID,
    desc: '测试视频',
    create_time: 1718000000,
    author: { uid: '100000001', sec_uid: 'MS4wsec', nickname: '测试博主' },
    video: { play_addr: { url_list: [STALE_URL], width: 1080, height: 1920 } },
  },
};

const SHARE_HTML = `<script>window._ROUTER_DATA = ${JSON.stringify({
  loaderData: {
    'video_(id)/page': {
      videoInfoRes: {
        item_list: [
          {
            aweme_id: VIDEO_ID,
            desc: '测试视频',
            create_time: 1718000000,
            author: { uid: '100000001', sec_uid: 'MS4wsec', nickname: '测试博主' },
            video: { play_addr: { url_list: [FRESH_URL], width: 1080, height: 1920 } },
          },
        ],
      },
    },
  },
})};</script>`;

function capturingServices(captured: { url?: string }): Services {
  return {
    download: {
      async download(req) {
        captured.url = req.source.url;
        return { id: 'dl-1', videoId: req.video.id, status: 'queued' };
      },
      async cancel() {},
    },
    processing: { async process(videoId) { return { id: 'pr-1', videoId, stage: 'queued', progress: 0 }; }, async start(videoId) { return { id: 'pr-1', videoId, stage: 'queued', progress: 0 }; }, async cancel() {} },
    monitor: { async runOnce() { return { checkedCreatorIds: [], newVideoIds: [], circuitBroken: false }; }, async runDueBatch() { return { checkedCreatorIds: [], newVideoIds: [], circuitBroken: false }; } },
    export: { async exportMarkdown() { return { id: 'ex-1', status: 'completed', filename: 'a.md' }; } },
    aiTester: { async test() { return { ok: true, latencyMs: 1 }; } },
    collect: { async collectCreatorFully() { return { ok: false, collected: 0, reason: 'no_tab' as const }; }, getProgress() { return null; } },
    workflow: { async run() {} },
  };
}

describe('downloadVideo — 现解析新鲜源', () => {
  it('下载使用分享页现解析的新鲜地址，而不是捕获缓存里会过期的地址', async () => {
    const captured: { url?: string } = {};
    const ctx = createInMemoryContext({
      now: () => NOW,
      newId: () => 'id-1',
      services: capturingServices(captured),
      fetchPage: async (url: string) => ({ text: SHARE_HTML, finalUrl: url }),
    });
    await ingestCapture(ctx.repo, 'video_detail', STALE_DETAIL, ctx.now);

    const client = createDouyinClient(createDirectTransport(createRouter(createHandlers(ctx))));
    await client.downloadVideo(VIDEO_ID);

    expect(captured.url).toBe(FRESH_URL);
    expect(captured.url).not.toBe(STALE_URL);
  });
});

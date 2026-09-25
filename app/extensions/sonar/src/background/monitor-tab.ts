/**
 * 监控的浏览器交互（设计文档第 9 节）：inactive 标签页捕获作品列表 + 系统通知。
 *
 * 顺序打开一个非激活抖音标签页加载博主主页，等待 Content Script 捕获作品列表入库，
 * 轮询 Repository 读到结果后关闭标签页。通知用 chrome.notifications。
 */
import type { Creator, CreatorSubscription, Video } from '@/domain/models';
import type { Repository } from './repository';
import type { FetchCreatorVideosResult } from '@/monitor/monitor-service';

// 1x1 透明 PNG，作为通知图标兜底（避免缺图标导致通知创建失败）。
const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TabFetcherOptions {
  maxWaitMs?: number;
  pollIntervalMs?: number;
}

export function createTabCreatorFetcher(repo: Repository, options: TabFetcherOptions = {}) {
  const maxWaitMs = options.maxWaitMs ?? 20_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;

  return async function fetchCreatorVideos(
    sub: CreatorSubscription,
  ): Promise<FetchCreatorVideosResult> {
    const before = (await repo.listCreatorVideos(sub.creator.id, { count: 1 })).videos[0]?.id;
    let tabId: number | undefined;
    try {
      const tab = await chrome.tabs.create({ url: sub.creator.profileUrl, active: false });
      tabId = tab.id;
      const deadline = Date.now() + maxWaitMs;
      while (Date.now() < deadline) {
        await delay(pollIntervalMs);
        const page = await repo.listCreatorVideos(sub.creator.id, { count: 50 });
        if (page.videos.length > 0 && page.videos[0]?.id !== before) {
          return { videos: page.videos };
        }
      }
      const page = await repo.listCreatorVideos(sub.creator.id, { count: 50 });
      return { videos: page.videos };
    } catch (e) {
      console.warn('[Sonar] 监控标签页失败', e);
      return { videos: [] };
    } finally {
      if (tabId !== undefined) {
        try {
          await chrome.tabs.remove(tabId);
        } catch {
          /* 标签页已关闭 */
        }
      }
    }
  };
}

export function createChromeNotifier() {
  return async function notify(creator: Creator, video: Video): Promise<void> {
    try {
      chrome.notifications.create(`sonar:${video.id}`, {
        type: 'basic',
        iconUrl: FALLBACK_ICON,
        title: `${creator.nickname} 发布了新视频`,
        message: video.description || '点击查看详情',
        buttons: [{ title: '查看详情' }, { title: '下载原片' }],
      });
    } catch (e) {
      console.warn('[Sonar] 通知创建失败', e);
    }
  };
}

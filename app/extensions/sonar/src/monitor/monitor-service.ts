/**
 * 自动监控编排（设计文档第 9 节）。
 *
 * 选最久未检查的收藏博主，让注入的 fetchCreatorVideos 通过 inactive 标签页捕获作品列表，
 * 与本地记录比较得出新增并发通知，更新订阅游标。出现登录失效/验证码/访问限制则熔断。
 * 浏览器交互（开标签页、通知）由依赖注入，核心编排可单测。
 */
import type { Creator, Video } from '@/domain/models';
import type { MonitorResult } from '@/domain/api-types';
import type { SonarErrorCode } from '@/domain/errors';
import { isMonitorCircuitBreaker, makeError } from '@/domain/errors';
import type { MonitorService } from '@/background/services';
import type { Repository } from '@/background/repository';
import { diffNewVideos } from './diff';
import type { CreatorSubscription } from '@/domain/models';
import { selectDueSubscriptions, DEFAULT_BATCH_SIZE } from './schedule';

export interface FetchCreatorVideosResult {
  videos?: Video[];
  errorCode?: SonarErrorCode;
}

export interface MonitorDeps {
  repo: Repository;
  /** 通过 inactive 标签页捕获并返回该博主的最新作品列表（或错误码）。 */
  fetchCreatorVideos: (sub: CreatorSubscription) => Promise<FetchCreatorVideosResult>;
  notify: (creator: Creator, video: Video) => Promise<void>;
  /** 发现新作品时逐条回调，用于自动入队字幕解析（+ 可选摘要）。首次同步基线不触发。 */
  onNewVideo?: (video: Video, creator: Creator) => void;
  now: () => number;
}

async function pickSubscription(
  repo: Repository,
  creatorId?: string,
): Promise<CreatorSubscription | null> {
  if (creatorId) return repo.getSubscription(creatorId);
  const active = (await repo.listSubscriptions()).filter((s) => !s.paused);
  if (active.length === 0) return null;
  // 最久未检查优先（未检查过的视为最久）。
  return active.sort((a, b) => (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0))[0];
}

export function createMonitorService(deps: MonitorDeps): MonitorService {
  /** 检查单个订阅，把结果累加进 result；返回是否熔断（应中止后续）。 */
  async function checkOne(sub: CreatorSubscription, result: MonitorResult): Promise<boolean> {
    const res = await deps.fetchCreatorVideos(sub);
    if (res.errorCode) {
      result.error = makeError(res.errorCode, '监控检查失败');
      if (isMonitorCircuitBreaker(res.errorCode)) {
        result.circuitBroken = true;
        return true;
      }
      return false;
    }

    const videos = res.videos ?? [];
    const diff = diffNewVideos(sub.latestVideoId, videos);
    for (const video of diff.newVideos) {
      await deps.notify(sub.creator, video);
      // 新作品默认进入处理队列做字幕解析；摘要是否生成由处理服务按 Provider 配置决定。
      deps.onNewVideo?.(video, sub.creator);
      result.newVideoIds.push(video.id);
    }
    await deps.repo.updateSubscription(sub.creator.id, {
      lastCheckedAt: deps.now(),
      ...(diff.latestId ? { latestVideoId: diff.latestId } : {}),
    });
    result.checkedCreatorIds.push(sub.creator.id);
    return false;
  }

  return {
    async runOnce(creatorId?: string): Promise<MonitorResult> {
      const result: MonitorResult = { checkedCreatorIds: [], newVideoIds: [], circuitBroken: false };
      const sub = await pickSubscription(deps.repo, creatorId);
      if (!sub) return result;
      await checkOne(sub, result);
      return result;
    },

    async runDueBatch(opts?: { batchSize?: number }): Promise<MonitorResult> {
      const result: MonitorResult = { checkedCreatorIds: [], newVideoIds: [], circuitBroken: false };
      const subs = await deps.repo.listSubscriptions();
      const due = selectDueSubscriptions(subs, deps.now(), opts?.batchSize ?? DEFAULT_BATCH_SIZE);
      for (const sub of due) {
        // 单条熔断（登录失效/验证码）即中止整批，避免连环触发风控。
        const broke = await checkOne(sub, result);
        if (broke) break;
      }
      return result;
    },
  };
}

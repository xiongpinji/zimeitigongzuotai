/**
 * createHandlers：把 DouyinClient 的 25 个方法实现为消息路由的 handler。
 *
 * handler 只做编排：读写 Repository、调用注入的 Services、复用适配器与解析器。
 * 子系统尚未接入时，对应 Service 的 stub 会如实抛出标准化错误（API 仍连通）。
 */
import { detectPageFromUrl } from '@/adapter/page-detection';
import { selectPreferredSource, pickDownloadCandidates } from '@/resolver/source-ranker';
import { ensureVideoSources } from './resolve-sources';
import type { FetchText } from '@/resolver/share-resolver';
import { SonarException, makeError } from '@/domain/errors';
import type {
  AddWorkflowItemInput,
  DownloadOptions,
  FollowCreatorInput,
  ListVideoOptions,
  MarkdownExportInput,
  ProcessVideoOptions,
  ResolveVideoInput,
  ResolvedVideo,
  TestAiProviderInput,
  UpdateAiSettingsInput,
  WorkflowItemRef,
} from '@/domain/api-types';
import type { PageDetectionResult } from '@/domain/models';
import type { HandlerMap } from './router';
import type { Repository } from './repository';
import type { SettingsStore } from './settings-store';
import { toAiSettingsView } from './settings-store';
import type { Services } from './services';
import type { BridgeSettingsStore, UpdateBridgeSettingsInput } from '@/bridge/bridge-settings';
import { toBridgeSettingsView } from '@/bridge/bridge-settings';
import type { BridgeClient } from '@/bridge/bridge-client';
import type { PushOptions, PushResult } from '@/bridge/push-on-processed';

/** 桥依赖：设置存储 + 探活/配对客户端 + 手动推送某视频到待创作箱。 */
export interface BridgeContext {
  settings: BridgeSettingsStore;
  client: Pick<BridgeClient, 'probe' | 'pair'>;
  push(videoId: string, opts?: PushOptions): Promise<PushResult>;
}

export interface HandlerContext {
  repo: Repository;
  settings: SettingsStore;
  services: Services;
  bridge: BridgeContext;
  /** 当前激活标签页的 URL（运行时由 chrome.tabs 提供）。 */
  getActivePageUrl: () => Promise<string | null>;
  /** 抓取页面文本并返回最终地址（用于抖音分享页无水印兜底解析）。 */
  fetchPage: FetchText;
  now: () => number;
  newId: () => string;
}

function asObject(params: unknown): Record<string, unknown> {
  return typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
}

function requireString(params: unknown, key: string): string {
  const v = asObject(params)[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new SonarException(makeError('PARSE_ERROR', `缺少参数：${key}`));
  }
  return v;
}

export function createHandlers(ctx: HandlerContext): HandlerMap {
  async function resolveVideo(input: ResolveVideoInput, opts?: { preferFresh?: boolean }): Promise<ResolvedVideo> {
    let awemeId = input.videoId;
    const shareUrl = input.shareUrl ?? input.pageUrl;
    if (!awemeId && input.pageUrl) {
      awemeId = detectPageFromUrl(input.pageUrl).awemeId;
    }
    if (!awemeId && !shareUrl) {
      throw new SonarException(
        makeError('VIDEO_NOT_FOUND', '无法从输入确定作品 ID', { nextAction: '打开视频页或粘贴有效链接' }),
      );
    }
    // 先用已采集数据，缺失时回退抖音分享页解析无水印源（playwm→play）。
    // 下载路径（preferFresh）强制现解析新鲜签名地址，避免缓存的过期地址下载成 403 html。
    const { video, sources } = await ensureVideoSources(
      { repo: ctx.repo, fetchPage: ctx.fetchPage, now: ctx.now },
      {
        ...(awemeId ? { awemeId } : {}),
        ...(shareUrl ? { shareUrl } : {}),
        ...(opts?.preferFresh ? { preferFresh: true } : {}),
      },
    );
    if (!video) {
      throw new SonarException(
        makeError('VIDEO_NOT_FOUND', '无法解析该作品，请在抖音页面打开或检查链接后重试'),
      );
    }
    // 折叠重复清晰度/编码，避免把一堆 bit_rate 档位全摊给用户（"格式太多了"）。
    return { video, sources: pickDownloadCandidates(sources) };
  }

  async function startProcessing(videoId: string, options?: ProcessVideoOptions) {
    // fire-and-forget：即时返回 queued 任务，管线在后台推进并把阶段/错误写入 repo；
    // UI 轮询 getProcessingTask 展示进度，失败也能读到 task.error。
    return ctx.services.processing.start(videoId, options);
  }

  return {
    async detectCurrentPage(): Promise<PageDetectionResult> {
      const url = await ctx.getActivePageUrl();
      if (!url) return { type: 'unsupported', url: '' };
      return detectPageFromUrl(url);
    },

    async getCreator(params) {
      const id = requireString(params, 'creatorId');
      const creator = await ctx.repo.getCreator(id);
      if (!creator) {
        throw new SonarException(makeError('VIDEO_NOT_FOUND', '尚未采集到该博主信息'));
      }
      return creator;
    },

    async getCreatorBySecUid(params) {
      return ctx.repo.getCreatorBySecUid(requireString(params, 'secUid'));
    },

    async listCreatorVideos(params) {
      const p = asObject(params);
      const id = requireString(params, 'creatorId');
      return ctx.repo.listCreatorVideos(id, p.options as ListVideoOptions | undefined);
    },

    async listRecentVideos(params) {
      const limit = asObject(params).limit;
      return ctx.repo.listRecentVideos(typeof limit === 'number' ? limit : undefined);
    },

    async collectCreatorFully(params) {
      const secUid = requireString(params, 'secUid');
      const profileUrl = asObject(params).profileUrl;
      return ctx.services.collect.collectCreatorFully({
        secUid,
        ...(typeof profileUrl === 'string' && profileUrl ? { profileUrl } : {}),
      });
    },

    async getCollectProgress(params) {
      return ctx.services.collect.getProgress(requireString(params, 'secUid'));
    },

    async resolveVideo(params) {
      const input = asObject(params) as ResolveVideoInput;
      return resolveVideo(input, input.preferFresh ? { preferFresh: true } : undefined);
    },

    async downloadVideo(params) {
      const p = asObject(params);
      const videoId = requireString(params, 'videoId');
      const options = (p.options as DownloadOptions | undefined) ?? {};
      const resolved = await resolveVideo({ videoId }, { preferFresh: true });
      const selection = selectPreferredSource(resolved.sources, {
        allowWatermarkFallback: options.allowWatermarkFallback ?? false,
      });
      if (!selection.ok) {
        throw new SonarException(makeError(selection.code, '没有可用于下载的视频源'));
      }
      const creator = await ctx.repo.getCreator(resolved.video.creatorId);
      const task = await ctx.services.download.download({
        video: resolved.video,
        creator,
        source: selection.source,
      });
      await ctx.repo.putDownloadTask(task);
      return task;
    },

    async getDownloadTask(params) {
      const id = requireString(params, 'taskId');
      const task = await ctx.repo.getDownloadTask(id);
      if (!task) throw new SonarException(makeError('PARSE_ERROR', '下载任务不存在'));
      return task;
    },

    async cancelDownload(params) {
      const id = requireString(params, 'taskId');
      await ctx.services.download.cancel(id);
      return null;
    },

    async followCreator(params) {
      const p = asObject(params) as unknown as FollowCreatorInput;
      await ctx.repo.followCreator(p);
      return null;
    },

    async unfollowCreator(params) {
      await ctx.repo.unfollowCreator(requireString(params, 'creatorId'));
      return null;
    },

    async listFollowedCreators() {
      return ctx.repo.listSubscriptions();
    },

    async runMonitorOnce(params) {
      const creatorId = asObject(params).creatorId;
      return ctx.services.monitor.runOnce(typeof creatorId === 'string' ? creatorId : undefined);
    },

    async processVideo(params) {
      const videoId = requireString(params, 'videoId');
      const options = asObject(params).options as ProcessVideoOptions | undefined;
      return startProcessing(videoId, options);
    },

    async getProcessingTask(params) {
      const id = requireString(params, 'taskId');
      const task = await ctx.repo.getProcessingTask(id);
      if (!task) throw new SonarException(makeError('PARSE_ERROR', '处理任务不存在'));
      return task;
    },

    async cancelProcessingTask(params) {
      await ctx.services.processing.cancel(requireString(params, 'taskId'));
      return null;
    },

    async getTranscript(params) {
      return ctx.repo.getTranscript(requireString(params, 'videoId'));
    },

    async regenerateTranscript(params) {
      const videoId = requireString(params, 'videoId');
      return startProcessing(videoId, { force: true });
    },

    async getAnalysis(params) {
      return ctx.repo.getAnalysis(requireString(params, 'videoId'));
    },

    async listAnalyses() {
      return ctx.repo.listAnalyses();
    },

    async regenerateAnalysis(params) {
      const videoId = requireString(params, 'videoId');
      return startProcessing(videoId, { force: true, onlySummary: true });
    },

    async exportMarkdown(params) {
      return ctx.services.export.exportMarkdown(asObject(params) as unknown as MarkdownExportInput);
    },

    async addToWorkflow(params) {
      const item = await ctx.repo.addWorkflowItem(asObject(params) as unknown as AddWorkflowItemInput);
      // 拉入即自动跑流水线（准备素材 → 爆款拆解），后台推进，UI 轮询阶段。
      void ctx.services.workflow.run(item.id);
      return item;
    },

    async listWorkflowItems() {
      return ctx.repo.listWorkflowItems();
    },

    async retryWorkflowItem(params) {
      const { id } = asObject(params) as unknown as WorkflowItemRef;
      const item = await ctx.repo.getWorkflowItem(id);
      if (!item) throw new SonarException(makeError('PARSE_ERROR', '工作流条目不存在'));
      void ctx.services.workflow.run(id);
      return item;
    },

    async removeWorkflowItem(params) {
      const { id } = asObject(params) as unknown as WorkflowItemRef;
      return ctx.repo.removeWorkflowItem(id);
    },

    async pushWorkflowItem(params) {
      const { id } = asObject(params) as unknown as WorkflowItemRef;
      const item = await ctx.repo.getWorkflowItem(id);
      if (!item) throw new SonarException(makeError('PARSE_ERROR', '工作流条目不存在'));
      // 复用桥：force（忽略开关）+ refresh（命中已有则刷新为待创作）。拆解报告随 payload 一并送出。
      const result = await ctx.bridge.push(item.videoId, { force: true, refresh: true });
      // 已送达或已暂存待补推（离线）均视为「已送二创」；未授权/未配置保持 ready 让用户去修配置。
      if (result.pushed && (result.outcome.status === 'sent' || result.outcome.status === 'queued')) {
        await ctx.repo.setWorkflowStage(id, 'pushed');
      }
      return result;
    },

    async getAiSettings() {
      return toAiSettingsView(await ctx.settings.getAiSettings());
    },

    async updateAiSettings(params) {
      await ctx.settings.updateAiSettings(asObject(params) as unknown as UpdateAiSettingsInput);
      return null;
    },

    async testAiProvider(params) {
      return ctx.services.aiTester.test(asObject(params) as unknown as TestAiProviderInput);
    },

    async getBridgeSettings() {
      return toBridgeSettingsView(await ctx.bridge.settings.get());
    },

    async updateBridgeSettings(params) {
      await ctx.bridge.settings.update(asObject(params) as unknown as UpdateBridgeSettingsInput);
      return null;
    },

    async testBridge() {
      const s = await ctx.bridge.settings.get();
      return ctx.bridge.client.probe(s);
    },

    async pushVideoToBridge(params) {
      // 手动推送：force（忽略开关）+ refresh（命中已有则刷新为待创作）。
      return ctx.bridge.push(requireString(params, 'videoId'), { force: true, refresh: true });
    },

    async autoConnectBridge() {
      // 一键自动配置：从本机 /sonar/pair 拉取 endpoint+token 并保存开启（零输入）。
      const cur = await ctx.bridge.settings.get();
      const r = await ctx.bridge.client.pair(cur.endpoint);
      if (!r.ok || !r.token) {
        return { ok: false, settings: toBridgeSettingsView(cur) };
      }
      await ctx.bridge.settings.update({
        enabled: true,
        endpoint: r.endpoint ?? cur.endpoint,
        token: r.token,
      });
      return { ok: true, settings: toBridgeSettingsView(await ctx.bridge.settings.get()) };
    },
  };
}

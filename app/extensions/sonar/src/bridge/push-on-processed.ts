/**
 * 转录完成 → 推桥的编排（设计文档第 7 节）。
 *
 * 处理队列成功转录某作品后调用：读 settings/video/creator/transcript，组装负载并入队到桥。
 * 桥未启用、作品/转录缺失则静默跳过。纯逻辑（repo/client/settings 注入），可单测。
 */
import type { Creator, TranscriptDocument, Video, ViralInsight } from '@/domain/models';
import type { BridgeClient, BridgeConfig, EnqueueOutcome } from './bridge-client';
import type { BridgeSettingsStore } from './bridge-settings';
import { buildBridgePayload } from './payload-builder';

export interface PushOnProcessedDeps {
  repo: {
    getVideo(id: string): Promise<Video | null>;
    getCreator(id: string): Promise<Creator | null>;
    getTranscript(videoId: string): Promise<TranscriptDocument | null>;
    getInsight(videoId: string): Promise<ViralInsight | null>;
  };
  bridgeSettings: BridgeSettingsStore;
  bridgeClient: Pick<BridgeClient, 'enqueue'>;
}

export interface PushOptions {
  /** 命中已有项时刷新为待创作（手动推送）。 */
  refresh?: boolean;
  /** 忽略「开启联动」开关，只要端点+token 已配置即推送（手动推送）。 */
  force?: boolean;
}

export type PushResult =
  | { pushed: false; reason: 'disabled' | 'no-video' | 'no-payload' }
  | { pushed: true; outcome: EnqueueOutcome };

export function createPushOnProcessed(deps: PushOnProcessedDeps) {
  return async function pushOnProcessed(videoId: string, opts?: PushOptions): Promise<PushResult> {
    const settings = await deps.bridgeSettings.get();
    // 自动路径尊重开关；手动推送（force）只要配置可用即推送。
    const config: BridgeConfig = opts?.force ? { ...settings, enabled: true } : settings;
    if (!config.enabled) return { pushed: false, reason: 'disabled' };

    const video = await deps.repo.getVideo(videoId);
    if (!video) return { pushed: false, reason: 'no-video' };

    const [creator, transcript, insight] = await Promise.all([
      deps.repo.getCreator(video.creatorId),
      deps.repo.getTranscript(videoId),
      deps.repo.getInsight(videoId),
    ]);
    const payload = buildBridgePayload(video, creator, transcript, insight);
    if (!payload) return { pushed: false, reason: 'no-payload' };

    const outcome = await deps.bridgeClient.enqueue(config, payload, { refresh: opts?.refresh });
    return { pushed: true, outcome };
  };
}

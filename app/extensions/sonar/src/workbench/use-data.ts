/** 工作台共享数据层：聚合视频、博主订阅、AI 分析与本地 UI 状态，产出视图模型。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DouyinClient } from '@/client';
import type { Creator, CreatorSubscription, Video, VideoAnalysis } from '@/domain/models';
import type { CollectProgressView } from '@/domain/api-types';
import { SonarException } from '@/domain/errors';
import { formatRelative, initialOf } from '@/ui/format';

export function errText(e: unknown): string {
  return e instanceof SonarException ? e.error.message : String(e);
}

export interface CreatorView {
  id: string;
  nickname: string;
  handle: string;
  group: string;
  initial: string;
  avatarUrl?: string;
  monitoring: boolean;
  intervalMinutes: number;
  lastSync: string;
  videoCount?: number;
  sub: CreatorSubscription;
}

export function describeCollectProgress(
  progress: Pick<CollectProgressView, 'collected' | 'total' | 'done'>,
): string {
  const count = progress.total === undefined ? `${progress.collected} 条` : `${progress.collected}/${progress.total}`;
  if (!progress.done) return `采集中 ${count}`;
  if (progress.total !== undefined && progress.collected < progress.total) {
    return `已采集 ${count}（公开可见）`;
  }
  return `已采集 ${count}`;
}

function handleOf(creator: Creator): string {
  try {
    const seg = new URL(creator.profileUrl).pathname.split('/').filter(Boolean).pop();
    if (seg) return `@${seg}`;
  } catch {
    /* 非法 URL，退回 secUid 片段 */
  }
  return `@${creator.secUid.slice(0, 12)}`;
}

export function toCreatorView(sub: CreatorSubscription, now: number): CreatorView {
  const c = sub.creator;
  return {
    id: c.id,
    nickname: sub.note?.trim() || c.nickname,
    handle: handleOf(c),
    group: sub.group?.trim() || '未分组',
    initial: initialOf(sub.note?.trim() || c.nickname),
    avatarUrl: c.avatarUrl,
    monitoring: !sub.paused,
    intervalMinutes: sub.intervalMinutes,
    lastSync: sub.lastCheckedAt ? formatRelative(sub.lastCheckedAt, now) : '未同步',
    videoCount: c.videoCount,
    sub,
  };
}

export interface WorkbenchData {
  videos: Video[];
  creators: Map<string, CreatorView>;
  creatorList: CreatorView[];
  analyses: Record<string, VideoAnalysis | null>;
  collectProgress: Record<string, CollectProgressView>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  loadAnalysis: (videoId: string) => Promise<VideoAnalysis | null>;
}

export function useWorkbenchData(client: DouyinClient): WorkbenchData {
  const [videos, setVideos] = useState<Video[]>([]);
  const [subs, setSubs] = useState<CreatorSubscription[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, VideoAnalysis | null>>({});
  const [collectProgress, setCollectProgress] = useState<Record<string, CollectProgressView>>({});
  const refreshedCollects = useRef(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = useMemo(() => Date.now(), [videos, subs]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [all, cs] = await Promise.all([
        client.listRecentVideos(),
        client.listFollowedCreators(),
      ]);
      // 只保留监听博主的视频；浏览时顺带采集的其它视频留在仓库供下载，但不进列表（避免"未知博主"噪声）。
      const followed = new Set(cs.map((s) => s.creator.id));
      const vs = all.filter((v) => followed.has(v.creatorId));
      setVideos(vs);
      setSubs(cs);
      // 分析数据单次批量取回再按列表视频过滤，避免逐条 IPC 往返（7000 条时为启动冻结主因）。
      const wanted = new Set(vs.map((v) => v.id));
      const map: Record<string, VideoAnalysis | null> = {};
      for (const a of await client.listAnalyses()) {
        if (wanted.has(a.videoId)) map[a.videoId] = a;
      }
      setAnalyses(map);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (subs.length === 0) return;
    let disposed = false;
    const poll = async (): Promise<void> => {
      const rows = await Promise.all(
        subs.map(async (sub) => [sub.creator.id, await client.getCollectProgress(sub.creator.secUid).catch(() => null)] as const),
      );
      if (disposed) return;
      const next: Record<string, CollectProgressView> = {};
      for (const [creatorId, progress] of rows) {
        if (!progress) continue;
        next[creatorId] = progress;
        const completionKey = `${creatorId}:${progress.updatedAt}`;
        if (progress.done && !refreshedCollects.current.has(completionKey)) {
          refreshedCollects.current.add(completionKey);
          void reload();
        }
      }
      setCollectProgress(next);
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [client, reload, subs]);

  const loadAnalysis = useCallback(
    async (videoId: string) => {
      const a = await client.getAnalysis(videoId);
      setAnalyses((m) => ({ ...m, [videoId]: a }));
      return a;
    },
    [client],
  );

  const creators = useMemo(() => {
    const m = new Map<string, CreatorView>();
    for (const s of subs) m.set(s.creator.id, toCreatorView(s, now));
    return m;
  }, [subs, now]);

  const creatorList = useMemo(() => Array.from(creators.values()), [creators]);

  return useMemo(
    () => ({ videos, creators, creatorList, analyses, collectProgress, loading, error, reload, loadAnalysis }),
    [videos, creators, creatorList, analyses, collectProgress, loading, error, reload, loadAnalysis],
  );
}

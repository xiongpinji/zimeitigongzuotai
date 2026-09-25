/** Popup（380px）：当前页面识别 + 监听/下载、最近新视频（≤3）、打开工作台 / Side Panel。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChromeRuntimeTransport, createDouyinClient } from '@/client';
import type { Creator, DownloadTask, PageDetectionResult, Video } from '@/domain/models';
import { SonarException } from '@/domain/errors';
import { S } from '@/ui/theme';
import { GlobalStyles, Avatar, NewBadge, StanceBadge, Thumb, useHover } from '@/ui/kit';
import { SonarBadge, GearIcon } from '@/ui/icons';
import { useVideoStatus, isNew } from '@/ui/video-status';
import { formatRelative, formatDuration, initialOf } from '@/ui/format';

const DL_LABEL: Record<DownloadTask['status'], string> = {
  queued: '排队中',
  resolving: '解析中',
  downloading: '下载中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function errMsg(e: unknown): string {
  return e instanceof SonarException ? e.error.message : String(e);
}

export function PopupApp() {
  const client = useMemo(() => createDouyinClient(createChromeRuntimeTransport()), []);
  const status = useVideoStatus();
  const [page, setPage] = useState<PageDetectionResult | null>(null);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [followed, setFollowed] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [creatorMap, setCreatorMap] = useState<Map<string, Creator>>(new Map());
  const [analyses, setAnalyses] = useState<Record<string, string | undefined>>({});
  const [task, setTask] = useState<DownloadTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const p = await client.detectCurrentPage();
        setPage(p);
        const [subs, all] = await Promise.all([client.listFollowedCreators(), client.listRecentVideos(80)]);
        const followed = new Set(subs.map((s) => s.creator.id));
        setVideos(all.filter((v) => followed.has(v.creatorId)));
        setCreatorMap(new Map(subs.map((s) => [s.creator.id, s.creator])));
        if (p.type === 'creator' && p.secUid) {
          const c = await client.getCreatorBySecUid(p.secUid);
          setCreator(c);
          setFollowed(!!c && subs.some((s) => s.creator.id === c.id));
        }
      } catch (e) {
        setError(errMsg(e));
      }
    })();
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [client]);

  const newVideos = useMemo(() => videos.filter((v) => isNew(status.map, v.id)).slice(0, 3), [videos, status.map]);
  const newCount = useMemo(() => videos.filter((v) => isNew(status.map, v.id)).length, [videos, status.map]);

  // 新视频列表展示需要类型，懒加载分析里的 category。
  useEffect(() => {
    void Promise.all(
      newVideos.map(async (v) => {
        if (v.id in analyses) return;
        try {
          const a = await client.getAnalysis(v.id);
          setAnalyses((m) => ({ ...m, [v.id]: a?.category }));
        } catch {
          setAnalyses((m) => ({ ...m, [v.id]: undefined }));
        }
      }),
    );
  }, [newVideos, client]);

  const pollTask = useCallback(
    (taskId: string) => {
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        try {
          const t = await client.getDownloadTask(taskId);
          setTask(t);
          if (['completed', 'failed', 'cancelled'].includes(t.status) && poll.current) {
            clearInterval(poll.current);
            poll.current = null;
          }
        } catch {
          /* 尚不可查 */
        }
      }, 700);
    },
    [client],
  );

  const onDownload = useCallback(async () => {
    if (!page?.awemeId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const t = await client.downloadVideo(page.awemeId);
      setTask(t);
      pollTask(t.id);
    } catch (e) {
      setError(
        e instanceof SonarException && e.error.code === 'NO_WATERMARK_SOURCE'
          ? '仅找到带水印版本，请在完整工作台确认后再下载'
          : e instanceof SonarException && e.error.code === 'VIDEO_NOT_FOUND'
            ? '尚未捕获到该作品数据，请刷新视频页后重试'
            : errMsg(e),
      );
    } finally {
      setBusy(false);
    }
  }, [client, page, pollTask]);

  const onFollow = useCallback(async () => {
    if (!creator) {
      setError('尚未采集到博主资料，请刷新博主主页后重试');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.followCreator({ creator, intervalMinutes: 30 });
      setFollowed(true);
      setNote(`已加入监听：${creator.nickname}`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [client, creator]);

  const onSync = useCallback(async () => {
    if (!creator) return;
    setBusy(true);
    try {
      const r = await client.runMonitorOnce(creator.id);
      setNote(r.circuitBroken ? `已暂停：${r.error?.message ?? '需重新登录'}` : `已同步 · 新增 ${r.newVideoIds.length} 条`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [client, creator]);

  const pct = task?.totalBytes && task.receivedBytes ? Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 100)) : null;
  const isVideoPage = page?.type === 'video' || page?.type === 'video_modal';

  return (
    <main style={{ width: 380, background: S.shell, color: S.e8, fontFamily: S.font }}>
      <GlobalStyles />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', background: 'rgba(40,40,43,.9)', borderBottom: '.5px solid rgba(255,255,255,.08)' }}>
        <SonarBadge box={26} radius={8} icon={16} />
        <span style={{ fontSize: 14, fontWeight: 700, color: S.white, flex: 1 }}>灵机采风</span>
        {newCount > 0 && <span style={{ fontSize: 11, color: S.faint, fontFamily: S.mono }}>{newCount} 新</span>}
        <IconBtn onClick={() => chrome.runtime.openOptionsPage?.()} title="设置">
          <GearIcon size={15} color={S.cf} />
        </IconBtn>
      </div>

      {/* 当前页面卡 / 下载进度 */}
      {task && (task.status === 'downloading' || task.status === 'resolving' || task.status === 'queued') ? (
        <div style={{ margin: 12, padding: 12, background: 'rgba(10,132,255,.1)', border: '.5px solid rgba(10,132,255,.28)', borderRadius: 11 }}>
          <div style={{ fontSize: 13, color: S.f0 }}>下载原片 · {DL_LABEL[task.status]}{pct !== null ? ` · ${pct}%` : ''}</div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.12)', marginTop: 9, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct ?? 8}%`, background: S.accent }} />
          </div>
          <div style={{ fontSize: 11, color: S.faint, marginTop: 8 }}>关闭弹窗不会取消下载，任务在后台继续。</div>
        </div>
      ) : (
        <div style={{ margin: 12, padding: 12, background: 'rgba(10,132,255,.1)', border: '.5px solid rgba(10,132,255,.28)', borderRadius: 11 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#5e9eea', letterSpacing: '.4px' }}>
            当前页面 · {labelOf(page)}
          </div>
          {page?.type === 'creator' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 8 }}>
              <Avatar seed={creator?.id ?? page.secUid ?? 'c'} initial={initialOf(creator?.nickname)} url={creator?.avatarUrl} size={38} radius={11} fontSize={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: S.f0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{creator?.nickname ?? '抖音博主'}</div>
                {followed && <div style={{ fontSize: 11, color: S.green, marginTop: 2 }}>● 监听中</div>}
              </div>
              {followed ? (
                <PillBtn onClick={onSync} disabled={busy}>立即同步</PillBtn>
              ) : (
                <PillBtn onClick={onFollow} disabled={busy} primary>
                  <span style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>＋</span> 监听
                </PillBtn>
              )}
            </div>
          )}
          {isVideoPage && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: S.f0 }}>抖音作品</div>
              <div style={{ fontSize: 11, color: S.faint, marginTop: 2, fontFamily: S.mono }}>{page?.awemeId}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <PillBtn onClick={onDownload} disabled={busy} primary fill>{busy ? '处理中…' : '下载原片'}</PillBtn>
                <PillBtn onClick={async () => { if (!page?.awemeId) return; setBusy(true); try { await client.processVideo(page.awemeId); setNote('已入库并分析'); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }} disabled={busy} fill>入库并分析</PillBtn>
              </div>
            </div>
          )}
          {page && page.type !== 'creator' && !isVideoPage && (
            <div style={{ fontSize: 12, color: S.faint, marginTop: 8, lineHeight: 1.6 }}>
              当前不是抖音博主页或视频页。打开博主主页可加入监听，或在工作台粘贴链接入库。
            </div>
          )}
        </div>
      )}

      {/* 新视频 */}
      <div style={{ padding: '2px 12px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.faint, letterSpacing: '.4px', textTransform: 'uppercase' }}>新视频</span>
        {newCount > 0 && (
          <span style={{ fontSize: 11, color: '#fff', background: S.accent, minWidth: 17, height: 17, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: S.mono, padding: '0 5px' }}>{newCount}</span>
        )}
        <span style={{ flex: 1, height: '.5px', background: 'rgba(255,255,255,.07)' }} />
      </div>
      <div style={{ maxHeight: 226, overflowY: 'auto', padding: '0 8px 8px' }}>
        {newVideos.length === 0 ? (
          <div style={{ padding: '14px 10px', fontSize: 12, color: S.faint, lineHeight: 1.6 }}>暂无新视频。打开「同步全部」或浏览博主主页即可发现新作品。</div>
        ) : (
          newVideos.map((v) => <NewVideoRow key={v.id} video={v} author={creatorMap.get(v.creatorId)?.nickname ?? '未知博主'} category={analyses[v.id]} />)
        )}
      </div>

      {note && <div style={{ fontSize: 12, color: S.green, padding: '0 14px 10px' }}>{note}</div>}
      {error && <div style={{ fontSize: 12, color: S.orange, padding: '0 14px 10px', lineHeight: 1.5 }}>{error}</div>}

      {/* Footer */}
      <div style={{ padding: '10px 12px', borderTop: '.5px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <FooterBtn onClick={() => chrome.runtime.openOptionsPage?.()}>打开完整工作台 <span style={{ fontSize: 13 }}>↗</span></FooterBtn>
        <FooterBtn square title="打开 Side Panel" onClick={openSidePanel}>⤢</FooterBtn>
      </div>
    </main>
  );
}

function labelOf(page: PageDetectionResult | null): string {
  if (!page) return '识别中…';
  return { video: '视频页', creator: '抖音主页', video_modal: '作品弹层', share_link: '分享链接', unsupported: '非抖音页面' }[page.type];
}

async function openSidePanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId !== undefined) await chrome.sidePanel?.open({ windowId: tab.windowId });
  } catch {
    /* 需用户手势/不支持时忽略 */
  }
}

function NewVideoRow({ video, author, category }: { video: Video; author: string; category?: string }) {
  const [h, bind] = useHover();
  return (
    <div {...bind} style={{ display: 'flex', gap: 10, padding: 8, borderRadius: 9, alignItems: 'flex-start', background: h ? 'rgba(255,255,255,.045)' : 'transparent' }}>
      <Thumb seed={video.id} url={video.coverUrl} duration={formatDuration(video.durationMs)} width={60} height={40} radius={6} stripe={6} play={0} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <NewBadge style={{ fontSize: 8, padding: '1px 4px' }} />
          <span style={{ fontSize: 11, color: S.mute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{author} · {formatRelative(video.publishedAt)}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, color: S.e2, lineHeight: 1.4, marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{video.description || '（无标题）'}</div>
        <div style={{ marginTop: 5 }}>
          <StanceBadge category={category} style={{ fontSize: 9 }} />
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  const [h, bind] = useHover();
  return (
    <button onClick={onClick} title={title} {...bind} style={{ width: 26, height: 26, borderRadius: 7, background: h ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.07)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </button>
  );
}

function PillBtn({ children, onClick, disabled, primary, fill }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; fill?: boolean }) {
  const [h, bind] = useHover();
  return (
    <button onClick={onClick} disabled={disabled} {...bind} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 30, padding: '0 13px', flex: fill ? 1 : undefined, background: primary ? S.accent : 'rgba(255,255,255,.07)', color: primary ? '#fff' : S.cf, border: primary ? 'none' : '.5px solid rgba(255,255,255,.09)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, filter: h && !disabled ? 'brightness(1.1)' : undefined, whiteSpace: 'nowrap' }}>
      {children}
    </button>
  );
}

function FooterBtn({ children, onClick, square, title }: { children: React.ReactNode; onClick: () => void; square?: boolean; title?: string }) {
  const [h, bind] = useHover();
  return (
    <button onClick={onClick} title={title} {...bind} style={{ height: 34, width: square ? 34 : undefined, flex: square ? undefined : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: h ? 'rgba(255,255,255,.11)' : 'rgba(255,255,255,.07)', color: square ? S.cf : S.e8, border: '.5px solid rgba(255,255,255,.09)', borderRadius: 9, fontSize: square ? 14 : 12.5, fontWeight: 500, cursor: 'pointer' }}>
      {children}
    </button>
  );
}

/** Side Panel（360px）：动态流/视频库分段、上下文状态栏、竖向卡片、底部链接入库。 */
import { useEffect, useMemo, useState } from 'react';
import { useClient } from '@/ui/useClient';
import type { Creator, Video } from '@/domain/models';
import { SonarException } from '@/domain/errors';
import { S } from '@/ui/theme';
import { GlobalStyles, Avatar, StanceBadge, Thumb, Toast, useToast, useHover } from '@/ui/kit';
import { SonarBadge } from '@/ui/icons';
import { useVideoStatus, isNew, statusOf } from '@/ui/video-status';
import { formatCount, formatDuration, formatRelative } from '@/ui/format';

function errMsg(e: unknown): string {
  return e instanceof SonarException ? e.error.message : String(e);
}

export function SidePanel() {
  const client = useClient();
  const status = useVideoStatus();
  const { toast, show } = useToast();
  const [videos, setVideos] = useState<Video[]>([]);
  const [creators, setCreators] = useState<Map<string, Creator>>(new Map());
  const [analyses, setAnalyses] = useState<Record<string, string | undefined>>({});
  const [site, setSite] = useState<string>('');
  const [monitorCount, setMonitorCount] = useState(0);
  const [tab, setTab] = useState<'feed' | 'library'>('feed');
  const [link, setLink] = useState('');

  const load = async () => {
    try {
      const [all, subs, page] = await Promise.all([
        client.listRecentVideos(120),
        client.listFollowedCreators(),
        client.detectCurrentPage().catch(() => null),
      ]);
      const followed = new Set(subs.map((s) => s.creator.id));
      const vs = all.filter((v) => followed.has(v.creatorId));
      setVideos(vs);
      setCreators(new Map(subs.map((s) => [s.creator.id, s.creator])));
      setMonitorCount(subs.filter((s) => !s.paused).length);
      if (page) {
        try {
          setSite(new URL(page.url).hostname);
        } catch {
          setSite('');
        }
      }
      const entries = await Promise.all(
        vs.slice(0, 30).map(async (v) => {
          try {
            return [v.id, (await client.getAnalysis(v.id))?.category] as const;
          } catch {
            return [v.id, undefined] as const;
          }
        }),
      );
      setAnalyses(Object.fromEntries(entries));
    } catch (e) {
      show(errMsg(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const list = useMemo(() => {
    const base = [...videos];
    if (tab === 'feed') base.sort((a, b) => Number(isNew(status.map, b.id)) - Number(isNew(status.map, a.id)) || b.publishedAt - a.publishedAt);
    else base.sort((a, b) => b.publishedAt - a.publishedAt);
    return base;
  }, [videos, tab, status.map]);

  const importLink = async () => {
    if (!link.trim()) return;
    show('解析中…');
    try {
      const r = await client.resolveVideo({ pageUrl: link.trim(), shareUrl: link.trim() });
      show(`已入库：${r.video.description || r.video.id}`);
      setLink('');
      await load();
    } catch (e) {
      show(errMsg(e));
    }
  };

  return (
    <div style={{ height: '100vh', background: S.shell, color: S.e8, fontFamily: S.font, display: 'flex', flexDirection: 'column' }}>
      <GlobalStyles />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', background: 'rgba(40,40,43,.9)', borderBottom: '.5px solid rgba(255,255,255,.08)' }}>
        <SonarBadge box={24} radius={7} icon={15} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: S.white, flex: 1 }}>灵机采风 · 动态</span>
        <SmallIcon onClick={() => void load()} title="刷新">↻</SmallIcon>
        <SmallIcon onClick={() => window.close()} title="关闭">✕</SmallIcon>
      </div>

      {/* Segmented */}
      <div style={{ display: 'flex', gap: 4, margin: '11px 12px 0', background: 'rgba(255,255,255,.06)', borderRadius: 8, padding: 3 }}>
        {(['feed', 'library'] as const).map((t) => {
          const on = tab === t;
          return (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer', background: on ? S.accent : 'transparent', color: on ? '#fff' : S.mute, fontSize: 12.5, fontWeight: on ? 600 : 500 }}>
              {t === 'feed' ? '动态流' : '视频库'}
            </button>
          );
        })}
      </div>

      {/* Context */}
      <div style={{ margin: '11px 12px 4px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: S.faint }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: S.green }} />
        <span>{site ? `正在浏览 ${site}` : '未在抖音页面'} · 监听 {monitorCount} 位博主</span>
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {list.length === 0 ? (
          <div style={{ padding: '24px 8px', fontSize: 12.5, color: S.faint, lineHeight: 1.7 }}>暂无视频。在抖音页面打开视频或博主主页即可入库，或在下方粘贴链接。</div>
        ) : (
          list.map((v) => (
            <Card
              key={v.id}
              video={v}
              isNew={isNew(status.map, v.id)}
              flagged={statusOf(status.map, v.id).flagged}
              author={creators.get(v.creatorId)?.nickname ?? '未知博主'}
              authorSeed={v.creatorId}
              authorInitial={(creators.get(v.creatorId)?.nickname ?? '?').charAt(0)}
              category={analyses[v.id]}
              onOpen={() => chrome.runtime.openOptionsPage?.()}
              onDownload={async () => { try { await client.downloadVideo(v.id); show('已开始下载'); } catch (e) { show(errMsg(e)); } }}
              onAnalyze={async () => { try { await client.processVideo(v.id); show('已入队分析'); } catch (e) { show(errMsg(e)); } }}
              onFlag={() => { status.toggleFlag(v.id); show(statusOf(status.map, v.id).flagged ? '已取消标记' : '已标记重点'); }}
            />
          ))
        )}
      </div>

      {/* Bottom link bar */}
      <div style={{ padding: '10px 12px', borderTop: '.5px solid rgba(255,255,255,.08)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && importLink()}
          placeholder="粘贴视频链接快速入库…"
          style={{ flex: 1, height: 34, background: S.inputBg, border: '.5px solid rgba(255,255,255,.12)', borderRadius: 9, padding: '0 11px', fontSize: 12, color: S.e2, outline: 'none', boxSizing: 'border-box' }}
        />
        <button onClick={importLink} style={{ width: 34, height: 34, background: S.accent, color: '#fff', border: 'none', fontSize: 17, borderRadius: 9, cursor: 'pointer' }}>＋</button>
      </div>
      <Toast text={toast} />
    </div>
  );
}

function Card({
  video,
  isNew: isNewFlag,
  flagged,
  author,
  authorSeed,
  authorInitial,
  category,
  onOpen,
  onDownload,
  onAnalyze,
  onFlag,
}: {
  video: Video;
  isNew: boolean;
  flagged: boolean;
  author: string;
  authorSeed: string;
  authorInitial: string;
  category?: string;
  onOpen: () => void;
  onDownload: () => void;
  onAnalyze: () => void;
  onFlag: () => void;
}) {
  const [h, bind] = useHover();
  const stats = video.statistics ?? {};
  return (
    <div {...bind} style={{ background: S.card, border: '.5px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ cursor: 'pointer' }} onClick={onOpen}>
        <Thumb seed={video.id} url={video.coverUrl} duration={formatDuration(video.durationMs)} stripe={8} play={34} tri={11}>
          {isNewFlag && <span style={{ position: 'absolute', left: 8, top: 7, fontSize: 9, fontWeight: 700, color: '#fff', background: S.accent, padding: '2px 6px', borderRadius: 4 }}>NEW</span>}
          {flagged && <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 11, color: S.yellow }}>★</span>}
        </Thumb>
      </div>
      <div style={{ padding: '11px 12px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
          <Avatar seed={authorSeed} initial={authorInitial} size={18} radius={5} fontSize={9} />
          <span style={{ fontSize: 11, color: S.dim }}>{author} · {formatRelative(video.publishedAt)}</span>
        </div>
        <div onClick={onOpen} style={{ fontSize: 13, fontWeight: 500, color: S.e8, lineHeight: 1.45, cursor: 'pointer', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{video.description || '（无标题）'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: S.faint2, fontFamily: S.mono, marginTop: 9 }}>
          <span>♥ {formatCount(stats.likeCount)}</span>
          <span>💬 {formatCount(stats.commentCount)}</span>
          <StanceBadge category={category} style={{ marginLeft: 'auto' }} />
        </div>
        {h && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <MiniBtn onClick={onDownload}>下载</MiniBtn>
            <MiniBtn onClick={onAnalyze}>分析</MiniBtn>
            <MiniBtn onClick={onFlag} active={flagged}>{flagged ? '★ 已标记' : '★ 重点'}</MiniBtn>
          </div>
        )}
      </div>
    </div>
  );
}

function SmallIcon({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  const [h, bind] = useHover();
  return (
    <button onClick={onClick} title={title} {...bind} style={{ width: 24, height: 24, borderRadius: 6, background: h ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.07)', border: 'none', color: S.cf, fontSize: 12, cursor: 'pointer' }}>{children}</button>
  );
}

function MiniBtn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  const [h, bind] = useHover();
  return (
    <button onClick={onClick} {...bind} style={{ flex: 1, height: 28, borderRadius: 7, border: '.5px solid rgba(255,255,255,.09)', background: active ? 'rgba(255,214,10,.14)' : h ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.05)', color: active ? S.yellow : S.cf, fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}>{children}</button>
  );
}

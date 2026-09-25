/** 动态流：左侧视频列表（最新 / 最热）+ 右侧详情。 */
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { DouyinClient } from '@/client';
import type { Video } from '@/domain/models';
import { sonarErrorText } from '@/domain/errors';
import { S } from '@/ui/theme';
import { NewBadge, StanceBadge, Thumb, useHover } from '@/ui/kit';
import { formatCount, formatDuration, formatRelative } from '@/ui/format';
import type { VideoStatusApi } from '@/ui/video-status';
import { isNew, statusOf } from '@/ui/video-status';
import type { WorkbenchData } from './use-data';
import type { ProcessingApi } from './use-processing';
import { VideoDetail } from './VideoDetail';

export type Sort = 'time' | 'hot';

export function filterVideosByCreators(videos: Video[], creatorIds: readonly string[]): Video[] {
  if (creatorIds.length === 0) return videos;
  const selected = new Set(creatorIds);
  return videos.filter((video) => selected.has(video.creatorId));
}

export function Feed({
  client,
  data,
  status,
  processing,
  creatorIds,
  onCreatorIdsChange,
  selVid,
  onSelect,
  sort,
  onSort,
  show,
  onNavigateSettings,
}: {
  client: DouyinClient;
  data: WorkbenchData;
  status: VideoStatusApi;
  processing: ProcessingApi;
  creatorIds: string[];
  onCreatorIdsChange: (ids: string[]) => void;
  selVid: string | null;
  onSelect: (id: string) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  show: (t: string) => void;
  onNavigateSettings: () => void;
}) {
  const feedVideos = useMemo(() => {
    let vs = filterVideosByCreators(data.videos, creatorIds);
    vs = [...vs].sort((a, b) =>
      sort === 'hot'
        ? (b.statistics?.likeCount ?? 0) - (a.statistics?.likeCount ?? 0)
        : b.publishedAt - a.publishedAt,
    );
    return vs;
  }, [data.videos, creatorIds, sort]);

  const creator = creatorIds.length === 1 ? data.creators.get(creatorIds[0]) : undefined;
  const listTitle = creator ? creator.nickname : creatorIds.length > 1 ? `${creatorIds.length} 位博主动态` : '全部动态';
  const unreadCount = feedVideos.filter((video) => !statusOf(status.map, video.id).read).length;
  const listSub = `${feedVideos.length} 条动态 · ${unreadCount} 条未读`;

  const selected = selVid ? data.videos.find((v) => v.id === selVid) : undefined;

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
      {/* 列表栏 */}
      <div style={{ width: 372, flex: 'none', borderRight: '.5px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', background: S.feedList, minHeight: 0 }}>
        <div style={{ padding: '14px 16px 10px', display: 'flex', flexDirection: 'column', gap: 9, flex: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: S.white }}>{listTitle}</div>
              <div style={{ fontSize: 11.5, color: S.faint, marginTop: 2 }}>{listSub}</div>
            </div>
            <button
              type="button"
              disabled={unreadCount === 0}
              onClick={() => status.markAllRead(feedVideos.map((video) => video.id))}
              style={{ border: 'none', background: 'transparent', color: unreadCount > 0 ? S.accent : S.faint4, fontSize: 11.5, cursor: unreadCount > 0 ? 'pointer' : 'default', padding: '4px 0' }}
            >
              全部已读
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CreatorFilter creators={data.creatorList} selectedIds={creatorIds} onChange={onCreatorIdsChange} />
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.06)', borderRadius: 7, padding: 2 }}>
              {(['time', 'hot'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => onSort(k)}
                  style={{ fontSize: 11.5, fontWeight: 500, padding: '4px 11px', borderRadius: 6, border: 'none', cursor: 'pointer', color: sort === k ? '#f0f0f2' : S.mute, background: sort === k ? 'rgba(255,255,255,.1)' : 'transparent' }}
                >
                  {k === 'time' ? '最新' : '最热'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '2px 10px 12px' }}>
          {feedVideos.length === 0 && (
            <div style={{ padding: '40px 18px', textAlign: 'center', color: S.faint, fontSize: 13, lineHeight: 1.7 }}>
              {data.loading
                ? '加载中…'
                : data.creatorList.length === 0
                  ? '还没有监听任何博主。去抖音博主主页点扩展「加入灵机采风监听」，或点右上「添加」。'
                  : '监听的博主暂无新视频。点顶部「同步全部」检查更新。'}
            </div>
          )}
          {feedVideos.map((v) => (
            <Row
              key={v.id}
              video={v}
              selected={v.id === selVid}
              isNew={isNew(status.map, v.id)}
              read={statusOf(status.map, v.id).read}
              creatorName={data.creators.get(v.creatorId)?.nickname ?? '未知博主'}
              category={data.analyses[v.id]?.category}
              onClick={() => onSelect(v.id)}
              onToggleRead={() => status.toggleRead(v.id)}
            />
          ))}
          <div style={{ height: 8 }} />
        </div>
      </div>

      {/* 详情栏 */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: S.shell }}>
        {selected ? (
          <VideoDetail
            client={client}
            video={selected}
            creator={data.creators.get(selected.creatorId)}
            analysis={data.analyses[selected.id] ?? null}
            flagged={statusOf(status.map, selected.id).flagged}
            onToggleFlag={() => status.toggleFlag(selected.id)}
            show={show}
            onAnalysisChange={data.loadAnalysis}
            onProcess={processing.track}
            processingStage={processing.map[selected.id]?.stage}
            processingError={sonarErrorText(processing.map[selected.id]?.error)}
            onNavigateSettings={onNavigateSettings}
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.faint, fontSize: 13 }}>
            从左侧选择一条视频查看详情
          </div>
        )}
      </div>
    </div>
  );
}

const rowBase: CSSProperties = {
  display: 'flex',
  gap: 11,
  padding: '9px 10px',
  borderRadius: 10,
  cursor: 'pointer',
  marginBottom: 3,
  alignItems: 'flex-start',
};

function Row({
  video,
  selected,
  isNew: isNewFlag,
  read,
  creatorName,
  category,
  onClick,
  onToggleRead,
}: {
  video: Video;
  selected: boolean;
  isNew: boolean;
  read: boolean;
  creatorName: string;
  category?: string;
  onClick: () => void;
  onToggleRead: () => void;
}) {
  const [h, bind] = useHover();
  const style: CSSProperties = {
    ...rowBase,
    background: selected ? S.accentTint : h ? 'rgba(255,255,255,.045)' : 'transparent',
    boxShadow: selected ? `inset 0 0 0 .5px ${S.accentLine}` : 'none',
  };
  const stats = video.statistics ?? {};
  return (
    <div style={style} onClick={onClick} {...bind}>
      <Thumb
        seed={video.id}
        url={video.coverUrl}
        duration={formatDuration(video.durationMs)}
        width={74}
        height={48}
        stripe={6}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isNewFlag && <NewBadge />}
          <span style={{ fontSize: 11.5, color: S.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{creatorName}</span>
          <span style={{ fontSize: 11, color: S.faint3, flex: 'none' }}>· {formatRelative(video.publishedAt)}</span>
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.4,
            color: selected ? '#fff' : S.e2,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {video.description || '（无标题）'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, fontSize: 11, color: S.faint2, fontFamily: S.mono }}>
          <span>♥ {formatCount(stats.likeCount)}</span>
          <span>💬 {formatCount(stats.commentCount)}</span>
          <StanceBadge category={category} />
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onToggleRead(); }}
            title={read ? '标记为未读' : '标记为已读'}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', padding: '1px 0 1px 5px', color: read ? S.faint2 : S.accent, fontSize: 10.5, fontFamily: S.font, cursor: 'pointer' }}
          >
            {read ? '已读' : '● 未读'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreatorFilter({ creators, selectedIds, onChange }: {
  creators: WorkbenchData['creatorList'];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  };
  const label = selectedIds.length === 0 ? '全部博主' : `已选 ${selectedIds.length} 位`;

  return (
    <details style={{ position: 'relative' }}>
      <summary style={{ listStyle: 'none', cursor: 'pointer', border: '.5px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.06)', color: S.e2, borderRadius: 7, padding: '5px 9px', fontSize: 11.5, userSelect: 'none' }}>
        {label} ⌄
      </summary>
      <div style={{ position: 'absolute', zIndex: 20, top: 31, left: 0, width: 210, maxHeight: 260, overflowY: 'auto', padding: 6, borderRadius: 9, border: '.5px solid rgba(255,255,255,.12)', background: '#29292c', boxShadow: '0 12px 32px rgba(0,0,0,.42)' }}>
        <button type="button" onClick={() => onChange([])} style={filterOptionStyle(selectedIds.length === 0)}>
          <span>{selectedIds.length === 0 ? '✓' : ''}</span><span>全部博主</span>
        </button>
        {creators.map((creator) => {
          const checked = selectedIds.includes(creator.id);
          return (
            <button key={creator.id} type="button" onClick={() => toggle(creator.id)} style={filterOptionStyle(checked)}>
              <span>{checked ? '✓' : ''}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creator.nickname}</span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

function filterOptionStyle(active: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '16px minmax(0, 1fr)',
    alignItems: 'center',
    gap: 7,
    width: '100%',
    padding: '7px 8px',
    border: 'none',
    borderRadius: 6,
    background: active ? S.accentTint : 'transparent',
    color: active ? S.white : S.c4,
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
  };
}

/** 视频库：3 列网格 + 全部/未读/重点/已归档/处理中/失败 筛选 + 全局搜索过滤。 */
import { memo, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Video } from '@/domain/models';
import { S } from '@/ui/theme';
import { Avatar, StanceBadge, Thumb, useHover } from '@/ui/kit';
import { formatCount, formatDuration, formatRelative } from '@/ui/format';
import type { VideoStatusApi } from '@/ui/video-status';
import { statusOf, isNew } from '@/ui/video-status';
import type { WorkbenchData } from './use-data';
import type { ProcessingApi } from './use-processing';
import { isProcessingActive } from './use-processing';

type LibFilter = 'all' | 'new' | 'flag' | 'archive' | 'processing' | 'failed';
const FILTERS: Array<{ key: LibFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '未读' },
  { key: 'flag', label: '重点' },
  { key: 'archive', label: '已归档' },
  { key: 'processing', label: '处理中' },
  { key: 'failed', label: '失败' },
];

export function Library({
  data,
  status,
  processing,
  query,
  filter,
  onFilter,
  onSelect,
}: {
  data: WorkbenchData;
  status: VideoStatusApi;
  processing: ProcessingApi;
  query: string;
  filter: LibFilter;
  onFilter: (f: LibFilter) => void;
  onSelect: (id: string) => void;
}) {
  const COLS = 3;
  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    return data.videos.filter((v) => {
      const st = statusOf(status.map, v.id);
      const stage = processing.map[v.id]?.stage;
      if (filter === 'new' && !isNew(status.map, v.id)) return false;
      if (filter === 'flag' && !st.flagged) return false;
      if (filter === 'archive' && !st.archived) return false;
      if (filter === 'processing' && !isProcessingActive(stage)) return false;
      if (filter === 'failed' && stage !== 'failed') return false;
      if (q) {
        const a = data.analyses[v.id];
        const hay = [
          v.description,
          data.creators.get(v.creatorId)?.nickname ?? '',
          a?.summary ?? '',
          (a?.tags ?? []).join(' '),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, status.map, processing.map, filter, q]);

  // 行虚拟化：把列表切成每行 COLS 张卡，只挂载视口内的行（7000 条时杜绝一次性渲染与封面洪峰）。
  const rows = useMemo(() => {
    const out: Video[][] = [];
    for (let i = 0; i < list.length; i += COLS) out.push(list.slice(i, i + COLS));
    return out;
  }, [list]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 312,
    overscan: 4,
  });

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: S.shell }}>
      <div style={{ maxWidth: 1080, width: '100%', margin: '0 auto', padding: '22px 32px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 21, fontWeight: 700, color: S.white, letterSpacing: '-.2px' }}>视频库</div>
            <div style={{ fontSize: 12.5, color: S.faint, marginTop: 3 }}>
              已归档 {data.videos.length} 条视频 · 可检索、标记、导出
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => onFilter(f.key)}
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    padding: '6px 13px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: on ? '.5px solid transparent' : '.5px solid rgba(255,255,255,.09)',
                    color: on ? '#fff' : S.dim,
                    background: on ? S.accent : 'rgba(255,255,255,.05)',
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
        {list.length === 0 ? (
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: '60px 32px', textAlign: 'center', color: S.faint, fontSize: 13, lineHeight: 1.8 }}>
            {q ? '没有匹配的视频。' : '视频库为空。监听博主后，其作品会在这里归档；也可在「添加」里粘贴视频链接入库。'}
          </div>
        ) : (
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: '8px 32px 60px' }}>
            <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((vr) => {
                const row = rows[vr.index];
                return (
                  <div
                    key={vr.key}
                    data-index={vr.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vr.start}px)`, paddingBottom: 16 }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
                      {row.map((v) => (
                        <Card
                          key={v.id}
                          video={v}
                          isNew={isNew(status.map, v.id)}
                          flagged={statusOf(status.map, v.id).flagged}
                          creatorName={data.creators.get(v.creatorId)?.nickname ?? '未知博主'}
                          creatorSeed={v.creatorId}
                          creatorInitial={(data.creators.get(v.creatorId)?.initial) ?? '?'}
                          category={data.analyses[v.id]?.category}
                          onSelect={onSelect}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const cardBase: CSSProperties = {
  background: S.card,
  border: '.5px solid rgba(255,255,255,.07)',
  borderRadius: 13,
  overflow: 'hidden',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
};

const Card = memo(function Card({
  video,
  isNew: isNewFlag,
  flagged,
  creatorName,
  creatorSeed,
  creatorInitial,
  category,
  onSelect,
}: {
  video: Video;
  isNew: boolean;
  flagged: boolean;
  creatorName: string;
  creatorSeed: string;
  creatorInitial: string;
  category?: string;
  onSelect: (id: string) => void;
}) {
  const [h, bind] = useHover();
  const stats = video.statistics ?? {};
  return (
    <div
      onClick={() => onSelect(video.id)}
      {...bind}
      style={{
        ...cardBase,
        borderColor: h ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.07)',
        transform: h ? 'translateY(-2px)' : 'none',
        transition: 'transform .15s, border-color .15s',
      }}
    >
      <Thumb seed={video.id} url={video.coverUrl} duration={formatDuration(video.durationMs)} stripe={8} play={38} tri={13}>
        {isNewFlag && (
          <span style={{ position: 'absolute', left: 8, top: 7, fontSize: 9, fontWeight: 700, color: '#fff', background: S.accent, padding: '2px 6px', borderRadius: 4 }}>
            NEW
          </span>
        )}
        {flagged && <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 11, color: S.yellow }}>★</span>}
      </Thumb>
      <div style={{ padding: '12px 13px 14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
          <Avatar seed={creatorSeed} initial={creatorInitial} size={20} radius={6} fontSize={10} />
          <span style={{ fontSize: 11.5, color: S.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{creatorName}</span>
          <span style={{ fontSize: 10.5, color: S.faint3, flex: 'none' }}>· {formatRelative(video.publishedAt)}</span>
        </div>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            lineHeight: 1.45,
            color: S.e8,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {video.description || '（无标题）'}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: S.faint2, fontFamily: S.mono, marginTop: 11 }}>
          <span>♥ {formatCount(stats.likeCount)}</span>
          <span>💬 {formatCount(stats.commentCount)}</span>
          <StanceBadge category={category} style={{ marginLeft: 'auto' }} />
        </div>
      </div>
    </div>
  );
});

export type { LibFilter };

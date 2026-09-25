/** 博主管理：2 列卡片，监听开关、立即同步、视频/未读/上次同步统计、移除。 */
import { useState } from 'react';
import type { DouyinClient } from '@/client';
import { S } from '@/ui/theme';
import { Avatar, Hover, useHover } from '@/ui/kit';
import type { VideoStatusApi } from '@/ui/video-status';
import { isNew } from '@/ui/video-status';
import type { CreatorView, WorkbenchData } from './use-data';
import { describeCollectProgress, errText } from './use-data';

export function Bloggers({
  client,
  data,
  status,
  onAdd,
  show,
}: {
  client: DouyinClient;
  data: WorkbenchData;
  status: VideoStatusApi;
  onAdd: () => void;
  show: (t: string) => void;
}) {
  const [syncing, setSyncing] = useState<string | null>(null);
  // 暂停/恢复目前为本地乐观态：领域协议尚无 setPaused 方法（见交付说明）。
  const [pausedLocal, setPausedLocal] = useState<Record<string, boolean>>({});

  const sync = async (c: CreatorView) => {
    if (syncing) return;
    setSyncing(c.id);
    try {
      const r = await client.runMonitorOnce(c.id);
      show(r.circuitBroken ? `已暂停监控：${r.error?.message ?? '需重新登录抖音'}` : `${c.nickname} 新增 ${r.newVideoIds.length} 条`);
      await data.reload();
    } catch (e) {
      show(errText(e));
    } finally {
      setSyncing(null);
    }
  };

  const monitoringOf = (c: CreatorView) => (c.id in pausedLocal ? !pausedLocal[c.id] : c.monitoring);

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: S.shell }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '22px 32px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 21, fontWeight: 700, color: S.white, letterSpacing: '-.2px' }}>博主管理</div>
            <div style={{ fontSize: 12.5, color: S.faint, marginTop: 3 }}>
              {data.creatorList.length} 位监听对象 · 控制同步、分组与状态
            </div>
          </div>
          <Hover
            base={{ display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 15px', background: S.accent, color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            hover={{ filter: 'brightness(1.1)' }}
            onClick={onAdd}
          >
            <span style={{ fontSize: 16 }}>＋</span> 添加博主
          </Hover>
        </div>

        {data.creatorList.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: S.faint, fontSize: 13, lineHeight: 1.8 }}>
            还没有监听博主。在抖音博主主页点扩展图标「加入灵机采风监听」，或点右上「添加博主」。
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
            {data.creatorList.map((c) => {
              const monitoring = monitoringOf(c);
              const videoCount = data.videos.filter((v) => v.creatorId === c.id).length;
              const newCount = data.videos.filter((v) => v.creatorId === c.id && isNew(status.map, v.id)).length;
              return (
                <CreatorCard
                  key={c.id}
                  creator={c}
                  monitoring={monitoring}
                  videoCount={videoCount}
                  newCount={newCount}
                  collectText={data.collectProgress[c.id] ? describeCollectProgress(data.collectProgress[c.id]) : null}
                  syncing={syncing === c.id}
                  onToggle={() => {
                    setPausedLocal((m) => ({ ...m, [c.id]: monitoring }));
                    show(monitoring ? `已暂停监听 ${c.nickname}` : `已开启监听 ${c.nickname}`);
                  }}
                  onSync={() => sync(c)}
                  onRemove={async () => {
                    try {
                      await client.unfollowCreator(c.id);
                      show(`已移除 ${c.nickname}`);
                      await data.reload();
                    } catch (e) {
                      show(errText(e));
                    }
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CreatorCard({
  creator: c,
  monitoring,
  videoCount,
  newCount,
  collectText,
  syncing,
  onToggle,
  onSync,
  onRemove,
}: {
  creator: CreatorView;
  monitoring: boolean;
  videoCount: number;
  newCount: number;
  collectText: string | null;
  syncing: boolean;
  onToggle: () => void;
  onSync: () => void;
  onRemove: () => void;
}) {
  const [cardHover, cardBind] = useHover();
  const [syncHover, syncBind] = useHover();
  return (
    <div style={{ background: S.card, border: '.5px solid rgba(255,255,255,.07)', borderRadius: 14, padding: '17px 18px', position: 'relative' }} {...cardBind}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <div style={{ position: 'relative' }}>
          <Avatar seed={c.id} initial={c.initial} url={c.avatarUrl} size={46} radius={13} fontSize={19} />
          <span style={{ position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: '50%', border: '2.5px solid #232325', background: monitoring ? S.green : S.graydot }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: S.f0 }}>{c.nickname}</span>
            <span style={{ fontSize: 10.5, color: S.dim, background: 'rgba(255,255,255,.07)', padding: '2px 8px', borderRadius: 6 }}>{c.group}</span>
          </div>
          <div style={{ fontSize: 11.5, color: S.faint, fontFamily: S.mono, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.handle}</div>
        </div>
        {/* 移除按钮与开关同处右侧一行：移除常占位、悬停淡入，避免与开关重叠或悬停时布局抖动。 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
          <button
            onClick={onRemove}
            title="移除博主"
            style={{ opacity: cardHover ? 1 : 0, pointerEvents: cardHover ? 'auto' : 'none', transition: 'opacity .15s', fontSize: 11, color: S.mute, background: 'rgba(255,255,255,.06)', border: '.5px solid rgba(255,255,255,.09)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}
          >
            移除
          </button>
          <label style={{ position: 'relative', width: 38, height: 22, cursor: 'pointer', flex: 'none' }}>
            <input type="checkbox" checked={monitoring} onChange={onToggle} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
            <span style={{ position: 'absolute', inset: 0, borderRadius: 11, transition: '.2s', background: monitoring ? S.accent : 'rgba(255,255,255,.16)' }} />
            <span style={{ position: 'absolute', top: 2, left: monitoring ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: '.2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 0, marginTop: 15, paddingTop: 14, borderTop: '.5px solid rgba(255,255,255,.06)' }}>
        <Stat label="视频" value={String(videoCount)} flex={1} />
        <Stat label="未读" value={String(newCount)} color={newCount > 0 ? S.accent : undefined} flex={1} />
        <div style={{ flex: 1.4 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: collectText && !collectText.startsWith('已采集') ? S.accent : S.b4, marginTop: 2 }}>{collectText ?? (syncing ? '同步中…' : c.lastSync)}</div>
          <div style={{ fontSize: 10.5, color: S.faint, marginTop: 2 }}>{collectText ? '主页采集' : '上次同步'}</div>
        </div>
        <button
          onClick={onSync}
          {...syncBind}
          style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px', background: syncHover ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.07)', color: S.cf, border: '.5px solid rgba(255,255,255,.09)', borderRadius: 8, fontSize: 12, fontWeight: 500, alignSelf: 'center', cursor: 'pointer' }}
        >
          <span style={{ display: 'inline-block', animation: syncing ? 'sonar-spin .8s linear infinite' : undefined }}>↻</span>
          {syncing ? '同步中' : '同步'}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color, flex }: { label: string; value: string; color?: string; flex: number }) {
  return (
    <div style={{ flex }}>
      <div style={{ fontSize: 17, fontWeight: 600, color: color ?? S.e8, fontFamily: S.mono }}>{value}</div>
      <div style={{ fontSize: 10.5, color: S.faint, marginTop: 2 }}>{label}</div>
    </div>
  );
}

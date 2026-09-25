/** 完整工作台外壳：1:1 还原原型（含 macOS 交通灯标题栏），桌面 → 窗口 → 标题栏 + 侧栏 + 视图。 */
import { useDeferredValue, useState } from 'react';
import type { CSSProperties } from 'react';
import { useClient } from '@/ui/useClient';
import { useVideoStatus, statusOf } from '@/ui/video-status';
import { S } from '@/ui/theme';
import { GlobalStyles, Toast, useToast, useHover, Avatar } from '@/ui/kit';
import { SonarBadge, FeedIcon, LibraryIcon, BloggersIcon, WorkflowIcon, GearIcon, SearchIcon } from '@/ui/icons';
import { useWorkbenchData } from './use-data';
import { useProcessing } from './use-processing';
import { Feed, type Sort } from './Feed';
import { Library, type LibFilter } from './Library';
import { Bloggers } from './Bloggers';
import { WorkflowBoard } from './WorkflowBoard';
import { SettingsPanel } from './SettingsPanel';
import { AddModal } from './AddModal';
import { errText } from './use-data';

type View = 'feed' | 'library' | 'bloggers' | 'workflow' | 'settings';

const NAV: Array<{ key: View; label: string; icon: (active: boolean) => React.ReactNode }> = [
  { key: 'feed', label: '动态流', icon: () => <FeedIcon /> },
  { key: 'library', label: '视频库', icon: () => <LibraryIcon /> },
  { key: 'bloggers', label: '博主管理', icon: () => <BloggersIcon /> },
  { key: 'workflow', label: '工作流', icon: () => <WorkflowIcon /> },
];

export function Workbench() {
  const client = useClient();
  const data = useWorkbenchData(client);
  const status = useVideoStatus();
  const processing = useProcessing(client);
  const { toast, show } = useToast();

  const [view, setView] = useState<View>('feed');
  const [filter, setFilter] = useState<string[]>([]);
  const [selVid, setSelVid] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('time');
  const [libFilter, setLibFilter] = useState<LibFilter>('all');
  const [query, setQuery] = useState('');
  // 输入框保持即时；视频库过滤用延迟值，快速输入时 React 可打断重过滤，避免逐字符卡顿。
  const deferredQuery = useDeferredValue(query);
  const [showAdd, setShowAdd] = useState(false);
  const [addTab, setAddTab] = useState<'blogger' | 'link'>('blogger');
  const [syncing, setSyncing] = useState(false);

  const newCount = data.videos.filter((v) => !statusOf(status.map, v.id).read).length;

  const selectVideo = (id: string) => {
    setSelVid(id);
    setView('feed');
    status.markRead(id);
  };

  const goView = (v: View) => {
    setView(v);
    setFilter([]);
  };

  const syncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await client.runMonitorOnce();
      show(r.circuitBroken ? `监控已暂停：${r.error?.message ?? '需重新登录抖音'}` : r.newVideoIds.length ? `全部博主已同步 · 新增 ${r.newVideoIds.length} 条` : '全部博主已同步 · 无新增');
      await data.reload();
    } catch (e) {
      show(errText(e));
    } finally {
      setSyncing(false);
    }
  };

  const headerTitle = { feed: '动态流', library: '视频库', bloggers: '博主管理', workflow: '工作流', settings: '设置' }[view];
  const headerSub = (() => {
    if (view === 'feed') {
      const c = filter.length === 1 ? data.creators.get(filter[0]) : undefined;
      if (c) return `${c.nickname} · ${data.videos.filter((v) => v.creatorId === filter[0]).length} 条`;
      if (filter.length > 1) return `已选 ${filter.length} 位博主 · ${data.videos.filter((v) => filter.includes(v.creatorId)).length} 条`;
      return `全部博主 · ${newCount} 条未读`;
    }
    if (view === 'library') return `${data.videos.length} 条已归档`;
    if (view === 'bloggers') return `${data.creatorList.length} 位博主`;
    if (view === 'workflow') return '创作流水线';
    return 'Provider 与数据';
  })();

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: S.shell,
        fontSize: 14,
        fontFamily: S.font,
      }}
    >
      <GlobalStyles />
      <>
        {/* 顶部工具栏（真实页面语义，不伪造系统窗口控制） */}
        <div style={{ height: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', background: S.titleBar, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)', borderBottom: '.5px solid rgba(255,255,255,.08)', position: 'relative', zIndex: 5 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: S.white, letterSpacing: '.2px' }}>{headerTitle}</span>
            <span style={{ fontSize: 12.5, color: S.faint, whiteSpace: 'nowrap' }}>{headerSub}</span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 11px', background: 'rgba(255,255,255,.07)', border: '.5px solid rgba(255,255,255,.06)', borderRadius: 8, width: 230 }}>
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value) setView('library');
              }}
              placeholder="搜索视频、博主、关键词"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: S.e2, fontSize: 12.5 }}
            />
          </div>
          <SyncAllButton syncing={syncing} onClick={syncAll} />
          <AddButton onClick={() => { setAddTab('blogger'); setShowAdd(true); }} />
        </div>

        {/* 主体 */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <Sidebar
            view={view}
            filter={filter}
            data={data}
            status={status}
            newCount={newCount}
            onNav={goView}
            onSelectCreator={(id) => { setFilter([id]); setView('feed'); }}
            onAddBlogger={() => { setAddTab('blogger'); setShowAdd(true); }}
            onSettings={() => setView('settings')}
            settingsActive={view === 'settings'}
          />
          <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
            {view === 'feed' && (
              <Feed client={client} data={data} status={status} processing={processing} creatorIds={filter} onCreatorIdsChange={setFilter} selVid={selVid} onSelect={selectVideo} sort={sort} onSort={setSort} show={show} onNavigateSettings={() => setView('settings')} />
            )}
            {view === 'library' && (
              <Library data={data} status={status} processing={processing} query={deferredQuery} filter={libFilter} onFilter={setLibFilter} onSelect={selectVideo} />
            )}
            {view === 'bloggers' && <Bloggers client={client} data={data} status={status} onAdd={() => { setAddTab('blogger'); setShowAdd(true); }} show={show} />}
            {view === 'workflow' && <WorkflowBoard client={client} data={data} onOpen={selectVideo} show={show} />}
            {view === 'settings' && <SettingsPanel client={client} />}
          </div>
        </div>

        {data.error && (
          <div style={{ position: 'absolute', left: 16, bottom: 16, fontSize: 12, color: S.orange, background: 'rgba(0,0,0,.5)', padding: '8px 12px', borderRadius: 8 }}>
            {data.error}
          </div>
        )}

        {showAdd && (
          <AddModal
            client={client}
            initialTab={addTab}
            onClose={() => setShowAdd(false)}
            onDone={(sel) => {
              setShowAdd(false);
              void data.reload();
              if (sel) selectVideo(sel);
            }}
            show={show}
          />
        )}
        <Toast text={toast} />
      </>
    </div>
  );
}

function SyncAllButton({ syncing, onClick }: { syncing: boolean; onClick: () => void }) {
  const [h, bind] = useHover();
  return (
    <button onClick={onClick} {...bind} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', background: S.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', filter: h ? 'brightness(1.12)' : undefined }}>
      <span style={{ fontSize: 14, display: 'inline-block', animation: syncing ? 'sonar-spin .8s linear infinite' : undefined }}>↻</span>
      <span>{syncing ? '同步中' : '同步全部'}</span>
    </button>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  const [h, bind] = useHover();
  return (
    <button onClick={onClick} {...bind} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', background: h ? S.btn2Hover : S.btn2, color: S.white, border: '.5px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
      <span style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>＋</span>
      <span>添加</span>
    </button>
  );
}

function Sidebar({
  view,
  filter,
  data,
  status,
  newCount,
  onNav,
  onSelectCreator,
  onAddBlogger,
  onSettings,
  settingsActive,
}: {
  view: View;
  filter: string[];
  data: ReturnType<typeof useWorkbenchData>;
  status: ReturnType<typeof useVideoStatus>;
  newCount: number;
  onNav: (v: View) => void;
  onSelectCreator: (id: string) => void;
  onAddBlogger: () => void;
  onSettings: () => void;
  settingsActive: boolean;
}) {
  const badge: Record<View, number> = {
    feed: newCount,
    library: data.videos.length,
    bloggers: data.creatorList.length,
    workflow: 0,
    settings: 0,
  };

  return (
    <div style={{ width: 250, flex: 'none', background: S.sidebar, backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)', borderRight: '.5px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '16px 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <SonarBadge box={30} radius={9} icon={18} shadow="0 2px 8px rgba(10,132,255,.4)" />
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: S.white, letterSpacing: '.3px' }}>灵机采风</div>
          <div style={{ fontSize: 11, color: S.faint, marginTop: 2 }}>博主监听 · 视频情报</div>
        </div>
      </div>

      <div style={{ padding: '6px 10px 2px' }}>
        {NAV.map((n) => (
          <NavItem key={n.key} active={view === n.key && filter.length === 0} label={n.label} icon={n.icon(view === n.key)} badge={badge[n.key]} onClick={() => onNav(n.key)} />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 18px 7px' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: S.faint, letterSpacing: '.5px', textTransform: 'uppercase' }}>正在监听</span>
        <span style={{ fontSize: 11, color: S.faint4 }}>{data.creatorList.length}</span>
        <span style={{ flex: 1, height: '.5px', background: 'rgba(255,255,255,.07)' }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 8px' }}>
        {data.creatorList.map((c) => {
          const nb = data.videos.filter((v) => v.creatorId === c.id && !statusOf(status.map, v.id).read).length;
          const cnt = data.videos.filter((v) => v.creatorId === c.id).length;
          const selected = filter.length === 1 && filter[0] === c.id && view === 'feed';
          return (
            <CreatorRow key={c.id} selected={selected} initial={c.initial} avatarUrl={c.avatarUrl} seed={c.id} name={c.nickname} meta={`${c.group} · ${cnt} 视频`} monitoring={c.monitoring} newCount={nb} onClick={() => onSelectCreator(c.id)} />
          );
        })}
      </div>

      <div style={{ padding: '9px 12px', borderTop: '.5px solid rgba(255,255,255,.07)', display: 'flex', gap: 8 }}>
        <BottomButton flex onClick={onAddBlogger}>
          <span style={{ fontSize: 15 }}>＋</span> 添加博主
        </BottomButton>
        <BottomButton active={settingsActive} onClick={onSettings} title="设置">
          <GearIcon />
        </BottomButton>
      </div>
    </div>
  );
}

function NavItem({ active, label, icon, badge, onClick }: { active: boolean; label: string; icon: React.ReactNode; badge: number; onClick: () => void }) {
  const [h, bind] = useHover();
  return (
    <div
      onClick={onClick}
      {...bind}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 11px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, color: active ? '#fff' : S.c4, background: active ? S.accent : h ? 'rgba(255,255,255,.05)' : 'transparent' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', width: 18, height: 18 }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{label}</span>
      {badge > 0 && (
        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: S.mono, color: active ? '#fff' : '#9a9a9f', background: active ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.08)' }}>
          {badge}
        </span>
      )}
    </div>
  );
}

function CreatorRow({ selected, initial, avatarUrl, seed, name, meta, monitoring, newCount, onClick }: { selected: boolean; initial: string; avatarUrl?: string; seed: string; name: string; meta: string; monitoring: boolean; newCount: number; onClick: () => void }) {
  const [h, bind] = useHover();
  return (
    <div onClick={onClick} {...bind} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 9, cursor: 'pointer', marginBottom: 2, background: selected ? 'rgba(255,255,255,.08)' : h ? 'rgba(255,255,255,.05)' : 'transparent' }}>
      <div style={{ position: 'relative' }}>
        <Avatar seed={seed} initial={initial} url={avatarUrl} size={30} radius={9} fontSize={13} />
        <span style={{ position: 'absolute', right: -2, bottom: -2, width: 9, height: 9, borderRadius: '50%', border: '2px solid #232325', background: monitoring ? S.green : S.graydot }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: S.e8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ fontSize: 11, color: S.faint, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</div>
      </div>
      {newCount > 0 && (
        <span style={{ fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', background: S.accent, fontFamily: S.mono, flex: 'none' }}>{newCount}</span>
      )}
    </div>
  );
}

function BottomButton({ children, flex, active, onClick, title }: { children: React.ReactNode; flex?: boolean; active?: boolean; onClick: () => void; title?: string }) {
  const [h, bind] = useHover();
  const base: CSSProperties = { height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: active || h ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.06)', color: S.e8, border: '.5px solid rgba(255,255,255,.08)', borderRadius: 8, fontSize: 12.5, fontWeight: 500, cursor: 'pointer' };
  return (
    <button onClick={onClick} title={title} {...bind} style={flex ? { ...base, flex: 1 } : { ...base, width: 32 }}>
      {children}
    </button>
  );
}

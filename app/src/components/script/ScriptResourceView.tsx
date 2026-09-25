// src/components/script/ScriptResourceView.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Film, Search } from 'lucide-react';
import type { FileEntry } from '../../lib/electron-api';
import { Badge, EmptyState, Input } from '../../ui';
import {
  collectScriptResources,
  filterResources,
  groupResources,
  hydratePreviewMeta,
  listUncachedPreviewPaths,
  type PreviewMetaCache,
  type ResourceGroup,
  type ResourceItem,
} from '../../lib/workspace-resources';
import styles from './ScriptResourceView.module.css';

interface ScriptResourceViewProps {
  projectDir: string | null;
  fileEntries: FileEntry[];
  openedFile: string | null;
  fileDirtyMap: Record<string, boolean>;
  fileConflictMap: Record<string, boolean>;
  onOpenFile: (file: string) => void;
}

const GROUP_LABEL: Record<ResourceGroup, string> = {
  original: '原始文稿',
  script: '口播脚本',
  douyin: '抖音导入',
  local_video: '本地视频',
  local_audio: '本地音频',
};

function iconForGroup(group: ResourceGroup) {
  if (group === 'douyin' || group === 'local_video' || group === 'local_audio') {
    return <Film size={14} strokeWidth={1.8} />;
  }
  return <FileText size={14} strokeWidth={1.8} />;
}

export function ScriptResourceView({
  projectDir,
  fileEntries,
  openedFile,
  fileDirtyMap,
  fileConflictMap,
  onOpenFile,
}: ScriptResourceViewProps) {
  const cacheRef = useRef<PreviewMetaCache>(new Map());
  const [cacheVersion, setCacheVersion] = useState(0);
  const [query, setQuery] = useState('');

  const items = useMemo(
    () => collectScriptResources(fileEntries, cacheRef.current),
    // cacheVersion 依赖确保缓存 hydrate 完成后触发重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileEntries, cacheVersion],
  );

  // 解析未命中缓存的 preview.json
  useEffect(() => {
    if (!projectDir) return;
    const pending = listUncachedPreviewPaths(items, cacheRef.current);
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      await hydratePreviewMeta(
        projectDir,
        pending,
        cacheRef.current,
        (dir, rel) => window.electronAPI.loadScriptFile(dir, rel),
      );
      if (!cancelled) setCacheVersion((v) => v + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectDir, items]);

  const filtered = useMemo(() => filterResources(items, query), [items, query]);
  const grouped = useMemo(() => groupResources(filtered), [filtered]);

  if (!projectDir) {
    return (
      <div className={styles.empty}>
        <EmptyState title="尚未选择工作目录" description="选择目录后将展示关键稿件资源。" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <EmptyState
          title="暂无稿件资源"
          description="导入文稿或媒体后，会在此快速访问。"
        />
      </div>
    );
  }

  const totalFiltered = filtered.length;

  return (
    <div className={styles.container}>
      <div className={styles.searchBar}>
        <Input
          variant="search"
          size="sm"
          leftIcon={<Search size={14} />}
          placeholder="搜索稿件..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {totalFiltered === 0 ? (
        <div className={styles.empty}>
          <EmptyState
            title="未找到匹配资源"
            description="换个关键词试试，或清空搜索。"
          />
        </div>
      ) : (
        <div className={styles.groups} role="tree" aria-label="稿件资源">
          {(Object.keys(GROUP_LABEL) as ResourceGroup[]).map((group) => {
            const list = grouped[group];
            if (list.length === 0) return null;
            return (
              <section key={group} className={styles.groupSection}>
                <header className={styles.groupHeader}>
                  <span className={styles.groupTitle}>{GROUP_LABEL[group]}</span>
                  <Badge size="xs" variant="secondary">
                    {list.length}
                  </Badge>
                </header>
                <div className={styles.groupList}>
                  {list.map((item) => (
                    <ResourceRow
                      key={item.path}
                      item={item}
                      active={openedFile === item.path}
                      dirty={Boolean(fileDirtyMap[item.path])}
                      conflict={Boolean(fileConflictMap[item.path])}
                      onOpen={onOpenFile}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResourceRow({
  item,
  active,
  dirty,
  conflict,
  onOpen,
}: {
  item: ResourceItem;
  active: boolean;
  dirty: boolean;
  conflict: boolean;
  onOpen: (file: string) => void;
}) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-workbench-file', item.path);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const className = [styles.row, active ? styles.rowActive : ''].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={active}
      className={className}
      onClick={() => onOpen(item.path)}
      draggable
      onDragStart={handleDragStart}
      title={item.path}
      data-file-path={item.path}
    >
      <span className={styles.rowIcon} aria-hidden="true">
        {iconForGroup(item.group)}
      </span>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{item.displayName}</span>
        {item.subtitle ? <span className={styles.rowSubtitle}>{item.subtitle}</span> : null}
      </span>
      <span className={styles.rowMeta} aria-hidden="true">
        {dirty ? <span className={styles.dirtyDot} /> : null}
        {conflict ? <span className={styles.conflictMark}>⚠</span> : null}
      </span>
    </button>
  );
}

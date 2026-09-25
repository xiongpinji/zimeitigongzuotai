import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Settings2,
} from 'lucide-react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { FileEntry } from '../../lib/electron-api';
import { isVideoImportPreviewFile } from '../../lib/video-import-preview';
import { isAudioFile, isImageFile } from '../../lib/workbench-file-kind';
import { useScriptStore } from '../../store/script';
import { Button, EmptyState, PanelHeader } from '../../ui';
import { FileTreeTabs } from './FileTreeTabs';
import { ScriptResourceView } from './ScriptResourceView';
import styles from './FileTreePanel.module.css';

interface FileTreePanelProps {
  projectDir: string | null;
  fileEntries: FileEntry[];
  openedFile: string | null;
  fileDirtyMap: Record<string, boolean>;
  fileConflictMap: Record<string, boolean>;
  onSelectProjectDir: () => void;
  onOpenFile: (file: string) => void;
}

interface FileTreeProps {
  fileEntries: FileEntry[];
  expandedDirectories: Record<string, boolean>;
  openedFile: string | null;
  fileDirtyMap: Record<string, boolean>;
  fileConflictMap: Record<string, boolean>;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (file: string) => void;
  treeRef?: RefObject<HTMLDivElement | null>;
}

function getProjectName(projectDir: string): string {
  const parts = projectDir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? projectDir;
}

function buildRelativePath(pathPrefix: string, name: string): string {
  return pathPrefix ? `${pathPrefix}/${name}` : name;
}

// 真正无法在工作台打开的二进制文件（图片 / 音频已单独支持媒体预览，故不在此列）。
const BINARY_EXT = /\.(avi|mov|mkv|webm|mp4|zip|tar|gz|rar|7z|pdf|doc[x]?|xls[x]?|ppt[x]?|exe|dll|so|dylib|woff2?|ttf|eot)$/i;

function isOpenableFile(relativePath: string): boolean {
  // 排除状态文件
  if (relativePath === 'script-state.json') return false;
  // 图片 / 音频以媒体预览方式打开
  if (isImageFile(relativePath) || isAudioFile(relativePath)) return true;
  // 其余二进制文件不可打开
  return !BINARY_EXT.test(relativePath);
}

function getFileIcon(entry: FileEntry): ReactNode {
  if (entry.name === 'script-state.json') {
    return <Settings2 size={14} strokeWidth={1.8} />;
  }

  if (entry.name === 'preview.json') {
    return <Film size={14} strokeWidth={1.8} />;
  }

  if (isImageFile(entry.name)) {
    return <ImageIcon size={14} strokeWidth={1.8} />;
  }

  if (isAudioFile(entry.name)) {
    return <Music size={14} strokeWidth={1.8} />;
  }

  return <FileText size={14} strokeWidth={1.8} />;
}

function getIndentStyle(depth: number): CSSProperties {
  return { '--tree-depth': depth } as CSSProperties;
}

export function collectDirectoryPaths(
  fileEntries: FileEntry[],
  pathPrefix = '',
): string[] {
  const paths: string[] = [];

  for (const entry of fileEntries) {
    if (entry.type !== 'directory') {
      continue;
    }

    const relativePath = buildRelativePath(pathPrefix, entry.name);
    paths.push(relativePath);

    if (entry.children?.length) {
      paths.push(...collectDirectoryPaths(entry.children, relativePath));
    }
  }

  return paths;
}

export function reconcileExpandedDirectories(
  fileEntries: FileEntry[],
  previous: Record<string, boolean>,
): Record<string, boolean> {
  return collectDirectoryPaths(fileEntries).reduce<Record<string, boolean>>((next, path) => {
    next[path] = previous[path] ?? false;
    return next;
  }, {});
}

export function getAncestorDirectoryPaths(filePath: string): string[] {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return [];
  }

  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

export function revealPathInExpandedDirectories(
  previous: Record<string, boolean>,
  filePath: string | null,
): Record<string, boolean> {
  if (!filePath) {
    return previous;
  }

  let changed = false;
  const next = { ...previous };
  for (const path of getAncestorDirectoryPaths(filePath)) {
    if (next[path] !== true) {
      next[path] = true;
      changed = true;
    }
  }
  return changed ? next : previous;
}

function TreeNode({
  entry,
  pathPrefix,
  depth,
  expandedDirectories,
  openedFile,
  fileDirtyMap,
  fileConflictMap,
  onToggleDirectory,
  onOpenFile,
}: {
  entry: FileEntry;
  pathPrefix: string;
  depth: number;
  expandedDirectories: Record<string, boolean>;
  openedFile: string | null;
  fileDirtyMap: Record<string, boolean>;
  fileConflictMap: Record<string, boolean>;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (file: string) => void;
}) {
  const relativePath = buildRelativePath(pathPrefix, entry.name);

  if (entry.type === 'directory') {
    const expanded = expandedDirectories[relativePath] ?? false;

    return (
      <div className={styles.treeBranch}>
        <button
          type="button"
          role="treeitem"
          aria-expanded={expanded}
          className={`${styles.treeRow} ${styles.treeRowDirectory}`}
          style={getIndentStyle(depth)}
          onClick={() => onToggleDirectory(relativePath)}
          title={relativePath}
          data-tree-path={relativePath}
        >
          <span className={styles.chevronSlot} aria-hidden="true">
            {expanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
          </span>
          <span className={styles.iconSlot} aria-hidden="true">
            {expanded ? <FolderOpen size={14} strokeWidth={1.8} /> : <Folder size={14} strokeWidth={1.8} />}
          </span>
          <span className={styles.treeLabel}>{entry.name}</span>
          <span className={styles.metaSlot} aria-hidden="true" />
        </button>

        {expanded
          ? entry.children?.map((child) => (
              <TreeNode
                key={`${relativePath}/${child.name}`}
                entry={child}
                pathPrefix={relativePath}
                depth={depth + 1}
                expandedDirectories={expandedDirectories}
                openedFile={openedFile}
                fileDirtyMap={fileDirtyMap}
                fileConflictMap={fileConflictMap}
                onToggleDirectory={onToggleDirectory}
                onOpenFile={onOpenFile}
              />
            ))
          : null}
      </div>
    );
  }

  const active = openedFile === relativePath;
  const openable = isOpenableFile(relativePath);
  const previewFile = isVideoImportPreviewFile(relativePath);
  const dirty = Boolean(fileDirtyMap[relativePath]);
  const conflict = Boolean(fileConflictMap[relativePath]);
  const className = [
    styles.treeRow,
    styles.treeRowFile,
    active ? styles.treeRowActive : '',
    openable ? styles.treeRowInteractive : styles.treeRowDisabled,
  ]
    .filter(Boolean)
    .join(' ');

  const handleDragStart = (e: React.DragEvent) => {
    if (!openable) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/x-workbench-file', relativePath);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={active}
      aria-disabled={!openable}
      disabled={!openable}
      className={className}
      style={getIndentStyle(depth)}
      onClick={() => onOpenFile(relativePath)}
      title={relativePath}
      data-file-path={relativePath}
      draggable={openable}
      onDragStart={handleDragStart}
    >
      <span className={styles.chevronSlot} aria-hidden="true" />
      <span className={styles.iconSlot} aria-hidden="true">
        {getFileIcon(entry)}
      </span>
      <span className={styles.treeLabel}>{entry.name}</span>
      <span className={styles.metaSlot} aria-hidden="true">
        {previewFile ? <span style={{ fontSize: 10, opacity: 0.7 }}>预览</span> : null}
        {dirty ? <span className={styles.dirtyDot} /> : null}
        {conflict ? <span className={styles.conflictMark}>⚠</span> : null}
      </span>
    </button>
  );
}

export function FileTree({
  fileEntries,
  expandedDirectories,
  openedFile,
  fileDirtyMap,
  fileConflictMap,
  onToggleDirectory,
  onOpenFile,
  treeRef,
}: FileTreeProps) {
  return (
    <div className={styles.treeList} role="tree" aria-label="工作文件树" ref={treeRef}>
      {fileEntries.map((entry) => (
        <TreeNode
          key={entry.name}
          entry={entry}
          pathPrefix=""
          depth={0}
          expandedDirectories={expandedDirectories}
          openedFile={openedFile}
          fileDirtyMap={fileDirtyMap}
          fileConflictMap={fileConflictMap}
          onToggleDirectory={onToggleDirectory}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}

export function FileTreePanel({
  projectDir,
  fileEntries,
  openedFile,
  fileDirtyMap,
  fileConflictMap,
  onSelectProjectDir,
  onOpenFile,
}: FileTreePanelProps) {
  const treeRef = useRef<HTMLDivElement | null>(null);
  const fileTreeView = useScriptStore((s) => s.fileTreeView);
  const setFileTreeView = useScriptStore((s) => s.setFileTreeView);
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>(() =>
    reconcileExpandedDirectories(fileEntries, {}),
  );

  useEffect(() => {
    setExpandedDirectories((previous) => reconcileExpandedDirectories(fileEntries, previous));
  }, [fileEntries]);

  useEffect(() => {
    setExpandedDirectories((previous) => revealPathInExpandedDirectories(previous, openedFile));
  }, [openedFile]);

  useEffect(() => {
    if (!openedFile || !treeRef.current) {
      return;
    }

    const selector = `[data-file-path="${openedFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    const rafId = window.requestAnimationFrame(() => {
      const target = treeRef.current?.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ block: 'nearest' });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [openedFile, expandedDirectories]);

  function handleToggleDirectory(path: string) {
    setExpandedDirectories((previous) => ({
      ...previous,
      [path]: !(previous[path] ?? false),
    }));
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <PanelHeader
          title="工作文件"
          actions={
            <Button.Ghost size="sm" onClick={onSelectProjectDir}>
              更换目录
            </Button.Ghost>
          }
        />
      </div>

      {projectDir ? (
        <>
          <div className={styles.projectRoot} title={projectDir}>
            <span className={styles.rootIcon} aria-hidden="true">
              <FolderOpen size={14} strokeWidth={1.8} />
            </span>
            <span className={styles.rootName}>{getProjectName(projectDir)}</span>
          </div>

          <FileTreeTabs
            value={fileTreeView}
            onValueChange={setFileTreeView}
            allSlot={
              <FileTree
                fileEntries={fileEntries}
                expandedDirectories={expandedDirectories}
                openedFile={openedFile}
                fileDirtyMap={fileDirtyMap}
                fileConflictMap={fileConflictMap}
                onToggleDirectory={handleToggleDirectory}
                onOpenFile={onOpenFile}
                treeRef={treeRef}
              />
            }
            resourcesSlot={
              <ScriptResourceView
                projectDir={projectDir}
                fileEntries={fileEntries}
                openedFile={openedFile}
                fileDirtyMap={fileDirtyMap}
                fileConflictMap={fileConflictMap}
                onOpenFile={onOpenFile}
              />
            }
          />
        </>
      ) : (
        <div className={styles.empty}>
          <EmptyState
            title="尚未选择工作目录"
            description="左侧文件树会显示工作目录中的原稿、口播稿和脚本状态文件。"
            actions={
              <Button variant="primary" size="sm" onClick={onSelectProjectDir}>
                选择工作目录
              </Button>
            }
          />
        </div>
      )}
    </aside>
  );
}

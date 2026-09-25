# AI 写稿工作台文件树重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ScriptWorkbench 从"步骤 1 选目录"改为左侧文件树 + 右上操作面板 + 右下编辑器的布局，支持文件修改标记、⌘S 全量保存、chokidar 文件监听与编辑冲突处理。

**Architecture:** 左侧 FileTreePanel（空状态→目录选择→文件树）、右上 OperationBar（步骤指示 + 紧凑操作）、右下编辑器（带 FileTabs 标签栏）。复杂步骤操作通过右侧 StepDrawer 抽屉承载。主进程用 chokidar 监听文件变更，IPC 通知渲染进程做 dirty/conflict 判断。

**Tech Stack:** React + Zustand + CodeMirror 6 + Electron IPC + chokidar + lucide-react

**Spec:** `docs/superpowers/specs/2026-04-07-script-workbench-file-tree-refactor-design.md`

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `src/components/script/FileTreePanel.tsx` | 文件树面板（空状态 + 目录结构） |
| Create | `src/components/script/FileTreePanel.module.css` | 文件树样式 |
| Create | `src/components/script/OperationBar.tsx` | 顶部操作面板（步骤指示 + 操作按钮） |
| Create | `src/components/script/FileTabs.tsx` | 文件标签栏 |
| Create | `src/components/script/StepDrawer.tsx` | 右侧抽屉（模板选择 / 批注列表） |
| Create | `src/components/script/ConflictDialog.tsx` | 冲突确认弹窗 |
| Create | `src/components/script/EmptyGuide.tsx` | 编辑器区空状态引导 |
| Modify | `src/store/script.ts` | 新增 dirty/conflict/drawer/openedFile/fileEntries 等状态 |
| Modify | `src/lib/script-persistence.ts` | 移除文本文件自动防抖保存，新增 saveAllDirtyFiles |
| Modify | `src/lib/electron-api.ts` | 新增文件监听 + 目录读取 API 类型 |
| Modify | `electron/main.ts` | 新增 chokidar 监听 IPC + readDirectory handler |
| Modify | `electron/preload.ts` | 暴露新 API |
| Modify | `src/pages/ScriptWorkbench.tsx` | 主布局重组 |
| Modify | `src/pages/ScriptWorkbench.module.css` | 布局样式重写 |
| Modify | `src/components/script/StepIndicator.tsx` | 适配新 4 步流程 |
| Modify | `src/components/script/StepReviewOriginal.tsx` | 精简为操作面板内容提供器 |
| Modify | `src/components/script/StepGenerate.tsx` | 拆分为操作面板内容 + 抽屉内容 |
| Modify | `src/components/script/StepAIReview.tsx` | 拆分为操作面板内容 + 抽屉内容 |
| Modify | `src/components/script/StepConfirm.tsx` | 适配新布局 |
| Delete | `src/components/script/StepInitialize.tsx` | 功能拆分到文件树和引导 |

---

### Task 1: 安装 chokidar 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 chokidar**

```bash
npm install chokidar
```

- [ ] **Step 2: 验证安装**

```bash
node -e "require('chokidar'); console.log('chokidar ok')"
```

Expected: `chokidar ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 chokidar 用于文件监听"
```

---

### Task 2: Electron 主进程 — 文件监听与目录读取 IPC

**Files:**
- Modify: `electron/main.ts:448-480`
- Modify: `electron/preload.ts:66-78`
- Modify: `src/lib/electron-api.ts:67-128`

- [ ] **Step 1: 在 electron/main.ts 中新增 chokidar 监听和目录读取 IPC handlers**

在文件顶部导入 chokidar（第 1 行后）：

```typescript
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
```

在 `let menuContext` 声明（第 24 行）后新增 watcher 变量：

```typescript
let fileWatcher: FSWatcher | null = null;
```

在 `select-text-file` handler（第 495 行）之后，`select-output-path` handler 之前，新增以下 IPC handlers：

```typescript
ipcMain.handle('start-watching', async (_event, dir: string) => {
  fileWatcher?.close();
  fileWatcher = chokidar.watch(dir, {
    depth: 1,
    ignoreInitial: true,
    ignored: /(^|[/\\])\../, // 忽略隐藏文件
  });

  fileWatcher.on('change', async (filePath: string) => {
    const relative = path.relative(dir, filePath);
    if (!relative.endsWith('.md')) return;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      mainWindow?.webContents.send('file-changed', { file: relative, content });
    } catch {
      // 文件可能被删除，忽略
    }
  });

  // 监听新增和删除以刷新文件树
  fileWatcher.on('add', (filePath: string) => {
    const relative = path.relative(dir, filePath);
    mainWindow?.webContents.send('file-tree-changed', { type: 'add', file: relative });
  });
  fileWatcher.on('unlink', (filePath: string) => {
    const relative = path.relative(dir, filePath);
    mainWindow?.webContents.send('file-tree-changed', { type: 'unlink', file: relative });
  });
});

ipcMain.handle('stop-watching', async () => {
  await fileWatcher?.close();
  fileWatcher = null;
});

ipcMain.handle('read-directory', async (_event, dir: string) => {
  interface FileEntry {
    name: string;
    type: 'file' | 'directory';
    children?: FileEntry[];
  }

  async function readDir(dirPath: string, currentDepth: number): Promise<FileEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // 隐藏文件
      if (entry.isDirectory() && currentDepth < 1) {
        const children = await readDir(path.join(dirPath, entry.name), currentDepth + 1);
        result.push({ name: entry.name, type: 'directory', children });
      } else if (entry.isFile()) {
        result.push({ name: entry.name, type: 'file' });
      }
    }

    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return readDir(dir, 0);
});
```

在 `app.on('window-all-closed', ...)` 的回调中（第 590 行），在 `app.quit()` 前关闭 watcher：

```typescript
app.on('window-all-closed', () => {
  fileWatcher?.close();
  app.quit();
});
```

- [ ] **Step 2: 在 electron/preload.ts 中暴露新 API**

在 `selectTextFile`（第 74-75 行）之后新增：

```typescript
  startWatching: (dir: string) => ipcRenderer.invoke('start-watching', dir),
  stopWatching: () => ipcRenderer.invoke('stop-watching'),
  onFileChanged: (callback: (data: { file: string; content: string }) => void) => {
    const handler = (_event: unknown, data: { file: string; content: string }) => callback(data);
    ipcRenderer.on('file-changed', handler);
    return () => ipcRenderer.removeListener('file-changed', handler);
  },
  onFileTreeChanged: (callback: (data: { type: string; file: string }) => void) => {
    const handler = (_event: unknown, data: { type: string; file: string }) => callback(data);
    ipcRenderer.on('file-tree-changed', handler);
    return () => ipcRenderer.removeListener('file-tree-changed', handler);
  },
  readDirectory: (dir: string) =>
    ipcRenderer.invoke('read-directory', dir) as Promise<FileEntry[]>,
```

- [ ] **Step 3: 在 src/lib/electron-api.ts 中新增类型声明**

在 `ElectronAPI` 接口中 `selectTextFile` 行（第 124 行）之后新增：

```typescript
  // 文件监听
  startWatching: (dir: string) => Promise<void>;
  stopWatching: () => Promise<void>;
  onFileChanged: (callback: (data: { file: string; content: string }) => void) => () => void;
  onFileTreeChanged: (callback: (data: { type: string; file: string }) => void) => () => void;
  readDirectory: (dir: string) => Promise<FileEntry[]>;
```

在文件顶部（第 7 行 `import type { ImportKind }` 之后）新增 `FileEntry` 类型：

```typescript
export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  children?: FileEntry[];
}
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 无与新增代码相关的错误

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/lib/electron-api.ts
git commit -m "feat(electron): 新增文件监听和目录读取 IPC"
```

---

### Task 3: Script Store 扩展 — dirty / conflict / drawer / file 状态

**Files:**
- Modify: `src/store/script.ts`

- [ ] **Step 1: 修改 ScriptStep 类型和 initialState**

将 `ScriptStep` 类型从 `1 | 2 | 3 | 4 | 5` 改为 `0 | 1 | 2 | 3 | 4`：

```typescript
export type ScriptStep = 0 | 1 | 2 | 3 | 4;
```

修改 `initialState`，`currentStep` 改为 `0`：

```typescript
const initialState: ScriptState = {
  projectDir: null,
  currentStep: 0,
  originalText: '',
  scriptText: '',
  selectedTemplate: 'news-broadcast',
  annotations: [],
  generating: false,
  reviewing: false,
  openedFile: null,
  fileDirtyMap: {},
  fileConflictMap: {},
  stashedContent: {},
  drawerVisible: false,
  drawerContent: null,
  fileEntries: [],
};
```

- [ ] **Step 2: 扩展 ScriptState 接口**

在现有 `ScriptState` 接口（第 24-33 行）的 `reviewing` 字段后新增：

```typescript
  openedFile: string | null;
  fileDirtyMap: Record<string, boolean>;
  fileConflictMap: Record<string, boolean>;
  stashedContent: Record<string, string>;
  drawerVisible: boolean;
  drawerContent: 'template' | 'annotations' | null;
  fileEntries: FileEntry[];
```

在文件顶部新增导入：

```typescript
import type { FileEntry } from '../lib/electron-api';
```

- [ ] **Step 3: 扩展 ScriptActions 接口**

在 `ScriptActions` 接口中（第 35-56 行）新增 actions：

```typescript
  setOpenedFile: (file: string | null) => void;
  setFileDirty: (file: string, dirty: boolean) => void;
  setFileConflict: (file: string, conflict: boolean) => void;
  stashExternalContent: (file: string, content: string) => void;
  clearAllDirty: () => void;
  clearConflict: (file: string) => void;
  openDrawer: (content: 'template' | 'annotations') => void;
  closeDrawer: () => void;
  setFileEntries: (entries: FileEntry[]) => void;
```

- [ ] **Step 4: 实现新 actions**

在 store create 中 `setReviewing` 后新增：

```typescript
  setOpenedFile: (file) => set({ openedFile: file }),

  setFileDirty: (file, dirty) =>
    set((state) => ({
      fileDirtyMap: { ...state.fileDirtyMap, [file]: dirty },
    })),

  setFileConflict: (file, conflict) =>
    set((state) => ({
      fileConflictMap: { ...state.fileConflictMap, [file]: conflict },
    })),

  stashExternalContent: (file, content) =>
    set((state) => ({
      stashedContent: { ...state.stashedContent, [file]: content },
    })),

  clearAllDirty: () => set({ fileDirtyMap: {} }),

  clearConflict: (file) =>
    set((state) => {
      const { [file]: _, ...rest } = state.fileConflictMap;
      const { [file]: __, ...restStash } = state.stashedContent;
      return { fileConflictMap: rest, stashedContent: restStash };
    }),

  openDrawer: (content) => set({ drawerVisible: true, drawerContent: content }),
  closeDrawer: () => set({ drawerVisible: false, drawerContent: null }),

  setFileEntries: (entries) => set({ fileEntries: entries }),
```

- [ ] **Step 5: 更新 restoreState 和 reset**

修改 `restoreState` 以包含新字段：

```typescript
  restoreState: (params) =>
    set({
      projectDir: params.projectDir,
      currentStep: params.currentStep,
      originalText: params.originalText,
      scriptText: params.scriptText,
      selectedTemplate: params.selectedTemplate,
      annotations: params.annotations,
      generating: false,
      reviewing: false,
      openedFile: null,
      fileDirtyMap: {},
      fileConflictMap: {},
      stashedContent: {},
      drawerVisible: false,
      drawerContent: null,
    }),
```

修改 `restoreState` 的 params 类型中 `currentStep` 为 `ScriptStep`（已经是，但确保值域包含 0）。

- [ ] **Step 6: 验证编译**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 可能有其他文件引用 ScriptStep 的类型错误（Step 1 引用了 `1` 值），这些将在后续 Task 中修复。

- [ ] **Step 7: Commit**

```bash
git add src/store/script.ts
git commit -m "feat(store): 扩展 script store 支持 dirty/conflict/drawer/file 状态"
```

---

### Task 4: 修改 script-persistence — 移除自动文件保存，新增 saveAll

**Files:**
- Modify: `src/lib/script-persistence.ts`

- [ ] **Step 1: 移除 debouncedSaveFile，新增 saveAllDirtyFiles**

删除 `debouncedSaveFile` 函数（第 62-75 行）及其 `saveTimer` 变量（第 63 行）。

新增 `saveAllDirtyFiles` 函数：

```typescript
// --- 保存所有 dirty 文件 ---

const savingFiles = new Set<string>();

export function isSavingFile(file: string): boolean {
  return savingFiles.has(file);
}

export async function saveAllDirtyFiles(
  projectDir: string,
  fileDirtyMap: Record<string, boolean>,
  getText: (file: string) => string,
): Promise<void> {
  const dirtyFiles = Object.entries(fileDirtyMap)
    .filter(([, dirty]) => dirty)
    .map(([file]) => file);

  for (const file of dirtyFiles) {
    savingFiles.add(file);
    await window.electronAPI.saveScriptFile(projectDir, file, getText(file));
    // 延迟移除，确保 chokidar 事件被过滤
    setTimeout(() => savingFiles.delete(file), 500);
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: `debouncedSaveFile` 的引用处（ScriptWorkbench.tsx、StepGenerate.tsx）会报错，将在后续 Task 中修复。

- [ ] **Step 3: Commit**

```bash
git add src/lib/script-persistence.ts
git commit -m "refactor(persistence): 移除自动文件保存，新增 saveAllDirtyFiles"
```

---

### Task 5: FileTreePanel 组件

**Files:**
- Create: `src/components/script/FileTreePanel.tsx`
- Create: `src/components/script/FileTreePanel.module.css`

- [ ] **Step 1: 创建 FileTreePanel.module.css**

```css
/* src/components/script/FileTreePanel.module.css */
.panel {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-panel-bg);
  border-right: 1px solid var(--color-border-subtle);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.headerTitle {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.projectRoot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  background: var(--color-window-bg);
  border-bottom: 1px solid var(--color-border-subtle);
}

.fileList {
  flex: 1;
  padding: 4px 0;
  overflow-y: auto;
}

.fileItem {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px 5px 20px;
  font-size: 12px;
  cursor: pointer;
  border-left: 2px solid transparent;
  color: var(--color-text-secondary);
}

.fileItem:hover {
  background: var(--color-bg-hover);
}

.fileItemActive {
  background: var(--color-accent-bg);
  color: var(--color-accent);
  border-left-color: var(--color-accent);
}

.fileItemChild {
  padding-left: 36px;
}

.fileItemConfig {
  color: var(--color-text-tertiary);
  font-size: 10px;
}

.fileName {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dirtyDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #FF9F0A;
  flex-shrink: 0;
}

.conflictIcon {
  color: #FF453A;
  flex-shrink: 0;
}

.emptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  padding: 20px;
  text-align: center;
}

.emptyButton {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px dashed var(--color-border-subtle);
  background: transparent;
  color: var(--color-accent);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.emptyButton:hover {
  background: var(--color-accent-bg);
  border-color: var(--color-accent);
}
```

- [ ] **Step 2: 创建 FileTreePanel.tsx**

```tsx
// src/components/script/FileTreePanel.tsx
import { FolderOpen, AlertTriangle } from 'lucide-react';
import { useScriptStore } from '../../store/script';
import type { FileEntry } from '../../lib/electron-api';
import styles from './FileTreePanel.module.css';
import path from 'path';

interface FileTreePanelProps {
  onSelectDirectory: () => void;
}

function FileIcon({ name }: { name: string }) {
  if (name.endsWith('.md')) return <span>📄</span>;
  if (name.endsWith('.json')) return <span>⚙️</span>;
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.webp')) return <span>🖼️</span>;
  return <span>📄</span>;
}

function DirIcon() {
  return <span>📁</span>;
}

function FileTreeItem({
  entry,
  depth,
  activeFile,
  dirtyMap,
  conflictMap,
  onFileClick,
}: {
  entry: FileEntry;
  depth: number;
  activeFile: string | null;
  dirtyMap: Record<string, boolean>;
  conflictMap: Record<string, boolean>;
  onFileClick: (name: string) => void;
}) {
  const isActive = entry.type === 'file' && entry.name === activeFile;
  const isDirty = dirtyMap[entry.name];
  const isConflict = conflictMap[entry.name];
  const isConfig = entry.name === 'script-state.json';
  const isMd = entry.name.endsWith('.md');

  if (entry.type === 'directory') {
    return (
      <>
        <div
          className={styles.fileItem}
          style={{ paddingLeft: 20 + depth * 16 }}
        >
          <DirIcon />
          <span className={styles.fileName}>{entry.name}</span>
        </div>
        {entry.children?.map((child) => (
          <FileTreeItem
            key={child.name}
            entry={child}
            depth={depth + 1}
            activeFile={activeFile}
            dirtyMap={dirtyMap}
            conflictMap={conflictMap}
            onFileClick={onFileClick}
          />
        ))}
      </>
    );
  }

  return (
    <div
      className={`${styles.fileItem} ${isActive ? styles.fileItemActive : ''} ${isConfig ? styles.fileItemConfig : ''}`}
      style={{ paddingLeft: 20 + depth * 16 }}
      onClick={isMd && !isConfig ? () => onFileClick(entry.name) : undefined}
      role={isMd ? 'button' : undefined}
      tabIndex={isMd ? 0 : undefined}
      onKeyDown={isMd ? (e) => { if (e.key === 'Enter') onFileClick(entry.name); } : undefined}
    >
      <FileIcon name={entry.name} />
      <span className={styles.fileName}>{entry.name}</span>
      {isConflict && <AlertTriangle size={12} className={styles.conflictIcon} />}
      {isDirty && !isConflict && <div className={styles.dirtyDot} />}
    </div>
  );
}

export function FileTreePanel({ onSelectDirectory }: FileTreePanelProps) {
  const {
    projectDir,
    fileEntries,
    openedFile,
    fileDirtyMap,
    fileConflictMap,
    setOpenedFile,
  } = useScriptStore();

  if (!projectDir) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyState}>
          <FolderOpen size={32} color="var(--color-text-tertiary)" />
          <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
            选择工作目录开始写稿
          </span>
          <button
            type="button"
            className={styles.emptyButton}
            onClick={onSelectDirectory}
          >
            <FolderOpen size={14} />
            选择工作目录
          </button>
        </div>
      </div>
    );
  }

  const dirName = projectDir.split('/').pop() || projectDir;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>资源管理器</span>
      </div>
      <div className={styles.projectRoot}>
        <span>📂</span>
        <span>{dirName}</span>
      </div>
      <div className={styles.fileList}>
        {fileEntries.map((entry) => (
          <FileTreeItem
            key={entry.name}
            entry={entry}
            depth={0}
            activeFile={openedFile}
            dirtyMap={fileDirtyMap}
            conflictMap={fileConflictMap}
            onFileClick={setOpenedFile}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit 2>&1 | grep -i "FileTreePanel" | head -5
```

Expected: 无错误（可能有 path 模块在浏览器环境的警告，后续处理）

- [ ] **Step 4: Commit**

```bash
git add src/components/script/FileTreePanel.tsx src/components/script/FileTreePanel.module.css
git commit -m "feat(script): 新增 FileTreePanel 文件树面板组件"
```

---

### Task 6: FileTabs 组件

**Files:**
- Create: `src/components/script/FileTabs.tsx`

- [ ] **Step 1: 创建 FileTabs.tsx**

```tsx
// src/components/script/FileTabs.tsx
import { AlertTriangle } from 'lucide-react';
import { useScriptStore } from '../../store/script';

export function FileTabs() {
  const {
    openedFile,
    fileDirtyMap,
    fileConflictMap,
    originalText,
    scriptText,
    setOpenedFile,
  } = useScriptStore();

  const tabs = [
    { file: 'original.md', label: 'original.md', hasContent: originalText.length > 0 },
    { file: 'script.md', label: 'script.md', hasContent: scriptText.length > 0 },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {tabs
        .filter((tab) => tab.hasContent || tab.file === openedFile)
        .map((tab) => {
          const isActive = tab.file === openedFile;
          const isDirty = fileDirtyMap[tab.file];
          const isConflict = fileConflictMap[tab.file];

          return (
            <button
              key={tab.file}
              type="button"
              onClick={() => setOpenedFile(tab.file)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: '6px 6px 0 0',
                border: `1px solid ${isActive ? 'var(--color-border-subtle)' : 'transparent'}`,
                borderBottom: isActive ? '1px solid var(--color-window-bg)' : '1px solid transparent',
                background: isActive ? 'var(--color-panel-bg)' : 'transparent',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                fontSize: 11,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              📄 {tab.label}
              {isConflict && <AlertTriangle size={10} color="#FF453A" />}
              {isDirty && !isConflict && (
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#FF9F0A',
                  }}
                />
              )}
            </button>
          );
        })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/script/FileTabs.tsx
git commit -m "feat(script): 新增 FileTabs 文件标签栏组件"
```

---

### Task 7: OperationBar 组件

**Files:**
- Create: `src/components/script/OperationBar.tsx`

- [ ] **Step 1: 创建 OperationBar.tsx**

```tsx
// src/components/script/OperationBar.tsx
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RefreshCw,
  Save,
  Search,
  Sparkles,
} from 'lucide-react';
import { useMemo, useCallback } from 'react';
import { useScriptStore } from '../../store/script';
import { getAnyTemplateById } from '../../lib/script-templates';
import type { ScriptStep } from '../../store/script';

const STEPS: { step: ScriptStep; label: string }[] = [
  { step: 1, label: '原稿审查' },
  { step: 2, label: '生成口播稿' },
  { step: 3, label: 'AI 审查' },
  { step: 4, label: '确认保存' },
];

interface OperationBarProps {
  onSave: () => void;
  onGenerate: () => void;
  onStartReview: () => void;
  onSaveFinal: () => void;
  hasDirtyFiles: boolean;
  hasConflicts: boolean;
}

export function OperationBar({
  onSave,
  onGenerate,
  onStartReview,
  onSaveFinal,
  hasDirtyFiles,
  hasConflicts,
}: OperationBarProps) {
  const {
    currentStep,
    originalText,
    scriptText,
    selectedTemplate,
    annotations,
    generating,
    reviewing,
    setCurrentStep,
    openDrawer,
  } = useScriptStore();

  const originalStats = useMemo(() => {
    const charCount = originalText.length;
    const paragraphs = originalText.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
    const readMinutes = Math.ceil(charCount / 400);
    return { charCount, paragraphs, readMinutes };
  }, [originalText]);

  const pendingCount = useMemo(
    () => annotations.filter((a) => a.status === 'pending').length,
    [annotations],
  );
  const acceptedCount = useMemo(
    () => annotations.filter((a) => a.status === 'accepted').length,
    [annotations],
  );
  const dismissedCount = annotations.length - pendingCount - acceptedCount;

  const templateName = getAnyTemplateById(selectedTemplate)?.name ?? selectedTemplate;

  const handlePrev = useCallback(() => {
    if (currentStep > 1) setCurrentStep((currentStep - 1) as ScriptStep);
  }, [currentStep, setCurrentStep]);

  const handleNext = useCallback(() => {
    if (currentStep < 4) setCurrentStep((currentStep + 1) as ScriptStep);
  }, [currentStep, setCurrentStep]);

  const renderStepInfo = () => {
    switch (currentStep) {
      case 1:
        return (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            字数: {originalStats.charCount.toLocaleString()} | 段落: {originalStats.paragraphs} | 阅读时间: ~{originalStats.readMinutes}min
          </span>
        );
      case 2:
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              模板: {templateName}
            </span>
            <button
              type="button"
              onClick={() => openDrawer('template')}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--color-border-subtle)',
                background: 'transparent',
                color: 'var(--color-accent)',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              更换模板▼
            </button>
          </div>
        );
      case 3:
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              批注: {pendingCount}待处理 / {acceptedCount}已采纳 / {dismissedCount}已忽略
            </span>
            {annotations.length > 0 && (
              <button
                type="button"
                onClick={() => openDrawer('annotations')}
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border-subtle)',
                  background: 'transparent',
                  color: 'var(--color-accent)',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                查看批注▼
              </button>
            )}
          </div>
        );
      case 4:
        return (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            最终稿: {scriptText.length.toLocaleString()}字 | 模板: {templateName}
          </span>
        );
      default:
        return null;
    }
  };

  const renderStepActions = () => {
    switch (currentStep) {
      case 2:
        return (
          <button
            type="button"
            disabled={generating || !originalText}
            onClick={onGenerate}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 12px',
              borderRadius: 4,
              border: 'none',
              background: '#0A84FF',
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              cursor: generating ? 'wait' : 'pointer',
            }}
          >
            {generating ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {generating ? '生成中…' : scriptText ? '重新生成' : '生成口播稿'}
          </button>
        );
      case 3:
        return (
          <button
            type="button"
            disabled={reviewing || !scriptText}
            onClick={onStartReview}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 12px',
              borderRadius: 4,
              border: 'none',
              background: '#0A84FF',
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              cursor: reviewing ? 'wait' : 'pointer',
            }}
          >
            <Search size={12} />
            {reviewing ? '审查中…' : '开始审查'}
          </button>
        );
      case 4:
        return (
          <button
            type="button"
            onClick={onSaveFinal}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 12px',
              borderRadius: 4,
              border: 'none',
              background: '#32D74B',
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Save size={12} />
            保存最终稿
          </button>
        );
      default:
        return null;
    }
  };

  if (currentStep === 0) return null;

  return (
    <div
      style={{
        background: 'var(--color-panel-bg)',
        borderBottom: '1px solid var(--color-border-subtle)',
        padding: '8px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* 步骤指示器行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
        {STEPS.map(({ step, label }, index) => {
          const isCompleted = step < currentStep;
          const isActive = step === currentStep;
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: isCompleted
                    ? '#32D74B'
                    : isActive
                      ? '#0A84FF'
                      : 'var(--color-border-subtle)',
                  color: isCompleted || isActive ? '#fff' : 'var(--color-text-tertiary)',
                  fontWeight: 600,
                  fontSize: 10,
                }}
              >
                {isCompleted ? '✓' : step} {label}
              </span>
              {index < STEPS.length - 1 && (
                <span style={{ color: 'var(--color-text-tertiary)' }}>→</span>
              )}
            </div>
          );
        })}
      </div>

      {/* 操作行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {renderStepInfo()}

        <div style={{ display: 'flex', gap: 6 }}>
          {currentStep > 1 && (
            <button
              type="button"
              onClick={handlePrev}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid var(--color-border-subtle)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <ArrowLeft size={12} />
              上一步
            </button>
          )}

          <button
            type="button"
            onClick={onSave}
            disabled={!hasDirtyFiles && !hasConflicts}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 12px',
              borderRadius: 4,
              border: 'none',
              background: hasDirtyFiles ? '#0A84FF' : 'var(--color-border-subtle)',
              color: hasDirtyFiles ? '#fff' : 'var(--color-text-tertiary)',
              fontSize: 11,
              fontWeight: 600,
              cursor: hasDirtyFiles ? 'pointer' : 'default',
            }}
          >
            <Save size={12} />
            保存 ⌘S
          </button>

          {renderStepActions()}

          {currentStep < 4 && (
            <button
              type="button"
              onClick={handleNext}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 4,
                border: 'none',
                background: '#0A84FF',
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              下一步
              <ArrowRight size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/script/OperationBar.tsx
git commit -m "feat(script): 新增 OperationBar 顶部操作面板组件"
```

---

### Task 8: StepDrawer 组件

**Files:**
- Create: `src/components/script/StepDrawer.tsx`

- [ ] **Step 1: 创建 StepDrawer.tsx**

```tsx
// src/components/script/StepDrawer.tsx
import { X, CheckCheck } from 'lucide-react';
import { useScriptStore } from '../../store/script';
import { getAllTemplates } from '../../lib/script-templates';
import type { Annotation, AnnotationSeverity } from '../../store/script';

const SEVERITY_COLORS: Record<AnnotationSeverity, string> = {
  error: '#FF453A',
  warning: '#FF9F0A',
  info: '#0A84FF',
};

function TemplateList() {
  const { selectedTemplate, setSelectedTemplate, closeDrawer } = useScriptStore();
  const templates = getAllTemplates();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)' }}>
        选择写稿风格
      </span>
      {templates.map((tmpl) => {
        const isSelected = tmpl.id === selectedTemplate;
        return (
          <button
            key={tmpl.id}
            type="button"
            onClick={() => {
              setSelectedTemplate(tmpl.id);
              closeDrawer();
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '12px 14px',
              borderRadius: 10,
              border: `1px solid ${isSelected ? '#0A84FF' : 'var(--color-border-subtle)'}`,
              background: isSelected ? '#0A84FF15' : 'var(--color-panel-bg)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: isSelected ? 600 : 500,
                color: isSelected ? '#fff' : 'var(--color-text-secondary)',
              }}
            >
              {tmpl.name}
              {!tmpl.isBuiltin && (
                <span style={{ fontSize: 10, color: '#FF9F0A', marginLeft: 4 }}>自定义</span>
              )}
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {tmpl.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AnnotationItem({
  annotation,
  index,
  onAccept,
  onDismiss,
}: {
  annotation: Annotation;
  index: number;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const color = SEVERITY_COLORS[annotation.severity];
  const isPending = annotation.status === 'pending';
  const isAccepted = annotation.status === 'accepted';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${isPending ? color : isAccepted ? '#32D74B40' : 'var(--color-border-subtle)'}`,
        background: isAccepted ? '#32D74B0D' : 'transparent',
        opacity: annotation.status === 'dismissed' ? 0.5 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        <span style={{ fontWeight: 600, color: isAccepted ? '#32D74B' : color }}>
          {isAccepted ? '已采纳' : annotation.status === 'dismissed' ? '已忽略' : '待处理'}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
          #{index + 1}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
        &quot;{annotation.originalText}&quot; → {annotation.issue}
      </div>
      {isPending && annotation.suggestion !== annotation.originalText && (
        <div
          style={{
            padding: '6px 8px',
            borderRadius: 6,
            background: `color-mix(in srgb, ${color} 5%, transparent)`,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 2 }}>建议修改为：</div>
          &quot;{annotation.suggestion}&quot;
        </div>
      )}
      {isPending && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: '1px solid var(--color-border-subtle)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            忽略
          </button>
          <button
            type="button"
            onClick={onAccept}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: 'none',
              background: color,
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            采纳
          </button>
        </div>
      )}
    </div>
  );
}

function AnnotationList() {
  const { annotations, acceptAnnotation, dismissAnnotation, acceptAllAnnotations } = useScriptStore();
  const pendingCount = annotations.filter((a) => a.status === 'pending').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)' }}>
          审查批注 ({annotations.length})
        </span>
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={acceptAllAnnotations}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--color-border-subtle)',
              color: 'var(--color-text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <CheckCheck size={12} />
            全部采纳
          </button>
        )}
      </div>
      {annotations.map((ann, i) => (
        <AnnotationItem
          key={ann.id}
          annotation={ann}
          index={i}
          onAccept={() => acceptAnnotation(ann.id)}
          onDismiss={() => dismissAnnotation(ann.id)}
        />
      ))}
    </div>
  );
}

export function StepDrawer() {
  const { drawerVisible, drawerContent, closeDrawer } = useScriptStore();

  if (!drawerVisible) return null;

  return (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        background: 'var(--color-panel-bg)',
        borderLeft: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          {drawerContent === 'template' ? '写稿模板' : '审查批注'}
        </span>
        <button
          type="button"
          onClick={closeDrawer}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {drawerContent === 'template' && <TemplateList />}
        {drawerContent === 'annotations' && <AnnotationList />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/script/StepDrawer.tsx
git commit -m "feat(script): 新增 StepDrawer 右侧抽屉组件"
```

---

### Task 9: ConflictDialog 和 EmptyGuide 组件

**Files:**
- Create: `src/components/script/ConflictDialog.tsx`
- Create: `src/components/script/EmptyGuide.tsx`

- [ ] **Step 1: 创建 ConflictDialog.tsx**

```tsx
// src/components/script/ConflictDialog.tsx
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

interface ConflictDialogProps {
  conflictFiles: string[];
  onResolve: (resolutions: Record<string, 'mine' | 'theirs'>) => void;
  onCancel: () => void;
}

export function ConflictDialog({ conflictFiles, onResolve, onCancel }: ConflictDialogProps) {
  const [resolutions, setResolutions] = useState<Record<string, 'mine' | 'theirs'>>(() =>
    Object.fromEntries(conflictFiles.map((f) => [f, 'mine' as const])),
  );

  const handleConfirm = () => {
    onResolve(resolutions);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: 420,
          background: 'var(--color-panel-bg)',
          borderRadius: 12,
          border: '1px solid var(--color-border-subtle)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={18} color="#FF9F0A" />
          <span style={{ fontSize: 15, fontWeight: 600 }}>文件冲突</span>
        </div>

        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
          以下文件存在外部修改冲突，请选择处理方式：
        </p>

        {conflictFiles.map((file) => (
          <div
            key={file}
            style={{
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--color-border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>📄 {file}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['mine', 'theirs'] as const).map((choice) => (
                <label
                  key={choice}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name={`conflict-${file}`}
                    checked={resolutions[file] === choice}
                    onChange={() =>
                      setResolutions((prev) => ({ ...prev, [file]: choice }))
                    }
                  />
                  {choice === 'mine' ? '使用我的版本' : '使用外部版本'}
                </label>
              ))}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid var(--color-border-subtle)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: '#0A84FF',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            确认保存
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 EmptyGuide.tsx**

```tsx
// src/components/script/EmptyGuide.tsx
import { Upload, FilePlus } from 'lucide-react';

interface EmptyGuideProps {
  onImportFile: () => void;
  onCreateNew: () => void;
}

export function EmptyGuide({ onImportFile, onCreateNew }: EmptyGuideProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 16,
      }}
    >
      <span style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>
        当前目录中没有 original.md
      </span>
      <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
        导入已有文本文件或新建空白文稿开始工作
      </span>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          onClick={onImportFile}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#0A84FF',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Upload size={14} />
          导入文本文件
        </button>
        <button
          type="button"
          onClick={onCreateNew}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 20px',
            borderRadius: 8,
            border: '1px solid var(--color-border-subtle)',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <FilePlus size={14} />
          新建空白文稿
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/script/ConflictDialog.tsx src/components/script/EmptyGuide.tsx
git commit -m "feat(script): 新增 ConflictDialog 冲突弹窗和 EmptyGuide 引导组件"
```

---

### Task 10: 重写 ScriptWorkbench 主布局和逻辑

**Files:**
- Modify: `src/pages/ScriptWorkbench.tsx`
- Modify: `src/pages/ScriptWorkbench.module.css`

- [ ] **Step 1: 重写 ScriptWorkbench.module.css**

```css
/* src/pages/ScriptWorkbench.module.css */
.page {
  width: 100%;
  height: 100%;
  display: flex;
  background: var(--color-window-bg);
  overflow: hidden;
}

.workArea {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.editorAndDrawer {
  flex: 1;
  display: flex;
  min-height: 0;
}

.editorArea {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 8px 20px 16px;
  gap: 4px;
  min-height: 0;
}

.editorContainer {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: 0 6px 6px 6px;
}

.editorContainer [data-color-mode="dark"] {
  height: 100%;
}

.editorContainer :global(.w-md-editor) {
  height: 100% !important;
}

.conflictBar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #FF9F0A15;
  border: 1px solid #FF9F0A40;
  border-radius: 6px;
  font-size: 12px;
  color: #FF9F0A;
  margin-bottom: 4px;
}

.conflictBarButton {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #FF9F0A40;
  background: transparent;
  color: #FF9F0A;
  font-size: 11px;
  cursor: pointer;
}
```

- [ ] **Step 2: 重写 ScriptWorkbench.tsx**

```tsx
// src/pages/ScriptWorkbench.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScriptStep } from '../store/script';
import { useScriptStore } from '../store/script';
import { FileTreePanel } from '../components/script/FileTreePanel';
import { OperationBar } from '../components/script/OperationBar';
import { FileTabs } from '../components/script/FileTabs';
import { StepDrawer } from '../components/script/StepDrawer';
import { ConflictDialog } from '../components/script/ConflictDialog';
import { EmptyGuide } from '../components/script/EmptyGuide';
import { ScriptEditor } from '../ui/components/script-editor';
import { AlertProvider } from '../ui/components/alert';
import {
  isSavingFile,
  loadFullScriptState,
  loadPersistedScriptProjectDir,
  saveAllDirtyFiles,
  createPersistedScriptState,
  saveScriptState,
} from '../lib/script-persistence';
import { callLLMText } from '../lib/llm-client';
import { getAnyTemplateById } from '../lib/script-templates';
import { reviewScript } from '../lib/script-review';
import { loadAISettings } from '../store/ai';
import styles from './ScriptWorkbench.module.css';

export function ScriptWorkbench() {
  const store = useScriptStore();
  const {
    currentStep,
    originalText,
    scriptText,
    projectDir,
    annotations,
    openedFile,
    fileDirtyMap,
    fileConflictMap,
    stashedContent,
    selectedTemplate,
    generating,
    reviewing,
    setProjectDir,
    setCurrentStep,
    setOriginalText,
    setScriptText,
    setOpenedFile,
    setFileDirty,
    setFileConflict,
    stashExternalContent,
    clearAllDirty,
    clearConflict,
    setAnnotations,
    setGenerating,
    setReviewing,
    setFileEntries,
    restoreState,
  } = store;

  const [restoring, setRestoring] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  // ─── 初始化：恢复状态 ───
  useEffect(() => {
    const restore = async () => {
      if (useScriptStore.getState().projectDir) return;
      const savedDir = loadPersistedScriptProjectDir();
      if (!savedDir) return;

      setRestoring(true);
      try {
        const fullState = await loadFullScriptState(savedDir);
        if (fullState) {
          restoreState({
            projectDir: savedDir,
            currentStep: fullState.persisted.currentStep,
            originalText: fullState.originalText,
            scriptText: fullState.scriptText,
            selectedTemplate: fullState.persisted.templateId,
            annotations: fullState.persisted.annotations,
          });
        } else {
          // 目录存在但无 state，尝试读 original.md
          setProjectDir(savedDir);
        }
        // 加载文件树
        const entries = await window.electronAPI.readDirectory(savedDir);
        setFileEntries(entries);
        // 启动监听
        await window.electronAPI.startWatching(savedDir);
        // 自动打开文件
        const state = useScriptStore.getState();
        if (state.originalText && !state.openedFile) {
          setOpenedFile('original.md');
        }
      } catch (error) {
        console.error('恢复口播稿状态失败:', error);
      } finally {
        setRestoring(false);
      }
    };
    void restore();
    return () => { void window.electronAPI.stopWatching(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 文件监听：变更处理 ───
  useEffect(() => {
    const cleanup = window.electronAPI.onFileChanged((data) => {
      if (isSavingFile(data.file)) return; // 忽略自身写入
      const state = useScriptStore.getState();
      const isDirty = state.fileDirtyMap[data.file];

      if (!isDirty) {
        // clean → 直接更新
        if (data.file === 'original.md') setOriginalText(data.content);
        if (data.file === 'script.md') setScriptText(data.content);
      } else {
        // dirty → 标记冲突
        setFileConflict(data.file, true);
        stashExternalContent(data.file, data.content);
      }
    });
    return cleanup;
  }, [setOriginalText, setScriptText, setFileConflict, stashExternalContent]);

  // ─── 文件树变更监听 ───
  useEffect(() => {
    const cleanup = window.electronAPI.onFileTreeChanged(async () => {
      if (!projectDir) return;
      const entries = await window.electronAPI.readDirectory(projectDir);
      setFileEntries(entries);
    });
    return cleanup;
  }, [projectDir, setFileEntries]);

  // ─── 键盘快捷键 ⌘S ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // ─── 编辑器内容 ───
  const editorValue = openedFile === 'original.md' ? originalText : scriptText;

  const handleEditorChange = useCallback(
    (value: string) => {
      if (openedFile === 'original.md') {
        setOriginalText(value);
        setFileDirty('original.md', true);
      } else if (openedFile === 'script.md') {
        setScriptText(value);
        setFileDirty('script.md', true);
      }
    },
    [openedFile, setOriginalText, setScriptText, setFileDirty],
  );

  // ─── 保存逻辑 ───
  const hasDirtyFiles = useMemo(
    () => Object.values(fileDirtyMap).some(Boolean),
    [fileDirtyMap],
  );
  const conflictFiles = useMemo(
    () => Object.entries(fileConflictMap).filter(([, v]) => v).map(([k]) => k),
    [fileConflictMap],
  );
  const hasConflicts = conflictFiles.length > 0;

  const handleSave = useCallback(async () => {
    if (!projectDir) return;

    if (hasConflicts) {
      setShowConflictDialog(true);
      return;
    }

    const getText = (file: string) => {
      if (file === 'original.md') return useScriptStore.getState().originalText;
      if (file === 'script.md') return useScriptStore.getState().scriptText;
      return '';
    };

    await saveAllDirtyFiles(projectDir, fileDirtyMap, getText);
    clearAllDirty();

    // 同时保存元数据
    const state = useScriptStore.getState();
    await saveScriptState(
      projectDir,
      createPersistedScriptState(state.currentStep, state.selectedTemplate, state.annotations),
    );
  }, [projectDir, fileDirtyMap, hasConflicts, clearAllDirty]);

  const handleConflictResolve = useCallback(
    async (resolutions: Record<string, 'mine' | 'theirs'>) => {
      for (const [file, choice] of Object.entries(resolutions)) {
        if (choice === 'theirs') {
          const content = stashedContent[file];
          if (content !== undefined) {
            if (file === 'original.md') setOriginalText(content);
            if (file === 'script.md') setScriptText(content);
          }
        }
        clearConflict(file);
        setFileDirty(file, false);
      }
      setShowConflictDialog(false);

      // 保存"mine"选择的文件
      const mineFiles = Object.entries(resolutions)
        .filter(([, choice]) => choice === 'mine')
        .map(([file]) => file);
      if (mineFiles.length > 0 && projectDir) {
        const dirtyMap = Object.fromEntries(mineFiles.map((f) => [f, true]));
        const getText = (file: string) => {
          if (file === 'original.md') return useScriptStore.getState().originalText;
          if (file === 'script.md') return useScriptStore.getState().scriptText;
          return '';
        };
        await saveAllDirtyFiles(projectDir, dirtyMap, getText);
      }
    },
    [projectDir, stashedContent, setOriginalText, setScriptText, clearConflict, setFileDirty],
  );

  // ─── 选择工作目录 ───
  const handleSelectDirectory = useCallback(async () => {
    const dir = await window.electronAPI.selectProjectDirectory();
    if (!dir) return;

    setProjectDir(dir);

    // 加载文件树
    const entries = await window.electronAPI.readDirectory(dir);
    setFileEntries(entries);

    // 启动监听
    await window.electronAPI.startWatching(dir);

    // 自动检测状态
    const fullState = await loadFullScriptState(dir);
    if (fullState) {
      restoreState({
        projectDir: dir,
        currentStep: fullState.persisted.currentStep,
        originalText: fullState.originalText,
        scriptText: fullState.scriptText,
        selectedTemplate: fullState.persisted.templateId,
        annotations: fullState.persisted.annotations,
      });
      setOpenedFile(fullState.originalText ? 'original.md' : null);
    } else {
      // 尝试读 original.md
      const original = await window.electronAPI.loadScriptFile(dir, 'original.md');
      if (original) {
        setOriginalText(original);
        setCurrentStep(1);
        setOpenedFile('original.md');
      }
      // 无 original.md → 保持 step 0，显示 EmptyGuide
    }
  }, [setProjectDir, setFileEntries, restoreState, setOpenedFile, setOriginalText, setCurrentStep]);

  // ─── 导入/新建文稿 ───
  const handleImportFile = useCallback(async () => {
    const result = await window.electronAPI.selectTextFile();
    if (!result || !projectDir) return;

    setOriginalText(result.content);
    await window.electronAPI.saveScriptFile(projectDir, 'original.md', result.content);
    setCurrentStep(1);
    setOpenedFile('original.md');

    const entries = await window.electronAPI.readDirectory(projectDir);
    setFileEntries(entries);
  }, [projectDir, setOriginalText, setCurrentStep, setOpenedFile, setFileEntries]);

  const handleCreateNew = useCallback(async () => {
    if (!projectDir) return;
    setOriginalText('');
    await window.electronAPI.saveScriptFile(projectDir, 'original.md', '');
    setCurrentStep(1);
    setOpenedFile('original.md');

    const entries = await window.electronAPI.readDirectory(projectDir);
    setFileEntries(entries);
  }, [projectDir, setOriginalText, setCurrentStep, setOpenedFile, setFileEntries]);

  // ─── 生成口播稿 ───
  const handleGenerate = useCallback(async () => {
    const template = getAnyTemplateById(selectedTemplate);
    if (!template || !originalText) return;

    const settings = loadAISettings();
    if (!settings?.llmApiKey) {
      alert('请先在 AI 设置中配置 LLM API Key');
      return;
    }

    setGenerating(true);
    try {
      const result = await callLLMText(settings, template.systemPrompt, originalText);
      setScriptText(result);
      setFileDirty('script.md', true);
      setOpenedFile('script.md');
    } catch (error) {
      console.error('生成口播稿失败:', error);
      alert(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setGenerating(false);
    }
  }, [originalText, selectedTemplate, setScriptText, setGenerating, setFileDirty, setOpenedFile]);

  // ─── AI 审查 ───
  const handleStartReview = useCallback(async () => {
    const settings = loadAISettings();
    if (!settings?.llmApiKey) {
      alert('请先在 AI 设置中配置 LLM API Key');
      return;
    }

    setReviewing(true);
    try {
      const result = await reviewScript(settings, scriptText);
      setAnnotations(result);
    } catch (error) {
      console.error('AI 审查失败:', error);
      alert(`审查失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setReviewing(false);
    }
  }, [scriptText, setAnnotations, setReviewing]);

  // ─── 保存最终稿 ───
  const handleSaveFinal = useCallback(async () => {
    if (!projectDir) return;
    await window.electronAPI.saveScriptFile(projectDir, 'script.md', scriptText);
    const state = useScriptStore.getState();
    await saveScriptState(
      projectDir,
      createPersistedScriptState(state.currentStep, state.selectedTemplate, state.annotations),
    );
    clearAllDirty();
    alert('口播稿已保存');
  }, [projectDir, scriptText, clearAllDirty]);

  // ─── 步骤切换时自动打开对应文件 ───
  useEffect(() => {
    if (currentStep === 1 || currentStep === 2) {
      if (originalText) setOpenedFile('original.md');
    } else if (currentStep === 3 || currentStep === 4) {
      if (scriptText) setOpenedFile('script.md');
    }
  }, [currentStep, originalText, scriptText, setOpenedFile]);

  // ─── 渲染 ───
  if (restoring) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-text-tertiary)',
          fontSize: 14,
        }}
      >
        正在恢复上次工作状态…
      </div>
    );
  }

  const isEditorVisible = projectDir && openedFile && (currentStep > 0 || originalText);
  const showEmptyGuide = projectDir && currentStep === 0 && !originalText;
  const showAnnotations = openedFile === 'script.md' && annotations.length > 0;
  const currentFileConflict = openedFile ? fileConflictMap[openedFile] : false;

  return (
    <AlertProvider>
      <div className={styles.page}>
        <FileTreePanel onSelectDirectory={handleSelectDirectory} />

        <div className={styles.workArea}>
          <OperationBar
            onSave={handleSave}
            onGenerate={handleGenerate}
            onStartReview={handleStartReview}
            onSaveFinal={handleSaveFinal}
            hasDirtyFiles={hasDirtyFiles}
            hasConflicts={hasConflicts}
          />

          <div className={styles.editorAndDrawer}>
            <div className={styles.editorArea}>
              <FileTabs />

              {currentFileConflict && openedFile && (
                <div className={styles.conflictBar}>
                  <span>⚠ 此文件已被外部修改</span>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    className={styles.conflictBarButton}
                    onClick={() => {
                      const content = stashedContent[openedFile];
                      if (content !== undefined) {
                        if (openedFile === 'original.md') setOriginalText(content);
                        if (openedFile === 'script.md') setScriptText(content);
                      }
                      clearConflict(openedFile);
                      setFileDirty(openedFile, false);
                    }}
                  >
                    使用外部版本
                  </button>
                  <button
                    type="button"
                    className={styles.conflictBarButton}
                    onClick={() => clearConflict(openedFile)}
                  >
                    保留当前版本
                  </button>
                </div>
              )}

              <div className={styles.editorContainer}>
                {showEmptyGuide ? (
                  <EmptyGuide
                    onImportFile={handleImportFile}
                    onCreateNew={handleCreateNew}
                  />
                ) : isEditorVisible ? (
                  <ScriptEditor
                    value={editorValue}
                    onChange={handleEditorChange}
                    placeholder={
                      openedFile === 'original.md' ? '报告原文内容...' : '口播稿内容...'
                    }
                    annotations={showAnnotations ? annotations : undefined}
                    onAcceptAnnotation={
                      showAnnotations ? store.acceptAnnotation : undefined
                    }
                    onDismissAnnotation={
                      showAnnotations ? store.dismissAnnotation : undefined
                    }
                  />
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: 'var(--color-text-tertiary)',
                      fontSize: 14,
                    }}
                  >
                    {projectDir
                      ? '在左侧文件树中点击文件打开编辑'
                      : '在左侧选择工作目录开始'}
                  </div>
                )}
              </div>
            </div>

            <StepDrawer />
          </div>
        </div>

        {showConflictDialog && (
          <ConflictDialog
            conflictFiles={conflictFiles}
            onResolve={handleConflictResolve}
            onCancel={() => setShowConflictDialog(false)}
          />
        )}
      </div>
    </AlertProvider>
  );
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/ScriptWorkbench.tsx src/pages/ScriptWorkbench.module.css
git commit -m "feat(script): 重写 ScriptWorkbench 主布局为文件树+操作面板+编辑器"
```

---

### Task 11: 更新 StepIndicator 适配新 4 步流程

**Files:**
- Modify: `src/components/script/StepIndicator.tsx`

- [ ] **Step 1: 更新步骤配置**

这个组件现在由 OperationBar 内联的步骤指示器替代。如果其他地方没有引用，可以保留但不再被 ScriptWorkbench 导入。

检查引用：

```bash
grep -r "StepIndicator" src/ --include="*.tsx" --include="*.ts" -l
```

如果只有 ScriptWorkbench.tsx 和自身，且 ScriptWorkbench 已不再导入它，则无需修改。保留文件以备将来使用。

- [ ] **Step 2: Commit（如有修改）**

```bash
git add src/components/script/StepIndicator.tsx
git commit -m "refactor(script): StepIndicator 适配新步骤编号"
```

---

### Task 12: 删除 StepInitialize，精简旧步骤组件

**Files:**
- Delete: `src/components/script/StepInitialize.tsx`
- Modify: `src/components/script/StepReviewOriginal.tsx`
- Modify: `src/components/script/StepGenerate.tsx`
- Modify: `src/components/script/StepAIReview.tsx`
- Modify: `src/components/script/StepConfirm.tsx`

- [ ] **Step 1: 删除 StepInitialize.tsx**

```bash
git rm src/components/script/StepInitialize.tsx
```

- [ ] **Step 2: 确认无残余引用**

```bash
grep -r "StepInitialize" src/ --include="*.tsx" --include="*.ts"
```

ScriptWorkbench.tsx 已在 Task 10 中移除了对 StepInitialize 的导入。如果有测试文件引用，也需要更新。

- [ ] **Step 3: 更新步骤组件中的步骤编号**

各步骤组件中调用 `setCurrentStep()` 的数值需要更新（原 1-5 → 新 0-4）：

**StepReviewOriginal.tsx**：`setCurrentStep(1)` → `setCurrentStep(0 as ScriptStep)` 已不需要（上一步按钮移到 OperationBar），`setCurrentStep(3)` → 不需要（下一步按钮也在 OperationBar）。这个组件的导航按钮可以移除，只保留统计信息展示（但统计信息也已移到 OperationBar）。

由于所有导航和操作都已移到 OperationBar，旧的步骤组件（StepReviewOriginal、StepGenerate、StepAIReview、StepConfirm）不再被 ScriptWorkbench 直接渲染。它们的内容已被拆分到 OperationBar 和 StepDrawer 中。

确认这些组件不再被导入：

```bash
grep -rE "StepReviewOriginal|StepGenerate|StepAIReview|StepConfirm" src/pages/ --include="*.tsx"
```

如果 ScriptWorkbench.tsx 已不再导入它们，可以保留文件但不再使用，或直接删除。建议保留以免丢失逻辑参考。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(script): 移除 StepInitialize，步骤逻辑迁移到 OperationBar/StepDrawer"
```

---

### Task 13: 修复编译错误和类型一致性

**Files:**
- 可能涉及多个文件

- [ ] **Step 1: 运行完整类型检查**

```bash
npx tsc --noEmit 2>&1
```

- [ ] **Step 2: 逐个修复编译错误**

常见需要修复的：
- `ScriptStep` 类型变更（0-4 vs 1-5）导致的引用错误
- `debouncedSaveFile` 已删除导致的引用错误（StepGenerate.tsx 中有引用）
- `ScriptWorkbenchProps` 接口已移除（不再接受 `onBack` prop）

**修复 App.tsx（第 463 行）**：将 `<ScriptWorkbench onBack={() => setPage('welcome')} />` 改为 `<ScriptWorkbench />`：

```tsx
// src/App.tsx:462-463
) : page === 'script-workbench' ? (
  <ScriptWorkbench />
```

- [ ] **Step 3: 修复测试引用**

```bash
grep -rn "StepInitialize\|debouncedSaveFile\|ScriptStep.*[15]" tests/ --include="*.ts" --include="*.tsx" | head -20
```

更新测试文件中的过时引用。

- [ ] **Step 4: 运行测试**

```bash
npx vitest run 2>&1 | tail -30
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: 修复文件树重构后的编译错误和类型一致性"
```

---

### Task 14: 端到端验证和收尾

**Files:**
- 可能涉及 `.gitignore`

- [ ] **Step 1: 确保 .superpowers 在 .gitignore**

```bash
grep -q ".superpowers" .gitignore || echo ".superpowers/" >> .gitignore
```

- [ ] **Step 2: 运行完整编译检查**

```bash
npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: 运行全部测试**

```bash
npx vitest run
```

Expected: 所有测试通过（或仅有与此次重构无关的已有失败）

- [ ] **Step 4: 启动开发服务器验证**

```bash
npm run dev
```

手动验证：
1. 启动后文件树显示空状态
2. 点击"选择工作目录"能唤起系统对话框
3. 选择目录后文件树显示文件列表
4. 如果有 script-state.json 能恢复状态
5. 操作面板显示步骤指示器和操作按钮
6. ⌘S 能保存所有修改的文件
7. 文件标签栏能切换 original.md / script.md

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: 文件树重构收尾，更新 gitignore"
```

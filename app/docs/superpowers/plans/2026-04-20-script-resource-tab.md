# 写稿工作台 · 稿件资源 Tab 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute the four parallel tracks below, then superpowers:executing-plans for the sequential integration task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在写稿工作台左侧文件树顶部新增「稿件资源」Tab，按「原始文稿 / 口播脚本 / 抖音导入」三组展示关键文件，支持搜索过滤与中文命名。

**Architecture:** 三条独立轨道（纯逻辑 lib、store 扩展、组件 + 样式）+ 一条集成轨道。全部复用 `src/ui/` 库组件（`Tabs` / `Input` / `Badge` / `EmptyState`），不重写 UI 原子。

**Tech Stack:** React 19 / TypeScript / Zustand / Vitest / TailwindCSS 4 / `src/ui/components/tabs.tsx` / `src/ui/components/input.tsx` / `src/ui/components/badge.tsx` / `src/ui/primitives/EmptyState.tsx`

**Spec:** `docs/superpowers/specs/2026-04-20-script-resource-tab-design.md`

---

## 共享类型契约（所有 Track 统一使用）

此块内容须与 `src/lib/workspace-resources.ts`（Track 1）中导出的类型完全一致。Track 2/3 独立开发时直接按此契约 import 即可，无需等待 Track 1。

```ts
// src/lib/workspace-resources.ts 对外导出的类型
import type { FileEntry } from './electron-api';

export type ResourceGroup = 'original' | 'script' | 'douyin';

export interface ResourceItem {
  path: string;              // 相对路径，与 onOpenFile 一致
  displayName: string;       // 中文展示名
  group: ResourceGroup;
  subtitle?: string;         // 副标题：videoId 或提示文本
  loading?: boolean;         // 当前是否正在解析 preview.json
}

export interface PreviewMeta {
  title: string;
  videoId: string;
}

export type PreviewMetaCache = Map<string, PreviewMeta | 'failed'>;
```

`PersistedScriptState`（Track 2）新增字段：

```ts
fileTreeView?: 'all' | 'resources';   // 默认 'all'
```

---

## 文件清单总览

### 新增

- `src/lib/workspace-resources.ts` — Track 1
- `src/components/script/FileTreeTabs.tsx` — Track 4（集成）
- `src/components/script/ScriptResourceView.tsx` — Track 3
- `src/components/script/ScriptResourceView.module.css` — Track 3
- `tests/script-workspace-resources.test.ts` — Track 1
- `tests/script-resource-view.test.tsx` — Track 3

### 修改

- `src/store/script.ts` — Track 2（新增 `fileTreeView` 状态 + setter）
- `src/lib/script-persistence.ts` — Track 2（扩展 `PersistedScriptState` + `createPersistedScriptState`）
- `src/components/script/FileTreePanel.tsx` — Track 4（接入 Tabs）
- `src/components/script/FileTreePanel.module.css` — Track 4（容器布局调整）
- `src/pages/ScriptWorkbench.tsx` — Track 4（恢复/保存 `fileTreeView`）
- `tests/script-persistence.test.ts` — Track 2（补充字段持久化用例）

---

## Track 1 · 工作区资源 lib（独立可并行）

**Scope write:** `src/lib/workspace-resources.ts`、`tests/script-workspace-resources.test.ts`
**依赖：** 无

### Task 1.1：创建 `workspace-resources.ts` 骨架与类型导出

**Files:**
- Create: `src/lib/workspace-resources.ts`

- [ ] **Step 1: 写 lib 文件**

```ts
// src/lib/workspace-resources.ts
import type { FileEntry } from './electron-api';
import { isVideoImportPreviewFile, parseVideoImportPreviewDocument } from './video-import-preview';

export type ResourceGroup = 'original' | 'script' | 'douyin';

export interface ResourceItem {
  path: string;
  displayName: string;
  group: ResourceGroup;
  subtitle?: string;
  loading?: boolean;
}

export interface PreviewMeta {
  title: string;
  videoId: string;
}

export type PreviewMetaCache = Map<string, PreviewMeta | 'failed'>;

const ORIGINAL_FILE = 'original.md';
const SCRIPT_FILE = 'script.md';

function walkFiles(entries: FileEntry[], prefix = ''): { path: string; entry: FileEntry }[] {
  const out: { path: string; entry: FileEntry }[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === 'directory') {
      if (entry.children?.length) out.push(...walkFiles(entry.children, path));
    } else {
      out.push({ path, entry });
    }
  }
  return out;
}

function extractVideoId(previewPath: string): string {
  const parts = previewPath.split('/');
  return parts[parts.length - 2] ?? previewPath;
}

export function collectScriptResources(
  fileEntries: FileEntry[],
  cache: PreviewMetaCache,
): ResourceItem[] {
  const files = walkFiles(fileEntries);
  const items: ResourceItem[] = [];

  for (const { path } of files) {
    if (path === ORIGINAL_FILE) {
      items.push({ path, displayName: '原始文稿', group: 'original', subtitle: ORIGINAL_FILE });
    } else if (path === SCRIPT_FILE) {
      items.push({ path, displayName: '口播脚本', group: 'script', subtitle: SCRIPT_FILE });
    } else if (isVideoImportPreviewFile(path)) {
      const videoId = extractVideoId(path);
      const cached = cache.get(path);
      if (cached === 'failed') {
        items.push({
          path,
          displayName: videoId,
          group: 'douyin',
          subtitle: '抖音 · 解析失败',
        });
      } else if (cached) {
        items.push({
          path,
          displayName: cached.title || videoId,
          group: 'douyin',
          subtitle: `抖音 · ${cached.videoId || videoId}`,
        });
      } else {
        items.push({
          path,
          displayName: videoId,
          group: 'douyin',
          subtitle: '抖音 · 解析中',
          loading: true,
        });
      }
    }
  }

  return items;
}

export function listUncachedPreviewPaths(
  items: ResourceItem[],
  cache: PreviewMetaCache,
): string[] {
  return items
    .filter((it) => it.group === 'douyin' && !cache.has(it.path))
    .map((it) => it.path);
}

export async function hydratePreviewMeta(
  projectDir: string,
  paths: string[],
  cache: PreviewMetaCache,
  loadScriptFile: (dir: string, rel: string) => Promise<string | null>,
): Promise<PreviewMetaCache> {
  for (const path of paths) {
    try {
      const content = await loadScriptFile(projectDir, path);
      if (!content) {
        cache.set(path, 'failed');
        continue;
      }
      const doc = parseVideoImportPreviewDocument(content);
      if (!doc) {
        cache.set(path, 'failed');
        continue;
      }
      cache.set(path, { title: doc.title, videoId: doc.videoId });
    } catch {
      cache.set(path, 'failed');
    }
  }
  return cache;
}

export function filterResources(items: ResourceItem[], query: string): ResourceItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (it) =>
      it.displayName.toLowerCase().includes(q) ||
      (it.subtitle?.toLowerCase().includes(q) ?? false) ||
      it.path.toLowerCase().includes(q),
  );
}

export function groupResources(items: ResourceItem[]): Record<ResourceGroup, ResourceItem[]> {
  return {
    original: items.filter((it) => it.group === 'original'),
    script: items.filter((it) => it.group === 'script'),
    douyin: items.filter((it) => it.group === 'douyin'),
  };
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增报错

### Task 1.2：单元测试

**Files:**
- Create: `tests/script-workspace-resources.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/script-workspace-resources.test.ts
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/lib/electron-api';
import {
  collectScriptResources,
  filterResources,
  groupResources,
  hydratePreviewMeta,
  listUncachedPreviewPaths,
  type PreviewMetaCache,
} from '../src/lib/workspace-resources';

const previewContent = JSON.stringify({
  schema: 'video-import-preview',
  version: 1,
  title: '周杰伦新专辑回归',
  videoId: 'v_abc123',
  media: { videoPath: '/v.mp4' },
  transcript: { text: '', segments: [] },
  metadata: { sourceUrl: 'https://douyin.com/x' },
});

function makeEntries(): FileEntry[] {
  return [
    { name: 'original.md', type: 'file' },
    { name: 'script.md', type: 'file' },
    { name: 'notes.md', type: 'file' },
    {
      name: 'douyin',
      type: 'directory',
      children: [
        {
          name: 'v_abc123',
          type: 'directory',
          children: [
            { name: 'preview.json', type: 'file' },
            { name: 'video.mp4', type: 'file' },
          ],
        },
        {
          name: 'v_def456',
          type: 'directory',
          children: [{ name: 'preview.json', type: 'file' }],
        },
      ],
    },
  ];
}

describe('collectScriptResources', () => {
  it('groups original / script / douyin files and skips unrelated ones', () => {
    const cache: PreviewMetaCache = new Map();
    const items = collectScriptResources(makeEntries(), cache);

    expect(items.map((i) => i.path)).toEqual([
      'original.md',
      'script.md',
      'douyin/v_abc123/preview.json',
      'douyin/v_def456/preview.json',
    ]);
    expect(items[0].displayName).toBe('原始文稿');
    expect(items[1].displayName).toBe('口播脚本');
    expect(items[2].displayName).toBe('v_abc123');
    expect(items[2].loading).toBe(true);
  });

  it('uses cached title for douyin previews', () => {
    const cache: PreviewMetaCache = new Map([
      ['douyin/v_abc123/preview.json', { title: '周杰伦新专辑回归', videoId: 'v_abc123' }],
    ]);
    const items = collectScriptResources(makeEntries(), cache);
    const hit = items.find((i) => i.path === 'douyin/v_abc123/preview.json');
    expect(hit?.displayName).toBe('周杰伦新专辑回归');
    expect(hit?.subtitle).toBe('抖音 · v_abc123');
    expect(hit?.loading).toBeUndefined();
  });

  it('falls back when cache marks a preview as failed', () => {
    const cache: PreviewMetaCache = new Map([
      ['douyin/v_abc123/preview.json', 'failed' as const],
    ]);
    const items = collectScriptResources(makeEntries(), cache);
    const hit = items.find((i) => i.path === 'douyin/v_abc123/preview.json');
    expect(hit?.displayName).toBe('v_abc123');
    expect(hit?.subtitle).toBe('抖音 · 解析失败');
  });
});

describe('hydratePreviewMeta', () => {
  it('parses valid preview and writes cache', async () => {
    const cache: PreviewMetaCache = new Map();
    const loader = async (_dir: string, rel: string) =>
      rel === 'douyin/v_abc123/preview.json' ? previewContent : null;
    await hydratePreviewMeta('/proj', ['douyin/v_abc123/preview.json'], cache, loader);
    expect(cache.get('douyin/v_abc123/preview.json')).toEqual({
      title: '周杰伦新专辑回归',
      videoId: 'v_abc123',
    });
  });

  it('marks failed when file missing or schema invalid', async () => {
    const cache: PreviewMetaCache = new Map();
    const loader = async (_dir: string, rel: string) => (rel === 'a' ? null : '{"bad":true}');
    await hydratePreviewMeta('/proj', ['a', 'b'], cache, loader);
    expect(cache.get('a')).toBe('failed');
    expect(cache.get('b')).toBe('failed');
  });
});

describe('listUncachedPreviewPaths', () => {
  it('returns only douyin items missing from cache', () => {
    const cache: PreviewMetaCache = new Map([
      ['douyin/v_abc123/preview.json', { title: 't', videoId: 'v_abc123' }],
    ]);
    const items = collectScriptResources(makeEntries(), cache);
    expect(listUncachedPreviewPaths(items, cache)).toEqual(['douyin/v_def456/preview.json']);
  });
});

describe('filterResources', () => {
  it('matches displayName / subtitle / path case-insensitively', () => {
    const items = collectScriptResources(makeEntries(), new Map());
    expect(filterResources(items, '原始').length).toBe(1);
    expect(filterResources(items, 'ABC123').length).toBe(1);
    expect(filterResources(items, 'script.md').length).toBe(1);
    expect(filterResources(items, '')).toHaveLength(items.length);
  });
});

describe('groupResources', () => {
  it('splits items by group', () => {
    const items = collectScriptResources(makeEntries(), new Map());
    const g = groupResources(items);
    expect(g.original).toHaveLength(1);
    expect(g.script).toHaveLength(1);
    expect(g.douyin).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行测试验证红**

Run: `npx vitest run tests/script-workspace-resources.test.ts`
Expected: 首次运行应在 Task 1.1 实现后直接 PASS；若未运行 1.1，则 FAIL（模块未找到）。

- [ ] **Step 3: 运行测试验证绿**

Run: `npx vitest run tests/script-workspace-resources.test.ts`
Expected: 所有用例 PASS

- [ ] **Step 4: 提交**

```bash
git add src/lib/workspace-resources.ts tests/script-workspace-resources.test.ts
git commit -m "feat(workspace-resources): 新增稿件资源收集与 preview 解析 lib"
```

---

## Track 2 · store 与持久化扩展（独立可并行）

**Scope write:** `src/store/script.ts`、`src/lib/script-persistence.ts`、`tests/script-persistence.test.ts`
**依赖：** 无

### Task 2.1：扩展 `PersistedScriptState` + `createPersistedScriptState`

**Files:**
- Modify: `src/lib/script-persistence.ts` (PersistedScriptState interface + createPersistedScriptState signature)

- [ ] **Step 1: 在 interface 中新增字段**

在 `PersistedScriptState` interface 末尾添加：

```ts
  /** 文件树当前视图：'all' 显示完整文件树，'resources' 显示稿件资源过滤视图 */
  fileTreeView?: 'all' | 'resources';
```

- [ ] **Step 2: 在 `createPersistedScriptState` options 中透传**

```ts
// 修改 options 形参
options?: {
  createdAt?: string;
  manualStageOverride?: WorkbenchStage | null;
  selectedProviderId?: string | null;
  selectedModel?: string | null;
  fileTreeView?: 'all' | 'resources';   // 新增
},
```

并在返回对象末尾添加：

```ts
    fileTreeView: options?.fileTreeView ?? 'all',
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增报错

### Task 2.2：`script.ts` store 新增 `fileTreeView` 状态与 setter

**Files:**
- Modify: `src/store/script.ts`

- [ ] **Step 1: `ScriptState` interface 新增字段**

在 `ScriptState` interface 末尾（`pendingDouyinUrl` 之后）新增：

```ts
  /** 文件树当前视图：'all' 显示全部文件，'resources' 显示稿件资源过滤视图 */
  fileTreeView: 'all' | 'resources';
```

- [ ] **Step 2: `ScriptActions` interface 新增 setter**

```ts
  setFileTreeView: (view: 'all' | 'resources') => void;
```

- [ ] **Step 3: state 初始值**

在 `useScriptStore` 的 `create` 初始 state 对象中添加：

```ts
  fileTreeView: 'all',
```

- [ ] **Step 4: action 实现**

在 actions 区块中添加：

```ts
  setFileTreeView: (view) => set({ fileTreeView: view }),
```

- [ ] **Step 5: `restoreState` params 扩展**

在 `restoreState` 的 params 类型中加一个可选字段：

```ts
  fileTreeView?: 'all' | 'resources';
```

在其实现中恢复：

```ts
  ...(params.fileTreeView ? { fileTreeView: params.fileTreeView } : {}),
```

（若 params 已是逐字段 spread，只需确保 `fileTreeView` 落入 state。）

- [ ] **Step 6: `reset` / `clearProjectSession` 回到默认**

在这两个 action 中将 `fileTreeView` 重置为 `'all'`。

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错

### Task 2.3：持久化测试

**Files:**
- Modify: `tests/script-persistence.test.ts`

- [ ] **Step 1: 新增用例**

在 `tests/script-persistence.test.ts` 任意 describe 下新增：

```ts
import { createPersistedScriptState, parsePersistedScriptState } from '../src/lib/script-persistence';

describe('fileTreeView persistence', () => {
  it('defaults to "all" when option not provided', () => {
    const state = createPersistedScriptState('idle', 0, 'news-broadcast', []);
    expect(state.fileTreeView).toBe('all');
  });

  it('persists explicit fileTreeView option', () => {
    const state = createPersistedScriptState('idle', 0, 'news-broadcast', [], {
      fileTreeView: 'resources',
    });
    expect(state.fileTreeView).toBe('resources');
  });

  it('parses and preserves fileTreeView from saved json', () => {
    const saved = {
      version: 2,
      templateId: 'news-broadcast',
      annotations: [],
      reviewState: 'idle',
      lastReviewedDocVersion: 0,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
      fileTreeView: 'resources',
    };
    const parsed = parsePersistedScriptState(saved);
    expect(parsed?.fileTreeView).toBe('resources');
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/script-persistence.test.ts`
Expected: 新用例 PASS，旧用例不退化

- [ ] **Step 3: 提交**

```bash
git add src/lib/script-persistence.ts src/store/script.ts tests/script-persistence.test.ts
git commit -m "feat(script-store): 新增 fileTreeView 状态与持久化字段"
```

---

## Track 3 · `ScriptResourceView` 组件与测试（独立可并行）

**Scope write:** `src/components/script/ScriptResourceView.tsx`、`src/components/script/ScriptResourceView.module.css`、`tests/script-resource-view.test.tsx`
**依赖：** 共享类型契约（直接 import `src/lib/workspace-resources`）；Track 1 需在运行时可用，本 Track 实现阶段若 Track 1 尚未合并，可 mock lib 函数完成测试。

### Task 3.1：组件实现

**Files:**
- Create: `src/components/script/ScriptResourceView.tsx`
- Create: `src/components/script/ScriptResourceView.module.css`

- [ ] **Step 1: 写组件**

```tsx
// src/components/script/ScriptResourceView.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Film, Search } from 'lucide-react';
import type { FileEntry } from '../../lib/electron-api';
import { Badge, Input } from '../../ui';
import { EmptyState } from '../../ui';
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
};

function iconForGroup(group: ResourceGroup) {
  if (group === 'douyin') return <Film size={14} strokeWidth={1.8} />;
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
          description="导入文稿或抖音视频后，会在此快速访问。"
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
```

- [ ] **Step 2: 写样式**

```css
/* src/components/script/ScriptResourceView.module.css */
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.searchBar {
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-separator);
}

.groups {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.groupSection {
  padding: 4px 0 8px;
}

.groupHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.groupTitle {
  letter-spacing: 0;
}

.groupList {
  display: flex;
  flex-direction: column;
}

.row {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  height: 26px;
  background: transparent;
  border: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.row:hover {
  background: var(--color-panel-elevated);
}

.rowActive {
  background: var(--color-panel-elevated);
}

.rowIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}

.rowMain {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.rowTitle {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
}

.rowSubtitle {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.rowMeta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-secondary);
}

.dirtyDot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-system-blue);
}

.conflictMark {
  font-size: 12px;
  color: var(--color-warning);
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错

### Task 3.2：组件测试

**Files:**
- Create: `tests/script-resource-view.test.tsx`

- [ ] **Step 1: 写测试**

```tsx
// tests/script-resource-view.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptResourceView } from '../src/components/script/ScriptResourceView';
import type { FileEntry } from '../src/lib/electron-api';

const previewContent = JSON.stringify({
  schema: 'video-import-preview',
  version: 1,
  title: '周杰伦新专辑回归',
  videoId: 'v_abc123',
  media: { videoPath: '/v.mp4' },
  transcript: { text: '', segments: [] },
  metadata: { sourceUrl: 'https://douyin.com/x' },
});

function makeEntries(): FileEntry[] {
  return [
    { name: 'original.md', type: 'file' },
    { name: 'script.md', type: 'file' },
    {
      name: 'douyin',
      type: 'directory',
      children: [
        {
          name: 'v_abc123',
          type: 'directory',
          children: [{ name: 'preview.json', type: 'file' }],
        },
      ],
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal('window', {
    electronAPI: {
      loadScriptFile: vi.fn().mockResolvedValue(previewContent),
    },
  });
});

describe('ScriptResourceView', () => {
  it('renders grouped resources and hydrates douyin title', async () => {
    const onOpenFile = vi.fn();
    render(
      <ScriptResourceView
        projectDir="/proj"
        fileEntries={makeEntries()}
        openedFile={null}
        fileDirtyMap={{}}
        fileConflictMap={{}}
        onOpenFile={onOpenFile}
      />,
    );

    expect(screen.getByText('原始文稿')).toBeInTheDocument();
    expect(screen.getByText('口播脚本')).toBeInTheDocument();
    expect(screen.getByText('抖音导入')).toBeInTheDocument();
    // 初始显示 videoId 占位
    expect(screen.getByText('v_abc123')).toBeInTheDocument();

    // 等待解析完成替换为 title
    await waitFor(() => {
      expect(screen.getByText('周杰伦新专辑回归')).toBeInTheDocument();
    });
  });

  it('filters by Chinese keyword', async () => {
    render(
      <ScriptResourceView
        projectDir="/proj"
        fileEntries={makeEntries()}
        openedFile={null}
        fileDirtyMap={{}}
        fileConflictMap={{}}
        onOpenFile={() => {}}
      />,
    );

    const searchInput = screen.getByPlaceholderText('搜索稿件...');
    fireEvent.change(searchInput, { target: { value: '口播' } });

    expect(screen.getByText('口播脚本')).toBeInTheDocument();
    // 原始文稿分组应被隐藏（分组标题不再出现）
    expect(screen.queryByText('原始文稿')).toBeNull();
  });

  it('shows empty state when no resources present', () => {
    render(
      <ScriptResourceView
        projectDir="/proj"
        fileEntries={[{ name: 'notes.md', type: 'file' }]}
        openedFile={null}
        fileDirtyMap={{}}
        fileConflictMap={{}}
        onOpenFile={() => {}}
      />,
    );
    expect(screen.getByText('暂无稿件资源')).toBeInTheDocument();
  });

  it('shows no-match empty state when search does not hit', async () => {
    render(
      <ScriptResourceView
        projectDir="/proj"
        fileEntries={makeEntries()}
        openedFile={null}
        fileDirtyMap={{}}
        fileConflictMap={{}}
        onOpenFile={() => {}}
      />,
    );
    const searchInput = screen.getByPlaceholderText('搜索稿件...');
    fireEvent.change(searchInput, { target: { value: 'zzz_no_such_thing' } });
    expect(screen.getByText('未找到匹配资源')).toBeInTheDocument();
  });

  it('invokes onOpenFile when a row is clicked', () => {
    const onOpenFile = vi.fn();
    render(
      <ScriptResourceView
        projectDir="/proj"
        fileEntries={makeEntries()}
        openedFile={null}
        fileDirtyMap={{}}
        fileConflictMap={{}}
        onOpenFile={onOpenFile}
      />,
    );
    fireEvent.click(screen.getByText('原始文稿'));
    expect(onOpenFile).toHaveBeenCalledWith('original.md');
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/script-resource-view.test.tsx`
Expected: 全部 PASS（需要 Track 1 的 lib 已合并 / 存在才能通过运行时用例）

- [ ] **Step 3: 提交**

```bash
git add src/components/script/ScriptResourceView.tsx src/components/script/ScriptResourceView.module.css tests/script-resource-view.test.tsx
git commit -m "feat(script-workbench): 新增稿件资源视图组件"
```

---

## Track 4 · 集成（顺序执行，依赖 Track 1/2/3）

**Scope write:** `src/components/script/FileTreeTabs.tsx`（新建）、`src/components/script/FileTreePanel.tsx`、`src/components/script/FileTreePanel.module.css`、`src/pages/ScriptWorkbench.tsx`
**依赖：** Track 1 + 2 + 3 全部合入主干后再开始。

### Task 4.1：新建 `FileTreeTabs` 薄包装

**Files:**
- Create: `src/components/script/FileTreeTabs.tsx`

- [ ] **Step 1: 写组件**

```tsx
// src/components/script/FileTreeTabs.tsx
import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui';

export type FileTreeView = 'all' | 'resources';

interface FileTreeTabsProps {
  value: FileTreeView;
  onValueChange: (value: FileTreeView) => void;
  allSlot: ReactNode;
  resourcesSlot: ReactNode;
}

export function FileTreeTabs({ value, onValueChange, allSlot, resourcesSlot }: FileTreeTabsProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange(v as FileTreeView)}
    >
      <TabsList>
        <TabsTrigger value="all">全部文件</TabsTrigger>
        <TabsTrigger value="resources">稿件资源</TabsTrigger>
      </TabsList>
      <TabsContent value="all">{allSlot}</TabsContent>
      <TabsContent value="resources">{resourcesSlot}</TabsContent>
    </Tabs>
  );
}
```

> 备注：如 `src/ui/components/tabs.tsx` 未从 `src/ui/index.ts` 导出对应名称，改为从 `../../ui/components/tabs` 直接引入。检查时运行 `grep -n "Tabs" src/ui/index.ts src/ui/components/index.ts`。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错

### Task 4.2：`FileTreePanel` 接入 Tabs 与新视图

**Files:**
- Modify: `src/components/script/FileTreePanel.tsx`
- Modify: `src/components/script/FileTreePanel.module.css`

- [ ] **Step 1: 引入依赖与 store**

在 `FileTreePanel.tsx` 顶部新增：

```ts
import { useScriptStore } from '../../store/script';
import { FileTreeTabs } from './FileTreeTabs';
import { ScriptResourceView } from './ScriptResourceView';
```

- [ ] **Step 2: 改造 `FileTreePanel` return**

把 `projectDir ? (...) : (...)` 中的「有 projectDir」分支从：

```tsx
<>
  <div className={styles.projectRoot}>...</div>
  <FileTree ... />
</>
```

改为：

```tsx
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
```

在函数体内靠顶部处读取 store：

```ts
const fileTreeView = useScriptStore((s) => s.fileTreeView);
const setFileTreeView = useScriptStore((s) => s.setFileTreeView);
```

- [ ] **Step 3: CSS 微调**

在 `FileTreePanel.module.css` 末尾确保 Tabs 容器占满剩余高度：

```css
.panel > :global([data-slot='tabs']),
.panel > :global(.Tabs) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

> 若 `Tabs` 组件未使用 `data-slot` 或 `Tabs` 类名，改用包裹 `<div className={styles.tabsWrap}>` 并给该类设定 flex 布局。实现时先打开 devtools 确认 Tabs 根节点的 DOM 结构再落样式。

- [ ] **Step 4: 类型与 UI 验证**

Run: `npx tsc --noEmit`
Expected: 无报错

启动：`npm run dev`，手动验证：
- 切换两个 Tab，列表/资源视图正确渲染
- Tab 激活视觉反馈符合 DESIGN.md（蓝色下划线 / 激活色）
- 搜索、点击、拖拽均生效

### Task 4.3：在 `ScriptWorkbench` 中恢复/持久化 `fileTreeView`

**Files:**
- Modify: `src/pages/ScriptWorkbench.tsx`

- [ ] **Step 1: 恢复 `fileTreeView`**

在 `hydrateProjectDirectory` 内 `restoreState({ ... })` 的 params 中加入：

```ts
fileTreeView: fullState.persisted.fileTreeView ?? 'all',
```

- [ ] **Step 2: 保存 `fileTreeView`**

在调用 `createPersistedScriptState(...)` 的 options 中加：

```ts
fileTreeView: useScriptStore.getState().fileTreeView,
```

（`ScriptWorkbench.tsx` 中所有 `createPersistedScriptState` 调用点都要同步加；使用 grep 定位：`grep -n "createPersistedScriptState" src/pages/ScriptWorkbench.tsx`）

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错

### Task 4.4：回归与 UI 审查

- [ ] **Step 1: 单元/组件测试**

Run: `npm test`
Expected: 全绿，无新增失败

- [ ] **Step 2: 手动验证清单（逐项勾选）**

  - [ ] 未选目录 → 切 Tab 后仍能看到引导 EmptyState
  - [ ] 空工程（无 original/script/preview）→ 稿件资源 Tab 显示「暂无稿件资源」
  - [ ] 仅 original.md → 稿件资源 Tab 只展示「原始文稿」分组
  - [ ] 全量资源（原稿 + 口播稿 + 2 份 preview.json）→ 三分组齐全，title 从 videoId 平滑替换为中文标题
  - [ ] 搜索「原始」→ 仅剩原始文稿；搜索「zzz」→ 显示「未找到匹配资源」
  - [ ] 关闭应用并重新打开 → 上次停留的 Tab 被恢复
  - [ ] preview.json 内容损坏 → 副标题显示「抖音 · 解析失败」，其他资源不受影响
  - [ ] 点击行 → 编辑器正确打开；拖拽 → 编辑区正确接收

- [ ] **Step 3: 执行 `/ui-review`**

按项目规则，前端交付完成后必须执行 `/ui-review` skill。

- [ ] **Step 4: 提交集成**

```bash
git add src/components/script/FileTreeTabs.tsx \
        src/components/script/FileTreePanel.tsx \
        src/components/script/FileTreePanel.module.css \
        src/pages/ScriptWorkbench.tsx
git commit -m "feat(script-workbench): 文件树接入稿件资源 Tab"
```

---

## 并行调度建议

```
Phase 1（并行）：
  ├── Track 1  (workspace-resources.ts + tests)
  ├── Track 2  (script store + persistence + tests)
  └── Track 3  (ScriptResourceView + tests)

Phase 2（顺序）：
  └── Track 4  (FileTreeTabs + FileTreePanel 集成 + 持久化接线)
```

**冲突面检查**：Phase 1 三条轨道的 `scope_write` 完全不相交，且 Track 3 仅 import Track 1 对外契约类型（契约已在本计划锁定）。Phase 2 开始前需确认 Phase 1 三条轨道全部 PASS 并已合入当前分支。

---

## 自检

- ✅ Spec §5 文件分布全部覆盖（lib / 组件 / store / persistence / 集成）
- ✅ Spec §6 数据模型 1:1 落到 Track 1 类型与实现
- ✅ Spec §8 `fileTreeView` 状态 + 持久化落到 Track 2 + Task 4.3
- ✅ Spec §9 UI 组件全部复用 `src/ui`（`Tabs` / `Input` / `Badge` / `EmptyState` / `PanelHeader`）
- ✅ Spec §10 文案 1:1 落到组件实现与测试断言
- ✅ Spec §11 交互行为（点击/拖拽/搜索/Tab 切换）在 Task 3.1 / 4.2 / 4.3 中实现
- ✅ Spec §13 测试计划全部落到 Track 1.2 / 2.3 / 3.2 具体用例
- ✅ Spec §14 验证清单全部落到 Task 4.4
- ✅ 无 TBD / TODO / 占位
- ✅ 类型命名跨 Task 一致：`fileTreeView` / `'all' | 'resources'` / `ResourceItem` / `PreviewMetaCache`

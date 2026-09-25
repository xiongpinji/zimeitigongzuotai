# 跨机器项目导入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 欢迎页新增「导入项目」入口，支持把从其他电脑复制过来的项目目录（含 `project.json` / 旧格式 / 仅媒资）识别、迁移，并自动修复时间线中失效的素材绝对路径。

**Architecture:** 三层解耦 —— (1) 主进程 `electron/project-import.ts` 提供 `scanProjectDirectory` / `normalizeAssetPaths` / `importProject`，复用既有 `loadProjectFile` 做迁移、`saveProjectSection` 做持久化；(2) 通过 `scan-project-directory` / `import-project` 两个 IPC 暴露给 Renderer，preload + electron-api 同步类型；(3) Renderer 新增 `ImportProjectDialog` 两阶段向导（选目录 → 识别面板 → 确认），由 `Setup.tsx` 快捷栏第 4 个入口触发，`App.tsx` 完成导入后导航。

**Tech Stack:** Electron 41、React 19、TypeScript 6、Vitest、lucide-react 图标、darwin-ui tokens、现有 `task-progress` 进度系统。

**设计文档：** `docs/superpowers/specs/2026-04-21-project-import-design.md`

---

## 任务拓扑与并行分组

```
Phase 0 (串行起点):  Task 1 [共享类型契约]
                         │
         ┌───────────────┴───────────────┐
         │                               │
Phase 1 (并行组 A):  Task 2                Task 3
                  [scan + 扫描器]    [normalizeAssetPaths 纯函数]
         │                               │
         └───────────────┬───────────────┘
                         │
Phase 2 (串行):     Task 4 [importProject 编排] → Task 5 [IPC 桥接三件套]
                         │
         ┌───────────────┴───────────────┐
         │                               │
Phase 3 (并行组 B):  Task 6                Task 7
                  [ImportProjectDialog]  [Setup 快捷栏 + App 接线]
         │                               │
         └───────────────┬───────────────┘
                         │
Phase 4 (串行收尾): Task 8 [回归测试 + 手动走查]
```

### 并行分组明细

**Phase 1（两路并行，均依赖 Task 1 的类型契约）：**

| 任务 | scope_write | scope_read | 冲突面 |
|---|---|---|---|
| Task 2 scan | `electron/project-import.ts`（新，仅填入 scan 相关函数） | `electron/project-file.ts`、`src/lib/project-persistence.ts`、Task 1 契约 | 与 Task 3 共享同一文件，**必须合并前同步**；建议 Task 2 写 `scanProjectDirectory` + 扫描辅助，Task 3 写 `normalizeAssetPaths` + 索引辅助，两者各占文件顶部 / 底部区段，Task 4 时收拢 |
| Task 3 normalize | `electron/project-import.ts`（新，仅填入 normalize 相关函数） | `src/types.ts`、`src/lib/project-persistence.ts`、Task 1 契约 | 同上 |

> ⚠️ Task 2 与 Task 3 在同一文件。若派子代理并行，必须约定：Task 2 负责 `scanProjectDirectory` + `classifyScenario` + `collectDetectedFiles`；Task 3 负责 `normalizeAssetPaths` + `buildBasenameIndex` + `pickBestMatch`。两者函数签名由 Task 1 固化，互不调用。**合并时 Task 4 作为串行点吸纳两者成果。**
>
> 如果不派并行子代理，Task 2 和 Task 3 顺序实现（先 2 再 3）即可避免任何冲突。

**Phase 3（两路并行，依赖 Task 5 完成）：**

| 任务 | scope_write | scope_read | 冲突面 |
|---|---|---|---|
| Task 6 Dialog | `src/components/ImportProjectDialog.tsx`（新） | `src/ui/components`、`src/lib/electron-api.ts`、Task 1 契约 | 纯新增，无冲突 |
| Task 7 Setup + App | `src/pages/Setup.tsx`（追加按钮）、`src/App.tsx`（追加 handler 与挂载） | `src/components/ImportProjectDialog.tsx`、Task 6 API | 等 Task 6 Dialog export 确定后开始；若 Task 6 尚未完成，Task 7 可先打 stub（引用但 alert 占位）按约定接口接线 |

---

## Task 1：共享类型契约（Phase 0，串行）

**目标：** 固化 Renderer / Main 双向共享的类型定义，作为后续所有并行任务的对齐点。

**Files:**
- Create: `src/lib/project-import-types.ts`

- [ ] **Step 1：创建共享类型文件**

Create `src/lib/project-import-types.ts`:

```typescript
/** 共享契约：项目导入功能的 Renderer / Main 对齐点。锁定后请勿随意修改。 */

export type ImportProjectScenario = 'complete' | 'legacy' | 'mediaOnly' | 'unrecognized';

export type DetectedFileKind =
  | 'projectJson'
  | 'legacyTimeline'
  | 'legacyAIAnalysis'
  | 'legacyScriptState'
  | 'scriptMd'
  | 'originalMd'
  | 'audioMp3'
  | 'subtitleSrt'
  | 'coverImage'
  | 'aiCard'
  | 'douyinImport'
  | 'promptOverride'
  | 'other';

export interface DetectedFile {
  relativePath: string;
  bytes: number;
  kind: DetectedFileKind;
}

export type AssetReferenceKind = 'overlayAsset' | 'podcastAudio';

export interface MissingAssetItem {
  overlayId?: string;
  kind: AssetReferenceKind;
  originalPath: string;
  basename: string;
}

export interface AssetReferenceSummary {
  totalReferences: number;
  intactCount: number;
  fixableCount: number;
  missingCount: number;
  /** 最多返回 50 条，避免 IPC 负载膨胀 */
  missingItems: MissingAssetItem[];
}

export interface ImportProjectScanResult {
  projectDir: string;
  projectName: string;
  scenario: ImportProjectScenario;
  detectedFiles: DetectedFile[];
  timelineItemCount: number;
  coverCandidateCount: number;
  assetReferences: AssetReferenceSummary;
  blockReason?: string;
}

export interface AssetFixItem {
  kind: AssetReferenceKind;
  overlayId?: string;
  originalPath: string;
  newPath: string;
}

export interface AssetFixReport {
  fixed: AssetFixItem[];
  missing: MissingAssetItem[];
}

export interface ImportProjectResult {
  projectDir: string;
  projectName: string;
  scenario: Exclude<ImportProjectScenario, 'unrecognized'>;
  fixReport: AssetFixReport;
  migratedFromLegacy: boolean;
}

export interface ImportProjectArgs {
  projectDir: string;
  acceptMissingAssets: boolean;
}

export type ImportProjectErrorCode =
  | 'unrecognized'
  | 'missing_assets'
  | 'scan_failed'
  | 'load_failed'
  | 'save_failed';

export interface ImportProjectErrorPayload {
  code: ImportProjectErrorCode;
  message: string;
}
```

- [ ] **Step 2：验证类型导入路径**

Run: `npx tsc --noEmit --skipLibCheck`（或等待 Task 5 运行完再整体校验）

Expected: 无编译错误。

**Acceptance:**
- `src/lib/project-import-types.ts` 存在
- 导出 10 个以上 interface / type
- 与设计文档的字段一致

---

## Task 2：主进程扫描器（Phase 1 并行 A）

**目标：** 实现 `scanProjectDirectory`，只读扫描目录，识别场景，统计素材引用。

**Files:**
- Create: `electron/project-import.ts`（初次创建，Task 3 会在同一文件追加）

- [ ] **Step 1：创建文件并实现扫描辅助**

Create `electron/project-import.ts` 顶部区段：

```typescript
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ProjectData } from '../src/lib/project-persistence';
import type { TimelineData, OverlayItem } from '../src/types';
import type {
  DetectedFile,
  DetectedFileKind,
  ImportProjectScanResult,
  ImportProjectScenario,
  AssetReferenceSummary,
  MissingAssetItem,
  AssetReferenceKind,
} from '../src/lib/project-import-types';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'release', 'dist', 'dist-electron', 'work']);
const MAX_SCAN_DEPTH = 3;
const MAX_MISSING_REPORT = 50;

function classifyFile(relativePath: string, basename: string): DetectedFileKind {
  if (relativePath === 'project.json') return 'projectJson';
  if (relativePath === 'timeline.json') return 'legacyTimeline';
  if (relativePath === 'ai-analysis.json') return 'legacyAIAnalysis';
  if (relativePath === 'script-state.json') return 'legacyScriptState';
  if (relativePath === 'script.md') return 'scriptMd';
  if (relativePath === 'original.md') return 'originalMd';
  if (basename.endsWith('.mp3') && basename.startsWith('podcast-audio')) return 'audioMp3';
  if (basename.endsWith('.srt') && basename.startsWith('podcast-subtitles')) return 'subtitleSrt';
  if (relativePath.startsWith('covers/')) return 'coverImage';
  if (relativePath.startsWith('ai-cards/')) return 'aiCard';
  if (relativePath.startsWith('imports/douyin/')) return 'douyinImport';
  if (relativePath.startsWith('configs/prompts/')) return 'promptOverride';
  return 'other';
}

async function collectDetectedFiles(projectDir: string): Promise<DetectedFile[]> {
  const results: DetectedFile[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(absPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPath = path.relative(projectDir, absPath).replace(/\\/g, '/');
      const stat = await fs.stat(absPath);
      results.push({
        relativePath: relPath,
        bytes: stat.size,
        kind: classifyFile(relPath, entry.name),
      });
    }
  }
  await walk(projectDir, 0);
  return results;
}

function classifyScenario(files: DetectedFile[]): ImportProjectScenario {
  const kinds = new Set(files.map((f) => f.kind));
  if (kinds.has('projectJson')) return 'complete';
  if (kinds.has('legacyTimeline') || kinds.has('legacyAIAnalysis') || kinds.has('legacyScriptState')) {
    return 'legacy';
  }
  if (kinds.has('audioMp3') || kinds.has('scriptMd') || kinds.has('originalMd') || kinds.has('subtitleSrt')) {
    return 'mediaOnly';
  }
  return 'unrecognized';
}
```

- [ ] **Step 2：实现素材引用统计**

追加到同文件：

```typescript
interface AssetReferenceEntry {
  kind: AssetReferenceKind;
  overlayId?: string;
  originalPath: string;
}

function collectTimelineAssetReferences(timeline: TimelineData | null): AssetReferenceEntry[] {
  if (!timeline) return [];
  const refs: AssetReferenceEntry[] = [];
  if (timeline.podcast?.audioPath) {
    refs.push({ kind: 'podcastAudio', originalPath: timeline.podcast.audioPath });
  }
  for (const track of timeline.tracks ?? []) {
    for (const overlay of track.overlays ?? []) {
      if (overlay.type === 'video' || overlay.type === 'image' || overlay.type === 'audio') {
        if (overlay.assetPath) {
          refs.push({
            kind: 'overlayAsset',
            overlayId: overlay.id,
            originalPath: overlay.assetPath,
          });
        }
      }
    }
  }
  return refs;
}

// planAssetNormalization 只计算不写入，供 scan 阶段使用。
// 具体实现由 Task 3 的 normalizeAssetPaths 抽共享部分。此处先 stub，Task 3 时替换。
export function planAssetNormalization(
  projectDir: string,
  refs: AssetReferenceEntry[],
): AssetReferenceSummary {
  // Task 3 将替换为真实实现。当前占位：全部视为 intact。
  return {
    totalReferences: refs.length,
    intactCount: refs.length,
    fixableCount: 0,
    missingCount: 0,
    missingItems: [],
  };
}
```

> **说明：** 本 step 的 `planAssetNormalization` 是占位。Task 3 会实现完整版本（含 basenameIndex 构建 + 分类），并替换此函数体。Task 2 的扫描器只 import 它并调用。

- [ ] **Step 3：实现 `scanProjectDirectory`**

```typescript
async function readProjectJsonSafely(projectDir: string): Promise<ProjectData | null> {
  try {
    const raw = await fs.readFile(path.join(projectDir, 'project.json'), 'utf-8');
    return JSON.parse(raw) as ProjectData;
  } catch {
    return null;
  }
}

async function readLegacyTimeline(projectDir: string): Promise<TimelineData | null> {
  try {
    const raw = await fs.readFile(path.join(projectDir, 'timeline.json'), 'utf-8');
    return JSON.parse(raw) as TimelineData;
  } catch {
    return null;
  }
}

export async function scanProjectDirectory(projectDir: string): Promise<ImportProjectScanResult> {
  if (!existsSync(projectDir)) {
    throw new Error(`项目目录不存在：${projectDir}`);
  }
  const stat = await fs.stat(projectDir);
  if (!stat.isDirectory()) {
    throw new Error(`路径不是目录：${projectDir}`);
  }

  const detectedFiles = await collectDetectedFiles(projectDir);
  const scenario = classifyScenario(detectedFiles);

  let timeline: TimelineData | null = null;
  let coverCandidateCount = 0;
  if (scenario === 'complete') {
    const data = await readProjectJsonSafely(projectDir);
    timeline = data?.timeline ?? null;
    coverCandidateCount = data?.aiAnalysis?.coverCandidates?.length ?? 0;
  } else if (scenario === 'legacy') {
    timeline = await readLegacyTimeline(projectDir);
  }

  const refs = collectTimelineAssetReferences(timeline);
  const assetReferences = planAssetNormalization(projectDir, refs);
  // 裁剪 missingItems 上限
  assetReferences.missingItems = assetReferences.missingItems.slice(0, MAX_MISSING_REPORT);

  let blockReason: string | undefined;
  if (scenario === 'unrecognized') {
    blockReason = '目录中未找到 project.json 或核心媒资文件（podcast-audio.mp3 / script.md 等）。建议使用「新建工程」。';
  }

  return {
    projectDir,
    projectName: path.basename(projectDir),
    scenario,
    detectedFiles,
    timelineItemCount:
      (timeline?.tracks ?? []).reduce((sum, t) => sum + (t.overlays?.length ?? 0), 0),
    coverCandidateCount,
    assetReferences,
    blockReason,
  };
}
```

- [ ] **Step 4：编写扫描器单测**

Create `tests/project-import.test.ts` 首批用例（Task 3 会在同文件追加）：

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { scanProjectDirectory } from '../electron/project-import';

describe('scanProjectDirectory', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-project-'));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('S1 complete：识别 project.json', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ version: 1, timeline: null, aiAnalysis: { coverCandidates: [] } }),
    );
    const result = await scanProjectDirectory(tmpDir);
    expect(result.scenario).toBe('complete');
    expect(result.detectedFiles.find((f) => f.kind === 'projectJson')).toBeDefined();
  });

  it('S2 legacy：只有 timeline.json', async () => {
    await fs.writeFile(path.join(tmpDir, 'timeline.json'), JSON.stringify({ tracks: [] }));
    const result = await scanProjectDirectory(tmpDir);
    expect(result.scenario).toBe('legacy');
  });

  it('S3 mediaOnly：只有 podcast-audio.mp3', async () => {
    await fs.writeFile(path.join(tmpDir, 'podcast-audio.mp3'), Buffer.from([0x00]));
    const result = await scanProjectDirectory(tmpDir);
    expect(result.scenario).toBe('mediaOnly');
  });

  it('S4 unrecognized：空目录', async () => {
    const result = await scanProjectDirectory(tmpDir);
    expect(result.scenario).toBe('unrecognized');
    expect(result.blockReason).toBeDefined();
  });

  it('忽略 node_modules / .git / release', async () => {
    await fs.mkdir(path.join(tmpDir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'node_modules', 'trash.txt'), 'x');
    const result = await scanProjectDirectory(tmpDir);
    expect(result.detectedFiles.some((f) => f.relativePath.includes('node_modules'))).toBe(false);
  });
});
```

Run: `npx vitest run tests/project-import.test.ts`

Expected: 5 个用例全过。

**Acceptance:**
- S1–S4 场景均能正确识别
- 忽略目录生效
- `detectedFiles.kind` 分类准确
- 单测全通过

---

## Task 3：路径修复纯函数（Phase 1 并行 B）

**目标：** 实现 `normalizeAssetPaths` + `buildBasenameIndex`，仅计算路径修复方案，不写磁盘。

**Files:**
- Modify: `electron/project-import.ts`（追加，不修改 Task 2 产物）
- Modify: `tests/project-import.test.ts`（追加用例）

- [ ] **Step 1：实现 basename 索引**

追加到 `electron/project-import.ts`：

```typescript
function buildBasenameIndex(projectDir: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  function walk(dir: string, depth: number): void {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = require('node:fs').readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        walk(absPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const list = index.get(entry.name) ?? [];
      list.push(absPath);
      index.set(entry.name, list);
    }
  }
  walk(projectDir, 0);
  return index;
}

function pickBestMatch(candidates: string[], _originalPath: string): string {
  // 优先选路径深度最浅（目录分隔符最少）
  return candidates.slice().sort((a, b) => {
    const da = a.split(path.sep).length;
    const db = b.split(path.sep).length;
    if (da !== db) return da - db;
    return a.length - b.length;
  })[0];
}
```

- [ ] **Step 2：替换 `planAssetNormalization` 为真实实现**

Replace 占位函数：

```typescript
export function planAssetNormalization(
  projectDir: string,
  refs: AssetReferenceEntry[],
): AssetReferenceSummary {
  if (refs.length === 0) {
    return { totalReferences: 0, intactCount: 0, fixableCount: 0, missingCount: 0, missingItems: [] };
  }

  let intactCount = 0;
  let fixableCount = 0;
  const missingItems: MissingAssetItem[] = [];
  let basenameIndex: Map<string, string[]> | null = null;

  for (const ref of refs) {
    const originalPath = ref.originalPath;
    let resolved = originalPath;
    if (!path.isAbsolute(resolved)) {
      resolved = path.resolve(projectDir, resolved);
    }
    if (existsSync(resolved)) {
      intactCount += 1;
      continue;
    }
    if (!basenameIndex) basenameIndex = buildBasenameIndex(projectDir);
    const matches = basenameIndex.get(path.basename(originalPath));
    if (matches && matches.length > 0) {
      fixableCount += 1;
    } else {
      missingItems.push({
        overlayId: ref.overlayId,
        kind: ref.kind,
        originalPath,
        basename: path.basename(originalPath),
      });
    }
  }

  return {
    totalReferences: refs.length,
    intactCount,
    fixableCount,
    missingCount: missingItems.length,
    missingItems: missingItems.slice(0, MAX_MISSING_REPORT),
  };
}
```

- [ ] **Step 3：实现 `normalizeAssetPaths`（写路径）**

追加：

```typescript
import type { AssetFixReport, AssetFixItem } from '../src/lib/project-import-types';

export interface NormalizeAssetPathsResult {
  data: ProjectData;
  fixReport: AssetFixReport;
}

export function normalizeAssetPaths(
  data: ProjectData,
  projectDir: string,
): NormalizeAssetPathsResult {
  const timeline = data.timeline;
  if (!timeline) {
    return { data, fixReport: { fixed: [], missing: [] } };
  }

  const fixed: AssetFixItem[] = [];
  const missing: MissingAssetItem[] = [];
  let basenameIndex: Map<string, string[]> | null = null;

  const tryFix = (
    originalPath: string,
    kind: AssetReferenceKind,
    overlayId?: string,
  ): string => {
    let resolved = originalPath;
    if (!path.isAbsolute(resolved)) {
      resolved = path.resolve(projectDir, resolved);
    }
    if (existsSync(resolved)) return originalPath;
    if (!basenameIndex) basenameIndex = buildBasenameIndex(projectDir);
    const matches = basenameIndex.get(path.basename(originalPath));
    if (!matches || matches.length === 0) {
      missing.push({ overlayId, kind, originalPath, basename: path.basename(originalPath) });
      return originalPath;
    }
    const newPath = pickBestMatch(matches, originalPath);
    fixed.push({ kind, overlayId, originalPath, newPath });
    return newPath;
  };

  const nextTimeline: TimelineData = {
    ...timeline,
    podcast: timeline.podcast
      ? {
          ...timeline.podcast,
          audioPath: timeline.podcast.audioPath
            ? tryFix(timeline.podcast.audioPath, 'podcastAudio')
            : '',
        }
      : timeline.podcast,
    tracks: (timeline.tracks ?? []).map((track) => ({
      ...track,
      overlays: (track.overlays ?? []).map((overlay: OverlayItem) => {
        if (!overlay.assetPath) return overlay;
        if (overlay.type !== 'video' && overlay.type !== 'image' && overlay.type !== 'audio') {
          return overlay;
        }
        const newPath = tryFix(overlay.assetPath, 'overlayAsset', overlay.id);
        return newPath === overlay.assetPath ? overlay : { ...overlay, assetPath: newPath };
      }),
    })),
  };

  return {
    data: { ...data, timeline: nextTimeline },
    fixReport: { fixed, missing: missing.slice(0, MAX_MISSING_REPORT) },
  };
}
```

- [ ] **Step 4：追加单测**

Append to `tests/project-import.test.ts`：

```typescript
import { planAssetNormalization, normalizeAssetPaths } from '../electron/project-import';
import type { ProjectData } from '../src/lib/project-persistence';

describe('normalizeAssetPaths', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-project-')); });
  afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); });

  const makeData = (timeline: any): ProjectData => ({
    version: 1,
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    timeline,
    aiAnalysis: { analysisResult: null, coverCandidates: [], motionCards: [], storyboardPlan: null },
    script: { templateId: 'news-broadcast', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  });

  it('绝对路径存在：不修改', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.mp4'), Buffer.from([0]));
    const absPath = path.join(tmpDir, 'a.mp4');
    const data = makeData({
      tracks: [{ id: 't1', overlays: [{ id: 'o1', type: 'video', assetPath: absPath }] }],
      podcast: { audioPath: '' },
    });
    const { data: fixed, fixReport } = normalizeAssetPaths(data, tmpDir);
    expect(fixReport.fixed).toHaveLength(0);
    expect(fixReport.missing).toHaveLength(0);
    expect(fixed.timeline?.tracks[0].overlays[0].assetPath).toBe(absPath);
  });

  it('绝对路径失效但 basename 命中：修复', async () => {
    await fs.mkdir(path.join(tmpDir, 'imports/douyin/v1'), { recursive: true });
    const newPath = path.join(tmpDir, 'imports/douyin/v1/clip.mp4');
    await fs.writeFile(newPath, Buffer.from([0]));
    const data = makeData({
      tracks: [{ id: 't1', overlays: [{ id: 'o1', type: 'video', assetPath: '/Users/alice/oldproject/imports/douyin/v1/clip.mp4' }] }],
      podcast: { audioPath: '' },
    });
    const { data: fixed, fixReport } = normalizeAssetPaths(data, tmpDir);
    expect(fixReport.fixed).toHaveLength(1);
    expect(fixed.timeline?.tracks[0].overlays[0].assetPath).toBe(newPath);
  });

  it('basename 无匹配：记入 missing', async () => {
    const data = makeData({
      tracks: [{ id: 't1', overlays: [{ id: 'o1', type: 'video', assetPath: '/Users/alice/missing.mp4' }] }],
      podcast: { audioPath: '' },
    });
    const { fixReport } = normalizeAssetPaths(data, tmpDir);
    expect(fixReport.missing).toHaveLength(1);
    expect(fixReport.missing[0].basename).toBe('missing.mp4');
  });

  it('podcast.audioPath 也被修复', async () => {
    await fs.writeFile(path.join(tmpDir, 'podcast-audio.mp3'), Buffer.from([0]));
    const data = makeData({
      tracks: [],
      podcast: { audioPath: '/Users/alice/oldproject/podcast-audio.mp3' },
    });
    const { data: fixed, fixReport } = normalizeAssetPaths(data, tmpDir);
    expect(fixReport.fixed).toHaveLength(1);
    expect(fixed.timeline?.podcast.audioPath).toBe(path.join(tmpDir, 'podcast-audio.mp3'));
  });

  it('多个同名文件：选路径最浅', async () => {
    await fs.writeFile(path.join(tmpDir, 'clip.mp4'), Buffer.from([0]));
    await fs.mkdir(path.join(tmpDir, 'sub/deep'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'sub/deep/clip.mp4'), Buffer.from([0]));
    const data = makeData({
      tracks: [{ id: 't1', overlays: [{ id: 'o1', type: 'video', assetPath: '/old/clip.mp4' }] }],
      podcast: { audioPath: '' },
    });
    const { data: fixed } = normalizeAssetPaths(data, tmpDir);
    expect(fixed.timeline?.tracks[0].overlays[0].assetPath).toBe(path.join(tmpDir, 'clip.mp4'));
  });
});

describe('planAssetNormalization', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-project-')); });
  afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); });

  it('统计 intact / fixable / missing', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.mp4'), Buffer.from([0]));
    await fs.writeFile(path.join(tmpDir, 'b.mp4'), Buffer.from([0]));
    const absA = path.join(tmpDir, 'a.mp4');
    const summary = planAssetNormalization(tmpDir, [
      { kind: 'overlayAsset', overlayId: 'o1', originalPath: absA },                          // intact
      { kind: 'overlayAsset', overlayId: 'o2', originalPath: '/Users/alice/old/b.mp4' },      // fixable
      { kind: 'overlayAsset', overlayId: 'o3', originalPath: '/Users/alice/old/missing.mp4' },// missing
    ]);
    expect(summary.intactCount).toBe(1);
    expect(summary.fixableCount).toBe(1);
    expect(summary.missingCount).toBe(1);
  });
});
```

Run: `npx vitest run tests/project-import.test.ts`

Expected: 所有用例通过（5 个 scan + 5 个 normalize + 1 个 plan = 11 个）。

**Acceptance:**
- 绝对路径存在 → 不修改
- 失效但命中 → 修复
- 未命中 → missing
- podcast.audioPath 同样修复
- 多候选 → 选最浅
- planAssetNormalization 统计正确
- 所有单测通过

---

## Task 4：importProject 编排（Phase 2，串行）

**目标：** 把 scan + load + normalize + save 串成一个 IPC 入口。

**Files:**
- Modify: `electron/project-import.ts`（追加 `importProject`）
- Modify: `tests/project-import.test.ts`（追加集成用例）

- [ ] **Step 1：实现 `importProject`**

追加：

```typescript
import { loadProjectFile, saveProjectSection } from './project-file';
import type { ImportProjectArgs, ImportProjectResult, ImportProjectErrorCode } from '../src/lib/project-import-types';

export class ImportProjectError extends Error {
  constructor(public code: ImportProjectErrorCode, message: string) {
    super(message);
    this.name = 'ImportProjectError';
  }
}

export async function importProject(args: ImportProjectArgs): Promise<ImportProjectResult> {
  const { projectDir, acceptMissingAssets } = args;
  const scan = await scanProjectDirectory(projectDir);
  if (scan.scenario === 'unrecognized') {
    throw new ImportProjectError('unrecognized', scan.blockReason ?? '目录无法识别为项目');
  }
  if (scan.assetReferences.missingCount > 0 && !acceptMissingAssets) {
    throw new ImportProjectError(
      'missing_assets',
      `存在 ${scan.assetReferences.missingCount} 个缺失素材，请勾选「允许缺失素材继续导入」`,
    );
  }

  let data;
  try {
    data = await loadProjectFile(projectDir);
  } catch (err) {
    throw new ImportProjectError('load_failed', `读取项目失败：${(err as Error).message}`);
  }

  const { data: fixedData, fixReport } = normalizeAssetPaths(data, projectDir);

  if (fixReport.fixed.length > 0) {
    try {
      await saveProjectSection(projectDir, 'timeline', fixedData.timeline);
    } catch (err) {
      throw new ImportProjectError('save_failed', `保存修复后的时间线失败：${(err as Error).message}`);
    }
  }

  return {
    projectDir,
    projectName: scan.projectName,
    scenario: scan.scenario as Exclude<typeof scan.scenario, 'unrecognized'>,
    fixReport,
    migratedFromLegacy: scan.scenario === 'legacy',
  };
}
```

- [ ] **Step 2：集成测试**

Append：

```typescript
import { importProject, ImportProjectError } from '../electron/project-import';

describe('importProject', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-project-')); });
  afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); });

  it('S1 完整项目：修复素材路径并持久化', async () => {
    await fs.writeFile(path.join(tmpDir, 'clip.mp4'), Buffer.from([0]));
    const projectData = {
      version: 1,
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z',
      timeline: {
        tracks: [{ id: 't1', overlays: [{ id: 'o1', type: 'video', assetPath: '/old/clip.mp4', startMs: 0, durationMs: 1000, trackId: 't1', position: {} }] }],
        podcast: { audioPath: '' },
      },
      aiAnalysis: { analysisResult: null, coverCandidates: [], motionCards: [], storyboardPlan: null },
      script: { templateId: 'news-broadcast', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
    };
    await fs.writeFile(path.join(tmpDir, 'project.json'), JSON.stringify(projectData));

    const result = await importProject({ projectDir: tmpDir, acceptMissingAssets: false });
    expect(result.scenario).toBe('complete');
    expect(result.fixReport.fixed).toHaveLength(1);

    const after = JSON.parse(await fs.readFile(path.join(tmpDir, 'project.json'), 'utf-8'));
    expect(after.timeline.tracks[0].overlays[0].assetPath).toBe(path.join(tmpDir, 'clip.mp4'));
  });

  it('unrecognized：抛 ImportProjectError', async () => {
    await expect(importProject({ projectDir: tmpDir, acceptMissingAssets: false }))
      .rejects.toThrow(ImportProjectError);
  });

  it('missing 且未勾选允许：抛错', async () => {
    const projectData = {
      version: 1,
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z',
      timeline: {
        tracks: [{ id: 't1', overlays: [{ id: 'o1', type: 'video', assetPath: '/old/missing.mp4', startMs: 0, durationMs: 1000, trackId: 't1', position: {} }] }],
        podcast: { audioPath: '' },
      },
      aiAnalysis: { analysisResult: null, coverCandidates: [], motionCards: [], storyboardPlan: null },
      script: { templateId: 'news-broadcast', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
    };
    await fs.writeFile(path.join(tmpDir, 'project.json'), JSON.stringify(projectData));

    await expect(importProject({ projectDir: tmpDir, acceptMissingAssets: false }))
      .rejects.toMatchObject({ code: 'missing_assets' });

    // 允许缺失 → 通过
    const result = await importProject({ projectDir: tmpDir, acceptMissingAssets: true });
    expect(result.fixReport.missing).toHaveLength(1);
  });
});
```

Run: `npx vitest run tests/project-import.test.ts`

**Acceptance:**
- 完整流程能修复并持久化
- unrecognized / missing_assets 错误路径正确
- `project.json` 在磁盘上被正确更新
- 全部用例通过

---

## Task 5：IPC 三件套桥接（Phase 2，串行）

**目标：** 在 main / preload / electron-api 三处同步新增两个 IPC。

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/lib/electron-api.ts`

- [ ] **Step 1：main.ts 注册 handler**

在与 `load-project` 相近处追加：

```typescript
import { scanProjectDirectory, importProject, ImportProjectError } from './project-import';
import type { ImportProjectArgs } from '../src/lib/project-import-types';

ipcMain.handle('scan-project-directory', async (_event, projectDir: string) => {
  return scanProjectDirectory(projectDir);
});

ipcMain.handle('import-project', async (_event, args: ImportProjectArgs) => {
  try {
    return { ok: true as const, result: await importProject(args) };
  } catch (err) {
    if (err instanceof ImportProjectError) {
      return { ok: false as const, error: { code: err.code, message: err.message } };
    }
    return { ok: false as const, error: { code: 'scan_failed' as const, message: (err as Error).message } };
  }
});
```

- [ ] **Step 2：preload.ts 暴露桥**

在 `electronAPI` 对象内追加：

```typescript
scanProjectDirectory: (projectDir: string) =>
  ipcRenderer.invoke('scan-project-directory', projectDir),
importProject: (args: ImportProjectArgs) =>
  ipcRenderer.invoke('import-project', args),
```

需要 `import type { ImportProjectArgs } from '../src/lib/project-import-types';`。

- [ ] **Step 3：electron-api.ts 类型声明**

在 `ElectronAPI` interface 内追加：

```typescript
scanProjectDirectory(projectDir: string): Promise<ImportProjectScanResult>;
importProject(
  args: ImportProjectArgs,
): Promise<
  | { ok: true; result: ImportProjectResult }
  | { ok: false; error: ImportProjectErrorPayload }
>;
```

并 `export *` 或重新 re-export `src/lib/project-import-types.ts` 里的类型供 Renderer 消费。

- [ ] **Step 4：TypeScript 校验**

Run: `npx tsc --noEmit --skipLibCheck`

Expected: 无错误。

**Acceptance:**
- 三个文件同步更新，类型对齐
- TypeScript 编译通过
- 未破坏既有 IPC

---

## Task 6：ImportProjectDialog 组件（Phase 3 并行 A）

**目标：** 实现两阶段导入向导 UI，复用既有 UI primitives。

**Files:**
- Create: `src/components/ImportProjectDialog.tsx`

- [ ] **Step 1：Dialog 骨架**

参考 `src/components/script/ImportScriptDialog.tsx` 的结构，实现一个受控 Dialog：
- Props: `{ open: boolean; onOpenChange: (v: boolean) => void; onImported: (result: ImportProjectResult) => void }`
- 内部状态：`stage: 'select' | 'scanned'`、`scanning: boolean`、`importing: boolean`、`scan: ImportProjectScanResult | null`、`acceptMissing: boolean`、`error: string | null`

- [ ] **Step 2：选目录 + 扫描**

点击「选择项目目录」调 `window.electronAPI.selectProjectDirectory()`（沿用既有接口）→ 成功后调 `scanProjectDirectory(dir)` → 存入 `scan` → 切 `stage='scanned'`。扫描失败 inline 展示。

- [ ] **Step 3：识别面板渲染**

根据 `scan.scenario` 渲染不同头部提示；渲染三段：
1. 场景标签 + 基础统计（timelineItemCount / coverCandidateCount）
2. 素材路径统计（intact / fixable / missing），missing 可展开列出前 20 条
3. 检测到的其他文件（按 kind 分组显示数量）

若 `scenario === 'unrecognized'`，展示 `blockReason`，「开始导入」按钮禁用。

- [ ] **Step 4：导入按钮接线**

- 若 `missingCount > 0` 且 `!acceptMissing`：按钮禁用（或允许点但 inline 提示勾选）
- 点击调 `window.electronAPI.importProject({ projectDir, acceptMissingAssets: acceptMissing })`
- 导入成功：调 `onImported(result)` → `onOpenChange(false)`
- 导入失败：inline 展示 `error.message`

- [ ] **Step 5：进度接入（可选但推荐）**

耗时 >2s 的路径修复（大目录场景）接入 `src/store/task-progress.ts`：
```typescript
const taskId = startTask({ kind: 'importProject', label: '导入项目', ... });
try { ... } finally { completeTask(taskId); }
```

- [ ] **Step 6：样式**

复用 `src/ui/components` / `src/ui/primitives` 现有 Dialog / Button / Checkbox / Badge 组件。文案全部中文。

**Acceptance:**
- 两阶段流程可走通
- S1–S4 场景展示不同
- missing 展开 / 勾选 / 按钮禁用逻辑正确
- 与 darwin-ui 视觉一致

---

## Task 7：Setup 快捷栏入口 + App 接线（Phase 3 并行 B）

**目标：** 在欢迎页快捷栏追加「导入项目」按钮，`App.tsx` 完成导入后导航。

**Files:**
- Modify: `src/pages/Setup.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1：Setup.tsx 追加按钮**

在 `quickBar` 末尾（抖音导入之后）追加：

```tsx
<button
  type="button"
  className={styles.quickItem}
  onClick={onImportProject}
>
  <div className={styles.quickItemIcon}>
    <FolderInput size={22} strokeWidth={1.5} />
  </div>
  <span className={styles.quickItemLabel}>导入项目</span>
</button>
```

- 从 `lucide-react` 新增 `FolderInput` import
- 新增 prop `onImportProject: () => void`

- [ ] **Step 2：App.tsx 状态与 handler**

新增：
```typescript
const [importProjectDialogOpen, setImportProjectDialogOpen] = useState(false);

const handleImportProject = useCallback(() => {
  setImportProjectDialogOpen(true);
}, []);

const handleImportProjectComplete = useCallback(async (result: ImportProjectResult) => {
  await window.electronAPI.addRecentProject(result.projectDir, result.projectName);
  // 触发与打开项目一致的后续流程
  await openProject(result.projectDir);
  setImportProjectDialogOpen(false);
}, [openProject]);
```

在 `Setup` 渲染处传入 `onImportProject={handleImportProject}`。

在 `Setup` 同层渲染 `<ImportProjectDialog open={importProjectDialogOpen} onOpenChange={setImportProjectDialogOpen} onImported={handleImportProjectComplete} />`。

- [ ] **Step 3：可选 — 导入后 toast**

`result.fixReport.fixed.length` 与 `missing.length` 可用 toast 展示 `"已导入，修复 X 个素材路径，N 个缺失"`。

- [ ] **Step 4：手动走查**

启动 `npm run dev`：
1. 准备一个真实的老项目目录，把其中 `project.json` 里的 `assetPath` 改成 `/fake/path/xxx.mp4`，但保留同名文件在目录里
2. 欢迎页点「导入项目」→ 选目录 → 看到「N 个可自动修复」→ 点导入 → 确认跳转到 editor / script-workbench
3. 打开 `project.json` 确认 `assetPath` 已重写

**Acceptance:**
- 快捷栏显示 4 个按钮
- 点击可打开 Dialog
- 完整导入→导航→素材可播放

---

## Task 8：回归测试 + 手动走查（Phase 4，串行）

**目标：** 确认完整链路无回归。

**Files:**
- Optionally modify: `tests/project-import.test.ts`（补边界）
- Run: 全量测试

- [ ] **Step 1：全量单测**

Run: `npm test`

Expected: 全部通过，无新 warning。

- [ ] **Step 2：TypeScript 校验**

Run: `npx tsc --noEmit`

Expected: 无错误。

- [ ] **Step 3：手动走查四类场景**

在 `npm run dev` 下逐一验证：
- **S1**：复制一个含 `project.json` 的真实项目到新路径，模拟跨机；导入后时间线素材可播放
- **S2**：只保留 `timeline.json` + `script-state.json`；导入后项目正常打开，`project.json` 被生成
- **S3**：只保留 `podcast-audio.mp3` + `script.md`；导入后进入空骨架编辑器
- **S4**：空目录 → 阻断，按钮置灰

- [ ] **Step 4：最近项目列表**

导入成功后回到欢迎页，确认「本地草稿」列表里出现该项目且排在第一。

- [ ] **Step 5：生产构建**

Run: `npm run build`

Expected: 构建通过（TypeScript + electron-vite + obfuscator 全过）。

**Acceptance:**
- 全测试通过
- 构建通过
- 四类场景手动走查通过
- 无回归（打开、导出、AI 面板等既有功能正常）

---

## 风险缓解回顾

| 原风险 | 任务应对 |
|---|---|
| basename 索引在大目录慢 | Task 3 限制深度 + 忽略目录白名单；Task 6 可选接入进度 UI |
| 跨机复制后再次失效 | 文档中明确不做双向；Task 8 手动走查记录最佳实践 |
| project.json 损坏 | Task 2 `readProjectJsonSafely` 降级为 null → 可能归入 legacy / mediaOnly；Task 8 加边界用例 |
| IPC 错误未处理 | Task 5 统一返回 `{ ok, result / error }` 结构；Task 6 Dialog 展示 |

## Exit Criteria（交付标准）

- [ ] 四类场景（S1 / S2 / S3 / S4）均按设计处理
- [ ] 素材路径修复端到端生效（`project.json` 真被写入新路径）
- [ ] 欢迎页快捷栏第 4 个入口可用，视觉与既有三项一致
- [ ] 新增单测 ≥11 个，全部通过
- [ ] `npm test` / `npx tsc --noEmit` / `npm run build` 三项通过
- [ ] `docs/superpowers/specs/2026-04-21-project-import-design.md` 与实现一致（如实现中有偏差，回填到设计稿）
- [ ] 手动走查四类场景全部通过

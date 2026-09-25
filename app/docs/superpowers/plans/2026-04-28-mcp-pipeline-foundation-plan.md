# MCP Pipeline 基础设施实施计划（Plan A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 MCP 全流水线的基础设施层（PipelineService / TaskRegistry / resolveProject / HeadlessProjectContext / project skeleton），并落地不依赖 LLM 共享下沉的 7 个同步 MCP 工具。

**Architecture:** 在 `electron/pipeline/` 下新建独立的服务层，提供 fire-and-poll 任务模型与 headless / 活动项目双通道；`electron/mcp/tools.ts` 改为薄包装。本 plan 不触碰 `src/lib/llm/`、`ai-analysis.ts`、卡片 materialize、时间线编排（留给 Plan B 共享下沉）。

**Tech Stack:** Electron 41 主进程、Node.js fs/path、Zustand（renderer task-progress 桥）、Vitest、Zod（MCP 入参 schema）、@modelcontextprotocol/sdk。

**关联文档：**
- 设计 spec：`docs/superpowers/specs/2026-04-28-mcp-full-pipeline-design.md`
- 现有 MCP：`electron/mcp/{server,tools,ipc,config-manager}.ts`
- 现有 project 持久化：`electron/project-file.ts` + `src/lib/project-persistence.ts`
- 现有 task-progress：`src/store/task-progress.ts`

**前置约束：**
- 不修改 `TimelineData` / `OverlayItem` / `ProjectData` 业务字段（Plan A 完全不动）。
- 不改 IPC 现有 channel 名；仅新增 channel。
- 项目文件写回必须经 `electron/project-file.ts` 既有写锁。
- Renderer 自己发起的任务**不**进 PipelineRegistry（Plan A 在桥接处务必避免双源覆盖）。

---

## 文件结构

**新建：**

| 路径 | 职责 |
|---|---|
| `electron/pipeline/types.ts` | `PipelineTask` / `PipelineTaskKind` / `TaskStatus` / 错误码常量 |
| `electron/pipeline/task-registry.ts` | 进程内 `Map<taskId, PipelineTask>` 管理 + 24h 终态 GC |
| `electron/pipeline/context.ts` | `resolveProject(projectPath)`、`HeadlessProjectContext`、`ActiveProjectContext` |
| `electron/pipeline/index.ts` | `PipelineService` 单例、`registerTask` / `updateTask` / `completeTask` 编排入口 |
| `electron/pipeline/task-progress-bridge.ts` | PipelineTask → renderer `task-progress` store 单向同步 |
| `electron/pipeline/algorithms/project-state.ts` | `has_*` 文件检测、`last_export` 取最新 mp4 |
| `electron/pipeline/tools/project-tools.ts` | 新增 `lingji_create_project` / `lingji_open_project` / `lingji_get_project_state` / `lingji_get_settings` 实现 |
| `electron/pipeline/tools/task-tools.ts` | `lingji_get_task_status` / `lingji_cancel_task` / `lingji_list_tasks` 实现 |
| `tests/pipeline-task-registry.test.ts` | 单测：任务注册、状态机、24h GC |
| `tests/pipeline-context.test.ts` | 单测：resolveProject 双通道、HeadlessProjectContext 读写 |
| `tests/pipeline-project-state.test.ts` | 单测：`has_*` 与 `last_export` 检测 |
| `tests/pipeline-tools-project.test.ts` | 集成测：create_project → get_project_state |
| `tests/pipeline-tools-task.test.ts` | 集成测：task lifecycle 工具 |
| `tests/pipeline-task-progress-bridge.test.ts` | 单测：桥单向同步行为 |

**修改：**

| 路径 | 行为 |
|---|---|
| `electron/mcp/tools.ts` | `registerTools()` 末尾追加 `registerProjectTools(server)` 与 `registerTaskTools(server)`；不动现有工具 |
| `electron/main.ts` | App ready 时初始化 `PipelineService.getInstance()`，并注入 `getMainWindow` |
| `electron/preload.ts` | （Task 8）新增 `lingji.taskBridge` 通道，从主进程接收 PipelineTask 进度推送，转发到 renderer task-progress store |
| `src/lib/electron-api.ts` | 同步 preload 的新 API 类型签名 |

---

## Task 1: PipelineTask 类型与错误码常量

**Files:**
- Create: `electron/pipeline/types.ts`
- Test: `tests/pipeline-types.test.ts`

- [ ] **Step 1: 写失败测试（确认类型导出）**

```ts
// tests/pipeline-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  PIPELINE_TASK_KINDS,
  PIPELINE_ERROR_CODES,
  isTerminalStatus,
  type PipelineTask,
  type PipelineTaskStatus,
} from '../electron/pipeline/types';

describe('pipeline types', () => {
  it('exports the 10 task kinds from spec', () => {
    expect(PIPELINE_TASK_KINDS).toEqual([
      'tts',
      'write_script',
      'review_script',
      'analyze_subtitles',
      'generate_covers',
      'generate_storyboard',
      'generate_cards',
      'generate_motion',
      'export_video',
      'import_video_source',
    ]);
  });

  it('classifies terminal statuses', () => {
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('canceled')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('pending')).toBe(false);
  });

  it('exposes documented error codes', () => {
    expect(PIPELINE_ERROR_CODES.TASK_CONFLICT).toBe('task_conflict');
    expect(PIPELINE_ERROR_CODES.NOT_CANCELABLE).toBe('not_cancelable');
    expect(PIPELINE_ERROR_CODES.PROJECT_NOT_FOUND).toBe('project_not_found');
  });

  it('typings compile with sample task', () => {
    const task: PipelineTask = {
      taskId: '00000000-0000-4000-8000-000000000000',
      kind: 'tts',
      projectPath: '/tmp/foo',
      status: 'pending',
      progress: { phase: 'init', percent: 0 },
      startedAt: 1,
      logs: [],
    };
    const status: PipelineTaskStatus = task.status;
    expect(status).toBe('pending');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pipeline-types.test.ts`
Expected: FAIL —「Cannot find module '../electron/pipeline/types'」

- [ ] **Step 3: 实现类型与常量**

```ts
// electron/pipeline/types.ts

export const PIPELINE_TASK_KINDS = [
  'tts',
  'write_script',
  'review_script',
  'analyze_subtitles',
  'generate_covers',
  'generate_storyboard',
  'generate_cards',
  'generate_motion',
  'export_video',
  'import_video_source',
] as const;

export type PipelineTaskKind = (typeof PIPELINE_TASK_KINDS)[number];

export type PipelineTaskStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface PipelineTaskProgress {
  phase: string;
  percent: number;
  message?: string;
}

export interface PipelineTaskError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PipelineTask {
  taskId: string;
  kind: PipelineTaskKind;
  projectPath: string;
  status: PipelineTaskStatus;
  progress: PipelineTaskProgress;
  startedAt: number;
  finishedAt?: number;
  result?: unknown;
  error?: PipelineTaskError;
  logs: string[];
}

const TERMINAL: ReadonlySet<PipelineTaskStatus> = new Set([
  'succeeded',
  'failed',
  'canceled',
]);

export function isTerminalStatus(s: PipelineTaskStatus): boolean {
  return TERMINAL.has(s);
}

export const PIPELINE_ERROR_CODES = {
  TASK_CONFLICT: 'task_conflict',
  NOT_CANCELABLE: 'not_cancelable',
  PROJECT_NOT_FOUND: 'project_not_found',
  INVALID_PROJECT: 'invalid_project',
  UNKNOWN_TASK: 'unknown_task',
  INTERNAL: 'internal',
} as const;

export const PIPELINE_TASK_LOG_LIMIT = 200;

/** 可取消的 task kinds（其余返回 not_cancelable） */
export const CANCELABLE_KINDS: ReadonlySet<PipelineTaskKind> = new Set<PipelineTaskKind>([
  'tts',
  'export_video',
  'write_script',
  'review_script',
  'analyze_subtitles',
  'generate_covers',
  'generate_storyboard',
  'generate_cards',
  'generate_motion',
  'import_video_source',
]);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/pipeline-types.test.ts`
Expected: PASS（4/4）

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/types.ts tests/pipeline-types.test.ts
git commit -m "feat(pipeline): 引入 PipelineTask 类型与错误码常量"
```

---

## Task 2: TaskRegistry（进程内 Map + 24h 终态 GC）

**Files:**
- Create: `electron/pipeline/task-registry.ts`
- Test: `tests/pipeline-task-registry.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/pipeline-task-registry.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskRegistry } from '../electron/pipeline/task-registry';
import type { PipelineTask } from '../electron/pipeline/types';

function makeTask(over: Partial<PipelineTask> = {}): PipelineTask {
  return {
    taskId: 't-' + Math.random().toString(36).slice(2),
    kind: 'tts',
    projectPath: '/tmp/p',
    status: 'pending',
    progress: { phase: 'init', percent: 0 },
    startedAt: Date.now(),
    logs: [],
    ...over,
  };
}

describe('TaskRegistry', () => {
  let reg: TaskRegistry;
  beforeEach(() => {
    reg = new TaskRegistry();
  });

  it('register / get / list', () => {
    const t = makeTask();
    reg.register(t);
    expect(reg.get(t.taskId)).toEqual(t);
    expect(reg.list()).toHaveLength(1);
  });

  it('list filters by projectPath', () => {
    reg.register(makeTask({ projectPath: '/a' }));
    reg.register(makeTask({ projectPath: '/b' }));
    expect(reg.list('/a')).toHaveLength(1);
  });

  it('hasActiveOfKind blocks duplicate concurrent kinds per project', () => {
    reg.register(makeTask({ projectPath: '/a', kind: 'tts', status: 'running' }));
    expect(reg.hasActiveOfKind('/a', 'tts')).toBe(true);
    expect(reg.hasActiveOfKind('/a', 'export_video')).toBe(false);
    expect(reg.hasActiveOfKind('/b', 'tts')).toBe(false);
  });

  it('terminal tasks GC after 24h', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const t = makeTask({ status: 'succeeded', finishedAt: now });
    reg.register(t);
    expect(reg.get(t.taskId)).toBeDefined();
    vi.setSystemTime(now + 24 * 3600_000 + 1);
    reg.gc();
    expect(reg.get(t.taskId)).toBeUndefined();
    vi.useRealTimers();
  });

  it('running tasks are not GCed regardless of age', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const t = makeTask({ status: 'running', startedAt: now });
    reg.register(t);
    vi.setSystemTime(now + 7 * 24 * 3600_000);
    reg.gc();
    expect(reg.get(t.taskId)).toBeDefined();
    vi.useRealTimers();
  });

  it('appendLog truncates to PIPELINE_TASK_LOG_LIMIT', () => {
    const t = makeTask();
    reg.register(t);
    for (let i = 0; i < 250; i++) reg.appendLog(t.taskId, `line-${i}`);
    const loaded = reg.get(t.taskId)!;
    expect(loaded.logs.length).toBe(200);
    expect(loaded.logs[0]).toBe('line-50');
    expect(loaded.logs[199]).toBe('line-249');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pipeline-task-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 TaskRegistry**

```ts
// electron/pipeline/task-registry.ts
import {
  isTerminalStatus,
  PIPELINE_TASK_LOG_LIMIT,
  type PipelineTask,
  type PipelineTaskKind,
  type PipelineTaskStatus,
  type PipelineTaskError,
  type PipelineTaskProgress,
} from './types';

const TERMINAL_TTL_MS = 24 * 3600 * 1000;

export class TaskRegistry {
  private tasks = new Map<string, PipelineTask>();

  register(task: PipelineTask): void {
    this.tasks.set(task.taskId, task);
  }

  get(taskId: string): PipelineTask | undefined {
    return this.tasks.get(taskId);
  }

  list(projectPath?: string): PipelineTask[] {
    const out: PipelineTask[] = [];
    for (const t of this.tasks.values()) {
      if (!projectPath || t.projectPath === projectPath) out.push(t);
    }
    return out;
  }

  hasActiveOfKind(projectPath: string, kind: PipelineTaskKind): boolean {
    for (const t of this.tasks.values()) {
      if (
        t.projectPath === projectPath &&
        t.kind === kind &&
        !isTerminalStatus(t.status)
      ) {
        return true;
      }
    }
    return false;
  }

  setStatus(
    taskId: string,
    status: PipelineTaskStatus,
    extra?: { result?: unknown; error?: PipelineTaskError },
  ): PipelineTask | undefined {
    const t = this.tasks.get(taskId);
    if (!t) return undefined;
    t.status = status;
    if (isTerminalStatus(status)) t.finishedAt = Date.now();
    if (extra?.result !== undefined) t.result = extra.result;
    if (extra?.error !== undefined) t.error = extra.error;
    return t;
  }

  patchProgress(taskId: string, progress: Partial<PipelineTaskProgress>): PipelineTask | undefined {
    const t = this.tasks.get(taskId);
    if (!t) return undefined;
    t.progress = { ...t.progress, ...progress };
    return t;
  }

  appendLog(taskId: string, line: string): void {
    const t = this.tasks.get(taskId);
    if (!t) return;
    t.logs.push(line);
    if (t.logs.length > PIPELINE_TASK_LOG_LIMIT) {
      t.logs.splice(0, t.logs.length - PIPELINE_TASK_LOG_LIMIT);
    }
  }

  gc(): void {
    const now = Date.now();
    for (const [id, t] of this.tasks) {
      if (
        isTerminalStatus(t.status) &&
        t.finishedAt !== undefined &&
        now - t.finishedAt > TERMINAL_TTL_MS
      ) {
        this.tasks.delete(id);
      }
    }
  }
}
```

- [ ] **Step 4: 测试通过**

Run: `npx vitest run tests/pipeline-task-registry.test.ts`
Expected: PASS（6/6）

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/task-registry.ts tests/pipeline-task-registry.test.ts
git commit -m "feat(pipeline): 实现 TaskRegistry 与 24h 终态 GC"
```

---

## Task 3: project-state 算法（has_* 与 last_export）

**Files:**
- Create: `electron/pipeline/algorithms/project-state.ts`
- Test: `tests/pipeline-project-state.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/pipeline-project-state.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { computeProjectState } from '../electron/pipeline/algorithms/project-state';

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'lingji-pstate-'));
}

describe('computeProjectState', () => {
  let dir: string;
  beforeEach(() => { dir = tmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns all-false when project is empty', async () => {
    const s = await computeProjectState(dir);
    expect(s).toEqual({
      has_original: false,
      has_script: false,
      has_audio: false,
      has_subtitles: false,
      has_analysis: false,
      has_covers: false,
      has_cards: false,
      has_timeline: false,
      last_export: null,
    });
  });

  it('detects original.md only when non-empty', async () => {
    writeFileSync(path.join(dir, 'original.md'), '');
    expect((await computeProjectState(dir)).has_original).toBe(false);
    writeFileSync(path.join(dir, 'original.md'), 'content');
    expect((await computeProjectState(dir)).has_original).toBe(true);
  });

  it('detects audio / subtitles by file existence', async () => {
    writeFileSync(path.join(dir, 'podcast-audio.mp3'), '');
    writeFileSync(path.join(dir, 'podcast-subtitles.srt'), 'x');
    const s = await computeProjectState(dir);
    expect(s.has_audio).toBe(true);
    expect(s.has_subtitles).toBe(true);
  });

  it('reads has_analysis / has_cards / has_timeline from project.json', async () => {
    writeFileSync(
      path.join(dir, 'project.json'),
      JSON.stringify({
        version: 1,
        timeline: { tracks: [{ overlays: [{ id: 'o' }] }] },
        aiAnalysis: {
          analysisResult: { subtitleAnalysis: { segments: [] }, cards: [{ id: 'c' }] },
        },
        script: {},
      }),
    );
    const s = await computeProjectState(dir);
    expect(s.has_analysis).toBe(true);
    expect(s.has_cards).toBe(true);
    expect(s.has_timeline).toBe(true);
  });

  it('detects covers/ when image files exist', async () => {
    mkdirSync(path.join(dir, 'covers'));
    writeFileSync(path.join(dir, 'covers/a.png'), '');
    expect((await computeProjectState(dir)).has_covers).toBe(true);
  });

  it('returns the most recent .mp4 path as last_export', async () => {
    const oldMp4 = path.join(dir, 'old.mp4');
    const newMp4 = path.join(dir, 'new.mp4');
    writeFileSync(oldMp4, '');
    writeFileSync(newMp4, '');
    const past = new Date('2025-01-01T00:00:00Z');
    const future = new Date('2026-01-01T00:00:00Z');
    utimesSync(oldMp4, past, past);
    utimesSync(newMp4, future, future);
    expect((await computeProjectState(dir)).last_export).toBe(newMp4);
  });
});
```

- [ ] **Step 2: 失败**

Run: `npx vitest run tests/pipeline-project-state.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```ts
// electron/pipeline/algorithms/project-state.ts
import fs from 'node:fs/promises';
import path from 'node:path';

export interface ProjectStateSnapshot {
  has_original: boolean;
  has_script: boolean;
  has_audio: boolean;
  has_subtitles: boolean;
  has_analysis: boolean;
  has_covers: boolean;
  has_cards: boolean;
  has_timeline: boolean;
  last_export: string | null;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

async function fileNonEmpty(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirHasImage(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.some(
      (e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()),
    );
  } catch {
    return false;
  }
}

async function readProjectJson(dir: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(path.join(dir, 'project.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function findLatestMp4(dir: string): Promise<string | null> {
  let entries: { name: string; isFile(): boolean }[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let bestPath: string | null = null;
  let bestMtime = -Infinity;
  for (const e of entries) {
    if (!e.isFile() || path.extname(e.name).toLowerCase() !== '.mp4') continue;
    const full = path.join(dir, e.name);
    try {
      const st = await fs.stat(full);
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        bestPath = full;
      }
    } catch {
      // 忽略
    }
  }
  return bestPath;
}

export async function computeProjectState(projectPath: string): Promise<ProjectStateSnapshot> {
  const [originalNon, scriptNon, audio, subtitles, covers, project, lastMp4] = await Promise.all([
    fileNonEmpty(path.join(projectPath, 'original.md')),
    fileNonEmpty(path.join(projectPath, 'script.md')),
    fileExists(path.join(projectPath, 'podcast-audio.mp3')),
    fileExists(path.join(projectPath, 'podcast-subtitles.srt')),
    dirHasImage(path.join(projectPath, 'covers')),
    readProjectJson(projectPath),
    findLatestMp4(projectPath),
  ]);

  const subtitleAnalysis =
    project?.aiAnalysis?.analysisResult?.subtitleAnalysis;
  const has_analysis =
    !!subtitleAnalysis &&
    typeof subtitleAnalysis === 'object' &&
    Object.keys(subtitleAnalysis).length > 0;

  const cards = project?.aiAnalysis?.analysisResult?.cards;
  const has_cards = Array.isArray(cards) && cards.length > 0;

  const tracks: unknown = project?.timeline?.tracks;
  const has_timeline =
    Array.isArray(tracks) &&
    tracks.some(
      (t: any) => Array.isArray(t?.overlays) && t.overlays.length > 0,
    );

  return {
    has_original: originalNon,
    has_script: scriptNon,
    has_audio: audio,
    has_subtitles: subtitles,
    has_analysis,
    has_covers: covers,
    has_cards,
    has_timeline,
    last_export: lastMp4,
  };
}
```

- [ ] **Step 4: 通过**

Run: `npx vitest run tests/pipeline-project-state.test.ts`
Expected: PASS（6/6）

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/algorithms/project-state.ts tests/pipeline-project-state.test.ts
git commit -m "feat(pipeline): 实现 has_* 与 last_export 检测"
```

---

## Task 4: HeadlessProjectContext 与 resolveProject

**Files:**
- Create: `electron/pipeline/context.ts`
- Test: `tests/pipeline-context.test.ts`

> **设计说明：** `resolveProject(projectPath)` 返回 `ProjectContext`：
> - `mode: 'active'` → 主窗口当前活动项目，调用方需要走 IPC（Plan A 不实际调用 IPC，只暴露 mode 让上层判断）
> - `mode: 'headless'` → 直接读写磁盘
>
> `HeadlessProjectContext` 提供 `loadProjectData()` / `saveSection(section, value)`，写回必须经 `electron/project-file.ts` 既有写锁。Plan A 不引入新的进程内写锁。
>
> Plan A 把"当前活动项目路径"通过 `setActiveProjectPath(p: string | null)` 静态注入；后续 main.ts 在 `load-project` 时调用。

- [ ] **Step 1: 写失败测试**

```ts
// tests/pipeline-context.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveProject,
  setActiveProjectPath,
  HeadlessProjectContext,
} from '../electron/pipeline/context';

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'lingji-ctx-'));
}

describe('resolveProject', () => {
  let dir: string;
  beforeEach(() => { dir = tmp(); setActiveProjectPath(null); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('throws project_not_found when directory does not exist', async () => {
    await expect(resolveProject('/nonexistent/dir/lingji')).rejects.toMatchObject({
      code: 'project_not_found',
    });
  });

  it('returns headless context for non-active project', async () => {
    writeFileSync(path.join(dir, 'project.json'), '{"version":1,"timeline":null,"aiAnalysis":{"analysisResult":null,"coverCandidates":[]},"script":{"templateId":"x","annotations":[],"reviewState":"idle","lastReviewedDocVersion":0}}');
    const ctx = await resolveProject(dir);
    expect(ctx.mode).toBe('headless');
    expect(ctx.projectPath).toBe(dir);
  });

  it('returns active context when path matches setActiveProjectPath', async () => {
    writeFileSync(path.join(dir, 'project.json'), '{"version":1,"timeline":null,"aiAnalysis":{"analysisResult":null,"coverCandidates":[]},"script":{"templateId":"x","annotations":[],"reviewState":"idle","lastReviewedDocVersion":0}}');
    setActiveProjectPath(dir);
    const ctx = await resolveProject(dir);
    expect(ctx.mode).toBe('active');
  });
});

describe('HeadlessProjectContext', () => {
  let dir: string;
  beforeEach(() => { dir = tmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loadProjectData triggers legacy migration when only timeline.json exists', async () => {
    writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ tracks: [], duration: 0 }));
    const ctx = new HeadlessProjectContext(dir);
    const data = await ctx.loadProjectData();
    expect(data.timeline).not.toBeNull();
    // 验证 project.json 已被写入
    expect(require('node:fs').existsSync(path.join(dir, 'project.json'))).toBe(true);
  });

  it('saveSection writes through writeLock and merges section', async () => {
    writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      timeline: null,
      aiAnalysis: { analysisResult: null, coverCandidates: [] },
      script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
    }));
    const ctx = new HeadlessProjectContext(dir);
    await ctx.saveSection('script', {
      templateId: 'news-broadcast',
      annotations: [],
      reviewState: 'idle',
      lastReviewedDocVersion: 0,
    });
    const re = await ctx.loadProjectData();
    expect(re.script.templateId).toBe('news-broadcast');
  });
});
```

- [ ] **Step 2: 失败**

Run: `npx vitest run tests/pipeline-context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```ts
// electron/pipeline/context.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadProjectData, writeProjectSection } from '../project-file';
import type { ProjectData, ProjectSection } from '../../src/lib/project-persistence';
import { PIPELINE_ERROR_CODES } from './types';

export type ProjectContext =
  | { mode: 'active'; projectPath: string }
  | { mode: 'headless'; projectPath: string; headless: HeadlessProjectContext };

let activeProjectPath: string | null = null;

export function setActiveProjectPath(p: string | null): void {
  activeProjectPath = p ? path.resolve(p) : null;
}

export function getActiveProjectPath(): string | null {
  return activeProjectPath;
}

class PipelineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function ensureProjectDir(projectPath: string): Promise<void> {
  try {
    const st = await fs.stat(projectPath);
    if (!st.isDirectory()) {
      throw new PipelineError(PIPELINE_ERROR_CODES.PROJECT_NOT_FOUND, `路径不是目录: ${projectPath}`);
    }
  } catch (e: any) {
    if (e instanceof PipelineError) throw e;
    throw new PipelineError(PIPELINE_ERROR_CODES.PROJECT_NOT_FOUND, `项目目录不存在: ${projectPath}`);
  }
}

export async function resolveProject(projectPath: string): Promise<ProjectContext> {
  const abs = path.resolve(projectPath);
  await ensureProjectDir(abs);
  if (activeProjectPath && abs === activeProjectPath) {
    return { mode: 'active', projectPath: abs };
  }
  return { mode: 'headless', projectPath: abs, headless: new HeadlessProjectContext(abs) };
}

export class HeadlessProjectContext {
  constructor(public readonly projectPath: string) {}

  /** 复用 electron/project-file.ts 的加载逻辑（含旧文件迁移） */
  async loadProjectData(): Promise<ProjectData> {
    return loadProjectData(this.projectPath);
  }

  /** 经写锁按节合并 */
  async saveSection<S extends ProjectSection>(
    section: S,
    value: ProjectData[S],
  ): Promise<void> {
    await writeProjectSection(this.projectPath, section, value);
  }
}
```

> **依赖：** Task 4 假设 `electron/project-file.ts` 已暴露 `loadProjectData(dir)` 与 `writeProjectSection(dir, section, value)`。Plan A 实施时若现有 API 名不一致，**先在 Task 4 内追加导出薄包装**到 `electron/project-file.ts`（不改原有逻辑），保持兼容。

- [ ] **Step 4: 检查并暴露兼容 API（若需要）**

阅读 `electron/project-file.ts` 当前已导出的函数。若没有 `loadProjectData(dir)` / `writeProjectSection(dir, section, value)`，在文件末尾追加：

```ts
// electron/project-file.ts 末尾
export async function loadProjectData(projectDir: string): Promise<ProjectData> {
  const existing = await readProjectJson(projectDir);
  if (existing) return existing;
  // 触发既有迁移逻辑
  return migrateAndPersist(projectDir);
}

export async function writeProjectSection<S extends ProjectSection>(
  projectDir: string,
  section: S,
  value: ProjectData[S],
): Promise<void> {
  await withWriteLock(projectDir, async () => {
    const data = (await readProjectJson(projectDir)) ?? createDefaultProjectData();
    const merged = mergeProjectSection(data, section, value);
    await writeProjectJson(projectDir, merged);
  });
}
```

> 实施者必须先 `Read electron/project-file.ts` 完整文件，确认 `migrateAndPersist` / `createDefaultProjectData` 等内部函数名是否存在且签名正确；不一致时调整薄包装的内部调用，不改既有外部 API。

- [ ] **Step 5: 通过**

Run: `npx vitest run tests/pipeline-context.test.ts`
Expected: PASS（5/5）

- [ ] **Step 6: 提交**

```bash
git add electron/pipeline/context.ts electron/project-file.ts tests/pipeline-context.test.ts
git commit -m "feat(pipeline): 引入 resolveProject 与 HeadlessProjectContext"
```

---

## Task 5: PipelineService 单例骨架

**Files:**
- Create: `electron/pipeline/index.ts`
- Test: `tests/pipeline-service.test.ts`

> **职责：**
> - 持有 `TaskRegistry` 单例
> - `createTask(kind, projectPath, run)` 创建任务、返回 `{ taskId }`、异步执行 run
> - `cancelTask(taskId)` / `getTask(taskId)` / `listTasks(projectPath?)`
> - `run` 函数接收 `TaskHandle`：`update(progress)` / `log(line)` / `signal: AbortSignal`
> - 同一项目同 kind 并发返回 `task_conflict`
> - 终态触发 `bridge.notifyTerminal(task)` 与定时 GC

- [ ] **Step 1: 写失败测试**

```ts
// tests/pipeline-service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PipelineService } from '../electron/pipeline';

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-svc-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1,
    createdAt: 'x', updatedAt: 'x',
    timeline: null,
    aiAnalysis: { analysisResult: null, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  return dir;
}

describe('PipelineService', () => {
  let svc: PipelineService;
  let dir: string;
  beforeEach(() => {
    svc = new PipelineService();
    dir = tmpProject();
  });

  it('createTask returns taskId immediately and runs async', async () => {
    let observedHandle = false;
    const { taskId } = await svc.createTask('tts', dir, async (handle) => {
      observedHandle = !!handle;
      handle.update({ phase: 'a', percent: 50 });
      return { audioPath: 'a', srtPath: 'b', durationSec: 1 };
    });
    expect(taskId).toBeTruthy();
    // 等 run 跑完
    await svc.waitForSettle(taskId);
    const t = svc.getTask(taskId)!;
    expect(observedHandle).toBe(true);
    expect(t.status).toBe('succeeded');
    expect(t.result).toEqual({ audioPath: 'a', srtPath: 'b', durationSec: 1 });
  });

  it('throws task_conflict when same kind already active', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await svc.createTask('tts', dir, async () => { await gate; });
    await expect(svc.createTask('tts', dir, async () => {})).rejects.toMatchObject({
      code: 'task_conflict',
    });
    release();
  });

  it('different kinds in same project run concurrently', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await svc.createTask('tts', dir, async () => { await gate; });
    const second = await svc.createTask('export_video', dir, async () => 'ok');
    expect(second.taskId).toBeTruthy();
    release();
  });

  it('cancelTask aborts via signal for cancelable kinds', async () => {
    const { taskId } = await svc.createTask('tts', dir, async (h) =>
      new Promise((resolve, reject) => {
        h.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    );
    await svc.cancelTask(taskId);
    await svc.waitForSettle(taskId);
    expect(svc.getTask(taskId)!.status).toBe('canceled');
  });

  it('cancelTask returns not_cancelable error for unknown taskId', async () => {
    await expect(svc.cancelTask('nope')).rejects.toMatchObject({ code: 'unknown_task' });
  });

  it('failed run sets status=failed and error', async () => {
    const { taskId } = await svc.createTask('tts', dir, async () => {
      throw new Error('boom');
    });
    await svc.waitForSettle(taskId);
    const t = svc.getTask(taskId)!;
    expect(t.status).toBe('failed');
    expect(t.error?.message).toBe('boom');
  });
});
```

- [ ] **Step 2: 失败**

Run: `npx vitest run tests/pipeline-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```ts
// electron/pipeline/index.ts
import { randomUUID } from 'node:crypto';
import { TaskRegistry } from './task-registry';
import { resolveProject } from './context';
import {
  CANCELABLE_KINDS,
  PIPELINE_ERROR_CODES,
  isTerminalStatus,
  type PipelineTask,
  type PipelineTaskKind,
  type PipelineTaskProgress,
} from './types';

export interface TaskHandle {
  taskId: string;
  signal: AbortSignal;
  update(progress: Partial<PipelineTaskProgress>): void;
  log(line: string): void;
}

export type PipelineRunFn<T> = (handle: TaskHandle) => Promise<T>;

class PipelineError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

interface RunningEntry {
  controller: AbortController;
  settle: Promise<void>;
}

export class PipelineService {
  private registry = new TaskRegistry();
  private running = new Map<string, RunningEntry>();
  private listeners = new Set<(t: PipelineTask) => void>();
  private gcTimer: NodeJS.Timeout | null = null;

  startGcTimer(intervalMs = 60_000): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => this.registry.gc(), intervalMs);
    // 防止 timer 阻止进程退出
    if (typeof this.gcTimer.unref === 'function') this.gcTimer.unref();
  }

  stopGcTimer(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = null;
  }

  onTaskUpdate(fn: (t: PipelineTask) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(task: PipelineTask): void {
    for (const fn of this.listeners) {
      try { fn(task); } catch { /* 忽略监听器异常 */ }
    }
  }

  async createTask<T>(
    kind: PipelineTaskKind,
    projectPath: string,
    run: PipelineRunFn<T>,
  ): Promise<{ taskId: string }> {
    // 校验项目存在 — 复用 resolveProject 的目录检测；放弃 context 引用，仅用其错误抛出
    await resolveProject(projectPath);

    if (this.registry.hasActiveOfKind(projectPath, kind)) {
      throw new PipelineError(
        PIPELINE_ERROR_CODES.TASK_CONFLICT,
        `项目已有运行中的同类任务: ${kind}`,
      );
    }

    const taskId = randomUUID();
    const task: PipelineTask = {
      taskId,
      kind,
      projectPath,
      status: 'running',
      progress: { phase: 'pending', percent: 0 },
      startedAt: Date.now(),
      logs: [],
    };
    this.registry.register(task);
    this.emit(task);

    const controller = new AbortController();
    const handle: TaskHandle = {
      taskId,
      signal: controller.signal,
      update: (p) => {
        const t = this.registry.patchProgress(taskId, p);
        if (t) this.emit(t);
      },
      log: (line) => {
        this.registry.appendLog(taskId, line);
      },
    };

    const settle = (async () => {
      try {
        const result = await run(handle);
        if (controller.signal.aborted) {
          this.registry.setStatus(taskId, 'canceled');
        } else {
          this.registry.setStatus(taskId, 'succeeded', { result });
        }
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') {
          this.registry.setStatus(taskId, 'canceled');
        } else {
          this.registry.setStatus(taskId, 'failed', {
            error: {
              code: err?.code ?? PIPELINE_ERROR_CODES.INTERNAL,
              message: err?.message ?? String(err),
              retryable: err?.retryable ?? true,
            },
          });
        }
      } finally {
        const final = this.registry.get(taskId);
        if (final) this.emit(final);
        this.running.delete(taskId);
      }
    })();

    this.running.set(taskId, { controller, settle });
    return { taskId };
  }

  async cancelTask(taskId: string): Promise<void> {
    const t = this.registry.get(taskId);
    if (!t) {
      throw new PipelineError(PIPELINE_ERROR_CODES.UNKNOWN_TASK, `未知任务: ${taskId}`);
    }
    if (isTerminalStatus(t.status)) return;
    if (!CANCELABLE_KINDS.has(t.kind)) {
      throw new PipelineError(
        PIPELINE_ERROR_CODES.NOT_CANCELABLE,
        `该任务类型不支持取消: ${t.kind}`,
      );
    }
    const entry = this.running.get(taskId);
    entry?.controller.abort();
    await this.waitForSettle(taskId);
  }

  async waitForSettle(taskId: string): Promise<void> {
    const entry = this.running.get(taskId);
    if (entry) await entry.settle;
  }

  getTask(taskId: string): PipelineTask | undefined {
    return this.registry.get(taskId);
  }

  listTasks(projectPath?: string): PipelineTask[] {
    return this.registry.list(projectPath);
  }
}

let _instance: PipelineService | null = null;
export function getPipelineService(): PipelineService {
  if (!_instance) {
    _instance = new PipelineService();
    _instance.startGcTimer();
  }
  return _instance;
}

export { PIPELINE_ERROR_CODES } from './types';
```

- [ ] **Step 4: 通过**

Run: `npx vitest run tests/pipeline-service.test.ts`
Expected: PASS（6/6）

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/index.ts tests/pipeline-service.test.ts
git commit -m "feat(pipeline): 实现 PipelineService 与 fire-and-poll 任务模型"
```

---

## Task 6: task-progress 桥接（PipelineService → renderer store，单向）

**Files:**
- Create: `electron/pipeline/task-progress-bridge.ts`
- Modify: `electron/preload.ts`、`src/lib/electron-api.ts`、`src/store/task-progress.ts`（新增 IPC 事件订阅，不改 store 公共 API）
- Test: `tests/pipeline-task-progress-bridge.test.ts`

> **设计：** 桥用 `BrowserWindow.webContents.send('pipeline:task-update', task)` 推送，renderer 在应用启动早期调用 `electronAPI.onPipelineTaskUpdate(cb)` 订阅，回调内部调用 `taskProgressStore.startTask` / `updateTask` / `completeTask` / `failTask`。
>
> Renderer 自己发起的任务（task-progress.startTask 由 renderer 直接调）id 与 PipelineTask.taskId 不冲突，因为 PipelineTask.taskId 为 uuid，bridge 写入的 id = `pipeline:${taskId}`，避免双源覆盖。

- [ ] **Step 1: 写失败测试（仅测桥逻辑，不依赖 BrowserWindow）**

```ts
// tests/pipeline-task-progress-bridge.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTaskProgressBridge } from '../electron/pipeline/task-progress-bridge';
import type { PipelineTask } from '../electron/pipeline/types';

function makeTask(over: Partial<PipelineTask> = {}): PipelineTask {
  return {
    taskId: 'a',
    kind: 'tts',
    projectPath: '/p',
    status: 'running',
    progress: { phase: 'init', percent: 0 },
    startedAt: 0,
    logs: [],
    ...over,
  };
}

describe('task-progress bridge', () => {
  it('forwards task updates as IPC payload with prefixed id', () => {
    const sent: Array<[string, unknown]> = [];
    const bridge = createTaskProgressBridge({
      send: (channel, payload) => sent.push([channel, payload]),
    });
    bridge.notify(makeTask({ status: 'running', progress: { phase: 'a', percent: 30 } }));
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe('pipeline:task-update');
    expect((sent[0][1] as any).bridgeId).toBe('pipeline:a');
    expect((sent[0][1] as any).status).toBe('running');
  });

  it('does not throw when sender is null', () => {
    const bridge = createTaskProgressBridge({ send: null });
    expect(() => bridge.notify(makeTask())).not.toThrow();
  });
});
```

- [ ] **Step 2: 失败**

Run: `npx vitest run tests/pipeline-task-progress-bridge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现桥**

```ts
// electron/pipeline/task-progress-bridge.ts
import type { PipelineTask } from './types';

export type BridgeSender = ((channel: string, payload: unknown) => void) | null;

export interface TaskProgressBridge {
  notify(task: PipelineTask): void;
}

export function createTaskProgressBridge(opts: { send: BridgeSender }): TaskProgressBridge {
  return {
    notify(task) {
      if (!opts.send) return;
      try {
        opts.send('pipeline:task-update', {
          ...task,
          bridgeId: `pipeline:${task.taskId}`,
        });
      } catch {
        // 渲染窗口可能已关闭
      }
    },
  };
}
```

- [ ] **Step 4: 在 PipelineService 中接桥**

修改 `electron/pipeline/index.ts`，在 `getPipelineService()` 之外新增工厂函数 `attachTaskProgressBridge(svc, getMainWindow)`：

```ts
// 追加到 electron/pipeline/index.ts
import { createTaskProgressBridge, type BridgeSender } from './task-progress-bridge';
import type { BrowserWindow } from 'electron';

export function attachTaskProgressBridge(
  svc: PipelineService,
  getMainWindow: () => BrowserWindow | null,
): () => void {
  const sender: BridgeSender = (channel, payload) => {
    const win = getMainWindow();
    win?.webContents.send(channel, payload);
  };
  const bridge = createTaskProgressBridge({ send: sender });
  return svc.onTaskUpdate((task) => bridge.notify(task));
}
```

- [ ] **Step 5: 通过**

Run: `npx vitest run tests/pipeline-task-progress-bridge.test.ts`
Expected: PASS（2/2）

- [ ] **Step 6: 提交**

```bash
git add electron/pipeline/task-progress-bridge.ts electron/pipeline/index.ts tests/pipeline-task-progress-bridge.test.ts
git commit -m "feat(pipeline): 桥接 PipelineTask 到 renderer task-progress 通道"
```

> **暂不**修改 `electron/preload.ts` / `src/lib/electron-api.ts` / renderer 订阅。Plan A 完成桥的主进程侧即可。renderer 侧消费在 Plan C（22 工具实现时）一次性接入，避免空 IPC 接口提前固化。

---

## Task 7: lingji_create_project 工具

**Files:**
- Create: `electron/pipeline/tools/project-tools.ts`
- Test: `tests/pipeline-tools-project.test.ts`

> **行为契约：**
> - 入参：`{ path: string, options?: { name?: string; meta?: object } }`
> - 校验：path 必须为绝对路径；目标目录不存在或为空才允许创建；非空目录返回 `invalid_project`。
> - 落盘骨架：
>   - `project.json`（用 `createDefaultProjectData()`）
>   - `original.md`（空文件）
>   - 目录：`covers/`、`ai-cards/`、`configs/prompts/`
>   - 不创建 `script.md` / 音频 / SRT
> - 返回：`{ projectPath: string }`

- [ ] **Step 1: 写失败测试**

```ts
// tests/pipeline-tools-project.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProject, getProjectState } from '../electron/pipeline/tools/project-tools';

function tmpRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'lingji-cp-'));
}

describe('createProject', () => {
  let root: string;
  beforeEach(() => { root = tmpRoot(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('rejects relative paths', async () => {
    await expect(createProject({ path: 'foo' })).rejects.toMatchObject({
      code: 'invalid_project',
    });
  });

  it('creates project skeleton in fresh directory', async () => {
    const target = path.join(root, 'p1');
    const out = await createProject({ path: target });
    expect(out.projectPath).toBe(target);
    expect(existsSync(path.join(target, 'project.json'))).toBe(true);
    expect(existsSync(path.join(target, 'original.md'))).toBe(true);
    expect(existsSync(path.join(target, 'covers'))).toBe(true);
    expect(existsSync(path.join(target, 'ai-cards'))).toBe(true);
    expect(existsSync(path.join(target, 'configs/prompts'))).toBe(true);
    expect(existsSync(path.join(target, 'script.md'))).toBe(false);
    const data = JSON.parse(readFileSync(path.join(target, 'project.json'), 'utf-8'));
    expect(data.version).toBe(1);
    expect(data.timeline).toBeNull();
  });

  it('rejects non-empty existing directory', async () => {
    const target = path.join(root, 'p2');
    mkdirSync(target);
    writeFileSync(path.join(target, 'rogue.txt'), 'x');
    await expect(createProject({ path: target })).rejects.toMatchObject({
      code: 'invalid_project',
    });
  });

  it('accepts empty existing directory', async () => {
    const target = path.join(root, 'p3');
    mkdirSync(target);
    const out = await createProject({ path: target });
    expect(out.projectPath).toBe(target);
    expect(existsSync(path.join(target, 'project.json'))).toBe(true);
  });
});

describe('getProjectState', () => {
  let root: string;
  beforeEach(() => { root = tmpRoot(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('reflects fresh skeleton (all-false)', async () => {
    const target = path.join(root, 'p');
    await createProject({ path: target });
    const s = await getProjectState({ projectPath: target });
    expect(s.has_original).toBe(false);
    expect(s.has_audio).toBe(false);
    expect(s.last_export).toBeNull();
  });

  it('detects original.md after writing content', async () => {
    const target = path.join(root, 'p');
    await createProject({ path: target });
    writeFileSync(path.join(target, 'original.md'), 'hi');
    const s = await getProjectState({ projectPath: target });
    expect(s.has_original).toBe(true);
  });
});
```

- [ ] **Step 2: 失败**

Run: `npx vitest run tests/pipeline-tools-project.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```ts
// electron/pipeline/tools/project-tools.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDefaultProjectData } from '../../../src/lib/project-persistence';
import { computeProjectState, type ProjectStateSnapshot } from '../algorithms/project-state';
import { resolveProject } from '../context';
import { PIPELINE_ERROR_CODES } from '../types';

class PipelineError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export interface CreateProjectInput {
  path: string;
  options?: { name?: string; meta?: Record<string, unknown> };
}

export interface CreateProjectOutput {
  projectPath: string;
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.length === 0;
  } catch {
    return true; // 不存在视为可创建
  }
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(dir);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
  if (!path.isAbsolute(input.path)) {
    throw new PipelineError(PIPELINE_ERROR_CODES.INVALID_PROJECT, 'path 必须为绝对路径');
  }
  const target = input.path;
  const exists = await dirExists(target);
  if (exists && !(await isEmptyDir(target))) {
    throw new PipelineError(
      PIPELINE_ERROR_CODES.INVALID_PROJECT,
      `目标目录非空: ${target}`,
    );
  }

  await fs.mkdir(target, { recursive: true });
  await Promise.all([
    fs.mkdir(path.join(target, 'covers'), { recursive: true }),
    fs.mkdir(path.join(target, 'ai-cards'), { recursive: true }),
    fs.mkdir(path.join(target, 'configs/prompts'), { recursive: true }),
  ]);

  const data = createDefaultProjectData();
  await fs.writeFile(
    path.join(target, 'project.json'),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
  await fs.writeFile(path.join(target, 'original.md'), '', 'utf-8');

  return { projectPath: target };
}

export async function getProjectState(input: { projectPath: string }): Promise<ProjectStateSnapshot> {
  await resolveProject(input.projectPath);
  return computeProjectState(input.projectPath);
}

export async function openProject(input: { path: string }): Promise<{ ok: true }> {
  await resolveProject(input.path);
  return { ok: true };
}
```

- [ ] **Step 4: 通过**

Run: `npx vitest run tests/pipeline-tools-project.test.ts`
Expected: PASS（6/6）

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/tools/project-tools.ts tests/pipeline-tools-project.test.ts
git commit -m "feat(pipeline): 实现 create_project / open_project / get_project_state"
```

---

## Task 8: lingji_get_settings 工具

**Files:**
- Modify: `electron/pipeline/tools/project-tools.ts`（追加 `getSettings`）
- Test: `tests/pipeline-tools-project.test.ts`（追加用例）

> **设计：** 主进程读取 `electron/global-settings.ts`（已有）暴露的"App Settings 默认值"。Plan A 不暴露 API Key 等敏感字段，仅返回：
>
> ```ts
> { defaultProvider, defaultModel, ttsDefaults, exportDefaults, promptBindings }
> ```
>
> 实施者必须先 `Read electron/global-settings.ts` 确认现有导出（如 `getGlobalAISettings()` / `getTTSDefaults()` 等），不一致时按现有 API 名调整。**禁止**复制 API Key、Secret 等字段到返回值。

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 tests/pipeline-tools-project.test.ts
import { getSettings } from '../electron/pipeline/tools/project-tools';
import { vi } from 'vitest';

describe('getSettings', () => {
  it('returns sanitized defaults without secrets', async () => {
    const out = await getSettings();
    expect(out).toHaveProperty('defaultProvider');
    expect(out).toHaveProperty('promptBindings');
    // 反向断言：确保没有泄漏 key 字段
    expect(JSON.stringify(out)).not.toMatch(/apiKey|secret/i);
  });
});
```

- [ ] **Step 2: 失败**

Expected: FAIL — `getSettings` undefined.

- [ ] **Step 3: 实现 `getSettings`**

实施者读取 `electron/global-settings.ts`，根据现有导出选取以下字段（缺失的字段返回 `null`）：

```ts
// 追加到 electron/pipeline/tools/project-tools.ts
import { getGlobalAISettings } from '../../global-settings'; // 路径按现有调整

export interface SettingsSnapshot {
  defaultProvider: string | null;
  defaultModel: string | null;
  ttsDefaults: Record<string, unknown> | null;
  exportDefaults: Record<string, unknown> | null;
  promptBindings: Record<string, unknown> | null;
}

function sanitize<T extends Record<string, unknown>>(obj: T | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/apiKey|secret|token/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function getSettings(): Promise<SettingsSnapshot> {
  const ai = await getGlobalAISettings();
  return {
    defaultProvider: ai?.defaultProviderId ?? null,
    defaultModel: ai?.defaultModel ?? null,
    ttsDefaults: sanitize(ai?.tts as any),
    exportDefaults: sanitize(ai?.exportDefaults as any),
    promptBindings: sanitize(ai?.promptBindings as any),
  };
}
```

> 实施者必须先验证 `getGlobalAISettings` 是否真实存在；若不存在，使用最贴近的现有 API（如 `loadGlobalSettings()`），并保持白名单 + sanitize。

- [ ] **Step 4: 通过**

Run: `npx vitest run tests/pipeline-tools-project.test.ts`
Expected: PASS（含新增用例）

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/tools/project-tools.ts tests/pipeline-tools-project.test.ts
git commit -m "feat(pipeline): 实现 get_settings（白名单 sanitize 后返回）"
```

---

## Task 9: 任务工具（get_task_status / cancel_task / list_tasks）

**Files:**
- Create: `electron/pipeline/tools/task-tools.ts`
- Test: `tests/pipeline-tools-task.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/pipeline-tools-task.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PipelineService } from '../electron/pipeline';
import {
  buildTaskTools,
} from '../electron/pipeline/tools/task-tools';

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-tt-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1,
    createdAt: 'x', updatedAt: 'x',
    timeline: null,
    aiAnalysis: { analysisResult: null, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  return dir;
}

describe('task tools', () => {
  let svc: PipelineService;
  let tools: ReturnType<typeof buildTaskTools>;
  let dir: string;
  beforeEach(() => {
    svc = new PipelineService();
    tools = buildTaskTools(svc);
    dir = tmpProject();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('get_task_status returns full task object', async () => {
    const { taskId } = await svc.createTask('tts', dir, async () => 'r');
    await svc.waitForSettle(taskId);
    const t = await tools.getTaskStatus({ taskId });
    expect(t.status).toBe('succeeded');
    expect(t.taskId).toBe(taskId);
  });

  it('get_task_status throws unknown_task for missing id', async () => {
    await expect(tools.getTaskStatus({ taskId: 'nope' })).rejects.toMatchObject({
      code: 'unknown_task',
    });
  });

  it('list_tasks filters by projectPath', async () => {
    const { taskId } = await svc.createTask('tts', dir, async () => 'r');
    await svc.waitForSettle(taskId);
    expect((await tools.listTasks({ projectPath: dir })).length).toBe(1);
    expect((await tools.listTasks({ projectPath: '/nowhere' })).length).toBe(0);
  });

  it('cancel_task aborts a running cancelable task', async () => {
    const { taskId } = await svc.createTask('tts', dir, async (h) =>
      new Promise((_resolve, reject) => {
        h.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
      }),
    );
    await tools.cancelTask({ taskId });
    expect(svc.getTask(taskId)!.status).toBe('canceled');
  });
});
```

- [ ] **Step 2: 失败**

Run: `npx vitest run tests/pipeline-tools-task.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```ts
// electron/pipeline/tools/task-tools.ts
import type { PipelineService } from '..';
import { PIPELINE_ERROR_CODES, type PipelineTask } from '../types';

class PipelineError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function buildTaskTools(svc: PipelineService) {
  return {
    async getTaskStatus(input: { taskId: string }): Promise<PipelineTask> {
      const t = svc.getTask(input.taskId);
      if (!t) {
        throw new PipelineError(PIPELINE_ERROR_CODES.UNKNOWN_TASK, `未知任务: ${input.taskId}`);
      }
      return t;
    },

    async cancelTask(input: { taskId: string }): Promise<{ ok: true }> {
      await svc.cancelTask(input.taskId);
      return { ok: true };
    },

    async listTasks(input: { projectPath?: string } = {}): Promise<PipelineTask[]> {
      return svc.listTasks(input.projectPath);
    },
  };
}
```

- [ ] **Step 4: 通过**

Run: `npx vitest run tests/pipeline-tools-task.test.ts`
Expected: PASS（4/4）

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/tools/task-tools.ts tests/pipeline-tools-task.test.ts
git commit -m "feat(pipeline): 实现 get_task_status / cancel_task / list_tasks"
```

---

## Task 10: MCP 工具注册（接入 7 个新工具到现有 server）

**Files:**
- Modify: `electron/mcp/tools.ts`（在 `registerTools` 末尾追加 7 个工具的注册）
- Modify: `electron/main.ts`（在 app ready 后初始化 `getPipelineService()` + `attachTaskProgressBridge`）
- Test: `tests/pipeline-mcp-registration.test.ts`

> **设计：** 不重构现有工具；仅追加新工具的 `server.registerTool` 调用，统一使用 `withToolLog`、`jsonResult`、`errorResult` 风格保持日志一致。每个工具的 schema 用 zod，错误捕获后映射为 `{ error: { code, message } }` JSON。

- [ ] **Step 1: 阅读现有 `registerTools` 完整实现，确认 `jsonResult` / `errorResult` 是否已定义**

Read `electron/mcp/tools.ts`（完整文件）。本任务实施者必须把现有 helper 复用到位，避免重复定义。

- [ ] **Step 2: 写集成测试（registerTools 后所有 7 个工具都能调）**

```ts
// tests/pipeline-mcp-registration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 我们不实例化真正的 McpServer，只 spy registerTool
class FakeMcpServer {
  tools = new Map<string, { def: any; handler: Function }>();
  registerTool(name: string, def: any, handler: Function) {
    this.tools.set(name, { def, handler });
  }
}

describe('mcp registration of pipeline tools', () => {
  it('registers 7 new tools', async () => {
    const { registerTools } = await import('../electron/mcp/tools');
    const server = new FakeMcpServer();
    // getMainWindow 返回 null：现有工具会用错误结果回退；新工具不依赖窗口
    registerTools(server as any, () => null);
    const expected = [
      'lingji_create_project',
      'lingji_open_project',
      'lingji_get_project_state',
      'lingji_get_settings',
      'lingji_get_task_status',
      'lingji_cancel_task',
      'lingji_list_tasks',
    ];
    for (const name of expected) {
      expect(server.tools.has(name)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: 失败**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts`
Expected: FAIL — 工具未注册。

- [ ] **Step 4: 修改 `electron/mcp/tools.ts`**

在 `registerTools` 函数末尾（return 之前），追加：

```ts
import { z } from 'zod';
import { getPipelineService } from '../pipeline';
import {
  createProject,
  openProject,
  getProjectState,
  getSettings,
} from '../pipeline/tools/project-tools';
import { buildTaskTools } from '../pipeline/tools/task-tools';

// ─── Pipeline 项目层与任务层工具 ─────────────────────────
const taskTools = buildTaskTools(getPipelineService());

server.registerTool(
  'lingji_create_project',
  {
    title: '创建工程',
    description: '在指定路径创建一个空的灵机项目骨架（project.json/original.md/covers/ai-cards/configs/prompts）。目标目录必须不存在或为空。',
    inputSchema: {
      path: z.string().describe('项目目录绝对路径'),
      options: z
        .object({
          name: z.string().optional(),
          meta: z.record(z.unknown()).optional(),
        })
        .optional(),
    },
  },
  async ({ path: p, options }) =>
    withToolLog('lingji_create_project', { path: p }, async () => {
      try {
        const out = await createProject({ path: p, options });
        return jsonResult(out);
      } catch (err: any) {
        return errorResult(err?.message ?? String(err), err?.code);
      }
    }),
);

server.registerTool(
  'lingji_open_project',
  {
    title: '打开工程',
    description: '校验项目目录是否合法，可选调用',
    inputSchema: { path: z.string() },
  },
  async ({ path: p }) =>
    withToolLog('lingji_open_project', { path: p }, async () => {
      try {
        const out = await openProject({ path: p });
        return jsonResult(out);
      } catch (err: any) {
        return errorResult(err?.message ?? String(err), err?.code);
      }
    }),
);

server.registerTool(
  'lingji_get_project_state',
  {
    title: '查询工程状态',
    description: '返回当前项目素材产物推导状态：has_original / has_script / has_audio / ... / last_export',
    inputSchema: { projectPath: z.string() },
  },
  async ({ projectPath }) =>
    withToolLog('lingji_get_project_state', { projectPath }, async () => {
      try {
        const out = await getProjectState({ projectPath });
        return jsonResult(out);
      } catch (err: any) {
        return errorResult(err?.message ?? String(err), err?.code);
      }
    }),
);

server.registerTool(
  'lingji_get_settings',
  {
    title: '查询应用默认设置',
    description: '返回 Provider/模型/TTS/导出/提示词绑定的默认值（不含 API Key 等敏感字段）',
  },
  async () =>
    withToolLog('lingji_get_settings', {}, async () => {
      try {
        return jsonResult(await getSettings());
      } catch (err: any) {
        return errorResult(err?.message ?? String(err), err?.code);
      }
    }),
);

server.registerTool(
  'lingji_get_task_status',
  {
    title: '查询任务状态',
    description: '按 taskId 查询 PipelineTask 完整对象',
    inputSchema: { taskId: z.string() },
  },
  async ({ taskId }) =>
    withToolLog('lingji_get_task_status', { taskId }, async () => {
      try {
        return jsonResult(await taskTools.getTaskStatus({ taskId }));
      } catch (err: any) {
        return errorResult(err?.message ?? String(err), err?.code);
      }
    }),
);

server.registerTool(
  'lingji_cancel_task',
  {
    title: '取消任务',
    description: '尝试取消运行中的 PipelineTask；不可取消时返回 not_cancelable',
    inputSchema: { taskId: z.string() },
  },
  async ({ taskId }) =>
    withToolLog('lingji_cancel_task', { taskId }, async () => {
      try {
        return jsonResult(await taskTools.cancelTask({ taskId }));
      } catch (err: any) {
        return errorResult(err?.message ?? String(err), err?.code);
      }
    }),
);

server.registerTool(
  'lingji_list_tasks',
  {
    title: '列出任务',
    description: '列出在跑或 24h 内终态的 PipelineTask；可按 projectPath 过滤',
    inputSchema: {
      projectPath: z.string().optional(),
    },
  },
  async ({ projectPath }) =>
    withToolLog('lingji_list_tasks', { projectPath }, async () => {
      try {
        return jsonResult(await taskTools.listTasks({ projectPath }));
      } catch (err: any) {
        return errorResult(err?.message ?? String(err), err?.code);
      }
    }),
);
```

> 实施者需检查 `errorResult` 当前签名是否支持第二参 `code`；若不支持，扩展为 `errorResult(message: string, code?: string)`，未传 code 时维持旧行为；不破坏现有用例。

- [ ] **Step 5: 修改 `electron/main.ts` 接入桥**

在 `app.whenReady()` 回调（创建主窗口后）追加：

```ts
import { getPipelineService, attachTaskProgressBridge } from './pipeline';
import { setActiveProjectPath } from './pipeline/context';

const svc = getPipelineService();
attachTaskProgressBridge(svc, () => mainWindow); // mainWindow 是现有变量
```

并在现有 `load-project` IPC handler 内调用 `setActiveProjectPath(projectDir)`；在 `close-project`（如果存在）内调用 `setActiveProjectPath(null)`。
实施者需先 Read `electron/main.ts` 找到 `load-project` handler，确认变量名后再插入。**不**改 handler 已有逻辑。

- [ ] **Step 6: 通过**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts`
Expected: PASS（1/1）

附加：跑全量 pipeline 相关测试确保未回归
Run: `npx vitest run tests/pipeline-*.test.ts`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add electron/mcp/tools.ts electron/main.ts tests/pipeline-mcp-registration.test.ts
git commit -m "feat(pipeline): 接入 7 个 MCP 工具与任务进度桥"
```

---

## Task 11: 端到端 sanity 验证（构建 + 测试套件）

**Files:**
- 无新增；只跑命令验收

- [ ] **Step 1: 全量 vitest 跑通**

Run: `npm test`
Expected: 全部 PASS（包括既有用例不应回归）

- [ ] **Step 2: 主进程类型检查**

Run: `npm run build`
Expected: 构建成功；输出 `dist-electron/main.js`、`dist-electron/preload.js` 与 renderer bundle。
> 若出现 TS 错误，修复至 build 干净；**不**新增 `// @ts-ignore`。

- [ ] **Step 3: 提交（若 build 阶段需要类型修补）**

```bash
git add -u
git commit -m "chore(pipeline): 修复构建期类型问题"
```

如果 build 一次过，跳过此步。

---

## Self-Review Checklist（已执行）

1. **Spec coverage：**
   - 22 工具中 Plan A 覆盖：`create_project` / `open_project` / `get_project_state` / `get_settings` / `get_task_status` / `cancel_task` / `list_tasks`（7 个同步基础工具）。剩余 15 工具明确不在本 plan，留给 Plan C。
   - 任务模型（fire-and-poll、PipelineTask 结构、错误码、24h GC、可取消白名单、并发同 kind 冲突）：覆盖。
   - resolveProject / HeadlessProjectContext：覆盖（不调 IPC，仅暴露 mode）。
   - task-progress 桥：覆盖到主进程侧；renderer 订阅留给 Plan C。
   - `last_export` / `has_*` 文件检测规则：覆盖。
2. **Placeholder 扫描：** 所有 step 含可执行代码或显式命令；没有 `TBD` / `appropriate error handling` / `add validation` 等模糊指令。
3. **类型一致性：** `PipelineTask` / `PipelineTaskKind` / `PipelineTaskStatus` 在所有任务中拼写一致；`createTaskProgressBridge` / `attachTaskProgressBridge` / `getPipelineService` / `setActiveProjectPath` 命名稳定。

---

## 验收标准

Plan A 完成 = 全部 11 个 task 通过且：

- `npm test` 全绿
- `npm run build` 全绿
- MCP 客户端连接后能调到 7 个新工具，并按 spec 返回字段
- 不破坏既有 12+ 个 MCP 工具与既有用例
- `electron/pipeline/` 目录结构与 spec 「架构」一致，便于 Plan B/C 接入

---

## 后续 Plan（不在本计划内）

- **Plan B：共享模块下沉**（XL）—— 把 `src/lib/llm/`、`ai-analysis.ts`、卡片 materialize、`timeline-tracks/placement/snap` 抽到主进程可 import 的位置，Renderer 改为复用同源
- **Plan C：22 工具完整实现**（L）—— 含 `tts` / `write_script` / `analyze_subtitles` / `generate_*` / `assemble_timeline` / `export_video` / `import_video_source` / `import_local_media` / `read_script` / `update_script` / `get_timeline`，依赖 Plan B 完成
- **Plan D：测试与 ACP CLAUDE.md 更新**（S）

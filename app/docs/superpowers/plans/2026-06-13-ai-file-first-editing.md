# AI File-First 编辑 + 实时热重载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让外部 CLI agent（Claude / Codex / Gemini）直接编辑项目文件来改视频与文稿，编辑器侧用"带会话锁的实时热重载钩子"把改动安全灌回 store 并刷新预览。

**Architecture:** Motion Card 源码外置为 `ai-cards/<id>/motionCard.tsx`，通过"序列化边界转换"让内存态始终有 `tsx`、磁盘只存 `tsxPath`（编译/渲染管线零改动）。chokidar 监听扩展到 `.tsx` + 锁文件，Renderer 补全 `project.json/tsx/md` 外部变更 → store 合并 → 预览刷新。文件信号会话锁（`.lingji/edit-lock.json`，带 TTL）在 AI 编辑期间暂停自动保存并置只读。校验结果回写 `.lingji/edit-result.json`，agent 无需调 MCP。

**Tech Stack:** Electron 41 / electron-vite、React 19 / TS、Zustand、Remotion 4、chokidar、esbuild、Vitest。

参考 spec：`docs/superpowers/specs/2026-06-13-ai-file-first-editing-design.md`

---

## 关键约定（所有 Task 共享）

**序列化边界转换（核心机制）**
- **内存态**（Renderer store、传给编译/渲染的 timeline）：`overlay.aiCardData.motionCard.tsx` 始终是源码字符串。
- **磁盘态**（`project.json`）：`motionCard` 不含 `tsx`，改为 `tsxPath: "ai-cards/<overlayId>/motionCard.tsx"`，源码存在该独立文件。
- **加载转换** `dehydrate→hydrate`：`loadProjectFile` 读 `tsxPath` 文件内容填回 `motionCard.tsx`。
- **保存转换**：`saveProjectSection('timeline', ...)` 把每张卡的 `motionCard.tsx` 写到独立文件、并在落盘 JSON 里换成 `tsxPath`。
- **迁移**：旧 `project.json` 里内嵌 `motionCard.tsx` 首次加载时写出独立文件并改成 `tsxPath`。

**锁文件**：`<projectDir>/.lingji/edit-lock.json`，形如 `{ owner, scope, startedAt, heartbeat, ttlMs }`。注意 chokidar 现有配置 `ignored: /(^|[/\\])\../` 会忽略点开头路径，`.lingji/` 需要单独处理（见 Task 9）。

**结果文件**：`<projectDir>/.lingji/edit-result.json`，形如 `{ ok: boolean, at: string, errors: EditError[] }`。

每个 Task 末尾 commit。测试命令统一：`npx vitest run <file>`。

---

## Phase 1 · Motion Card 外置（数据层基石）

### Task 1: Motion Card payload 类型加 `tsxPath`

**Files:**
- Modify: `src/types/motion.ts:1-20`

- [ ] **Step 1: 修改 `MotionCardPayload`**

在 `src/types/motion.ts` 的 `MotionCardPayload` 接口里，`tsx?: string;` 注释下方新增字段：

```typescript
export interface MotionCardPayload {
  /**
   * Remotion 卡片源码：单文件 React/Remotion 函数组件（default export）。
   * 内存态始终填充；落盘时被剥离并写入 tsxPath 指向的独立文件。
   */
  tsx?: string;
  /**
   * 卡片源码外置文件相对路径（相对 projectDir），例：'ai-cards/<overlayId>/motionCard.tsx'。
   * 仅存在于磁盘 project.json；加载时据此读回 tsx。
   */
  tsxPath?: string;
  // ...（其余字段保持不变）
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: 无新增报错（`tsxPath` 为可选字段，向后兼容）。

- [ ] **Step 3: Commit**

```bash
git add src/types/motion.ts
git commit -m "feat(motion): MotionCardPayload 增加 tsxPath 外置引用字段"
```

---

### Task 2: 外置转换纯函数模块（dehydrate / hydrate / migrate）

**Files:**
- Create: `src/lib/motion-card-externalize.ts`
- Test: `tests/motion-card-externalize.test.ts`

这是纯函数 + 注入 IO 的设计：转换逻辑可单测，文件读写通过回调注入。

- [ ] **Step 1: 写失败测试**

创建 `tests/motion-card-externalize.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  dehydrateTimelineCards,
  hydrateTimelineCards,
  motionCardTsxPath,
} from '../src/lib/motion-card-externalize';
import type { TimelineData } from '../src/types';

function timelineWithCard(motionCard: Record<string, unknown> | undefined): TimelineData {
  return {
    overlays: [
      {
        id: 'ov1',
        type: 'image',
        startMs: 0,
        durationMs: 1000,
        aiCardData: { renderMode: 'motion-card', motionCard } as never,
      } as never,
    ],
  } as never;
}

describe('motionCardTsxPath', () => {
  it('按 overlayId 生成相对路径', () => {
    expect(motionCardTsxPath('ov1')).toBe('ai-cards/ov1/motionCard.tsx');
  });
});

describe('dehydrateTimelineCards', () => {
  it('把内嵌 tsx 写到文件并替换为 tsxPath', async () => {
    const writes: Record<string, string> = {};
    const timeline = timelineWithCard({ tsx: 'export default ()=>null', compiledAt: 1, prompt: 'p', retryCount: 0 });
    const out = await dehydrateTimelineCards(timeline, {
      writeFile: async (rel, content) => { writes[rel] = content; },
    });
    const card = (out.overlays[0] as never as { aiCardData: { motionCard: Record<string, unknown> } }).aiCardData.motionCard;
    expect(card.tsx).toBeUndefined();
    expect(card.tsxPath).toBe('ai-cards/ov1/motionCard.tsx');
    expect(writes['ai-cards/ov1/motionCard.tsx']).toBe('export default ()=>null');
  });

  it('没有 tsx 的卡片不写文件、不加 tsxPath', async () => {
    const writeFile = vi.fn();
    const timeline = timelineWithCard({ compiledAt: 1, prompt: 'p', retryCount: 0 });
    const out = await dehydrateTimelineCards(timeline, { writeFile });
    expect(writeFile).not.toHaveBeenCalled();
    const card = (out.overlays[0] as never as { aiCardData: { motionCard: Record<string, unknown> } }).aiCardData.motionCard;
    expect(card.tsxPath).toBeUndefined();
  });
});

describe('hydrateTimelineCards', () => {
  it('据 tsxPath 读回 tsx', async () => {
    const timeline = timelineWithCard({ tsxPath: 'ai-cards/ov1/motionCard.tsx', compiledAt: 1, prompt: 'p', retryCount: 0 });
    const out = await hydrateTimelineCards(timeline, {
      readFile: async (rel) => (rel === 'ai-cards/ov1/motionCard.tsx' ? 'SRC' : null),
    });
    const card = (out.overlays[0] as never as { aiCardData: { motionCard: Record<string, unknown> } }).aiCardData.motionCard;
    expect(card.tsx).toBe('SRC');
  });

  it('迁移：内嵌 tsx 无 tsxPath 时回填 tsxPath（保持 tsx 供内存使用）', async () => {
    const timeline = timelineWithCard({ tsx: 'INLINE', compiledAt: 1, prompt: 'p', retryCount: 0 });
    const out = await hydrateTimelineCards(timeline, { readFile: async () => null });
    const card = (out.overlays[0] as never as { aiCardData: { motionCard: Record<string, unknown> } }).aiCardData.motionCard;
    expect(card.tsx).toBe('INLINE');
    expect(card.tsxPath).toBe('ai-cards/ov1/motionCard.tsx');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/motion-card-externalize.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现模块**

创建 `src/lib/motion-card-externalize.ts`：

```typescript
import type { TimelineData } from '../types';
import type { MotionCardPayload } from '../types/motion';

export function motionCardTsxPath(overlayId: string): string {
  return `ai-cards/${overlayId}/motionCard.tsx`;
}

interface OverlayLike {
  id: string;
  aiCardData?: { renderMode?: string; motionCard?: MotionCardPayload };
}

function eachMotionCard(
  timeline: TimelineData,
): Array<{ overlayId: string; card: MotionCardPayload }> {
  const out: Array<{ overlayId: string; card: MotionCardPayload }> = [];
  for (const overlay of (timeline.overlays ?? []) as unknown as OverlayLike[]) {
    const card = overlay.aiCardData?.motionCard;
    if (overlay.aiCardData?.renderMode === 'motion-card' && card) {
      out.push({ overlayId: overlay.id, card });
    }
  }
  return out;
}

/** 深拷贝 timeline（结构化克隆，避免改到 store 内存对象）。 */
function clone(timeline: TimelineData): TimelineData {
  return JSON.parse(JSON.stringify(timeline)) as TimelineData;
}

/** 落盘前：把每张卡的 tsx 写独立文件，JSON 内替换为 tsxPath。 */
export async function dehydrateTimelineCards(
  timeline: TimelineData,
  io: { writeFile: (relPath: string, content: string) => Promise<void> },
): Promise<TimelineData> {
  const next = clone(timeline);
  for (const { overlayId, card } of eachMotionCard(next)) {
    const src = card.tsx?.trim();
    if (!src) continue;
    const rel = motionCardTsxPath(overlayId);
    await io.writeFile(rel, card.tsx as string);
    card.tsxPath = rel;
    delete card.tsx;
  }
  return next;
}

/** 加载后：据 tsxPath 读回 tsx；迁移内嵌 tsx 的旧数据回填 tsxPath。 */
export async function hydrateTimelineCards(
  timeline: TimelineData,
  io: { readFile: (relPath: string) => Promise<string | null> },
): Promise<TimelineData> {
  const next = clone(timeline);
  for (const { overlayId, card } of eachMotionCard(next)) {
    if (card.tsxPath) {
      const src = await io.readFile(card.tsxPath);
      if (src != null) card.tsx = src;
      continue;
    }
    if (card.tsx?.trim()) {
      // 旧数据迁移：尚未外置，回填 tsxPath，保留内存 tsx（落盘时由 dehydrate 写出）。
      card.tsxPath = motionCardTsxPath(overlayId);
    }
  }
  return next;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/motion-card-externalize.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/motion-card-externalize.ts tests/motion-card-externalize.test.ts
git commit -m "feat(motion): 卡片源码外置转换纯函数 dehydrate/hydrate"
```

---

### Task 3: 在 `project-file.ts` 接入外置转换（落盘 + 加载）

**Files:**
- Modify: `electron/project-file.ts`
- Test: `tests/project-file-externalize.test.ts`

- [ ] **Step 1: 写失败测试（用真实临时目录跑端到端 roundtrip）**

创建 `tests/project-file-externalize.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadProjectFile, saveProjectSection } from '../electron/project-file';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingji-ext-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const timelineWithCard = {
  overlays: [
    { id: 'ovA', type: 'image', startMs: 0, durationMs: 1000,
      aiCardData: { renderMode: 'motion-card', motionCard: { tsx: 'export default ()=>null', compiledAt: 1, prompt: 'p', retryCount: 0 } } },
  ],
};

describe('project-file 外置 roundtrip', () => {
  it('保存 timeline 时把 tsx 写到独立文件、project.json 只留 tsxPath', async () => {
    await saveProjectSection(dir, 'timeline', JSON.stringify(timelineWithCard));
    const tsxFile = await fs.readFile(path.join(dir, 'ai-cards/ovA/motionCard.tsx'), 'utf-8');
    expect(tsxFile).toBe('export default ()=>null');
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf-8'));
    const card = raw.timeline.overlays[0].aiCardData.motionCard;
    expect(card.tsx).toBeUndefined();
    expect(card.tsxPath).toBe('ai-cards/ovA/motionCard.tsx');
  });

  it('加载时据 tsxPath 读回 tsx', async () => {
    await saveProjectSection(dir, 'timeline', JSON.stringify(timelineWithCard));
    const loaded = await loadProjectFile(dir);
    const card = (loaded.timeline as never as { overlays: { aiCardData: { motionCard: { tsx?: string } } }[] }).overlays[0].aiCardData.motionCard;
    expect(card.tsx).toBe('export default ()=>null');
  });

  it('迁移：内嵌 tsx 的旧 project.json 加载后外置（再次落盘后文件出现）', async () => {
    const legacy = { version: 1, createdAt: 'x', updatedAt: 'x', timeline: timelineWithCard,
      aiAnalysis: { analysisResult: null, coverCandidates: [] },
      script: { templateId: 'news-broadcast', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 } };
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(legacy), 'utf-8');
    const loaded = await loadProjectFile(dir);
    const card = (loaded.timeline as never as { overlays: { aiCardData: { motionCard: { tsx?: string; tsxPath?: string } } }[] }).overlays[0].aiCardData.motionCard;
    expect(card.tsx).toBe('export default ()=>null');
    expect(card.tsxPath).toBe('ai-cards/ovA/motionCard.tsx');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/project-file-externalize.test.ts`
Expected: FAIL（第一个用例：tsx 仍内嵌在 project.json）。

- [ ] **Step 3: 接入转换**

在 `electron/project-file.ts` 顶部 import 区加：

```typescript
import { dehydrateTimelineCards, hydrateTimelineCards } from '../src/lib/motion-card-externalize';
```

新增两个 projectDir 绑定的 IO 适配器（放在 `writeProjectJson` 之后）：

```typescript
function cardIo(projectDir: string) {
  return {
    writeFile: async (rel: string, content: string) => {
      const abs = path.join(projectDir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf-8');
    },
    readFile: async (rel: string): Promise<string | null> => {
      try {
        return await fs.readFile(path.join(projectDir, rel), 'utf-8');
      } catch {
        return null;
      }
    },
  };
}
```

修改 `saveProjectSection`：当 `section === 'timeline'` 且 value 非空时，先 dehydrate 再合并。把函数体替换为：

```typescript
export async function saveProjectSection(
  projectDir: string,
  section: ProjectSection,
  value: unknown,
): Promise<void> {
  let nextValue = value;
  if (section === 'timeline' && value) {
    const timeline = typeof value === 'string' ? JSON.parse(value) : value;
    if (timeline) {
      const io = cardIo(projectDir);
      const dehydrated = await dehydrateTimelineCards(timeline as TimelineData, io);
      nextValue = JSON.stringify(dehydrated);
    }
  }
  return withWriteLock(projectDir, async () => {
    const current = (await readProjectJson(projectDir)) ?? createDefaultProjectData();
    const merged = mergeProjectSection(
      current,
      section,
      (typeof nextValue === 'string' && (section === 'timeline'))
        ? (JSON.parse(nextValue) as ProjectData[typeof section])
        : (nextValue as ProjectData[typeof section]),
    );
    await writeProjectJson(projectDir, merged);
  });
}
```

> 注意：现有调用 `saveProjectSection(projectDir, 'timeline', JSON.stringify(state.timeline))` 传的是字符串。`mergeProjectSection` 期望 `ProjectData['timeline']` 是对象 `TimelineData | null`。确认现有 merge 行为：它把 value 原样赋值。原代码直接传字符串进 merge 会让 timeline 段变成字符串——**先核对现有行为**（grep `saveProjectSection` 的所有调用与 merge 落盘结果）。若现有代码已能正确处理字符串/对象，请保持一致；本步骤的 `JSON.parse` 已统一把 timeline 落成对象。

在 `loadProjectFile` 的两个返回 timeline 的路径后追加 hydrate。修改 `loadProjectFile` 末尾，统一在返回前 hydrate：

```typescript
export async function loadProjectFile(projectDir: string): Promise<ProjectData> {
  const data = await loadProjectFileRaw(projectDir); // 把原有 loadProjectFile 主体改名为 loadProjectFileRaw
  if (data.timeline) {
    data.timeline = await hydrateTimelineCards(data.timeline, cardIo(projectDir));
  }
  return data;
}
```

把原 `loadProjectFile` 函数重命名为 `loadProjectFileRaw`（保留全部原逻辑），新增上面的 wrapper。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/project-file-externalize.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 回归现有持久化测试**

Run: `npx vitest run tests/ 2>&1 | tail -20`
Expected: 现有 project-file / persistence 相关测试全绿（若有红，核对 timeline 字符串 vs 对象落盘行为并修正）。

- [ ] **Step 6: Commit**

```bash
git add electron/project-file.ts tests/project-file-externalize.test.ts
git commit -m "feat(project-file): timeline 落盘/加载接入卡片源码外置转换"
```

---

### Task 4: 导出路径防御性 hydrate

**Files:**
- Modify: `electron/remotion/render-video-headless.ts:111-115`

确保导出时 timeline 的 `motionCard.tsx` 一定有值（即便上游传来的是已 dehydrate 的磁盘态）。

- [ ] **Step 1: 在 collectMotionCards 前 hydrate**

`render-video-headless.ts` 顶部 import：

```typescript
import { hydrateTimelineCards } from '../../src/lib/motion-card-externalize';
```

在 `const cardSources = collectMotionCards(renderTimeline);` 之前插入（`projectDir` 为该函数已有的项目目录变量；若变量名不同，用实际的）：

```typescript
const hydratedTimeline = await hydrateTimelineCards(renderTimeline, {
  readFile: async (rel) => {
    try {
      return await fs.readFile(path.join(projectDir, rel), 'utf-8');
    } catch {
      return null;
    }
  },
});
const cardSources = collectMotionCards(hydratedTimeline);
```

> 若 `renderTimeline` 已含内存 tsx（来自 Renderer），hydrate 是幂等的（tsxPath 存在则覆盖、否则保留）。确认 `fs`/`path` 已在文件顶部 import，没有则补 `import fs from 'node:fs/promises'; import path from 'node:path';`。

- [ ] **Step 2: 跑导出相关测试**

Run: `npx vitest run tests/ 2>&1 | grep -i "render\|export\|card" | tail -20`
Expected: 无新增失败。

- [ ] **Step 3: Commit**

```bash
git add electron/remotion/render-video-headless.ts
git commit -m "feat(render): 导出前防御性 hydrate 卡片源码"
```

---

## Phase 2 · 文件信号会话锁

### Task 5: 锁状态纯逻辑（解析 + TTL 判活）

**Files:**
- Create: `electron/ai-edit/lock-state.ts`
- Test: `tests/ai-edit-lock-state.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/ai-edit-lock-state.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { parseLock, isLockActive, type EditLock } from '../electron/ai-edit/lock-state';

const base: EditLock = { owner: 'codex', scope: 'video', startedAt: 1000, heartbeat: 1000, ttlMs: 30000 };

describe('parseLock', () => {
  it('合法 JSON 解析成 EditLock', () => {
    expect(parseLock(JSON.stringify(base))).toEqual(base);
  });
  it('非法 JSON 返回 null', () => {
    expect(parseLock('{bad')).toBeNull();
  });
  it('缺字段返回 null', () => {
    expect(parseLock(JSON.stringify({ owner: 'x' }))).toBeNull();
  });
});

describe('isLockActive', () => {
  it('心跳在 TTL 内为 active', () => {
    expect(isLockActive(base, 1000 + 29000)).toBe(true);
  });
  it('心跳超过 TTL 为 inactive（视为遗忘锁）', () => {
    expect(isLockActive(base, 1000 + 31000)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ai-edit-lock-state.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

创建 `electron/ai-edit/lock-state.ts`：

```typescript
export type EditScope = 'video' | 'script';

export interface EditLock {
  owner: string;
  scope: EditScope;
  startedAt: number;
  heartbeat: number;
  ttlMs: number;
}

export function parseLock(raw: string): EditLock | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (
    typeof o.owner !== 'string' ||
    (o.scope !== 'video' && o.scope !== 'script') ||
    typeof o.startedAt !== 'number' ||
    typeof o.heartbeat !== 'number' ||
    typeof o.ttlMs !== 'number'
  ) {
    return null;
  }
  return { owner: o.owner, scope: o.scope, startedAt: o.startedAt, heartbeat: o.heartbeat, ttlMs: o.ttlMs };
}

/** 心跳距 now 超过 ttl 视为遗忘锁，不再 active。 */
export function isLockActive(lock: EditLock, now: number): boolean {
  return now - lock.heartbeat <= lock.ttlMs;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/ai-edit-lock-state.test.ts`
Expected: PASS（5 用例）。

- [ ] **Step 5: Commit**

```bash
git add electron/ai-edit/lock-state.ts tests/ai-edit-lock-state.test.ts
git commit -m "feat(ai-edit): 会话锁解析与 TTL 判活纯逻辑"
```

---

### Task 6: 锁文件监听器（main 进程）

**Files:**
- Create: `electron/ai-edit/lock-watcher.ts`
- Test: `tests/ai-edit-lock-watcher.test.ts`

监听 `.lingji/edit-lock.json` 的出现/更新/消失，加 TTL 轮询兜底，回调上报锁态变化。

- [ ] **Step 1: 写失败测试（注入时钟与文件读取）**

创建 `tests/ai-edit-lock-watcher.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { LockMonitor } from '../electron/ai-edit/lock-watcher';

describe('LockMonitor', () => {
  it('读到 active 锁 → 上报 locked', async () => {
    const events: Array<{ active: boolean; scope?: string }> = [];
    let now = 1000;
    const mon = new LockMonitor({
      readLock: async () => JSON.stringify({ owner: 'x', scope: 'video', startedAt: 1000, heartbeat: 1000, ttlMs: 30000 }),
      now: () => now,
      onChange: (s) => events.push(s),
    });
    await mon.poll();
    expect(events.at(-1)).toEqual({ active: true, scope: 'video' });
  });

  it('锁文件消失 → 上报 unlocked', async () => {
    const events: Array<{ active: boolean }> = [];
    let now = 1000;
    let raw: string | null = JSON.stringify({ owner: 'x', scope: 'video', startedAt: 1000, heartbeat: 1000, ttlMs: 30000 });
    const mon = new LockMonitor({ readLock: async () => raw, now: () => now, onChange: (s) => events.push(s) });
    await mon.poll();
    raw = null;
    await mon.poll();
    expect(events.at(-1)).toEqual({ active: false, scope: undefined });
  });

  it('心跳过期 → 自动上报 unlocked（遗忘锁兜底）', async () => {
    const events: Array<{ active: boolean }> = [];
    let now = 1000;
    const mon = new LockMonitor({
      readLock: async () => JSON.stringify({ owner: 'x', scope: 'video', startedAt: 1000, heartbeat: 1000, ttlMs: 30000 }),
      now: () => now,
      onChange: (s) => events.push(s),
    });
    await mon.poll();
    now = 1000 + 31000;
    await mon.poll();
    expect(events.at(-1)).toEqual({ active: false, scope: undefined });
  });

  it('状态不变时不重复上报', async () => {
    const onChange = vi.fn();
    const mon = new LockMonitor({
      readLock: async () => JSON.stringify({ owner: 'x', scope: 'video', startedAt: 1000, heartbeat: 1000, ttlMs: 30000 }),
      now: () => 1000,
      onChange,
    });
    await mon.poll();
    await mon.poll();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ai-edit-lock-watcher.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

创建 `electron/ai-edit/lock-watcher.ts`：

```typescript
import { parseLock, isLockActive, type EditScope } from './lock-state';

export interface LockChange {
  active: boolean;
  scope?: EditScope;
}

interface LockMonitorOptions {
  /** 读锁文件原始内容；文件不存在返回 null。 */
  readLock: () => Promise<string | null>;
  now: () => number;
  onChange: (change: LockChange) => void;
}

export class LockMonitor {
  private lastActive = false;
  private lastScope: EditScope | undefined;
  constructor(private readonly opts: LockMonitorOptions) {}

  async poll(): Promise<void> {
    const raw = await this.opts.readLock();
    const lock = raw == null ? null : parseLock(raw);
    const active = !!lock && isLockActive(lock, this.opts.now());
    const scope = active ? lock!.scope : undefined;
    if (active === this.lastActive && scope === this.lastScope) return;
    this.lastActive = active;
    this.lastScope = scope;
    this.opts.onChange({ active, scope });
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/ai-edit-lock-watcher.test.ts`
Expected: PASS（4 用例）。

- [ ] **Step 5: Commit**

```bash
git add electron/ai-edit/lock-watcher.ts tests/ai-edit-lock-watcher.test.ts
git commit -m "feat(ai-edit): 锁文件监听器 + TTL 兜底"
```

---

### Task 7: 锁态 IPC 通道（main → preload → electron-api）

**Files:**
- Modify: `electron/main.ts`（注册轮询 + 发事件）
- Modify: `electron/preload.ts`（暴露 `onAiEditLockChanged`）
- Modify: `src/lib/electron-api.ts`（类型）

- [ ] **Step 1: main 进程接线**

在 `electron/main.ts` 的 `start-watching` handler 内（`fileWatcher` 建好后），新增 `.lingji` 锁轮询。在文件顶部 import：

```typescript
import { LockMonitor } from './ai-edit/lock-watcher';
```

在 `start-watching` handler 末尾追加：

```typescript
  // AI 编辑会话锁轮询（chokidar 默认忽略点目录，这里用独立定时器轮询）
  if (lockPollTimer) clearInterval(lockPollTimer);
  const lockMon = new LockMonitor({
    readLock: async () => {
      try {
        return await fs.readFile(path.join(dir, '.lingji', 'edit-lock.json'), 'utf-8');
      } catch {
        return null;
      }
    },
    now: () => Date.now(),
    onChange: (change) => mainWindow?.webContents.send('ai-edit-lock-changed', change),
  });
  lockPollTimer = setInterval(() => { void lockMon.poll(); }, 500);
  void lockMon.poll();
```

在模块级（`let fileWatcher` 附近）声明：

```typescript
let lockPollTimer: ReturnType<typeof setInterval> | null = null;
```

在 `stop-watching` handler 内追加 `if (lockPollTimer) { clearInterval(lockPollTimer); lockPollTimer = null; }`。

- [ ] **Step 2: preload 暴露**

在 `electron/preload.ts` 的 `electronAPI` 对象里新增（参考现有 `onFileChanged` 的写法）：

```typescript
  onAiEditLockChanged: (cb: (change: { active: boolean; scope?: 'video' | 'script' }) => void) => {
    const handler = (_e: unknown, change: { active: boolean; scope?: 'video' | 'script' }) => cb(change);
    ipcRenderer.on('ai-edit-lock-changed', handler);
    return () => ipcRenderer.removeListener('ai-edit-lock-changed', handler);
  },
```

- [ ] **Step 3: electron-api 类型**

在 `src/lib/electron-api.ts` 的 `ElectronAPI` 接口里加（与 `onFileChanged` 同区）：

```typescript
  onAiEditLockChanged?: (
    cb: (change: { active: boolean; scope?: 'video' | 'script' }) => void,
  ) => () => void;
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: 无新增报错。

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/lib/electron-api.ts
git commit -m "feat(ai-edit): 锁态 IPC 三件套（main/preload/electron-api）"
```

---

### Task 8: Renderer 锁态 store + 暂停自动保存 + 只读

**Files:**
- Create: `src/store/ai-edit.ts`
- Modify: `src/store/timeline.ts:1242-1270`（自动保存订阅处加锁判断）
- Test: `tests/ai-edit-store.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/ai-edit-store.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useAiEditStore } from '../src/store/ai-edit';

describe('useAiEditStore', () => {
  beforeEach(() => useAiEditStore.setState({ locked: false, scope: undefined }));
  it('setLock 更新锁态', () => {
    useAiEditStore.getState().setLock({ active: true, scope: 'video' });
    expect(useAiEditStore.getState().locked).toBe(true);
    expect(useAiEditStore.getState().scope).toBe('video');
  });
  it('解锁清空 scope', () => {
    useAiEditStore.getState().setLock({ active: true, scope: 'script' });
    useAiEditStore.getState().setLock({ active: false });
    expect(useAiEditStore.getState().locked).toBe(false);
    expect(useAiEditStore.getState().scope).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ai-edit-store.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 store**

创建 `src/store/ai-edit.ts`：

```typescript
import { create } from 'zustand';

interface AiEditState {
  locked: boolean;
  scope?: 'video' | 'script';
  setLock: (change: { active: boolean; scope?: 'video' | 'script' }) => void;
}

export const useAiEditStore = create<AiEditState>((set) => ({
  locked: false,
  scope: undefined,
  setLock: ({ active, scope }) => set({ locked: active, scope: active ? scope : undefined }),
}));

/** 供非 React 处（timeline 订阅）同步读取当前是否锁定。 */
export function isAiEditLocked(): boolean {
  return useAiEditStore.getState().locked;
}
```

- [ ] **Step 4: 自动保存订阅加锁判断**

在 `src/store/timeline.ts` 顶部 import：

```typescript
import { isAiEditLocked } from './ai-edit';
```

在 `useTimelineStore.subscribe` 回调开头（`if (state.timeline === previousState.timeline) return;` 之后）加：

```typescript
    // AI 文件编辑会话锁定期间，暂停自动保存，避免与外部文件写入互相覆盖。
    if (isAiEditLocked()) {
      return;
    }
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/ai-edit-store.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/store/ai-edit.ts src/store/timeline.ts tests/ai-edit-store.test.ts
git commit -m "feat(ai-edit): 锁态 store + 锁期间暂停 timeline 自动保存"
```

---

## Phase 3 · 热重载灌回

### Task 9: chokidar 扩展监听 `.tsx`

**Files:**
- Modify: `electron/main.ts:1934-1944`（change handler 文件类型过滤）

- [ ] **Step 1: 放宽 change 过滤到 `.tsx`**

把 `start-watching` 内 `fileWatcher.on('change', ...)` 的过滤行：

```typescript
    if (!relative.endsWith('.md') && !relative.endsWith('.json')) return;
```

改为：

```typescript
    if (!relative.endsWith('.md') && !relative.endsWith('.json') && !relative.endsWith('.tsx')) return;
```

> `ai-cards/<id>/motionCard.tsx` 在 `depth:3` 内且非点路径，现有 watcher 能覆盖；只需放宽扩展名过滤。`file-changed` 事件已带 `{ file, content }`，Renderer 据 `file` 后缀分流。

- [ ] **Step 2: 手验（构建期）**

Run: `npx tsc --noEmit -p tsconfig.node.json 2>&1 | head -10`（若无该 config 用 `tsconfig.json`）
Expected: 无新增报错。

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat(watch): 文件监听扩展到 .tsx（motionCard 外置文件）"
```

---

### Task 10: 外部变更分流纯逻辑

**Files:**
- Create: `src/lib/external-edit-route.ts`
- Test: `tests/external-edit-route.test.ts`

把 `file-changed` 的 `{ file }` 路径分类成 `project | script | original | motion-card | other`，并从 motion-card 路径解析出 overlayId。

- [ ] **Step 1: 写失败测试**

创建 `tests/external-edit-route.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { routeExternalEdit } from '../src/lib/external-edit-route';

describe('routeExternalEdit', () => {
  it('project.json', () => {
    expect(routeExternalEdit('project.json')).toEqual({ kind: 'project' });
  });
  it('script.md', () => {
    expect(routeExternalEdit('script.md')).toEqual({ kind: 'script' });
  });
  it('original.md', () => {
    expect(routeExternalEdit('original.md')).toEqual({ kind: 'original' });
  });
  it('motionCard.tsx 解析 overlayId', () => {
    expect(routeExternalEdit('ai-cards/ovX/motionCard.tsx')).toEqual({ kind: 'motion-card', overlayId: 'ovX' });
  });
  it('windows 分隔符也能解析', () => {
    expect(routeExternalEdit('ai-cards\\ovY\\motionCard.tsx')).toEqual({ kind: 'motion-card', overlayId: 'ovY' });
  });
  it('其他文件归 other', () => {
    expect(routeExternalEdit('notes.txt')).toEqual({ kind: 'other' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/external-edit-route.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

创建 `src/lib/external-edit-route.ts`：

```typescript
export type ExternalEditRoute =
  | { kind: 'project' }
  | { kind: 'script' }
  | { kind: 'original' }
  | { kind: 'motion-card'; overlayId: string }
  | { kind: 'other' };

export function routeExternalEdit(relFile: string): ExternalEditRoute {
  const norm = relFile.replace(/\\/g, '/');
  if (norm === 'project.json') return { kind: 'project' };
  if (norm === 'script.md') return { kind: 'script' };
  if (norm === 'original.md') return { kind: 'original' };
  const m = norm.match(/^ai-cards\/([^/]+)\/motionCard\.tsx$/);
  if (m) return { kind: 'motion-card', overlayId: m[1] };
  return { kind: 'other' };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/external-edit-route.test.ts`
Expected: PASS（6 用例）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/external-edit-route.ts tests/external-edit-route.test.ts
git commit -m "feat(sync): 外部文件变更分流纯逻辑"
```

---

### Task 11: 外部变更应用到 store（hot-reload sync）

**Files:**
- Create: `src/lib/external-edit-sync.ts`
- Modify: 在 Editor 装载处接线（`src/pages/Editor.tsx` 或现有调用 `onFileChanged` 的组件）

本 Task 把分流结果落到具体 store 动作。`project` 路由重新 `loadProject` 并 `setTimeline`；`motion-card` 路由更新对应 overlay 的 `motionCard.tsx` 并触发重编译；`script/original` 灌回脚本工作台。

> 说明：`setTimeline` 会触发自动保存订阅，但 Task 8 已让锁定期间跳过保存；锁释放后由用户后续编辑触发保存（dehydrate 幂等，不会写脏）。为避免"灌回即回写覆盖外部文件"，本 Task 在应用外部 timeline 时使用专门入口（见下）。

- [ ] **Step 1: timeline store 增加"外部合并"入口**

在 `src/store/timeline.ts` 的 store actions 里新增 `applyExternalTimeline`（不进入 undo 历史，直接替换）：

```typescript
  applyExternalTimeline: (timeline: TimelineData) => {
    set({ timeline });
  },
```

并在 store 类型接口里补上 `applyExternalTimeline: (timeline: TimelineData) => void;`。

- [ ] **Step 2: 实现 sync 协调器**

创建 `src/lib/external-edit-sync.ts`：

```typescript
import { routeExternalEdit } from './external-edit-route';
import { useTimelineStore } from '../store/timeline';
import type { TimelineData } from '../types';

export interface ExternalEditDeps {
  /** 重新从磁盘加载项目（已 hydrate 卡片源码）。 */
  loadProject: (projectDir: string) => Promise<{ timeline: TimelineData | null }>;
  projectDir: string;
  /** 把单卡新源码灌入内存 timeline（更新对应 overlay 的 motionCard.tsx）。 */
  applyCardSource: (overlayId: string, tsx: string) => void;
  /** script.md / original.md 外部变更回调（交给脚本工作台处理 + 版本历史）。 */
  onScriptChanged: (kind: 'script' | 'original', content: string) => void;
}

export async function handleExternalEdit(
  evt: { file: string; content: string },
  deps: ExternalEditDeps,
): Promise<void> {
  const route = routeExternalEdit(evt.file);
  switch (route.kind) {
    case 'project': {
      const { timeline } = await deps.loadProject(deps.projectDir);
      if (timeline) useTimelineStore.getState().applyExternalTimeline(timeline);
      break;
    }
    case 'motion-card': {
      deps.applyCardSource(route.overlayId, evt.content);
      break;
    }
    case 'script':
    case 'original': {
      deps.onScriptChanged(route.kind, evt.content);
      break;
    }
    default:
      break;
  }
}
```

- [ ] **Step 3: applyCardSource 实现（更新 overlay 内存源码）**

在 `src/store/timeline.ts` 新增 action：

```typescript
  applyExternalCardSource: (overlayId: string, tsx: string) => {
    set((state) => {
      if (!state.timeline) return state;
      const overlays = state.timeline.overlays.map((ov) =>
        ov.id === overlayId && ov.aiCardData?.motionCard
          ? { ...ov, aiCardData: { ...ov.aiCardData, motionCard: { ...ov.aiCardData.motionCard, tsx, compileError: undefined } } }
          : ov,
      );
      return { timeline: { ...state.timeline, overlays } };
    });
  },
```

> 预览侧 `collectMotionCards` + 编译会因 timeline 变化自动重算（MainComposition 的 `useMemo` 依赖 `plan.visual`/`compiledCards`），无需手动触发。

- [ ] **Step 4: Editor 接线**

在 Editor 装载项目的 effect 里（现有调用 `window.electronAPI.onFileChanged` 的位置，若没有则在 `startWatching` 之后），注册：

```typescript
useEffect(() => {
  if (!projectDir) return;
  const off = window.electronAPI?.onFileChanged?.(async (evt) => {
    await handleExternalEdit(evt, {
      loadProject: async (dir) => {
        const data = await window.electronAPI!.loadProject(dir);
        return { timeline: data.timeline ?? null };
      },
      projectDir,
      applyCardSource: (id, tsx) => useTimelineStore.getState().applyExternalCardSource(id, tsx),
      onScriptChanged: (kind, content) => {/* 交给现有脚本工作台冲突/灌回逻辑，见 Task 12 */},
    });
  });
  return off;
}, [projectDir]);
```

> 用实际的 `loadProject` IPC 名（核对 `src/lib/electron-api.ts` 里是 `loadProject` 还是 `load-project` 包装）。

- [ ] **Step 5: 跑相关测试 + 类型检查**

Run: `npx vitest run tests/ 2>&1 | tail -15 && npx tsc --noEmit 2>&1 | head -15`
Expected: 无新增失败/报错。

- [ ] **Step 6: Commit**

```bash
git add src/lib/external-edit-sync.ts src/store/timeline.ts src/pages/Editor.tsx
git commit -m "feat(sync): 外部 project.json/tsx 变更热重载灌回 store"
```

---

### Task 12: script.md 外部变更灌回 + 补建版本历史

**Files:**
- Modify: `src/store/script.ts`（外部变更入口）
- Modify: Task 11 中 `onScriptChanged` 回调对接

- [ ] **Step 1: 核对现有 script 外部变更处理**

Run: `grep -n "onFileChanged\|file-changed\|外部\|conflict\|版本历史\|saveVersion\|createVersion" src/store/script.ts src/pages/ScriptWorkbench.tsx | head -30`
Expected: 找到现有"文件监听 → 冲突处理"逻辑入口。

- [ ] **Step 2: 在外部 script 变更时灌回并建版本**

复用现有冲突/灌回逻辑：把 Task 11 的 `onScriptChanged('script', content)` 接到现有处理函数。若现有逻辑只弹冲突框，新增"file-first 直灌"分支——当 AI 锁（`useAiEditStore.getState().locked && scope==='script'`）激活时直接灌回内容到工作台并调用现有版本历史创建函数（grep 出的 `createVersion`/`saveVersion` 实际名），不弹冲突框。

```typescript
// 伪代码骨架，函数名替换为 script store 实际导出：
function applyExternalScript(kind: 'script' | 'original', content: string) {
  if (kind === 'script') {
    setScriptContent(content);          // 现有设置文稿内容入口
    createScriptVersion(content);       // 现有版本历史创建入口
  } else {
    setOriginalContent(content);        // 现有 original.md 入口
  }
}
```

- [ ] **Step 3: 类型检查 + script 测试**

Run: `npx vitest run tests/ 2>&1 | grep -i script | tail -10 && npx tsc --noEmit 2>&1 | head -10`
Expected: 无新增失败。

- [ ] **Step 4: Commit**

```bash
git add src/store/script.ts src/pages/Editor.tsx
git commit -m "feat(sync): script.md 外部变更灌回工作台并补建版本历史"
```

---

## Phase 4 · 校验与结果回传

### Task 13: project.json 校验纯逻辑

**Files:**
- Create: `src/lib/external-edit-validate.ts`
- Test: `tests/external-edit-validate.test.ts`

校验 AI 改完的 timeline 基本约束：时间为正、进出场动画枚举合法、坐标在画布范围。失败收集成 `EditError[]`，不抛异常。

- [ ] **Step 1: 确认动画枚举合法值**

Run: `grep -n "enter\|exit\|OverlayMotion\|type.*animation\|'fade'\|'slide'" src/types.ts | head -20`
Expected: 拿到 `OverlayMotion.enter/exit` 的合法枚举字符串集合，填入下方 `VALID_ENTER`/`VALID_EXIT`。

- [ ] **Step 2: 写失败测试**

创建 `tests/external-edit-validate.test.ts`（`VALID_ENTER` 用 Step 1 实际枚举，下例以 `'fade'` 占位，实现时替换）：

```typescript
import { describe, it, expect } from 'vitest';
import { validateTimeline } from '../src/lib/external-edit-validate';

const ok = { width: 1080, height: 1920, overlays: [
  { id: 'a', startMs: 0, durationMs: 1000, position: { x: 0, y: 0, width: 100, height: 100 } },
] };

describe('validateTimeline', () => {
  it('合法 timeline 无错误', () => {
    expect(validateTimeline(ok as never).length).toBe(0);
  });
  it('负时长报错', () => {
    const bad = { ...ok, overlays: [{ id: 'a', startMs: 0, durationMs: -5 }] };
    const errs = validateTimeline(bad as never);
    expect(errs.some((e) => e.field.includes('durationMs'))).toBe(true);
  });
  it('负 startMs 报错', () => {
    const bad = { ...ok, overlays: [{ id: 'a', startMs: -1, durationMs: 10 }] };
    expect(validateTimeline(bad as never).some((e) => e.field.includes('startMs'))).toBe(true);
  });
});
```

- [ ] **Step 3: 实现**

创建 `src/lib/external-edit-validate.ts`（枚举集合用 Step 1 实际值）：

```typescript
import type { TimelineData } from '../types';

export interface EditError {
  field: string;
  message: string;
}

// TODO(实现时替换为 src/types.ts 中 OverlayMotion 的真实枚举集合
const VALID_ENTER = new Set<string>(['none', 'fade' /* …实际枚举 */]);
const VALID_EXIT = new Set<string>(['none', 'fade' /* …实际枚举 */]);

export function validateTimeline(timeline: TimelineData): EditError[] {
  const errors: EditError[] = [];
  const overlays = (timeline as unknown as { overlays?: unknown[] }).overlays ?? [];
  overlays.forEach((raw, i) => {
    const ov = raw as Record<string, unknown>;
    const at = `overlays[${i}]`;
    if (typeof ov.startMs === 'number' && ov.startMs < 0) {
      errors.push({ field: `${at}.startMs`, message: 'startMs 不能为负' });
    }
    if (typeof ov.durationMs === 'number' && ov.durationMs <= 0) {
      errors.push({ field: `${at}.durationMs`, message: 'durationMs 必须为正' });
    }
    const motion = ov.motion as Record<string, unknown> | undefined;
    if (motion?.enter && !VALID_ENTER.has(String(motion.enter))) {
      errors.push({ field: `${at}.motion.enter`, message: `非法 enter 动画: ${String(motion.enter)}` });
    }
    if (motion?.exit && !VALID_EXIT.has(String(motion.exit))) {
      errors.push({ field: `${at}.motion.exit`, message: `非法 exit 动画: ${String(motion.exit)}` });
    }
  });
  return errors;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/external-edit-validate.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/external-edit-validate.ts tests/external-edit-validate.test.ts
git commit -m "feat(validate): project.json timeline 基础约束校验"
```

---

### Task 14: 校验结果回写 `.lingji/edit-result.json`

**Files:**
- Create: `electron/ai-edit/result-writer.ts`
- Test: `tests/ai-edit-result-writer.test.ts`
- Modify: 接到外部 project.json 变更处理（main 侧或 Renderer 侧——见下）

回传走 main 进程写文件最稳妥（Renderer 无 fs）。设计：Renderer 校验后通过现有 IPC 让 main 写结果文件；或在 main 的 `file-changed` 处直接校验 project.json 并写结果。本 Task 选 **main 侧**：监听到 `project.json` 变更时读取、校验、写 `edit-result.json`，并仅在 ok 时把 `file-changed` 照常转发给 Renderer（脏数据不灌回）。

- [ ] **Step 1: 写失败测试**

创建 `tests/ai-edit-result-writer.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { buildEditResult } from '../electron/ai-edit/result-writer';

describe('buildEditResult', () => {
  it('无错误 → ok', () => {
    const r = buildEditResult([], '2026-06-13T00:00:00Z');
    expect(r).toEqual({ ok: true, at: '2026-06-13T00:00:00Z', errors: [] });
  });
  it('有错误 → not ok', () => {
    const r = buildEditResult([{ field: 'overlays[0].startMs', message: 'bad' }], 'T');
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ai-edit-result-writer.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

创建 `electron/ai-edit/result-writer.ts`：

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EditError } from '../../src/lib/external-edit-validate';

export interface EditResult {
  ok: boolean;
  at: string;
  errors: EditError[];
}

export function buildEditResult(errors: EditError[], at: string): EditResult {
  return { ok: errors.length === 0, at, errors };
}

export async function writeEditResult(projectDir: string, result: EditResult): Promise<void> {
  const dir = path.join(projectDir, '.lingji');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'edit-result.json'), JSON.stringify(result, null, 2), 'utf-8');
}
```

- [ ] **Step 4: main 侧接入校验 + 写结果 + 守门转发**

在 `electron/main.ts` 的 `fileWatcher.on('change', ...)` handler 内，`project.json` 分支增加校验。修改 change handler：

```typescript
  fileWatcher.on('change', async (filePath: string) => {
    const relative = path.relative(dir, filePath);
    if (!relative.endsWith('.md') && !relative.endsWith('.json') && !relative.endsWith('.tsx')) return;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      if (relative === 'project.json') {
        let errors: EditError[] = [];
        try {
          const parsed = JSON.parse(content);
          errors = parsed?.timeline ? validateTimeline(parsed.timeline) : [];
        } catch (e) {
          errors = [{ field: 'project.json', message: `非法 JSON: ${(e as Error).message}` }];
        }
        await writeEditResult(dir, buildEditResult(errors, new Date().toISOString()));
        if (errors.length > 0) return; // 脏数据不灌回 Renderer
      } else if (relative.endsWith('.tsx')) {
        // 卡片源码校验交由 Renderer 编译时的错误边界处理，这里照常转发
      }
      mainWindow?.webContents.send('file-changed', { file: relative, content });
    } catch {
      // 文件可能已被删除，忽略
    }
  });
```

在 `electron/main.ts` 顶部 import：

```typescript
import { validateTimeline, type EditError } from '../src/lib/external-edit-validate';
import { buildEditResult, writeEditResult } from './ai-edit/result-writer';
```

- [ ] **Step 5: 运行确认通过 + 类型检查**

Run: `npx vitest run tests/ai-edit-result-writer.test.ts && npx tsc --noEmit 2>&1 | head -10`
Expected: PASS，无新增报错。

- [ ] **Step 6: Commit**

```bash
git add electron/ai-edit/result-writer.ts tests/ai-edit-result-writer.test.ts electron/main.ts
git commit -m "feat(ai-edit): project.json 校验守门 + edit-result.json 回写"
```

---

## Phase 5 · 文件契约文档 + Skill + 多 agent 同步

### Task 15: 文件契约文档

**Files:**
- Create: `docs/ai-contract/README.md`（总览 + 锁/结果协议）
- Create: `docs/ai-contract/video-editing.md`（timeline/overlay/motionCard 字段契约）
- Create: `docs/ai-contract/script-editing.md`（文稿编辑契约）

- [ ] **Step 1: 写 README（协议总纲）**

`docs/ai-contract/README.md` 必含：
- 项目目录结构（project.json / script.md / original.md / ai-cards/<id>/motionCard.tsx / covers / .lingji/）。
- **会话锁协议**：编辑前写 `.lingji/edit-lock.json`（`{owner,scope,startedAt,heartbeat,ttlMs}`，建议 ttlMs=30000，长任务每 ≤15s 刷新 heartbeat）；编辑后删除该文件。
- **结果协议**：改完读 `.lingji/edit-result.json` 确认 `ok`；为 false 时按 `errors[].field/message` 修复重试。
- **边界**：纯编辑，不触发重生成/重导出/TTS/AI 画图（指向 App 内操作或现有 MCP 工具）。

- [ ] **Step 2: 写 video-editing.md**

依据 `src/types.ts`（OverlayItem/OverlayMotion/TextOverlayData/SubtitleStyle/AICardOverlayData）与 `src/types/motion.ts`，列出每个可改字段：含义、单位（ms）、合法枚举、坐标范围。明确 motionCard 源码改 `ai-cards/<overlayId>/motionCard.tsx` 文件（去 code fence、必须 default export、Remotion 上下文可用 API），**不要**在 project.json 内改 tsx。

- [ ] **Step 3: 写 script-editing.md**

说明只改 `script.md` / `original.md`，不碰 timeline/卡片；保存即由编辑器补建版本历史。

- [ ] **Step 4: Commit**

```bash
git add docs/ai-contract/
git commit -m "docs(ai-contract): file-first 编辑文件契约（视频/文稿/锁/结果协议）"
```

---

### Task 16: 两个薄入口 Skill

**Files:**
- Create: `.claude/skills/lingji-video-edit/SKILL.md`
- Create: `.claude/skills/lingji-script-edit/SKILL.md`

- [ ] **Step 1: 视频 skill**

`.claude/skills/lingji-video-edit/SKILL.md`，frontmatter `name` + `description`（描述触发场景：改视频动画时间/样式/Motion Card），正文：边界表 + 指向 `docs/ai-contract/video-editing.md` + 锁/结果协议步骤 + 1 个典型示例（如"把某 overlay 进场改 fade、时长改 800ms"）。

- [ ] **Step 2: 文稿 skill**

`.claude/skills/lingji-script-edit/SKILL.md`，同结构，指向 `docs/ai-contract/script-editing.md`，边界=只改 md。

- [ ] **Step 3: 校验 frontmatter 可被发现**

Run: `head -5 .claude/skills/lingji-video-edit/SKILL.md .claude/skills/lingji-script-edit/SKILL.md`
Expected: 两个文件均有合法 `---\nname: ...\ndescription: ...\n---`。

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/lingji-video-edit/ .claude/skills/lingji-script-edit/
git commit -m "feat(skills): lingji-video-edit / lingji-script-edit 薄入口 skill"
```

---

### Task 17: 契约同步进 CLAUDE.md / AGENTS.md / GEMINI.md

**Files:**
- Modify: `electron/acp/ipc.ts:229-253`（`ensureProjectClaudeMd` 泛化为多文件）
- Test: `tests/ensure-agent-contract.test.ts`

- [ ] **Step 1: 核对现有实现**

Run: `sed -n '229,260p' electron/acp/ipc.ts`（用 Read 工具读取该段，确认 marker 替换/追加逻辑与函数签名）
Expected: 拿到现有 `ensureProjectClaudeMd` 主体，抽出"按 marker 替换或追加"通用逻辑。

- [ ] **Step 2: 抽通用函数 + 多文件循环**

把 `ensureProjectClaudeMd` 重构为：内部通用 `upsertContractBlock(filePath, marker, block)`，对 `['CLAUDE.md','AGENTS.md','GEMINI.md']` 逐个写入同一份"file-first 契约要点"块（含锁/结果协议 + 指向 `docs/ai-contract/`）。保留原有 MCP 指引块不破坏（用不同 marker，如 `<!-- lingji-file-first-contract -->`）。

```typescript
const FILE_FIRST_MARKER = '<!-- lingji-file-first-contract -->';
const AGENT_CONTRACT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

async function upsertContractBlock(filePath: string, marker: string, block: string): Promise<void> {
  let existing = '';
  try { existing = await fs.readFile(filePath, 'utf-8'); } catch { /* 新建 */ }
  const wrapped = `${marker}\n${block}\n${marker}`;
  const re = new RegExp(`${marker}[\\s\\S]*?${marker}`);
  const next = re.test(existing) ? existing.replace(re, wrapped) : `${existing}\n\n${wrapped}\n`;
  await fs.writeFile(filePath, next, 'utf-8');
}

export async function ensureProjectAgentContracts(projectDir: string): Promise<void> {
  const block = buildFileFirstContractBlock(); // 返回契约要点 markdown
  for (const name of AGENT_CONTRACT_FILES) {
    try {
      await upsertContractBlock(path.join(projectDir, name), FILE_FIRST_MARKER, block);
    } catch (err) {
      console.warn(`[ACP] 写入 ${name} 失败:`, err);
    }
  }
}
```

在原 `ensureProjectClaudeMd` 调用点（`ipc.ts:47`）后追加 `await ensureProjectAgentContracts(payload.projectDir);`。

- [ ] **Step 3: 写测试**

创建 `tests/ensure-agent-contract.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureProjectAgentContracts } from '../electron/acp/ipc';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingji-contract-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('ensureProjectAgentContracts', () => {
  it('三个 agent 文件都写入契约块', async () => {
    await ensureProjectAgentContracts(dir);
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
      const txt = await fs.readFile(path.join(dir, f), 'utf-8');
      expect(txt).toContain('lingji-file-first-contract');
    }
  });
  it('重复调用幂等（不重复追加）', async () => {
    await ensureProjectAgentContracts(dir);
    await ensureProjectAgentContracts(dir);
    const txt = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf-8');
    expect(txt.match(/lingji-file-first-contract/g)!.length).toBe(2); // 一对 marker
  });
});
```

> 若 `ensureProjectAgentContracts` 因 import electron 运行时而无法在 vitest 加载，把 `upsertContractBlock` + `buildFileFirstContractBlock` 抽到独立无 electron 依赖的 `electron/acp/contract-sync.ts`，测试针对该文件。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/ensure-agent-contract.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add electron/acp/ipc.ts tests/ensure-agent-contract.test.ts
git commit -m "feat(acp): 契约同步进 CLAUDE/AGENTS/GEMINI.md（多 agent 通用）"
```

---

## Phase 6 · 集成验证

### Task 18: 全量回归 + 构建

- [ ] **Step 1: 全量测试**

Run: `npx vitest run 2>&1 | tail -25`
Expected: 全绿（含新增 + 现有）。

- [ ] **Step 2: 构建**

Run: `npm run build 2>&1 | tail -30`
Expected: main + preload + renderer 编译通过、混淆通过。

- [ ] **Step 3: 手动验收清单（记录到 PR 描述）**

启动 `npm run dev`，逐项验证：
1. 打开含 Motion Card 的旧项目 → `ai-cards/<id>/motionCard.tsx` 自动生成、预览不变。
2. 外部编辑器改某 overlay `durationMs` + 写锁文件 → 状态栏显示"AI 正在编辑"，删除锁后预览更新、不丢手动编辑。
3. 外部改 `motionCard.tsx` → 该卡预览重编译刷新。
4. 写非法 `project.json`（负时长）→ `.lingji/edit-result.json` 标 `ok:false`、预览不被脏数据污染。
5. 外部改 `script.md` → 工作台内容更新、版本历史 +1。
6. ACP 连接后 `AGENTS.md`/`GEMINI.md`/`CLAUDE.md` 均含 file-first 契约块。

- [ ] **Step 4: 更新 CHANGELOG（项目发版规则要求）**

按 `AGENTS.md` 发版规则，在 `CHANGELOG.md` 记录本功能。

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): AI file-first 编辑 + 实时热重载"
```

---

## Self-Review 备注（已核对项）

- **Spec 覆盖**：Motion Card 外置(Task 1-4)、会话锁(5-8)、热重载(9-12)、校验回传(13-14)、契约+skill+同步(15-17)、验证(18)——spec 各节均有对应 Task。
- **类型一致**：`MotionCardPayload.tsxPath`、`EditLock`、`EditError`、`EditResult`、`ExternalEditRoute`、`applyExternalTimeline`/`applyExternalCardSource` 在定义与引用处命名一致。
- **需实现时核对的真实信息**（计划中已标注）：① `saveProjectSection` 现有 timeline 字符串/对象落盘行为（Task 3 Step 3）；② `OverlayMotion.enter/exit` 真实枚举集合（Task 13 Step 1）；③ script store 版本历史/灌回函数实际导出名（Task 12 Step 1）；④ `loadProject` IPC 包装名（Task 11 Step 4）；⑤ `ensureProjectClaudeMd` 现有 marker 逻辑（Task 17 Step 1）。这些用 grep/Read 先确认再落代码。

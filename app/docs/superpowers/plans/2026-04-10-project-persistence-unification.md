# 项目数据持久化与配置整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决 AI 一键剪辑后重新打开项目数据全部丢失的问题，统一项目配置文件，迁移 AI 设置到 Electron 全局存储。

**Architecture:** 将 `timeline.json` / `ai-analysis.json` / `script-state.json` 合并为 `project.json`，Main 进程通过写锁保证并发安全；AI Store 补充 subscribe 自动保存；AI 设置从 localStorage 迁移到 `app.getPath('userData')/settings.json`。

**Tech Stack:** Electron IPC, Zustand subscribe, Node.js fs, TypeScript

---

## File Structure

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| Create | `electron/project-file.ts` | project.json 读写 + 写锁 + 迁移逻辑 |
| Create | `electron/global-settings.ts` | 全局 settings.json 读写 |
| Create | `src/lib/project-persistence.ts` | ProjectData 类型定义 + 序列化/反序列化 |
| Create | `tests/project-file.test.ts` | project.json 读写和迁移测试 |
| Create | `tests/global-settings.test.ts` | 全局设置读写测试 |
| Create | `tests/project-persistence.test.ts` | ProjectData 类型和转换测试 |
| Modify | `electron/main.ts` | 新增 IPC handler，保留旧 handler 做兼容 |
| Modify | `electron/preload.ts` | 暴露新 IPC 方法 |
| Modify | `src/lib/electron-api.ts` | ElectronAPI 接口扩展 |
| Modify | `src/store/ai.ts` | 添加 subscribe 自动保存 + 设置 API 异步化 |
| Modify | `src/store/timeline.ts` | subscribe 改用 save-project-section |
| Modify | `src/store/script.ts` | subscribe 改用 save-project-section |
| Modify | `src/App.tsx` | openProject 改用 load-project + 聚合 saveStatus |
| Modify | `src/hooks/useAIVideoWorkflow.ts` | loadAISettings 异步化 + 文稿直读 |
| Modify | `src/components/AIPanel.tsx` | loadAISettings/saveAISettings 异步化 |
| Modify | `src/components/settings/AIConfigTab.tsx` | 异步化 |
| Modify | `src/components/settings/TTSConfigTab.tsx` | 异步化 |
| Modify | `src/pages/Editor.tsx` | loadAISettings 异步化 |

---

### Task 1: ProjectData 类型定义与转换

**Files:**
- Create: `src/lib/project-persistence.ts`
- Create: `tests/project-persistence.test.ts`

- [ ] **Step 1: 编写 ProjectData 类型与转换函数测试**

```typescript
// tests/project-persistence.test.ts
import { describe, it, expect } from 'vitest';
import {
  type ProjectData,
  createDefaultProjectData,
  extractTimelineSection,
  extractAIAnalysisSection,
  extractScriptSection,
  mergeProjectSection,
} from '../src/lib/project-persistence';

describe('project-persistence', () => {
  it('createDefaultProjectData 返回 version 1 的默认结构', () => {
    const data = createDefaultProjectData();
    expect(data.version).toBe(1);
    expect(data.timeline).toBeNull();
    expect(data.aiAnalysis).toEqual({ analysisResult: null, coverCandidates: [] });
    expect(data.script).toEqual({
      templateId: 'news-broadcast',
      annotations: [],
      reviewState: 'idle',
      lastReviewedDocVersion: 0,
    });
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
  });

  it('extractTimelineSection 提取 timeline 段', () => {
    const data = createDefaultProjectData();
    data.timeline = { podcast: { audioPath: '/a.mp3', srtPath: '/a.srt', durationMs: 1000 } } as any;
    expect(extractTimelineSection(data)).toEqual(data.timeline);
  });

  it('mergeProjectSection 合并 timeline 段并更新 updatedAt', () => {
    const data = createDefaultProjectData();
    const before = data.updatedAt;
    const newTimeline = { podcast: { audioPath: '/b.mp3' } } as any;
    const merged = mergeProjectSection(data, 'timeline', newTimeline);
    expect(merged.timeline).toEqual(newTimeline);
    expect(merged.updatedAt).not.toBe(before);
    // 不改变其他段
    expect(merged.aiAnalysis).toEqual(data.aiAnalysis);
    expect(merged.script).toEqual(data.script);
  });

  it('mergeProjectSection 合并 aiAnalysis 段', () => {
    const data = createDefaultProjectData();
    const aiData = { analysisResult: { cards: [], coverPrompts: [], summary: 'test', keywords: [] }, coverCandidates: [] };
    const merged = mergeProjectSection(data, 'aiAnalysis', aiData);
    expect(merged.aiAnalysis).toEqual(aiData);
  });

  it('mergeProjectSection 合并 script 段', () => {
    const data = createDefaultProjectData();
    const scriptData = { templateId: 'custom', annotations: [], reviewState: 'issues' as const, lastReviewedDocVersion: 3 };
    const merged = mergeProjectSection(data, 'script', scriptData);
    expect(merged.script).toEqual(scriptData);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/project-persistence.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 ProjectData 类型与转换函数**

```typescript
// src/lib/project-persistence.ts
import type { TimelineData } from '../types';
import type { AIAnalysisResult, CoverCandidate } from '../types/ai';

export interface ProjectScriptState {
  templateId: string;
  annotations: unknown[];
  reviewState: 'idle' | 'issues' | 'clean';
  lastReviewedDocVersion: number;
}

export interface ProjectAIAnalysis {
  analysisResult: AIAnalysisResult | null;
  coverCandidates: CoverCandidate[];
}

export interface ProjectData {
  version: 1;
  createdAt: string;
  updatedAt: string;
  timeline: TimelineData | null;
  aiAnalysis: ProjectAIAnalysis;
  script: ProjectScriptState;
}

export type ProjectSection = 'timeline' | 'aiAnalysis' | 'script';

export function createDefaultProjectData(): ProjectData {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    timeline: null,
    aiAnalysis: { analysisResult: null, coverCandidates: [] },
    script: {
      templateId: 'news-broadcast',
      annotations: [],
      reviewState: 'idle',
      lastReviewedDocVersion: 0,
    },
  };
}

export function extractTimelineSection(data: ProjectData): TimelineData | null {
  return data.timeline;
}

export function extractAIAnalysisSection(data: ProjectData): ProjectAIAnalysis {
  return data.aiAnalysis;
}

export function extractScriptSection(data: ProjectData): ProjectScriptState {
  return data.script;
}

export function mergeProjectSection<S extends ProjectSection>(
  data: ProjectData,
  section: S,
  value: ProjectData[S],
): ProjectData {
  return {
    ...data,
    [section]: value,
    updatedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/project-persistence.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/project-persistence.ts tests/project-persistence.test.ts
git commit -m "feat(persistence): 新增 ProjectData 类型定义与 section 合并工具"
```

---

### Task 2: Main 进程 project.json 读写 + 写锁 + 迁移

**Files:**
- Create: `electron/project-file.ts`
- Create: `tests/project-file.test.ts`

- [ ] **Step 1: 编写 project-file 测试**

```typescript
// tests/project-file.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadProjectFile,
  saveProjectSection,
} from '../electron/project-file';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proj-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadProjectFile', () => {
  it('空目录返回默认 ProjectData', async () => {
    const data = await loadProjectFile(tmpDir);
    expect(data.version).toBe(1);
    expect(data.timeline).toBeNull();
  });

  it('已有 project.json 则读取', async () => {
    const existing = {
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      timeline: { podcast: { audioPath: '/test.mp3', srtPath: '', durationMs: 0 } },
      aiAnalysis: { analysisResult: null, coverCandidates: [] },
      script: { templateId: 't', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
    };
    await fs.writeFile(path.join(tmpDir, 'project.json'), JSON.stringify(existing));
    const data = await loadProjectFile(tmpDir);
    expect(data.timeline?.podcast?.audioPath).toBe('/test.mp3');
  });

  it('从旧文件迁移：timeline.json + ai-analysis.json + script-state.json', async () => {
    const timeline = { podcast: { audioPath: '/old.mp3', srtPath: '/old.srt', durationMs: 5000 } };
    const aiState = { version: 1, analysisResult: null, coverCandidates: [] };
    const scriptState = { version: 2, templateId: 'news', annotations: [], reviewState: 'clean', lastReviewedDocVersion: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };

    await fs.writeFile(path.join(tmpDir, 'timeline.json'), JSON.stringify(timeline));
    await fs.writeFile(path.join(tmpDir, 'ai-analysis.json'), JSON.stringify(aiState));
    await fs.writeFile(path.join(tmpDir, 'script-state.json'), JSON.stringify(scriptState));

    const data = await loadProjectFile(tmpDir);
    expect(data.timeline?.podcast?.audioPath).toBe('/old.mp3');
    expect(data.aiAnalysis.analysisResult).toBeNull();
    expect(data.script.templateId).toBe('news');

    // 旧文件应被删除
    const files = await fs.readdir(tmpDir);
    expect(files).toContain('project.json');
    expect(files).not.toContain('timeline.json');
    expect(files).not.toContain('ai-analysis.json');
    expect(files).not.toContain('script-state.json');
  });
});

describe('saveProjectSection', () => {
  it('写入 timeline 段并保留其他段', async () => {
    // 先建一个初始 project.json
    await loadProjectFile(tmpDir);

    const newTimeline = { podcast: { audioPath: '/new.mp3', srtPath: '', durationMs: 0 } };
    await saveProjectSection(tmpDir, 'timeline', newTimeline);

    const raw = JSON.parse(await fs.readFile(path.join(tmpDir, 'project.json'), 'utf-8'));
    expect(raw.timeline.podcast.audioPath).toBe('/new.mp3');
    expect(raw.aiAnalysis).toBeDefined();
    expect(raw.script).toBeDefined();
  });

  it('并发写入不损坏文件', async () => {
    await loadProjectFile(tmpDir);

    // 同时写入三个不同 section
    await Promise.all([
      saveProjectSection(tmpDir, 'timeline', { podcast: { audioPath: '/a.mp3', srtPath: '', durationMs: 0 } }),
      saveProjectSection(tmpDir, 'aiAnalysis', { analysisResult: null, coverCandidates: [{ id: '1', prompt: 'p', imageUrl: '/img.png', selected: true }] }),
      saveProjectSection(tmpDir, 'script', { templateId: 'custom', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 }),
    ]);

    const raw = JSON.parse(await fs.readFile(path.join(tmpDir, 'project.json'), 'utf-8'));
    expect(raw.timeline.podcast.audioPath).toBe('/a.mp3');
    expect(raw.aiAnalysis.coverCandidates).toHaveLength(1);
    expect(raw.script.templateId).toBe('custom');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/project-file.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 project-file.ts**

```typescript
// electron/project-file.ts
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  createDefaultProjectData,
  mergeProjectSection,
  type ProjectData,
  type ProjectSection,
} from '../src/lib/project-persistence';
import { parsePersistedAIState } from '../src/lib/ai-persistence';
import { parsePersistedScriptState } from '../src/lib/script-persistence';
import { materializeTimelineWebCards, materializePersistedAIState } from './web-card-storage';

const PROJECT_FILE = 'project.json';

// per-projectDir 写锁：Promise 链序列化
const writeLocks = new Map<string, Promise<void>>();

function withWriteLock(projectDir: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeLocks.get(projectDir) ?? Promise.resolve();
  const next = prev.then(fn, fn); // 即使上一个失败也继续
  writeLocks.set(projectDir, next);
  // 清理完成的锁
  void next.then(() => {
    if (writeLocks.get(projectDir) === next) {
      writeLocks.delete(projectDir);
    }
  });
  return next;
}

async function readProjectJson(projectDir: string): Promise<ProjectData | null> {
  const filePath = path.join(projectDir, PROJECT_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ProjectData;
  } catch {
    return null;
  }
}

async function writeProjectJson(projectDir: string, data: ProjectData): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, PROJECT_FILE),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
}

async function tryReadLegacyFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function removeLegacyFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // 忽略删除失败
  }
}

async function migrateFromLegacyFiles(projectDir: string): Promise<ProjectData> {
  const data = createDefaultProjectData();

  // 迁移 timeline.json
  const timelinePath = path.join(projectDir, 'timeline.json');
  const legacyTimeline = await tryReadLegacyFile<ProjectData['timeline']>(timelinePath);
  if (legacyTimeline) {
    data.timeline = legacyTimeline;
  }

  // 迁移 ai-analysis.json
  const aiPath = path.join(projectDir, 'ai-analysis.json');
  const legacyAI = await tryReadLegacyFile<unknown>(aiPath);
  if (legacyAI) {
    const parsed = parsePersistedAIState(legacyAI);
    if (parsed) {
      data.aiAnalysis = {
        analysisResult: parsed.analysisResult,
        coverCandidates: parsed.coverCandidates,
      };
    }
  }

  // 迁移 script-state.json
  const scriptPath = path.join(projectDir, 'script-state.json');
  const legacyScript = await tryReadLegacyFile<unknown>(scriptPath);
  if (legacyScript) {
    const parsed = parsePersistedScriptState(legacyScript);
    if (parsed) {
      data.script = {
        templateId: parsed.templateId,
        annotations: parsed.annotations,
        reviewState: parsed.reviewState,
        lastReviewedDocVersion: parsed.lastReviewedDocVersion,
      };
    }
  }

  // 写入新 project.json
  await writeProjectJson(projectDir, data);

  // 删除旧文件
  await Promise.all([
    removeLegacyFile(timelinePath),
    removeLegacyFile(aiPath),
    removeLegacyFile(scriptPath),
  ]);

  return data;
}

export async function loadProjectFile(projectDir: string): Promise<ProjectData> {
  // 优先读 project.json
  const existing = await readProjectJson(projectDir);
  if (existing) {
    return existing;
  }

  // 尝试从旧文件迁移
  const hasLegacy =
    existsSync(path.join(projectDir, 'timeline.json')) ||
    existsSync(path.join(projectDir, 'ai-analysis.json')) ||
    existsSync(path.join(projectDir, 'script-state.json'));

  if (hasLegacy) {
    return migrateFromLegacyFiles(projectDir);
  }

  // 全新项目
  const data = createDefaultProjectData();
  await writeProjectJson(projectDir, data);
  return data;
}

export async function saveProjectSection(
  projectDir: string,
  section: ProjectSection,
  value: unknown,
): Promise<void> {
  return withWriteLock(projectDir, async () => {
    let current = await readProjectJson(projectDir);
    if (!current) {
      current = createDefaultProjectData();
    }

    // web card 物化处理
    let sectionValue = value;
    if (section === 'timeline' && sectionValue) {
      const { data: materialized } = await materializeTimelineWebCards(
        projectDir,
        sectionValue as import('../src/types').TimelineData,
      );
      sectionValue = materialized;
    }
    if (section === 'aiAnalysis' && sectionValue) {
      const aiValue = sectionValue as { analysisResult: unknown; coverCandidates: unknown[] };
      const { data: materialized } = await materializePersistedAIState(projectDir, {
        version: 1,
        analysisResult: aiValue.analysisResult as any,
        coverCandidates: aiValue.coverCandidates as any,
      });
      sectionValue = {
        analysisResult: materialized.analysisResult,
        coverCandidates: materialized.coverCandidates,
      };
    }

    const merged = mergeProjectSection(current, section, sectionValue as ProjectData[typeof section]);
    await writeProjectJson(projectDir, merged);
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/project-file.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/project-file.ts tests/project-file.test.ts
git commit -m "feat(persistence): 实现 project.json 读写引擎 + 写锁 + 旧文件迁移"
```

---

### Task 3: 全局 AI 设置存储

**Files:**
- Create: `electron/global-settings.ts`
- Create: `tests/global-settings.test.ts`

- [ ] **Step 1: 编写全局设置读写测试**

```typescript
// tests/global-settings.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadGlobalSettings,
  saveGlobalSettings,
  type GlobalSettingsFile,
} from '../electron/global-settings';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadGlobalSettings', () => {
  it('文件不存在时返回 null', async () => {
    const result = await loadGlobalSettings(tmpDir);
    expect(result).toBeNull();
  });

  it('读取已有设置', async () => {
    const settings: GlobalSettingsFile = {
      aiSettings: {
        llmBaseUrl: 'https://api.openai.com/v1',
        llmApiKey: 'sk-test',
        llmModel: 'gpt-4o',
        jimengApiUrl: '',
        jimengSessionId: '',
        minimaxApiKey: '',
        minimaxVoiceId: 'male-qn-qingse',
        minimaxSpeed: 1.0,
      },
    };
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify(settings),
    );
    const result = await loadGlobalSettings(tmpDir);
    expect(result?.aiSettings.llmApiKey).toBe('sk-test');
  });
});

describe('saveGlobalSettings', () => {
  it('写入设置后可读回', async () => {
    const settings: GlobalSettingsFile = {
      aiSettings: {
        llmBaseUrl: 'https://custom.api/v1',
        llmApiKey: 'sk-123',
        llmModel: 'gpt-4o-mini',
        jimengApiUrl: '',
        jimengSessionId: '',
        minimaxApiKey: 'mm-key',
        minimaxVoiceId: 'female',
        minimaxSpeed: 1.5,
      },
    };
    await saveGlobalSettings(tmpDir, settings);
    const result = await loadGlobalSettings(tmpDir);
    expect(result?.aiSettings.llmApiKey).toBe('sk-123');
    expect(result?.aiSettings.minimaxSpeed).toBe(1.5);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/global-settings.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 global-settings.ts**

```typescript
// electron/global-settings.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AISettings } from '../src/types/ai';

export interface GlobalSettingsFile {
  aiSettings: AISettings;
}

const SETTINGS_FILE = 'settings.json';

export async function loadGlobalSettings(
  userDataPath: string,
): Promise<GlobalSettingsFile | null> {
  try {
    const raw = await fs.readFile(
      path.join(userDataPath, SETTINGS_FILE),
      'utf-8',
    );
    return JSON.parse(raw) as GlobalSettingsFile;
  } catch {
    return null;
  }
}

export async function saveGlobalSettings(
  userDataPath: string,
  settings: GlobalSettingsFile,
): Promise<void> {
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(
    path.join(userDataPath, SETTINGS_FILE),
    JSON.stringify(settings, null, 2),
    'utf-8',
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/global-settings.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/global-settings.ts tests/global-settings.test.ts
git commit -m "feat(settings): 实现 Electron 全局 AI 设置读写"
```

---

### Task 4: IPC handler 注册——新增 load-project / save-project-section / 全局设置

**Files:**
- Modify: `electron/main.ts:1-35` (imports)
- Modify: `electron/main.ts:330-378` (在现有 handler 附近新增)

- [ ] **Step 1: 在 electron/main.ts 中添加 import**

在 `electron/main.ts` 顶部的 import 区域（约第 16 行 `import type { PersistedAIState }` 之后）添加：

```typescript
import { loadProjectFile, saveProjectSection } from './project-file';
import { loadGlobalSettings, saveGlobalSettings, type GlobalSettingsFile } from './global-settings';
```

- [ ] **Step 2: 注册 load-project IPC handler**

在 `electron/main.ts` 中 `ipcMain.handle('save-timeline', ...)` 之前（约第 329 行）插入：

```typescript
ipcMain.handle('load-project', async (_event, projectDir: string) => {
  const data = await loadProjectFile(projectDir);
  return JSON.stringify(data, null, 2);
});

ipcMain.handle(
  'save-project-section',
  async (_event, projectDir: string, section: string, data: string) => {
    const parsed = JSON.parse(data);
    await saveProjectSection(projectDir, section as 'timeline' | 'aiAnalysis' | 'script', parsed);
  },
);
```

- [ ] **Step 3: 注册全局设置 IPC handler**

在同一区域继续添加：

```typescript
ipcMain.handle('load-global-settings', async () => {
  const userDataPath = app.getPath('userData');
  const settings = await loadGlobalSettings(userDataPath);
  return settings ? JSON.stringify(settings) : null;
});

ipcMain.handle('save-global-settings', async (_event, data: string) => {
  const userDataPath = app.getPath('userData');
  const settings = JSON.parse(data) as GlobalSettingsFile;
  await saveGlobalSettings(userDataPath, settings);
});
```

- [ ] **Step 4: 构建确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add electron/main.ts
git commit -m "feat(ipc): 注册 load-project / save-project-section / 全局设置 handler"
```

---

### Task 5: Preload + ElectronAPI 类型扩展

**Files:**
- Modify: `electron/preload.ts:34-39`
- Modify: `src/lib/electron-api.ts:102-105`

- [ ] **Step 1: 在 preload.ts 中暴露新 API**

在 `electron/preload.ts` 的 `loadAIAnalysis` 行（约第 39 行）之后添加：

```typescript
  loadProject: (projectDir: string) =>
    ipcRenderer.invoke('load-project', projectDir),
  saveProjectSection: (projectDir: string, section: string, data: string) =>
    ipcRenderer.invoke('save-project-section', projectDir, section, data),
  loadGlobalSettings: () =>
    ipcRenderer.invoke('load-global-settings'),
  saveGlobalSettings: (data: string) =>
    ipcRenderer.invoke('save-global-settings', data),
```

- [ ] **Step 2: 在 electron-api.ts 中扩展 ElectronAPI 接口**

在 `src/lib/electron-api.ts` 的 `loadAIAnalysis` 行（约第 105 行）之后添加：

```typescript
  loadProject: (projectDir: string) => Promise<string>;
  saveProjectSection: (projectDir: string, section: string, data: string) => Promise<void>;
  loadGlobalSettings: () => Promise<string | null>;
  saveGlobalSettings: (data: string) => Promise<void>;
```

- [ ] **Step 3: 构建确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add electron/preload.ts src/lib/electron-api.ts
git commit -m "feat(ipc): preload 暴露 loadProject/saveProjectSection/全局设置 API"
```

---

### Task 6: AI Store 自动保存 + saveStatus 事件

**Files:**
- Modify: `src/store/ai.ts:61-130`

- [ ] **Step 1: 在 ai.ts 中添加 AI save status 事件系统**

在 `src/store/ai.ts` 文件末尾 `saveAISettings` 函数之后（第 129 行后），添加：

```typescript
// ─── AI Save Status ─────────────────────────────────────
import type { SaveStatus } from './timeline';
import { getCurrentProjectDir } from './timeline';
import { createPersistedAIState } from '../lib/ai-persistence';

let currentAISaveStatus: SaveStatus = 'idle';
const aiSaveStatusListeners = new Set<(status: SaveStatus) => void>();

function emitAISaveStatus(status: SaveStatus): void {
  currentAISaveStatus = status;
  for (const listener of aiSaveStatusListeners) {
    listener(status);
  }
}

export function getCurrentAISaveStatus(): SaveStatus {
  return currentAISaveStatus;
}

export function subscribeToAISaveStatus(listener: (status: SaveStatus) => void): () => void {
  aiSaveStatusListeners.add(listener);
  listener(currentAISaveStatus);
  return () => {
    aiSaveStatusListeners.delete(listener);
  };
}

// ─── Auto-save subscription ─────────────────────────────

let aiSaveTimer: ReturnType<typeof setTimeout> | null = null;

if (typeof window !== 'undefined') {
  useAIStore.subscribe((state, prevState) => {
    if (
      state.analysisResult === prevState.analysisResult &&
      state.coverCandidates === prevState.coverCandidates
    ) {
      return;
    }

    const projectDir = getCurrentProjectDir();
    if (!projectDir || !window.electronAPI?.saveProjectSection) {
      return;
    }

    emitAISaveStatus('saving');
    if (aiSaveTimer) {
      clearTimeout(aiSaveTimer);
    }

    aiSaveTimer = setTimeout(() => {
      const persistedState = createPersistedAIState(
        state.analysisResult,
        state.coverCandidates,
      );
      void window.electronAPI
        .saveProjectSection(projectDir, 'aiAnalysis', JSON.stringify(persistedState))
        .then(() => {
          emitAISaveStatus('saved');
        })
        .catch((error) => {
          console.error('保存 AI 分析数据失败:', error);
          emitAISaveStatus('error');
        });
    }, 300);
  });
}
```

- [ ] **Step 2: 构建确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/store/ai.ts
git commit -m "feat(ai-store): 添加 subscribe 自动保存 + AI saveStatus 事件系统"
```

---

### Task 7: Timeline Store 切换到 save-project-section

**Files:**
- Modify: `src/store/timeline.ts:885-913`

- [ ] **Step 1: 修改 timeline auto-save 使用新 IPC**

将 `src/store/timeline.ts` 第 885-913 行的 subscribe 块替换为：

```typescript
if (typeof window !== 'undefined') {
  useTimelineStore.subscribe((state, previousState) => {
    if (state.timeline === previousState.timeline) {
      return;
    }

    const projectDir = getProjectDir();
    if (!projectDir || !window.electronAPI?.saveProjectSection) {
      return;
    }

    emitSaveStatus('saving');
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      void window.electronAPI
        .saveProjectSection(projectDir, 'timeline', JSON.stringify(state.timeline))
        .then(() => {
          emitSaveStatus('saved');
        })
        .catch((error) => {
          console.error('保存 timeline 失败:', error);
          emitSaveStatus('error');
        });
    }, 300);
  });
}
```

- [ ] **Step 2: 构建确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/store/timeline.ts
git commit -m "refactor(timeline): auto-save 切换到 save-project-section IPC"
```

---

### Task 8: Script Store 切换到 save-project-section

**Files:**
- Modify: `src/store/script.ts:495-516`
- Modify: `src/lib/script-persistence.ts:140-160`

- [ ] **Step 1: 修改 script store auto-save**

将 `src/store/script.ts` 第 495-516 行的 subscribe 块替换为：

```typescript
// 自动保存：当 reviewState / scriptDocVersion / template / annotations 变化时，防抖写入 project.json
useScriptStore.subscribe((state, prevState) => {
  if (!state.projectDir) return;

  const changed =
    state.reviewState !== prevState.reviewState ||
    state.scriptDocVersion !== prevState.scriptDocVersion ||
    state.selectedTemplate !== prevState.selectedTemplate ||
    state.annotations !== prevState.annotations;

  if (!changed) return;

  const scriptSection = {
    templateId: state.selectedTemplate,
    annotations: state.annotations,
    reviewState: state.reviewState,
    lastReviewedDocVersion: state.scriptDocVersion,
  };

  debouncedSaveScriptSection(state.projectDir, scriptSection);
});
```

- [ ] **Step 2: 在 script-persistence.ts 中添加 debouncedSaveScriptSection**

在 `src/lib/script-persistence.ts` 的 `debouncedSaveState` 函数之后（约第 153 行后）添加：

```typescript
let scriptSectionTimer: ReturnType<typeof setTimeout> | null = null;

export function debouncedSaveScriptSection(
  projectDir: string,
  scriptSection: unknown,
  delayMs = 300,
): void {
  if (scriptSectionTimer) clearTimeout(scriptSectionTimer);
  scriptSectionTimer = setTimeout(() => {
    void window.electronAPI.saveProjectSection(
      projectDir,
      'script',
      JSON.stringify(scriptSection),
    );
  }, delayMs);
}
```

- [ ] **Step 3: 在 script store 中更新 import**

在 `src/store/script.ts` 顶部的 import 中，从 `script-persistence` 添加 `debouncedSaveScriptSection`：

```typescript
import {
  createPersistedScriptState,
  debouncedSaveState,
  debouncedSaveScriptSection,
  // ... 其他已有 imports
} from '../lib/script-persistence';
```

- [ ] **Step 4: 构建确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/store/script.ts src/lib/script-persistence.ts
git commit -m "refactor(script): auto-save 切换到 save-project-section IPC"
```

---

### Task 9: AI 设置异步化——store 层

**Files:**
- Modify: `src/store/ai.ts:95-129`

- [ ] **Step 1: 将 loadAISettings 和 saveAISettings 改为异步**

将 `src/store/ai.ts` 中的 `loadAISettings` 和 `saveAISettings` 改为：

```typescript
const AI_SETTINGS_LEGACY_KEY = 'podcast-editor-ai-settings';

export async function loadAISettings(): Promise<AISettings | null> {
  // 优先从 Electron 全局存储读取
  if (typeof window !== 'undefined' && window.electronAPI?.loadGlobalSettings) {
    try {
      const raw = await window.electronAPI.loadGlobalSettings();
      if (raw) {
        const file = JSON.parse(raw) as { aiSettings: AISettings };
        return {
          ...file.aiSettings,
          enableThinking: file.aiSettings.enableThinking ?? true,
          minimaxApiKey: file.aiSettings.minimaxApiKey ?? '',
          minimaxVoiceId: file.aiSettings.minimaxVoiceId ?? 'male-qn-qingse',
          minimaxSpeed: file.aiSettings.minimaxSpeed ?? 1.0,
          minimaxVol: file.aiSettings.minimaxVol ?? 1.0,
          minimaxPitch: file.aiSettings.minimaxPitch ?? 0,
          minimaxEmotion: file.aiSettings.minimaxEmotion ?? '',
          minimaxModel: file.aiSettings.minimaxModel ?? 'speech-2.8-hd',
        };
      }
    } catch {
      // fallthrough to legacy
    }
  }

  // 兼容：从 localStorage 读取旧数据并自动迁移
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    const rawValue = window.localStorage.getItem(AI_SETTINGS_LEGACY_KEY);
    if (rawValue) {
      try {
        const parsed = JSON.parse(rawValue) as AISettings;
        const settings: AISettings = {
          ...parsed,
          enableThinking: parsed.enableThinking ?? true,
          minimaxApiKey: parsed.minimaxApiKey ?? '',
          minimaxVoiceId: parsed.minimaxVoiceId ?? 'male-qn-qingse',
          minimaxSpeed: parsed.minimaxSpeed ?? 1.0,
          minimaxVol: parsed.minimaxVol ?? 1.0,
          minimaxPitch: parsed.minimaxPitch ?? 0,
          minimaxEmotion: parsed.minimaxEmotion ?? '',
          minimaxModel: parsed.minimaxModel ?? 'speech-2.8-hd',
        };
        // 自动迁移到 Electron 全局存储
        await saveAISettings(settings);
        window.localStorage.removeItem(AI_SETTINGS_LEGACY_KEY);
        return settings;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  if (typeof window !== 'undefined' && window.electronAPI?.saveGlobalSettings) {
    const file = { aiSettings: settings };
    await window.electronAPI.saveGlobalSettings(JSON.stringify(file));
  }
}
```

同时删除旧的同步版本 `AI_SETTINGS_KEY` 常量（第 35 行）和旧的 `loadAISettings` / `saveAISettings` 函数。

- [ ] **Step 2: 构建确认——暂时会有调用方类型错误（预期）**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: 调用方报错——因为 `loadAISettings` 返回类型从 `AISettings | null` 变为 `Promise<AISettings | null>`

- [ ] **Step 3: 提交**

```bash
git add src/store/ai.ts
git commit -m "refactor(ai-settings): 迁移到 Electron 全局存储，loadAISettings/saveAISettings 异步化"
```

---

### Task 10: AI 设置异步化——调用方适配

**Files:**
- Modify: `src/components/settings/AIConfigTab.tsx:27-51`
- Modify: `src/components/settings/TTSConfigTab.tsx:50-82`
- Modify: `src/components/AIPanel.tsx:183,243,277,398,641`
- Modify: `src/pages/Editor.tsx:313`
- Modify: `src/hooks/useAIVideoWorkflow.ts:93`

- [ ] **Step 1: 修改 AIConfigTab.tsx**

将 `AIConfigTab.tsx` 的 `useEffect` 和 `handleSave` 改为 async：

```typescript
// AIConfigTab.tsx 第 27-51 行
useEffect(() => {
  void loadAISettings().then((settings) => {
    setLlmBaseUrl(settings?.llmBaseUrl ?? 'https://api.openai.com/v1');
    setLlmApiKey(settings?.llmApiKey ?? '');
    setLlmModel(settings?.llmModel ?? 'gpt-4o');
    setEnableThinking(settings?.enableThinking ?? true);
    setJimengApiUrl(settings?.jimengApiUrl ?? '');
    setJimengSessionId(settings?.jimengSessionId ?? '');
    setJimengModel(settings?.jimengModel ?? 'jimeng-4.5');
  });
}, []);

const handleSave = () => {
  void loadAISettings().then((current) => {
    void saveAISettings({
      ...(current ?? { minimaxApiKey: '', minimaxVoiceId: 'male-qn-qingse', minimaxSpeed: 1.0 }),
      llmBaseUrl,
      llmApiKey,
      llmModel,
      enableThinking,
      jimengApiUrl,
      jimengSessionId,
      jimengModel,
    }).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  });
};
```

- [ ] **Step 2: 修改 TTSConfigTab.tsx**

将 `TTSConfigTab.tsx` 的 `useEffect` 和 `handleSave` 改为 async：

```typescript
// TTSConfigTab.tsx 第 50-82 行
useEffect(() => {
  void loadAISettings().then((s) => {
    if (!s) return;
    setApiKey(s.minimaxApiKey ?? '');
    setModel(s.minimaxModel ?? 'speech-2.8-hd');
    setVoiceId(s.minimaxVoiceId ?? 'male-qn-qingse');
    setSpeed(s.minimaxSpeed ?? 1.0);
    setVol(s.minimaxVol ?? 1.0);
    setPitch(s.minimaxPitch ?? 0);
    setEmotion(s.minimaxEmotion ?? '');
  });
}, []);

const handleSave = () => {
  void loadAISettings().then((current) => {
    void saveAISettings({
      ...(current ?? {
        llmBaseUrl: '',
        llmApiKey: '',
        llmModel: '',
        jimengApiUrl: '',
        jimengSessionId: '',
      }),
      minimaxApiKey: apiKey,
      minimaxModel: model,
      minimaxVoiceId: voiceId,
      minimaxSpeed: speed,
      minimaxVol: vol,
      minimaxPitch: pitch,
      minimaxEmotion: emotion,
    }).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  });
};
```

- [ ] **Step 3: 修改 AIPanel.tsx 中所有 loadAISettings 调用**

将 `AIPanel.tsx` 中的所有 `loadAISettings()` 调用包装为 async：

- 第 183 行：`const settings = loadAISettings();` → `const settings = await loadAISettings();`（所在函数加 `async`）
- 第 243 行：同上
- 第 277 行：同上
- 第 398 行：`const panelSettings = loadAISettings();` → 改为 useEffect 中异步加载并缓存到 state
- 第 641 行：`onSave={(settings: AISettings) => saveAISettings(settings)}` → `onSave={(settings: AISettings) => { void saveAISettings(settings); }}`

- [ ] **Step 4: 修改 Editor.tsx**

将 `src/pages/Editor.tsx` 第 313 行 `const settings = loadAISettings();` 改为：
```typescript
const settings = await loadAISettings();
```
（所在函数 `rerunAiAnalysisForCurrentSrt` 已经是 async）

- [ ] **Step 5: 修改 useAIVideoWorkflow.ts**

将 `src/hooks/useAIVideoWorkflow.ts` 第 93 行改为：
```typescript
const settings = await loadAISettings();
```
（所在函数 `runFromStep` 已经是 async）

- [ ] **Step 6: 构建确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add src/components/settings/AIConfigTab.tsx src/components/settings/TTSConfigTab.tsx src/components/AIPanel.tsx src/pages/Editor.tsx src/hooks/useAIVideoWorkflow.ts
git commit -m "refactor(ai-settings): 所有调用方适配 async loadAISettings/saveAISettings"
```

---

### Task 11: App.tsx 加载改用 load-project + 聚合 saveStatus

**Files:**
- Modify: `src/App.tsx:57,175-264,281,592,636`

- [ ] **Step 1: 添加 AI save status 订阅**

在 `src/App.tsx` 的 import 中添加：

```typescript
import { getCurrentAISaveStatus, subscribeToAISaveStatus } from './store/ai';
```

在 `saveStatus` state 声明（第 57 行）后添加：

```typescript
const [aiSaveStatus, setAISaveStatus] = useState(() => getCurrentAISaveStatus());
```

在 `subscribeToSaveStatus` 的 useEffect（第 281 行）后添加：

```typescript
useEffect(() => subscribeToAISaveStatus(setAISaveStatus), []);
```

- [ ] **Step 2: 计算聚合 saveStatus**

在两个 state 声明之后添加聚合逻辑：

```typescript
const aggregatedSaveStatus: SaveStatus = (() => {
  if (saveStatus === 'error' || aiSaveStatus === 'error') return 'error';
  if (saveStatus === 'saving' || aiSaveStatus === 'saving') return 'saving';
  if (saveStatus === 'saved' && aiSaveStatus === 'saved') return 'saved';
  if (saveStatus === 'saved' || aiSaveStatus === 'saved') return 'saved';
  return saveStatus;
})();
```

将两处 `saveStatus={saveStatus}` 改为 `saveStatus={aggregatedSaveStatus}`（约第 592 和 636 行）。

- [ ] **Step 3: 改 openProject 使用 load-project**

将 `openProject` 函数（第 175-264 行）的核心逻辑改为：

```typescript
const openProject = useCallback(
  async (projectDir: string) => {
    try {
      const raw = await window.electronAPI.loadProject(projectDir);
      const projectData = JSON.parse(raw) as import('./lib/project-persistence').ProjectData;

      // timeline 段
      if (projectData.timeline) {
        setTimeline(projectData.timeline);
      } else {
        setTimeline(createDefaultTimeline());
      }

      // SRT 解析
      if (projectData.timeline?.podcast?.srtPath) {
        try {
          const { entries } = await window.electronAPI.parseSrtFile(
            projectData.timeline.podcast.srtPath,
          );
          setSrtEntries(entries);
        } catch (err) {
          const isNotFound = String(err).includes('ENOENT');
          if (isNotFound) {
            if (projectData.timeline) {
              projectData.timeline.podcast = {
                ...projectData.timeline.podcast,
                srtPath: '',
                audioPath: '',
              };
              await window.electronAPI.saveProjectSection(
                projectDir,
                'timeline',
                JSON.stringify(projectData.timeline),
              );
            }
            setSrtEntries([]);
            showToast('字幕文件已被删除，已从工程配置中移除', {
              type: 'warning',
              duration: 5000,
            });
          } else {
            throw err;
          }
        }
      } else {
        setSrtEntries([]);
      }

      // AI 分析段
      if (projectData.aiAnalysis?.analysisResult) {
        setAIAnalysisResult(projectData.aiAnalysis.analysisResult);
        setCoverCandidates(projectData.aiAnalysis.coverCandidates ?? []);
      } else {
        clearAIAnalysis();
      }

      setProjectDir(projectDir);
      syncWorkspaceState();
      setSetupError(null);
      setPage(
        projectData.timeline?.podcast?.audioPath && projectData.timeline?.podcast?.srtPath
          ? 'editor'
          : 'welcome',
      );
    } catch (error) {
      console.error('恢复工程失败:', error);
      removeRecentProject(projectDir);
      if (getCurrentProjectDir() === projectDir) {
        clearCurrentProject();
      }
      syncWorkspaceState();
      resetToSetup();
      setSetupError('恢复工程失败，请重新打开工程或重新导入 MP3 和 SRT。');
    }
  },
  [
    clearAIAnalysis,
    resetToSetup,
    setAIAnalysisResult,
    setCoverCandidates,
    setSrtEntries,
    setTimeline,
    showToast,
    syncWorkspaceState,
  ],
);
```

- [ ] **Step 4: 移除 openProject 中旧的 loadTimeline / loadAIAnalysis 调用**

确保不再使用旧的 `window.electronAPI.loadTimeline()` 和 `window.electronAPI.loadAIAnalysis()`。还需移除相关的 `parsePersistedAIState` import（如果不再被其他地方使用）。

- [ ] **Step 5: 构建确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/App.tsx
git commit -m "feat(app): openProject 改用 load-project + 聚合 saveStatus 显示"
```

---

### Task 12: AI 工作流文稿直读 + persistAIState 适配

**Files:**
- Modify: `src/hooks/useAIVideoWorkflow.ts:62-73,245,297,303`

- [ ] **Step 1: 修改 persistAIState 使用 save-project-section**

将 `useAIVideoWorkflow.ts` 中的 `persistAIState` 函数（第 62-73 行）改为：

```typescript
async function persistAIState(
  projectDir: string,
  analysisResult: AIAnalysisResult | null,
  coverCandidates: CoverCandidate[],
): Promise<void> {
  if (!projectDir) {
    return;
  }

  const persistedState = createPersistedAIState(analysisResult, coverCandidates);
  await window.electronAPI.saveProjectSection(
    projectDir,
    'aiAnalysis',
    JSON.stringify(persistedState),
  );
}
```

- [ ] **Step 2: 修改 start 函数中的文稿来源**

将 `start` 回调（第 372-384 行）改为从磁盘读取 `script.md`：

```typescript
const start = useCallback(
  async (scriptText: string, options?: WorkflowStartOptions) => {
    resetWorkflowSession();
    workflowSession.requestId = crypto.randomUUID();
    workflowSession.retryStep = 'tts_generating';
    workflowSession.projectDir = getProjectDir() ?? '';
    workflowSession.pauseAfterTts = options?.pauseAfterTts ?? false;

    // 优先使用传入文本，否则从磁盘读取 script.md
    let text = scriptText;
    if (!text.trim() && workflowSession.projectDir) {
      const diskText = await window.electronAPI.loadScriptFile(
        workflowSession.projectDir,
        'script.md',
      );
      text = diskText ?? '';
    }
    workflowSession.scriptText = text;

    void runFromStep('tts_generating', text, workflowSession.projectDir);
  },
  [runFromStep],
);
```

注意 `start` 从同步改为异步——需更新返回类型和调用方。

- [ ] **Step 3: 构建确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/hooks/useAIVideoWorkflow.ts
git commit -m "refactor(workflow): persistAIState 用 save-project-section + 文稿直读 script.md"
```

---

### Task 13: Editor.tsx 中 persistAIState 适配

**Files:**
- Modify: `src/pages/Editor.tsx:302-306`

- [ ] **Step 1: 修改 Editor.tsx 中的 persistAIState 调用**

`src/pages/Editor.tsx` 中有独立的 `persistAIState` 回调和直接调用旧 `saveAIAnalysis` IPC 的代码。需要替换：

第 302-306 行：
```typescript
// 旧代码
const persistedState = createPersistedAIState(result, []);
await window.electronAPI.saveAIAnalysis(
  projectDir,
  JSON.stringify(persistedState, null, 2),
);
```

改为：
```typescript
const persistedState = createPersistedAIState(result, []);
await window.electronAPI.saveProjectSection(
  projectDir,
  'aiAnalysis',
  JSON.stringify(persistedState),
);
```

同样处理 Editor.tsx 中所有其他 `saveAIAnalysis` 调用（搜索确认）。

- [ ] **Step 2: 构建确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/pages/Editor.tsx
git commit -m "refactor(editor): persistAIState 切换到 save-project-section"
```

---

### Task 14: 运行全量测试 + 修复

**Files:**
- 可能修改多个文件

- [ ] **Step 1: 运行全量测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 2: 修复任何失败的测试**

根据测试输出修复问题。常见问题：
- 测试中 mock 了 `saveTimeline` / `loadTimeline` 但现在代码调用 `saveProjectSection` / `loadProject`——需更新 mock
- `loadAISettings` 变为异步——测试中需要 await

- [ ] **Step 3: 运行 TypeScript 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交修复**

```bash
git add -A
git commit -m "fix(tests): 适配项目持久化重构后的测试用例"
```

---

### Task 15: 集成验证

- [ ] **Step 1: 启动开发服务器**

Run: `npm run dev`
Expected: 应用正常启动

- [ ] **Step 2: 验证旧项目迁移**

手动测试：打开一个包含旧 `timeline.json` + `ai-analysis.json` 的项目目录
Expected:
- 自动迁移为 `project.json`
- 旧文件被删除
- 所有数据正常加载

- [ ] **Step 3: 验证 AI 自动保存**

手动测试：
1. 运行 AI 一键剪辑
2. 修改 AI 卡片（启用/禁用/编辑内容）
3. 观察 Toolbar 显示"保存中…" → "已保存"
4. 关闭应用 → 重新打开
5. 确认所有 AI 数据已恢复

- [ ] **Step 4: 验证全局设置持久化**

手动测试：
1. 进入设置页 → AI 配置 → 修改 API Key → 保存
2. 进入设置页 → TTS 配置 → 修改音色 → 保存
3. 关闭应用 → 重新打开
4. 确认设置已恢复
5. 确认 localStorage 中无旧 `podcast-editor-ai-settings` key

- [ ] **Step 5: 验证并发保存安全**

手动测试：快速连续修改 timeline（拖动 overlay）+ AI 卡片（切换启用）
Expected: `project.json` 不损坏，两段数据都正确保存

- [ ] **Step 6: 提交最终状态**

```bash
git add -A
git commit -m "feat(persistence): 项目数据持久化与配置整合完成"
```

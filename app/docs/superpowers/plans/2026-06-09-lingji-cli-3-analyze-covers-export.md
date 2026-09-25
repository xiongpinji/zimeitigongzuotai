# 灵机 CLI Plan 3 — 字幕分析/卡片 · 封面 · 导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 2 的 headless 生成框架上补齐其余生成模块：字幕分析（含卡片批量）、封面（提示词 / 出图 / 一次性）、导出 MP4，并接入对应 CLI 命令。

**Architecture:** 复用 Plan 2 的 `registerGenerationTool`（createTask → headless run → `pipeline:project-updated` 刷新 → taskId）。各模块在主进程复用既有纯库：`analyzeSrt`（`src/lib/ai-analysis.ts`）、`regenerateCoverPrompt`/`generateCoverCandidates`、以及导出渲染链（将 `render-video` IPC 处理体**无行为变更地抽取**为 `renderVideoHeadless`，IPC 与 pipeline run 共用）。结果写回 `project.json` 的 `aiAnalysis`/产物文件。

**Tech Stack:** TypeScript、Electron 主进程、Remotion、`@modelcontextprotocol/sdk`、Vitest。

参考：spec `…-cli-design.md`（§4、§5、§9.1 Plan 3）；Plan 2 已交付的 `electron/pipeline/headless-generation.ts`、`headless-settings.ts`、`runs/tts-run.ts`。

**关键前置事实（已核实）：**
- `analyzeSrt(entries, settings, options): Promise<AIAnalysisResult>`（`src/lib/ai-analysis.ts`，main-importable，已被 `electron/main.ts` 使用）一次产出 segments + cards + coverPrompts。**本应用中「分析」与「卡片生成」是同一批处理**，无独立拆分。
- 封面：`regenerateCoverPrompt(entries, settings, opts): Promise<string[]>`（`src/lib/ai-analysis.ts`）；`generateCoverCandidates(prompts, imageProvider, imageModel, coversDir, ctx): Promise<CoverCandidate[]>`（`src/lib/cover-generation.ts`，写 `covers/cover-*.png`）。`resolvePromptBinding('cover.regeneration', settings, projectBindings)` 取 imageProvider/imageModel。
- 导出：`render-video` IPC（`electron/main.ts` ~2373-2464）除 `render-progress` 外不依赖窗口；可抽取为 headless 函数。默认 `ExportConfig = { resolution: '720p', quality: 'balanced' }`（仅 `quality` 影响渲染）。
- 持久化：headless 写 `project.json` 的 `aiAnalysis` 节用 `HeadlessProjectContext.saveSection('aiAnalysis', value)`（**不要**走渲染进程的旧 `save-ai-analysis`→`ai-analysis.json` 路径）。`createPersistedAIState(result, candidates)`（`src/lib/ai-persistence.ts`）规范化后再存。
- SRT 解析：`parseSrt(content): SrtEntry[]`（`src/lib/srt-parser.ts`，已在 main 使用）。
- 完整设置：`buildDefaultAISettings` **不可** main 导入（store 顶层有 zustand）；复制其字面量 + 跑迁移链 `normalizeTTSSettings(migrateImageProviders(migrateToProviders(merged)))`（三者均 main-importable 纯库）。
- 模板：`loadEffectivePromptTemplate(kind, { userDataPath, projectDir })`（`electron/prompts-io.ts`）。`loadProjectStylePresetId`/`stylePresetId` 取自 `project.json`。

**范围与限定：**
- `subtitle analyze` 与 `cards gen` 两个 CLI 命令都映射到同一后端工具 `lingji_analyze_subtitles`（= 全量 analyzeSrt）。在 README/help 中说明二者等价（卡片随分析产出）。
- 封面提示词持久化的 gotcha：`coverPrompts` 挂在 `analysisResult` 上；若当前 `analysisResult` 为 `null`，cover-prompt run 必须先要求已存在分析（否则报错提示先 `analyze`）。
- 卡片图片素材：analyzeSrt 注入 `generateCardImage` 后会即时 materialize 图片卡；本计划注入它（复用主进程 `handleGenerateCardImage`），与 UI 行为一致。
- 导出抽取为**无行为变更重构**：仅移动处理体 + 用注入的 `onProgress` 取代 `mainWindow?.webContents.send('render-progress', …)`。

---

## File Structure

- `electron/pipeline/headless-settings.ts`（修改）：新增 `loadFullHeadlessAISettings(userDataPath)`（默认字面量 + 迁移链）。
- `electron/pipeline/runs/analyze-run.ts`（新增）：`runAnalyzeHeadless`（注入式 analyzeSrt）。
- `electron/pipeline/runs/cover-run.ts`（新增）：`runCoverPromptHeadless` / `runCoverImagesHeadless` / `runCoversHeadless`。
- `electron/pipeline/runs/export-run.ts`（新增）：`runExportHeadless`（调用抽取出的 `renderVideoHeadless`）。
- `electron/remotion/render-video-headless.ts`（新增）：从 `render-video` IPC 抽取的 `renderVideoHeadless(args, { onProgress })`。
- `electron/main.ts`（修改）：`render-video` IPC 改为薄包装调用 `renderVideoHeadless`。
- `electron/pipeline/headless-generation.ts`（修改）：`registerGenerationTools` 增加 analyze / cover×3 / export 工具（export 的 inputSchema 含可选 `out`）。
- `electron/pipeline/tools/register.ts`：无需改动（已调用 `registerGenerationTools`）。
- `tests/pipeline-mcp-registration.test.ts`（修改）：工具计数与名单。
- `cli/src/commands/{subtitle,cards,cover,export}.ts`（新增）+ `cli/src/index.ts`（修改）。
- 测试：`tests/headless-full-settings.test.ts`、`tests/analyze-run.test.ts`、`tests/cover-run.test.ts`、`tests/export-run.test.ts`、`tests/render-video-headless.test.ts`、`tests/cli-subtitle-command.test.ts`、`tests/cli-cards-command.test.ts`、`tests/cli-cover-command.test.ts`、`tests/cli-export-command.test.ts`。

---

## Task 1: 完整 AISettings 装配

**Files:**
- Modify: `electron/pipeline/headless-settings.ts`
- Test: `tests/headless-full-settings.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/headless-full-settings.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadFullHeadlessAISettings } from '../electron/pipeline/headless-settings';

describe('loadFullHeadlessAISettings', () => {
  it('returns fully-defaulted settings when settings.json missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-fs-'));
    try {
      const s = await loadFullHeadlessAISettings(dir);
      expect(Array.isArray(s.llmProviders)).toBe(true);
      expect(Array.isArray(s.imageProviders)).toBe(true);
      expect(Array.isArray(s.ttsProviders)).toBe(true);
      expect(typeof s.defaultStylePresetId).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges user aiSettings over defaults and runs migrations', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-fs-'));
    writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
      aiSettings: {
        llmProviders: [{ id: 'l1', name: 'OpenAI', type: 'openai_compatible', baseUrl: 'https://api', apiKey: 'sk-x', models: ['gpt-4o'] }],
        defaultProviderId: 'l1',
        defaultModel: 'gpt-4o',
      },
    }));
    try {
      const s = await loadFullHeadlessAISettings(dir);
      expect(s.defaultProviderId).toBe('l1');
      expect(s.llmProviders.find((p) => p.id === 'l1')?.apiKey).toBe('sk-x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/headless-full-settings.test.ts`
Expected: FAIL（导出不存在）。

- [ ] **Step 3: 实现**

在 `electron/pipeline/headless-settings.ts` 顶部 import 追加：
```ts
import { migrateToProviders } from '../../src/lib/llm/provider-utils';
import { migrateImageProviders } from '../../src/lib/llm/migrate-image-providers';
import { normalizeTTSSettings } from '../../src/lib/tts-settings';
import { DEFAULT_JIMENG_MODEL, DEFAULT_STYLE_PRESET_ID } from '../../src/types/ai';
```

> 实现前确认 `DEFAULT_JIMENG_MODEL`、`DEFAULT_STYLE_PRESET_ID` 确实从 `src/types/ai.ts` 导出；若不在，按其真实导出位置 import。

在文件末尾新增：
```ts
/** 复制自 src/store/ai.ts buildDefaultAISettings 的默认字面量（store 不可 main 导入） */
function defaultAISettings(): AISettings {
  return {
    llmProviders: [],
    defaultProviderId: null,
    defaultModel: null,
    llmBaseUrl: '',
    llmApiKey: '',
    llmModel: '',
    enableThinking: true,
    jimengApiUrl: '',
    jimengSessionId: '',
    jimengModel: DEFAULT_JIMENG_MODEL,
    minimaxApiKey: '',
    minimaxVoiceId: 'male-qn-qingse',
    minimaxSpeed: 1.0,
    minimaxVol: 1.0,
    minimaxPitch: 0,
    minimaxEmotion: '',
    minimaxModel: 'speech-2.8-hd',
    ttsProviders: [],
    defaultTtsProviderId: null,
    defaultTtsVoiceId: null,
    ttsVoices: [],
    imageProviders: [],
    defaultImageProviderId: null,
    defaultImageModel: null,
    globalCoverImagePrompt: '',
    videoProviders: [],
    defaultVideoProviderId: null,
    defaultVideoModel: null,
    promptBindings: {},
    cardGenerationConcurrency: 2,
    defaultStylePresetId: DEFAULT_STYLE_PRESET_ID,
  } as AISettings;
}

/** 完整 AISettings（默认填充 + 迁移链 + 明文 keys），供封面/卡片/LLM 使用 */
export async function loadFullHeadlessAISettings(userDataPath: string): Promise<AISettings> {
  const file = await loadGlobalSettings(userDataPath);
  const merged = { ...defaultAISettings(), ...(file?.aiSettings ?? {}) } as AISettings;
  return normalizeTTSSettings(migrateImageProviders(migrateToProviders(merged)));
}
```

> 注：`defaultAISettings` 字面量若与当前 `src/types/ai.ts` 的 `AISettings` 必填字段有出入，按类型报错补齐（保持与 `src/store/ai.ts:173-207` 一致）。`as AISettings` 仅用于桥接可选字段；尽量不强转。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/headless-full-settings.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep headless-settings || echo "no errors in headless-settings"`
Expected: 无相关类型错误。

- [ ] **Step 6: 提交**

```bash
git add electron/pipeline/headless-settings.ts tests/headless-full-settings.test.ts
git commit -m "feat(cli): 主进程完整 AISettings 装配（默认+迁移链）"
```

---

## Task 2: 字幕分析/卡片 run + 工具

**Files:**
- Create: `electron/pipeline/runs/analyze-run.ts`
- Modify: `electron/pipeline/headless-generation.ts`、`tests/pipeline-mcp-registration.test.ts`
- Test: `tests/analyze-run.test.ts`

`runAnalyzeHeadless` 把 `analyzeSrt` 作为可注入依赖，便于不触网单测。**实现前先 READ** `electron/main.ts` 里 `ipcMain.handle('analyze-srt', …)` 处理体（约 700-761 行）作为装配蓝本——模板加载、`projectStylePresetId`、`generateCardImage`、`validateMotionSource: assertCardRenders`、`onProgress`、`telemetry` 的真实用法以它为准。

- [ ] **Step 1: 写失败测试**

```ts
// tests/analyze-run.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runAnalyzeHeadless } from '../electron/pipeline/runs/analyze-run';

function project(srt: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-an-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, createdAt: 'x', updatedAt: 'x', timeline: null,
    aiAnalysis: { analysisResult: null, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  writeFileSync(path.join(dir, 'podcast-subtitles.srt'), srt);
  return dir;
}
const userData = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'lingji-anud-'));
  writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ aiSettings: { llmProviders: [{ id: 'l1', name: 'x', type: 'openai_compatible', baseUrl: 'h', apiKey: 'k', models: ['m'] }], defaultProviderId: 'l1', defaultModel: 'm' } }));
  return d;
};
const handle = () => ({ taskId: 't', signal: new AbortController().signal, update: () => {}, log: () => {} });
const SRT = '1\n00:00:00,000 --> 00:00:02,000\n你好世界\n\n2\n00:00:02,000 --> 00:00:04,000\n再见世界\n';

describe('runAnalyzeHeadless', () => {
  it('parses SRT, runs analyzer, persists aiAnalysis to project.json', async () => {
    const dir = project(SRT);
    const ud = userData();
    try {
      const fakeResult = {
        segments: [{ id: 's1', title: '段1', summary: '', startMs: 0, endMs: 2000 }],
        cards: [{ id: 'c1', segmentId: 's1', type: 'summary', title: 't', content: '内容', startMs: 0, endMs: 2000, displayDurationMs: 2000, displayMode: 'pip', template: 'default', enabled: true, style: {} }],
        coverPrompts: ['封面提示'], summary: '总结', keywords: ['k'],
      };
      let receivedEntries = 0;
      const res = await runAnalyzeHeadless(
        { projectPath: dir, userDataPath: ud, handle: handle() as never },
        { analyze: async (entries) => { receivedEntries = entries.length; return fakeResult as never; } },
      );
      expect(receivedEntries).toBe(2);
      expect((res as any).cards.length).toBe(1);
      const saved = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf-8'));
      expect(saved.aiAnalysis.analysisResult.cards[0].id).toBe('c1');
      expect(saved.aiAnalysis.analysisResult.segments[0].id).toBe('s1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(ud, { recursive: true, force: true });
    }
  });

  it('throws no_subtitles when SRT missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-an2-'));
    const ud = userData();
    try {
      await expect(
        runAnalyzeHeadless({ projectPath: dir, userDataPath: ud, handle: handle() as never }, { analyze: async () => ({}) as never }),
      ).rejects.toMatchObject({ code: 'no_subtitles' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(ud, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/analyze-run.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 analyze-run.ts**

```ts
// electron/pipeline/runs/analyze-run.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeSrt } from '../../../src/lib/ai-analysis';
import { parseSrt } from '../../../src/lib/srt-parser';
import { createPersistedAIState } from '../../../src/lib/ai-persistence';
import { loadFullHeadlessAISettings, loadHeadlessProjectBindings } from '../headless-settings';
import { GenerationError } from '../generation-error';
import { HeadlessProjectContext } from '../context';
import { loadEffectivePromptTemplate } from '../../prompts-io';
import { loadProjectFile } from '../../project-file';
import type { GenerationRunCtx } from '../headless-generation';
import type { SrtEntry } from '../../../src/types';
import type { AISettings } from '../../../src/types/ai';
import type { AIAnalysisResult } from '../../../src/types/ai';

interface AnalyzeDeps {
  analyze?: (
    entries: SrtEntry[],
    settings: AISettings,
    options: Record<string, unknown>,
  ) => Promise<AIAnalysisResult>;
}

/** 主进程 headless：分析字幕→segments+cards→写 project.json aiAnalysis 节 */
export async function runAnalyzeHeadless(
  ctx: GenerationRunCtx,
  deps: AnalyzeDeps = {},
): Promise<AIAnalysisResult> {
  const analyze = deps.analyze ?? (analyzeSrt as never);
  const { projectPath, userDataPath, handle } = ctx;

  handle.update({ phase: '装配设置', percent: 5 });
  const settings = await loadFullHeadlessAISettings(userDataPath);
  const projectBindings = await loadHeadlessProjectBindings(projectPath);

  let srt: string;
  try {
    srt = await readFile(join(projectPath, 'podcast-subtitles.srt'), 'utf-8');
  } catch {
    throw new GenerationError('no_subtitles', '未找到 podcast-subtitles.srt，请先生成音频/字幕。');
  }
  const entries = parseSrt(srt);
  if (entries.length === 0) {
    throw new GenerationError('empty_subtitles', '字幕为空。');
  }

  // 模板与样式（mirror electron/main.ts 的 analyze-srt 处理体）
  const [planningTemplate, cardTemplate, imageTemplate, coverTemplate] = await Promise.all([
    loadEffectivePromptTemplate('planning.segment', { userDataPath, projectDir: projectPath }),
    loadEffectivePromptTemplate('cards.segment', { userDataPath, projectDir: projectPath }),
    loadEffectivePromptTemplate('cards.image', { userDataPath, projectDir: projectPath }).catch(() => undefined),
    loadEffectivePromptTemplate('cover.regeneration', { userDataPath, projectDir: projectPath }),
  ]);
  const projectStylePresetId = (await loadProjectFile(projectPath)).stylePresetId;

  handle.update({ phase: '分析与卡片', percent: 20 });
  const result = await analyze(entries, settings, {
    projectStylePresetId,
    defaultStylePresetId: settings.defaultStylePresetId,
    planningTemplate,
    cardTemplate,
    imageTemplate,
    coverTemplate,
    projectBindings,
    onProgress: (p: { phase?: string; percent?: number }) =>
      handle.update({ phase: p.phase ?? '分析', percent: Math.min(95, 20 + (p.percent ?? 0) * 0.75) }),
  });

  handle.update({ phase: '写入', percent: 96 });
  const persisted = createPersistedAIState(result, []);
  const headless = new HeadlessProjectContext(projectPath);
  const existing = (await loadProjectFile(projectPath)).aiAnalysis;
  await headless.saveSection('aiAnalysis', {
    analysisResult: persisted.analysisResult,
    coverCandidates: existing?.coverCandidates ?? [],
  });

  handle.update({ phase: '完成', percent: 100 });
  return result;
}
```

> 实现前确认（按 `electron/main.ts` 的 analyze-srt 处理体核对）：Prompt kind 字符串是否为 `'planning.segment'` / `'cards.segment'` / `'cards.image'` / `'cover.regeneration'`（spec 列出的 Prompt Kind 含 `planning.segment`/`cards.segment`/`cover.regeneration`；图片模板 kind 以源码为准，取不到则 `undefined`）。若 main 的处理体额外注入了 `generateCardImage`/`validateMotionSource`/`generateStructuredData`/`generateText`/`generateMotionSource`，**按其真实写法补到 options**（这些是 analyzeSrt 必需的 LLM 注入；缺失会导致运行期失败）。本任务测试用注入的 `analyze` 跳过了这些，但生产实现必须照搬 main 的注入，否则端到端不可用。`HeadlessProjectContext` 的构造与 `saveSection` 签名见 `electron/pipeline/context.ts`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/analyze-run.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 注册 lingji_analyze_subtitles**

在 `electron/pipeline/headless-generation.ts` 的 `registerGenerationTools` 内追加（import `runAnalyzeHeadless`）：
```ts
  registerGenerationTool(server, getMainWindow, getUserDataPath, {
    name: 'lingji_analyze_subtitles',
    title: '字幕分析+卡片生成',
    description:
      '读取 podcast-subtitles.srt，做语义分段并批量生成 AI 卡片与封面提示词，写入 project.json 的 aiAnalysis 节；返回 taskId。注意：本应用中卡片随分析一并产出（cards gen 与 subtitle analyze 等价）。',
    kind: 'analyze_subtitles',
    sections: ['aiAnalysis'],
    run: (ctx) => runAnalyzeHeadless(ctx),
  });
```
并在 `tests/pipeline-mcp-registration.test.ts` 的 expected 追加 `'lingji_analyze_subtitles'`，数量改为 `>= 11`。

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts tests/analyze-run.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add electron/pipeline/runs/analyze-run.ts electron/pipeline/headless-generation.ts tests/analyze-run.test.ts tests/pipeline-mcp-registration.test.ts
git commit -m "feat(cli): headless 字幕分析+卡片 run 与 lingji_analyze_subtitles 工具"
```

---

## Task 3: 封面 run + 工具

**Files:**
- Create: `electron/pipeline/runs/cover-run.ts`
- Modify: `electron/pipeline/headless-generation.ts`、`tests/pipeline-mcp-registration.test.ts`
- Test: `tests/cover-run.test.ts`

**实现前 READ** `electron/main.ts` 的 `regenerate-cover-prompt`（~1016-1062）与 `generate-cover-images`（~1064-1132）处理体，照搬其装配（template、style preset、binding、suffix 合并）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/cover-run.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCoverPromptHeadless, runCoverImagesHeadless } from '../electron/pipeline/runs/cover-run';

function project(withAnalysis: boolean): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-cov-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, createdAt: 'x', updatedAt: 'x', timeline: null,
    aiAnalysis: {
      analysisResult: withAnalysis
        ? { segments: [], cards: [], coverPrompts: ['旧'], summary: '', keywords: [] }
        : null,
      coverCandidates: [],
    },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  writeFileSync(path.join(dir, 'podcast-subtitles.srt'), '1\n00:00:00,000 --> 00:00:01,000\n你好\n');
  return dir;
}
const ud = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'lingji-covud-'));
  writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ aiSettings: { imageProviders: [{ id: 'i1', name: 'x', type: 'openai_image', baseUrl: 'h', apiKey: 'k', models: ['m'] }], defaultImageProviderId: 'i1', defaultImageModel: 'm' } }));
  return d;
};
const handle = () => ({ taskId: 't', signal: new AbortController().signal, update: () => {}, log: () => {} });

describe('runCoverPromptHeadless', () => {
  it('generates prompts and persists first into analysisResult.coverPrompts', async () => {
    const dir = project(true); const u = ud();
    try {
      const res = await runCoverPromptHeadless(
        { projectPath: dir, userDataPath: u, handle: handle() as never },
        { regenerate: async () => ['新封面提示词'] },
      );
      expect(res).toContain('新封面提示词');
      const saved = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf-8'));
      expect(saved.aiAnalysis.analysisResult.coverPrompts[0]).toBe('新封面提示词');
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(u, { recursive: true, force: true }); }
  });

  it('throws need_analysis when analysisResult is null', async () => {
    const dir = project(false); const u = ud();
    try {
      await expect(
        runCoverPromptHeadless({ projectPath: dir, userDataPath: u, handle: handle() as never }, { regenerate: async () => ['x'] }),
      ).rejects.toMatchObject({ code: 'need_analysis' });
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(u, { recursive: true, force: true }); }
  });
});

describe('runCoverImagesHeadless', () => {
  it('generates candidates and persists them', async () => {
    const dir = project(true); const u = ud();
    try {
      const res = await runCoverImagesHeadless(
        { projectPath: dir, userDataPath: u, handle: handle() as never },
        { generate: async () => [{ id: 'cc1', prompt: 'p', imageUrl: '/abs/cover.png', selected: true }] as never },
      );
      expect((res as any[])[0].id).toBe('cc1');
      const saved = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf-8'));
      expect(saved.aiAnalysis.coverCandidates[0].id).toBe('cc1');
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(u, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cover-run.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 cover-run.ts**

```ts
// electron/pipeline/runs/cover-run.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { regenerateCoverPrompt } from '../../../src/lib/ai-analysis';
import { generateCoverCandidates } from '../../../src/lib/cover-generation';
import { resolvePromptBinding } from '../../../src/lib/llm/binding-resolver';
import { parseSrt } from '../../../src/lib/srt-parser';
import { loadFullHeadlessAISettings, loadHeadlessProjectBindings } from '../headless-settings';
import { GenerationError } from '../generation-error';
import { HeadlessProjectContext } from '../context';
import { loadEffectivePromptTemplate } from '../../prompts-io';
import { loadProjectFile } from '../../project-file';
import type { GenerationRunCtx } from '../headless-generation';
import type { SrtEntry } from '../../../src/types';
import type { AISettings, CoverCandidate } from '../../../src/types/ai';

async function readEntries(projectPath: string): Promise<SrtEntry[]> {
  let srt: string;
  try {
    srt = await readFile(join(projectPath, 'podcast-subtitles.srt'), 'utf-8');
  } catch {
    throw new GenerationError('no_subtitles', '未找到 podcast-subtitles.srt，请先生成音频/字幕。');
  }
  return parseSrt(srt);
}

interface PromptDeps {
  regenerate?: (entries: SrtEntry[], settings: AISettings, opts: Record<string, unknown>) => Promise<string[]>;
}

/** 生成封面提示词并写入 analysisResult.coverPrompts（需已存在分析） */
export async function runCoverPromptHeadless(ctx: GenerationRunCtx, deps: PromptDeps = {}): Promise<string[]> {
  const regenerate = deps.regenerate ?? (regenerateCoverPrompt as never);
  const { projectPath, userDataPath, handle } = ctx;
  handle.update({ phase: '装配设置', percent: 10 });
  const settings = await loadFullHeadlessAISettings(userDataPath);
  const projectBindings = await loadHeadlessProjectBindings(projectPath);
  const project = await loadProjectFile(projectPath);
  const analysisResult = project.aiAnalysis?.analysisResult ?? null;
  if (!analysisResult) {
    throw new GenerationError('need_analysis', '尚无分析结果，请先运行 subtitle analyze 再生成封面提示词。');
  }
  const entries = await readEntries(projectPath);
  const coverTemplate = await loadEffectivePromptTemplate('cover.regeneration', { userDataPath, projectDir: projectPath });

  handle.update({ phase: '生成提示词', percent: 40 });
  const prompts = await regenerate(entries, settings, {
    globalPrompt: analysisResult.globalPrompt,
    projectStylePresetId: project.stylePresetId,
    defaultStylePresetId: settings.defaultStylePresetId,
    currentPrompt: analysisResult.coverPrompts?.[0],
    coverTemplate,
    projectBindings,
  });

  handle.update({ phase: '写入', percent: 90 });
  const headless = new HeadlessProjectContext(projectPath);
  await headless.saveSection('aiAnalysis', {
    analysisResult: { ...analysisResult, coverPrompts: prompts },
    coverCandidates: project.aiAnalysis?.coverCandidates ?? [],
  });
  handle.update({ phase: '完成', percent: 100 });
  return prompts;
}

interface ImagesDeps {
  generate?: (
    prompts: string[],
    imageProvider: unknown,
    imageModel: string,
    coversDir: string,
    ctx: { taskId: string; signal: AbortSignal; onProgress?: (u: unknown) => void },
  ) => Promise<CoverCandidate[]>;
}

/** 由现有 coverPrompts 出封面图并写入 coverCandidates */
export async function runCoverImagesHeadless(ctx: GenerationRunCtx, deps: ImagesDeps = {}): Promise<CoverCandidate[]> {
  const generate = deps.generate ?? (generateCoverCandidates as never);
  const { projectPath, userDataPath, handle } = ctx;
  handle.update({ phase: '装配设置', percent: 10 });
  const settings = await loadFullHeadlessAISettings(userDataPath);
  const projectBindings = await loadHeadlessProjectBindings(projectPath);
  const project = await loadProjectFile(projectPath);
  const analysisResult = project.aiAnalysis?.analysisResult ?? null;
  const prompts = analysisResult?.coverPrompts?.filter(Boolean) ?? [];
  if (prompts.length === 0) {
    throw new GenerationError('no_cover_prompts', '没有封面提示词，请先生成封面提示词。');
  }
  const binding = resolvePromptBinding('cover.regeneration', settings, projectBindings);
  if (!binding.imageProvider || !binding.imageModel) {
    throw new GenerationError('no_image_provider', '未配置封面图片 Provider/模型。');
  }
  const suffix = (settings.globalCoverImagePrompt ?? '').trim();
  const merged = suffix ? prompts.map((p) => `${p} ${suffix}`) : prompts;
  const coversDir = join(projectPath, 'covers');

  handle.update({ phase: '生成封面图', percent: 30 });
  const candidates = await generate(merged, binding.imageProvider, binding.imageModel, coversDir, {
    taskId: handle.taskId,
    signal: handle.signal,
    onProgress: (u) => handle.update({ phase: '生成封面图', percent: 30, message: JSON.stringify(u) }),
  });

  handle.update({ phase: '写入', percent: 90 });
  const headless = new HeadlessProjectContext(projectPath);
  await headless.saveSection('aiAnalysis', {
    analysisResult,
    coverCandidates: candidates,
  });
  handle.update({ phase: '完成', percent: 100 });
  return candidates;
}

/** 先提示词后出图 */
export async function runCoversHeadless(ctx: GenerationRunCtx): Promise<CoverCandidate[]> {
  await runCoverPromptHeadless(ctx);
  return runCoverImagesHeadless(ctx);
}
```

> 实现前确认：`generateCoverCandidates` 的实参顺序与 `ctx` 字段（`taskId/signal/onProgress`）以 `src/lib/cover-generation.ts` 为准；`resolvePromptBinding` 返回字段名（`imageProvider`/`imageModel`）以 `src/lib/llm/binding-resolver.ts` 为准。`main.ts` 的 generate-cover-images 处理体是最权威蓝本，照搬其 suffix 合并与 binding 守卫。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cover-run.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 注册三个封面工具**

在 `registerGenerationTools` 追加（import `runCoverPromptHeadless/runCoverImagesHeadless/runCoversHeadless`）：
```ts
  registerGenerationTool(server, getMainWindow, getUserDataPath, {
    name: 'lingji_generate_cover_prompts', title: '生成封面提示词',
    description: '基于字幕与分析结果生成封面提示词，写入 aiAnalysis.analysisResult.coverPrompts；需先完成 subtitle analyze。返回 taskId。',
    kind: 'generate_covers', sections: ['aiAnalysis'], run: (ctx) => runCoverPromptHeadless(ctx),
  });
  registerGenerationTool(server, getMainWindow, getUserDataPath, {
    name: 'lingji_generate_cover_images', title: '生成封面图',
    description: '由现有封面提示词出封面图，写入 covers/ 与 aiAnalysis.coverCandidates。返回 taskId。',
    kind: 'generate_covers', sections: ['aiAnalysis'], run: (ctx) => runCoverImagesHeadless(ctx),
  });
  registerGenerationTool(server, getMainWindow, getUserDataPath, {
    name: 'lingji_generate_covers', title: '封面提示词+出图',
    description: '一次性生成封面提示词并出图。返回 taskId。',
    kind: 'generate_covers', sections: ['aiAnalysis'], run: (ctx) => runCoversHeadless(ctx),
  });
```
> 注：三者 kind 同为 `generate_covers`，同项目同时只能跑一个（PipelineService task_conflict 语义），符合预期。

在 `tests/pipeline-mcp-registration.test.ts` 追加这三名，数量改为 `>= 14`。

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts tests/cover-run.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add electron/pipeline/runs/cover-run.ts electron/pipeline/headless-generation.ts tests/cover-run.test.ts tests/pipeline-mcp-registration.test.ts
git commit -m "feat(cli): headless 封面 run（提示词/出图/一次性）与三个工具"
```

---

## Task 4: 导出抽取 + run + 工具

**Files:**
- Create: `electron/remotion/render-video-headless.ts`、`electron/pipeline/runs/export-run.ts`
- Modify: `electron/main.ts`、`electron/pipeline/headless-generation.ts`、`tests/pipeline-mcp-registration.test.ts`
- Test: `tests/render-video-headless.test.ts`、`tests/export-run.test.ts`

**核心是无行为变更抽取。** 先 READ `electron/main.ts` 的 `ipcMain.handle('render-video', …)` 完整处理体（~2373-2464）。

- [ ] **Step 1: 抽取 renderVideoHeadless（先写源码断言测试）**

```ts
// tests/render-video-headless.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('render-video extraction', () => {
  it('renderVideoHeadless module exists and exports the function', () => {
    const src = readFileSync(new URL('../electron/remotion/render-video-headless.ts', import.meta.url), 'utf8');
    expect(src).toContain('export async function renderVideoHeadless');
    expect(src).toContain('onProgress');
  });
  it('main.ts render-video handler delegates to renderVideoHeadless', () => {
    const src = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    expect(src).toContain('renderVideoHeadless');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/render-video-headless.test.ts`
Expected: FAIL。

- [ ] **Step 3: 抽取实现**

创建 `electron/remotion/render-video-headless.ts`，把 `render-video` 处理体**逐行搬入**一个导出函数：
```ts
// electron/remotion/render-video-headless.ts
// 由 electron/main.ts 的 render-video IPC 处理体抽取；无行为变更。
import type { ExportConfig } from '../../src/lib/export-settings';
import type { SrtEntry } from '../../src/types';
// …把原处理体用到的 import（createRenderPublicDir/collectMotionCards/compileCards/
//   getRemotionBundle/renderRemotionVideo/fs/path/app/cpus 等）一并迁入或从原位置 import。

export interface RenderVideoArgs {
  timeline: string;
  outputPath: string;
  exportConfig: ExportConfig;
  srtEntries?: SrtEntry[];
}

export async function renderVideoHeadless(
  args: RenderVideoArgs,
  opts: { onProgress?: (fraction: number) => void } = {},
): Promise<{ outputPath: string }> {
  const onProgress = opts.onProgress ?? (() => {});
  // …此处为原 render-video 处理体的逐行内容，唯一改动：
  //   把三处 `mainWindow?.webContents.send('render-progress', X)` 替换为 `onProgress(X)`。
  // 末尾保持 `return { outputPath: args.outputPath };`，并保留 finally 清理 publicDir。
}
```
说明：
- `createRenderPublicDir` 当前是 `electron/main.ts` 的本地函数。若它仅被 render-video 使用，可一并迁入本模块；若被其它地方使用，则从 main 改为 `export function createRenderPublicDir` 并在此 import。优先**最小改动**：把 `createRenderPublicDir` 改为从 main 导出并在本模块 import（保持单一实现）。
- 不要改变任何渲染参数（quality 映射、concurrency 计算、bundle entry 路径、materialize 逻辑）。

然后把 `electron/main.ts` 的 `ipcMain.handle('render-video', …)` 改为薄包装：
```ts
ipcMain.handle('render-video', async (_event, args: RenderVideoArgs) => {
  return renderVideoHeadless(args, {
    onProgress: (f) => mainWindow?.webContents.send('render-progress', f),
  });
});
```
（在 main 顶部 import `renderVideoHeadless` 与 `RenderVideoArgs`。）

- [ ] **Step 4: 验证抽取无回归**

Run: `npx vitest run tests/render-video-headless.test.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "render-video|main.ts" || echo "typecheck clean"`
Expected: 源码断言 PASS；无相关类型错误。

- [ ] **Step 5: export-run + 测试**

```ts
// tests/export-run.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runExportHeadless } from '../electron/pipeline/runs/export-run';

function project(hasTimeline: boolean): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-ex-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, createdAt: 'x', updatedAt: 'x',
    timeline: hasTimeline ? { tracks: [], podcast: {} } : null,
    aiAnalysis: { analysisResult: null, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  return dir;
}
const handle = () => ({ taskId: 't', signal: new AbortController().signal, update: () => {}, log: () => {} });

describe('runExportHeadless', () => {
  it('reads timeline, calls renderer, returns outputPath', async () => {
    const dir = project(true);
    try {
      let calledWith: any = null;
      const res = await runExportHeadless(
        { projectPath: dir, userDataPath: '/ud', handle: handle() as never },
        { out: 'myout.mp4' },
        { render: async (args) => { calledWith = args; return { outputPath: args.outputPath }; } },
      );
      expect((res as any).outputPath).toBe(path.join(dir, 'myout.mp4'));
      expect(JSON.parse(calledWith.timeline)).toEqual({ tracks: [], podcast: {} });
      expect(calledWith.exportConfig.quality).toBe('balanced');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('throws no_timeline when timeline missing', async () => {
    const dir = project(false);
    try {
      await expect(
        runExportHeadless({ projectPath: dir, userDataPath: '/ud', handle: handle() as never }, {}, { render: async () => ({ outputPath: 'x' }) }),
      ).rejects.toMatchObject({ code: 'no_timeline' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

```ts
// electron/pipeline/runs/export-run.ts
import { join, isAbsolute } from 'node:path';
import { renderVideoHeadless, type RenderVideoArgs } from '../../remotion/render-video-headless';
import { loadProjectFile } from '../../project-file';
import { GenerationError } from '../generation-error';
import type { GenerationRunCtx } from '../headless-generation';

interface ExportDeps {
  render?: (args: RenderVideoArgs, opts: { onProgress?: (f: number) => void }) => Promise<{ outputPath: string }>;
}

/** 主进程 headless 导出 MP4 */
export async function runExportHeadless(
  ctx: GenerationRunCtx,
  params: { out?: string } = {},
  deps: ExportDeps = {},
): Promise<{ outputPath: string }> {
  const render = deps.render ?? renderVideoHeadless;
  const { projectPath, handle } = ctx;
  handle.update({ phase: '读取时间线', percent: 5 });
  const project = await loadProjectFile(projectPath);
  if (!project.timeline) {
    throw new GenerationError('no_timeline', '项目没有时间线，无法导出。请先完成编辑。');
  }
  const outName = params.out && params.out.trim() ? params.out.trim() : 'export.mp4';
  const outputPath = isAbsolute(outName) ? outName : join(projectPath, outName);

  handle.update({ phase: '渲染', percent: 10 });
  const result = await render(
    {
      timeline: JSON.stringify(project.timeline),
      outputPath,
      exportConfig: { resolution: '720p', quality: 'balanced' },
    },
    { onProgress: (f) => handle.update({ phase: '渲染', percent: Math.min(99, Math.round(f * 100)) }) },
  );
  handle.update({ phase: '完成', percent: 100 });
  return result;
}
```

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run tests/export-run.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 7: 注册 lingji_export_video**

`registerGenerationTool` 需支持可选 `out` 入参。在 `headless-generation.ts` 给 `GenerationToolConfig` 增加可选 `extraInput?: Record<string, z.ZodTypeAny>` 与 `run` 的第二参数透传，或为导出单独写一个带 `out` 的注册。**最小改动**：扩展 `registerGenerationTool` 的 inputSchema 合并 `config.extraInput`，并把解析出的额外参数作为 `ctx.params` 传给 run。实现：
- `GenerationRunCtx` 增加可选 `params?: Record<string, unknown>`。
- inputSchema = `{ projectPath: z.string(), ...(config.extraInput ?? {}) }`；handler 取 `{ projectPath, ...rest }`，`config.run({ projectPath, userDataPath, handle, params: rest })`。
- export 注册：
```ts
  registerGenerationTool(server, getMainWindow, getUserDataPath, {
    name: 'lingji_export_video', title: '导出 MP4',
    description: '用 Remotion 渲染时间线为 H.264 MP4，写入项目目录（可用 out 指定文件名/路径）。返回 taskId。',
    kind: 'export_video', sections: [],
    extraInput: { out: z.string().optional().describe('输出文件名或绝对路径，默认 export.mp4') },
    run: (ctx) => runExportHeadless(ctx, { out: ctx.params?.out as string | undefined }),
  });
```
> 其它 run（tts/analyze/cover）签名不变（忽略 `params`）。`runTtsHeadless(ctx)` 等照常。

在 `tests/pipeline-mcp-registration.test.ts` 追加 `'lingji_export_video'`，数量 `>= 15`。

- [ ] **Step 8: 运行确认通过**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts tests/export-run.test.ts tests/headless-generation.test.ts`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add electron/remotion/render-video-headless.ts electron/pipeline/runs/export-run.ts electron/main.ts electron/pipeline/headless-generation.ts tests/render-video-headless.test.ts tests/export-run.test.ts tests/pipeline-mcp-registration.test.ts
git commit -m "feat(cli): 抽取 renderVideoHeadless + headless 导出 run 与 lingji_export_video"
```

---

## Task 5: CLI 命令接入

**Files:**
- Create: `cli/src/commands/{subtitle,cards,cover,export}.ts`
- Modify: `cli/src/index.ts`
- Test: `tests/cli-subtitle-command.test.ts`、`tests/cli-cards-command.test.ts`、`tests/cli-cover-command.test.ts`、`tests/cli-export-command.test.ts`

各命令复用 `runGenerationCommand`（Plan 2）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-cover-command.test.ts
import { describe, it, expect } from 'vitest';
import { runCoverCommand } from '../cli/src/commands/cover';
import type { ToolCaller } from '../cli/src/client';

function fake() {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const client: ToolCaller = {
    async call(name, args) { calls.push({ name, args }); return name === 'lingji_get_active_project' ? { projectPath: '/p' } : { taskId: 'tk' }; },
    async close() {},
  };
  return { client, calls };
}

describe('runCoverCommand', () => {
  it('prompt → lingji_generate_cover_prompts', async () => {
    const { client, calls } = fake();
    await runCoverCommand('prompt', {}, client);
    expect(calls.some((c) => c.name === 'lingji_generate_cover_prompts')).toBe(true);
  });
  it('image → lingji_generate_cover_images', async () => {
    const { client, calls } = fake();
    await runCoverCommand('image', {}, client);
    expect(calls.some((c) => c.name === 'lingji_generate_cover_images')).toBe(true);
  });
  it('gen → lingji_generate_covers', async () => {
    const { client, calls } = fake();
    await runCoverCommand('gen', {}, client);
    expect(calls.some((c) => c.name === 'lingji_generate_covers')).toBe(true);
  });
  it('unknown → bad_args', async () => {
    const { client } = fake();
    await expect(runCoverCommand('frob', {}, client)).rejects.toMatchObject({ code: 'bad_args' });
  });
});
```

```ts
// tests/cli-subtitle-command.test.ts
import { describe, it, expect } from 'vitest';
import { runSubtitleCommand } from '../cli/src/commands/subtitle';
import type { ToolCaller } from '../cli/src/client';
function fake() { const calls: any[] = []; return { calls, client: { async call(n: string, a?: unknown) { calls.push({ name: n, args: a }); return n === 'lingji_get_active_project' ? { projectPath: '/p' } : { taskId: 't' }; }, async close() {} } as ToolCaller }; }
describe('runSubtitleCommand', () => {
  it('analyze → lingji_analyze_subtitles', async () => { const { client, calls } = fake(); await runSubtitleCommand('analyze', {}, client); expect(calls.some((c) => c.name === 'lingji_analyze_subtitles')).toBe(true); });
  it('unknown → bad_args', async () => { const { client } = fake(); await expect(runSubtitleCommand('x', {}, client)).rejects.toMatchObject({ code: 'bad_args' }); });
});
```

```ts
// tests/cli-cards-command.test.ts
import { describe, it, expect } from 'vitest';
import { runCardsCommand } from '../cli/src/commands/cards';
import type { ToolCaller } from '../cli/src/client';
function fake() { const calls: any[] = []; return { calls, client: { async call(n: string, a?: unknown) { calls.push({ name: n, args: a }); return n === 'lingji_get_active_project' ? { projectPath: '/p' } : { taskId: 't' }; }, async close() {} } as ToolCaller }; }
describe('runCardsCommand', () => {
  it('gen → lingji_analyze_subtitles (cards 随分析产出)', async () => { const { client, calls } = fake(); await runCardsCommand('gen', {}, client); expect(calls.some((c) => c.name === 'lingji_analyze_subtitles')).toBe(true); });
  it('unknown → bad_args', async () => { const { client } = fake(); await expect(runCardsCommand('x', {}, client)).rejects.toMatchObject({ code: 'bad_args' }); });
});
```

```ts
// tests/cli-export-command.test.ts
import { describe, it, expect } from 'vitest';
import { runExportCommand } from '../cli/src/commands/export';
import type { ToolCaller } from '../cli/src/client';
function fake() { const calls: any[] = []; return { calls, client: { async call(n: string, a?: unknown) { calls.push({ name: n, args: a }); return n === 'lingji_get_active_project' ? { projectPath: '/p' } : { taskId: 't' }; }, async close() {} } as ToolCaller }; }
describe('runExportCommand', () => {
  it('passes --out as extra arg to lingji_export_video', async () => {
    const { client, calls } = fake();
    await runExportCommand({ out: 'final.mp4' }, client);
    const call = calls.find((c) => c.name === 'lingji_export_video');
    expect(call.args).toMatchObject({ projectPath: '/p', out: 'final.mp4' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-subtitle-command.test.ts tests/cli-cards-command.test.ts tests/cli-cover-command.test.ts tests/cli-export-command.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现命令**

```ts
// cli/src/commands/subtitle.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
import { CliError } from '../errors';
export async function runSubtitleCommand(action: string | undefined, flags: Record<string, string | boolean>, client: ToolCaller): Promise<unknown> {
  if (action !== 'analyze') throw new CliError(`未知 subtitle 子命令: ${action ?? '(空)'}（支持 analyze）`, 'bad_args', 2);
  return runGenerationCommand({ toolName: 'lingji_analyze_subtitles', flags, client });
}
```

```ts
// cli/src/commands/cards.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
import { CliError } from '../errors';
// 本应用中卡片随字幕分析一并产出，cards gen 等价于 subtitle analyze。
export async function runCardsCommand(action: string | undefined, flags: Record<string, string | boolean>, client: ToolCaller): Promise<unknown> {
  if (action !== 'gen') throw new CliError(`未知 cards 子命令: ${action ?? '(空)'}（支持 gen）`, 'bad_args', 2);
  return runGenerationCommand({ toolName: 'lingji_analyze_subtitles', flags, client });
}
```

```ts
// cli/src/commands/cover.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
import { CliError } from '../errors';
const MAP: Record<string, string> = {
  prompt: 'lingji_generate_cover_prompts',
  image: 'lingji_generate_cover_images',
  gen: 'lingji_generate_covers',
};
export async function runCoverCommand(action: string | undefined, flags: Record<string, string | boolean>, client: ToolCaller): Promise<unknown> {
  const tool = action ? MAP[action] : undefined;
  if (!tool) throw new CliError(`未知 cover 子命令: ${action ?? '(空)'}（支持 prompt/image/gen）`, 'bad_args', 2);
  return runGenerationCommand({ toolName: tool, flags, client });
}
```

```ts
// cli/src/commands/export.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
export async function runExportCommand(flags: Record<string, string | boolean>, client: ToolCaller): Promise<unknown> {
  const extraArgs = typeof flags.out === 'string' ? { out: flags.out } : undefined;
  return runGenerationCommand({ toolName: 'lingji_export_video', flags, client, extraArgs });
}
```

- [ ] **Step 4: 接入 index.ts**

import 四个命令；在 dispatch 的 switch 增加：
```ts
    case 'subtitle': return runSubtitleCommand(action, flags, client);
    case 'cards': return runCardsCommand(action, flags, client);
    case 'cover': return runCoverCommand(action, flags, client);
    case 'export': return runExportCommand(flags, client);
```
`default` 文案改为 `支持 project/task/audio/subtitle/cards/cover/export`。HELP 追加：
```
  lingji subtitle analyze [--wait]            字幕分析 + 卡片生成
  lingji cards gen [--wait]                   生成 AI 卡片（同 subtitle analyze）
  lingji cover prompt|image|gen [--wait]      封面提示词 / 出图 / 一次性
  lingji export [--out <file>] [--wait]       导出 MP4
```
> `export` 不取 `action`（直接 `runExportCommand(flags, client)`），但 dispatch 仍传 `action`（被忽略）。`runExportCommand` 签名为 `(flags, client)`，注意 index 调用处用 `runExportCommand(flags, client)`。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/cli-subtitle-command.test.ts tests/cli-cards-command.test.ts tests/cli-cover-command.test.ts tests/cli-export-command.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add cli/src/commands/subtitle.ts cli/src/commands/cards.ts cli/src/commands/cover.ts cli/src/commands/export.ts cli/src/index.ts tests/cli-subtitle-command.test.ts tests/cli-cards-command.test.ts tests/cli-cover-command.test.ts tests/cli-export-command.test.ts
git commit -m "feat(cli): subtitle/cards/cover/export 命令接入"
```

---

## Task 6: 全量测试 + 构建 + 端到端手动验收

**Files:** 无（验证）

- [ ] **Step 1: 全量单测**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 2: 构建（typecheck 全链路）**

Run: `npm run build`
Expected: 成功，无类型错误。重点确认抽取后的 `render-video` 与 main 改动无回归。

- [ ] **Step 3: CLI 重建 + help**

Run: `npm run build:cli && node dist-cli/lingji.mjs help`
Expected: help 含 subtitle/cards/cover/export，退出 0。

- [ ] **Step 4: 端到端（需运行应用 + 已配置 LLM/图片 Provider + 项目含 SRT/时间线）**

```bash
node dist-cli/lingji.mjs subtitle analyze --wait     # 产出 segments+cards 到 project.json
node dist-cli/lingji.mjs cover gen --wait            # 产出 coverPrompts + covers/ 图
node dist-cli/lingji.mjs export --out out.mp4 --wait # 导出 MP4
```
Expected：各任务 succeeded；project.json/covers/out.mp4 产物出现；项目正打开时 UI 经 `pipeline:project-updated` 刷新。

- [ ] **Step 5: 错误路径**

- 无 SRT：`subtitle analyze` → `no_subtitles`。
- 无分析就 `cover prompt` → `need_analysis`。
- 无时间线 `export` → `no_timeline`。

- [ ] **Step 6: 记录验收结果**

如实记录验证通过项与跳过项（端到端依赖真实 Provider/网络，可能仅在用户环境验证）。

---

## 完成定义

- 全部单测通过；`npm run build` 通过。
- `lingji subtitle analyze` / `cards gen` / `cover prompt|image|gen` / `export` 可 headless 驱动并写产物。
- 导出为**无行为变更抽取**，原 `render-video` IPC 行为不变。
- 项目正打开时 UI 经 `pipeline:project-updated` 刷新。
- 未触碰 `useAIVideoWorkflow.ts`；未改导出渲染参数。
- 未改 `dist*`/`release`/`work` 产物；`dist-cli/` 仍忽略。

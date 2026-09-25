# 灵机 CLI Plan 2 — Headless 生成框架 + 音频(TTS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `lingji audio gen` 通过已启动应用的 MCP 服务，在主进程 headless 生成 `podcast-audio.mp3` + 字幕 SRT（fire-and-poll），并在该项目正于应用中打开时刷新 UI。

**Architecture:** 新增一个通用 headless 生成框架 `registerGenerationTool`（createTask → 后台 run → 进度 → 写盘 → 发 `pipeline:project-updated` → 返回 taskId）。首个实例是 TTS：主进程读 `script.md` + 全局 `settings.json` 的 TTS 配置，调用既有 `runTTSProvider`（无需窗口），写盘。CLI 新增 `audio gen` 命令（复用 Plan 1 的客户端/任务轮询），并加项目解析（`--project` 或活动项目）。

**Tech Stack:** TypeScript、Electron 主进程、`@modelcontextprotocol/sdk`、Vitest。复用 `electron/tts-provider-runner.ts`、`src/lib/tts-settings.ts`、`electron/pipeline`。

参考：spec `docs/superpowers/specs/2026-06-09-lingji-cli-design.md`（§2 决策、§3 数据流、§4、§9.1 Plan 2）；Plan 1 已交付的 `cli/` 与 MCP 工具。

**关键前置事实（已核实）：**
- AI/TTS 的 API Key 以**明文**存于 `<userData>/settings.json` 的 `aiSettings`，无 safeStorage，无需解密。
- `runTTSProvider({text, provider, voice, signal})`（`electron/tts-provider-runner.ts`）不依赖 BrowserWindow，返回 `{audioBuffer, audioExtension, subtitleText?, durationMs?}`。
- `resolveDefaultTTSConfig(settings)`（`src/lib/tts-settings.ts`，仅 import types）返回 `{provider, voice}`。
- `loadGlobalSettings(userDataPath)`（`electron/global-settings.ts`）读 `settings.json`。
- 生产调用 `registerPipelineMcpTools(server, getMainWindow, () => app.getPath('userData'))`（`electron/mcp/tools.ts:416`），其中 `getMainWindow: () => BrowserWindow | null` 为真窗口。
- `PipelineService.createTask(kind, projectPath, run)` 立即返回 `{taskId}`，`run(handle)` 后台执行，`handle.signal` 是 AbortSignal，`handle.update({phase,percent})` 回写进度。
- **范围限定：** 本计划 headless TTS 仅支持 `provider.type === 'minimax'`（返回 SRT+时长）。`xiaomi_mimo` 克隆音色的分块/ffmpeg 路径不在本计划，应用界面仍可用。

---

## File Structure

- `electron/pipeline/generation-error.ts`（新增）：`GenerationError`（带 code）。
- `electron/pipeline/headless-settings.ts`（新增）：主进程读取 TTS 配置 / projectBindings。
- `electron/pipeline/headless-generation.ts`（新增）：`registerGenerationTool` 框架 + `emitProjectUpdated` + `registerGenerationTools`。
- `electron/pipeline/runs/tts-run.ts`（新增）：`runTtsHeadless`（可注入 runner，便于测试）。
- `electron/pipeline/tools/register.ts`（修改）：调用 `registerGenerationTools`；2 处把 `_getMainWindow` 用起来。
- `electron/preload.ts`（修改）：新增 `onProjectUpdated` 桥。
- `src/lib/electron-api.ts`（修改）：`onProjectUpdated` 类型。
- `src/App.tsx`（修改）：抽出分段 hydrate + 订阅 `pipeline:project-updated` 重载。
- `cli/src/project-resolve.ts`（新增）：解析目标项目（`--project` 或活动项目）。
- `cli/src/commands/generation.ts`（新增）：通用「启动生成 + 可选 --wait」。
- `cli/src/commands/audio.ts`（新增）：`audio gen`。
- `cli/src/index.ts`（修改）：dispatch 增加 `audio` 组 + help 文案。
- 测试：`tests/headless-settings.test.ts`、`tests/headless-generation.test.ts`、`tests/tts-run.test.ts`、`tests/cli-project-resolve.test.ts`、`tests/cli-generation-command.test.ts`、`tests/cli-audio-command.test.ts`，并改 `tests/pipeline-mcp-registration.test.ts`、`tests/cli-endpoint-file.test.ts`（preload 源码断言可放这里或新建）。

---

## Task 1: GenerationError

**Files:**
- Create: `electron/pipeline/generation-error.ts`

无独立测试（被后续测试覆盖）。

- [ ] **Step 1: 实现**

```ts
// electron/pipeline/generation-error.ts
/** Headless 生成相关错误：带稳定错误码 */
export class GenerationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add electron/pipeline/generation-error.ts
git commit -m "feat(cli): GenerationError 主进程生成错误类型"
```

---

## Task 2: Headless TTS 配置装配

**Files:**
- Create: `electron/pipeline/headless-settings.ts`
- Test: `tests/headless-settings.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/headless-settings.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadHeadlessTTSConfig } from '../electron/pipeline/headless-settings';

function userDataWith(aiSettings: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-hs-'));
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ aiSettings }));
  return dir;
}

const MINIMAX_PROVIDER = {
  id: 'p1', name: 'MiniMax', type: 'minimax', baseUrl: 'https://api.minimax.chat',
  apiKey: 'sk-test', models: ['speech-01'],
};
const VOICE = {
  id: 'v1', name: '女声', providerId: 'p1', providerType: 'minimax', model: 'speech-01',
  voiceId: 'female-1', source: 'preset', params: {},
};

describe('loadHeadlessTTSConfig', () => {
  it('returns provider+voice from settings.json', async () => {
    const dir = userDataWith({
      ttsProviders: [MINIMAX_PROVIDER],
      ttsVoices: [VOICE],
      defaultTtsProviderId: 'p1',
      defaultTtsVoiceId: 'v1',
    });
    try {
      const cfg = await loadHeadlessTTSConfig(dir);
      expect(cfg.provider.type).toBe('minimax');
      expect(cfg.provider.apiKey).toBe('sk-test');
      expect(cfg.voice.voiceId).toBe('female-1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws no_settings when settings.json missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-hs-'));
    try {
      await expect(loadHeadlessTTSConfig(dir)).rejects.toMatchObject({ code: 'no_settings' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws no_api_key when provider key blank', async () => {
    const dir = userDataWith({
      ttsProviders: [{ ...MINIMAX_PROVIDER, apiKey: '' }],
      ttsVoices: [VOICE],
      defaultTtsProviderId: 'p1',
      defaultTtsVoiceId: 'v1',
    });
    try {
      await expect(loadHeadlessTTSConfig(dir)).rejects.toMatchObject({ code: 'no_api_key' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

> 注：若 `resolveDefaultTTSConfig`/`normalizeTTSSettings` 对 voice/provider 字段有更严格要求导致用例里的最小对象被过滤，按 `src/lib/tts-settings.ts` 与 `src/types/ai.ts` 的实际字段补齐测试夹具（保持 minimax + 非空 apiKey 的断言不变）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/headless-settings.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// electron/pipeline/headless-settings.ts
import { loadGlobalSettings } from '../global-settings';
import { resolveDefaultTTSConfig } from '../../src/lib/tts-settings';
import { readPromptBindings } from '../prompt-bindings-io';
import { GenerationError } from './generation-error';
import type { AISettings, TTSProvider, TTSVoicePreset, PromptBindingMap } from '../../src/types/ai';

/** 读取全局 AISettings（明文，含 keys）；无则返回 null */
export async function loadHeadlessAISettings(userDataPath: string): Promise<AISettings | null> {
  const file = await loadGlobalSettings(userDataPath);
  return file?.aiSettings ?? null;
}

export interface HeadlessTTSConfig {
  provider: TTSProvider;
  voice: TTSVoicePreset;
}

/** 装配默认 TTS provider+voice，缺失项抛 GenerationError */
export async function loadHeadlessTTSConfig(userDataPath: string): Promise<HeadlessTTSConfig> {
  const settings = await loadHeadlessAISettings(userDataPath);
  if (!settings) {
    throw new GenerationError('no_settings', '未找到应用设置（settings.json）。请先在应用中配置 TTS。');
  }
  const { provider, voice } = resolveDefaultTTSConfig(settings);
  if (!provider) {
    throw new GenerationError('no_tts_provider', '未配置 TTS Provider，请先在应用设置中配置。');
  }
  if (!voice) {
    throw new GenerationError('no_tts_voice', '未配置 TTS 音色，请先在应用设置中配置。');
  }
  if (!provider.apiKey?.trim()) {
    throw new GenerationError('no_api_key', 'TTS Provider 缺少 API Key，请在应用设置中填写。');
  }
  return { provider, voice };
}

/** 读取项目级 prompt 绑定 */
export async function loadHeadlessProjectBindings(projectDir: string): Promise<PromptBindingMap> {
  return readPromptBindings({ projectDir });
}
```

> 实现前确认：`src/lib/tts-settings.ts` 导出 `resolveDefaultTTSConfig`；`electron/prompt-bindings-io.ts` 导出 `readPromptBindings(ctx: { projectDir })`；`src/types/ai.ts` 导出 `AISettings/TTSProvider/TTSVoicePreset/PromptBindingMap`。若 `PromptBindingMap` 不在 `ai.ts` 而在别的模块，按实际导入路径修正。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/headless-settings.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/headless-settings.ts tests/headless-settings.test.ts
git commit -m "feat(cli): 主进程 headless 装配 TTS 配置与项目绑定"
```

---

## Task 3: Headless 生成框架

**Files:**
- Create: `electron/pipeline/headless-generation.ts`
- Test: `tests/headless-generation.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/headless-generation.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { emitProjectUpdated, registerGenerationTool } from '../electron/pipeline/headless-generation';
import { getPipelineService } from '../electron/pipeline';

class FakeMcpServer {
  tools = new Map<string, { def: unknown; handler: (args: unknown) => unknown }>();
  registerTool(name: string, def: unknown, handler: (args: unknown) => unknown): void {
    this.tools.set(name, { def, handler });
  }
}

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-hg-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, createdAt: 'x', updatedAt: 'x', timeline: null,
    aiAnalysis: { analysisResult: null, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  return dir;
}

describe('emitProjectUpdated', () => {
  it('sends pipeline:project-updated with payload', () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const win = { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } };
    emitProjectUpdated(() => win as never, '/p', ['timeline']);
    expect(sent[0].channel).toBe('pipeline:project-updated');
    expect(sent[0].payload).toEqual({ projectPath: '/p', sections: ['timeline'] });
  });

  it('is a no-op when window is null', () => {
    expect(() => emitProjectUpdated(() => null, '/p', ['timeline'])).not.toThrow();
  });
});

describe('registerGenerationTool', () => {
  it('registers the tool and returns a taskId; run executes and emits update', async () => {
    const dir = tmpProject();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const win = { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } };
    const server = new FakeMcpServer();
    let ran = false;
    registerGenerationTool(server as never, () => win as never, () => dir, {
      name: 'lingji_test_gen',
      title: 't', description: 'd', kind: 'tts', sections: ['timeline'],
      run: async () => { ran = true; return { ok: true }; },
    });
    try {
      const handler = server.tools.get('lingji_test_gen')!.handler;
      const res = (await handler({ projectPath: dir })) as { content: { text: string }[] };
      const parsed = JSON.parse(res.content[0].text);
      expect(typeof parsed.taskId).toBe('string');
      // 等待后台 run 结算
      await getPipelineService().waitForSettle(parsed.taskId);
      expect(ran).toBe(true);
      const task = getPipelineService().getTask(parsed.taskId)!;
      expect(task.status).toBe('succeeded');
      expect(task.result).toEqual({ ok: true });
      expect(sent.find((s) => s.channel === 'pipeline:project-updated')).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns structured error on invalid project path', async () => {
    const server = new FakeMcpServer();
    registerGenerationTool(server as never, () => null, () => '/tmp', {
      name: 'lingji_test_gen2', title: 't', description: 'd', kind: 'tts', sections: [],
      run: async () => ({}),
    });
    const handler = server.tools.get('lingji_test_gen2')!.handler;
    const res = (await handler({ projectPath: '/definitely/missing/xyz' })) as { content: { text: string }[]; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0].text);
    expect(typeof parsed.error).toBe('string');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/headless-generation.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// electron/pipeline/headless-generation.ts
import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPipelineService, type TaskHandle } from '.';
import type { PipelineTaskKind } from './types';
import { runTtsHeadless } from './runs/tts-run';

const PROJECT_UPDATED_CHANNEL = 'pipeline:project-updated';

export interface GenerationRunCtx {
  projectPath: string;
  userDataPath: string;
  handle: TaskHandle;
}

export interface GenerationToolConfig {
  name: string;
  title: string;
  description: string;
  kind: PipelineTaskKind;
  /** 任务完成后写回的 project 节，用于 UI 刷新信号 */
  sections: string[];
  run: (ctx: GenerationRunCtx) => Promise<unknown>;
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message: string, code?: string) {
  const payload: Record<string, unknown> = { error: message };
  if (code) payload.code = code;
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }], isError: true };
}

/** 通知渲染进程某项目的指定节已更新（若该项目正打开则刷新 UI） */
export function emitProjectUpdated(
  getMainWindow: () => BrowserWindow | null,
  projectPath: string,
  sections: string[],
): void {
  try {
    getMainWindow()?.webContents.send(PROJECT_UPDATED_CHANNEL, { projectPath, sections });
  } catch {
    // 渲染窗口可能已关闭
  }
}

/** 注册一个 headless 生成工具：createTask → 后台 run → 发刷新信号 → 返回 taskId */
export function registerGenerationTool(
  server: McpServer,
  getMainWindow: () => BrowserWindow | null,
  getUserDataPath: () => string,
  config: GenerationToolConfig,
): void {
  server.registerTool(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: { projectPath: z.string().describe('项目目录绝对路径') },
    },
    async ({ projectPath }) => {
      try {
        const userDataPath = getUserDataPath();
        const { taskId } = await getPipelineService().createTask(
          config.kind,
          projectPath,
          async (handle) => {
            const result = await config.run({ projectPath, userDataPath, handle });
            emitProjectUpdated(getMainWindow, projectPath, config.sections);
            return result;
          },
        );
        return jsonResult({ taskId, kind: config.kind });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return errorResult(e?.message ?? String(err), e?.code);
      }
    },
  );
}

/** 注册全部 headless 生成工具（本计划：音频；后续计划追加） */
export function registerGenerationTools(
  server: McpServer,
  getMainWindow: () => BrowserWindow | null,
  getUserDataPath: () => string,
): void {
  registerGenerationTool(server, getMainWindow, getUserDataPath, {
    name: 'lingji_generate_audio',
    title: '生成口播音频(TTS)',
    description:
      '读取项目 script.md，用应用已配置的 MiniMax TTS 生成 podcast-audio.mp3 与 podcast-subtitles.srt；返回 taskId（fire-and-poll）。',
    kind: 'tts',
    sections: ['timeline'],
    run: (ctx) => runTtsHeadless(ctx),
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/headless-generation.test.ts`
Expected: PASS（4 passed）。

> 注：本任务 import 了 `./runs/tts-run`（Task 4 才创建）。**先完成 Task 4 的实现文件再运行本任务测试**，或本任务实现时同时占位创建 `runs/tts-run.ts`。推荐执行顺序：Task 4 与 Task 3 的实现一起落地，再分别跑两份测试。为保持 TDD，可先写 Task 3 测试（红）、写 Task 4 测试（红）、再实现两文件、两测试转绿、分两次提交。

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/headless-generation.ts tests/headless-generation.test.ts
git commit -m "feat(cli): headless 生成框架 registerGenerationTool + 刷新信号"
```

---

## Task 4: Headless TTS run 函数

**Files:**
- Create: `electron/pipeline/runs/tts-run.ts`
- Test: `tests/tts-run.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/tts-run.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runTtsHeadless } from '../electron/pipeline/runs/tts-run';

function setup(opts: { script?: string; providerType?: string } = {}) {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'lingji-ttsud-'));
  const project = mkdtempSync(path.join(os.tmpdir(), 'lingji-ttsproj-'));
  writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    aiSettings: {
      ttsProviders: [{ id: 'p1', name: 'MiniMax', type: opts.providerType ?? 'minimax', baseUrl: 'https://api', apiKey: 'sk-x', models: ['speech-01'] }],
      ttsVoices: [{ id: 'v1', name: '女声', providerId: 'p1', providerType: opts.providerType ?? 'minimax', model: 'speech-01', voiceId: 'female-1', source: 'preset', params: {} }],
      defaultTtsProviderId: 'p1', defaultTtsVoiceId: 'v1',
    },
  }));
  if (opts.script !== undefined) writeFileSync(path.join(project, 'script.md'), opts.script);
  return { userData, project };
}

const fakeHandle = () => ({
  taskId: 't', signal: new AbortController().signal,
  update: () => {}, log: () => {},
});

describe('runTtsHeadless', () => {
  it('reads script.md, calls runner, writes audio + srt files', async () => {
    const { userData, project } = setup({ script: '你好世界。这是测试。' });
    try {
      const runner = async () => ({
        audioBuffer: Buffer.from('FAKEAUDIO'),
        audioExtension: 'mp3' as const,
        subtitleText: '1\n00:00:00,000 --> 00:00:01,000\n你好世界\n',
        durationMs: 1000,
      });
      const res = await runTtsHeadless(
        { projectPath: project, userDataPath: userData, handle: fakeHandle() as never },
        { runner },
      );
      expect(res.audioPath).toBe(path.join(project, 'podcast-audio.mp3'));
      expect(res.durationMs).toBe(1000);
      expect(existsSync(res.audioPath)).toBe(true);
      expect(readFileSync(res.audioPath).toString()).toBe('FAKEAUDIO');
      expect(existsSync(path.join(project, 'podcast-subtitles.srt'))).toBe(true);
      expect(existsSync(path.join(project, 'podcast-subtitles.original.srt'))).toBe(true);
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('throws no_script when script.md missing', async () => {
    const { userData, project } = setup({});
    try {
      await expect(
        runTtsHeadless({ projectPath: project, userDataPath: userData, handle: fakeHandle() as never }, { runner: async () => ({ audioBuffer: Buffer.from('x'), audioExtension: 'mp3' as const }) }),
      ).rejects.toMatchObject({ code: 'no_script' });
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('throws unsupported_tts for non-minimax provider', async () => {
    const { userData, project } = setup({ script: 'hi', providerType: 'xiaomi_mimo' });
    try {
      await expect(
        runTtsHeadless({ projectPath: project, userDataPath: userData, handle: fakeHandle() as never }, { runner: async () => ({ audioBuffer: Buffer.from('x'), audioExtension: 'wav' as const }) }),
      ).rejects.toMatchObject({ code: 'unsupported_tts' });
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/tts-run.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// electron/pipeline/runs/tts-run.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runTTSProvider, type TTSRunnerOptions, type TTSRunnerResult } from '../../tts-provider-runner';
import { loadHeadlessTTSConfig } from '../headless-settings';
import { GenerationError } from '../generation-error';
import type { GenerationRunCtx } from '../headless-generation';

export interface TtsRunResult {
  audioPath: string;
  srtPath: string;
  durationMs: number;
}

interface TtsRunDeps {
  runner?: (options: TTSRunnerOptions) => Promise<TTSRunnerResult>;
}

/** 主进程 headless 生成口播音频 + 字幕（仅 MiniMax）。runner 可注入用于测试。 */
export async function runTtsHeadless(
  ctx: GenerationRunCtx,
  deps: TtsRunDeps = {},
): Promise<TtsRunResult> {
  const runner = deps.runner ?? runTTSProvider;
  const { projectPath, userDataPath, handle } = ctx;

  handle.update({ phase: '装配设置', percent: 5 });
  const { provider, voice } = await loadHeadlessTTSConfig(userDataPath);
  if (provider.type !== 'minimax') {
    throw new GenerationError(
      'unsupported_tts',
      `headless TTS 当前仅支持 MiniMax provider（实际为 ${provider.type}）。请在应用界面生成克隆音色。`,
    );
  }

  let text: string;
  try {
    text = await readFile(join(projectPath, 'script.md'), 'utf-8');
  } catch {
    throw new GenerationError('no_script', '未找到 script.md，请先生成口播稿。');
  }
  if (!text.trim()) {
    throw new GenerationError('empty_script', 'script.md 为空。');
  }

  handle.update({ phase: '合成语音', percent: 20 });
  const result = await runner({ text, provider, voice, signal: handle.signal });
  if (!result.audioBuffer?.length) {
    throw new GenerationError('empty_audio', 'TTS 返回空音频。');
  }

  handle.update({ phase: '写入文件', percent: 80 });
  await mkdir(projectPath, { recursive: true });
  const audioPath = join(projectPath, `podcast-audio.${result.audioExtension}`);
  await writeFile(audioPath, result.audioBuffer);

  const durationMs =
    result.durationMs && result.durationMs > 0 ? result.durationMs : Math.max(1000, text.length * 200);
  const srtText = result.subtitleText ?? '';
  const srtPath = join(projectPath, 'podcast-subtitles.srt');
  const originalSrtPath = join(projectPath, 'podcast-subtitles.original.srt');
  await writeFile(srtPath, srtText, 'utf-8');
  await writeFile(originalSrtPath, srtText, 'utf-8');

  handle.update({ phase: '完成', percent: 100 });
  return { audioPath, srtPath, durationMs };
}
```

> 实现前确认：`electron/tts-provider-runner.ts` 导出 `runTTSProvider`、`TTSRunnerOptions`、`TTSRunnerResult`（若 `TTSRunnerOptions/TTSRunnerResult` 未 export，先在该文件加 `export` 关键字——只加 export，不改逻辑）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/tts-run.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 运行 Task 3 测试（现在 runs/tts-run 已存在）**

Run: `npx vitest run tests/headless-generation.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 6: 提交**

```bash
git add electron/pipeline/runs/tts-run.ts tests/tts-run.test.ts
git commit -m "feat(cli): headless TTS run 函数（MiniMax，写盘+SRT）"
```

---

## Task 5: 注册 lingji_generate_audio 并接入

**Files:**
- Modify: `electron/pipeline/tools/register.ts`
- Modify: `tests/pipeline-mcp-registration.test.ts`

- [ ] **Step 1: 修改注册测试期望（先红）**

在 `tests/pipeline-mcp-registration.test.ts` 的 `expected` 数组追加 `'lingji_generate_audio'`，并把数量断言改为 `toBeGreaterThanOrEqual(10)`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts`
Expected: FAIL（`lingji_generate_audio` 未注册）。

- [ ] **Step 3: 实现**

在 `electron/pipeline/tools/register.ts`：
1. 顶部 import 加入：
```ts
import { registerGenerationTools } from '../headless-generation';
```
2. 把函数签名里的 `_getMainWindow` 改名为 `getMainWindow`（去掉下划线），其类型保持 `() => BrowserWindow | null`（若当前是 `() => unknown | null`，改为 `() => import('electron').BrowserWindow | null`）。
3. 在 `registerPipelineMcpTools` 函数体末尾（最后一个 `server.registerTool(...)` 之后）加入：
```ts
  registerGenerationTools(server, getMainWindow, getUserDataPath);
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts tests/headless-generation.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/tools/register.ts tests/pipeline-mcp-registration.test.ts
git commit -m "feat(cli): 注册 lingji_generate_audio headless 工具"
```

---

## Task 6: 渲染进程刷新桥（preload + 类型）

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/lib/electron-api.ts`
- Test: `tests/project-updated-bridge.test.ts`

- [ ] **Step 1: 写失败测试（源码断言）**

```ts
// tests/project-updated-bridge.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('pipeline:project-updated bridge', () => {
  it('preload exposes onProjectUpdated for the channel', () => {
    const src = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    expect(src).toContain('onProjectUpdated');
    expect(src).toContain('pipeline:project-updated');
  });
  it('electron-api declares onProjectUpdated type', () => {
    const src = readFileSync(new URL('../src/lib/electron-api.ts', import.meta.url), 'utf8');
    expect(src).toContain('onProjectUpdated');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/project-updated-bridge.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 preload**

在 `electron/preload.ts` 的 `electronAPI` 对象里（紧邻 `onRenderProgress` 处）加入：
```ts
  onProjectUpdated: (
    callback: (payload: { projectPath: string; sections: string[] }) => void,
  ) => {
    const handler = (_event: unknown, payload: { projectPath: string; sections: string[] }) =>
      callback(payload);
    ipcRenderer.on('pipeline:project-updated', handler);
    return () => ipcRenderer.removeListener('pipeline:project-updated', handler);
  },
```

- [ ] **Step 4: 实现类型**

在 `src/lib/electron-api.ts` 的 `ElectronAPI` 接口里（紧邻 `onRenderProgress` 类型处）加入：
```ts
  onProjectUpdated: (
    callback: (payload: { projectPath: string; sections: string[] }) => void,
  ) => () => void;
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/project-updated-bridge.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 6: 提交**

```bash
git add electron/preload.ts src/lib/electron-api.ts tests/project-updated-bridge.test.ts
git commit -m "feat(cli): pipeline:project-updated 渲染进程桥与类型"
```

---

## Task 7: 渲染进程订阅刷新

**Files:**
- Modify: `src/App.tsx`

App.tsx 体量大、不便单测；本任务以「类型编译通过 + 源码断言」验证，端到端在 Task 9 手动验收。

- [ ] **Step 1: 实现**

在 `src/App.tsx` 中，找到 `openProject` 这个 `useCallback`。在它之后新增一个重载回调与订阅 effect。重用 `openProject` 内已经在作用域内使用的 store setter（`setTimeline`、`setSrtEntries`、`setAIAnalysisResult`、`setCoverCandidates`、`clearAIAnalysis`，以及 `window.electronAPI.loadProject` / `parseSrtFile`）与 `getCurrentProjectDir`（已从 `src/store/timeline.ts` 导入）。

新增：
```tsx
  // headless 任务写回 project.json 后，若该项目正在打开，则刷新对应节
  const reloadProjectSections = useCallback(
    async (projectDir: string, sections: string[]) => {
      try {
        const raw = await window.electronAPI.loadProject(projectDir);
        const projectData = JSON.parse(raw) as ProjectData;
        if (sections.includes('timeline')) {
          if (projectData.timeline) setTimeline(projectData.timeline);
          const srtPath = projectData.timeline?.podcast?.srtPath;
          if (srtPath) {
            try {
              const { entries } = await window.electronAPI.parseSrtFile(srtPath);
              setSrtEntries(entries);
            } catch {
              setSrtEntries([]);
            }
          }
        }
        if (sections.includes('aiAnalysis')) {
          if (projectData.aiAnalysis?.analysisResult) {
            setAIAnalysisResult(projectData.aiAnalysis.analysisResult);
            setCoverCandidates(projectData.aiAnalysis.coverCandidates ?? []);
          } else {
            clearAIAnalysis();
            setCoverCandidates(projectData.aiAnalysis?.coverCandidates ?? []);
          }
        }
      } catch (err) {
        console.error('[project-updated] 刷新失败:', err);
      }
    },
    [setTimeline, setSrtEntries, setAIAnalysisResult, setCoverCandidates, clearAIAnalysis],
  );

  useEffect(() => {
    if (!window.electronAPI?.onProjectUpdated) return;
    const unsubscribe = window.electronAPI.onProjectUpdated((payload) => {
      if (payload.projectPath === getCurrentProjectDir()) {
        void reloadProjectSections(payload.projectPath, payload.sections);
      }
    });
    return unsubscribe;
  }, [reloadProjectSections]);
```

> 实现注意：确认这些 setter 与 `getCurrentProjectDir`、`ProjectData` 类型在 App.tsx 当前作用域/导入中可用（`openProject` 已经用到它们）。若某个名称在 App.tsx 中以不同变量名绑定（如 `setAIAnalysisResult` 实际叫别的），按 App.tsx 里 `openProject` 使用的真实名称对齐。不要改动 `openProject` 既有逻辑。

- [ ] **Step 2: 类型检查（渲染进程编译）**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: 无与 `src/App.tsx` 改动相关的新类型错误。若该 tsconfig 不覆盖 renderer 或命令不可用，改用 `npm run build` 在 Task 9 统一验证（本步可记录跳过原因）。

- [ ] **Step 3: 提交**

```bash
git add src/App.tsx
git commit -m "feat(cli): 渲染进程订阅 project-updated 刷新已打开项目"
```

---

## Task 8: CLI 项目解析

**Files:**
- Create: `cli/src/project-resolve.ts`
- Test: `tests/cli-project-resolve.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-project-resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveProjectPath } from '../cli/src/project-resolve';
import type { ToolCaller } from '../cli/src/client';

function fake(active: string | null): ToolCaller & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(name) { calls.push(name); return { projectPath: active }; },
    async close() {},
  };
}

describe('resolveProjectPath', () => {
  it('uses --project flag without calling the server', async () => {
    const c = fake('/active');
    const p = await resolveProjectPath({ project: '/explicit' }, c);
    expect(p).toBe('/explicit');
    expect(c.calls).toEqual([]);
  });

  it('falls back to active project', async () => {
    const c = fake('/active');
    const p = await resolveProjectPath({}, c);
    expect(p).toBe('/active');
    expect(c.calls).toEqual(['lingji_get_active_project']);
  });

  it('throws no_project when no flag and no active project', async () => {
    const c = fake(null);
    await expect(resolveProjectPath({}, c)).rejects.toMatchObject({ code: 'no_project' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-project-resolve.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// cli/src/project-resolve.ts
import type { ToolCaller } from './client';
import { CliError } from './errors';

/** 解析目标项目：--project 优先，否则取应用当前活动项目 */
export async function resolveProjectPath(
  flags: Record<string, string | boolean>,
  client: ToolCaller,
): Promise<string> {
  if (typeof flags.project === 'string' && flags.project) return flags.project;
  const active = (await client.call('lingji_get_active_project')) as { projectPath?: string | null };
  if (active?.projectPath) return active.projectPath;
  throw new CliError(
    '未指定项目，且应用当前没有打开的项目。请用 --project <path> 指定。',
    'no_project',
    2,
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli-project-resolve.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add cli/src/project-resolve.ts tests/cli-project-resolve.test.ts
git commit -m "feat(cli): 项目解析（--project 或活动项目）"
```

---

## Task 9: CLI 通用生成命令 + audio gen + 入口接线

**Files:**
- Create: `cli/src/commands/generation.ts`、`cli/src/commands/audio.ts`
- Modify: `cli/src/index.ts`
- Test: `tests/cli-generation-command.test.ts`、`tests/cli-audio-command.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-generation-command.test.ts
import { describe, it, expect } from 'vitest';
import { runGenerationCommand } from '../cli/src/commands/generation';
import type { ToolCaller } from '../cli/src/client';

function fake(responder: (name: string, args?: unknown) => unknown) {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const client: ToolCaller = {
    async call(name, args) { calls.push({ name, args }); return responder(name, args); },
    async close() {},
  };
  return { client, calls };
}

describe('runGenerationCommand', () => {
  it('resolves project then starts the tool, returns taskId without --wait', async () => {
    const { client, calls } = fake((name) =>
      name === 'lingji_get_active_project' ? { projectPath: '/active' } : { taskId: 'tk1' },
    );
    const res = await runGenerationCommand({ toolName: 'lingji_generate_audio', flags: {}, client });
    expect(res).toEqual({ taskId: 'tk1' });
    expect(calls[0].name).toBe('lingji_get_active_project');
    expect(calls[1]).toEqual({ name: 'lingji_generate_audio', args: { projectPath: '/active' } });
  });

  it('with --wait polls until terminal', async () => {
    const statuses = ['running', 'succeeded'];
    let i = 0;
    const { client } = fake((name) => {
      if (name === 'lingji_generate_audio') return { taskId: 'tk2' };
      if (name === 'lingji_get_task_status') return { status: statuses[i++], progress: {} };
      return {};
    });
    const res: any = await runGenerationCommand({
      toolName: 'lingji_generate_audio',
      flags: { project: '/p', wait: true },
      client,
      sleep: async () => {},
    });
    expect(res.status).toBe('succeeded');
  });
});
```

```ts
// tests/cli-audio-command.test.ts
import { describe, it, expect } from 'vitest';
import { runAudioCommand } from '../cli/src/commands/audio';
import type { ToolCaller } from '../cli/src/client';

function fake() {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const client: ToolCaller = {
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'lingji_get_active_project') return { projectPath: '/active' };
      return { taskId: 'tk' };
    },
    async close() {},
  };
  return { client, calls };
}

describe('runAudioCommand', () => {
  it('gen → lingji_generate_audio with resolved project', async () => {
    const { client, calls } = fake();
    await runAudioCommand('gen', {}, client);
    expect(calls.some((c) => c.name === 'lingji_generate_audio' && (c.args as any).projectPath === '/active')).toBe(true);
  });

  it('unknown action throws bad_args', async () => {
    const { client } = fake();
    await expect(runAudioCommand('frob', {}, client)).rejects.toMatchObject({ code: 'bad_args' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-generation-command.test.ts tests/cli-audio-command.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 generation.ts**

```ts
// cli/src/commands/generation.ts
import type { ToolCaller } from '../client';
import { resolveProjectPath } from '../project-resolve';
import { waitForTask } from './task';

export interface GenerationCommandOptions {
  toolName: string;
  flags: Record<string, string | boolean>;
  client: ToolCaller;
  extraArgs?: Record<string, unknown>;
  sleep?: (ms: number) => Promise<void>;
}

/** 解析项目 → 启动生成任务 → 返回 taskId；--wait 时轮询至终态 */
export async function runGenerationCommand(opts: GenerationCommandOptions): Promise<unknown> {
  const projectPath = await resolveProjectPath(opts.flags, opts.client);
  const started = (await opts.client.call(opts.toolName, {
    projectPath,
    ...(opts.extraArgs ?? {}),
  })) as { taskId?: string };
  if (!started?.taskId) return started;
  if (opts.flags.wait === true) {
    return waitForTask(started.taskId, opts.client, {
      sleep: opts.sleep,
      onUpdate: (t) => {
        const task = t as { status?: string; progress?: { percent?: number; phase?: string } };
        process.stderr.write(
          `[task] ${task.status} ${task.progress?.percent ?? 0}% ${task.progress?.phase ?? ''}\n`,
        );
      },
    });
  }
  return started;
}
```

- [ ] **Step 4: 实现 audio.ts**

```ts
// cli/src/commands/audio.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
import { CliError } from '../errors';

export async function runAudioCommand(
  action: string | undefined,
  flags: Record<string, string | boolean>,
  client: ToolCaller,
): Promise<unknown> {
  if (action !== 'gen') {
    throw new CliError(`未知 audio 子命令: ${action ?? '(空)'}（支持 gen）`, 'bad_args', 2);
  }
  return runGenerationCommand({ toolName: 'lingji_generate_audio', flags, client });
}
```

- [ ] **Step 5: 接入 index.ts**

在 `cli/src/index.ts`：
1. import 加入：`import { runAudioCommand } from './commands/audio';`
2. `dispatch` 的 `switch (group)` 加入分支：
```ts
    case 'audio':
      return runAudioCommand(action, flags, client);
```
3. `default` 报错文案改为：`未知命令组: ${group}（支持 project/task/audio）`。
4. HELP 文本在 task 段后追加：
```
  lingji audio gen [--project <p>] [--wait]   生成口播音频(TTS)
```

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run tests/cli-generation-command.test.ts tests/cli-audio-command.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 7: 提交**

```bash
git add cli/src/commands/generation.ts cli/src/commands/audio.ts cli/src/index.ts tests/cli-generation-command.test.ts tests/cli-audio-command.test.ts
git commit -m "feat(cli): audio gen 命令 + 通用生成启动/轮询 + 入口接线"
```

---

## Task 10: 全量测试 + 构建 + 端到端手动验收

**Files:** 无（验证）

- [ ] **Step 1: 全量单测**

Run: `npm test`
Expected: 全绿（含本计划新增测试）。

- [ ] **Step 2: 构建（typecheck 全链路，含 App.tsx 与主进程）**

Run: `npm run build`
Expected: 构建成功，无类型错误。若 App.tsx 改动引入类型错误，回到 Task 7 修复。

- [ ] **Step 3: 重建 CLI**

Run: `npm run build:cli && node dist-cli/lingji.mjs help`
Expected: help 文本含 `audio gen`，退出 0。

- [ ] **Step 4: 端到端（需运行应用 + 已配置 MiniMax TTS + 项目含 script.md）**

```bash
npm run dev   # 另一个终端启动应用，打开一个含 script.md 且已配置 MiniMax 的项目
node dist-cli/lingji.mjs audio gen --wait
```
Expected:
- 命令返回 taskId 并轮询至 `succeeded`。
- 项目目录出现 `podcast-audio.mp3`、`podcast-subtitles.srt`、`podcast-subtitles.original.srt`。
- 若该项目正于应用中打开，时间线/音频随 `pipeline:project-updated` 刷新出现。

- [ ] **Step 5: 错误路径**

- 项目无 `script.md`：`audio gen --wait` 任务 `failed`，错误码 `no_script`。
- 未配置 TTS：错误码 `no_settings`/`no_tts_provider`/`no_api_key`。
- 不带 `--wait`：返回 `{ taskId, kind }`，`lingji task wait <id>` 可续接。

- [ ] **Step 6: 记录验收结果**

如实记录验证通过项与跳过项。

---

## 完成定义

- 全部单测通过；`npm run build` 通过。
- `lingji audio gen`（默认活动项目，可 `--project` 覆盖，可 `--wait`）能 headless 生成音频与 SRT，写入项目目录。
- 该项目正在应用中打开时，UI 经 `pipeline:project-updated` 刷新。
- 未触碰高风险的 `useAIVideoWorkflow.ts`；MiMo 克隆音色明确不在范围。
- 未改 `dist*`/`release`/`work` 产物；`dist-cli/` 仍忽略。

# 内置 pi 为唯一对话 Agent 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把对话面板收敛为唯一的内置 pi agent（无需用户安装），移除 codex / claude 面板路径，pi 复用 App 的 LLM provider 配置并预置 skill/提示词，做到开箱即用。

**Architecture:** 在现有 `electron/agent-runtime/`（CLI-spawn `RuntimeRegistry`）基础上，给 `RuntimeAgentDef` 增加「内置 Node 入口」能力：pi 不再从 PATH 解析二进制，而是用 Electron 自带 Node（`process.execPath` + `ELECTRON_RUN_AS_NODE=1`）运行打包进 `resources/pi/dist/cli.js` 的 pi 包。pi 配置目录由 App 托管（`~/.lingji/pi-agent/`，经 `PI_CODING_AGENT_DIR`），其中 `models.json` 由一个纯函数投影层从 `AISettings.llmProviders` 生成。codex/claude 面板 def 及旧 ACP 面板代码删除；`HeadlessAcpProvider`（编辑器 AI 的 LLM Provider）保持不动。

**Tech Stack:** Electron 41、TypeScript、Vitest、`@earendil-works/pi-coding-agent`（pi CLI，`--mode rpc`）。

**关联 spec：** `docs/superpowers/specs/2026-06-17-embed-pi-agent-design.md`

**本计划落定的默认决策（spec §9 的开放项）：**
1. `claude` 移除后，「写 `CLAUDE.md` MCP 引导 + 注册 MCP server」逻辑 **迁移给 pi**（Phase 6）。
2. **不改** 共享持久化类型 `LLMProvider` 的字段；pi 专属参数由投影层按 `type` 推断 + 默认补齐（Phase 1）。
3. App 托管 pi 配置目录固定为 `~/.lingji/pi-agent/`。

---

## 文件结构总览

**新增：**
- `electron/agent-runtime/pi-provider-projection.ts` —— `llmProviders` → pi `models.json` 纯投影。
- `electron/agent-runtime/bundled-runtime.ts` —— 解析 pi 内置入口 + 组装 Electron-Node spawn。
- `electron/agent-runtime/pi-config-seed.ts` —— 种子/写 pi 配置目录（settings.json/models.json）。
- `scripts/vendor-pi.cjs` —— 把固定版本 pi 包安装到 `resources/pi/`。
- `resources/pi/` —— 内置的 pi 包（vendored，git 跟踪或构建期生成，见 Phase 5）。
- `resources/pi-config/` —— pi 配置目录种子（settings.json + 提示词模板 + 系统提示词）。
- 对应 `tests/agent-runtime/pi-provider-projection.test.ts`、`tests/agent-runtime/bundled-runtime.test.ts`、`tests/agent-runtime/pi-config-seed.test.ts`。

**修改：**
- `electron/agent-runtime/types.ts` —— `RuntimeAgentDef` 增 `bundledNodeEntry`。
- `electron/agent-runtime/agent-defs/pi.ts` —— 声明 `bundledNodeEntry`。
- `electron/agent-runtime/registry.ts` —— `AGENT_DEFS` 仅留 pi。
- `electron/agent-runtime/session.ts` —— 支持内置入口 spawn。
- `electron/agent-runtime/detection.ts` —— 支持内置入口的探测与 `--list-models`。
- `electron/acp/config.ts` —— 默认 agent 改 pi、移除 codex 默认条目、归一化映射调整。
- `electron/acp/ipc.ts` —— 注入 pi 配置、provider 投影、把 MCP/CLAUDE.md 逻辑迁到 pi。
- `electron/main.ts` —— 注入 pi 入口解析依赖（保持 `HeadlessAcpProvider` 不动）。
- `scripts/package-mac.cjs`、`scripts/package-windows.cjs` —— `resources/pi` 加入 asarUnpack。
- 渲染层：`AgentPicker.tsx`、`AgentIcon.tsx`、`agent-presentation.ts`、`ChatComposer.tsx`、`AssistantMessage.tsx`、`ThinkingLevelPicker.tsx`、`settings/AgentSettingsTab.tsx`、`settings/McpSettingsTab.tsx`。

**删除（确认无引用后）：**
- `electron/agent-runtime/agent-defs/codex.ts`、`agent-defs/claude.ts`。
- `electron/agent-runtime/parsers/codex-json-event.ts`、`parsers/claude-stream.ts`。
- 旧 ACP 面板：`electron/acp/connection-registry.ts`（无 live 引用，已核实）、`agent-profiles.ts`（仅 `AgentSettingsTab` 引用，Task 13 后删）。
- 对应的孤立测试：`tests/agent-runtime/codex-json-event.test.ts`、`tests/agent-runtime/claude-stream.test.ts`、`tests/acp-connection-registry.test.ts`、`tests/agent-profiles.test.ts`。

**⚠️ 必须保留（勿删，已核实是 #2 HeadlessAcpProvider 的依赖）：**
`electron/acp/client.ts`、`electron/acp/session.ts`（被 `headless-provider.ts` import：`AcpClient`/`SessionManager`），以及 `headless-provider.ts`、`binary-manager.ts`、`fetch-agent-api-models.ts`、`preflight.ts`、`config.ts`。它们对应的测试 `tests/acp-client.test.ts`、`tests/acp-session.test.ts`、`tests/acp-headless-provider.test.ts` 也保留。

---

## Phase 0：基线快照

### Task 0：记录基线、确认绿色

**Files:** 无改动

- [ ] **Step 1: 跑全量测试，记录基线**

Run: `npm test`
Expected: 记录当前通过/失败数（应全绿）。若有失败先停下问。

- [ ] **Step 2: grep 出待删文件的全部引用，存档**

Run:
```bash
grep -rn "codex-json-event\|claude-stream\|agent-defs/codex\|agent-defs/claude\|connection-registry\|agent-profiles\|acp/client\|acp/session" electron/ src/ tests/ | grep -v node_modules
```
Expected: 把输出贴进本任务笔记，作为 Phase 4/7 删除时的核对清单。

---

## Phase 1：Provider 投影（纯函数，先行 TDD）

### Task 1：`pi-provider-projection.ts` —— 单个 provider 映射

**Files:**
- Create: `electron/agent-runtime/pi-provider-projection.ts`
- Test: `tests/agent-runtime/pi-provider-projection.test.ts`

pi `models.json` 形如：
```json
{ "providers": { "<name>": { "name", "baseUrl", "api", "apiKey", "models": [
  { "id", "name", "reasoning": bool, "input": ["text"], "contextWindow": num, "maxTokens": num,
    "cost": {"input":0,"output":0,"cacheRead":0,"cacheWrite":0},
    "compat": {"supportsDeveloperRole":bool,"supportsStore":bool,"supportsReasoningEffort":bool,"maxTokensField":"max_tokens"} }
] } } }
```
App `LLMProvider`：`{ id, name, type, baseUrl, apiKey, models: string[], enableThinking?, thinkingBudgetTokens? }`，`type ∈ 'openai_compatible'|'anthropic'|'minimax'|'gemini'|'lmstudio'|'claude_code_acp'`。

> **先验证 pi 的 `api` 取值**：已知 `openai-completions`（见真实 `~/.pi/agent/models.json`）。`anthropic-messages` / `google-generative-ai` 为本计划假设值，实现前用 `pi --list-models` 或 pi 文档/源码核对 pi 接受的 `api` 字符串；若不同，同步改 Step 1 测试断言与实现。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { llmTypeToPiApi, projectProviderToPi } from '../../electron/agent-runtime/pi-provider-projection';
import type { LLMProvider } from '../../src/types/ai';

describe('llmTypeToPiApi', () => {
  it('maps known LLM types to pi api strings', () => {
    expect(llmTypeToPiApi('openai_compatible')).toBe('openai-completions');
    expect(llmTypeToPiApi('lmstudio')).toBe('openai-completions');
    expect(llmTypeToPiApi('minimax')).toBe('openai-completions');
    expect(llmTypeToPiApi('anthropic')).toBe('anthropic-messages');
    expect(llmTypeToPiApi('gemini')).toBe('google-generative-ai');
  });
  it('returns null for claude_code_acp (not projected to pi)', () => {
    expect(llmTypeToPiApi('claude_code_acp')).toBeNull();
  });
});

describe('projectProviderToPi', () => {
  const base: LLMProvider = {
    id: 'p1', name: 'My OpenAI', type: 'openai_compatible',
    baseUrl: 'https://api.example.com/v1', apiKey: 'sk-xxx', models: ['gpt-x', 'gpt-y'],
  };
  it('projects an openai_compatible provider with full per-model schema', () => {
    const out = projectProviderToPi(base);
    expect(out).not.toBeNull();
    expect(out!.entry).toEqual({
      name: 'My OpenAI',
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-completions',
      apiKey: 'sk-xxx',
      models: [
        {
          id: 'gpt-x', name: 'gpt-x', reasoning: false, input: ['text'],
          contextWindow: 128000, maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
        },
        {
          id: 'gpt-y', name: 'gpt-y', reasoning: false, input: ['text'],
          contextWindow: 128000, maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
        },
      ],
    });
  });
  it('uses provider.id as the pi provider key', () => {
    expect(projectProviderToPi(base)!.key).toBe('p1');
  });
  it('marks reasoning:true and supportsReasoningEffort:true when enableThinking is set', () => {
    const out = projectProviderToPi({ ...base, enableThinking: true });
    expect(out!.entry.models[0].reasoning).toBe(true);
    expect(out!.entry.models[0].compat.supportsReasoningEffort).toBe(true);
  });
  it('skips claude_code_acp providers', () => {
    expect(projectProviderToPi({ ...base, type: 'claude_code_acp' })).toBeNull();
  });
  it('skips providers with empty baseUrl or no models', () => {
    expect(projectProviderToPi({ ...base, baseUrl: '' })).toBeNull();
    expect(projectProviderToPi({ ...base, models: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agent-runtime/pi-provider-projection.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// electron/agent-runtime/pi-provider-projection.ts
import type { LLMProvider } from '../../src/types/ai';

/** pi models.json 的单 provider 形状（仅取我们要写的字段）。 */
export interface PiModelEntry {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat: {
    supportsDeveloperRole: boolean;
    supportsStore: boolean;
    supportsReasoningEffort: boolean;
    maxTokensField: string;
  };
}
export interface PiProviderEntry {
  name: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  models: PiModelEntry[];
}

/** App LLMProvider.type → pi api 字符串；返回 null 表示不投影成 pi provider。 */
export function llmTypeToPiApi(type: LLMProvider['type']): string | null {
  switch (type) {
    case 'openai_compatible':
    case 'lmstudio':
    case 'minimax':
      return 'openai-completions';
    case 'anthropic':
      return 'anthropic-messages';
    case 'gemini':
      return 'google-generative-ai';
    case 'claude_code_acp':
      return null;
    default:
      return null;
  }
}

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 8192;

function toModelEntry(modelId: string, reasoning: boolean): PiModelEntry {
  return {
    id: modelId,
    name: modelId,
    reasoning,
    input: ['text'],
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: reasoning,
      maxTokensField: 'max_tokens',
    },
  };
}

/** 投影单个 provider；不可投影（类型不支持 / 缺 baseUrl / 无 model）时返回 null。 */
export function projectProviderToPi(
  provider: LLMProvider,
): { key: string; entry: PiProviderEntry } | null {
  const api = llmTypeToPiApi(provider.type);
  if (!api) return null;
  if (!provider.baseUrl.trim()) return null;
  if (!provider.models || provider.models.length === 0) return null;

  const reasoning = provider.enableThinking === true;
  return {
    key: provider.id,
    entry: {
      name: provider.name,
      baseUrl: provider.baseUrl,
      api,
      apiKey: provider.apiKey,
      models: provider.models.map((m) => toModelEntry(m, reasoning)),
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agent-runtime/pi-provider-projection.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/agent-runtime/pi-provider-projection.ts tests/agent-runtime/pi-provider-projection.test.ts
git commit -m "feat(agent-runtime): pi provider 投影（单 provider 映射）"
```

### Task 2：`buildPiModelsJson` + `buildPiSettingsJson` —— 整表投影

**Files:**
- Modify: `electron/agent-runtime/pi-provider-projection.ts`
- Test: `tests/agent-runtime/pi-provider-projection.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
import { buildPiModelsJson, buildPiSettingsJson } from '../../electron/agent-runtime/pi-provider-projection';
import type { AISettings } from '../../src/types/ai';

function settings(partial: Partial<AISettings>): AISettings {
  return { llmProviders: [], defaultProviderId: null, defaultModel: null } as unknown as AISettings;
}

describe('buildPiModelsJson', () => {
  it('builds { providers } keyed by provider id, skipping unprojectable', () => {
    const ai = {
      llmProviders: [
        { id: 'a', name: 'A', type: 'openai_compatible', baseUrl: 'https://a/v1', apiKey: 'k', models: ['m1'] },
        { id: 'b', name: 'B', type: 'claude_code_acp', baseUrl: 'https://b', apiKey: '', models: [] },
      ],
      defaultProviderId: 'a', defaultModel: 'm1',
    } as unknown as AISettings;
    const out = buildPiModelsJson(ai);
    expect(Object.keys(out.providers)).toEqual(['a']);
    expect(out.providers.a.api).toBe('openai-completions');
  });
});

describe('buildPiSettingsJson', () => {
  it('derives defaultProvider/defaultModel from AISettings', () => {
    const ai = {
      llmProviders: [{ id: 'a', name: 'A', type: 'openai_compatible', baseUrl: 'https://a/v1', apiKey: 'k', models: ['m1'] }],
      defaultProviderId: 'a', defaultModel: 'm1',
    } as unknown as AISettings;
    expect(buildPiSettingsJson(ai)).toMatchObject({ defaultProvider: 'a', defaultModel: 'm1', defaultThinkingLevel: 'medium' });
  });
  it('omits defaultProvider when none resolves', () => {
    const ai = { llmProviders: [], defaultProviderId: null, defaultModel: null } as unknown as AISettings;
    const out = buildPiSettingsJson(ai);
    expect(out.defaultProvider).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agent-runtime/pi-provider-projection.test.ts`
Expected: FAIL（`buildPiModelsJson` / `buildPiSettingsJson` 未导出）。

- [ ] **Step 3: 追加实现**

```ts
// 追加到 electron/agent-runtime/pi-provider-projection.ts 末尾
import type { AISettings } from '../../src/types/ai';

export interface PiModelsJson {
  providers: Record<string, PiProviderEntry>;
}

export function buildPiModelsJson(ai: AISettings): PiModelsJson {
  const providers: Record<string, PiProviderEntry> = {};
  for (const provider of ai.llmProviders ?? []) {
    const projected = projectProviderToPi(provider);
    if (projected) providers[projected.key] = projected.entry;
  }
  return { providers };
}

export interface PiSettingsJson {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel: string;
}

export function buildPiSettingsJson(ai: AISettings): PiSettingsJson {
  const out: PiSettingsJson = { defaultThinkingLevel: 'medium' };
  // 仅当 defaultProviderId 对应的 provider 可投影时才写入 defaultProvider
  const provider = (ai.llmProviders ?? []).find((p) => p.id === ai.defaultProviderId);
  if (provider && projectProviderToPi(provider)) {
    out.defaultProvider = provider.id;
    if (ai.defaultModel) out.defaultModel = ai.defaultModel;
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agent-runtime/pi-provider-projection.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/agent-runtime/pi-provider-projection.ts tests/agent-runtime/pi-provider-projection.test.ts
git commit -m "feat(agent-runtime): pi models.json/settings.json 整表投影"
```

---

## Phase 2：内置 Node 入口运行时

### Task 3：`bundled-runtime.ts` —— 入口解析 + spawn 组装

**Files:**
- Create: `electron/agent-runtime/bundled-runtime.ts`
- Test: `tests/agent-runtime/bundled-runtime.test.ts`

复用 `electron/runtime-binaries.ts` 的 asar.unpacked 解析思路（候选根：`app.asar.unpacked` → `resourcesPath/app.asar.unpacked` → `appPath` → `cwd`）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { resolveBundledEntry, buildBundledNodeSpawn } from '../../electron/agent-runtime/bundled-runtime';

describe('resolveBundledEntry', () => {
  it('prefers app.asar.unpacked when appPath is inside app.asar', () => {
    const existing = '/App/Contents/Resources/app.asar.unpacked/resources/pi/dist/cli.js';
    const hit = resolveBundledEntry('resources/pi/dist/cli.js', {
      appPath: '/App/Contents/Resources/app.asar',
      resourcesPath: '/App/Contents/Resources',
      cwd: '/cwd',
      existsSync: (p) => p === existing,
    });
    expect(hit).toBe(existing);
  });
  it('falls back to appPath in dev (no asar)', () => {
    const existing = '/repo/resources/pi/dist/cli.js';
    const hit = resolveBundledEntry('resources/pi/dist/cli.js', {
      appPath: '/repo', resourcesPath: '', cwd: '/repo',
      existsSync: (p) => p === existing,
    });
    expect(hit).toBe(existing);
  });
  it('returns null when nothing exists', () => {
    expect(resolveBundledEntry('resources/pi/dist/cli.js', {
      appPath: '/repo', resourcesPath: '', cwd: '/repo', existsSync: () => false,
    })).toBeNull();
  });
});

describe('buildBundledNodeSpawn', () => {
  it('runs entry via process.execPath with ELECTRON_RUN_AS_NODE=1', () => {
    const out = buildBundledNodeSpawn('/abs/cli.js', ['--mode', 'rpc'], {
      execPath: '/abs/electron', baseEnv: { PATH: '/usr/bin' },
    });
    expect(out.command).toBe('/abs/electron');
    expect(out.args).toEqual(['/abs/cli.js', '--mode', 'rpc']);
    expect(out.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(out.env.PATH).toBe('/usr/bin');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agent-runtime/bundled-runtime.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// electron/agent-runtime/bundled-runtime.ts
import { existsSync as nodeExistsSync } from 'node:fs';
import path from 'node:path';

export interface ResolveBundledEntryOptions {
  appPath: string;
  resourcesPath: string;
  cwd: string;
  existsSync?: (candidate: string) => boolean;
}

function appAsarUnpackedPath(appPath: string): string | null {
  if (!appPath.includes('app.asar')) return null;
  return appPath.replace(/app\.asar(?:[/\\].*)?$/, 'app.asar.unpacked');
}

/** 解析内置入口（相对 staged 根的路径，如 'resources/pi/dist/cli.js'）。 */
export function resolveBundledEntry(
  relPath: string,
  options: ResolveBundledEntryOptions,
): string | null {
  const has = options.existsSync ?? nodeExistsSync;
  const roots: string[] = [];
  const unpacked = appAsarUnpackedPath(options.appPath);
  if (unpacked) roots.push(unpacked);
  if (options.resourcesPath) roots.push(path.join(options.resourcesPath, 'app.asar.unpacked'));
  roots.push(options.appPath);
  roots.push(options.cwd);
  for (const root of Array.from(new Set(roots))) {
    const candidate = path.join(root, relPath);
    if (has(candidate)) return candidate;
  }
  return null;
}

export interface BuildBundledNodeSpawnOptions {
  execPath: string;
  baseEnv: NodeJS.ProcessEnv;
}
export interface BundledNodeSpawn {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** 用 Electron 自带 Node 跑一个 JS 入口（ELECTRON_RUN_AS_NODE=1）。 */
export function buildBundledNodeSpawn(
  entryPath: string,
  agentArgs: string[],
  options: BuildBundledNodeSpawnOptions,
): BundledNodeSpawn {
  return {
    command: options.execPath,
    args: [entryPath, ...agentArgs],
    env: { ...options.baseEnv, ELECTRON_RUN_AS_NODE: '1' },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agent-runtime/bundled-runtime.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/agent-runtime/bundled-runtime.ts tests/agent-runtime/bundled-runtime.test.ts
git commit -m "feat(agent-runtime): 内置 Node 入口解析与 spawn 组装"
```

### Task 4：`RuntimeAgentDef.bundledNodeEntry` 类型 + pi def 声明

**Files:**
- Modify: `electron/agent-runtime/types.ts:22-51`
- Modify: `electron/agent-runtime/agent-defs/pi.ts`

- [ ] **Step 1: 给 `RuntimeAgentDef` 增字段**

在 `types.ts` 的 `RuntimeAgentDef` 接口内（`bin: string;` 之后）追加：
```ts
  /**
   * 内置 Node 入口（相对 staged 根的路径，如 'resources/pi/dist/cli.js'）。
   * 声明后：探测/spawn/列模型不再走 PATH 二进制，而用 Electron 自带 Node 运行此入口。
   * bin 字段仍保留作为日志/兜底显示。
   */
  bundledNodeEntry?: string;
```

- [ ] **Step 2: pi def 声明内置入口**

在 `electron/agent-runtime/agent-defs/pi.ts` 的 `piAgentDef` 对象内（`bin: 'pi',` 之后）加：
```ts
  bundledNodeEntry: 'resources/pi/dist/cli.js',
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc -p tsconfig.json --noEmit` （若项目无此命令，跑 `npm run build` 的 vite 类型阶段亦可；否则 `npx vitest run tests/agent-runtime/registry.test.ts`）
Expected: 无类型错误。

- [ ] **Step 4: 提交**

```bash
git add electron/agent-runtime/types.ts electron/agent-runtime/agent-defs/pi.ts
git commit -m "feat(agent-runtime): RuntimeAgentDef 增 bundledNodeEntry，pi 声明内置入口"
```

### Task 5：session.ts 支持内置入口 spawn

**Files:**
- Modify: `electron/agent-runtime/session.ts`
- Test: `tests/agent-runtime/session.test.ts`（追加；沿用现有注入 spawnFn 模式）

session 需要一个「把 bundledNodeEntry 相对路径解析为绝对路径」的注入依赖，便于单测。

- [ ] **Step 1: 追加失败测试**

先读 `tests/agent-runtime/session.test.ts` 了解现有构造与 fake child 写法，然后追加：
```ts
it('bundled entry: spawns execPath with entry prepended and ELECTRON_RUN_AS_NODE=1', async () => {
  const calls: Array<{ cmd: string; args: string[]; opts: any }> = [];
  const fakeChild = makeFakeChild(); // 复用本测试文件已有的 fake child 工厂
  const session = new AgentSession({
    spawnFn: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return fakeChild; },
    binaryManager: { resolveBinary: async () => null, ensureNodeInPath: () => {} },
    resolveBundledEntry: () => '/abs/resources/pi/dist/cli.js',
    execPath: '/abs/electron',
  });
  await session.start({
    def: { ...piAgentDefLikeStub, bundledNodeEntry: 'resources/pi/dist/cli.js', streamFormat: 'pi-rpc' },
    prompt: 'hi', cwd: '/proj', onEvent: () => {},
  });
  expect(calls[0].cmd).toBe('/abs/electron');
  expect(calls[0].args[0]).toBe('/abs/resources/pi/dist/cli.js');
  expect(calls[0].opts.env.ELECTRON_RUN_AS_NODE).toBe('1');
});
```
> 注：`piAgentDefLikeStub` 用最小 def 桩（含 `id:'pi'`、`buildArgs: () => ['--mode','rpc']`）。若现有测试已 import 真实 `piAgentDef`，可直接用并 spread 覆盖。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agent-runtime/session.test.ts`
Expected: FAIL（`resolveBundledEntry`/`execPath` 依赖与逻辑未实现）。

- [ ] **Step 3: 实现**

在 `AgentSessionDeps`（session.ts:50-55）追加：
```ts
  /** 解析内置入口相对路径 → 绝对路径（仅 def.bundledNodeEntry 时用）。 */
  resolveBundledEntry?: (relPath: string) => string | null;
  /** Electron 自带 Node 路径（默认 process.execPath）。 */
  execPath?: string;
```
在类字段与构造函数：
```ts
  private readonly resolveBundledEntry?: (relPath: string) => string | null;
  private readonly execPath: string;
  // constructor 内：
  this.resolveBundledEntry = deps?.resolveBundledEntry;
  this.execPath = deps?.execPath ?? process.execPath;
```
顶部 import：
```ts
import { buildBundledNodeSpawn } from './bundled-runtime';
```
在 `start()` 的「1) 探测 binPath」分支前插入内置入口分支（替换原 detect 逻辑为条件分支）：
```ts
    let binPath: string;
    let extraArgs: string[] = [];
    let bundledEnv: NodeJS.ProcessEnv = {};
    if (def.bundledNodeEntry) {
      const entry = this.resolveBundledEntry?.(def.bundledNodeEntry) ?? null;
      if (!entry) {
        onEvent({ type: 'error', message: `内置 agent "${def.id}" 入口缺失（${def.bundledNodeEntry}）` });
        return;
      }
      // 内置入口：命令为 Electron Node，入口作为首参，env 注入 ELECTRON_RUN_AS_NODE
      const spawnPlan = buildBundledNodeSpawn(entry, [], { execPath: this.execPath, baseEnv: {} });
      binPath = spawnPlan.command;
      extraArgs = [entry];
      bundledEnv = { ELECTRON_RUN_AS_NODE: spawnPlan.env.ELECTRON_RUN_AS_NODE! };
    } else {
      if (!this.binaryManager) {
        onEvent({ type: 'error', message: 'AgentSession: missing binaryManager' });
        return;
      }
      const detectionDeps = createDetectionDeps(this.binaryManager);
      const detection = await detectAgent(def, detectionDeps);
      if (!detection.installed || !detection.binPath) {
        onEvent({ type: 'error', message: `Agent "${def.id}" 未安装或不可用（bin: ${def.bin}）` });
        return;
      }
      binPath = detection.binPath;
    }
```
> 删除原先无条件的 `if (!this.binaryManager)…detectAgent…const binPath = detection.binPath;` 段（session.ts:118-133），由上面的分支取代。`ensureNodeInPath` 调用保留在分支之后（对内置入口无害）。

把 `def.buildArgs(...)` 的结果与 `extraArgs` 合并；spawn 时合并 env：
```ts
    const args = [...extraArgs, ...def.buildArgs({ /* 原有参数不变 */ })];
    // …
    const env: NodeJS.ProcessEnv = {
      ...getCleanEnv(),
      ...bundledEnv,
      ...(def.env ?? {}),
      ...(input.env ?? {}),
    };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agent-runtime/session.test.ts`
Expected: PASS（含原有用例）。

- [ ] **Step 5: 提交**

```bash
git add electron/agent-runtime/session.ts tests/agent-runtime/session.test.ts
git commit -m "feat(agent-runtime): session 支持内置 Node 入口 spawn"
```

### Task 6：detection.ts —— 内置入口的 `--list-models`

**Files:**
- Modify: `electron/agent-runtime/detection.ts`
- Test: `tests/agent-runtime/list-agent-models.test.ts`（追加）

`listAgentModels` 当前用 `bm.resolveBinary(def.bin)` 找 pi。内置入口下要改为：解析入口绝对路径，用 `process.execPath`（带 `ELECTRON_RUN_AS_NODE=1`）跑 `[entry, ...def.listModelsArgs]`。

- [ ] **Step 1: 追加失败测试**

参考现有用例风格，注入一个 fake exec：
```ts
it('bundled entry: lists models via execPath + entry, parses stderr', async () => {
  const fakeExec = async (cmd: string, args: string[]) => {
    expect(cmd).toBe('/abs/electron');
    expect(args[0]).toBe('/abs/cli.js');
    return { stdout: '', stderr: 'provider model\nanthropic claude-x' };
  };
  const result = await listAgentModels(
    { resolveBinary: async () => null },
    { ...piDefStub, bundledNodeEntry: 'resources/pi/dist/cli.js' },
    { resolveBundledEntry: () => '/abs/cli.js', execPath: '/abs/electron', execFileAsync: fakeExec },
  );
  expect(result.source).toBe('live');
  expect(result.models.some((m) => m.id === 'anthropic/claude-x')).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agent-runtime/list-agent-models.test.ts`
Expected: FAIL（`listAgentModels` 第三参未支持）。

- [ ] **Step 3: 实现**

给 `listAgentModels` 增加可选第三参（保持向后兼容，旧调用不传时行为不变）：
```ts
export interface ListModelsBundledDeps {
  resolveBundledEntry?: (relPath: string) => string | null;
  execPath?: string;
  execFileAsync?: (cmd: string, args: string[], opts?: any) => Promise<{ stdout: unknown; stderr: unknown }>;
}

export async function listAgentModels(
  bm: BinaryManagerLike,
  def: RuntimeAgentDef,
  bundled?: ListModelsBundledDeps,
): Promise<ModelListResult> {
  // …fallback 同前…
  if (!def.listModelsArgs || !def.parseModels) return fallback;

  const exec = bundled?.execFileAsync ?? execFileAsync;
  let command: string;
  let args: string[];
  let env = modelExecEnv();

  if (def.bundledNodeEntry) {
    const entry = bundled?.resolveBundledEntry?.(def.bundledNodeEntry) ?? null;
    if (!entry) return fallback;
    command = bundled?.execPath ?? process.execPath;
    args = [entry, ...def.listModelsArgs];
    env = { ...env, ELECTRON_RUN_AS_NODE: '1' };
  } else {
    let binPath: string | null = null;
    for (const candidate of [def.bin, ...(def.fallbackBins ?? [])]) {
      const resolved = await bm.resolveBinary(candidate);
      if (resolved) { binPath = resolved; break; }
    }
    if (!binPath) return fallback;
    command = binPath;
    args = def.listModelsArgs;
  }

  // tryParse 同前；execFileAsync 调用改用 command/args/env
  try {
    const result = await exec(command, args, { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env });
    const parsed = tryParse(result);
    return parsed ? { models: parsed, source: 'live' } : fallback;
  } catch (err) {
    const parsed = tryParse(err as { stdout?: unknown; stderr?: unknown });
    return parsed ? { models: parsed, source: 'live' } : fallback;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agent-runtime/list-agent-models.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/agent-runtime/detection.ts tests/agent-runtime/list-agent-models.test.ts
git commit -m "feat(agent-runtime): listAgentModels 支持内置 Node 入口"
```

---

## Phase 3：pi 配置目录种子与写入

### Task 7：`pi-config-seed.ts` —— 写 settings.json / models.json

**Files:**
- Create: `electron/agent-runtime/pi-config-seed.ts`
- Test: `tests/agent-runtime/pi-config-seed.test.ts`

职责：给定 pi 配置目录 + `AISettings`，写出 `settings.json`、`models.json`（用 Phase 1 投影）。纯 I/O 包一层，注入 `fs` 便于测试。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writePiConfig } from '../../electron/agent-runtime/pi-config-seed';

describe('writePiConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `pi-cfg-${Math.random().toString(36).slice(2)}`);
  });
  it('writes models.json and settings.json from AISettings', async () => {
    const ai = {
      llmProviders: [{ id: 'a', name: 'A', type: 'openai_compatible', baseUrl: 'https://a/v1', apiKey: 'k', models: ['m1'] }],
      defaultProviderId: 'a', defaultModel: 'm1',
    } as any;
    await writePiConfig(dir, ai);
    const models = JSON.parse(await fs.readFile(path.join(dir, 'models.json'), 'utf-8'));
    const settings = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf-8'));
    expect(models.providers.a.api).toBe('openai-completions');
    expect(settings.defaultProvider).toBe('a');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agent-runtime/pi-config-seed.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// electron/agent-runtime/pi-config-seed.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AISettings } from '../../src/types/ai';
import { buildPiModelsJson, buildPiSettingsJson } from './pi-provider-projection';

/** 把 App AISettings 投影并写入 pi 配置目录（settings.json + models.json）。 */
export async function writePiConfig(configDir: string, ai: AISettings): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'models.json'),
    JSON.stringify(buildPiModelsJson(ai), null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(configDir, 'settings.json'),
    JSON.stringify(buildPiSettingsJson(ai), null, 2),
    'utf-8',
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agent-runtime/pi-config-seed.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/agent-runtime/pi-config-seed.ts tests/agent-runtime/pi-config-seed.test.ts
git commit -m "feat(agent-runtime): pi 配置目录写入（models/settings 投影落盘）"
```

### Task 8：种子目录 `resources/pi-config/`（系统提示词 + 提示词模板）

**Files:**
- Create: `resources/pi-config/system-prompt.md`
- Create: `resources/pi-config/prompt-templates/lingji.md`（示例模板）

- [ ] **Step 1: 写系统提示词（适配视频剪辑 + lingji_* MCP）**

`resources/pi-config/system-prompt.md`：写明 pi 处于灵机剪影视频脚本编辑器内、必须用 `lingji_*` MCP 工具操作脚本（复用 `electron/acp/ipc.ts` 中 `MCP_INSTRUCTIONS` 的要点，提炼为 system prompt 文风）。内容自包含，至少覆盖：写稿 / 审稿 / 修改三个场景的工具与禁用内置 Read/Write。

- [ ] **Step 2: 写示例 prompt-template**

`resources/pi-config/prompt-templates/lingji.md`：一个口播稿写作模板占位（标题、要点、风格），供 `--prompt-template` 加载。

- [ ] **Step 3: 提交**

```bash
git add resources/pi-config
git commit -m "feat(pi-config): pi 系统提示词与提示词模板种子（视频剪辑适配）"
```

---

## Phase 4：移除 codex / claude 面板 def 与旧 ACP

### Task 9：registry 仅留 pi，删除 codex/claude def 与 parser

**Files:**
- Modify: `electron/agent-runtime/registry.ts`
- Modify: `electron/agent-runtime/session.ts`（移除 claude/codex parser 分支）
- Modify: `electron/agent-runtime/types.ts`（`StreamFormat` 收敛为 `'pi-rpc'`）
- Delete: `agent-defs/codex.ts`、`agent-defs/claude.ts`、`parsers/codex-json-event.ts`、`parsers/claude-stream.ts`

- [ ] **Step 1: registry 只留 pi**

`registry.ts` 改为：
```ts
import type { RuntimeAgentDef } from './types';
import { piAgentDef } from './agent-defs/pi';

export const AGENT_DEFS: RuntimeAgentDef[] = [piAgentDef];

(function validateUniqueness() {
  const seen = new Set<string>();
  for (const def of AGENT_DEFS) {
    if (seen.has(def.id)) throw new Error(`Duplicate agent def id: "${def.id}"`);
    seen.add(def.id);
  }
})();

export function getAgentDef(id: string): RuntimeAgentDef | null {
  return AGENT_DEFS.find((def) => def.id === id) ?? null;
}
export function listAgentDefs(): RuntimeAgentDef[] {
  return AGENT_DEFS;
}
```

- [ ] **Step 2: session.ts 移除 claude/codex parser 分支**

删除 `case 'claude-stream-json'` 与 `case 'codex-json-event'` 两个分支及其 import（`createClaudeStreamParser`、`createCodexParser`）。`switch` 只剩 `case 'pi-rpc'` 与 `default`。`needsStdin`（session.ts:154）简化为 `def.streamFormat === 'pi-rpc'`。

- [ ] **Step 3: types.ts 收敛 StreamFormat**

```ts
export type StreamFormat = 'pi-rpc';
```

- [ ] **Step 4: 删除文件**

```bash
git rm electron/agent-runtime/agent-defs/codex.ts electron/agent-runtime/agent-defs/claude.ts electron/agent-runtime/parsers/codex-json-event.ts electron/agent-runtime/parsers/claude-stream.ts
```

- [ ] **Step 5: 跑相关测试**

Run: `npx vitest run tests/agent-runtime/registry.test.ts tests/agent-runtime/session.test.ts`
Expected: 这些测试此时可能 FAIL（仍引用 codex/claude）——下一步修测试。先确认是「引用已删 def」类失败而非逻辑错。

- [ ] **Step 6: 更新这些测试，去掉 codex/claude 断言，只验 pi**

编辑 `tests/agent-runtime/registry.test.ts`：把对 `AGENT_DEFS` 含 codex/claude 的断言改为「仅含 pi、长度 1」。`session.test.ts` 删除 claude/codex parser 相关用例。

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run tests/agent-runtime/`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add electron/agent-runtime tests/agent-runtime
git commit -m "refactor(agent-runtime): 面板仅保留 pi，移除 codex/claude def 与 parser"
```

### Task 10：删除旧 ACP 面板死代码（仅 connection-registry）

> **已核实：** `acp/client.ts` 与 `acp/session.ts` 被 `headless-provider.ts`（#2，保留）import，**不能删**。本任务只删 `connection-registry.ts` 及其测试。`agent-profiles.ts` 留到 Task 13（仅 `AgentSettingsTab` 引用）。

**Files:**
- Delete：`electron/acp/connection-registry.ts`、`tests/acp-connection-registry.test.ts`

- [ ] **Step 1: 再次确认 connection-registry 无 live 引用**

Run:
```bash
grep -rn "connection-registry\|ConnectionRegistry" electron/ src/ | grep -v node_modules | grep -v "connection-registry.ts:"
```
Expected: 仅注释引用（如 `runtime-registry.ts` 顶部注释「取代旧 connection-registry」），无 `import`。若出现真实 import，**停止并上报**。

- [ ] **Step 2: 删除文件与其测试**

```bash
git rm electron/acp/connection-registry.ts tests/acp-connection-registry.test.ts
```

- [ ] **Step 3: 构建/测试检查**

Run: `npx vitest run`
Expected: 无「找不到模块」错误，套件通过（`acp-client.test.ts`/`acp-session.test.ts` 仍应存在并通过）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore(acp): 删除已废弃的 connection-registry（client/session 保留给 headless-provider）"
```

---

## Phase 5：渲染层与设置页

### Task 11：agent-presentation / AgentIcon —— 去 codex/claude 分支

**Files:**
- Modify: `src/lib/agent-presentation.ts`
- Modify: `src/components/agent/AgentIcon.tsx`

- [ ] **Step 1: 读这两个文件，定位 codex/claude 分支**

Run: `grep -n "codex\|claude\|Codex\|Claude" src/lib/agent-presentation.ts src/components/agent/AgentIcon.tsx`

- [ ] **Step 2: 移除 codex/claude，保留 pi**

删除 codex/claude 的 icon / label / 颜色映射；若有 `agentType` 联合类型，收敛为 `'pi'`。保留 pi 分支为默认。

- [ ] **Step 3: 跑相关组件测试**

Run: `npx vitest run tests/assistant-message.test.tsx`
Expected: 可能需配合 Task 12 一起过。

- [ ] **Step 4: 提交**

```bash
git add src/lib/agent-presentation.ts src/components/agent/AgentIcon.tsx
git commit -m "refactor(agent-ui): agent 呈现层收敛为 pi"
```

### Task 12：AgentPicker / ChatComposer / AssistantMessage / ThinkingLevelPicker

**Files:**
- Modify: `src/components/agent/AgentPicker.tsx`、`ChatComposer.tsx`、`AssistantMessage.tsx`、`ThinkingLevelPicker.tsx`

- [ ] **Step 1: AgentPicker 收敛为 pi 单一**

若只剩一个 agent，隐藏选择器或固定显示 "Pi"。移除 codex/claude 选项与相关分支。

- [ ] **Step 2: 其余三处去 codex/claude 分支**

`ChatComposer`/`AssistantMessage`/`ThinkingLevelPicker` 中按 agentType 分流的 codex/claude 代码删除，保留 pi 路径。`ThinkingLevelPicker` 使用 `piAgentDef.reasoningOptions`。

- [ ] **Step 3: 更新对应测试**

编辑 `tests/tool-call-block.test.tsx`、`tests/tool-group-block.test.tsx`、`tests/assistant-message.test.tsx`、`tests/tool-call-descriptor.test.ts`：移除/改写 codex/claude 专属断言，只保留 pi 场景。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/tool-call-block.test.tsx tests/tool-group-block.test.tsx tests/assistant-message.test.tsx tests/tool-call-descriptor.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/agent tests
git commit -m "refactor(agent-ui): 对话面板收敛为单一 pi agent"
```

### Task 13：AgentSettingsTab / McpSettingsTab

**Files:**
- Modify: `src/components/settings/AgentSettingsTab.tsx`
- Modify: `src/components/settings/McpSettingsTab.tsx`

- [ ] **Step 1: AgentSettingsTab 去 agent-profiles 依赖**

移除对 `electron/acp/agent-profiles`（或经 electron-api 暴露的 profiles）的 import 与 codex/claude 表单分区；围绕 pi（模型 / thinking / skills）重构。**保留** ACP-LLM-Provider（#2，`claude_code_acp`）相关设置（它属于 AI Provider 设置，不在此 tab 删）。

- [ ] **Step 2: McpSettingsTab 去 codex 注册目标**

移除 codex 的 MCP 注册选项；保留 claude_code（#2）与其它（Gemini 等）。

- [ ] **Step 3: 现在可安全删除 agent-profiles.ts**

确认本任务 Step 1 已移除 `AgentSettingsTab` 对 `agent-profiles` 的 import（已核实 `preflight.ts`/`config.ts` 不依赖它）后：
```bash
git rm electron/acp/agent-profiles.ts tests/agent-profiles.test.ts
```

- [ ] **Step 4: 构建检查**

Run: `npm run build`
Expected: 无类型/模块错误。

- [ ] **Step 5: 提交**

```bash
git add -A src/components/settings electron/acp
git commit -m "refactor(settings): Agent/MCP 设置收敛为 pi，移除 agent-profiles"
```

---

## Phase 6：IPC 接线（配置注入 + MCP/CLAUDE.md 迁移给 pi）

### Task 14：config.ts 默认 agent 改 pi

**Files:**
- Modify: `electron/acp/config.ts`

- [ ] **Step 1: 改默认与归一化**

- `DEFAULT_AGENT_ID` 由 `'claude'` 改为 `'pi'`（config.ts:8）。
- `normalizeAgentId`：未知/旧值统一回退 `'pi'`（把两处 `return 'claude'` 改 `'pi'`；`LEGACY_ID_MAP` 中 `'claude-acp' → 'pi'`、`'codex' → 'pi'`、保留 `'pi-acp' → 'pi'`，使旧会话不致解析到已删 def）。
- `ensureDefaultAgents`：移除 `codex`/`claude` 默认条目，只保留 `pi`（删除 `CLAUDE_DEFAULT_ENTRY`/`CODEX_DEFAULT_ENTRY`，返回对象只含 `pi`）。

- [ ] **Step 2: 更新 config 相关测试（若有）**

Run: `grep -rln "DEFAULT_AGENT_ID\|ensureDefaultAgents\|normalizeAgentId" tests/`
对命中的测试更新断言为 pi-only。

- [ ] **Step 3: 跑测试**

Run: `npx vitest run tests/`（先跑相关，再全量）
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add electron/acp/config.ts tests
git commit -m "refactor(agent-config): 默认 agent 改为 pi，移除 codex/claude 默认条目"
```

### Task 15：ipc.ts —— 注入内置入口依赖 + provider 投影写盘（pi 走 file-first，**不**接 MCP）

> **⚠️ 重大修正（已核实）：** pi **完全没有 MCP 支持**（dist 零 MCP 引用；扩展机制是 skills/extensions/内置 read·edit·write 工具）。`McpConfigManager` 只支持 `claude_code|codex|gemini`，无 pi 目标。因此 **不要** 把 `MCP_INSTRUCTIONS`/`registerToApp('claude_code')` 迁给 pi——pi 用 **file-first**：直接编辑 `script.md`/`original.md`/`project.json`，靠 `ensureProjectAgentContracts`（已对所有 agent 无条件写入 CLAUDE.md/AGENTS.md 的 file-first 契约块）作为接口。`lingji-editor` MCP server 仍保留给外部 agent（不动）。原 in-app claude agent 的 `if (agentId === 'claude') {…MCP…}` 块现在是死代码，删除即可。

**Files:**
- Modify: `electron/acp/ipc.ts`

- [ ] **Step 1: RuntimeRegistry 注入内置入口依赖**

读 `runtime-registry.ts`：默认 `createSession = () => new AgentSession({ binaryManager })`。在 `acp/ipc.ts` 构造 `runtimeRegistry` 处，改为传入自定义 `createSession`，注入 `resolveBundledEntry` 与 `execPath`：
```ts
import { app } from 'electron';
import { AgentSession } from '../agent-runtime/session';
import { resolveBundledEntry } from '../agent-runtime/bundled-runtime';
// …
const runtimeRegistry = new RuntimeRegistry({
  binaryManager,
  createSession: () =>
    new AgentSession({
      binaryManager,
      execPath: process.execPath,
      resolveBundledEntry: (rel) =>
        resolveBundledEntry(rel, {
          appPath: app.getAppPath(),
          resourcesPath: process.resourcesPath,
          cwd: process.cwd(),
        }),
    }),
});
```

- [ ] **Step 2: connect 前写 pi 配置 + 设 PI_CODING_AGENT_DIR env**

在 `connectRuntime`（ipc.ts）内，agentId==='pi' 时（现在只有 pi）：
```ts
import os from 'node:os';
import path from 'node:path';
import { writePiConfig } from '../agent-runtime/pi-config-seed';
import { loadFullHeadlessAISettings } from '../pipeline/headless-settings';
// …
const PI_CONFIG_DIR = path.join(os.homedir(), '.lingji', 'pi-agent');
const ai = await loadFullHeadlessAISettings(app.getPath('userData')); // 明文含 keys + 迁移链
await writePiConfig(PI_CONFIG_DIR, ai);
env.PI_CODING_AGENT_DIR = PI_CONFIG_DIR;
```
（`loadFullHeadlessAISettings` 已存在于 `electron/pipeline/headless-settings.ts`，读全局 AISettings，无需新增持久化或改 connect payload。容错：读取失败时 try/catch，仍写一个 `{ providers: {} }` 的空配置，不阻断连接。）

- [ ] **Step 3: 种子静态配置到 pi 配置目录（prompt-templates 自动发现）**

把 `resources/pi-config/prompt-templates/` 复制进 `PI_CONFIG_DIR/prompt-templates/`（pi 默认从配置目录发现 prompt-templates，除非 `--no-prompt-templates`）。复用 `electron/agent-skills/bundled.ts` 的递归复制（兼容 asar 只读源）或简单 `fs.cp`。系统提示词 `system-prompt.md`：file-first 的领域上下文已由项目 CLAUDE.md/AGENTS.md（`ensureProjectAgentContracts`）提供给 pi（pi 默认读 context files），**本任务不强制 wire `--append-system-prompt`**；如低成本可顺带把它经 `piAgentDef.buildArgs` 注入（需给 `BuildArgsCtx` 加可选 `appendSystemPromptPaths?` 并在 runtime-registry connect→sendPrompt 透传），否则留作后续。优先保证 prompt-templates 种子 + provider 投影可用。

- [ ] **Step 4: 删除 in-app claude 的 MCP/CLAUDE.md 死代码**

`connectRuntime` 里 `if (agentId === 'claude') { const mcpConfigMgr…registerToApp('claude_code')…await ensureProjectClaudeMd(payload.projectDir); }` 是已删除的 in-app claude agent 的逻辑——删除整个分支。**保留** 紧随其后的 `await ensureProjectAgentContracts(payload.projectDir);`（file-first，所有 agent 通用，pi 靠它）。`ensureProjectClaudeMd` 函数与 `MCP_INSTRUCTIONS` 常量若不再被引用，一并删除（grep 确认）。`getMcpServerStatus`/`McpConfigManager` import 若因此变为未使用，移除该 import；但**不要**改动 `electron/main.ts` 里 `HeadlessAcpProvider`/MCP server 本身（外部 agent 仍用）。

- [ ] **Step 5: 清理 ipc.ts 内残留的 `'claude'` 字面量默认**

`runPreflight(binaryManager, config, agentId ?? 'claude')`（`agent:run-preflight`）与 `normalizeAgentId(agentId ?? 'claude')`（`agent:list-models`、`agent:list-skills`）里的 `'claude'` 默认 → 改 `'pi'`。

- [ ] **Step 6: list-models handler 传内置入口依赖**

`agent:list-models` 调 `listAgentModels(binaryManager, def)` → 改为传第三参 bundled deps，使 pi 真能拉实时模型：
```ts
return listAgentModels(binaryManager, def, {
  resolveBundledEntry: (rel) =>
    resolveBundledEntry(rel, { appPath: app.getAppPath(), resourcesPath: process.resourcesPath, cwd: process.cwd() }),
  execPath: process.execPath,
});
```
（注意保留 claude 自定义 API 分支已随 claude 移除而失效——该 `if (id === 'claude')` 块可删，因 normalizeAgentId 不再产出 claude；如仍在则清理。）

- [ ] **Step 7: 全量构建 + 测试**

Run: `npm run build && npm test`
Expected: 构建通过、测试全绿。若 ipc.ts 无直接单测，确保删除/改动不破坏现有 `tests/acp-*`、`tests/agent-runtime/*`。

- [ ] **Step 8: 提交**

```bash
git add electron/acp/ipc.ts electron/agent-runtime
git commit -m "feat(agent): pi 连接注入内置入口/配置投影，移除已废弃 claude MCP 逻辑（pi 走 file-first）"
```

---

## Phase 7：内置 pi 包与打包

### Task 16：`scripts/vendor-pi.cjs` —— 安装 pi 到 resources/pi

**Files:**
- Create: `scripts/vendor-pi.cjs`
- Modify: `package.json`（加 `vendor:pi` 脚本；`build` 前置或文档说明）

- [ ] **Step 1: 写 vendor 脚本**

`scripts/vendor-pi.cjs`：在临时目录 `npm install @earendil-works/pi-coding-agent@0.79.1`（固定版本），把其安装结果（含 `dist/` 与运行时 `node_modules/`）复制到 `resources/pi/`；裁剪非目标平台的原生预编译（`**/prebuilds/<非当前平台>`、`@mariozechner/clipboard-*` 仅留当前平台）。脚本打印最终体积。

- [ ] **Step 2: 跑脚本生成 resources/pi**

Run: `node scripts/vendor-pi.cjs`
Expected: `resources/pi/dist/cli.js` 存在；打印体积。

- [ ] **Step 3: 验证内置 pi 在 Electron Node 下能 `--mode rpc`**

Run（dev 验证）：`ELECTRON_RUN_AS_NODE=1 node resources/pi/dist/cli.js --version`
Expected: 打印 0.79.1。再手动 `--list-models` 验证 stderr 表格输出。
> 若 `--mode rpc` 启动时报缺原生 TUI 模块，回到 Step 1 不裁剪 `@earendil-works/pi-tui` 的当前平台预编译。

- [ ] **Step 4: 决定 resources/pi 是否入库**

体积可控（裁剪后）则 `git add resources/pi` 入库；过大则在 CI/打包前跑 `vendor:pi`（在 `dist:mac`/`dist:win` 脚本前串联），并把 `resources/pi` 加入 `.gitignore`。**本计划默认入库**（保证可复现 + 离线打包）。

- [ ] **Step 5: 提交**

```bash
git add scripts/vendor-pi.cjs package.json resources/pi
git commit -m "build(pi): vendor 固定版本 pi 到 resources/pi"
```

### Task 17：打包 asarUnpack `resources/pi`

**Files:**
- Modify: `scripts/package-mac.cjs:165-167`
- Modify: `scripts/package-windows.cjs`（对应 asar unpack 配置）

- [ ] **Step 1: mac unpackDir 加 resources/pi**

`scripts/package-mac-helpers.cjs` 的 `RENDER_RUNTIME_ASAR_UNPACK_DIRS` 末尾在花括号集合里加入 `resources/pi`（与 `vendor/ffmpeg` 等并列），使 pi 的 `dist/cli.js` 与原生 `.node` 落到 `app.asar.unpacked/resources/pi`，可被 `process.execPath` 运行、可 `require` 原生模块。

- [ ] **Step 2: windows 同步**

在 `scripts/package-windows.cjs` 找到对应 asar unpack 配置，加入 `resources/pi`。

- [ ] **Step 3: 打包冒烟（mac）**

Run: `npm run dist:mac`
Expected: 打包成功；产物中 `app.asar.unpacked/resources/pi/dist/cli.js` 存在。
> 因签名/公证环境差异，若 `dist:mac` 在本机不可全过，至少跑到 asar 阶段确认 unpack 生效；记录实际跑到哪一步。

- [ ] **Step 4: 提交**

```bash
git add scripts/package-mac.cjs scripts/package-mac-helpers.cjs scripts/package-windows.cjs
git commit -m "build(package): resources/pi 纳入 asar unpack（mac+win）"
```

---

## Phase 8：端到端验证与收尾

### Task 18：全量测试 + 构建 + 手动冒烟

**Files:** 无

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全绿。对比 Task 0 基线，确认无新增失败（被删功能的测试应已同步删除/改写）。

- [ ] **Step 2: 全量构建**

Run: `npm run build`
Expected: 成功，无类型错误。

- [ ] **Step 3: dev 手动冒烟**

Run: `npm run dev`，打开 AI 对话面板：
- 面板只显示 pi，无 codex/claude。
- 在 App AI 设置里配好一个 provider 后，pi 对话能正常出字（验证 provider 投影 + 内置入口生效）。
- 触发一次「写稿/审稿」，确认 pi 走 `lingji_*` MCP 工具（验证 MCP/CLAUDE.md 迁移）。
Expected: 均符合。记录实际结果。

- [ ] **Step 4: 残留引用终检**

Run:
```bash
grep -rn "codex\|claude-stream\|claude-agent-acp\|agent-profiles\|connection-registry" electron/ src/ | grep -v node_modules | grep -vi "claude_code_acp\|headless\|ANTHROPIC\|CLAUDE.md\|claude.ai"
```
Expected: 无对「已删面板 def / 旧 ACP 面板」的残留引用（#2 `claude_code_acp`/headless/ANTHROPIC 属保留项，应被过滤）。

- [ ] **Step 5: 更新 CHANGELOG / Release notes**

按 `AGENTS.md` 规则同步 `CHANGELOG.md` 与 Release notes（记忆：发版必须同步）。本次条目：内置 pi 为唯一对话 agent，移除 codex/claude 面板路径，开箱即用。

- [ ] **Step 6: 提交**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): 内置 pi agent，移除 codex/claude 面板路径"
```

---

## 自检对照（spec 覆盖）

- spec §2 目标态：Phase 4（删 codex/claude def）、Phase 5（UI）、Phase 6（默认 pi）、Task 10/13（删旧 ACP）覆盖；`HeadlessAcpProvider` 全程不动 ✅
- spec §3 内置运行时（方案 A）：Phase 2（bundled-runtime + session/detection）、Phase 7（vendor + asar unpack）✅
- spec §4 App 托管配置 + provider 投影：Phase 1（投影）、Phase 3（写盘）、Task 15（连接注入）✅
- spec §5 skill/提示词预置：Task 8（种子）、Task 15 Step 2（接入 `--skill`/`--prompt-template`/`--append-system-prompt`）✅
- spec §6 UI/设置：Phase 5 ✅
- spec §7 移除清单：Phase 4 + Task 13 Step 3 ✅
- spec §8 测试：各 Phase TDD + Task 18 ✅
- spec §9 风险：Task 16 Step 3（TUI 原生模块验证）、Task 15 Step 3（AISettings 来源）、Task 17（asar unpack）、Task 14（旧 id 归一化避免解析到已删 def）已分别落到任务 ✅

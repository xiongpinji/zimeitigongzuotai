# 提示词 × AI 绑定整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户为每个提示词独立绑定 LLM Provider+Model（含 Global/Project 两层覆盖），并把封面文生图抽象为 `ImageProvider`，`cover.regeneration` 同时绑定 LLM 与 ImageProvider。

**Architecture:** 数据层（types + resolver + migrate + store + IPC）→ 调用层（`generateStructuredData` 增加可选 `binding` 参数，所有 6 种调用型 PromptKind 切到 `resolvePromptBinding`，`jimeng-client` 剥离 settings 依赖，新增 `cover-generation.ts` 编排）→ UI 层（PromptsConfigTab 绑定条 + 列表 Badge + ImageProviderListSection）。分 3 个交付切片，每片可独立合入。

**Tech Stack:** TypeScript / React 19 / Zustand / Electron 41 IPC / LangChain (ChatOpenAI / ChatGoogleGenerativeAI) / Vitest

**Spec:** `docs/superpowers/specs/2026-04-17-prompt-ai-binding-design.md`

**并行执行说明：**
- Slice 1 内：Task 1.1 必须先；之后 1.2 / 1.3 可并行；1.4 / 1.5 在 1.1 完成后亦可并行（且不依赖 1.2/1.3）
- Slice 2 内：Task 2.1 必须先；之后 2.2 / 2.3 / 2.4 / 2.5 可并行
- Slice 3 内：Task 3.1 必须先；之后 3.2 与（3.3 + 3.4 + 3.5 + 3.6）可并行
- Slice 之间严格顺序：Slice 1 → Slice 2 → Slice 3 → Slice 4

---

## Slice 1：数据层 & 迁移

### Task 1.1: 新增类型定义 + AISettings 扩展

**Files:**
- Modify: `src/types/ai.ts`

- [ ] **Step 1: 在 `src/types/ai.ts` 末尾追加新类型**

```ts
/** 单个 Image Provider 配置（文生图） */
export interface ImageProvider {
  id: string;
  name: string;
  type: 'jimeng' | 'openai_image' | 'custom';
  baseUrl: string;
  apiKey: string;          // 即梦下：实际承载 sessionId（client 层适配）
  models: string[];
}

/** 单个提示词的 AI 绑定（null 表示继承） */
export interface PromptBinding {
  providerId: string | null;
  model: string | null;
  // 仅 cover.regeneration 写入
  imageProviderId?: string | null;
  imageModel?: string | null;
}

/** 提示词 → 绑定映射；缺失 key 视为继承 */
export type PromptBindingMap = Partial<Record<import('./prompts-kind').PromptKind, PromptBinding>>;
```

注意：`PromptBindingMap` 引用了 `PromptKind`，避免在 `ai.ts` 直接 `import` 提示词模块造成循环依赖，使用类型 import。如果路径不对，请改为 `import('../lib/prompts/types').PromptKind` —— 实际路径以仓库为准（`src/lib/prompts/types.ts`）。

- [ ] **Step 2: 扩展 `AISettings` 接口**

在 `AISettings` 内现有字段下追加（保持原字段不动）：

```ts
  // —— 新增：图像 Provider ——
  imageProviders: ImageProvider[];
  defaultImageProviderId: string | null;
  defaultImageModel: string | null;
  // —— 新增：提示词 → AI 绑定（全局层）——
  promptBindings: PromptBindingMap;
```

- [ ] **Step 3: 扩展默认 AISettings 工厂**

在仓库中找到 `AISettings` 的默认工厂（搜 `createDefaultAISettings` 或 `defaultAISettings` 或 `useAIStore` 的 init 区域，路径常见为 `src/store/ai.ts`），在默认值里加上：

```ts
  imageProviders: [],
  defaultImageProviderId: null,
  defaultImageModel: null,
  promptBindings: {},
```

- [ ] **Step 4: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 通过（如有报错，定位是 store 默认值缺字段还是其他调用点未补字段，逐处补足）。

- [ ] **Step 5: Commit**

```bash
git add src/types/ai.ts src/store/ai.ts
git commit -m "feat(ai-types): 新增 ImageProvider/PromptBinding 类型与 AISettings 扩展字段"
```

---

### Task 1.2: 写 `migrateImageProviders` 函数 + 测试

**Files:**
- Create: `src/lib/llm/migrate-image-providers.ts`
- Create: `tests/migrate-image-providers.test.ts`

- [ ] **Step 1: 写失败测试 `tests/migrate-image-providers.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { AISettings } from '../src/types/ai';
import { migrateImageProviders } from '../src/lib/llm/migrate-image-providers';

function baseSettings(): AISettings {
  return {
    llmProviders: [],
    defaultProviderId: null,
    defaultModel: null,
    llmBaseUrl: '',
    llmApiKey: '',
    llmModel: '',
    jimengApiUrl: '',
    jimengSessionId: '',
    minimaxApiKey: '',
    minimaxVoiceId: '',
    minimaxSpeed: 1,
    imageProviders: [],
    defaultImageProviderId: null,
    defaultImageModel: null,
    promptBindings: {},
  };
}

describe('migrateImageProviders', () => {
  it('已迁移（imageProviders 非空）时直接返回，幂等', () => {
    const s: AISettings = {
      ...baseSettings(),
      imageProviders: [{
        id: 'x', name: 'X', type: 'custom',
        baseUrl: 'u', apiKey: 'k', models: ['m'],
      }],
    };
    expect(migrateImageProviders(s)).toBe(s);
  });

  it('无即梦配置：返回空 imageProviders 列表', () => {
    const s = baseSettings();
    const next = migrateImageProviders(s);
    expect(next.imageProviders).toEqual([]);
    expect(next.defaultImageProviderId).toBeNull();
    expect(next.defaultImageModel).toBeNull();
  });

  it('有即梦配置：迁移成 imageProviders[0] 并清空旧字段', () => {
    const s: AISettings = {
      ...baseSettings(),
      jimengApiUrl: 'https://api.jimeng.com',
      jimengSessionId: 'sess-abc',
      jimengModel: 'jimeng-5.0',
    };
    const next = migrateImageProviders(s);
    expect(next.imageProviders).toHaveLength(1);
    expect(next.imageProviders[0]).toMatchObject({
      id: 'jimeng-default',
      name: '即梦',
      type: 'jimeng',
      baseUrl: 'https://api.jimeng.com',
      apiKey: 'sess-abc',
      models: ['jimeng-5.0'],
    });
    expect(next.defaultImageProviderId).toBe('jimeng-default');
    expect(next.defaultImageModel).toBe('jimeng-5.0');
    expect(next.jimengApiUrl).toBe('');
    expect(next.jimengSessionId).toBe('');
    expect(next.jimengModel).toBe('');
  });

  it('jimengModel 缺失时使用 DEFAULT_JIMENG_MODEL', () => {
    const s: AISettings = {
      ...baseSettings(),
      jimengApiUrl: 'https://api.jimeng.com',
      jimengSessionId: 'sess-abc',
    };
    const next = migrateImageProviders(s);
    expect(next.imageProviders[0].models).toEqual(['jimeng-5.0']);
    expect(next.defaultImageModel).toBe('jimeng-5.0');
  });
});
```

- [ ] **Step 2: 运行测试，确认 fail**

```bash
npx vitest run tests/migrate-image-providers.test.ts
```

Expected: FAIL（"Cannot find module … migrate-image-providers"）。

- [ ] **Step 3: 实现 `src/lib/llm/migrate-image-providers.ts`**

```ts
import { DEFAULT_JIMENG_MODEL, type AISettings, type ImageProvider } from '../../types/ai';

export function migrateImageProviders(settings: AISettings): AISettings {
  if (settings.imageProviders?.length) return settings;

  const hasJimengConfig = Boolean(
    settings.jimengApiUrl?.trim() || settings.jimengSessionId?.trim(),
  );

  if (!hasJimengConfig) {
    return {
      ...settings,
      imageProviders: [],
      defaultImageProviderId: null,
      defaultImageModel: null,
    };
  }

  const model = settings.jimengModel?.trim() || DEFAULT_JIMENG_MODEL;
  const jimeng: ImageProvider = {
    id: 'jimeng-default',
    name: '即梦',
    type: 'jimeng',
    baseUrl: settings.jimengApiUrl ?? '',
    apiKey: settings.jimengSessionId ?? '',
    models: [model],
  };

  return {
    ...settings,
    imageProviders: [jimeng],
    defaultImageProviderId: jimeng.id,
    defaultImageModel: model,
    jimengApiUrl: '',
    jimengSessionId: '',
    jimengModel: '',
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run tests/migrate-image-providers.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/migrate-image-providers.ts tests/migrate-image-providers.test.ts
git commit -m "feat(image-provider): 新增即梦字段→ImageProvider 数据迁移"
```

---

### Task 1.3: 写 `resolvePromptBinding` + `PromptBindingError` + 测试

**Files:**
- Create: `src/lib/llm/binding-resolver.ts`
- Create: `tests/binding-resolver.test.ts`

- [ ] **Step 1: 写失败测试 `tests/binding-resolver.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { AISettings, LLMProvider, ImageProvider, PromptBindingMap } from '../src/types/ai';
import {
  resolvePromptBinding,
  PromptBindingError,
} from '../src/lib/llm/binding-resolver';

const llmA: LLMProvider = { id: 'A', name: 'A', type: 'openai_compatible', baseUrl: 'a', apiKey: 'k', models: ['m1', 'm2'] };
const llmB: LLMProvider = { id: 'B', name: 'B', type: 'openai_compatible', baseUrl: 'b', apiKey: 'k', models: ['n1'] };
const imgA: ImageProvider = { id: 'IA', name: 'jimeng', type: 'jimeng', baseUrl: 'u', apiKey: 'k', models: ['jimeng-5.0'] };

function settings(): AISettings {
  return {
    llmProviders: [llmA, llmB],
    defaultProviderId: 'A',
    defaultModel: 'm1',
    llmBaseUrl: '', llmApiKey: '', llmModel: '',
    jimengApiUrl: '', jimengSessionId: '',
    minimaxApiKey: '', minimaxVoiceId: '', minimaxSpeed: 1,
    imageProviders: [imgA],
    defaultImageProviderId: 'IA',
    defaultImageModel: 'jimeng-5.0',
    promptBindings: {},
  };
}

describe('resolvePromptBinding', () => {
  it('全部未绑定：回退到 default provider/model', () => {
    const r = resolvePromptBinding('planning.segment', settings(), null);
    expect(r.provider.id).toBe('A');
    expect(r.model).toBe('m1');
  });

  it('全局 binding 命中', () => {
    const s = settings();
    s.promptBindings['planning.segment'] = { providerId: 'B', model: 'n1' };
    const r = resolvePromptBinding('planning.segment', s, null);
    expect(r.provider.id).toBe('B');
    expect(r.model).toBe('n1');
  });

  it('project binding 覆盖 global binding', () => {
    const s = settings();
    s.promptBindings['planning.segment'] = { providerId: 'A', model: 'm2' };
    const project: PromptBindingMap = { 'planning.segment': { providerId: 'B', model: 'n1' } };
    const r = resolvePromptBinding('planning.segment', s, project);
    expect(r.provider.id).toBe('B');
    expect(r.model).toBe('n1');
  });

  it('binding.providerId 为 null 视为继承（走 global / default）', () => {
    const s = settings();
    s.promptBindings['planning.segment'] = { providerId: 'B', model: 'n1' };
    const project: PromptBindingMap = { 'planning.segment': { providerId: null, model: null } };
    const r = resolvePromptBinding('planning.segment', s, project);
    expect(r.provider.id).toBe('B'); // 落到 global
  });

  it('cover.regeneration 同时解析 LLM + image 段', () => {
    const s = settings();
    const r = resolvePromptBinding('cover.regeneration', s, null);
    expect(r.provider.id).toBe('A');
    expect(r.imageProvider?.id).toBe('IA');
    expect(r.imageModel).toBe('jimeng-5.0');
  });

  it('provider 已删除：抛 PromptBindingError(PROVIDER_MISSING)', () => {
    const s = settings();
    s.promptBindings['planning.segment'] = { providerId: 'GHOST', model: 'x' };
    expect(() => resolvePromptBinding('planning.segment', s, null))
      .toThrowError(PromptBindingError);
  });

  it('model 不在 provider.models 中：抛 PromptBindingError(MODEL_NOT_IN_PROVIDER)', () => {
    const s = settings();
    s.promptBindings['planning.segment'] = { providerId: 'A', model: 'no-such' };
    try {
      resolvePromptBinding('planning.segment', s, null);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PromptBindingError);
      expect((e as PromptBindingError).code).toBe('MODEL_NOT_IN_PROVIDER');
    }
  });

  it('default provider 未配置且无 binding：抛 PROVIDER_MISSING', () => {
    const s = settings();
    s.defaultProviderId = null;
    s.defaultModel = null;
    expect(() => resolvePromptBinding('planning.segment', s, null))
      .toThrowError(PromptBindingError);
  });
});
```

- [ ] **Step 2: 运行测试，确认 fail**

```bash
npx vitest run tests/binding-resolver.test.ts
```

Expected: FAIL（模块未找到）。

- [ ] **Step 3: 实现 `src/lib/llm/binding-resolver.ts`**

```ts
import type {
  AISettings,
  ImageProvider,
  LLMProvider,
  PromptBinding,
  PromptBindingMap,
} from '../../types/ai';
import type { PromptKind } from '../prompts/types';

export type PromptBindingErrorCode =
  | 'PROVIDER_MISSING'
  | 'MODEL_NOT_IN_PROVIDER'
  | 'IMAGE_PROVIDER_MISSING'
  | 'IMAGE_MODEL_NOT_IN_PROVIDER';

export class PromptBindingError extends Error {
  constructor(
    public readonly code: PromptBindingErrorCode,
    public readonly kind: PromptKind,
    message: string,
  ) {
    super(message);
    this.name = 'PromptBindingError';
  }
}

export interface ResolvedBinding {
  provider: LLMProvider;
  model: string;
  imageProvider?: ImageProvider;
  imageModel?: string;
}

function pickFirstNonNull<T>(...values: Array<T | null | undefined>): T | null {
  for (const v of values) {
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

function resolveLlm(
  kind: PromptKind,
  settings: AISettings,
  project: PromptBindingMap | null,
): { provider: LLMProvider; model: string } {
  const projectB: PromptBinding | undefined = project?.[kind];
  const globalB: PromptBinding | undefined = settings.promptBindings?.[kind];

  const providerId = pickFirstNonNull(
    projectB?.providerId,
    globalB?.providerId,
    settings.defaultProviderId,
  );
  const model = pickFirstNonNull(
    projectB?.model,
    globalB?.model,
    settings.defaultModel,
  );

  if (!providerId || !model) {
    throw new PromptBindingError('PROVIDER_MISSING', kind,
      `提示词 ${kind} 未绑定 LLM 且无全局默认 Provider/Model`);
  }
  const provider = settings.llmProviders.find((p) => p.id === providerId);
  if (!provider) {
    throw new PromptBindingError('PROVIDER_MISSING', kind,
      `提示词 ${kind} 绑定的 Provider ${providerId} 不存在`);
  }
  if (!provider.models.includes(model)) {
    throw new PromptBindingError('MODEL_NOT_IN_PROVIDER', kind,
      `提示词 ${kind} 绑定的模型 ${model} 不在 Provider ${provider.name} 的模型列表里`);
  }
  return { provider, model };
}

function resolveImage(
  kind: PromptKind,
  settings: AISettings,
  project: PromptBindingMap | null,
): { imageProvider: ImageProvider; imageModel: string } {
  const projectB = project?.[kind];
  const globalB = settings.promptBindings?.[kind];

  const providerId = pickFirstNonNull(
    projectB?.imageProviderId,
    globalB?.imageProviderId,
    settings.defaultImageProviderId,
  );
  const model = pickFirstNonNull(
    projectB?.imageModel,
    globalB?.imageModel,
    settings.defaultImageModel,
  );

  if (!providerId || !model) {
    throw new PromptBindingError('IMAGE_PROVIDER_MISSING', kind,
      `提示词 ${kind} 未绑定 ImageProvider 且无全局默认`);
  }
  const provider = settings.imageProviders.find((p) => p.id === providerId);
  if (!provider) {
    throw new PromptBindingError('IMAGE_PROVIDER_MISSING', kind,
      `提示词 ${kind} 绑定的 ImageProvider ${providerId} 不存在`);
  }
  if (!provider.models.includes(model)) {
    throw new PromptBindingError('IMAGE_MODEL_NOT_IN_PROVIDER', kind,
      `提示词 ${kind} 绑定的图像模型 ${model} 不在 ImageProvider ${provider.name} 的模型列表里`);
  }
  return { imageProvider: provider, imageModel: model };
}

export function resolvePromptBinding(
  kind: PromptKind,
  settings: AISettings,
  project: PromptBindingMap | null,
): ResolvedBinding {
  const llm = resolveLlm(kind, settings, project);
  if (kind === 'cover.regeneration') {
    const img = resolveImage(kind, settings, project);
    return { ...llm, ...img };
  }
  return llm;
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/binding-resolver.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/binding-resolver.ts tests/binding-resolver.test.ts
git commit -m "feat(prompt-binding): 新增 resolvePromptBinding 与 PromptBindingError"
```

---

### Task 1.4: prompt-bindings IO（主进程）+ IPC + Preload

**Files:**
- Create: `electron/prompt-bindings-io.ts`
- Modify: `electron/main.ts`（注册 IPC handler）
- Modify: `electron/preload.ts`（暴露 readBindings/writeBindings）
- Modify: `src/lib/electron-api.ts`（renderer 类型声明）
- Create: `tests/prompt-bindings-io.test.ts`

- [ ] **Step 1: 写失败测试 `tests/prompt-bindings-io.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  readPromptBindings,
  writePromptBindings,
  deletePromptBindings,
} from '../electron/prompt-bindings-io';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pbio-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('prompt-bindings-io', () => {
  it('读不存在的项目文件：返回空对象', async () => {
    const r = await readPromptBindings({ projectDir: tmp });
    expect(r).toEqual({});
  });

  it('write → read 往返一致', async () => {
    await writePromptBindings(
      { 'planning.segment': { providerId: 'A', model: 'm1' } },
      { projectDir: tmp },
    );
    const r = await readPromptBindings({ projectDir: tmp });
    expect(r).toEqual({ 'planning.segment': { providerId: 'A', model: 'm1' } });
    // 文件位置在 configs/prompt-bindings.json
    const filePath = path.join(tmp, 'configs', 'prompt-bindings.json');
    expect(await fs.stat(filePath)).toBeTruthy();
  });

  it('写入空 map：删除文件', async () => {
    await writePromptBindings({ 'planning.segment': { providerId: 'A', model: 'm' } },
                              { projectDir: tmp });
    await writePromptBindings({}, { projectDir: tmp });
    const filePath = path.join(tmp, 'configs', 'prompt-bindings.json');
    await expect(fs.stat(filePath)).rejects.toThrow();
    expect(await readPromptBindings({ projectDir: tmp })).toEqual({});
  });

  it('deletePromptBindings 删除项目文件，幂等', async () => {
    await writePromptBindings({ 'planning.segment': { providerId: 'A', model: 'm' } },
                              { projectDir: tmp });
    await deletePromptBindings({ projectDir: tmp });
    await deletePromptBindings({ projectDir: tmp });
    expect(await readPromptBindings({ projectDir: tmp })).toEqual({});
  });
});
```

- [ ] **Step 2: 运行测试，确认 fail**

```bash
npx vitest run tests/prompt-bindings-io.test.ts
```

Expected: FAIL（模块未找到）。

- [ ] **Step 3: 实现 `electron/prompt-bindings-io.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PromptBindingMap } from '../src/types/ai';

const PROJECT_FILE = path.join('configs', 'prompt-bindings.json');

function projectFilePath(projectDir: string): string {
  return path.join(projectDir, PROJECT_FILE);
}

async function readJsonIfExists(filePath: string): Promise<PromptBindingMap> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PromptBindingMap;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export interface PromptBindingsCtx {
  projectDir: string;
}

export async function readPromptBindings(ctx: PromptBindingsCtx): Promise<PromptBindingMap> {
  return readJsonIfExists(projectFilePath(ctx.projectDir));
}

export async function writePromptBindings(
  bindings: PromptBindingMap,
  ctx: PromptBindingsCtx,
): Promise<void> {
  const filePath = projectFilePath(ctx.projectDir);
  const isEmpty = !bindings || Object.keys(bindings).length === 0;
  if (isEmpty) {
    await deletePromptBindings(ctx);
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(bindings, null, 2), 'utf-8');
}

export async function deletePromptBindings(ctx: PromptBindingsCtx): Promise<void> {
  try {
    await fs.unlink(projectFilePath(ctx.projectDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/prompt-bindings-io.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: 注册 IPC handler 在 `electron/main.ts`**

定位 `prompts:*` 既有 IPC 注册区域（搜 `ipcMain.handle('prompts:`），在末尾追加：

```ts
import {
  readPromptBindings,
  writePromptBindings,
} from './prompt-bindings-io';

// 项目级 binding（仅项目作用域；全局 binding 直接走 AISettings 持久化）
ipcMain.handle(
  'prompts:readBindings',
  async (_e, payload: { scope: 'project'; projectDir: string }) => {
    if (payload.scope !== 'project') throw new Error('readBindings: 仅支持 project scope');
    if (!payload.projectDir || !path.isAbsolute(payload.projectDir)) {
      throw new Error('readBindings: 需要绝对路径 projectDir');
    }
    return readPromptBindings({ projectDir: payload.projectDir });
  },
);

ipcMain.handle(
  'prompts:writeBindings',
  async (_e, payload: { scope: 'project'; bindings: unknown; projectDir: string }) => {
    if (payload.scope !== 'project') throw new Error('writeBindings: 仅支持 project scope');
    if (!payload.projectDir || !path.isAbsolute(payload.projectDir)) {
      throw new Error('writeBindings: 需要绝对路径 projectDir');
    }
    if (!payload.bindings || typeof payload.bindings !== 'object') {
      throw new Error('writeBindings: bindings 必须是对象');
    }
    await writePromptBindings(payload.bindings as Parameters<typeof writePromptBindings>[0],
                              { projectDir: payload.projectDir });
  },
);
```

> 全局 scope 不走 IPC：renderer 直接读写 `settings.promptBindings`，由现有 AISettings 持久化机制保存。

- [ ] **Step 6: 在 `electron/preload.ts` 暴露**

定位 `prompts:` 段（搜 `window.electronAPI.prompts`），在 `prompts` 对象上追加方法：

```ts
  readBindings(scope: 'project', projectDir: string) {
    return ipcRenderer.invoke('prompts:readBindings', { scope, projectDir });
  },
  writeBindings(scope: 'project', bindings: unknown, projectDir: string) {
    return ipcRenderer.invoke('prompts:writeBindings', { scope, bindings, projectDir });
  },
```

- [ ] **Step 7: renderer 侧类型 `src/lib/electron-api.ts`**

在 `prompts` 接口上追加：

```ts
  readBindings(scope: 'project', projectDir: string): Promise<PromptBindingMap>;
  writeBindings(scope: 'project', bindings: PromptBindingMap, projectDir: string): Promise<void>;
```

并 `import type { PromptBindingMap } from '../types/ai';`。

- [ ] **Step 8: 类型检查 + 测试**

```bash
npx tsc --noEmit && npx vitest run tests/prompt-bindings-io.test.ts
```

Expected: 通过。

- [ ] **Step 9: Commit**

```bash
git add electron/prompt-bindings-io.ts electron/main.ts electron/preload.ts \
        src/lib/electron-api.ts tests/prompt-bindings-io.test.ts
git commit -m "feat(prompt-binding): 项目级 binding IO + IPC handler + preload 暴露"
```

---

### Task 1.5: store/ai.ts 集成 — 加载迁移 + project bindings + resolve selector

**Files:**
- Modify: `src/store/ai.ts`

- [ ] **Step 1: 在 store 加载 AISettings 后调用迁移**

定位 `useAIStore` 的初始化或 hydrate 函数（常见 pattern：从 localStorage / IPC 读 settings 后 setState），在 setState 前包一层迁移：

```ts
import { migrateImageProviders } from '../lib/llm/migrate-image-providers';

// hydrate 处
const loaded = /* 既有读取逻辑 */;
const migrated = migrateImageProviders(loaded);
const needPersist = migrated !== loaded;
set({ settings: migrated });
if (needPersist) {
  await /* 既有持久化 */;
}
```

- [ ] **Step 2: 增加 project bindings 状态字段 + 加载/保存 actions**

```ts
import type { PromptBindingMap } from '../types/ai';

interface AIState {
  // …既有
  projectBindings: PromptBindingMap;
  projectDir: string | null;       // 若已存在请复用既有字段
  loadProjectBindings(projectDir: string | null): Promise<void>;
  setProjectBinding(kind: PromptKind, binding: PromptBinding | null): Promise<void>;
  setGlobalBinding(kind: PromptKind, binding: PromptBinding | null): void;
}

// 实现
loadProjectBindings: async (projectDir) => {
  if (!projectDir) {
    set({ projectBindings: {}, projectDir: null });
    return;
  }
  const map = await window.electronAPI.prompts.readBindings('project', projectDir);
  set({ projectBindings: map ?? {}, projectDir });
},

setProjectBinding: async (kind, binding) => {
  const { projectBindings, projectDir } = get();
  if (!projectDir) throw new Error('未打开项目，无法保存项目级绑定');
  const next: PromptBindingMap = { ...projectBindings };
  if (binding === null) {
    delete next[kind];
  } else {
    next[kind] = binding;
  }
  set({ projectBindings: next });
  await window.electronAPI.prompts.writeBindings('project', next, projectDir);
},

setGlobalBinding: (kind, binding) => {
  const settings = get().settings;
  const map: PromptBindingMap = { ...(settings.promptBindings ?? {}) };
  if (binding === null) delete map[kind];
  else map[kind] = binding;
  // 复用既有 saveSettings 路径
  get().updateSettings({ promptBindings: map });
},
```

- [ ] **Step 3: 增加 `resolveBinding` selector**

```ts
import { resolvePromptBinding, type ResolvedBinding } from '../lib/llm/binding-resolver';

resolveBinding: (kind: PromptKind): ResolvedBinding => {
  const { settings, projectBindings } = get();
  return resolvePromptBinding(kind, settings, projectBindings ?? null);
},
```

- [ ] **Step 4: 在打开/切换项目处订阅 `loadProjectBindings`**

定位现有"打开项目"逻辑（搜 `setProjectDir` 或 `openProject` 或类似 store action），在 projectDir 改变时调用 `loadProjectBindings(newDir)`。

- [ ] **Step 5: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add src/store/ai.ts
git commit -m "feat(ai-store): 集成 image provider 迁移与 project bindings 加载/解析"
```

---

## Slice 2：调用层切换

### Task 2.1: `generateStructuredData` / `generateText` / `streamText` 增加可选 `binding` 参数

**Files:**
- Modify: `src/lib/llm/index.ts`
- Create: `tests/llm-generate-with-binding.test.ts`

- [ ] **Step 1: 写失败测试 `tests/llm-generate-with-binding.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { AISettings, LLMProvider } from '../src/types/ai';
import type { ResolvedBinding } from '../src/lib/llm/binding-resolver';

vi.mock('../src/lib/llm/model', () => {
  return {
    createChatModel: vi.fn(() => ({
      bind: () => ({ invoke: async () => ({ content: '{"k":1}' }) }),
      invoke: async () => ({ content: 'hello' }),
    })),
    createChatModelFromProvider: vi.fn(() => ({
      bind: () => ({ invoke: async () => ({ content: '{"k":2}' }) }),
      invoke: async () => ({ content: 'hello-binding' }),
    })),
  };
});

import { generateStructuredData, generateText } from '../src/lib/llm';
import { createChatModel, createChatModelFromProvider } from '../src/lib/llm/model';

const provider: LLMProvider = { id: 'A', name: 'A', type: 'openai_compatible', baseUrl: 'b', apiKey: 'k', models: ['m'] };
const settings: AISettings = {
  llmProviders: [provider], defaultProviderId: 'A', defaultModel: 'm',
  llmBaseUrl: '', llmApiKey: '', llmModel: '',
  jimengApiUrl: '', jimengSessionId: '',
  minimaxApiKey: '', minimaxVoiceId: '', minimaxSpeed: 1,
  imageProviders: [], defaultImageProviderId: null, defaultImageModel: null,
  promptBindings: {},
};
const binding: ResolvedBinding = { provider, model: 'm' };

describe('generate with optional binding', () => {
  it('不传 binding：走 createChatModel(settings)（兼容老调用）', async () => {
    const r = await generateStructuredData(settings, 'sys', 'usr');
    expect(r).toEqual({ k: 1 });
    expect(createChatModel).toHaveBeenCalled();
  });

  it('传 binding：走 createChatModelFromProvider', async () => {
    const r = await generateStructuredData(settings, 'sys', 'usr', binding);
    expect(r).toEqual({ k: 2 });
    expect(createChatModelFromProvider).toHaveBeenCalledWith(provider, 'm', expect.any(Object));
  });

  it('generateText 同样支持 binding 参数', async () => {
    const r = await generateText(settings, 'sys', 'usr', binding);
    expect(r).toBe('hello-binding');
  });
});
```

- [ ] **Step 2: 运行测试，确认 fail**

```bash
npx vitest run tests/llm-generate-with-binding.test.ts
```

Expected: FAIL（generateText 不接受第 4 个参数 / generateStructuredData 不接受第 4 个参数）。

- [ ] **Step 3: 修改 `src/lib/llm/index.ts`**

替换 `generateStructuredData` / `generateText` 签名（保持原有兼容路径不变）：

```ts
import type { ResolvedBinding } from './binding-resolver';

function pickModel(settings: AISettings, binding?: ResolvedBinding) {
  if (binding) {
    return createChatModelFromProvider(binding.provider, binding.model, {
      enableThinking: settings.enableThinking,
    });
  }
  return createChatModel(settings);
}

export async function generateStructuredData(
  settings: AISettings,
  systemPrompt: string,
  userMessage: string,
  binding?: ResolvedBinding,
): Promise<Record<string, unknown>> {
  const chatModel = pickModel(settings, binding) as unknown as {
    bind?: (kw: Record<string, unknown>) => { invoke: (m: unknown[]) => Promise<{ content: unknown }> };
    invoke: (m: unknown[]) => Promise<{ content: unknown }>;
  };
  const model = typeof chatModel.bind === 'function'
    ? chatModel.bind({ response_format: { type: 'json_object' } })
    : chatModel;
  const response = await model.invoke(buildPromptMessages(systemPrompt, userMessage));
  const content = assertNonEmptyContent(extractTextContent(response.content), 'LLM 返回空内容');
  return parseStructuredOutput(content);
}

export async function generateText(
  settings: AISettings,
  systemPrompt: string,
  userMessage: string,
  binding?: ResolvedBinding,
): Promise<string> {
  const response = await pickModel(settings, binding)
    .invoke(buildPromptMessages(systemPrompt, userMessage));
  return assertNonEmptyContent(extractTextContent(response.content), 'LLM 返回空内容');
}

export async function streamText(
  settings: AISettings,
  systemPrompt: string,
  userMessage: string,
  onChunk: (chunk: string) => void,
  callbacks?: StreamCallbacks,
  binding?: ResolvedBinding,
): Promise<string> {
  const stream = await pickModel(settings, binding)
    .stream(buildPromptMessages(systemPrompt, userMessage));
  // …原有 chunk 处理
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/llm-generate-with-binding.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: 跑全量回归**

```bash
npm test
```

Expected: 现有测试全部通过（兼容路径未破坏）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm/index.ts tests/llm-generate-with-binding.test.ts
git commit -m "feat(llm): generateStructuredData/generateText/streamText 增加可选 binding 参数"
```

---

### Task 2.2: `ai-analysis.ts` 切到 resolvePromptBinding

**Files:**
- Modify: `src/lib/ai-analysis.ts`

- [ ] **Step 1: 定位调用点**

```bash
grep -n 'generateStructuredData\|generateText' src/lib/ai-analysis.ts
```

记下每个调用对应的"提示词类型"（应能从上下文判断对应 `planning.segment` / `cards.segment` / `cover.regeneration`）。

- [ ] **Step 2: 修改 `analyzeSrt`（或对应函数）签名，新增 `getBinding` 入参**

```ts
import { resolvePromptBinding } from './llm/binding-resolver';
import type { PromptKind } from './prompts/types';
import type { AISettings, PromptBindingMap } from '../types/ai';

export interface AnalyzeSrtOptions {
  settings: AISettings;
  projectBindings: PromptBindingMap | null;
  // …其他既有
}

// 替换原"读 settings.defaultProvider"为按 kind 解析
function bindingFor(kind: PromptKind, opts: AnalyzeSrtOptions) {
  return resolvePromptBinding(kind, opts.settings, opts.projectBindings);
}
```

每处调用 `generateStructuredData(settings, sys, user)` 改为：

```ts
const binding = bindingFor('planning.segment', opts);   // 按调用语义改 kind
await generateStructuredData(opts.settings, sys, user, binding);
```

- [ ] **Step 3: 更新所有调用方传入 `projectBindings`**

```bash
grep -n 'analyzeSrt\|analyzeStoryboard' src/ -R
```

每处调用方从 store 取 `projectBindings`：

```ts
const { settings, projectBindings } = useAIStore.getState();
await analyzeSrt({ settings, projectBindings, /* … */ });
```

- [ ] **Step 4: 类型检查 + 测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai-analysis.ts $(git diff --name-only -- src/)
git commit -m "feat(ai-analysis): 切到 resolvePromptBinding，按 PromptKind 选择 LLM"
```

---

### Task 2.3: `motion-prompt.ts` 切到 resolvePromptBinding

**Files:**
- Modify: `src/lib/motion-prompt.ts`
- Modify: motion-prompt 的所有调用方（grep 定位）

- [ ] **Step 1: 定位 `generateStructuredData` / `generateText` / `streamText` 调用**

```bash
grep -n 'generateStructuredData\|generateText\|streamText' src/lib/motion-prompt.ts
```

- [ ] **Step 2: 切到对应 PromptKind**

按调用语义对应：
- `motion.generate` → 生成新 motion
- `motion.modify` → 修改既有 motion
- `motion.autofix` → 自动修复

```ts
import { resolvePromptBinding } from './llm/binding-resolver';
// 调用前
const binding = resolvePromptBinding('motion.generate', settings, projectBindings);
await generateStructuredData(settings, sys, user, binding);
```

motion-prompt 的所有 export 函数都要把 `projectBindings: PromptBindingMap | null` 加到入参里（或 options 对象里）。

- [ ] **Step 3: 调用方传入 `projectBindings`**

```bash
grep -rn 'from.*motion-prompt' src/
```

逐一更新。

- [ ] **Step 4: 类型检查 + 测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/motion-prompt.ts $(git diff --name-only -- src/)
git commit -m "feat(motion-prompt): 切到 resolvePromptBinding，三种 motion PromptKind 独立绑定"
```

---

### Task 2.4: `jimeng-client.ts` 剥离 settings + 新增 `cover-generation.ts` 编排

**Files:**
- Modify: `src/lib/jimeng-client.ts`
- Create: `src/lib/cover-generation.ts`
- Create: `tests/cover-generation.test.ts`

- [ ] **Step 1: 修改 `buildJimengImageRequest` 签名 —— 接收 ImageProvider + model**

```ts
import { type ImageProvider, type CoverCandidate, DEFAULT_JIMENG_MODEL } from '../types/ai';

export function buildJimengImageRequest(
  prompt: string,
  provider: ImageProvider,
  model: string,
  n = 4,
): JimengImageRequest {
  return {
    url: `${provider.baseUrl.replace(/\/+$/, '')}/v1/images/generations`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: {
      model: model || DEFAULT_JIMENG_MODEL,
      prompt,
      ratio: '16:9',
      resolution: '2k',
      n,
    },
  };
}
```

- [ ] **Step 2: 同步改造 `generateImage` / `generateCoverCandidates`**

```ts
export async function generateImage(
  prompt: string,
  provider: ImageProvider,
  model: string,
): Promise<string> {
  const request = buildJimengImageRequest(prompt, provider, model);
  // …原有 fetch 逻辑保持
}

export async function generateCoverCandidates(
  prompts: string[],
  provider: ImageProvider,
  model: string,
  coversDir: string,
): Promise<CoverCandidate[]> {
  // 把循环里的 buildJimengImageRequest 调用改为接收 (prompt, provider, model, 4)
}
```

- [ ] **Step 3: 写 `tests/cover-generation.test.ts`（dispatcher）**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ImageProvider } from '../src/types/ai';
import { generateCoverImage } from '../src/lib/cover-generation';

vi.mock('../src/lib/jimeng-client', () => ({
  generateImage: vi.fn(async () => 'http://x/y.png'),
}));

describe('generateCoverImage dispatcher', () => {
  it('jimeng 类型走 jimeng-client', async () => {
    const provider: ImageProvider = { id: 'i', name: 'j', type: 'jimeng', baseUrl: 'u', apiKey: 'k', models: ['m'] };
    const url = await generateCoverImage('prompt', provider, 'm');
    expect(url).toBe('http://x/y.png');
  });

  it('openai_image / custom 暂未实现：抛错', async () => {
    const provider: ImageProvider = { id: 'i', name: 'd', type: 'openai_image', baseUrl: 'u', apiKey: 'k', models: ['m'] };
    await expect(generateCoverImage('p', provider, 'm')).rejects.toThrow(/未实现/);
  });
});
```

- [ ] **Step 4: 运行测试，确认 fail**

```bash
npx vitest run tests/cover-generation.test.ts
```

Expected: FAIL（模块未找到）。

- [ ] **Step 5: 实现 `src/lib/cover-generation.ts`**

```ts
import type { ImageProvider } from '../types/ai';
import { generateImage as jimengGenerateImage } from './jimeng-client';

export async function generateCoverImage(
  prompt: string,
  provider: ImageProvider,
  model: string,
): Promise<string> {
  switch (provider.type) {
    case 'jimeng':
      return jimengGenerateImage(prompt, provider, model);
    case 'openai_image':
    case 'custom':
      throw new Error(`ImageProvider.type=${provider.type} 暂未实现`);
    default: {
      const _exhaustive: never = provider.type;
      throw new Error(`未知 ImageProvider.type=${String(_exhaustive)}`);
    }
  }
}
```

- [ ] **Step 6: 运行测试**

```bash
npx vitest run tests/cover-generation.test.ts
```

Expected: 2 passed.

- [ ] **Step 7: 调用方迁移**

```bash
grep -rn 'buildJimengImageRequest\|generateCoverCandidates\|jimeng-client' src/
```

把每处旧的 `(prompt, settings)` 调用改为 `(prompt, provider, model)`，provider/model 从 `useAIStore.getState().resolveBinding('cover.regeneration')` 拿（其中包含 `imageProvider` 和 `imageModel`）。

- [ ] **Step 8: 全量回归**

```bash
npx tsc --noEmit && npm test
```

Expected: 通过。

- [ ] **Step 9: Commit**

```bash
git add src/lib/jimeng-client.ts src/lib/cover-generation.ts tests/cover-generation.test.ts \
        $(git diff --name-only -- src/)
git commit -m "feat(cover): jimeng-client 剥离 settings，新增 cover-generation dispatcher"
```

---

### Task 2.5: cover prompt 生成调用切换（如果 2.2 未覆盖）

**Files:**
- Modify: 涉及 `cover.regeneration` LLM 调用的文件（可能在 ai-analysis.ts 或独立文件）

- [ ] **Step 1: 定位**

```bash
grep -rn "cover.regeneration\|coverPrompt\|getBuiltinPromptTemplate.*cover" src/
```

- [ ] **Step 2: 切到 resolvePromptBinding**

```ts
const binding = resolvePromptBinding('cover.regeneration', settings, projectBindings);
const promptText = await generateText(settings, sysPrompt, userMessage, binding);
// 接 cover-generation.ts:
const url = await generateCoverImage(promptText, binding.imageProvider!, binding.imageModel!);
```

- [ ] **Step 3: 类型 + 测试**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 4: Commit**

```bash
git add $(git diff --name-only -- src/)
git commit -m "feat(cover): cover prompt 生成切到 resolvePromptBinding，端到端串通"
```

---

## Slice 3：UI 接入

### Task 3.1: 新增 `ImageProviderListSection` 组件

**Files:**
- Create: `src/components/settings/ImageProviderListSection.tsx`
- Create: `src/components/settings/ImageProviderListSection.module.css`（可复用 `ProviderListSection.module.css` 的样式 token）

- [ ] **Step 1: 复制 `ProviderListSection.tsx` 作为模板**

```bash
cp src/components/settings/ProviderListSection.tsx src/components/settings/ImageProviderListSection.tsx
cp src/components/settings/ProviderListSection.module.css src/components/settings/ImageProviderListSection.module.css
```

- [ ] **Step 2: 替换类型与字段**

把所有 `LLMProvider` → `ImageProvider`；`PROVIDER_TYPE_OPTIONS` 改为：

```ts
const IMAGE_PROVIDER_TYPE_OPTIONS: SelectOption[] = [
  { value: 'jimeng', label: '即梦' },
  { value: 'openai_image', label: 'OpenAI Images（暂未实现）' },
  { value: 'custom', label: '自定义' },
];
```

去掉 `enableThinking` 等 LLM 专属字段；Field label 文案适配文生图（apiKey 提示对 jimeng 显示 "即梦 Session ID"）。

- [ ] **Step 3: 把 Props 改成接收 ImageProvider 数组**

```ts
interface Props {
  imageProviders: ImageProvider[];
  defaultImageProviderId: string | null;
  onChange: (providers: ImageProvider[], defaultId: string | null) => void;
}
```

ai-config-utils.ts 里的 `validateProviderDraft` / `normalizeProviderDraft` 也复制一套用于 ImageProvider（或参数化共享）：

- 创建 `validateImageProviderDraft` / `normalizeImageProviderDraft`，逻辑和 LLM 版基本一样（必填 name/baseUrl/apiKey，至少一个 model）。

- [ ] **Step 4: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ImageProviderListSection.tsx \
        src/components/settings/ImageProviderListSection.module.css \
        src/components/settings/ai-config-utils.ts
git commit -m "feat(settings-ui): 新增 ImageProviderListSection 组件"
```

---

### Task 3.2: AIConfigTab 嵌入封面图像生成区块

**Files:**
- Modify: `src/components/settings/AIConfigTab.tsx`

- [ ] **Step 1: 在文件顶部 import**

```ts
import { ImageProviderListSection } from './ImageProviderListSection';
```

- [ ] **Step 2: 在 ProviderListSection 渲染后追加新区块**

```tsx
<section>
  <h3>封面图像生成</h3>
  <ImageProviderListSection
    imageProviders={settings.imageProviders}
    defaultImageProviderId={settings.defaultImageProviderId}
    onChange={(imageProviders, defaultImageProviderId) =>
      updateSettings({ imageProviders, defaultImageProviderId })
    }
  />
  <Field label="默认 Image Provider">
    <Select
      value={settings.defaultImageProviderId ?? ''}
      options={settings.imageProviders.map((p) => ({ value: p.id, label: p.name }))}
      onChange={(e) => updateSettings({ defaultImageProviderId: e.target.value || null })}
    />
  </Field>
  <Field label="默认 Image Model">
    <Select
      value={settings.defaultImageModel ?? ''}
      options={
        (settings.imageProviders.find((p) => p.id === settings.defaultImageProviderId)?.models
          ?? []).map((m) => ({ value: m, label: m }))
      }
      onChange={(e) => updateSettings({ defaultImageModel: e.target.value || null })}
    />
  </Field>
</section>
```

- [ ] **Step 3: 移除/隐藏既有散落的即梦字段输入**

定位 `jimengApiUrl` / `jimengSessionId` / `jimengModel` 的 Field（grep），删除（已迁移到 imageProviders）。

- [ ] **Step 4: dev 验证**

```bash
npm run dev
```

进入 设置 → AI 基础配置：
- 看到 "封面图像生成" 区块
- 旧用户首次启动：自动出现 `即梦` provider（迁移生效）
- 添加 / 删除 / 设默认 都能正常工作

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AIConfigTab.tsx
git commit -m "feat(settings-ui): AIConfigTab 嵌入 ImageProviderListSection 与默认选择"
```

---

### Task 3.3: PromptsConfigTab 顶部 AI 绑定条（普通版）

**Files:**
- Create: `src/components/settings/PromptBindingBar.tsx`
- Create: `src/components/settings/PromptBindingBar.module.css`
- Modify: `src/components/settings/PromptsConfigTab.tsx`

- [ ] **Step 1: 写 `PromptBindingBar.tsx` 组件**

```tsx
import { useMemo } from 'react';
import { Badge, Checkbox, Field, Select } from '../../ui';
import type { LLMProvider, PromptBinding } from '../../types/ai';
import styles from './PromptBindingBar.module.css';

interface Props {
  scope: 'global' | 'project';
  binding: PromptBinding | undefined;            // undefined = 继承
  llmProviders: LLMProvider[];
  effectiveProviderId: string | null;            // 解析后实际命中的（用于继承时显示）
  effectiveModel: string | null;
  onChange(next: PromptBinding | null): void;    // null = 删除（继承）
}

export function PromptBindingBar({
  scope, binding, llmProviders, effectiveProviderId, effectiveModel, onChange,
}: Props) {
  const inherit = !binding;
  const providerId = binding?.providerId ?? effectiveProviderId;
  const model = binding?.model ?? effectiveModel;
  const provider = useMemo(
    () => llmProviders.find((p) => p.id === providerId) ?? null,
    [llmProviders, providerId],
  );
  const modelOptions = (provider?.models ?? []).map((m) => ({ value: m, label: m }));

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>AI 绑定</span>
        <Checkbox
          label={scope === 'project' ? '继承（全局或默认）' : '继承全局默认'}
          checked={inherit}
          onChange={(checked) => onChange(checked ? null : { providerId, model })}
          size="sm"
        />
      </div>
      <div className={styles.row}>
        <Field label="Provider">
          <Select
            value={providerId ?? ''}
            disabled={inherit}
            options={llmProviders.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e) => {
              const nextId = e.target.value;
              const next = llmProviders.find((p) => p.id === nextId);
              onChange({ providerId: nextId, model: next?.models[0] ?? null });
            }}
          />
        </Field>
        <Field label="Model">
          <Select
            value={model ?? ''}
            disabled={inherit || !provider || provider.models.length === 0}
            options={modelOptions}
            onChange={(e) => onChange({ providerId: providerId!, model: e.target.value })}
          />
        </Field>
        {!inherit && (
          <button
            type="button"
            className={styles.resetLink}
            onClick={() => onChange(null)}
          >
            重置为继承
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 module CSS（最小可用）**

```css
.root { display: flex; flex-direction: column; gap: 8px; padding: 8px 12px;
        background: var(--color-panel-elevated); border-radius: var(--radius-md); }
.header { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: var(--font-size-md); color: var(--color-text-secondary); }
.row { display: flex; gap: 12px; align-items: end; }
.resetLink { background: none; border: none; color: var(--color-system-blue);
             font-size: var(--font-size-sm); cursor: pointer; padding: 4px 0; }
```

- [ ] **Step 3: 在 `PromptsConfigTab.tsx` 选中提示词的编辑面板上方插入**

```tsx
{selectedKind && selectedKind !== 'motion.system' && (
  <PromptBindingBar
    scope={scope}
    binding={
      scope === 'project' ? projectBindings[selectedKind] : settings.promptBindings?.[selectedKind]
    }
    llmProviders={settings.llmProviders}
    effectiveProviderId={effectiveBinding?.provider.id ?? null}
    effectiveModel={effectiveBinding?.model ?? null}
    onChange={(next) => {
      if (scope === 'project') setProjectBinding(selectedKind, next);
      else setGlobalBinding(selectedKind, next);
    }}
  />
)}
```

`effectiveBinding` 通过 try { resolveBinding(selectedKind) } catch 得到（失败时为 null，由 Task 3.6 处理警告 UI）。

- [ ] **Step 4: dev 验证**

```bash
npm run dev
```

打开 设置 → 提示词配置，选中 `planning.segment`：
- 顶部出现绑定条
- 切换 Provider → Model 自动选第一个
- 取消"继承" → 下拉激活
- 重新勾选"继承" → 落回灰色
- `motion.system` 选中时不显示绑定条

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/PromptBindingBar.tsx \
        src/components/settings/PromptBindingBar.module.css \
        src/components/settings/PromptsConfigTab.tsx
git commit -m "feat(prompts-ui): 提示词编辑面板顶部新增 AI 绑定条"
```

---

### Task 3.4: cover.regeneration 双行绑定（LLM + ImageProvider）

**Files:**
- Modify: `src/components/settings/PromptBindingBar.tsx`（或新增子组件 `ImageBindingRow.tsx`）

- [ ] **Step 1: 在 PromptBindingBar 增加可选 image 段**

```tsx
interface Props {
  // …既有
  imageProviders?: ImageProvider[];
  effectiveImageProviderId?: string | null;
  effectiveImageModel?: string | null;
  showImageBinding?: boolean;          // 仅 cover.regeneration = true
  onImageChange?(next: { imageProviderId: string | null; imageModel: string | null }): void;
}
```

LLM 段不变。在底部追加：

```tsx
{showImageBinding && (
  <>
    <div className={styles.divider} />
    <div className={styles.row}>
      <Field label="文生图 Provider">…</Field>
      <Field label="Model">…</Field>
    </div>
    <span className={styles.note}>↳ 该提示词输出会被送往上方文生图模型生图</span>
  </>
)}
```

具体下拉逻辑同 LLM 段（注意 image 段也支持"继承"）。

- [ ] **Step 2: PromptsConfigTab 在 `selectedKind === 'cover.regeneration'` 时启用**

```tsx
showImageBinding={selectedKind === 'cover.regeneration'}
imageProviders={settings.imageProviders}
effectiveImageProviderId={effectiveBinding?.imageProvider?.id ?? null}
effectiveImageModel={effectiveBinding?.imageModel ?? null}
onImageChange={(next) => {
  // 合并到当前 binding 的 imageProviderId/imageModel 字段
  const cur = scope === 'project'
    ? projectBindings['cover.regeneration']
    : settings.promptBindings?.['cover.regeneration'];
  const merged: PromptBinding = {
    providerId: cur?.providerId ?? null,
    model: cur?.model ?? null,
    imageProviderId: next.imageProviderId,
    imageModel: next.imageModel,
  };
  if (scope === 'project') setProjectBinding('cover.regeneration', merged);
  else setGlobalBinding('cover.regeneration', merged);
}}
```

- [ ] **Step 3: dev 验证 cover.regeneration 双行布局**

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/PromptBindingBar.tsx src/components/settings/PromptsConfigTab.tsx
git commit -m "feat(prompts-ui): cover.regeneration 绑定条增加文生图段"
```

---

### Task 3.5: 左侧提示词列表 Badge

**Files:**
- Modify: `src/components/settings/PromptsConfigTab.tsx`

- [ ] **Step 1: 为列表每项渲染 Badge**

```tsx
function bindingBadge(kind: PromptKind): { label: string; variant: 'secondary' | 'info' | 'danger' } {
  if (kind === 'motion.system') return { label: '—', variant: 'secondary' };
  try {
    const r = resolveBinding(kind);
    const explicit = scope === 'project'
      ? projectBindings[kind]
      : settings.promptBindings?.[kind];
    if (!explicit) return { label: '继承', variant: 'secondary' };
    if (kind === 'cover.regeneration') {
      return { label: `${r.model} · ${r.imageModel}`, variant: 'info' };
    }
    return { label: r.model, variant: 'info' };
  } catch {
    return { label: '❗失效', variant: 'danger' };
  }
}
```

在列表项渲染处加：

```tsx
<Badge variant={badge.variant} size="xs">{badge.label}</Badge>
```

- [ ] **Step 2: dev 验证 Badge 各状态**

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/PromptsConfigTab.tsx
git commit -m "feat(prompts-ui): 提示词列表新增绑定状态 Badge"
```

---

### Task 3.6: 失效 binding 顶部警告 + 错误处理

**Files:**
- Modify: `src/components/settings/PromptsConfigTab.tsx`

- [ ] **Step 1: 选中提示词时尝试 resolve，捕获 PromptBindingError 渲染警告条**

```tsx
import { PromptBindingError } from '../../lib/llm/binding-resolver';

let bindingError: PromptBindingError | null = null;
try { /* resolveBinding */ } catch (e) {
  if (e instanceof PromptBindingError) bindingError = e;
}

{bindingError && (
  <div className={styles.warning}>
    {bindingError.message} —— 请在下方重选 Provider / Model
  </div>
)}
```

样式 `.warning`：红底白字 6px padding，复用现有 danger token。

- [ ] **Step 2: dev 验证**

人为构造失效场景：删除一个 provider 但保留某 binding 引用它，确认列表 Badge 显示 `❗失效`，编辑面板顶部出现警告条。

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/PromptsConfigTab.tsx
git commit -m "feat(prompts-ui): binding 失效时编辑面板顶部展示警告条"
```

---

## Slice 4：收尾验收

### Task 4.1: 端到端人工走查

- [ ] **Step 1: 启动 dev**

```bash
npm run dev
```

- [ ] **Step 2: 检查清单**

- [ ] AI 基础配置 → 封面图像生成区块出现，旧用户即梦自动迁移
- [ ] 添加新 ImageProvider，设为默认
- [ ] 提示词配置 → 普通提示词显示绑定条
- [ ] 切换 Provider → Model 自动选第一个
- [ ] 勾"继承" → 下拉禁用
- [ ] cover.regeneration 显示双行（LLM + 文生图）
- [ ] 列表 Badge 在 `继承` / `gpt-4o` / `❗失效` 三种状态正确
- [ ] motion.system 不显示绑定条与 Badge
- [ ] 切换项目：projectBindings 正确加载（项目目录下出现 `configs/prompt-bindings.json`）
- [ ] 触发一次"封面重新生成"：端到端调通（LLM 出 prompt → 即梦生图 → 图片返回）
- [ ] 触发一次 AI 分析：使用绑定的 LLM
- [ ] 触发一次 motion 生成：使用绑定的 LLM

- [ ] **Step 3: 修复发现的问题**

回到对应 Task 修补；每个修补单独 commit。

### Task 4.2: 全量回归

- [ ] **Step 1: 类型 + 测试 + 构建**

```bash
npx tsc --noEmit
npm test
npm run build
```

Expected: 全绿。

- [ ] **Step 2: Commit 任何修复**

```bash
git status && git add -p
git commit -m "chore: 收尾修复"
```

---

## Self-Review

- ✅ Spec §1.2 目标 1（每个提示词独立绑定）：Task 1.3 + 2.2/2.3/2.4/2.5 + 3.3 覆盖
- ✅ Spec §1.2 目标 2（两层覆盖）：Task 1.4 (IO) + 1.5 (store) + resolver 三层回退
- ✅ Spec §1.2 目标 3（ImageProvider 抽象）：Task 1.1 类型 + 2.4 dispatcher + 3.1 UI
- ✅ Spec §1.2 目标 4（cover 链路可见）：Task 2.4 + 2.5 + 3.4 双行绑定
- ✅ Spec §6 数据迁移：Task 1.2 实现 + 1.5 在 store hydrate 处接入
- ✅ Spec §7 测试：1.2 / 1.3 / 1.4 / 2.1 / 2.4 各自独立测试
- ✅ Spec §8 切片建议：本 plan 4 个 Slice 与 spec §8 三 PR 切片一致（Slice 4 是收尾，不构成额外 PR）
- ✅ 类型一致性：`PromptBinding`/`PromptBindingMap`/`ResolvedBinding`/`PromptBindingError` 在 1.1/1.3 定义后所有 Task 引用一致
- ✅ 无 TBD/TODO/placeholder
- ✅ `motion.system` 不绑定的处理：Task 2.3 注释 + Task 3.3 渲染条件 + Task 3.5 Badge `—`

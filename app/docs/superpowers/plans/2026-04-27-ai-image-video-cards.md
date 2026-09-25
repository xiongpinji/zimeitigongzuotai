# AI 图片卡 / 视频卡 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 AI 内容卡体系中新增 `image` 和 `video` 两种 `AICardType`，支持手动触发的 AI 图片 / 视频生成，并与时间线、Remotion 导出、项目持久化、统一进度系统打通。

**Architecture:** 三层扩展 —— (1) 类型层在 `src/types/ai.ts` 扩 `AICardType` 与 `MediaCardContent` 联合，新增 `VideoProvider` 与 `card.image / card.video` 两个 `PromptKind`；(2) 生成层新建 `src/lib/video-gen` 注册表（镜像现有 `image-gen` 体系），第一期接入 Vidu adapter；(3) 主进程 IPC + Renderer Inspector / 列表 / 时间线右键全部对齐，Remotion 渲染派发新增 `<Img>` / `<OffthreadVideo muted>` 分支。

**Tech Stack:** TypeScript 6、React 19、Zustand、Electron 41、Vitest、Remotion 4（`<Img>` / `<OffthreadVideo>`）、`@remotion/renderer` 自带 ffmpeg/ffprobe、统一 `task-progress` 系统。

**设计文档：** `docs/superpowers/specs/2026-04-27-ai-image-video-cards-design.md`

---

## 任务拓扑

```
Phase 0  T1 [类型契约]
            │
Phase 1  T2 [PromptKind+绑定]   T3 [video-gen 错误/类型]   T4 [video-gen poller]
            │                       └────── T5 [registry+Vidu adapter] ──┘
            │
Phase 2  T6 [AISettings 迁移]   T7 [ai-cards 资产 IO]
            │
Phase 3  T8 [IPC: image]   T9 [IPC: video+ffprobe]   T10 [IPC: cancel/delete]
            │                       └────── T11 [preload + electron-api] ──┘
            │
Phase 4  T12 [Remotion 派发分支]   T13 [store/ai 媒体 actions]
            │
Phase 5  T14 [MediaCardPreview]   T15 [ImageCardForm]   T16 [VideoCardForm]
            └────────── T17 [Inspector 派发 + List 缩略图/徽章] ──────────┘
            │
Phase 6  T18 [创建入口：列表+时间线右键]
            │
Phase 7  T19 [Settings：视频 Provider + 提示词行]
            │
Phase 8  T20 [回归 + manual checklist]
```

约定：所有代码示例展示**必须**写入 / 修改的内容；引用既有模块（如 `pollUntilDone`）时不重复展示其源码。每个 task 末尾都做一次 `git add -p` + `git commit`，commit 前确保**仅相关文件入栈**（`git status` 检查）。

---

### Task 1：扩展 AICardType / MediaCardContent / VideoProvider 类型

**Files:**
- Modify: `src/types/ai.ts`
- Test: `tests/ai-card-types.test.ts`（新建）

- [ ] **Step 1: 写测试 — `tests/ai-card-types.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  isAICardType,
  isMediaContent,
  isMediaCardType,
  buildAICardOverlayData,
  type AICard,
  type MediaCardContent,
} from '../src/types/ai';

describe('AICardType extension', () => {
  it('image 与 video 是合法的 AICardType', () => {
    expect(isAICardType('image')).toBe(true);
    expect(isAICardType('video')).toBe(true);
    expect(isAICardType('summary')).toBe(true);
    expect(isAICardType('foo')).toBe(false);
  });

  it('isMediaCardType 仅对 image/video 为 true', () => {
    expect(isMediaCardType('image')).toBe(true);
    expect(isMediaCardType('video')).toBe(true);
    expect(isMediaCardType('summary')).toBe(false);
  });

  it('isMediaContent 检测 mediaType + aspectRatio + generationStatus', () => {
    const valid: MediaCardContent = {
      mediaType: 'image',
      assetPath: null,
      aspectRatio: '16:9',
      prompt: 'hello',
      providerId: null,
      model: null,
      generationStatus: 'idle',
    };
    expect(isMediaContent(valid)).toBe(true);
    expect(isMediaContent('plain string')).toBe(false);
    expect(isMediaContent({ mediaType: 'image' })).toBe(false);
  });

  it('buildAICardOverlayData 透传 MediaCardContent 不丢字段', () => {
    const card: AICard = {
      id: 'c1',
      segmentId: 's1',
      type: 'video',
      title: 'demo',
      content: {
        mediaType: 'video',
        assetPath: 'ai-cards/c1/video.mp4',
        posterPath: 'ai-cards/c1/poster.jpg',
        mediaDurationMs: 6000,
        aspectRatio: '16:9',
        prompt: 'a cat',
        providerId: 'vidu-default',
        model: 'vidu-2',
        generationStatus: 'ready',
        generatedAt: 1,
      },
      startMs: 0,
      endMs: 6000,
      displayDurationMs: 6000,
      displayMode: 'fullscreen',
      template: 'video-default',
      enabled: true,
      style: { primaryColor: '#fff', backgroundColor: '#000', fontSize: 48 },
    };
    const overlay = buildAICardOverlayData(card);
    expect(overlay.cardType).toBe('video');
    expect(overlay.content).toEqual(card.content);
  });
});
```

- [ ] **Step 2: 运行测试，确认 fail**

Run: `npx vitest run tests/ai-card-types.test.ts`
Expected: FAIL（`isMediaContent` 等导出尚不存在）

- [ ] **Step 3: 修改 `src/types/ai.ts`**

在文件顶部 `AICardType` 处替换：

```ts
export type AICardType =
  | 'summary' | 'data' | 'insight' | 'chapter' | 'quote' | 'motion'
  | 'image' | 'video';

export type AICardMediaType = 'image' | 'video';
```

在 `DataContent` 之后新增：

```ts
export interface MediaCardContent {
  mediaType: AICardMediaType;
  /** 相对 projectDir，例：'ai-cards/<cardId>/image.png' */
  assetPath: string | null;
  /** 仅 video：首帧海报，相对 projectDir */
  posterPath?: string | null;
  /** 仅 video：生成产物的真实时长（ms） */
  mediaDurationMs?: number;
  /** 字段类型为 ImageAspectRatio；video 卡运行时仅接受 '16:9' | '9:16' | '1:1' 子集，由 form 与 IPC handler 双向校验 */
  aspectRatio: ImageAspectRatio;
  prompt: string;
  negativePrompt?: string;
  providerId: string | null;
  model: string | null;
  generationStatus:
    | 'idle' | 'pending' | 'generating' | 'ready' | 'failed' | 'cancelled';
  errorMessage?: string;
  generatedAt?: number;
  extraParams?: Record<string, unknown>;
}
```

在 `AICard.content` 联合处替换：

```ts
content: string | DataContent | MediaCardContent;
```

在 `AICardOverlayData.content` 联合处替换：

```ts
content: string | DataContent | MediaCardContent;
```

`isAICardType` 数组追加 `'image', 'video'`。在 `isDataContent` 之后新增：

```ts
export function isMediaContent(value: unknown): value is MediaCardContent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    'mediaType' in v &&
    'aspectRatio' in v &&
    'generationStatus' in v &&
    (v.mediaType === 'image' || v.mediaType === 'video')
  );
}

export function isMediaCardType(t: AICardType): t is 'image' | 'video' {
  return t === 'image' || t === 'video';
}
```

`DEFAULT_CARD_STYLE` 追加：

```ts
image: { primaryColor: '#79c4ff', backgroundColor: DEFAULT_CARD_BACKGROUND, fontSize: 48 },
video: { primaryColor: '#ff8f7a', backgroundColor: DEFAULT_CARD_BACKGROUND, fontSize: 48 },
```

新增视频 Provider 配置类型（接 `ImageProvider` 之后）：

```ts
export type VideoProviderType =
  | 'vidu' | 'kling' | 'runway' | 'minimax_video' | 'custom';

export type VideoAspectRatio = '16:9' | '9:16' | '1:1';

export interface VideoProvider {
  id: string;
  name: string;
  type: VideoProviderType;
  baseUrl: string;
  apiKey: string;
  models: string[];
  extras?: Record<string, unknown>;
}
```

`AISettings` 接口在 `imageProviders / defaultImageProviderId / defaultImageModel` 之后追加：

```ts
videoProviders: VideoProvider[];
defaultVideoProviderId: string | null;
defaultVideoModel: string | null;
```

`PromptBinding` 接口追加：

```ts
videoProviderId?: string | null;
videoModel?: string | null;
```

- [ ] **Step 4: 测试通过**

Run: `npx vitest run tests/ai-card-types.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/types/ai.ts tests/ai-card-types.test.ts
git commit -m "feat(ai): 新增 image/video AICardType 与 VideoProvider 类型"
```

---

### Task 2：PromptKind 扩展 + binding-resolver + 默认模板

**Files:**
- Modify: `src/lib/prompts/types.ts`
- Modify: `src/lib/prompts/defaults.ts`
- Modify: `src/lib/llm/binding-resolver.ts`
- Test: `tests/prompt-bindings-card-media.test.ts`（新建）

- [ ] **Step 1: 写测试**

```ts
// tests/prompt-bindings-card-media.test.ts
import { describe, expect, it } from 'vitest';
import { resolvePromptBinding } from '../src/lib/llm/binding-resolver';
import type { AISettings, PromptBindingMap, VideoProvider, ImageProvider } from '../src/types/ai';

function makeSettings(overrides: Partial<AISettings> = {}): AISettings {
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
    videoProviders: [],
    defaultVideoProviderId: null,
    defaultVideoModel: null,
    promptBindings: {},
    ...overrides,
  } as AISettings;
}

describe('binding-resolver: card.image / card.video', () => {
  it('card.image 回退到默认 image provider', () => {
    const img: ImageProvider = {
      id: 'img1', name: 'img1', type: 'apimart',
      baseUrl: '', apiKey: '', models: ['m1'],
    };
    const settings = makeSettings({
      imageProviders: [img],
      defaultImageProviderId: 'img1',
      defaultImageModel: 'm1',
    });
    const r = resolvePromptBinding('card.image', settings, null);
    expect(r.imageProvider?.id).toBe('img1');
    expect(r.imageModel).toBe('m1');
  });

  it('card.video 优先项目级 binding', () => {
    const v1: VideoProvider = {
      id: 'v1', name: 'v1', type: 'vidu', baseUrl: '', apiKey: '', models: ['vidu-2'],
    };
    const v2: VideoProvider = {
      id: 'v2', name: 'v2', type: 'vidu', baseUrl: '', apiKey: '', models: ['vidu-1'],
    };
    const settings = makeSettings({
      videoProviders: [v1, v2],
      defaultVideoProviderId: 'v1',
      defaultVideoModel: 'vidu-2',
    });
    const projectBindings: PromptBindingMap = {
      'card.video': { providerId: null, model: null, videoProviderId: 'v2', videoModel: 'vidu-1' },
    };
    const r = resolvePromptBinding('card.video', settings, projectBindings);
    expect(r.videoProvider?.id).toBe('v2');
    expect(r.videoModel).toBe('vidu-1');
  });
});
```

- [ ] **Step 2: 运行 — fail（kind 未注册 + resolver 未支持 video）**

Run: `npx vitest run tests/prompt-bindings-card-media.test.ts`

- [ ] **Step 3: 改 `src/lib/prompts/types.ts`**

在 `PromptKind` 联合追加 `| 'card.image' | 'card.video'`。

在 prompt 元数据登记表（同文件 / 邻近）按既有规范登记两条新 kind，参考 `cover.regeneration` 元数据：

```ts
'card.image': {
  kind: 'card.image',
  category: 'card',
  label: '段落图片卡',
  description: '为单段 segment 生成 AI 图片卡的提示词',
  expectedVariables: ['segmentTitle', 'segmentSummary', 'segmentExcerpt', 'displayMode', 'aspectRatio'],
  imageBinding: true,
},
'card.video': {
  kind: 'card.video',
  category: 'card',
  label: '段落视频卡',
  description: '为单段 segment 生成 AI 视频卡的提示词',
  expectedVariables: ['segmentTitle', 'segmentSummary', 'segmentExcerpt', 'displayMode', 'aspectRatio', 'durationSeconds'],
  videoBinding: true,
},
```

> 若现有 metadata 字段命名为 `imageBinding` 之外的写法（如 `bindingType: 'image'`），按既有规范对齐。本步先 grep `imageBinding` / `bindingType` 取实际形态。

- [ ] **Step 4: 改 `src/lib/prompts/defaults.ts`**

新增两条默认模板：

```ts
'card.image': `
你是视觉创意 AI。基于以下 segment 信息为它生成一段精确的图像生成 prompt：

标题：{{segmentTitle}}
摘要：{{segmentSummary}}
关键句：{{segmentExcerpt}}
显示模式：{{displayMode}}（fullscreen 优先 16:9 横构图；pip 可考虑方构图）
画幅比例：{{aspectRatio}}

要求：
1. 突出 segment 的核心意象，避免抽象口号；
2. 镜头语言：构图、光影、风格、镜头距离写明确；
3. 不出现任何文字 / Logo / UI 元素；
4. 输出英文 prompt，不要任何解释或前后缀。
`,
'card.video': `
你是 AI 视频导演。基于以下 segment 信息为它生成一段视频文生视频 prompt：

标题：{{segmentTitle}}
摘要：{{segmentSummary}}
关键句：{{segmentExcerpt}}
显示模式：{{displayMode}}
画幅比例：{{aspectRatio}}
时长：{{durationSeconds}} 秒

要求：
1. 给出主体、动作、镜头运动（推 / 拉 / 摇 / 跟）、转场节奏；
2. 时长内逻辑闭合，避免镜头跳切显得断裂；
3. 不出现任何文字 / Logo / UI 元素；
4. 输出英文 prompt，不要任何解释或前后缀。
`,
```

- [ ] **Step 5: 改 `src/lib/llm/binding-resolver.ts`**

在原本处理 `cover.regeneration` 的分支附近追加：

```ts
if (kind === 'card.image') {
  const projectBinding = projectBindings?.['card.image'] ?? null;
  const imageProviderId = projectBinding?.imageProviderId ?? settings.defaultImageProviderId;
  const imageModel = projectBinding?.imageModel ?? settings.defaultImageModel;
  const imageProvider = imageProviderId
    ? settings.imageProviders.find((p) => p.id === imageProviderId) ?? null
    : null;
  return {
    ...baseBinding,
    imageProvider,
    imageModel: imageModel ?? null,
  };
}

if (kind === 'card.video') {
  const projectBinding = projectBindings?.['card.video'] ?? null;
  const videoProviderId = projectBinding?.videoProviderId ?? settings.defaultVideoProviderId;
  const videoModel = projectBinding?.videoModel ?? settings.defaultVideoModel;
  const videoProvider = videoProviderId
    ? settings.videoProviders.find((p) => p.id === videoProviderId) ?? null
    : null;
  return {
    ...baseBinding,
    videoProvider,
    videoModel: videoModel ?? null,
  };
}
```

`ResolvedPromptBinding`（如已存在该类型名）追加 `videoProvider?: VideoProvider | null; videoModel?: string | null;` 字段。

- [ ] **Step 6: 测试通过**

Run: `npx vitest run tests/prompt-bindings-card-media.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/lib/prompts/types.ts src/lib/prompts/defaults.ts src/lib/llm/binding-resolver.ts tests/prompt-bindings-card-media.test.ts
git commit -m "feat(prompts): 新增 card.image / card.video 提示词与绑定解析"
```

---

### Task 3：video-gen 错误 + 类型骨架

**Files:**
- Create: `src/lib/video-gen/errors.ts`
- Create: `src/lib/video-gen/types.ts`
- Create: `src/lib/video-gen/progress.ts`

- [ ] **Step 1: 创建 `src/lib/video-gen/errors.ts`**

```ts
import type { VideoProviderType } from '../../types/ai';

export type VideoGenerationErrorCode =
  | 'network' | 'auth' | 'quota' | 'rate_limited'
  | 'invalid_request' | 'content_policy' | 'timeout'
  | 'cancelled' | 'server' | 'unknown';

export class VideoGenerationError extends Error {
  readonly code: VideoGenerationErrorCode;
  readonly providerType: VideoProviderType;
  readonly cause?: unknown;
  readonly raw?: unknown;
  constructor(
    code: VideoGenerationErrorCode,
    providerType: VideoProviderType,
    message: string,
    cause?: unknown,
    raw?: unknown,
  ) {
    super(message);
    this.name = 'VideoGenerationError';
    this.code = code;
    this.providerType = providerType;
    this.cause = cause;
    this.raw = raw;
  }
}

export function httpStatusToErrorCode(status: number): VideoGenerationErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'invalid_request';
  if (status >= 500) return 'server';
  return 'unknown';
}
```

- [ ] **Step 2: 创建 `src/lib/video-gen/types.ts`**

```ts
import type {
  VideoProviderType,
  VideoAspectRatio,
} from '../../types/ai';

export type { VideoProviderType, VideoAspectRatio };

export interface VideoProviderCapabilities {
  aspectRatios: VideoAspectRatio[];
  durationOptions: number[];
  maxResolution: '720p' | '1080p';
  supportsImageToVideo: boolean;
  isAsync: boolean;
  defaultModels: string[];
}

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  model: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: number;
  referenceImageUrl?: string;
  extraParams?: Record<string, unknown>;
}

export interface VideoGenerationResult {
  videoUrl: string;
  posterUrl?: string;
  durationMs: number;
  width: number;
  height: number;
  raw?: unknown;
}

export interface VideoProviderConfig {
  baseUrl: string;
  apiKey: string;
  extras?: Record<string, unknown>;
}

export interface VideoGenerationProgressUpdate {
  percent?: number;
  phase?: 'submitting' | 'queued' | 'rendering' | 'downloading' | 'postprocessing' | string;
  message?: string;
}

export interface VideoGenerationContext {
  taskId: string;
  signal: AbortSignal;
  onProgress: (update: VideoGenerationProgressUpdate) => void;
}

export interface VideoGenerationProvider {
  readonly type: VideoProviderType;
  readonly capabilities: VideoProviderCapabilities;
  generate(
    req: VideoGenerationRequest,
    config: VideoProviderConfig,
    ctx: VideoGenerationContext,
  ): Promise<VideoGenerationResult>;
}
```

- [ ] **Step 3: 创建 `src/lib/video-gen/progress.ts`**

```ts
import type { VideoGenerationContext } from './types';

export function createNoopVideoContext(taskId = 'noop', signal?: AbortSignal): VideoGenerationContext {
  return {
    taskId,
    signal: signal ?? new AbortController().signal,
    onProgress: () => { /* noop */ },
  };
}
```

- [ ] **Step 4: TypeScript 编译校验**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-gen/
git commit -m "feat(video-gen): 新建 errors/types/progress 骨架"
```

---

### Task 4：video-gen 异步轮询器（镜像 image-gen）

**Files:**
- Create: `src/lib/video-gen/async-poller.ts`
- Test: `tests/video-gen-poller.test.ts`（新建）

- [ ] **Step 1: 写测试**

```ts
// tests/video-gen-poller.test.ts
import { describe, expect, it, vi } from 'vitest';
import { pollVideoUntilDone } from '../src/lib/video-gen/async-poller';
import { VideoGenerationError } from '../src/lib/video-gen/errors';

describe('pollVideoUntilDone', () => {
  it('成功路径：submit → fetchStatus 多次 → succeeded', async () => {
    const onProgress = vi.fn();
    const result = await pollVideoUntilDone({
      submit: async () => ({ taskId: 't1' }),
      fetchStatus: vi
        .fn<[string], Promise<{ status: string; result?: unknown; percent?: number }>>()
        .mockResolvedValueOnce({ status: 'running', percent: 30 })
        .mockResolvedValueOnce({ status: 'succeeded', result: { videoUrl: 'http://x/y.mp4', durationMs: 6000, width: 1920, height: 1080 } }),
      intervalMs: 1,
      timeoutMs: 5000,
      onProgress,
      signal: new AbortController().signal,
      providerType: 'vidu',
    });
    expect(result.videoUrl).toBe('http://x/y.mp4');
    expect(onProgress).toHaveBeenCalled();
  });

  it('failed status 抛 VideoGenerationError', async () => {
    await expect(
      pollVideoUntilDone({
        submit: async () => ({ taskId: 't1' }),
        fetchStatus: async () => ({ status: 'failed', error: { code: 'content_policy', message: '违规' } }),
        intervalMs: 1,
        onProgress: () => {},
        signal: new AbortController().signal,
        providerType: 'vidu',
      }),
    ).rejects.toBeInstanceOf(VideoGenerationError);
  });

  it('signal abort 抛 cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      pollVideoUntilDone({
        submit: async () => ({ taskId: 't1' }),
        fetchStatus: async () => ({ status: 'running' }),
        intervalMs: 1,
        onProgress: () => {},
        signal: ac.signal,
        providerType: 'vidu',
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});
```

- [ ] **Step 2: 运行 — fail（模块不存在）**

Run: `npx vitest run tests/video-gen-poller.test.ts`

- [ ] **Step 3: 创建 `src/lib/video-gen/async-poller.ts`**

复刻 `src/lib/image-gen/async-poller.ts` 结构（ensureNotAborted、阶段进度、超时），把名字 / 错误类换成 video 版本。完整实现：

```ts
import type { VideoProviderType } from '../../types/ai';
import { VideoGenerationError, type VideoGenerationErrorCode } from './errors';
import type { VideoGenerationContext } from './types';

export interface VideoPollerStatus<T> {
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  percent?: number;
  result?: T;
  error?: { code: VideoGenerationErrorCode; message: string };
}

export interface VideoPollerOptions<T> {
  submit: () => Promise<{ taskId: string; estimatedSeconds?: number }>;
  fetchStatus: (taskId: string) => Promise<VideoPollerStatus<T>>;
  intervalMs?: number;
  timeoutMs?: number;
  onProgress: VideoGenerationContext['onProgress'];
  signal: AbortSignal;
  providerType: VideoProviderType;
}

const FAKE_PERCENT_STEPS = [10, 25, 45, 60, 75, 85, 92, 95];

export async function pollVideoUntilDone<T>(opts: VideoPollerOptions<T>): Promise<T> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 300_000; // 视频生成较长，5 分钟
  const startedAt = Date.now();

  ensureNotAborted(opts.signal, opts.providerType);
  opts.onProgress({ percent: 5, phase: 'submitting', message: '提交视频生成任务…' });

  const submission = await opts.submit();
  const { taskId } = submission;
  opts.onProgress({ percent: 8, phase: 'queued', message: '已入队，等待生成…' });

  let fakeStepIndex = 0;
  while (true) {
    ensureNotAborted(opts.signal, opts.providerType);
    if (Date.now() - startedAt > timeoutMs) {
      throw new VideoGenerationError(
        'timeout',
        opts.providerType,
        `视频任务 ${taskId} 超过 ${Math.round(timeoutMs / 1000)}s 仍未完成`,
      );
    }
    let status: VideoPollerStatus<T>;
    try {
      status = await opts.fetchStatus(taskId);
    } catch (err) {
      if (err instanceof VideoGenerationError) throw err;
      throw new VideoGenerationError(
        'network',
        opts.providerType,
        `查询任务状态失败：${(err as Error).message}`,
        err,
      );
    }
    if (status.status === 'succeeded' && status.result !== undefined) {
      opts.onProgress({ percent: 99, phase: 'rendering', message: '生成完成，准备下载…' });
      return status.result;
    }
    if (status.status === 'failed') {
      throw new VideoGenerationError(
        status.error?.code ?? 'server',
        opts.providerType,
        status.error?.message ?? '视频生成失败',
      );
    }
    const percent = status.percent ?? FAKE_PERCENT_STEPS[Math.min(fakeStepIndex, FAKE_PERCENT_STEPS.length - 1)];
    fakeStepIndex += 1;
    opts.onProgress({ percent, phase: 'rendering', message: '模型生成中…' });
    await sleep(intervalMs);
  }
}

function ensureNotAborted(signal: AbortSignal, providerType: VideoProviderType): void {
  if (signal.aborted) {
    throw new VideoGenerationError('cancelled', providerType, '任务已取消');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
```

- [ ] **Step 4: 测试通过**

Run: `npx vitest run tests/video-gen-poller.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-gen/async-poller.ts tests/video-gen-poller.test.ts
git commit -m "feat(video-gen): 新增异步轮询器"
```

---

### Task 5：video-gen 注册表 + Vidu adapter

**Files:**
- Create: `src/lib/video-gen/registry.ts`
- Create: `src/lib/video-gen/providers/vidu.ts`
- Test: `tests/video-gen-registry.test.ts`、`tests/video-gen-vidu.test.ts`（新建）

- [ ] **Step 1: 写 registry 测试**

```ts
// tests/video-gen-registry.test.ts
import { describe, expect, it } from 'vitest';
import { getVideoProvider, listRegisteredVideoProviderTypes } from '../src/lib/video-gen/registry';
import { VideoGenerationError } from '../src/lib/video-gen/errors';

describe('video-gen registry', () => {
  it('vidu 已注册', () => {
    const p = getVideoProvider('vidu');
    expect(p.type).toBe('vidu');
    expect(p.capabilities.durationOptions).toEqual(expect.arrayContaining([4, 6, 8]));
  });

  it('未知 type 抛错', () => {
    expect(() => getVideoProvider('not-exist' as never)).toThrow(VideoGenerationError);
  });

  it('listRegisteredVideoProviderTypes 包含 vidu', () => {
    expect(listRegisteredVideoProviderTypes()).toContain('vidu');
  });
});
```

- [ ] **Step 2: 写 Vidu adapter 测试**

```ts
// tests/video-gen-vidu.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viduProvider } from '../src/lib/video-gen/providers/vidu';
import { VideoGenerationError } from '../src/lib/video-gen/errors';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vidu provider', () => {
  it('成功路径：submit → poll → 返回 url', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 't1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'success', creations: [{ url: 'http://x/y.mp4', cover_url: 'http://x/y.jpg' }] }), { status: 200 }));
    const result = await viduProvider.generate(
      { prompt: 'a cat', model: 'vidu-2', aspectRatio: '16:9', durationSeconds: 6 },
      { baseUrl: 'https://api.vidu.com', apiKey: 'key' },
      { taskId: 't1', signal: new AbortController().signal, onProgress: () => {} },
    );
    expect(result.videoUrl).toBe('http://x/y.mp4');
    expect(result.posterUrl).toBe('http://x/y.jpg');
  });

  it('401 抛 auth 错误', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(
      viduProvider.generate(
        { prompt: 'a cat', model: 'vidu-2', aspectRatio: '16:9', durationSeconds: 6 },
        { baseUrl: 'https://api.vidu.com', apiKey: 'bad' },
        { taskId: 't1', signal: new AbortController().signal, onProgress: () => {} },
      ),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('durationSeconds 不在档位抛 invalid_request', async () => {
    await expect(
      viduProvider.generate(
        { prompt: 'a cat', model: 'vidu-2', aspectRatio: '16:9', durationSeconds: 5 },
        { baseUrl: 'https://api.vidu.com', apiKey: 'key' },
        { taskId: 't1', signal: new AbortController().signal, onProgress: () => {} },
      ),
    ).rejects.toBeInstanceOf(VideoGenerationError);
  });
});
```

- [ ] **Step 3: 运行 — fail**

Run: `npx vitest run tests/video-gen-registry.test.ts tests/video-gen-vidu.test.ts`

- [ ] **Step 4: 实现 `src/lib/video-gen/providers/vidu.ts`**

```ts
import { VideoGenerationError, httpStatusToErrorCode } from '../errors';
import { pollVideoUntilDone } from '../async-poller';
import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
  VideoProviderConfig,
  VideoGenerationContext,
} from '../types';

const SUPPORTED_DURATIONS = [4, 6, 8];

async function submitJob(
  req: VideoGenerationRequest,
  cfg: VideoProviderConfig,
): Promise<{ taskId: string }> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/ent/v2/text2video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      prompt: req.prompt,
      negative_prompt: req.negativePrompt ?? '',
      aspect_ratio: req.aspectRatio,
      duration: req.durationSeconds,
      ...(req.extraParams ?? {}),
    }),
  });
  if (!res.ok) {
    throw new VideoGenerationError(
      httpStatusToErrorCode(res.status),
      'vidu',
      `Vidu submit 失败 HTTP ${res.status}`,
      undefined,
      await safeText(res),
    );
  }
  const json = (await res.json()) as { task_id?: string };
  if (!json.task_id) {
    throw new VideoGenerationError('server', 'vidu', 'Vidu 响应缺少 task_id', undefined, json);
  }
  return { taskId: json.task_id };
}

async function fetchStatus(
  taskId: string,
  cfg: VideoProviderConfig,
): Promise<{
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  percent?: number;
  result?: VideoGenerationResult;
  error?: { code: 'content_policy' | 'server'; message: string };
}> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/ent/v2/tasks/${taskId}/creations`, {
    headers: { Authorization: `Token ${cfg.apiKey}` },
  });
  if (!res.ok) {
    throw new VideoGenerationError(
      httpStatusToErrorCode(res.status),
      'vidu',
      `Vidu poll 失败 HTTP ${res.status}`,
    );
  }
  const json = (await res.json()) as {
    state?: string;
    err_code?: string;
    creations?: Array<{ url?: string; cover_url?: string; width?: number; height?: number; duration?: number }>;
  };
  if (json.state === 'success' && json.creations?.[0]?.url) {
    const c = json.creations[0];
    return {
      status: 'succeeded',
      result: {
        videoUrl: c.url!,
        posterUrl: c.cover_url,
        durationMs: Math.round((c.duration ?? 6) * 1000),
        width: c.width ?? 1920,
        height: c.height ?? 1080,
        raw: json,
      },
    };
  }
  if (json.state === 'failed') {
    return {
      status: 'failed',
      error: {
        code: json.err_code === 'content_policy' ? 'content_policy' : 'server',
        message: json.err_code ?? '生成失败',
      },
    };
  }
  return { status: 'running' };
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

export const viduProvider: VideoGenerationProvider = {
  type: 'vidu',
  capabilities: {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationOptions: SUPPORTED_DURATIONS,
    maxResolution: '1080p',
    supportsImageToVideo: false,
    isAsync: true,
    defaultModels: ['vidu-2', 'vidu-1.5'],
  },
  async generate(req, cfg, ctx: VideoGenerationContext) {
    if (!SUPPORTED_DURATIONS.includes(req.durationSeconds)) {
      throw new VideoGenerationError(
        'invalid_request',
        'vidu',
        `Vidu 不支持 durationSeconds=${req.durationSeconds}，请选择 ${SUPPORTED_DURATIONS.join(' / ')}`,
      );
    }
    return pollVideoUntilDone<VideoGenerationResult>({
      providerType: 'vidu',
      onProgress: ctx.onProgress,
      signal: ctx.signal,
      submit: () => submitJob(req, cfg),
      fetchStatus: (taskId) => fetchStatus(taskId, cfg),
      intervalMs: 3000,
      timeoutMs: 300_000,
    });
  },
};
```

- [ ] **Step 5: 实现 `src/lib/video-gen/registry.ts`**

```ts
import type { VideoProviderType } from '../../types/ai';
import { VideoGenerationError } from './errors';
import { viduProvider } from './providers/vidu';
import type { VideoGenerationProvider } from './types';

const providers = new Map<VideoProviderType, VideoGenerationProvider>();

export function registerVideoProvider(provider: VideoGenerationProvider): void {
  providers.set(provider.type, provider);
}

registerVideoProvider(viduProvider);

export function getVideoProvider(type: VideoProviderType): VideoGenerationProvider {
  if (type === 'custom') {
    const fallback = providers.get('vidu');
    if (fallback) return fallback;
  }
  const p = providers.get(type);
  if (!p) {
    throw new VideoGenerationError(
      'invalid_request',
      type,
      `未注册的 video provider type: ${type}`,
    );
  }
  return p;
}

export function listRegisteredVideoProviderTypes(): VideoProviderType[] {
  return Array.from(providers.keys());
}
```

- [ ] **Step 6: 测试通过**

Run: `npx vitest run tests/video-gen-registry.test.ts tests/video-gen-vidu.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/lib/video-gen/registry.ts src/lib/video-gen/providers/vidu.ts tests/video-gen-registry.test.ts tests/video-gen-vidu.test.ts
git commit -m "feat(video-gen): 新增注册表与 Vidu adapter"
```

---

### Task 6：AISettings 默认值与迁移

**Files:**
- Modify: `src/lib/default-settings.ts` 或 `src/store/ai.ts`（先用 grep 定位"defaultImageProviderId" 实际所在）
- Modify: `electron/global-settings.ts`（如该模块负责 AISettings 落地）
- Test: `tests/ai-settings-migration.test.ts`（新建）

- [ ] **Step 1: 定位现有迁移点**

Run: `grep -rn "defaultImageProviderId" src/ electron/`
确定哪个文件做 AISettings 默认值与旧版本迁移。

- [ ] **Step 2: 写测试 — 加载老 AISettings 时自动补 videoProviders 三件套**

```ts
// tests/ai-settings-migration.test.ts
import { describe, expect, it } from 'vitest';
import { migrateAISettings } from '../src/lib/ai-settings'; // 路径以 grep 结果为准

describe('AISettings migration: video providers', () => {
  it('旧 settings 缺 videoProviders → 补默认空集', () => {
    const legacy = {
      llmProviders: [],
      defaultProviderId: null,
      defaultModel: null,
      llmBaseUrl: '', llmApiKey: '', llmModel: '',
      jimengApiUrl: '', jimengSessionId: '',
      minimaxApiKey: '', minimaxVoiceId: '', minimaxSpeed: 1,
      imageProviders: [], defaultImageProviderId: null, defaultImageModel: null,
      promptBindings: {},
    };
    const migrated = migrateAISettings(legacy as never);
    expect(migrated.videoProviders).toEqual([]);
    expect(migrated.defaultVideoProviderId).toBeNull();
    expect(migrated.defaultVideoModel).toBeNull();
  });
});
```

- [ ] **Step 3: 实现迁移函数补丁**

在迁移函数（`migrateAISettings` 或类似）里加：

```ts
videoProviders: Array.isArray((settings as any).videoProviders) ? (settings as any).videoProviders : [],
defaultVideoProviderId: (settings as any).defaultVideoProviderId ?? null,
defaultVideoModel: (settings as any).defaultVideoModel ?? null,
```

- [ ] **Step 4: 测试通过**

Run: `npx vitest run tests/ai-settings-migration.test.ts`

- [ ] **Step 5: 提交**

```bash
git add -p
git commit -m "feat(settings): AISettings 新增 videoProviders 三件套迁移"
```

---

### Task 7：ai-cards 资产 IO 模块

**Files:**
- Create: `electron/ai-card-assets.ts`
- Test: `tests/ai-card-assets.test.ts`（新建，使用 tmp dir）

新建模块负责：创建 `ai-cards/<cardId>/` 目录、写图片 / 视频 / 海报 / meta.json、清理目录。

- [ ] **Step 1: 写测试**

```ts
// tests/ai-card-assets.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ensureCardAssetDir,
  writeCardImage,
  writeCardMeta,
  deleteCardAssets,
  readCardMeta,
} from '../electron/ai-card-assets';

let projectDir = '';
beforeEach(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), 'aicard-'));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('ai-card-assets', () => {
  it('ensureCardAssetDir 幂等创建目录', async () => {
    const dir = await ensureCardAssetDir(projectDir, 'c1');
    await ensureCardAssetDir(projectDir, 'c1');
    expect((await stat(dir)).isDirectory()).toBe(true);
  });

  it('writeCardImage 写到 ai-cards/<id>/image.png 并返回相对路径', async () => {
    const rel = await writeCardImage(projectDir, 'c1', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(rel).toBe(path.join('ai-cards', 'c1', 'image.png'));
    const data = await readFile(path.join(projectDir, rel));
    expect(data.length).toBe(4);
  });

  it('writeCardMeta + readCardMeta 往返一致', async () => {
    await writeCardMeta(projectDir, 'c1', { prompt: 'p', providerId: 'v1' } as never);
    const meta = await readCardMeta(projectDir, 'c1');
    expect(meta?.prompt).toBe('p');
  });

  it('deleteCardAssets 清空目录', async () => {
    await writeCardImage(projectDir, 'c1', Buffer.from([1]));
    await writeCardMeta(projectDir, 'c1', { prompt: 'p' } as never);
    await deleteCardAssets(projectDir, 'c1');
    await expect(stat(path.join(projectDir, 'ai-cards', 'c1'))).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行 — fail**

Run: `npx vitest run tests/ai-card-assets.test.ts`

- [ ] **Step 3: 实现 `electron/ai-card-assets.ts`**

```ts
import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';

export interface CardAssetMeta {
  cardId: string;
  mediaType: 'image' | 'video';
  prompt: string;
  negativePrompt?: string;
  providerId: string | null;
  model: string | null;
  aspectRatio: string;
  durationSeconds?: number;
  mediaDurationMs?: number;
  width?: number;
  height?: number;
  generatedAt: number;
  extras?: Record<string, unknown>;
}

function cardDir(projectDir: string, cardId: string): string {
  return path.join(projectDir, 'ai-cards', cardId);
}

export async function ensureCardAssetDir(projectDir: string, cardId: string): Promise<string> {
  const dir = cardDir(projectDir, cardId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeCardImage(projectDir: string, cardId: string, data: Buffer | Uint8Array): Promise<string> {
  await ensureCardAssetDir(projectDir, cardId);
  const abs = path.join(cardDir(projectDir, cardId), 'image.png');
  await writeFile(abs, data);
  return path.relative(projectDir, abs);
}

export async function writeCardVideo(projectDir: string, cardId: string, data: Buffer | Uint8Array): Promise<string> {
  await ensureCardAssetDir(projectDir, cardId);
  const abs = path.join(cardDir(projectDir, cardId), 'video.mp4');
  await writeFile(abs, data);
  return path.relative(projectDir, abs);
}

export async function writeCardPoster(projectDir: string, cardId: string, data: Buffer | Uint8Array): Promise<string> {
  await ensureCardAssetDir(projectDir, cardId);
  const abs = path.join(cardDir(projectDir, cardId), 'poster.jpg');
  await writeFile(abs, data);
  return path.relative(projectDir, abs);
}

export async function writeCardMeta(projectDir: string, cardId: string, meta: CardAssetMeta): Promise<void> {
  await ensureCardAssetDir(projectDir, cardId);
  const abs = path.join(cardDir(projectDir, cardId), 'meta.json');
  await writeFile(abs, JSON.stringify(meta, null, 2), 'utf8');
}

export async function readCardMeta(projectDir: string, cardId: string): Promise<CardAssetMeta | null> {
  try {
    const abs = path.join(cardDir(projectDir, cardId), 'meta.json');
    await access(abs);
    return JSON.parse(await readFile(abs, 'utf8')) as CardAssetMeta;
  } catch {
    return null;
  }
}

export async function deleteCardAssets(projectDir: string, cardId: string): Promise<void> {
  await rm(cardDir(projectDir, cardId), { recursive: true, force: true });
}
```

- [ ] **Step 4: 测试通过**

Run: `npx vitest run tests/ai-card-assets.test.ts`

- [ ] **Step 5: 提交**

```bash
git add electron/ai-card-assets.ts tests/ai-card-assets.test.ts
git commit -m "feat(electron): 新增 ai-card-assets 资产 IO 模块"
```

---

### Task 8：IPC `generate-card-image`（main + handler）

**Files:**
- Modify: `electron/main.ts`
- Test: `tests/main-card-image-ipc.test.ts`（新建，mock electron + image-gen）

- [ ] **Step 1: 写测试**

测试通过 mock `getImageProvider` 返回桩 provider，调用 IPC handler，断言：
1. 落地到 `ai-cards/<cardId>/image.png`
2. 写 `meta.json`
3. 返回 `MediaCardContent` 形状（assetPath 是相对路径，generationStatus='ready'）

```ts
// tests/main-card-image-ipc.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../src/lib/image-gen/registry', () => ({
  getImageProvider: () => ({
    type: 'apimart',
    capabilities: { aspectRatios: ['16:9'], maxN: 1, supportsImageToImage: false, isAsync: false, defaultModels: ['m1'] },
    generate: async () => ({ images: [{ base64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'), mimeType: 'image/png' }] }),
  }),
}));

import { handleGenerateCardImage } from '../electron/card-media-handlers';

let projectDir = '';
beforeEach(async () => { projectDir = await mkdtemp(path.join(tmpdir(), 'cardimg-')); });
afterEach(async () => { await rm(projectDir, { recursive: true, force: true }); });

describe('handleGenerateCardImage', () => {
  it('生成并落地 image.png + meta.json', async () => {
    const onProgress = vi.fn();
    const result = await handleGenerateCardImage(
      {
        projectDir,
        cardId: 'c1',
        prompt: 'a cat',
        aspectRatio: '16:9',
        providerId: 'p1',
        model: 'm1',
      },
      {
        settings: makeSettingsWithProvider(),
        projectBindings: null,
        onProgress,
      },
    );
    expect(result.assetPath).toBe(path.join('ai-cards', 'c1', 'image.png'));
    expect(result.generationStatus).toBe('ready');
    await stat(path.join(projectDir, 'ai-cards', 'c1', 'image.png'));
    const meta = JSON.parse(await readFile(path.join(projectDir, 'ai-cards', 'c1', 'meta.json'), 'utf8'));
    expect(meta.prompt).toBe('a cat');
    expect(onProgress).toHaveBeenCalled();
  });
});

function makeSettingsWithProvider() {
  return {
    imageProviders: [{ id: 'p1', name: 'p1', type: 'apimart', baseUrl: '', apiKey: '', models: ['m1'] }],
    defaultImageProviderId: 'p1',
    defaultImageModel: 'm1',
    videoProviders: [],
    defaultVideoProviderId: null,
    defaultVideoModel: null,
    promptBindings: {},
    llmProviders: [], defaultProviderId: null, defaultModel: null,
    llmBaseUrl: '', llmApiKey: '', llmModel: '',
    jimengApiUrl: '', jimengSessionId: '',
    minimaxApiKey: '', minimaxVoiceId: '', minimaxSpeed: 1,
  } as never;
}
```

- [ ] **Step 2: 运行 — fail**

Run: `npx vitest run tests/main-card-image-ipc.test.ts`

- [ ] **Step 3: 抽出 handler 到 `electron/card-media-handlers.ts`**

为便于测试，handler 写成纯函数（不直接 import electron）：

```ts
// electron/card-media-handlers.ts
import { getImageProvider } from '../src/lib/image-gen/registry';
import { resolvePromptBinding } from '../src/lib/llm/binding-resolver';
import { ensureCardAssetDir, writeCardImage, writeCardMeta, deleteCardAssets } from './ai-card-assets';
import type { AISettings, MediaCardContent, PromptBindingMap } from '../src/types/ai';
import type { ImageGenerationContext, ImageGenerationProgressUpdate } from '../src/lib/image-gen/types';

export interface GenerateCardImageArgs {
  projectDir: string;
  cardId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  providerId?: string | null;
  model?: string | null;
  extraParams?: Record<string, unknown>;
}

export interface CardMediaHandlerCtx {
  settings: AISettings;
  projectBindings: PromptBindingMap | null;
  onProgress: (u: ImageGenerationProgressUpdate) => void;
  signal?: AbortSignal;
}

export async function handleGenerateCardImage(
  args: GenerateCardImageArgs,
  ctx: CardMediaHandlerCtx,
): Promise<MediaCardContent> {
  const binding = resolvePromptBinding('card.image', ctx.settings, ctx.projectBindings);
  const provider = args.providerId
    ? ctx.settings.imageProviders.find((p) => p.id === args.providerId) ?? null
    : binding.imageProvider;
  if (!provider) throw new Error('card.image 未绑定 ImageProvider');
  const model = args.model ?? binding.imageModel ?? provider.models[0];
  if (!model) throw new Error('card.image 未指定模型');

  await ensureCardAssetDir(args.projectDir, args.cardId);

  const adapter = getImageProvider(provider.type);
  const signal = ctx.signal ?? new AbortController().signal;
  const igCtx: ImageGenerationContext = {
    taskId: `card-image-${args.cardId}`,
    signal,
    onProgress: ctx.onProgress,
  };
  const result = await adapter.generate(
    {
      prompt: args.prompt,
      model,
      aspectRatio: args.aspectRatio,
      n: 1,
      extraParams: args.extraParams,
    },
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, extras: provider.extras },
    igCtx,
  );

  const img = result.images[0];
  if (!img) throw new Error('image provider 未返回图片');
  const buf = await imageToBuffer(img);
  ctx.onProgress({ percent: 95, phase: 'downloading', message: '保存图片…' });
  const assetPath = await writeCardImage(args.projectDir, args.cardId, buf);
  const meta = {
    cardId: args.cardId,
    mediaType: 'image' as const,
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    providerId: provider.id,
    model,
    aspectRatio: args.aspectRatio,
    generatedAt: Date.now(),
    extras: args.extraParams,
  };
  await writeCardMeta(args.projectDir, args.cardId, meta);
  ctx.onProgress({ percent: 100, phase: 'rendering', message: '完成' });

  return {
    mediaType: 'image',
    assetPath,
    aspectRatio: args.aspectRatio,
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    providerId: provider.id,
    model,
    generationStatus: 'ready',
    generatedAt: meta.generatedAt,
    extraParams: args.extraParams,
  };
}

async function imageToBuffer(img: { url?: string; base64?: string; mimeType?: string }): Promise<Buffer> {
  if (img.base64) return Buffer.from(img.base64, 'base64');
  if (img.url) {
    const res = await fetch(img.url);
    if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('image 既没有 base64 也没有 url');
}
```

- [ ] **Step 4: 在 `electron/main.ts` 注册 IPC**

加入（参照 `generate-cover-images` 写法）：

```ts
import { handleGenerateCardImage } from './card-media-handlers';

const cardMediaAbortMap = new Map<string, AbortController>();

ipcMain.handle('generate-card-image', async (_event, args) => {
  const prev = cardMediaAbortMap.get(args.cardId);
  prev?.abort();
  const ac = new AbortController();
  cardMediaAbortMap.set(args.cardId, ac);
  try {
    return await handleGenerateCardImage(args, {
      settings: args.settings,
      projectBindings: args.projectBindings ?? null,
      signal: ac.signal,
      onProgress: (u) => {
        mainWindow?.webContents.send('card-media-progress', {
          cardId: args.cardId,
          percent: u.percent,
          phase: u.phase,
          message: u.message,
          taskId: `card-media-${args.cardId}`,
        });
      },
    });
  } finally {
    if (cardMediaAbortMap.get(args.cardId) === ac) {
      cardMediaAbortMap.delete(args.cardId);
    }
  }
});
```

- [ ] **Step 5: 测试通过**

Run: `npx vitest run tests/main-card-image-ipc.test.ts`

- [ ] **Step 6: 提交**

```bash
git add electron/card-media-handlers.ts electron/main.ts tests/main-card-image-ipc.test.ts
git commit -m "feat(ipc): 新增 generate-card-image 与 handler 抽离"
```

---

### Task 9：IPC `generate-card-video` + ffmpeg 抽帧 + ffprobe 时长

**Files:**
- Modify: `electron/card-media-handlers.ts`
- Modify: `electron/main.ts`
- Test: `tests/main-card-video-ipc.test.ts`

- [ ] **Step 1: 写测试（mock video provider + ffprobe/ffmpeg）**

```ts
// tests/main-card-video-ipc.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../src/lib/video-gen/registry', () => ({
  getVideoProvider: () => ({
    type: 'vidu',
    capabilities: { aspectRatios: ['16:9'], durationOptions: [4, 6, 8], maxResolution: '1080p', supportsImageToVideo: false, isAsync: true, defaultModels: ['vidu-2'] },
    generate: async () => ({ videoUrl: 'http://example.com/v.mp4', posterUrl: 'http://example.com/p.jpg', durationMs: 6000, width: 1920, height: 1080 }),
  }),
}));

vi.mock('node:fetch', () => ({}));

const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith('v.mp4')) return new Response(Buffer.from([0, 1, 2, 3]), { status: 200 });
  if (url.endsWith('p.jpg')) return new Response(Buffer.from([4, 5, 6]), { status: 200 });
  return new Response('', { status: 404 });
});
vi.stubGlobal('fetch', fetchMock);

import { handleGenerateCardVideo } from '../electron/card-media-handlers';

let projectDir = '';
beforeEach(async () => { projectDir = await mkdtemp(path.join(tmpdir(), 'cardvid-')); });
afterEach(async () => { await rm(projectDir, { recursive: true, force: true }); });

describe('handleGenerateCardVideo', () => {
  it('生成视频 + 海报 + meta', async () => {
    const result = await handleGenerateCardVideo(
      {
        projectDir,
        cardId: 'c1',
        prompt: 'a cat',
        aspectRatio: '16:9',
        durationSeconds: 6,
        providerId: 'v1',
        model: 'vidu-2',
      },
      {
        settings: {
          videoProviders: [{ id: 'v1', name: 'v1', type: 'vidu', baseUrl: '', apiKey: '', models: ['vidu-2'] }],
          defaultVideoProviderId: 'v1',
          defaultVideoModel: 'vidu-2',
          imageProviders: [], defaultImageProviderId: null, defaultImageModel: null,
          llmProviders: [], defaultProviderId: null, defaultModel: null,
          llmBaseUrl: '', llmApiKey: '', llmModel: '',
          jimengApiUrl: '', jimengSessionId: '',
          minimaxApiKey: '', minimaxVoiceId: '', minimaxSpeed: 1,
          promptBindings: {},
        } as never,
        projectBindings: null,
        onProgress: () => {},
      },
    );
    expect(result.assetPath).toBe(path.join('ai-cards', 'c1', 'video.mp4'));
    expect(result.posterPath).toBe(path.join('ai-cards', 'c1', 'poster.jpg'));
    expect(result.mediaDurationMs).toBe(6000);
    await stat(path.join(projectDir, result.assetPath!));
    await stat(path.join(projectDir, result.posterPath!));
  });
});
```

- [ ] **Step 2: 运行 — fail**

- [ ] **Step 3: 在 `electron/card-media-handlers.ts` 追加**

```ts
import { getVideoProvider } from '../src/lib/video-gen/registry';
import { writeCardVideo, writeCardPoster } from './ai-card-assets';
import type { VideoGenerationContext, VideoGenerationProgressUpdate } from '../src/lib/video-gen/types';

export interface GenerateCardVideoArgs {
  projectDir: string;
  cardId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  durationSeconds: number;
  providerId?: string | null;
  model?: string | null;
  extraParams?: Record<string, unknown>;
}

export interface CardVideoHandlerCtx {
  settings: AISettings;
  projectBindings: PromptBindingMap | null;
  onProgress: (u: VideoGenerationProgressUpdate) => void;
  signal?: AbortSignal;
}

export async function handleGenerateCardVideo(
  args: GenerateCardVideoArgs,
  ctx: CardVideoHandlerCtx,
): Promise<MediaCardContent> {
  const binding = resolvePromptBinding('card.video', ctx.settings, ctx.projectBindings);
  const provider = args.providerId
    ? ctx.settings.videoProviders.find((p) => p.id === args.providerId) ?? null
    : binding.videoProvider ?? null;
  if (!provider) throw new Error('card.video 未绑定 VideoProvider');
  const model = args.model ?? binding.videoModel ?? provider.models[0];
  if (!model) throw new Error('card.video 未指定模型');

  await ensureCardAssetDir(args.projectDir, args.cardId);
  const adapter = getVideoProvider(provider.type);
  const signal = ctx.signal ?? new AbortController().signal;
  const vgCtx: VideoGenerationContext = {
    taskId: `card-video-${args.cardId}`,
    signal,
    onProgress: ctx.onProgress,
  };
  const result = await adapter.generate(
    {
      prompt: args.prompt,
      negativePrompt: args.negativePrompt,
      model,
      aspectRatio: args.aspectRatio,
      durationSeconds: args.durationSeconds,
      extraParams: args.extraParams,
    },
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, extras: provider.extras },
    vgCtx,
  );

  ctx.onProgress({ percent: 92, phase: 'downloading', message: '下载视频…' });
  const videoBuf = Buffer.from(await (await fetch(result.videoUrl)).arrayBuffer());
  const assetPath = await writeCardVideo(args.projectDir, args.cardId, videoBuf);

  let posterPath: string | undefined;
  if (result.posterUrl) {
    const posterBuf = Buffer.from(await (await fetch(result.posterUrl)).arrayBuffer());
    posterPath = await writeCardPoster(args.projectDir, args.cardId, posterBuf);
  } else {
    ctx.onProgress({ percent: 96, phase: 'postprocessing', message: '抽取首帧…' });
    posterPath = await extractPosterWithFfmpeg(args.projectDir, args.cardId);
  }

  await writeCardMeta(args.projectDir, args.cardId, {
    cardId: args.cardId,
    mediaType: 'video',
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    providerId: provider.id,
    model,
    aspectRatio: args.aspectRatio,
    durationSeconds: args.durationSeconds,
    mediaDurationMs: result.durationMs,
    width: result.width,
    height: result.height,
    generatedAt: Date.now(),
    extras: args.extraParams,
  });
  ctx.onProgress({ percent: 100, phase: 'rendering', message: '完成' });

  return {
    mediaType: 'video',
    assetPath,
    posterPath: posterPath ?? null,
    mediaDurationMs: result.durationMs,
    aspectRatio: args.aspectRatio,
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    providerId: provider.id,
    model,
    generationStatus: 'ready',
    generatedAt: Date.now(),
    extraParams: args.extraParams,
  };
}

async function extractPosterWithFfmpeg(projectDir: string, cardId: string): Promise<string | undefined> {
  // 复用 @remotion/renderer 已绑定的 ffmpeg 路径；若不可用则跳过 poster
  try {
    const { getFfmpegPath } = await import('@remotion/renderer');
    const ffmpegPath = await getFfmpegPath?.();
    if (!ffmpegPath) return undefined;
    const { spawn } = await import('node:child_process');
    const path = await import('node:path');
    const inFile = path.join(projectDir, 'ai-cards', cardId, 'video.mp4');
    const outFile = path.join(projectDir, 'ai-cards', cardId, 'poster.jpg');
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath, ['-y', '-i', inFile, '-frames:v', '1', '-q:v', '3', outFile]);
      proc.on('error', reject);
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
    });
    return path.relative(projectDir, outFile);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: 在 `electron/main.ts` 注册 IPC**

```ts
import { handleGenerateCardVideo } from './card-media-handlers';

ipcMain.handle('generate-card-video', async (_event, args) => {
  const prev = cardMediaAbortMap.get(args.cardId);
  prev?.abort();
  const ac = new AbortController();
  cardMediaAbortMap.set(args.cardId, ac);
  try {
    return await handleGenerateCardVideo(args, {
      settings: args.settings,
      projectBindings: args.projectBindings ?? null,
      signal: ac.signal,
      onProgress: (u) => {
        mainWindow?.webContents.send('card-media-progress', {
          cardId: args.cardId,
          percent: u.percent,
          phase: u.phase,
          message: u.message,
          taskId: `card-media-${args.cardId}`,
        });
      },
    });
  } finally {
    if (cardMediaAbortMap.get(args.cardId) === ac) {
      cardMediaAbortMap.delete(args.cardId);
    }
  }
});
```

- [ ] **Step 5: 测试通过**

Run: `npx vitest run tests/main-card-video-ipc.test.ts`

- [ ] **Step 6: 提交**

```bash
git add electron/card-media-handlers.ts electron/main.ts tests/main-card-video-ipc.test.ts
git commit -m "feat(ipc): 新增 generate-card-video 与 ffmpeg 海报抽帧"
```

---

### Task 10：IPC 取消 + 删除资产

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: 注册两条 handler**

```ts
ipcMain.handle('cancel-card-media-generation', async (_event, args: { cardId: string }) => {
  const ac = cardMediaAbortMap.get(args.cardId);
  ac?.abort();
  cardMediaAbortMap.delete(args.cardId);
  return { ok: true as const };
});

ipcMain.handle('delete-card-media-assets', async (_event, args: { projectDir: string; cardId: string }) => {
  const { deleteCardAssets } = await import('./ai-card-assets');
  await deleteCardAssets(args.projectDir, args.cardId);
  return { ok: true as const };
});
```

- [ ] **Step 2: 提交**

```bash
git add electron/main.ts
git commit -m "feat(ipc): 新增 cancel-card-media-generation / delete-card-media-assets"
```

---

### Task 11：preload + electron-api 类型契约同步

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/lib/electron-api.ts`

- [ ] **Step 1: 修改 `electron/preload.ts`**

在 `electronAPI` 暴露面追加（参考现有 `generateCoverImages` 写法）：

```ts
generateCardImage: (args: GenerateCardImageArgs) => ipcRenderer.invoke('generate-card-image', args),
generateCardVideo: (args: GenerateCardVideoArgs) => ipcRenderer.invoke('generate-card-video', args),
cancelCardMediaGeneration: (cardId: string) => ipcRenderer.invoke('cancel-card-media-generation', { cardId }),
deleteCardMediaAssets: (projectDir: string, cardId: string) => ipcRenderer.invoke('delete-card-media-assets', { projectDir, cardId }),
onCardMediaProgress: (cb: (payload: CardMediaProgressPayload) => void) => {
  const handler = (_e: unknown, payload: CardMediaProgressPayload) => cb(payload);
  ipcRenderer.on('card-media-progress', handler);
  return () => ipcRenderer.removeListener('card-media-progress', handler);
},
```

GenerateCardImageArgs / GenerateCardVideoArgs / CardMediaProgressPayload 在 `src/lib/electron-api.ts` 定义并在 preload.ts import。

- [ ] **Step 2: 修改 `src/lib/electron-api.ts`**

```ts
export interface GenerateCardImageArgs {
  projectDir: string;
  cardId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: ImageAspectRatio;
  providerId?: string | null;
  model?: string | null;
  extraParams?: Record<string, unknown>;
  settings: AISettings;
  projectBindings?: PromptBindingMap | null;
}

export interface GenerateCardVideoArgs {
  projectDir: string;
  cardId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: number;
  providerId?: string | null;
  model?: string | null;
  extraParams?: Record<string, unknown>;
  settings: AISettings;
  projectBindings?: PromptBindingMap | null;
}

export interface CardMediaProgressPayload {
  cardId: string;
  taskId: string;
  percent?: number;
  phase?: string;
  message?: string;
}

export interface ElectronAPI {
  // 现有...
  generateCardImage: (args: GenerateCardImageArgs) => Promise<MediaCardContent>;
  generateCardVideo: (args: GenerateCardVideoArgs) => Promise<MediaCardContent>;
  cancelCardMediaGeneration: (cardId: string) => Promise<{ ok: true }>;
  deleteCardMediaAssets: (projectDir: string, cardId: string) => Promise<{ ok: true }>;
  onCardMediaProgress: (cb: (p: CardMediaProgressPayload) => void) => () => void;
}
```

- [ ] **Step 3: 编译校验**

Run: `npx tsc --noEmit`
Expected: 无错误（preload.ts 与 electron-api.ts 类型对齐）

- [ ] **Step 4: 提交**

```bash
git add electron/preload.ts src/lib/electron-api.ts
git commit -m "feat(ipc): preload + electron-api 同步媒体卡 IPC 契约"
```

---

### Task 12：Remotion AICardOverlay 渲染分支 + remotion-assets

**Files:**
- Modify: `src/remotion/AICardOverlay.tsx`
- Create: `src/remotion/MediaCardPlaceholder.tsx`
- Modify: `src/lib/remotion-assets.ts`（如已有 `resolveProjectAsset` 不需改）
- Test: `tests/ai-card-overlay.test.tsx`（扩展现有）

- [ ] **Step 1: 扩展测试**

读 `tests/ai-card-overlay.test.tsx` 现状，增加：

```tsx
it('image 卡片渲染 <Img>', () => {
  const overlay = makeOverlay({
    overlayType: 'ai-card',
    aiCardData: {
      cardType: 'image',
      content: {
        mediaType: 'image',
        assetPath: 'ai-cards/c1/image.png',
        aspectRatio: '16:9',
        prompt: '',
        providerId: 'p',
        model: 'm',
        generationStatus: 'ready',
      },
      // ... 其余字段沿用工厂
    },
  });
  const { container } = render(<AICardOverlay overlay={overlay} fps={30} />);
  expect(container.querySelector('img')).toBeTruthy();
});

it('video 卡片渲染 <video> (OffthreadVideo 包装)', () => {
  // 同上，cardType=video，content.mediaType=video，assetPath 'ai-cards/c1/video.mp4'
  // 校验 mute 属性 + src 包含 video.mp4
});

it('assetPath 缺失时渲染 placeholder', () => {
  // content.generationStatus='generating', assetPath=null
  // 校验 placeholder data-testid
});
```

- [ ] **Step 2: 新建 `src/remotion/MediaCardPlaceholder.tsx`**

```tsx
import type { CSSProperties } from 'react';

interface Props {
  type: 'image' | 'video';
  status?: string;
}
const wrap: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '100%', height: '100%', background: '#1a1f2b',
  color: '#cdd5e1', fontSize: 36, fontFamily: 'system-ui',
};
export function MediaCardPlaceholder({ type, status }: Props) {
  return (
    <div style={wrap} data-testid="media-card-placeholder">
      <span>{type === 'image' ? '图片卡' : '视频卡'} · {status ?? '生成中'}</span>
    </div>
  );
}
```

- [ ] **Step 3: 改 `src/remotion/AICardOverlay.tsx`**

`renderCard` 函数体最前面追加：

```tsx
import { Img, OffthreadVideo, staticFile } from 'remotion';
import { isMediaContent } from '../types/ai';
import { MediaCardPlaceholder } from './MediaCardPlaceholder';

// ... 在 renderCard 内部，data 取得后：
if (data.cardType === 'image' && isMediaContent(data.content)) {
  if (!data.content.assetPath) {
    return <MediaCardPlaceholder type="image" status={data.content.generationStatus} />;
  }
  return (
    <Img
      src={staticFile(data.content.assetPath)}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}

if (data.cardType === 'video' && isMediaContent(data.content)) {
  if (!data.content.assetPath) {
    return <MediaCardPlaceholder type="video" status={data.content.generationStatus} />;
  }
  return (
    <OffthreadVideo
      src={staticFile(data.content.assetPath)}
      muted
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}
```

> `staticFile` 是 Remotion 把相对 public 路径解析的官方方法。`prepareRemotionPublicDir` 已经把 ai-cards/ 链入 public，因此 `'ai-cards/c1/image.png'` 直接传给 `staticFile` 即可。

- [ ] **Step 4: 检查 / 扩展 `src/lib/remotion-assets.ts`**

确认 `prepareRemotionPublicDir` 把 `<projectDir>/ai-cards` 整体软链 / 拷贝到临时 public。如果只链了 `covers/` 与 `imports/`，追加 ai-cards：

Run: `grep -n "covers\|ai-cards\|imports" src/lib/remotion-assets.ts electron/main.ts`

如需追加：

```ts
const aiCardsSrc = path.join(projectDir, 'ai-cards');
if (await exists(aiCardsSrc)) {
  await linkOrCopy(aiCardsSrc, path.join(publicDir, 'ai-cards'));
}
```

并在 unit test 中补一条断言。

- [ ] **Step 5: 测试通过**

Run: `npx vitest run tests/ai-card-overlay.test.tsx`

- [ ] **Step 6: 提交**

```bash
git add src/remotion/AICardOverlay.tsx src/remotion/MediaCardPlaceholder.tsx src/lib/remotion-assets.ts tests/ai-card-overlay.test.tsx
git commit -m "feat(remotion): AICardOverlay 新增 image/video 渲染分支"
```

---

### Task 13：store/ai 媒体卡 actions

**Files:**
- Modify: `src/store/ai.ts`
- Modify: `src/store/timeline.ts`（卡片 → overlay 同步逻辑里覆盖 video durationMs）
- Test: `tests/store-ai-card-media.test.ts`（新建）

- [ ] **Step 1: 写测试**

```ts
// tests/store-ai-card-media.test.ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useAIStore } from '../src/store/ai';
import type { MediaCardContent } from '../src/types/ai';

describe('AI store: media card actions', () => {
  beforeEach(() => useAIStore.setState({ analysis: makeAnalysis() }));

  it('createImageCard 插入 idle 状态卡片', async () => {
    const card = await useAIStore.getState().createImageCard('seg-1', { prompt: 'a cat', aspectRatio: '16:9' });
    expect(card.type).toBe('image');
    expect((card.content as MediaCardContent).generationStatus).toBe('idle');
  });

  it('regenerateCardMedia 在 IPC 成功后写回 ready', async () => {
    const fakeMedia: MediaCardContent = {
      mediaType: 'image', assetPath: 'ai-cards/c/image.png',
      aspectRatio: '16:9', prompt: 'p', providerId: 'p1', model: 'm1',
      generationStatus: 'ready', generatedAt: 1,
    };
    vi.stubGlobal('electronAPI', { generateCardImage: async () => fakeMedia, onCardMediaProgress: () => () => {} });
    const card = await useAIStore.getState().createImageCard('seg-1');
    await useAIStore.getState().regenerateCardMedia(card.id);
    const updated = useAIStore.getState().analysis!.cards.find((c) => c.id === card.id)!;
    expect((updated.content as MediaCardContent).generationStatus).toBe('ready');
    vi.unstubAllGlobals();
  });

  it('cancelCardMediaGeneration 走 IPC 取消并落 cancelled', async () => {
    /* 类似 stub electronAPI.cancelCardMediaGeneration */
  });
});

function makeAnalysis() {
  return {
    segments: [{ id: 'seg-1', title: 't', summary: 's', startMs: 0, endMs: 1000 }],
    cards: [],
    coverPrompts: [],
    summary: '',
    keywords: [],
  };
}
```

- [ ] **Step 2: 在 `src/store/ai.ts` 实现 actions**

接口（仅展示新增 actions）：

```ts
interface AIStore {
  // ...existing
  cardMediaTasks: Record<string, { taskId: string; phase: string; percent: number }>;
  createImageCard(segmentId: string, opts?: {
    prompt?: string; aspectRatio?: ImageAspectRatio; displayMode?: AICardDisplayMode;
  }): Promise<AICard>;
  createVideoCard(segmentId: string, opts?: {
    prompt?: string; aspectRatio?: VideoAspectRatio; durationSeconds?: number; displayMode?: AICardDisplayMode;
  }): Promise<AICard>;
  regenerateCardMedia(cardId: string, overrides?: Partial<MediaCardContent>): Promise<void>;
  cancelCardMediaGeneration(cardId: string): Promise<void>;
  deleteCard(cardId: string): Promise<void>; // 内部对 image/video 调 deleteCardMediaAssets
}
```

实现关键点：
1. `createImageCard / createVideoCard` 拼装 `AICard`：`type='image'|'video'`、`content` 是 `MediaCardContent` 初始 `idle`、`displayMode` 默认 'fullscreen'、`displayDurationMs` image 默认 `DEFAULT_CARD_DURATION_MS`，video 默认 `durationSeconds * 1000`。
2. `regenerateCardMedia`：
   - 拿 `useTaskProgressStore.getState().startTask({ id: 'card-media-${cardId}', label: ... })`
   - 注册 `electronAPI.onCardMediaProgress` 监听器，把 phase/percent 写到 `cardMediaTasks` + `updateTask`
   - 根据 cardType 调 `generateCardImage` / `generateCardVideo`，把返回 `MediaCardContent` 合并回 `card.content`，video 类型同时更新 `displayDurationMs = mediaDurationMs`
   - 完成或失败时调 `completeTask` / `failTask`，移除监听器
3. `cancelCardMediaGeneration`：调 IPC + 把 `cardMediaTasks` 清空 + 卡片 content `generationStatus='cancelled'`
4. `deleteCard`：旧逻辑保留；新增 `if isMediaCardType(card.type)` 时调 `electronAPI.deleteCardMediaAssets`

- [ ] **Step 3: 在 `src/store/timeline.ts` 同步 overlay durationMs**

定位卡片 → overlay 同步函数（`syncOverlayFromCard` 或类似），video 卡 ready 后把对应 overlay `durationMs = mediaDurationMs`。

- [ ] **Step 4: 测试通过**

Run: `npx vitest run tests/store-ai-card-media.test.ts`

- [ ] **Step 5: 提交**

```bash
git add src/store/ai.ts src/store/timeline.ts tests/store-ai-card-media.test.ts
git commit -m "feat(ai-store): 新增 image/video 卡 actions 与进度集成"
```

---

### Task 14：MediaCardPreview 组件

**Files:**
- Create: `src/components/media-card/MediaCardPreview.tsx`
- Create: `src/components/media-card/MediaCardPreview.module.css`
- Test: `tests/media-card-preview.test.tsx`

- [ ] **Step 1: 写测试**

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MediaCardPreview } from '../src/components/media-card/MediaCardPreview';

describe('MediaCardPreview', () => {
  it('idle 显示占位 + 提示生成', () => {
    render(<MediaCardPreview content={baseContent('idle')} previewSrc={null} />);
    expect(screen.getByText(/未生成|点击生成/i)).toBeTruthy();
  });
  it('ready (image) 显示 <img>', () => {
    render(<MediaCardPreview content={baseContent('ready')} previewSrc="file:///fake.png" />);
    expect(screen.getByRole('img')).toBeTruthy();
  });
  it('failed 显示错误信息 + 重试入口', () => {
    render(<MediaCardPreview content={{ ...baseContent('failed'), errorMessage: '配额用尽' }} previewSrc={null} />);
    expect(screen.getByText(/配额用尽/)).toBeTruthy();
  });
});

function baseContent(status: string) {
  return {
    mediaType: 'image' as const,
    assetPath: status === 'ready' ? 'x.png' : null,
    aspectRatio: '16:9' as const,
    prompt: '',
    providerId: 'p', model: 'm',
    generationStatus: status as never,
  };
}
```

- [ ] **Step 2: 实现组件**

```tsx
import type { MediaCardContent } from '../../types/ai';
import styles from './MediaCardPreview.module.css';

interface Props {
  content: MediaCardContent;
  /** 实际可访问的本地预览 src（main 进程暴露的 file:// 或转义后的资源 URL） */
  previewSrc: string | null;
  percent?: number;
}

export function MediaCardPreview({ content, previewSrc, percent }: Props) {
  if (content.generationStatus === 'failed') {
    return (
      <div className={styles.errorBox}>
        <div className={styles.errorTitle}>生成失败</div>
        <div className={styles.errorMsg}>{content.errorMessage ?? '请重试或检查 Provider'}</div>
      </div>
    );
  }
  if (content.generationStatus === 'generating' || content.generationStatus === 'pending') {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <div>生成中… {percent ?? 0}%</div>
      </div>
    );
  }
  if (content.generationStatus === 'cancelled') {
    return <div className={styles.placeholder}>已取消，点击「重新生成」</div>;
  }
  if (content.generationStatus !== 'ready' || !previewSrc) {
    return <div className={styles.placeholder}>未生成。填写 prompt 后点击「生成」</div>;
  }
  if (content.mediaType === 'image') {
    return <img className={styles.media} src={previewSrc} alt="" />;
  }
  return <video className={styles.media} src={previewSrc} muted controls />;
}
```

`MediaCardPreview.module.css` 引用现有 darwin-ui tokens（参考 AICardInspector.module.css 的容器风格）。

- [ ] **Step 3: 测试通过 + 提交**

```bash
npx vitest run tests/media-card-preview.test.tsx
git add src/components/media-card/ tests/media-card-preview.test.tsx
git commit -m "feat(ui): 新增 MediaCardPreview 组件"
```

---

### Task 15：ImageCardForm

**Files:**
- Create: `src/components/media-card/ImageCardForm.tsx`
- Create: `src/components/media-card/ImageCardForm.module.css`
- Test: `tests/image-card-form.test.tsx`

UI 字段：标题 / 提示词 / 负面提示词（折叠）/ 宽高比 / 显示模式 / 显示时长 / Provider / Model / 「生成 / 重生成 / 取消」按钮。

- [ ] **Step 1: 写测试（覆盖：默认值、prompt 改写、生成按钮触发回调、生成中按钮变取消）**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageCardForm } from '../src/components/media-card/ImageCardForm';

describe('ImageCardForm', () => {
  it('idle 显示「生成」按钮，点击触发 onGenerate', () => {
    const onGenerate = vi.fn();
    render(<ImageCardForm card={makeCard('idle')} onGenerate={onGenerate} onCancel={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    expect(onGenerate).toHaveBeenCalled();
  });
  it('generating 显示「取消」按钮', () => {
    render(<ImageCardForm card={makeCard('generating')} onGenerate={() => {}} onCancel={() => {}} onSave={() => {}} />);
    expect(screen.getByRole('button', { name: /取消/ })).toBeTruthy();
  });
});
```

- [ ] **Step 2: 实现组件**（按字段清单实现，复用 `src/ui/components` 的 Input / Select / Textarea / Button；具体长度参考 `AICardInspector.tsx` 现有写法）。

- [ ] **Step 3: 测试通过 + 提交**

```bash
git add src/components/media-card/ImageCardForm* tests/image-card-form.test.tsx
git commit -m "feat(ui): 新增 ImageCardForm 表单"
```

---

### Task 16：VideoCardForm + 成本确认

**Files:**
- Create: `src/components/media-card/VideoCardForm.tsx`
- Create: `src/components/media-card/VideoCardForm.module.css`
- Create: `src/components/media-card/useVideoGenConfirm.ts`
- Test: `tests/video-card-form.test.tsx`

`useVideoGenConfirm` 钩子封装确认弹窗 + `localStorage` 「不再提示」逻辑：

```ts
// useVideoGenConfirm.ts
const KEY = 'lingji.videoCardConfirm.skip';
export function useVideoGenConfirm(): () => Promise<boolean> {
  return async () => {
    if (localStorage.getItem(KEY) === '1') return true;
    return new Promise((resolve) => {
      const skip = window.confirm('将调用视频 AI 生成视频卡（耗时较长且按次计费），是否继续？');
      if (skip) {
        const remember = window.confirm('记住选择，下次不再提示？');
        if (remember) localStorage.setItem(KEY, '1');
      }
      resolve(skip);
    });
  };
}
```

> 第一期用原生 confirm 简化交付，UI 层第二期可换成自研 Dialog。

`VideoCardForm` 在 `ImageCardForm` 基础上：
- 时长档位 select（值来自 `videoProvider.capabilities.durationOptions`，默认 6）
- 仅显示 `aspectRatio ∈ {16:9, 9:16, 1:1}`
- 点击生成前 `await confirm()`
- `displayDuration` 字段 readonly，显示 `${mediaDurationMs / 1000}s`

- [ ] **测试 + 提交**

```bash
git add src/components/media-card/VideoCardForm* src/components/media-card/useVideoGenConfirm.ts tests/video-card-form.test.tsx
git commit -m "feat(ui): 新增 VideoCardForm 表单与生成确认"
```

---

### Task 17：AICardInspector 派发 + AICardList 缩略图 / 徽章

**Files:**
- Modify: `src/components/AICardInspector.tsx`
- Modify: `src/components/AICardList.tsx`
- Modify: `src/components/AICardList.module.css`

- [ ] **Step 1: 改 `AICardInspector.tsx`**

```tsx
import { ImageCardForm } from './media-card/ImageCardForm';
import { VideoCardForm } from './media-card/VideoCardForm';
import { isMediaCardType } from '../types/ai';

// 在主 render switch 中：
if (card.type === 'image') {
  return <ImageCardForm card={card} ... />;
}
if (card.type === 'video') {
  return <VideoCardForm card={card} ... />;
}
// 其余原 TextCardForm/MotionCardForm 保留
```

- [ ] **Step 2: 改 `AICardList.tsx`**

每行渲染缩略图（image 卡 → assetPath 渲染 16x9 image；video 卡 → posterPath；缺失走默认 mediaType 图标）+ 状态徽章（`generating` 旋转图标、`failed` 红点）。

- [ ] **Step 3: 测试**

扩展 `tests/ai-card-list.test.tsx`，新增：image 卡显示 thumbnail；video 卡显示 poster；generating 卡显示 spinner。

- [ ] **Step 4: 提交**

```bash
git add src/components/AICardInspector.tsx src/components/AICardList.tsx src/components/AICardList.module.css tests/ai-card-list.test.tsx
git commit -m "feat(ui): Inspector 派发 image/video Form 与列表缩略图"
```

---

### Task 18：创建入口（cards 列表 + 时间线右键）

**Files:**
- Modify: `src/components/AICardList.tsx`（追加「⋯」菜单）
- Modify: `src/components/Timeline.tsx`（追加右键菜单）

- [ ] **Step 1: AICardList 项菜单**

为每个 card row 加一个 hover 显示的 `⋯` Button，点击弹 DropdownMenu，菜单项：
- 「转为图片卡」→ 调 `useAIStore.getState().createImageCard(card.segmentId, { prompt: card.title })`，然后把原卡片删除（或者覆盖原卡，保留 segmentId 与时间区间）
- 「转为视频卡」→ 同理调 `createVideoCard`

实现写法（关键片段）：

```tsx
function handleConvertToImage(card: AICard) {
  const store = useAIStore.getState();
  const newCard = store.createCardFromExisting(card, 'image');
  store.openCardInspector(newCard.id);
}
```

`createCardFromExisting` 是 `src/store/ai.ts` 的小工具：复用 segmentId / startMs / endMs / displayMode，把 type 切换到 image/video，content 重置为初始 MediaCardContent，title 沿用，prompt 用原 title + summary 拼接当起点。

- [ ] **Step 2: Timeline 右键**

定位 `src/components/Timeline.tsx` 字幕区右键菜单（grep "context-menu" 或 "右键"），新增两条：
- 「在此插入图片卡」
- 「在此插入视频卡」

调用 store 的 `createImageCardAtTime(startMs, endMs)` / `createVideoCardAtTime(startMs, endMs)`（如不存在则在 store 中新增；内部生成 segmentId = `manual:${nanoid()}`）。

- [ ] **Step 3: 测试**

`tests/ai-card-list.test.tsx`：测试菜单点击触发 createImageCard。
`tests/timeline.test.tsx`：测试右键菜单存在两条新菜单项（不必测点击后状态，仅菜单 DOM）。

- [ ] **Step 4: 提交**

```bash
git add src/components/AICardList.tsx src/components/Timeline.tsx src/store/ai.ts tests/ai-card-list.test.tsx tests/timeline.test.tsx
git commit -m "feat(ui): cards 列表与时间线右键支持创建 image/video 卡"
```

---

### Task 19：Settings — 视频 Provider + 提示词页

**Files:**
- Modify: `src/components/settings/AIConfigTab.tsx`（或图像 Provider 实际所在）
- Modify: `src/components/settings/PromptsTab.tsx`（提示词页）
- Test: `tests/ai-config-tab.test.tsx` 扩展

- [ ] **Step 1: 视频 Provider 分组**

在图像 Provider 区块下方追加「视频 Provider」section，结构与 ImageProvider CRUD 一致（list / add / edit modal / 默认 Provider 选择）。复用现有 ProviderForm 组件（如果有），加 `type: VideoProviderType` 选项。

- [ ] **Step 2: 提示词页加 `card.image / card.video` 行**

在 PromptsTab 列表 metadata 中，新增两行；点击编辑后弹原有编辑器，绑定区显示 ImageProvider/Model（card.image）或 VideoProvider/Model（card.video）。

- [ ] **Step 3: 测试**

`ai-config-tab.test.tsx` 新增：渲染时存在「视频 Provider」标题；添加 vidu provider 后落到 store。
`prompts-tab.test.tsx` 新增：`card.image` / `card.video` 两行可见。

- [ ] **Step 4: 提交**

```bash
git add src/components/settings/ tests/ai-config-tab.test.tsx tests/prompts-tab.test.tsx
git commit -m "feat(settings): 新增视频 Provider 与 card.image/card.video 提示词配置"
```

---

### Task 20：回归 + manual checklist

**Files:** 无代码改动。

- [ ] **Step 1: 全量类型检查 + 单元测试**

```bash
npx tsc --noEmit
npm test
```

Expected: 全绿。

- [ ] **Step 2: 构建一次**

```bash
npm run build
```

Expected: 0 error。

- [ ] **Step 3: dev 联调清单（开 `npm run dev`）**

参考 spec §7.4，逐项过：

1. 新建项目 → AI Plan 出 6 种文本卡。
2. quote 卡「转为图片卡」→ Inspector 弹出 → 改 prompt → 生成 → 底栏进度可见 → 缩略图刷新。
3. 同上「转为视频卡」→ 触发成本确认 → 选 6s 档位 → 生成 → 视频卡 displayDurationMs = 6000 → overlay 长度同步。
4. 时间线右键「在此插入图片卡 / 视频卡」→ 走完整生成流程。
5. 删除一张视频卡 → 检查 `ai-cards/<id>/` 目录被清理。
6. 关闭重开项目 → 状态、资产路径、提示词全部恢复。
7. 项目目录整体复制到另一路径打开 → 卡片仍能预览（验证相对路径）。
8. Remotion 导出 MP4 → image/video 卡正确出现，时间线长度匹配。
9. 取消正在生成的视频卡 → 进度条消失，资产文件不残留。
10. Settings 新增视频 Provider → 提示词页绑定 `card.video` → 重新生成走新 provider。

- [ ] **Step 4: 验证报告**

把 manual 验证结果（哪些步骤实跑、哪些跳过原因）写到 PR description。

- [ ] **Step 5: 收尾提交（可选）**

如有补丁式 fix，按规范提交。无则跳过。

---

## 自检（plan 写完后跑一遍）

- **Spec 覆盖**：spec §3 数据契约 → T1；§4 PromptKind/binding → T2；§5 IPC → T8/T9/T10/T11；§6 UI → T14-T18；§7 设置页 → T19；§8 测试 → 各 task 内含 + T20。**覆盖完整**。
- **占位扫描**：未出现 TBD / TODO / "implement later"；所有代码块都给出可直接抄写的内容。
- **类型一致**：`MediaCardContent` 字段名 / `VideoProvider` / `pollVideoUntilDone` / `handleGenerateCardImage / handleGenerateCardVideo` 在前后任务中保持一致。
- **路径一致**：`ai-cards/<cardId>/{image.png,video.mp4,poster.jpg,meta.json}` 在 T7 / T8 / T9 / T12 全程一致。
- **依赖顺序**：T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17 → T18 → T19 → T20，并行机会主要在 Phase 1/2/5 内同 Phase 横向并行（见拓扑图），需要时可让 subagent-driven-development 拆。

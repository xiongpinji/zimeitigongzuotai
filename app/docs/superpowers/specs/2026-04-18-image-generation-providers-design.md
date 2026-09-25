# AI 图像生成 Provider 适配层设计

- **日期**：2026-04-18
- **作者**：yoqu
- **状态**：Draft（待实现）
- **范围**：`src/types/ai.ts` · `src/lib/image-gen/**`（新增）· `src/lib/cover-generation.ts` · `src/lib/jimeng-client.ts` · `src/lib/llm/migrate-image-providers.ts` · `src/components/settings/ImageProviderListSection.tsx` · `src/components/settings/AIConfigTab.tsx` · `src/store/ai.ts` · `electron/preload.ts` · `electron/main.ts`（仅在需要走主进程的请求转发场景）
- **关联**：[2026-04-17-prompt-ai-binding-design.md](./2026-04-17-prompt-ai-binding-design.md)（提供 `ImageProvider` schema 与 `cover.regeneration` 链路）· [2026-04-11-unified-task-progress-design.md](./2026-04-11-unified-task-progress-design.md)（统一进度条契约）

## 1. 背景与目标

### 1.1 现状

- `ImageProvider` schema 已落地，但只有即梦（`jimeng`）一种 type 真实可用
- `src/lib/cover-generation.ts` 是 dispatcher 雏形，`openai_image` / `custom` 两个 type 直接抛 "暂未实现"
- 即梦客户端 `src/lib/jimeng-client.ts` 与 `cover-generation.ts` 紧耦合，没有可替换接口
- LLM 侧已有 LangChain 抽象（`@langchain/openai` `@langchain/google-genai`），但 LangChain JS **无图像生成统一抽象**（仅 `DallEAPIWrapper` Tool 包装 OpenAI），社区未集成 MiniMax/豆包/Imagen/Stability/FLUX 等
- 业界唯一成熟的统一抽象是 **Vercel AI SDK 的 `experimental_generateImage`**，但它原生只覆盖 OpenAI/Imagen/Replicate/Fal/Fireworks，国内厂商仍需自写 adapter
- 长任务进度展示已有 [`task-progress`](../../../src/store/task-progress.ts) 统一 store，分类 `cover` 已存在

### 1.2 目标

1. 建立**自建的 `ImageGenerationProvider` 适配层**，与 LLM 体系平行解耦，所有调用走统一接口
2. 一次性接入业界 P0/P1 主流生图 API：
   - **OpenAI Images**（`gpt-image-1` / `dall-e-3`）—— 同步
   - **MiniMax**（`image-01`）—— 同步
   - **Google Imagen**（`imagen-3.0` / `imagen-4`）—— 同步
   - **字节豆包 / Volc Ark**（`doubao-seedream-3.0`）—— **异步任务**
   - **阿里通义万相 / DashScope**（`wanx-v1` / `wan2.2-t2i`）—— **异步任务**
   - **即梦 jimeng**（`jimeng-5.0`）—— 重构现有实现
3. 异步型 API 通过统一 **任务-轮询工具**封装，对外暴露 `taskId + onProgress` 回调；进度上报对接 `task-progress` 实现统一底部进度条
4. UI 设置页支持按 type 动态渲染配置字段、提供"测试连接"按钮
5. Provider 行为差异通过**最小公共字段 + `extraParams` 透传**消化，不把 schema 撑得过宽

### 1.3 非目标（YAGNI）

- ❌ Stability AI / Black Forest Labs FLUX / Replicate / fal.ai / 智谱 CogView（P2/P3 留待后续按需，每加 1 个 provider 仅新增一个 adapter 文件）
- ❌ image-to-image / 参考图 / inpainting（在 `capabilities` 上预留 `supportsImageToImage` flag，本期不实现）
- ❌ 视频生成（motion）—— 不在本设计范围
- ❌ 引入 Vercel AI SDK / Genkit / LiteLLM（评估结论：净增价值 < 一致性收益）
- ❌ Provider 凭据的项目级覆盖（沿用 [2026-04-17](./2026-04-17-prompt-ai-binding-design.md) 决策：API Key 全局统一）
- ❌ Provider extras 的可视化 schema 编辑器（本期 UI 内提供 `extras` 已知字段表单 + 兜底 JSON 文本）
- ❌ 多账号 / 多 region 路由策略

## 2. 架构总览

```
src/lib/image-gen/
├── types.ts                     # ImageGenerationProvider 接口、Request/Result/Error/Capabilities 类型
├── registry.ts                  # ImageProviderType → ImageGenerationProvider 实例映射
├── errors.ts                    # ImageGenerationError + 错误码归一化
├── async-poller.ts              # 提交→轮询→结果 通用工具（豆包/万相复用）
├── progress.ts                  # 与 task-progress store 的桥接 helper
└── providers/
    ├── jimeng.ts                # 重构自现有 jimeng-client.ts
    ├── openai.ts                # 直连 OpenAI Images REST（不走 LangChain）
    ├── minimax.ts
    ├── doubao.ts                # 异步：volc engine ark visual-async
    ├── imagen.ts                # 走 @google/generative-ai 或 REST
    └── wanx.ts                  # 异步：DashScope text2image-v2

src/lib/cover-generation.ts       # 改造为薄 dispatcher，调用 registry，不再 if/else
src/lib/jimeng-client.ts          # 保留导出 buildJimengImageRequest 等纯函数供 jimeng provider 使用，逐步收敛到 providers/jimeng.ts
```

`cover-generation.ts` 不再直接 import 各 provider 客户端，仅作为"业务侧"封装：决定 prompt、决定批量数 N、负责把多张候选图落盘到 `coversDir`。**provider 适配层只负责"返回图片数据"，不关心持久化**。

## 3. 核心接口

### 3.1 Request / Result / Capabilities

```ts
// src/lib/image-gen/types.ts

export type ImageProviderType =
  | 'jimeng'
  | 'openai_image'
  | 'minimax'
  | 'doubao'
  | 'imagen'
  | 'wanx'
  | 'custom';

export type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface ImageGenerationRequest {
  prompt: string;
  model: string;
  aspectRatio?: ImageAspectRatio;     // 默认 '16:9'
  n?: number;                          // 默认 1，上限受 provider.capabilities.maxN 限制
  extraParams?: Record<string, unknown>; // provider-specific 透传（如 negative_prompt、seed、style、quality）
}

export interface ImageGenerationImage {
  url?: string;        // 远程 URL 或 data: URL
  base64?: string;     // 不带 data: 前缀
  mimeType?: string;   // 默认 image/png
}

export interface ImageGenerationResult {
  images: ImageGenerationImage[];
  raw?: unknown;       // provider 原始返回，便于排错
}

export interface ImageProviderCapabilities {
  aspectRatios: ImageAspectRatio[];
  maxN: number;
  supportsImageToImage: boolean;     // 预留
  isAsync: boolean;                  // 标识是否任务式
  defaultModels: string[];           // UI 默认填充
}

export interface ImageGenerationContext {
  taskId: string;                    // 由调用方从 task-progress 拿到
  signal: AbortSignal;               // 取消信号
  onProgress: (update: {
    percent?: number;                // 0-100
    phase?: string;                  // 'submitting' | 'queued' | 'rendering' | 'downloading'
    message?: string;                // 给用户看的可读信息
  }) => void;
}

export interface ImageProviderConfig {
  baseUrl: string;
  apiKey: string;
  extras?: Record<string, unknown>;  // 例如 imagen 的 projectId、wanx 的 region
}

export interface ImageGenerationProvider {
  readonly type: ImageProviderType;
  readonly capabilities: ImageProviderCapabilities;

  generate(
    req: ImageGenerationRequest,
    config: ImageProviderConfig,
    ctx: ImageGenerationContext,
  ): Promise<ImageGenerationResult>;
}
```

### 3.2 错误与归一化

```ts
// src/lib/image-gen/errors.ts

export type ImageGenerationErrorCode =
  | 'network'
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'invalid_request'
  | 'content_policy'
  | 'timeout'
  | 'cancelled'
  | 'server'
  | 'unknown';

export class ImageGenerationError extends Error {
  constructor(
    public readonly code: ImageGenerationErrorCode,
    public readonly providerType: ImageProviderType,
    message: string,
    public readonly cause?: unknown,
    public readonly raw?: unknown,
  ) { super(message); }
}
```

每个 provider adapter 内部把 HTTP/SDK 错误映射成 `ImageGenerationError`，UI/进度条统一根据 `code` 决定文案与是否可重试。

### 3.3 Registry

```ts
// src/lib/image-gen/registry.ts
const providers = new Map<ImageProviderType, ImageGenerationProvider>([
  ['jimeng', jimengProvider],
  ['openai_image', openaiImageProvider],
  ['minimax', minimaxProvider],
  ['doubao', doubaoProvider],
  ['imagen', imagenProvider],
  ['wanx', wanxProvider],
]);

export function getImageProvider(type: ImageProviderType): ImageGenerationProvider {
  // custom 视为 OpenAI 兼容端点：复用 openai adapter，仅 baseUrl/apiKey 走用户配置
  if (type === 'custom') return providers.get('openai_image')!;
  const p = providers.get(type);
  if (!p) throw new ImageGenerationError('invalid_request', type, `未注册的 provider type: ${type}`);
  return p;
}
```

`custom` 类型不单独注册，由 `getImageProvider` 显式回退到 `openai_image` adapter；UI 上仅展示为"OpenAI 兼容（自定义 baseUrl）"。

## 4. 异步任务轮询工具

豆包 / 万相均为 `submit → polling status → fetch result` 模式，统一抽象：

```ts
// src/lib/image-gen/async-poller.ts

export interface PollerOptions<T> {
  submit: () => Promise<{ taskId: string; estimatedSeconds?: number }>;
  fetchStatus: (taskId: string) => Promise<{
    status: 'pending' | 'running' | 'succeeded' | 'failed';
    percent?: number;
    result?: T;
    error?: { code: ImageGenerationErrorCode; message: string };
  }>;
  intervalMs?: number;       // 默认 2000
  timeoutMs?: number;        // 默认 180000（3min）
  onProgress: ImageGenerationContext['onProgress'];
  signal: AbortSignal;
  providerType: ImageProviderType;
}

export async function pollUntilDone<T>(opts: PollerOptions<T>): Promise<T>;
```

行为：
- `submit` 阶段上报 `{ percent: 5, phase: 'submitting' }`
- 轮询每次根据 `status.percent` 上报；若 provider 不返回百分比，则按"幂次衰减"的伪进度（5 → 30 → 50 → 70 → 85 → 95）
- 收到 `cancelled`（`signal.aborted`）或 `failed` 时抛 `ImageGenerationError`
- 超时抛 `code: 'timeout'`

## 5. 数据模型扩展

### 5.1 `src/types/ai.ts`

- `ImageProvider.type`: 扩展为 `ImageProviderType`（见 3.1）
- `ImageProvider` 新增 `extras?: Record<string, unknown>`（例：`{ projectId: 'xxx', location: 'us-central1' }`）
- 新增导出常量：`DEFAULT_MODELS_BY_TYPE: Record<ImageProviderType, string[]>` 与 `CAPABILITIES_BY_TYPE: Record<ImageProviderType, ImageProviderCapabilities>`，由各 provider adapter 提供，types 层只重导出，避免循环依赖

### 5.2 Capabilities 矩阵

| Provider | aspectRatios | maxN | isAsync | 默认 model |
|---|---|---|---|---|
| `jimeng` | `1:1, 16:9, 9:16, 4:3, 3:4` | 4 | false | `jimeng-5.0` |
| `openai_image` | `1:1, 16:9, 9:16` | 10 | false | `gpt-image-1` |
| `minimax` | `1:1, 16:9, 9:16, 4:3, 3:4` | 8 | false | `image-01` |
| `doubao` | `1:1, 16:9, 9:16` | 1 | true | `doubao-seedream-3.0` |
| `imagen` | `1:1, 16:9, 9:16, 4:3, 3:4` | 4 | false | `imagen-3.0-generate-002` |
| `wanx` | `1:1, 16:9, 9:16` | 4 | true | `wanx2.1-t2i-turbo` |

> 各 provider 的 aspectRatio 在 adapter 内部映射成厂商真实参数（如 OpenAI 的 `1024x1024`/`1792x1024`/`1024x1792`、wanx 的 `size: "1280*720"`）。

## 6. Provider Adapter 实现要点

### 6.1 OpenAI Images（同步）
- 端点：`POST {baseUrl}/v1/images/generations`，默认 `baseUrl = https://api.openai.com`
- 请求体：`{ model, prompt, n, size, response_format }`，`response_format = 'b64_json'` 优先（避免临时 URL 过期）
- aspect → size 映射：`1:1→1024x1024`、`16:9→1792x1024`、`9:16→1024x1792`
- `extraParams` 透传：`quality` (`standard`|`hd`)、`style` (`vivid`|`natural`)
- 错误映射：401→auth、429→rate_limited、400→invalid_request 或 content_policy（看 `error.code`）

### 6.2 MiniMax（同步）
- 端点：`POST {baseUrl}/v1/image_generation`，默认 `baseUrl = https://api.minimax.chat`
- 认证：`Authorization: Bearer {apiKey}`
- 请求体：`{ model: 'image-01', prompt, aspect_ratio, n, prompt_optimizer? }`
- 响应：`{ data: { image_urls: string[] } }`

### 6.3 字节豆包 / Volc Ark（异步）
- 端点：火山方舟视觉异步推理 `POST {baseUrl}/api/v3/contents/generations/tasks` 提交、`GET .../tasks/{id}` 轮询
- 默认 `baseUrl = https://ark.cn-beijing.volces.com`
- 请求体：`{ model, content: [{ type: 'text', text: prompt }], parameters: { size, n } }`
- 走 `pollUntilDone`，间隔 2s，超时 180s

### 6.4 Google Imagen（同步）
- 优先复用 `@langchain/google-genai` 已有 `apiKey`（仅读 settings 中已存在的 Gemini provider 配置作为联想，但 image provider 仍独立配置 apiKey/baseUrl）
- 端点：`POST {baseUrl}/v1beta/models/{model}:predict`，默认 `baseUrl = https://generativelanguage.googleapis.com`
- 请求体：`{ instances: [{ prompt }], parameters: { sampleCount: n, aspectRatio } }`
- 响应：`{ predictions: [{ bytesBase64Encoded }] }`
- `extras.projectId` / `extras.location` 仅在 Vertex 模式下使用（MVP 默认走 generativelanguage 公开端点）

### 6.5 阿里通义万相（异步）
- DashScope 兼容端点：`POST {baseUrl}/api/v1/services/aigc/text2image/image-synthesis`（`X-DashScope-Async: enable`）提交、`GET /api/v1/tasks/{id}` 轮询
- 默认 `baseUrl = https://dashscope.aliyuncs.com`
- 请求体：`{ model, input: { prompt }, parameters: { n, size } }`
- 走 `pollUntilDone`

### 6.6 即梦（同步，重构）
- 行为与现有 `src/lib/jimeng-client.ts` 一致；把 `buildJimengImageRequest` / `extractJimengImageUrls` 等纯函数搬到 `providers/jimeng.ts`，旧文件保留并 `re-export`，避免破坏现有 import；下一次清理 commit 删除旧文件
- `n` 默认 4 改为遵循 request 入参（cover-generation 业务层显式传 4），保持向后兼容

## 7. 与 `cover-generation.ts` 的集成

```ts
// 改造后的 cover-generation.ts 核心逻辑（伪代码）
export async function generateCoverImage(
  prompt: string,
  provider: ImageProvider,
  model: string,
  ctx: ImageGenerationContext,
): Promise<string /* image url 或 base64 data url */> {
  const adapter = getImageProvider(provider.type);
  const result = await adapter.generate(
    { prompt, model, aspectRatio: '16:9', n: 1 },
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, extras: provider.extras },
    ctx,
  );
  return result.images[0]?.url ?? toDataUrl(result.images[0]); // toDataUrl: image-gen/progress.ts 提供，把 base64+mimeType 包成 data: URL
}

export async function generateCoverCandidates(
  prompts: string[],
  provider: ImageProvider,
  model: string,
  coversDir: string,
  ctx: ImageGenerationContext,        // 新增参数
): Promise<CoverCandidate[]> { /* 内部按 prompt 循环，调用 adapter；ctx.onProgress 按 (i/total) 上报 */ }
```

调用入口（`ai-analysis.ts` cover 链路与设置页"测试"按钮）负责：
1. 通过 `task-progress.startTask({ id, category: 'cover', label, mode: 'determinate' })` 拿 `taskId`
2. 创建 `AbortController` 用作 `signal`（同时挂到 task 的 `onCancel`）
3. 把 `taskId / signal / onProgress`（内部转发到 `task-progress.updateTask`）打包成 `ImageGenerationContext` 传入
4. 完成时 `completeTask`，失败时 `failTask(error.message)`

`src/lib/image-gen/progress.ts` 提供 helper：

```ts
export function createImageGenContext(taskId: string, signal: AbortSignal): ImageGenerationContext;
export function toDataUrl(img: ImageGenerationImage): string;  // base64 → "data:{mime};base64,{...}"
```

## 8. UI 改造

### 8.1 `ImageProviderListSection`
- 新增 type 下拉选择，选项 = registry 已注册的 6 种 + `custom`
- 选中 type 后：
  - 自动用 `CAPABILITIES_BY_TYPE[type].defaultModels` 填充 `models[]`（已有 models 不覆盖）
  - 按 type 渲染必填字段（apiKey label、baseUrl 默认值、extras 已知字段）
  - 显示 capabilities 摘要（"支持 1:1 / 16:9 / 9:16；最大批量 4；异步任务"）
- 新增"测试"按钮：使用占位 prompt（"a cute cat, illustration"）+ 1:1 + n=1 调一次 `generate`，把结果以小图缩略展示在按钮旁；失败显示错误码与简化文案

### 8.2 `AIConfigTab`
- 入口/布局保持不变；仅把 `ImageProviderListSection` 的 type 切换暴露出来

### 8.3 进度展示
- 完全复用 `AppStatusBar` 与 `task-progress` 浮动面板（按 PROGRESS-SPEC.md），本设计**不新增任何 UI 控件**

## 9. Migration 与兼容性

### 9.1 数据迁移
- `src/lib/llm/migrate-image-providers.ts` 增加 `migrateToV2()`：
  - 旧 `imageProviders[].type === 'jimeng'`：补 `extras: {}`，补 `models` 缺省值
  - 旧 `type === 'openai_image'`（已存在但未实现）：保留，无字段补全
  - 旧 `type === 'custom'`：保留，无字段补全
- 不删除任何现有字段；`AISettings` 中 `jimengApiUrl/jimengSessionId/jimengModel` 保持 deprecated 但不动

### 9.2 Prompt 绑定
- `cover.regeneration` 已通过 [2026-04-17](./2026-04-17-prompt-ai-binding-design.md) 拿到 `imageProviderId / imageModel`，本设计不改 binding 数据结构
- `resolvePromptBinding` 返回的 `imageProvider` 字段直接喂给新版 `generateCoverImage`，无破坏性修改

### 9.3 旧调用位
- 现存 `generateCoverImage(prompt, provider, model)` 三参签名变为四参（新增 `ctx`）；做法：
  1. 保留三参作为 overload，内部生成默认 ctx（创建临时 task 自动管理）
  2. 在 `ai-analysis.ts` 切片内统一改为四参显式传 ctx（推荐）
- 选 (2) 显式传，避免"看不到 task"的隐式行为；`overload (1)` 仅作为短期兼容，标 `@deprecated`，下个迭代删除

## 10. 安全与凭据
- 所有 API Key 仍存放在 `AISettings.imageProviders[].apiKey`，沿用现有持久化（不入 git）
- adapter 实现一律走 `fetch`，**不**在 console.log 中打印 apiKey；错误对象的 `cause` 中可包含原始响应但 UI 仅显示 `message`
- Imagen / Wanx 的 `extras.projectId / region` 不视为敏感信息，可以与配置一起明文持久化

## 11. 测试策略
- **单元测试**（Vitest，每个 provider 一个文件）：
  - `tests/image-gen/providers/openai.test.ts`、`...minimax.test.ts` 等：mock `fetch`，断言请求 URL/headers/body 形状、响应正常解析、各错误码归一化
  - `tests/image-gen/async-poller.test.ts`：正常完成、超时、取消、failed status 四条路径
  - `tests/image-gen/registry.test.ts`：getImageProvider 命中/未命中
- **集成测试**：
  - `tests/cover-generation.test.ts` 用 mock provider 验证 `generateCoverCandidates` 落盘流程、错误候选项 fallback
- **覆盖率目标**：image-gen/ 目录 ≥ 85%
- **无真实 API**：所有测试 mock，禁止网络请求

## 12. 实施切片建议（供 writing-plans 后续展开）

> 仅作为编排提示，不在本 spec 内承诺顺序细节。

1. 新建 `src/lib/image-gen/` 骨架（types/registry/errors/async-poller/progress）+ jimeng provider 重构 + 单测
2. 改造 `cover-generation.ts` 走 registry + ctx 显式传递；调用方（`ai-analysis.ts` 与设置页"测试"按钮入口）切到新签名
3. OpenAI / MiniMax provider + 单测
4. 豆包 / 万相 异步 provider + 单测
5. Imagen provider + 单测
6. UI：`ImageProviderListSection` type 选择、capabilities 摘要、测试按钮
7. Migration 补丁（v2）+ 端到端冒烟（每个 type 在设置页跑一次"测试"）

## 13. 验收标准
- 6 个 provider 在设置页可创建、配置、通过"测试"按钮成功调用（至少 jimeng + openai + 一个异步 provider 真实调通）
- `cover.regeneration` 链路在切换 imageProvider 后能输出符合所选 provider 的图像
- 进度条按 PROGRESS-SPEC.md 在 AppStatusBar 中展示，异步 provider 显示中间百分比
- 取消按钮可中断异步任务且不留下 active task
- 单测覆盖率达成 §11 目标，全量 `npm test` 通过
- 没有任何 image gen 调用绕过 `ImageGenerationProvider` 接口

# 提示词 × AI 绑定整合设计

- **日期**：2026-04-17
- **作者**：yoqu
- **状态**：Draft（待实现）
- **范围**：`src/types/ai.ts` · `src/lib/llm/` · `src/lib/prompts/` · `src/components/settings/` · `src/store/ai.ts` · `electron/prompts-io.ts` · `electron/preload.ts` · `electron/main.ts` · `src/lib/jimeng-client.ts`

## 1. 背景与目标

### 1.1 现状

- 7 种 `PromptKind`：`planning.segment` / `cover.regeneration` / `cards.segment` / `motion.system` / `motion.generate` / `motion.modify` / `motion.autofix`
- 提示词配置已有 Global / Project 两层 scope，通过 IPC 读写 YAML
- 所有 LLM 调用（`ai-analysis.ts`、`motion-prompt.ts`、cover prompt 生成）写死走 `settings.defaultProviderId + defaultModel`，无法按提示词切换
- 封面图生成用即梦文生图 API，参数散落在 `settings.jimengApiUrl/jimengApiKey/jimengModel`，与 LLMProvider 体系完全分离

### 1.2 目标

让用户可以：

1. **为每个提示词独立绑定 LLM Provider + 模型**（覆盖全局默认）
2. **绑定支持 Global / Project 两层覆盖**，项目默认继承全局
3. **将文生图能力抽象为 `ImageProvider`**，与 `LLMProvider` 对称，支持未来扩展
4. **`cover.regeneration` 提示词同时绑定 LLM（生 prompt）+ ImageProvider（生图）**，链路在 UI 上可见

### 1.3 非目标（YAGNI）

- ❌ 提示词"试运行"按钮（独立特性，留待后续）
- ❌ 提示词版本对比 / 历史回滚
- ❌ ImageProvider 的项目级独立列表（API Key 凭证全局统一）
- ❌ 真实实现第二家文生图（DALL-E / 豆包 / MJ） —— 仅预留 type 字段和 dispatcher 分支
- ❌ `motion.system` 提供独立 binding（它是 system prompt，不单独发起调用）

## 2. 数据模型

### 2.1 新增类型（`src/types/ai.ts`）

```ts
export interface ImageProvider {
  id: string;
  name: string;
  type: 'jimeng' | 'openai_image' | 'custom';
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface PromptBinding {
  providerId: string | null;          // null = 继承
  model: string | null;
  // 仅 cover.regeneration 写入
  imageProviderId?: string | null;
  imageModel?: string | null;
}

export type PromptBindingMap = Partial<Record<PromptKind, PromptBinding>>;
```

### 2.2 `AISettings` 扩展

```ts
interface AISettings {
  // —— 既有，保留 ——
  llmProviders: LLMProvider[];                  // 注意现网字段名是 llmProviders
  defaultProviderId: string | null;
  defaultModel: string | null;
  enableThinking?: boolean;
  // …其他既有 minimax / 旧 llm* deprecated 字段保持不动

  // —— 新增 ——
  imageProviders: ImageProvider[];
  defaultImageProviderId: string | null;
  defaultImageModel: string | null;
  promptBindings: PromptBindingMap;             // 全局层

  // —— deprecated（迁移后由 imageProviders 替代；保留读取兼容）——
  jimengApiUrl?: string;       // 既存：endpoint
  jimengSessionId?: string;    // 既存：作为 Bearer 凭证
  jimengModel?: string;        // 既存：模型名
}
```

**注**：当前现网 `jimengApiUrl` / `jimengSessionId` 是 required string，迁移完成后调用层不再读取这些字段。本次改动将它们的可见类型放宽为 optional 以表达"未来可移除"，但实际数据迁移函数保证迁移后这些字段被设置为 `''`（空字符串），以兼容仍引用它们的旧代码（迁移完成后下一阶段统一清理）。

### 2.3 写入约定

- "继承"= map 中**删除该 key**（不留 `{ providerId: null, model: null }` 噪音条目）
- 项目级 binding 的 map 变空 → 删除 `<projectDir>/prompt-bindings.json` 文件本身

## 3. 存储与 IPC

### 3.1 文件落点

| 数据 | 位置 |
|------|------|
| 全局 `promptBindings` / `imageProviders` / `defaultImage*` | 现有 `AISettings` 文件（不新增文件） |
| 项目级 `promptBindings` | `<projectDir>/configs/prompt-bindings.json` |
| ImageProvider 列表 | **仅全局**，无项目级 |

### 3.2 新增 IPC

主进程：在 `electron/prompts-io.ts` 旁新增 `electron/prompt-bindings-io.ts`，实现 `readPromptBindings`/`writePromptBindings`/`deletePromptBindings`。

`electron/main.ts` 中注册 IPC handler（与 `prompts:*` 同处），并在 `electron/preload.ts` 暴露：

```ts
window.electronAPI.prompts.readBindings(
  scope: 'global' | 'project',
  projectDir?: string,
): Promise<PromptBindingMap>

window.electronAPI.prompts.writeBindings(
  scope: 'global' | 'project',
  bindings: PromptBindingMap,
  projectDir?: string,
): Promise<void>
```

- `scope='global'` 实质走 AISettings 的 read/write（read 时返回 `settings.promptBindings ?? {}`；write 时 patch settings 并保存）
- `scope='project'` 读写 `<projectDir>/configs/prompt-bindings.json`（沿用既有 `configs/` 子目录约定，与 `configs/prompts/` 平级）
- 主进程对 `projectDir` 校验：必须是绝对路径且当前 session 中已 open 过的项目目录

### 3.3 Store

`src/store/ai.ts` 新增：

```ts
useAIStore.getState().resolveBinding(kind, projectDir?)
  → ResolvedBinding | null
```

- 内部 project → global → default 三层回退
- 切换 `projectDir` 时主动加载并缓存 project bindings

## 4. 调用层改造

### 4.1 新增 `src/lib/llm/binding-resolver.ts`

```ts
export interface ResolvedBinding {
  provider: LLMProvider;
  model: string;
  imageProvider?: ImageProvider;
  imageModel?: string;
}

export class PromptBindingError extends Error {
  code: 'PROVIDER_MISSING' | 'MODEL_NOT_IN_PROVIDER' | 'IMAGE_PROVIDER_MISSING';
  kind: PromptKind;
}

export function resolvePromptBinding(
  kind: PromptKind,
  settings: AISettings,
  projectBindings: PromptBindingMap | null,
): ResolvedBinding;
```

回退链：`projectBindings[kind]` → `settings.promptBindings[kind]` → `{ defaultProviderId, defaultModel }`。`cover.regeneration` 的 image 段独立解析。

### 4.2 调用点切换

| 调用点 | 改造 |
|--------|------|
| `src/lib/ai-analysis.ts` → `analyzeSrt()` | 用 `resolvePromptBinding('planning.segment')` / `('cards.segment')` |
| `src/lib/motion-prompt.ts` | `resolvePromptBinding('motion.generate' / 'motion.modify' / 'motion.autofix')` |
| 封面 prompt 生成 | `resolvePromptBinding('cover.regeneration')`，**透传 imageProvider/imageModel** |
| `src/lib/jimeng-client.ts` | 剥离 settings 依赖，签名改为接收 `(prompt, ImageProvider, model)` |

### 4.3 `generateStructuredData` / `generateText` 签名

新增可选 `binding?: ResolvedBinding` 参数：

```ts
generateStructuredData(
  settings: AISettings,
  systemPrompt: string,
  userMessage: string,
  binding?: ResolvedBinding,
)
```

- 有 binding：走 `createChatModelFromProvider(binding.provider, binding.model, ...)`
- 无 binding：走原 `createChatModel(settings)`（兼容老调用，但实际发起 LLM 调用的 6 种 PromptKind —— `planning.segment` / `cards.segment` / `cover.regeneration` / `motion.generate` / `motion.modify` / `motion.autofix` —— 都迁移到显式传 binding，不留隐式默认路径）。`motion.system` 仅作为其他 motion 提示词的 system 字符串使用，不发起独立调用，因此不参与绑定

### 4.4 封面端到端链路

```
用户点"重新生成封面"
  → resolvePromptBinding('cover.regeneration', ...)
    → { provider, model, imageProvider, imageModel }
  → generateText(systemPrompt, userMessage, binding)        // LLM 产出图像 prompt
  → generateCoverImage(imagePrompt, imageProvider, imageModel)
       switch (imageProvider.type)
         ├─ 'jimeng'        → jimeng-client.buildJimengImageRequest(...)
         ├─ 'openai_image'  → throw NotImplemented
         └─ 'custom'        → throw NotImplemented
  → 返回图片 URL[]
```

新增 `src/lib/cover-generation.ts` 做编排；`jimeng-client.ts` 退化为 HTTP 构造函数。

## 5. UI 设计

### 5.1 `PromptsConfigTab` —— 编辑面板顶部"AI 绑定条"

**绑定条仅对实际发起 LLM 调用的 6 种 PromptKind 显示**；`motion.system` 的编辑面板不显示绑定条（仅展示 YAML 编辑器），左侧列表也不显示 Badge。

普通提示词：

```
┌────────────────────────────────────────────────────────┐
│ AI 绑定   [继承全局 ✓]                                   │
│ Provider [OpenAI ▾]   Model [gpt-4o ▾]                  │
└────────────────────────────────────────────────────────┘
```

`cover.regeneration` 双行布局：

```
┌────────────────────────────────────────────────────────┐
│ LLM（生成提示词）  [继承 ✓]   Provider [..] Model [..]   │
│ ─────────────                                           │
│ 文生图（最终出图）  [继承 ✓]   Provider [即梦] Model [..] │
│ ↳ 该提示词输出会被送往上方文生图模型生图                    │
└────────────────────────────────────────────────────────┘
```

交互细节：

- "继承"勾选时下拉禁用、灰色显示继承到的值；取消勾选 → 激活
- 切 Provider 时 Model 自动选 `models[0]`，列表为空时禁用并提示
- "重置为继承"链接仅在已覆盖时出现
- 编辑即保存（300ms 防抖），与现有 PromptsConfigTab 一致

### 5.2 左侧提示词列表 Badge

| 状态 | Badge | 颜色 |
|------|-------|------|
| 未覆盖 | `继承` | secondary（灰） |
| 已覆盖 | 模型名缩略，如 `gpt-4o` | info（蓝） |
| 失效（绑定的 provider 已删除） | `❗失效` | danger（红） |

`cover.regeneration` 显示双 Badge：`gpt-4o · jimeng-5.0`

### 5.3 `AIConfigTab` —— "封面图像生成"区块

- 紧跟 `ProviderListSection` 之下，新增 `ImageProviderListSection` 组件（独立写，**不复用 LLM Dialog 加 mode 参数**）
- 类型选项：`jimeng | openai_image | custom`
- 区块底部：默认 Image Provider / 默认模型 两个 Select

### 5.4 错误边界 UI

| 错误 | 处理 |
|------|------|
| `PROVIDER_MISSING` | 顶部红色警告条 + 自动跳到提示词配置页让用户重选 |
| `MODEL_NOT_IN_PROVIDER` | 顶部警告条提示重选模型 |
| Agent 流程内触发 | 通过 `agentOperation` store 的 error 字段上报，不影响其他操作 |

## 6. 数据迁移

### 6.1 触发条件

加载 AISettings 后 `imageProviders` 为 `undefined` 或 `[]`，且任一旧 `jimeng*` 字段存在。

### 6.2 迁移逻辑（`src/lib/llm/migrate-image-providers.ts`）

```ts
import { DEFAULT_JIMENG_MODEL } from '../../types/ai';

export function migrateImageProviders(settings: AISettings): AISettings {
  if (settings.imageProviders?.length) return settings; // 已迁移，幂等

  const hasJimengConfig = Boolean(settings.jimengApiUrl?.trim() ||
                                   settings.jimengSessionId?.trim());

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
    apiKey: settings.jimengSessionId ?? '',  // 即梦用 sessionId 作为 Bearer
    models: [model],
  };

  return {
    ...settings,
    imageProviders: [jimeng],
    defaultImageProviderId: jimeng.id,
    defaultImageModel: model,
    // 旧字段保留为 ''（不删除），调用层不再读取；后续清理 PR 再统一去字段
    jimengApiUrl: '',
    jimengSessionId: '',
    jimengModel: '',
  };
}
```

迁移结果立即持久化，幂等。`promptBindings` 无需迁移（缺失视为空 map，调用走 default 兜底，行为与旧版一致）。

**注**：即梦的 `apiKey` 字段实际承载的是 `sessionId`（这是即梦 API 协议的特殊点，详见 `jimeng-client.ts` —— 它把 sessionId 作为 `Authorization: Bearer` 发送）。在 `ImageProvider` 抽象里统一叫 `apiKey`，jimeng 的 client 负责把 `apiKey` 当 sessionId 用。

## 7. 测试

| 文件 | 覆盖 |
|------|------|
| `tests/prompt-binding-resolver.test.ts` | 三层回退、project 覆盖 global、null=继承、cover image 段独立回退、provider 失效抛 `PromptBindingError` |
| `tests/image-provider-migration.test.ts` | 旧字段齐全/部分/缺失场景、幂等性 |
| `tests/prompt-bindings-ipc.test.ts` | 全局走 AISettings、项目走 `prompt-bindings.json`、projectDir 路径白名单、空 map 删除文件 |
| `tests/llm-generate-with-binding.test.ts` | 传 binding 走 `createChatModelFromProvider`、不传走原逻辑（回归） |

UI 不写单测，依赖 `npm run dev` 人工走查关键路径（提示词列表 Badge、绑定条切换、封面端到端、迁移首次启动）。

## 8. 实现切片（建议分 3 个 PR）

1. **数据层 & 迁移**：新增类型、`resolvePromptBinding`、`migrateImageProviders`，老调用点保持不变（继续用全局默认）。无 UI 变化，零风险
2. **调用点切换**：`ai-analysis.ts` / `motion-prompt.ts` / `cover-generation.ts` 逐个切到 `resolvePromptBinding`，`jimeng-client.ts` 剥离 settings 依赖
3. **UI 接入**：`PromptsConfigTab` 绑定条 + 列表 Badge + `ImageProviderListSection` + `AIConfigTab` 封面区块

每个 PR 独立可发布，逐步验证。

## 9. 风险与权衡

| 风险 | 应对 |
|------|------|
| 用户已删除 binding 中的 provider，导致 Agent 执行中失败 | 启动时扫描一次 binding 引用完整性，列表 Badge 显示`❗失效`，引导用户修复 |
| `generateStructuredData` 双签名（带/不带 binding）造成代码两条路径 | 分阶段：所有 7 种 PromptKind 调用点迁移完成后，把"不带 binding"路径标记 deprecated，后续删除 |
| 即梦字段迁移误判（用户从未配置过即梦） | 迁移函数检查 `jimengApiKey`/`jimengApiUrl` 至少一个非空，否则只生成空 imageProviders 列表 |
| ImageProvider 仅全局，多账号场景受限 | 当前用户场景（个人桌面端）不存在多账号。后续若需要再加 project 层 |

# 火山引擎方舟 独立 LLM Provider 设计

- 日期：2026-06-25
- 状态：待实现
- 范围：AI Provider 配置（Renderer 侧 LLM 配置 + LangChain 模型构建），无 IPC、无项目文件迁移

## 1. 背景与目标

火山引擎方舟（Ark）Chat Completions API 是 OpenAI 兼容端点
（`https://ark.cn-beijing.volces.com/api/v3/chat/completions`，`Authorization: Bearer $ARK_API_KEY`），
但它额外提供若干**火山特有请求体参数**，是通用 `openai_compatible` 类型无法表达的：

- `thinking.type`：深度思考开关，三态 `enabled` / `disabled` / `auto`（默认 `enabled`）。
- `reasoning_effort`：思考力度 `minimal` / `low` / `medium` / `high` / `max`（默认 `medium`）。
- `service_tier`：在线推理模式 `fast` / `auto` / `default`（默认 `auto`）。

目标：新增一个**独立的 LLM Provider 类型** `volcengine_ark`，带专属参数配置面板，
让用户在「设置 → AI」里把火山方舟作为一等 Provider 接入，并精细控制上述思考相关参数。

> 注：现有已有一条 `volcano` **快捷预设**（“火山方舟 Coding Plan”，端点 `/api/coding/v3`，
> 映射到通用 `openai_compatible`）。本设计是**新增独立类型**，与该预设是两件事；预设保留不动。

## 2. 范围决策（已确认）

- **参数范围：核心思考相关**。只暴露火山特有的 `thinkingMode` / `reasoningEffort` / `serviceTier`；
  采样参数（temperature / top_p / max_tokens）**沿用现有默认**，不新增 UI 字段。
- **默认端点：标准 Chat 端点** `https://ark.cn-beijing.volces.com/api/v3`（用户可在高级配置改）。

非目标（YAGNI）：
- 不暴露 temperature / top_p / max_tokens / frequency_penalty / presence_penalty 等采样面板。
- 不实现 Responses API（`/responses`）路径。
- 不处理 `reasoning_content` / `encrypted_content` 响应字段的回显与回传（现有生成链路只消费 `content`）。

## 3. 实现范式

完全对标现有 `minimax` 类型的实现范式：**专用构建函数 + dispatch 分支 + UI 条件字段 + 校验**。
底层传输复用 `ChatOpenAI`（OpenAI 兼容），火山特有参数经 `modelKwargs` 透传进请求体。

## 4. 数据模型（`src/types/ai.ts`）

### 4.1 类型联合

`LLMProvider.type` 联合新增 `'volcengine_ark'`：

```ts
type:
  | 'openai_compatible'
  | 'openai_responses'
  | 'anthropic'
  | 'minimax'
  | 'gemini'
  | 'lmstudio'
  | 'claude_code_acp'
  | 'volcengine_ark';
```

### 4.2 专属配置袋

新增嵌套可选字段，避免把火山专属参数散落污染共享类型：

```ts
/** type='volcengine_ark' 专属参数；其它 Provider 类型忽略本字段 */
export interface VolcengineArkParams {
  /** 深度思考模式，映射到请求体 thinking.type；缺省 enabled */
  thinkingMode?: 'enabled' | 'disabled' | 'auto';
  /** 思考力度，映射到 reasoning_effort；缺省不下发（走 API 默认 medium） */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'max';
  /** 在线推理模式，映射到 service_tier；缺省不下发（走 API 默认 auto） */
  serviceTier?: 'fast' | 'auto' | 'default';
}
```

在 `LLMProvider` 上追加：

```ts
/** type='volcengine_ark' 专属参数 */
volcengineArk?: VolcengineArkParams;
```

> 全部可选，纯增量。对旧 `project.json` / 旧 AISettings 向后兼容，**无需迁移逻辑**。
> 实现时确认 `ai-config-utils` 中 provider 的 normalize/clone 路径**不丢弃** `volcengineArk` 字段。

## 5. 请求构建（`src/lib/llm/model.ts`）

### 5.1 常量

```ts
/** 火山方舟标准 Chat 端点（ChatOpenAI 会在其后拼 /chat/completions） */
export const VOLCENGINE_ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
```

### 5.2 专用构建函数

```ts
function createVolcengineArkChatModel(
  provider: LLMProvider,
  model: string,
  options?: { enableThinking?: boolean },
): BaseChatModel {
  const ark = provider.volcengineArk ?? {};

  // 门控：master gate（options/provider.enableThinking===false）→ 强制 disabled；
  // 否则用 thinkingMode（缺省 enabled）。保持「流水线步骤强制关思考」的调用约定。
  const gateOpen = resolveEnableThinking(provider, options);
  const thinkingType = gateOpen ? (ark.thinkingMode ?? 'enabled') : 'disabled';

  const modelKwargs: Record<string, unknown> = {
    thinking: { type: thinkingType },
  };
  if (ark.reasoningEffort) modelKwargs.reasoning_effort = ark.reasoningEffort;
  if (ark.serviceTier) modelKwargs.service_tier = ark.serviceTier;

  const apiKey = provider.apiKey;
  const baseURL = normalizeBaseUrl(provider.baseUrl?.trim() || VOLCENGINE_ARK_DEFAULT_BASE_URL);

  return new ChatOpenAI({
    apiKey,
    model,
    temperature: 0.3, // 采样参数沿用现有默认
    configuration: { apiKey, baseURL },
    modelKwargs,
  });
}
```

### 5.3 dispatch 分支

在 `createChatModelFromProvider` 中，于 `minimax` 分支之后、OpenAI 兼容默认路径之前插入：

```ts
if (provider.type === 'volcengine_ark') {
  return createVolcengineArkChatModel(provider, model, options);
}
```

行为要点：
- `thinking.type` **始终下发**（由门控决定 enabled/auto/disabled）。
- `reasoning_effort` / `service_tier` **仅在用户配置了才下发**，否则交给 API 默认。
- `enableThinking=false`（provider 级或 options 级）→ `thinking.type='disabled'`，覆盖 thinkingMode。

## 6. 模型列表（`src/lib/llm/fetch-models.ts`）

`fetchProviderModels` 的 switch 新增：

```ts
case 'volcengine_ark':
  return fetchOpenAICompatibleModels(provider.baseUrl, provider.apiKey);
```

与 `openai_compatible` 一致：拉取 `{baseUrl}/models`；拉不到时用户在高级配置手动填写 models。

## 7. 设置 UI（`src/components/settings/ProviderListSection.tsx`）

### 7.1 类型下拉

`PROVIDER_TYPE_OPTIONS` 新增：

```ts
{ value: 'volcengine_ark', label: '火山引擎方舟' },
```

### 7.2 切换类型默认值

在 `handleTypeChange` 中，切到 `volcengine_ark` 且 baseUrl 为空时回填标准端点：

```ts
if (nextType === 'volcengine_ark' && !next.baseUrl.trim()) {
  next.baseUrl = VOLCENGINE_ARK_DEFAULT_BASE_URL;
}
```

### 7.3 专属参数面板

在高级配置区，当 `draft.type === 'volcengine_ark'` 时渲染三个下拉（写入 `draft.volcengineArk.*`），
复用现有 `Select` primitive，文案中文：

- **深度思考模式**：`enabled`（开启） / `disabled`（关闭） / `auto`（自动判断）。
- **思考力度**：`minimal` / `low` / `medium` / `high` / `max`（含“跟随默认”空选项 → 不下发）。
- **推理模式**：`fast`（低延迟） / `auto`（TPM 保障包） / `default`（常规）（含“跟随默认”空选项 → 不下发）。

### 7.4 隐藏布尔 enableThinking

`volcengine_ark` 类型下隐藏原布尔 `enableThinking` 复选框（由三态 `thinkingMode` 取代）。
不设置 `enableThinking` 时其为 `undefined` → `resolveEnableThinking` 返回 `true`（门控开），
由 `thinkingMode` 全权决定，逻辑自洽。`options.enableThinking===false` 的强制关思考路径仍生效。

## 8. 校验（`src/components/settings/ai-config-utils.ts`）

`volcengine_ark` 与 `openai_compatible` 校验一致：baseUrl + apiKey 均必填。
现有默认校验（仅对 gemini / lmstudio / claude_code_acp / pi 内置作豁免）已覆盖，**无需新增豁免分支**。
实现时确认：

- provider 的 normalize/clone 不会丢弃 `volcengineArk`。
- 切换到非 `volcengine_ark` 类型时是否清理 `volcengineArk`：保留即可（被忽略，无害），无需主动清理。

## 9. 快捷预设（`src/lib/llm/pi-provider-presets.ts`，可选 / 建议加）

新增一条预设，便于一键添加标准 Chat 端点：

```ts
{
  id: 'volcengine-ark-chat',
  label: '火山引擎方舟 (Chat)',
  description: '火山引擎方舟标准 Chat 端点 /api/v3，支持深度思考(thinking)与思考力度(reasoning_effort)精细控制。',
  piProviderId: null,
  providerName: '火山引擎方舟',
  type: 'volcengine_ark',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  models: [
    'doubao-seed-2-1-pro-260628',
    'doubao-seed-2-1-turbo-260628',
    'doubao-seed-1-6-250615',
    'deepseek-v4-pro-260425',
  ],
  apiKeyPlaceholder: '填写火山引擎 API Key',
  apiKeyRequired: true,
  enableThinking: true,
}
```

> 现有 `volcano`（火山方舟 Coding Plan，`/api/coding/v3` → `openai_compatible`）预设**保留不动**。
> 若预设 schema 含 `enableThinking` 以外的思考字段，按现有 `PiProviderPreset` 形状填写即可；
> 预设不携带 `volcengineArk` 默认值（用户添加后在面板里按需配置）。

## 10. 测试

新增 `tests/llm-model-volcengine-ark.test.ts`，覆盖 `createChatModelFromProvider`：

1. `type='volcengine_ark'` → 返回 `ChatOpenAI`，`configuration.baseURL` 为标准端点（或自定义 baseUrl）。
2. 默认（无 volcengineArk）→ `modelKwargs.thinking.type==='enabled'`，不含 `reasoning_effort` / `service_tier`。
3. 配置 `{thinkingMode:'auto', reasoningEffort:'high', serviceTier:'fast'}`
   → `modelKwargs` 三者正确下发。
4. `provider.enableThinking===false` → `thinking.type==='disabled'`（覆盖 thinkingMode）。
5. `options.enableThinking===false` → `thinking.type==='disabled'`。

必要时补：
- `tests/fetch-provider-models.test.ts`：`volcengine_ark` 走 OpenAI 兼容拉取。
- `tests/ai-config-utils.test.ts`：`volcengine_ark` 校验 baseUrl + apiKey 必填，且 normalize 保留 `volcengineArk`。

验证命令：`npx vitest run tests/llm-model-volcengine-ark.test.ts`（及上述相关用例）。

## 11. 涉及文件清单

| 文件 | 改动 |
|---|---|
| `src/types/ai.ts` | 类型联合 + `VolcengineArkParams` + `LLMProvider.volcengineArk` |
| `src/lib/llm/model.ts` | `VOLCENGINE_ARK_DEFAULT_BASE_URL` + `createVolcengineArkChatModel` + dispatch 分支 |
| `src/lib/llm/fetch-models.ts` | `case 'volcengine_ark'` |
| `src/components/settings/ProviderListSection.tsx` | 下拉项 + 切换默认 baseUrl + 专属参数面板 + 隐藏布尔 enableThinking |
| `src/components/settings/ai-config-utils.ts` | 确认校验与 normalize 保留 `volcengineArk`（大概率无需改逻辑） |
| `src/lib/llm/pi-provider-presets.ts` | 新增 `volcengine-ark-chat` 预设（可选） |
| `tests/llm-model-volcengine-ark.test.ts` | 新增测试 |

**无 IPC 三件套改动，无 `project.json` 迁移。**

## 12. 风险与影响面

- 命中高风险清单：**修改共享类型 `LLMProvider` / `AISettings`**。但改动为纯增量可选字段，
  既有 Provider 数据与调用方不受影响；新增类型在所有 switch/校验点都已对齐。
- `reasoning_content` 响应字段不在本次范围；火山深度思考开启时延迟更高，
  但现有 LangChain `invoke`/`stream` 路径不受影响（思考内容落在 `additional_kwargs`，当前链路只读 `content`）。
- temperature 固定 0.3：部分火山 reasoning 模型会忽略 temperature（强制 1），属预期行为，无副作用。

# LLM Client LangChain Unification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 AI 请求链路彻底收敛为 `LangChain + OpenAI 兼容协议` 单一路径，删除手写 LLM HTTP 请求与多余抽象，形成高内聚、低耦合、易维护的 LLM 接入层。

**Architecture:** 新建 `src/lib/llm/` 作为唯一 LLM 接入边界，内部仅负责三件事：创建 `ChatOpenAI` 实例、统一消息输入、统一结果提取。所有业务模块只依赖 `generateStructuredJson`、`generateText`、`streamText` 这三个语义清晰的能力，不再感知供应商分支、SSE 解析细节或原始 HTTP 协议。

**Tech Stack:** TypeScript、LangChain `@langchain/openai`、React 19、Zustand、Vitest

---

## Chunk 1: 配置模型收口

### Task 1: 简化 AI 设置数据模型

**Files:**
- Modify: `src/types/ai.ts`
- Modify: `src/store/ai.ts`
- Modify: `src/lib/ai-settings.ts`
- Modify: `src/components/settings/AIConfigTab.tsx`
- Modify: `src/components/AISettingsModal.tsx`
- Test: `tests/ai-store.test.ts`
- Test: `tests/ai-types.test.ts`
- Test: `tests/ai-settings-helper.test.ts`
- Test: `tests/ai-settings-modal.test.tsx`
- Test: `tests/ai-config-tab.test.tsx`

- [ ] **Step 1: 调整 `AISettings` 数据结构**

目标：
- 删除 `LLMProvider` 类型
- 删除 `provider` 字段
- 保留 `llmBaseUrl`、`llmApiKey`、`llmModel`、`enableThinking`
- 在注释中明确：`llmBaseUrl` 必须是 OpenAI 兼容接口根路径，例如 `https://api.openai.com/v1`

示意代码：

```ts
export interface AISettings {
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  enableThinking?: boolean;
  jimengApiUrl: string;
  jimengSessionId: string;
}
```

- [ ] **Step 2: 更新本地存储兼容逻辑**

要求：
- 读取旧配置时忽略 `provider`
- 不再向新配置写入 `provider`
- 保持 `enableThinking` 缺省时默认 `true`

Run: `npm test -- tests/ai-store.test.ts tests/ai-types.test.ts`
Expected: 与 `provider` 相关的旧断言失败，其他基础行为仍可通过

- [ ] **Step 3: 收口设置 UI**

要求：
- `AIConfigTab` 删除“LLM 供应商”选择器与 `PROVIDER_OPTIONS`
- `AISettingsModal` 不再依赖 `settings.provider`
- 将提示语统一改成“OpenAI 兼容接口”
- 默认值固定为 `https://api.openai.com/v1` 和 `gpt-4o`

文案要求：
- `API Base URL` 提示改为 “OpenAI 兼容 API Base URL”
- 说明文案中移除 “OpenAI / 自定义二选一” 的描述

- [ ] **Step 4: 更新相关单测**

重点：
- 去掉所有 `provider: 'openai'` 断言
- 校验旧配置无 `provider` 时仍能正常加载
- 校验设置页不再渲染供应商选择器

Run: `npm test -- tests/ai-settings-helper.test.ts tests/ai-settings-modal.test.tsx tests/ai-config-tab.test.tsx`
Expected: 全部通过

- [ ] **Step 5: 提交该任务**

```bash
git add src/types/ai.ts src/store/ai.ts src/lib/ai-settings.ts src/components/settings/AIConfigTab.tsx src/components/AISettingsModal.tsx tests/ai-store.test.ts tests/ai-types.test.ts tests/ai-settings-helper.test.ts tests/ai-settings-modal.test.tsx tests/ai-config-tab.test.tsx
git commit -m "refactor: simplify ai settings to openai-compatible config"
```

---

## Chunk 2: 重建 LLM 接入层

### Task 2: 用 `src/lib/llm/` 取代旧 `llm-client.ts`

**Files:**
- Create: `src/lib/llm/model.ts`
- Create: `src/lib/llm/content.ts`
- Create: `src/lib/llm/index.ts`
- Delete: `src/lib/llm-client.ts`
- Test: `tests/llm-client.test.ts`
- Test: `tests/llm-client-stream.test.ts`

- [ ] **Step 1: 设计新的公开 API**

公开接口只保留以下三个函数：

```ts
export async function generateStructuredJson(
  settings: AISettings,
  systemPrompt: string,
  userMessage: string,
): Promise<string>

export async function generateText(
  settings: AISettings,
  systemPrompt: string,
  userMessage: string,
): Promise<string>

export async function streamText(
  settings: AISettings,
  systemPrompt: string,
  userMessage: string,
  onChunk: (chunk: string) => void,
  callbacks?: { onReasoningChunk?: (chunk: string) => void },
): Promise<string>
```

约束：
- 不保留 `callLLM*` 命名
- 不保留任何 `fetch('/chat/completions')`
- 所有外部调用统一从 `src/lib/llm/index.ts` 导出

- [ ] **Step 2: 实现 `model.ts`**

职责：
- 只负责把 `AISettings` 转成 `ChatOpenAI`
- 统一 `temperature`
- 统一 `baseURL`
- 统一 `extra_body.enable_thinking=false`

示意代码：

```ts
export function createChatModel(settings: AISettings) {
  return new ChatOpenAI({
    apiKey: settings.llmApiKey,
    model: settings.llmModel,
    temperature: 0.3,
    configuration: {
      apiKey: settings.llmApiKey,
      baseURL: settings.llmBaseUrl.replace(/\/+$/, ''),
    },
    ...(settings.enableThinking === false
      ? { modelKwargs: { extra_body: { enable_thinking: false } } }
      : {}),
  });
}
```

- [ ] **Step 3: 实现 `content.ts`**

职责：
- 从 LangChain `invoke()` / `stream()` 返回对象中统一提取正文文本
- 兼容 `string | content[] | chunk object`
- best-effort 提取 reasoning 相关字段

要求：
- 只保留与 LangChain 输出结构相关的最小解析逻辑
- 删除 SSE 专用函数：`drainSseEvents`、`extractSseDataPayload`、`callOpenAICompatibleTextStream`

- [ ] **Step 4: 实现 `index.ts`**

要求：
- `generateStructuredJson` 使用 LangChain 非流式调用
- 通过 `bind()` 或等效方式把 `response_format: { type: 'json_object' }` 交给模型
- `generateText` 使用 LangChain 非流式调用
- `streamText` 使用 LangChain `stream()`
- 流式逻辑中累计完整文本，并实时调用 `onChunk`
- 若最终无文本，抛出统一错误：`LLM 返回空内容`

伪代码：

```ts
const model = createChatModel(settings);
const runnable = model.bind({
  response_format: { type: 'json_object' },
});
const result = await runnable.invoke([
  new SystemMessage(systemPrompt),
  new HumanMessage(userMessage),
]);
```

- [ ] **Step 5: 删除旧文件并重写测试**

测试改造方向：
- 从断言 `fetch` URL / body，改为断言 `ChatOpenAI` 构造参数
- 非流式断言 `invoke()` / `bind().invoke()` 被调用
- 流式断言 `stream()` 被调用，`onChunk` 逐步收到内容
- `enableThinking=false` 断言 `modelKwargs.extra_body.enable_thinking === false`

Run: `npm test -- tests/llm-client.test.ts tests/llm-client-stream.test.ts`
Expected: 全部通过，且测试中不再出现 `fetch('/chat/completions')`

- [ ] **Step 6: 提交该任务**

```bash
git add src/lib/llm tests/llm-client.test.ts tests/llm-client-stream.test.ts
git rm src/lib/llm-client.ts
git commit -m "refactor: unify llm client on langchain"
```

---

## Chunk 3: 收口业务调用面

### Task 3: 业务模块改用新语义接口

**Files:**
- Modify: `src/lib/script-utils.ts`
- Modify: `src/lib/script-review.ts`
- Modify: `src/lib/ai-analysis.ts`
- Modify: `src/lib/subtitle-highlight-runner.ts`
- Modify: `src/pages/ScriptWorkbench.tsx`（如有直接类型引用或错误文案依赖）
- Test: `tests/ai-analysis.test.ts`
- Test: `tests/subtitle-highlight-runner.test.ts`
- Test: `tests/subtitle-highlight-ai.test.ts`

- [ ] **Step 1: 替换所有旧导入**

替换规则：

```ts
- import { callLLM, callLLMText, callLLMTextStream } from './llm-client';
+ import { generateStructuredJson, generateText, streamText } from './llm';
```

- [ ] **Step 2: 调整调用函数命名**

替换规则：

```ts
- callLLM(...) -> generateStructuredJson(...)
- callLLMText(...) -> generateText(...)
- callLLMTextStream(...) -> streamText(...)
```

要求：
- 同步修改注入式依赖类型，例如 `callModel?: typeof callLLM`
- 将其改成更清晰的 `generateJson?: typeof generateStructuredJson`

- [ ] **Step 3: 顺手清理语义不清的参数命名**

建议：
- `callModel` 重命名为 `generateJson`
- `response` 重命名为 `rawJsonText` 或 `generatedText`
- 避免“调用模型”这种抽象过宽的命名

- [ ] **Step 4: 跑业务相关测试**

Run: `npm test -- tests/ai-analysis.test.ts tests/subtitle-highlight-runner.test.ts tests/subtitle-highlight-ai.test.ts`
Expected: 全部通过

- [ ] **Step 5: 提交该任务**

```bash
git add src/lib/script-utils.ts src/lib/script-review.ts src/lib/ai-analysis.ts src/lib/subtitle-highlight-runner.ts src/pages/ScriptWorkbench.tsx tests/ai-analysis.test.ts tests/subtitle-highlight-runner.test.ts tests/subtitle-highlight-ai.test.ts
git commit -m "refactor: align ai workflows with llm service api"
```

---

## Chunk 4: 清理、验证与文档更新

### Task 4: 删除垃圾代码并完成回归

**Files:**
- Modify: `README.md`
- Search: `src/**/*`
- Search: `tests/**/*`

- [ ] **Step 1: 全局清理遗留引用**

Run: `rg -n "callLLM|callLLMText|callLLMTextStream|LLMProvider|provider: 'openai'|chat/completions|fetch\\(" src tests README.md`
Expected:
- 不再出现旧 LLM 调用函数
- `src/` 中不再出现针对 LLM 的手写 `fetch`
- `provider` 仅允许出现在历史文档或非本次范围的 ACP 配置里

- [ ] **Step 2: 更新 README**

要求：
- 文档改成“LLM 统一通过 LangChain 调 OpenAI 兼容接口”
- 删除“按 `/chat/completions` 结构直接调用”的实现表述
- 保留“即梦封面生成仍走图片接口”的说明

- [ ] **Step 3: 执行完整测试**

Run: `npm test`
Expected: 全量测试通过

- [ ] **Step 4: 进行一次构建验证**

Run: `npm run build`
Expected: Electron renderer/main 构建通过，无类型错误、无无效导入

- [ ] **Step 5: 提交最终清理**

```bash
git add README.md
git commit -m "chore: remove legacy llm transport code"
```

---

## 风险与处理原则

### 1. `reasoning_content` 提取不稳定

原则：
- 允许 `onReasoningChunk` 是 best-effort
- 不允许为了保留该字段重新引入手写 SSE/HTTP 双栈

### 2. JSON 模式兼容性差异

原则：
- 优先使用 LangChain 对 OpenAI 兼容协议的标准透传能力
- 若个别兼容模型不支持严格 `response_format`，在业务层通过 `parseLLMJsonResponse()` 兜底解析
- 不回退到手写 HTTP

### 3. 调用面调整的影响

原则：
- 允许一次性改名
- 不保留“旧命名 + 新命名并存”的兼容层
- 编译报错即改，避免留下中间态垃圾代码

---

## 完成定义

满足以下条件才算完成：

- `src/` 中不存在任何面向 LLM 的手写 `fetch`
- `src/lib/llm/` 成为唯一 LLM 接入边界
- `provider/openai/custom` 相关分支从运行时代码删除
- 业务层只依赖语义化的 3 个 LLM 能力函数
- `npm test` 与 `npm run build` 全部通过

Plan complete and saved to `docs/superpowers/plans/2026-04-09-llm-client-langchain-unification.md`. Ready to execute?

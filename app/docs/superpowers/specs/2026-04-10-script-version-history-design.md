# 设计文档：稿件版本历史 + 多 Provider 模型切换

> 日期：2026-04-10
> 状态：已确认

## 1. 目标

为 AI 写稿工作台增加两项核心能力：

1. **稿件版本历史** — 每次保存自动创建快照，支持浏览、预览、回滚。AI 生成的版本带特殊标记（来源 + 模型信息），方便追溯和对比。
2. **多 Provider 模型切换** — 全局配置多个 LLM Provider（OpenAI、DeepSeek、Anthropic 等），写稿时可选择 Provider + 模型，生成结果记录到版本历史。

## 2. 需求决策记录

| 维度 | 决策 |
|------|------|
| 版本创建时机 | 全量快照 — 每次保存自动建版 |
| 版本保留策略 | 滚动上限 100 + AI 版本豁免淘汰 |
| 模型切换范围 | 多 Provider，各有模型列表 |
| 历史 UI 形态 | 编辑器顶部下拉 + 只读预览 + "恢复此版本" |
| 版本存储方案 | SQLite（node:sqlite，复用现有模式） |
| Provider 配置层级 | 全局系统设置（所有功能模块共享） |

## 3. 全局 Provider 配置

### 3.1 类型定义扩展

在 `src/types/ai.ts` 中：

```typescript
/** 单个 LLM Provider 配置 */
export interface LLMProvider {
  id: string;                    // uuid
  name: string;                  // 显示名："DeepSeek"、"OpenAI"
  type: 'openai_compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  models: string[];              // ["deepseek-chat", "deepseek-coder"]
}

export interface AISettings {
  // --- 新增：多 Provider ---
  llmProviders: LLMProvider[];
  defaultProviderId: string | null;
  defaultModel: string | null;

  // --- 保留旧字段做兼容迁移 ---
  /** @deprecated 迁移后由 llmProviders 替代 */
  llmBaseUrl: string;
  /** @deprecated */
  llmApiKey: string;
  /** @deprecated */
  llmModel: string;
  enableThinking?: boolean;

  // 图片生成、TTS 配置不变
  jimengApiUrl: string;
  jimengSessionId: string;
  jimengModel?: string;
  minimaxApiKey: string;
  minimaxVoiceId: string;
  minimaxSpeed: number;
  minimaxVol?: number;
  minimaxPitch?: number;
  minimaxEmotion?: string;
  minimaxModel?: string;
}
```

### 3.2 迁移策略

在 `loadAISettings()` 中：如果 `llmProviders` 为空但旧字段 `llmBaseUrl` 有值，自动创建一个默认 Provider 并保存回去。旧字段保留但标记 deprecated。

### 3.3 createChatModel 改造

```typescript
// src/lib/llm/model.ts
export function createChatModel(
  provider: LLMProvider,
  model: string,
  options?: { enableThinking?: boolean }
): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: provider.apiKey,
    model,
    temperature: 0.3,
    configuration: {
      apiKey: provider.apiKey,
      baseURL: normalizeBaseUrl(provider.baseUrl),
    },
    ...(options?.enableThinking === false
      ? { modelKwargs: { extra_body: { enable_thinking: false } } }
      : {}),
  });
}
```

所有消费方（`script-utils`、`useAIVideoWorkflow`、`useAICardInspector`）统一改为先 resolve Provider + 模型再调用。

## 4. 版本历史数据库

### 4.1 存储位置

`{projectDir}/.acp/script-history.sqlite3`，与 `conversation.sqlite3` 同级，每个项目独立。

### 4.2 Schema

```sql
CREATE TABLE script_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT 'script.md',
  content TEXT NOT NULL,
  source TEXT NOT NULL,            -- 'ai_generate' | 'ai_review' | 'ai_rewrite' | 'manual'
  provider_id TEXT,                -- 引用全局 Provider 的 id（手动编辑时为 null）
  provider_name TEXT,              -- 冗余存储名称（Provider 可能被删除）
  model_name TEXT,                 -- 生成时的模型名
  label TEXT,                      -- 用户自定义标签
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_version_project_file
  ON script_version(project_id, file_name, created_at DESC);
```

设计要点：
- 每行是完整文本快照（.md 文件通常 < 10KB，全量存储简单可靠）
- `provider_name` 冗余存储：Provider 可能被用户删除或改名，版本记录需保留历史快照
- `source` 区分 AI 操作和手动编辑，用于过滤和淘汰策略

## 5. 版本历史服务层

### 5.1 文件结构

```
electron/script-history/
  db.ts              — 创建/获取 DB 实例
  migrations.ts      — Schema 迁移
  repository.ts      — SQL 读写操作
  service.ts         — 业务逻辑（淘汰策略、版本创建）
  ipc.ts             — IPC 通道注册
  types.ts           — 类型定义
```

复用 `electron/conversations/` 的四层模式：db → repository → service → ipc。

### 5.2 核心类型

```typescript
export type VersionSource = 'ai_generate' | 'ai_review' | 'ai_rewrite' | 'manual';

export interface ScriptVersionEntity {
  id: number;
  projectId: string;
  fileName: string;
  content: string;
  source: VersionSource;
  providerId: string | null;
  providerName: string | null;
  modelName: string | null;
  label: string | null;
  byteSize: number;
  createdAt: string;
}

/** 列表查询用（不含 content，减少传输量） */
export interface ScriptVersionSummary {
  id: number;
  fileName: string;
  source: VersionSource;
  providerName: string | null;
  modelName: string | null;
  label: string | null;
  byteSize: number;
  createdAt: string;
}

export interface CreateVersionInput {
  projectId: string;
  fileName: string;
  content: string;
  source: VersionSource;
  providerId?: string | null;
  providerName?: string | null;
  modelName?: string | null;
}
```

### 5.3 Service 核心逻辑

```typescript
class ScriptHistoryService {
  private readonly MAX_VERSIONS = 100;

  /** 创建版本 — 每次保存时调用 */
  createVersion(input: CreateVersionInput): ScriptVersionSummary
  // - 创建前比对上一条 content，完全相同则跳过（去重）
  // - 创建后自动触发淘汰

  /** 淘汰策略 */
  private evict(projectId: string, fileName: string): void
  // 1. 统计总版本数
  // 2. 若 <= MAX_VERSIONS，不操作
  // 3. 若超出，删除最旧的 manual 版本直到总数 <= MAX_VERSIONS
  // 4. AI 版本（source != 'manual'）永不自动淘汰

  /** 查询版本列表（不含 content） */
  listVersions(projectId: string, fileName: string, opts?: {
    sourceFilter?: VersionSource[];
    limit?: number;
    offset?: number;
  }): ScriptVersionSummary[]

  /** 获取单个版本完整内容 */
  getVersion(versionId: number): ScriptVersionEntity | null

  /** 回滚 — 先为当前内容建快照再返回目标版本内容 */
  prepareRollback(versionId: number, currentContent: string, projectId: string, fileName: string): {
    rollbackContent: string;
    savedCurrentVersionId: number;
  }

  /** 更新标签 */
  updateLabel(versionId: number, label: string | null): void

  /** 删除单个版本 */
  deleteVersion(versionId: number): void
}
```

## 6. IPC 通道 + Renderer API

### 6.1 IPC 通道

```
'script-history:create'       — 创建版本快照
'script-history:list'         — 查询版本列表（summary）
'script-history:get'          — 获取单个版本完整内容
'script-history:rollback'     — 回滚（自动保存当前 + 返回目标内容）
'script-history:update-label' — 更新用户标签
'script-history:delete'       — 删除版本
```

### 6.2 Renderer API

在 `src/lib/electron-api.ts` 新增：

```typescript
scriptHistory: {
  create(input: CreateVersionInput): Promise<ScriptVersionSummary>;
  list(projectId: string, fileName: string, opts?: ListOptions): Promise<ScriptVersionSummary[]>;
  get(versionId: number): Promise<ScriptVersionEntity | null>;
  rollback(versionId: number, currentContent: string, projectId: string, fileName: string): Promise<{ rollbackContent: string; savedCurrentVersionId: number }>;
  updateLabel(versionId: number, label: string | null): Promise<void>;
  delete(versionId: number): Promise<void>;
}
```

### 6.3 版本创建触发点

| 触发场景 | 调用位置 | source | 模型信息 |
|---------|---------|--------|---------|
| AI 生成完成 | `ScriptWorkbench.runInternalGenerateScript` 结尾 | `ai_generate` | 当前选中 provider + model |
| AI 审稿应用修改 | `scriptStore.acceptAnnotation / acceptAll` 后 | `ai_review` | 审稿时用的 provider + model |
| AI 重写完成 | 重写流程结尾 | `ai_rewrite` | 当前选中 provider + model |
| 手动保存 | `script-persistence.saveAllDirtyFiles` 内部 | `manual` | null |
| 回滚操作 | `service.prepareRollback` 内部自动 | `manual`（label="回滚前自动保存"） | null |

## 7. UI 设计

### 7.1 版本下拉（VersionDropdown）

位于 `FileTabs` 区域右侧，仅当打开 `script.md` 时显示。

下拉面板元素：
- **筛选器**：全部 / 仅 AI 生成 / 仅手动
- **版本条目**：图标（🤖 AI / ✏️ 手动）+ 时间 + Provider/模型名 + 来源标签 + 用户标签
- **最新版本**标记 `(当前版本)`
- 点击任意版本进入预览模式

### 7.2 预览模式（VersionPreviewBar）

编辑器切换为只读预览态，顶部显示横幅：
- 显示版本时间、来源、Provider/模型信息
- 操作按钮：[恢复此版本] [添加标签] [返回当前]

回滚流程：
1. 调用 `scriptHistory.rollback()` — 自动为当前内容建版本（安全网）
2. `setScriptText(rollbackContent)` + `saveScriptFile()`
3. 恢复编辑器可编辑 + `markReviewStale()`

### 7.3 模型选择器（ModelSelector）

在 `QuickActionBar` 生成按钮旁，按 Provider 分组下拉：

```
[🤖 DeepSeek / deepseek-chat ▾]  [生成口播稿]
```

选择持久化到 `project.json` script 段（`selectedProviderId` + `selectedModel`），不同项目可用不同模型。

### 7.4 系统设置 — Provider 管理

现有设置页面改造为 Provider 列表 + 增删改：
- Provider 卡片：名称、baseUrl、模型列表、默认标记
- 添加/编辑 Dialog：名称、类型（OpenAI 兼容 / Anthropic）、API 地址、API Key、模型列表
- 同一时间只能有一个默认 Provider

### 7.5 视觉规范

| 元素 | 样式 |
|------|------|
| 版本按钮 | 透明背景，文字 `#0066cc`，12px |
| 下拉面板 | 白色背景，圆角 8px，阴影 `rgba(0,0,0,0.22) 3px 5px 30px`，最大高度 400px 可滚动 |
| AI 版本条目 | 左侧紫色竖线 `#a78bfa` 4px |
| 手动版本条目 | 左侧灰色竖线 `#8e8e93` 2px |
| 预览横幅 | 背景 `#fff3cd`，高度 48px，文字 14px `#1d1d1f` |
| "恢复此版本" | Primary CTA `#0071e3` 白字，圆角 8px |
| "返回当前" | 透明背景边框按钮，文字 `#0066cc` |
| 用户标签 | ⭐ + 文字，黄色 pill badge |

### 7.6 Store 扩展

`src/store/script.ts` 新增：

```typescript
// ScriptState 新增
historyPreview: {
  active: boolean;
  versionId: number | null;
  content: string | null;
  versionMeta: ScriptVersionSummary | null;
};
selectedProviderId: string | null;
selectedModel: string | null;
```

预览时 `editorAgent.readOnly = true`，编辑器显示 `historyPreview.content`。退出预览恢复原状。

## 8. 集成数据流

### 8.1 生成流程

```
写稿页面读取 Provider 列表 → 模型选择下拉
  → 用户点击"生成口播稿"
  → resolve 当前选中的 provider + model
  → createChatModel(provider, model) → LLM 流式生成
  → 生成完成 → scriptText 更新 + saveScriptFile
  → scriptHistory.create({ source: 'ai_generate', providerId, providerName, modelName, content })
  → 版本下拉刷新
```

### 8.2 回滚流程

```
版本下拉选择历史版本
  → scriptHistory.get(versionId) → 编辑器切换只读预览
  → 用户点击"恢复此版本"
  → scriptHistory.rollback(versionId, currentContent, ...)
    → 自动为当前内容创建 manual 版本
    → 返回目标版本 content
  → setScriptText + saveScriptFile + markReviewStale
  → 编辑器恢复可编辑
```

## 9. 旧数据迁移

- **AISettings**：`loadAISettings()` 内检测 — `llmProviders` 为空且 `llmBaseUrl` 有值时，自动创建默认 Provider 并保存。
- **版本历史**：无需迁移。旧项目打开后自动创建空 SQLite，从此刻开始记录。

## 10. 边界约束

| 约束 | 说明 |
|------|------|
| 版本上限 | 默认 100，AI 版本豁免淘汰 |
| 去重 | 创建版本时比对上一条 content hash，完全相同则跳过 |
| 文件范围 | 第一期只对 `script.md` 做版本管理 |
| Provider 类型 | 第一期只实现 `openai_compatible`，`anthropic` 仅预留 |
| API Key 存储 | 沿用 settings.json 明文存储（与现状一致） |
| 版本历史跨项目 | 每个项目独立 SQLite |
| 并发安全 | 复用 `withTransaction` 模式 |

## 11. 不做的事情（YAGNI）

- 版本 diff 对比视图
- `original.md` 版本管理
- 版本导出/分享
- API Key 加密
- 模型自动探测（list-models API）
- `ChatAnthropic` 实际实现

## 12. 涉及修改的文件清单

| 文件 | 改动 |
|------|------|
| **新增** `electron/script-history/` (6 文件) | DB/迁移/仓库/服务/IPC/类型 |
| **新增** `src/components/script/VersionDropdown.tsx` | 版本下拉组件 |
| **新增** `src/components/script/VersionPreviewBar.tsx` | 预览模式横幅 |
| **新增** `src/components/script/ModelSelector.tsx` | Provider/模型选择器 |
| `src/types/ai.ts` | 新增 `LLMProvider`，扩展 `AISettings` |
| `src/lib/llm/model.ts` | `createChatModel` 签名改造 |
| `src/lib/script-utils.ts` | 生成/审稿/重写接口接入 Provider 参数 |
| `src/lib/script-persistence.ts` | `saveAllDirtyFiles` 内触发版本创建 |
| `src/store/script.ts` | 新增 `historyPreview` + `selectedProviderId/Model` |
| `src/store/ai.ts` | `loadAISettings` 加迁移逻辑 |
| `src/lib/electron-api.ts` | 新增 `scriptHistory` API |
| `electron/preload.ts` | 暴露 `scriptHistory` 通道 |
| `electron/main.ts` | 注册 script-history IPC |
| `src/pages/ScriptWorkbench.tsx` | 集成版本下拉 + 预览模式 + 模型选择器 |
| `src/components/script/QuickActionBar.tsx` | 嵌入 ModelSelector |
| 系统设置页面 | Provider 列表管理 UI |
| 所有 `createChatModel` 调用方 | 适配新签名 |

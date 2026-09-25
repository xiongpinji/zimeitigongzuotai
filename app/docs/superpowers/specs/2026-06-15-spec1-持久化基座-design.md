# Spec 1 · 持久化基座 + 契约版本治理

- 日期：2026-06-15
- 状态：设计已确认，待写实现计划
- 所属轨道：轨道一 · 成片闭环（Phase 0-1）
- 依赖：无（地基，Spec 2–5 均依赖它）

## 1. 背景与目标

整份《AI 全流程产品规划》是 4 阶段路线图，已拆为 5 份独立 spec（轨道一 Spec 1-3 成片闭环、轨道二 Spec 4-5 写稿闭环；控制层与发布闭环本期不做）。本文是其中第一份。

现状关键事实（已核对代码）：

- `project.json` 是单一 `version: 1` 文件，由 `electron/project-file.ts` 统一读写，已有 per-projectDir 写锁、legacy 文件迁移、卡片 hydrate/dehydrate、以及 `markSelfWrite` 打断 autosave↔watch 回环的守卫。
- `PipelineTask`（`electron/pipeline/types.ts` / `index.ts`）**完全是内存态**：有 `progress`/`status`/`error`/`logs`，但不落盘，进程重启即丢。
- `workflowMeta` 已在 project.json 里记录 autoMode 的 resume 参数，但"走到哪一步"目前靠磁盘产物**推断**，没有状态机。

目标：建立一套**可持久化、可校验、可诚实恢复**的项目级数据基座，让后续 Spec 2/3 的能力与编排有可靠的落盘契约，而不是继续靠"文件在不在"猜测进度。

本 spec **不**实现 workflow 的运行/转移逻辑（属于 Spec 3 编排器），只负责存储容器、读写 API、校验器、契约版本，以及把现有单个 PipelineTask 落盘并诚实恢复。

## 2. 交付边界

纳入本 spec：

- `.lingji/` 目录结构与初始化。
- `project.json` 注入 `schemaVersion: 2` + `capabilityVersion`，带 version 1 自动迁移。
- Workflow / Artifact 持久化容器 schema 与读写 API（容器，不含编排逻辑）。
- 现有内存 PipelineTask 落盘到 `.lingji/runs/`，并在重启时诚实恢复。
- 统一 Zod 校验器，供 file-first 与未来 MCP 路径共用。

不纳入（留给后续 spec）：

- workflow 步骤定义、状态转移、retry policy、invalidate/resume 编排逻辑 → Spec 3。
- `pipeline run/resume/...` 的 CLI/MCP 工具 → Spec 3。
- `waiting_approval` 的实际审批逻辑 → 仅在 schema 预留状态值，转移逻辑由 Spec 3 的最小审批门禁实现。
- `capabilityVersion` 的真实能力快照消费 → Spec 6（本期不做），此处仅占位写入。

## 3. 存储布局与契约版本

### 3.1 目录结构

项目目录下新增 `.lingji/`：

```text
.lingji/
  manifest.json        # 契约总账（.lingji 自身布局版本等）
  workflow.json        # 当前/历史 workflow 状态（数据容器，不含运行逻辑）
  artifacts.json       # 产物注册表（来源 + 输入版本 + 内容哈希）
  runs/
    <taskId>.jsonl     # 单个任务的 append-only 事件/日志流
```

### 3.2 契约版本（方案 B：注入 project.json）

`project.json` 升级：

- `version: 1` → `schemaVersion: 2`（保留原有全部数据字段）。
- 新增 `capabilityVersion: "2026-06"`（占位，Spec 6 才真正消费）。

迁移规则：读到 `schemaVersion` 缺失或 `version: 1` 时，视为 v1，补 `schemaVersion: 2` 与 `capabilityVersion`，回写。迁移复用现有 `migrateFromLegacyFiles` 的"读→补→写→标记自写"范式，不新开通道。

### 3.3 `.lingji/manifest.json`

```jsonc
{
  "schemaVersion": 1,             // .lingji 自身布局版本
  "capabilityVersion": "2026-06", // 能力快照标识（Spec 6 才消费，先占位）
  "workflowVersion": "1.0",       // workflow.json 结构版本
  "projectSchemaVersion": 2,      // 引用 project.json 的 schemaVersion
  "createdAt": "...",
  "updatedAt": "..."
}
```

### 3.4 git 与备份

- `.lingji/` 加入项目 `.gitignore`，不污染版本库。
- 接入应用现有备份配置，确保 workflow/artifacts/runs 随项目备份，不被误删。

## 4. 数据模型

Spec 1 只定义持久化容器与读写/校验；具体步骤定义和运行逻辑由 Spec 3 填充。schema 设计成"通用且可被 Spec 3 扩展"。

### 4.1 `workflow.json`

`steps` 是开放 map，Spec 1 不写死步骤种类：

```jsonc
{
  "workflowVersion": "1.0",
  "activeRunId": "run_xxx",        // 当前运行；无则 null
  "steps": {
    "<stepId>": {                  // 步骤 id 由 Spec 3 的 registry 定义
      "status": "pending|running|waiting_approval|succeeded|failed|canceled",
      "inputs": { "hash": "sha256:..." },        // 本步输入快照
      "outputs": ["<artifactId>"],               // 指向 artifacts.json
      "config": { "model": "", "provider": "", "promptVersion": "", "params": {} },
      "progress": { "phase": "", "percent": 0, "message": "" },
      "error": { "code": "", "message": "", "retryable": true, "suggestion": "" },
      "attempts": 0,
      "startedAt": null,
      "finishedAt": null
    }
  }
}
```

`waiting_approval` 先在 schema 里预留（对应被砍的 Spec 6 审批），Spec 1 不实现转移逻辑，只保证存得下、读得回，使 Spec 3 加最小审批门禁时无需再改 schema。

### 4.2 `artifacts.json`

文档 §三.2 的核心：让 AI 能判断"哪些要重做"而不是猜文件是否存在。

```jsonc
{
  "artifacts": {
    "<artifactId>": {
      "kind": "audio|subtitle|script|research|cover|card|timeline|export",
      "path": "podcast-audio.mp3",                  // 相对项目目录
      "contentHash": "sha256:...",
      "producedBy": "<stepId>",
      "inputs": [{ "artifactId": "...", "hash": "sha256:..." }],  // 上游依赖快照
      "stale": false,                                // 上游变更由 Spec 3 的 invalidate 置 true
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

内容哈希用 sha256（基于文件内容），由 artifact-registry 在登记/更新时计算。Spec 1 提供 `register/get/markStale` 读写 API；`stale` 的自动联动判定逻辑属于 Spec 3。

## 5. PipelineTask 落盘与重启恢复

现状 `pipeline/index.ts` 是纯内存 registry。改造：

- **写**：任务每次状态变更（`progress`/`status`/`error`/`logs`）除发 IPC 外，同时 append 一行到 `.lingji/runs/<taskId>.jsonl`（append-only，天然抗写半截）；另维护一个轻量索引（taskId → kind/status/projectPath）用于快速列出。
- **读 / 恢复**：应用启动或打开项目时，从 `runs/` 重建 registry 的终态任务用于展示历史。
- **关键正确性点**：进程重启后，先前标记 `running` 的任务其子进程其实已死，**不能假装还在跑**。恢复时一律把残留 `running` 改判为 `failed`，error code 新增 `interrupted`、`retryable: true`，让用户 / Spec 3 能 retry，而不是永远卡在 running。

与 Spec 3 的切线：**Spec 1 负责单任务的落盘与诚实恢复；Spec 3 负责跨任务的 workflow 编排与自动 resume。**

## 6. 迁移、校验器与写锁协同

### 6.1 project.json 迁移

在现有 `loadProjectFileRaw` / `hydrateExistingProjectData` 链路里加一步：读到 v1 时升级到 `schemaVersion: 2`，补 `capabilityVersion`，保留全部既有数据后回写。复用现有 `migrateFromLegacyFiles` 范式。

### 6.2 `.lingji/` 初始化

打开或创建项目时若 `.lingji/` 缺失则补建（manifest/workflow/artifacts/runs 空骨架），与 project.json 迁移在同一次加载里完成，旧项目无感升级。

### 6.3 统一校验器（文档 §三.7）

用 Zod 写一套 schema（project.json + manifest + workflow + artifacts），file-first（project-file.ts）与未来 MCP 路径共用同一份校验器，杜绝两边漂移。校验失败给可读错误，不静默吞。

### 6.4 写锁与 self-write 协同

- `.lingji/` 各文件用独立写锁 key（`${dir}::workflow`、`${dir}::artifacts`），与 project.json 写锁互不阻塞；`runs/*.jsonl` 走串行 append 队列。
- chokidar 监听范围显式排除 `.lingji/`，这些高频写入天然不触发 watch 回声，无需 `markSelfWrite`。

## 7. 代码落点

新增：

```text
electron/lingji-store/
  schema.ts            # Zod schema + 类型，统一校验器
  manifest-io.ts       # .lingji/manifest.json 读写 + 契约版本
  workflow-store.ts    # workflow.json 读写（容器，不含编排逻辑）
  artifact-registry.ts # artifacts.json 读写 + 哈希 / stale
  run-log.ts           # runs/<id>.jsonl append + 重启恢复（running→failed）
  init.ts              # .lingji 补建 + project.json schemaVersion 迁移
```

改动既有：

- `electron/project-file.ts`：接迁移与 `.lingji` 初始化。
- `electron/pipeline/types.ts`：error code 增加 `interrupted`。
- `electron/pipeline/index.ts`：任务状态镜像到 run-log，启动时恢复。
- `src/lib/project-persistence.ts`：`version` → `schemaVersion`、新增 `capabilityVersion` 类型与默认值。
- `.gitignore`、备份配置：纳入 `.lingji/` 规则。

## 8. 测试（Vitest）

- schema 校验器：合法/非法 project.json、manifest、workflow、artifacts。
- 迁移：`version: 1` 项目 → `schemaVersion: 2`，数据零丢失；已是 v2 的项目幂等不重复迁移。
- artifact-registry：内容哈希计算、`register/get/markStale`。
- run-log：append 与读取、杀进程重启后残留 `running` 改判 `failed(interrupted, retryable)`。
- 写锁并发：`.lingji` 各文件独立写锁互不阻塞，并发写不损坏文件。

## 9. 验收标准

1. 旧项目打开 → 自动补 `.lingji/` + project.json 升到 `schemaVersion: 2`，数据零丢失。
2. 任务跑一半杀进程重启 → 该任务显示 `failed(interrupted, 可重试)`，不卡 running。
3. `.lingji/` 不进 git、随应用备份走。
4. 统一校验器被 file-first 引用并跑通。

## 10. 风险与影响面

- 触及 CLAUDE.md 列为高风险的项：修改 `project.json` 结构（schemaVersion 注入）、迁移逻辑、Electron 主进程读写路径。需覆盖"新工程 / 旧工程迁移 / 并发保存"三类用例。
- `pipeline/index.ts` 改动与 Spec 3 编排器有部分重叠：本 spec 只做单任务落盘与诚实恢复，跨任务编排严格留给 Spec 3，避免现在写一半运行逻辑。
- 备份配置接入需确认现有备份机制的纳入/排除规则，避免 `.lingji/` 被既有忽略规则漏掉。

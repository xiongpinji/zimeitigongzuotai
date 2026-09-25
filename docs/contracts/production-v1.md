# 生产 sidecar 契约 v1（production-v1）

状态（证据分级，截至 2026-09-25）：

- **源码可见**：`app/src/types/production-contracts.ts`（类型与枚举）、
  `app/src/lib/production-document.ts`（纯解析 / 初始化）。
- **自动化测试**：`app/tests/production-contracts.test.ts`，由 Codex 独立复跑后作为验收证据。
- **尚未发生**：持久化接入、Electron 进程接线、真实账号登录、真实平台发布、Windows 安装包验收。
  本契约目前只是**纯 JSON 数据边界**，不代表任何平台侧能力已打通。

## 1. 与 Lingji `project.json` 的单一事实来源

- 编辑事实来源仍然是 Lingji 项目的 `project.json`（见 `app/electron/project-file.ts`）：
  时间线、卡片、脚本等可编辑内容只存在于该项目文件内。
- 本契约描述的是与一个 Lingji 项目关联的**生产 sidecar 文档**，只保存生产链路元数据与**引用**
  （`projectId`、`timelineRef`、`sourceRef`、`outputRef`、`sessionRef` 等），
  **绝不复制时间线 / 素材 / 凭证内容**，因此不会形成第二套可编辑事实来源。
- `ProductionDocumentV1.projectId` 关联一个 `project.json`；跨文档引用（如
  `CompositionPlanV1.timelineRef`）是不透明标识，由未来 Electron main 的适配层解释。
- `project.json` 的读取语义（absent / corrupt 必须区分、损坏先备份）见 `project-file.ts`；
  本契约不修改该行为，也不在契约层做文件读写。

### sidecar 不存在时怎么办

契约**不存在 v0**。没有 sidecar 文件时，由调用方（未来的 Electron main）显式调用：

```ts
createEmptyProductionDocument(projectId, { nowIso? })
```

创建空 v1 文档；解析器遇到缺失 / 非 1 的 `schemaVersion` 一律 `unsupported_schema_version`，
不猜测、不迁移、不静默补默认值。

## 2. Electron main / renderer / Agent 边界

| 层 | 职责 | 是否允许文件 / 凭证 |
| --- | --- | --- |
| `types/production-contracts.ts`、`lib/production-document.ts` | 纯数据定义与纯函数校验；可序列化、可跨进程传输 | 否 |
| Electron main（未来适配层） | sidecar 读写、任务队列、租约与重试、会话仓与登录 | 是（会话仓在仓库外加密存储） |
| renderer | 只消费/提交类型化数据，通过 IPC 交给 main | 否 |
| Agent / Skills | 只经类型化工具与任务状态机操作，不直接触碰会话文件 | 否 |

- 账号只保存元数据与不透明 `sessionRef`；Cookie、Token、密码、浏览器存储态内容
  **禁止**进入契约。解析器对凭证类字段名（如 `cookie`、`accessToken`）显式抛
  `credential_material_forbidden`，包括嵌在 `capabilitySnapshot` 内的键。
- 平台命名映射在 main 适配层完成：契约中的 `wechat-channels` 对应上游
  `electron/publish/types.ts` 的 `tencent`；上游 `bilibili` 不在阶段一契约内，
  送入契约会得到 `invalid_platform`。契约不 import 上游发布类型，避免耦合。

## 3. 数据模型（七类实体 + CommerceRequest）

根文档 `ProductionDocumentV1` 字段（全部必填，可空语义一律显式 `null`）：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 恒为 `1` |
| `projectId` | 关联的 Lingji 项目标识（非空白） |
| `createdAt` / `updatedAt` | ISO 8601 |
| `recordings` | 已导入直播录屏（引用 + sha256 + 时间码） |
| `highlights` | 高光候选 / 已确认片段（证据、边界来源、人工留痕） |
| `assets` | 授权素材（来源、权利持有人、许可、使用范围、自动入片开关） |
| `compositionPlans` | 混剪计划（叙事摘要、画幅、分段来源与时间码、时间线引用） |
| `videoVariants` | 可发布视频版本（合成计划 + 时间线 / 产物引用、质检状态） |
| `accounts` | 平台账号元数据（不透明 `sessionRef`、能力快照） |
| `publishJobs` | 发布任务（账号 × 视频版本、状态机、幂等键、租约、远端结果） |

关键子结构：

- `HighlightEvidenceV1`：`kind` ∈ `transcript / speaker / scene / audio-peak / interaction / manual / other`；
  时间码为所属录屏的绝对毫秒；`startMs` / `endMs` 可为 `null`（点状证据）。
- `CompositionSegmentSourceV1.inMs / outMs` 语义按 `kind` 区分：
  `recording` / `asset` 是来源媒体内 0 起毫秒区间；`highlight` 是所属录屏的绝对毫秒时间码，
  必须落在该高光 `[startMs, endMs]` 内。
- `PublishJobV1.state`：`draft → preflight → queued → uploading → submitted → verifying → published`，
  另有 `needs_login`、`needs_permission`、`needs_user_action`、`retryable_failure`、
  `terminal_failure`、`unknown_submission`。`unknown_submission` 必须先查远端再决定重试。
- `PublishJobRemoteResultV1.finalState`：`published / failed / unknown`。

### CommerceRequest（阶段一预留端口）

```ts
interface CommerceRequestV1 {
  platform: ProductionPlatform;      // 必须与账号平台一致
  accountId: string;                 // 必须与所属任务 accountId 一致
  kind: 'self-built' | 'shop' | 'alliance' | 'mini-program-anchor';
  platformProductId: string;         // 平台自有商品 ID，禁止 URL 冒充
  required: boolean;
}
```

fail-closed 规则：

- 阶段一四个平台商品插件都报告 `not_implemented`。
  `required=true` → 预检以 `COMMERCE_NOT_CONFIGURED` 阻止提交；
  `required=false` → 仍进入 `needs_user_action`。两条路径都**绝不**降级成普通发布。
- 任务要变成普通发布，必须由用户显式移除商品请求并另建任务。
- 解析器对缺失 `commerceRequest` 字段（而非显式 `null`）、非法 `kind`、
  空 `platformProductId`、URL 冒充、`accountId` / `platform` 与任务不一致
  抛 `invalid_commerce_request`；商品请求在往返中逐字段保留，不被丢弃。

## 4. 解析与校验语义（`lib/production-document.ts`）

`parseProductionDocument(input: unknown): ProductionDocumentV1` 是纯函数：
不依赖 Electron、磁盘、网络、全局状态；**不修改调用方传入的数据**（内部深拷贝），
也不产生共享引用。

错误码（`ProductionContractError.code`，`.path` 为 `$...` JSON 路径且非空）：

| code | 触发场景（示例） |
| --- | --- |
| `unsupported_schema_version` | 缺失 / `"1"` / `0` / 未来版本 |
| `invalid_document` | 非对象根、集合字段不是数组 |
| `invalid_field` | 缺字段、未知字段、类型 / 枚举 / ISO / sha256 不合法、账号 ID 等于昵称 |
| `invalid_platform` | 平台不在 `douyin/kuaishou/wechat-channels/xiaohongshu` 内（大小写敏感） |
| `invalid_commerce_request` | 商品请求内部字段非法或与任务 / 账号不一致 |
| `dangling_reference` | 高光 → 录屏、计划分段 → 来源、版本 → 计划、任务 → 账号 / 版本引用缺失 |
| `duplicate_id` | 同一集合内 ID 重复，包括合成计划内的分段与发布任务 |
| `duplicate_idempotency_key` | 不同发布任务复用幂等键，可能导致错误去重或重复提交 |
| `invalid_timecode` | 负 / 非整数 / 区间倒置 / 越出录屏、高光或素材边界 |
| `credential_material_forbidden` | 出现 Cookie / Token / 密码 / 会话存储态类字段 |

时间码边界规则：高光 `endMs > startMs`，且录屏 `durationMs` 已知时
`endMs <= durationMs`；分段区间 `outMs > inMs`，且按来源分别受录屏 / 高光 / 素材边界约束；
来源时长未知（`null`）时不做上界校验。

## 5. 尚未接入 / 未验证的限制

- 没有把 sidecar 写入任何项目目录，也没有读取逻辑；没有 Electron IPC、队列或调度接线。
- 没有迁移：不存在 v0，未来版本必须显式升级解析器后才会被接受。
- 没有真实账号登录、会话核验、发布或远端查询；`accounts` / `publishJobs` 只是数据形状。
- 商品挂载四平台均为 `not_implemented`，没有真实商品 ID 核验或挂载证据。
- “多版本实质不同”“原创判定”等只作为数据字段与内部质检线索，
  **不构成平台原创认定承诺**；素材授权与来源可追溯是本契约的硬要求。
- 未跑 Windows 安装包、未跑全量上游测试。本契约的验收证据仅到自动化测试级别，
  真实账号 / 平台最终状态需后续任务分别取证。

## 6. 修改约定

- v1 字段只增不改语义；任何破坏性调整必须提升 `PRODUCTION_SCHEMA_VERSION`，
  并让解析器对新版本显式失败，等待迁移实现。
- 新增字段必须同步：类型、解析器（必填 + 严格字段集）、测试夹具、本文档。
- 复制改动到上游发布适配器（平台命名映射）时必须留在 main 适配层，
  不得让契约 import 上游类型。

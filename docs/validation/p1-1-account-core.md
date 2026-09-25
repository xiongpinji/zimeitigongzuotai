# P1-1 账号核心（UUID 元数据 + 加密会话仓）验证记录

输入 SHA：`b8514a8`。工作树分支：`ao/p1-1-account-vault-20260925`。
本文档只覆盖**账号核心模块本身**；P1-1 整体（IPC、平台接线、真实账号登录 /
过期探针 / 重登 / 删除的端到端验证）**未在本 job 完成，也不因本 job 宣称完成**。

2026-09-25 复审修复：以主库 `841763d` 为输入，Qwen 路由在时限内写出失败测试与部分实现，但任务超时；Codex 接续补完、审查并在项目 Vitest 2.1.9 下复测 **56/56 通过**。新增测试先有 17 项失败，覆盖迁移中断残留、加密不可用分类、临时明文删除重试和原子写故障；Codex 再补“密文丢失时旧 registry 条目不可剔除”。`tsc --noEmit` 仍只有既有 Remotion `width` 参数错误，待 P0-1 发行分支合入统一复测。该证据仍只属于离线账号核心。

## 证据分级（按根 AGENTS.md）

| 层级 | 状态 |
| --- | --- |
| 源码可见 | ✅ `app/electron/publish/accounts-v2.ts`、`app/electron/publish/session-cipher-electron.ts`、`app/tests/publish/accounts-v2.test.ts` |
| 自动化测试通过 | ✅ 初版 35/35；本轮 Codex 在共享依赖的独立工作树运行项目 Vitest 2.1.9，56/56 通过。完整 `tsc --noEmit` 仅剩上游 `render-video-headless.ts` 的 `width` 旧错误，已由 P0-1 打包分支修复，待合并后统一复测。 |
| 真实账号验证 | ❌ 未发生。本 job 不读取真实用户账号目录 / Cookie，不做平台登录或发布。 |
| 平台最终状态验证 | ❌ 未发生。 |

Codex 复跑命令（在 `app/` 下）：

```bash
npm exec vitest run tests/publish/accounts-v2.test.ts
# 相关既有测试（本 job 未改动其行为）：
npm exec vitest run tests/publish/accounts.test.ts tests/publish/account-id.test.ts
```

实际退出码：账号核心初版 **0**（35/35），本轮复审修复 **0**（56/56）。一起运行的旧 `accounts.test.ts` 有 1 项 Windows 路径分隔符断言失败（测试硬编码 `/`，并非本模块回归）；`account-id.test.ts` 3/3 通过。

Codex 审查时新增 3 项先失败后修复的边界测试：损坏 `sessionRef` 不得跳出会话目录、非法 `storageState` 不得落库、旧账号名中的路径分隔符不得触发越界迁移。`AccountVaultError.cause` 只保留安全的系统错误码，不暴露原始异常文本。

## 已实现内容（源码可见级）

### `app/electron/publish/accounts-v2.ts` — `AccountVault`

- **UUID 身份**：账号 id 由 `crypto.randomUUID()` 生成，绝不从 `platform + 昵称`
  拼出；同平台多账号、同名跨平台账号天然隔离。旧 `buildAccountId` 仅在迁移时
  用于定位旧文件，不再是身份。
- **元数据 registry**（`<root>/registry.json`，`{schemaVersion:1, accounts:[...]}`）：
  只含 `id / platform / displayName / owner / status / sessionRef / lastCheckedAt /
  createdAt / migratedFrom`。Cookie、Token、Playwright storageState 内容一律不进
  registry（测试对 registry 原文做敏感串断言）。
- **加密会话仓**：storageState 经注入的 `SessionCipher` 加密后写入
  `<root>/sessions/<sessionRef>.bin`；`sessionRef = s1-<32 hex 随机>`，不可预测、
  不含昵称，文件仅以引用寻址。每次保存轮换新引用并删除旧密文。
- **原子写**：registry 与会话文件一律 tmp + fsync + rename（含 Windows EPERM/EBUSY 短退避
  重试，语义与 `project-file.ts` 一致）；失败保留原目标并清理 tmp。文件 fsync 降低异常退出损坏风险，但不保证断电后的目录元数据已持久化。
- **显式错误**：`AccountVaultError` 携带错误码（`registry_corrupt`、
  `registry_unsupported_version`、`session_file_missing`、`session_decrypt_failed`、
  `session_verify_failed`、`cipher_unavailable`、`account_not_found`、
  `legacy_registry_corrupt` 等）。registry / 会话文件读取或解密失败一律抛错，
  **不吞错当空账号**；错误信息只含 accountId / sessionRef / 错误码，不含会话内容。
- **输入与路径边界**：会话引用必须匹配 `s1-<32 hex>`；旧账号名不得包含路径分隔符；保存前校验 storageState 为含 `cookies` 与 `origins` 数组的 JSON。
- **平台范围**：仅 `douyin / tencent（视频号）/ xiaohongshu / kuaishou`；
  `bilibili` 等范围外平台显式 `invalid_platform`。

核心 API（供后续 IPC / 平台适配层调用）：

| API | 语义 |
| --- | --- |
| `createAccount({platform, displayName, owner?})` | 生成 UUID 元数据，初始 `status: 'unknown'`、`sessionRef: null` |
| `saveStorageState(accountId, storageStateJson)` | 加密 → 原子写 → **回读解密核验一致** → 更新 registry（`status: 'valid'`）→ 删旧密文；加密不可用抛 `cipher_unavailable`，核验失败抛 `session_verify_failed` 且不落库 |
| `withDecryptedStorageState(accountId, use)` | 短时解密：明文只写入本次调用独立 `mkdtemp` 临时目录（0600），`finally` 连同目录删除；EPERM/EBUSY 做有界重试，耗尽显式 `temp_cleanup_failed`；解密子系统不可用单独报 `cipher_unavailable` |
| `updateStatusFromProbe(accountId, ok, checkedAt?)` | 探针结果只更新目标账号（`valid`/`expired` + 时间戳），其余账号不动 |
| `removeAccount(accountId)` | 删除元数据 + 加密会话文件；重复删除显式 `account_not_found` |
| `migrateFromLegacy(legacyRoot)` | 旧 registry 显式迁移入口（见下） |

### `app/electron/publish/session-cipher-electron.ts` — 生产加密适配器

`createSafeStorageCipher()` 委托 Electron `safeStorage`，**fail closed**：
`isEncryptionAvailable()` 为 false 时 `encrypt` / `decrypt` 抛
`AccountVaultError('cipher_unavailable')`，**没有明文降级路径**（有意区别于
`acp/config.ts` 的 API Key 明文回退）。测试通过 `vi.mock('electron')` 验证委托与
fail-closed 行为；单元/边界测试使用测试内假加密器（`FakeCipher`，仅存在于测试
文件，严禁生产使用）。

### 迁移语义（`migrateFromLegacy`）

- 逐条迁移旧 `AccountStore` 数据目录：新 UUID 账号 + 明文 storageState 加密入新仓；
  原子重写旧 registry 剔除已消费条目后，**仅在新密文可再次解密且与旧明文逐字节一致时才删除旧明文**。中断于两步之间时，下次显式迁移会续清理。
- fail closed：加密不可用且存在待迁移明文 → 整体抛 `cipher_unavailable`，不触碰旧数据。
- 单条失败（读取 / 加密 / 核验）记入 `report.failed` 并**完整保留该条旧数据**，
  不阻断其他条目；失败原因只记机器可读码，不含会话内容。
- 范围外平台（bilibili）保守跳过（`skipped: unsupported_platform`），旧文件不动。
- 幂等：新账号带 `migratedFrom` 溯源标记；崩溃后重跑对已迁移条目
  `already_migrated` 跳过，并继续完成旧 registry / 旧明文的清理。只有 marker 属于同平台唯一账号、路径未越界、密文存在且与旧明文逐字节相同时才删残留；密文缺失、失配或加密服务不可用时保留旧明文。
- 旧 registry 损坏显式抛 `legacy_registry_corrupt`，不做任何迁移；旧 registry
  不存在时仍会扫描**已知 marker 对应**的残留文件并做同样核验，无可恢复项时报告为空。

## 风险与限制

- **短时明文窗口**：`withDecryptedStorageState` 期间明文 storageState 存在于独立
  临时目录（0600、`finally` 清理）。进程崩溃可能遗留临时目录，位于 OS tmp，
  由系统清理策略兜底；正常退出的 EPERM/EBUSY 已有有界重试，耗尽会报错但仍可能遗留文件。后续接线时应确保平台适配器不将该路径写入日志。
- **未接线**：本模块没有被任何 IPC、runner、platforms、UI 引用；`accounts.ts` /
  `account-id.ts` / `ipc.ts` / `runner.ts` / 契约 / 锁文件均未改动。旧发布链路行为
  不变（仍走明文 `platform_accountName.json`），直到 Codex 完成适配层接线。
- **safeStorage 平台差异**：Linux 上 `safeStorage` 依赖 kwallet/gnome-libsecret，
  不可用时本模块 fail closed（拒绝保存/迁移），这是预期行为而非缺陷；Windows/macOS
  行为未在真实打包环境验证。
- **无并发互斥**：registry 读-改-写无跨进程锁；单 main 进程串行调用是前提，
  与 P1-2 队列的账号锁衔接由接线任务处理。
- **时间戳为 epoch ms**：与上游 `PublishAccount.lastCheckedAt` 对齐；契约
  `AccountV1`（ISO 字符串、`active/needs_login` 状态、`wechat-channels` 平台名）
  的映射留给 main 适配层，本模块不 import 契约类型。

## 尚未完成（后续 job / Codex）

- IPC（`publish:*` 通道改造）、preload / electron-api、登录流程改造（平台 login
  写入临时路径后经 `saveStorageState` 入仓）、runner 改用
  `withDecryptedStorageState`、设置页 UI、审计日志。
- 四平台真实账号登录、过期探针、重登、删除的端到端与平台最终状态验证。
- 与 `AccountV1` 契约（`production-contracts.ts`）字段映射及生产 sidecar 写入。

## 协作通道说明

本会话按任务要求尝试通过 `channel.py event` 发布阶段更新，均被本地权限系统拒绝
（`This command requires approval`，无交互审批可用），未能送达 Codex；`ask` 通道
同样不可用，因此实现中的裁量决策（状态枚举对齐上游 `valid/expired/unknown`、
迁移采用“显式迁移 + 保守拒绝”混合语义、时间戳用 epoch ms）已在本文档与最终报告
中完整披露，供 Codex 复核改判。

# Goal

把已验收的 `AccountVault.withLoginStorageState` 接入四平台独立账号管理，先形成可测试的主进程服务，再接 Electron 桥和设置页。账号以 UUID 区分同平台同名实例；明文会话路径和原始平台错误不得越过主进程。此计划细分 [阶段一 A2](2026-09-26-phase1-bounded-continuation-1.md)，不宣称真实账号登录或旧发布链已切换。

# Decisions and assumptions

- 输入主库至少包含 A1 事务提交 `1b5ef8c`；GLM 只读审查 `qwen-code-review-20260925-185052-0bc9da` 已由 Codex 验收为设计输入。审查时使用旧工作树，故其中“A1 尚未落库”的句子已过时。
- 新 `account-v2:*` 命名空间、独立安全 DTO 和设置页，旧 `publish:*` 保持原样直到 P1 以同一账号体系替换上传路径。旧 `publish:run` 只能接受旧 ID；不应静默跳过 UUID。
- 新建账号和扫码登录分两步：`create` 立即返回 UUID；`login(accountId, requestId, headless?)` 只操作该账号。Renderer 在调用前生成 UUID 格式的 `requestId`，二维码事件可在异步返回前关联。新建后登录失败时保留 `unknown` 账号供用户重试或删除；重登失败保留原密文。
- 四平台账号标识沿用仓内 `douyin`、`kuaishou`、`tencent`、`xiaohongshu`；`tencent` 到 `wechat-channels` 的发布目标映射只放在既有队列适配器。B 站不进入本期新账号仓。
- 旧数据仅提供只读迁移预览；`migrateFromLegacy()` 会改变旧 registry/明文文件，在 P1 替换旧发布链且无在途旧任务之前不得经 IPC 暴露或对真实 userData 执行。

# Constraints and guardrails

- 只使用用户确认的三条 Agent Orchestrator 路由：Qwen 主要实现、DeepSeek 并行实现、GLM 只读；Codex 负责分解、审查、测试和选择性合入。各项独立工作树、精确文件白名单，至多两个实现任务并行。
- 所有登录/探针经 `AccountVault` 的临时明文事务。IPC 仅返回固定错误码和安全常量消息；不得返回 `sessionRef`、`storageStatePath`、Cookie、Token、原始平台异常、二维码文件路径。
- 二维码回调只读本次登录临时目录中的普通 PNG 文件：路径规范化和真实路径受限于该目录，文件大小上限 512 KiB、PNG 魔数校验、每次请求最多 64 次事件。错误即设置失败标记；即使平台内部吞掉回调异常，事务也不得把该次登录当成功提交。事件携带已知的 `requestId`、`accountId`、递增序号和 `data:image/png;base64,...`，不携带磁盘路径。
- 探针只有获得明确布尔结果才更新目标账号；异常保持原状态。对单账号加登录互斥，删除在登录中返回 `login_busy`，不影响同平台其他账号。队列吞吐和平台限流另行验收。
- 不触真实账号、真实迁移、真实发布、商品挂载、依赖安装、部署；离线测试不能替代真实平台验收。

# Checklist

- [x] A2-S1：实现可注入的主进程 `account-v2` 账号服务与 IPC：create/list/login/relogin/check/delete，四平台白名单、UUID/请求关联、临时会话事务、二维码受限数据事件、错误脱敏、单账号互斥；先写合成 RED 测试。仅改新服务、新测试和验证文档，不接 `main.ts`、preload、Renderer。验收见 [A2-S1 记录](../validation/p1-1-account-ipc-core.md)。
- [x] A2-S2：在 S1 验收后接 `main.ts` 注册、preload 与 Renderer 类型，验证 IPC 形状、事件退订和生产加密适配器。不得触旧 `publish:*`。验收见 [A2-S2 记录](../validation/p1-1-account-bridge.md)；真实扫码与单实例门槛仍待后续。
- [ ] A2-S3：在 S2 验收后增加独立账号设置页和 UUID 键控 store，覆盖同平台同名账号、扫码续登、探针、删除和失败提示；旧发布工作台仍使用旧账号列表并清楚显示未切换边界。
- [ ] A2-S4：修复旧 runner 对未知/UUID 目标的静默跳过，并实现只读旧账号迁移预览；测试旧文件字节不变、B 站排除和无破坏性迁移 IPC。真实迁移留到 P1 激活门槛。

# Validation strategy

每项由实现路由先交付 RED→GREEN 和精确 diff；Codex 在当前主库 SHA 上独立跑聚焦 Vitest、`tsc --noEmit`、`git diff --check` 并审查高风险数据流。主进程服务用注入的假 IPC、假平台及合成 storageState；桥和 UI 再做契约/渲染测试。真实账号、四平台网页、远端发布最终状态另设验收。

# Completion criteria

S1–S4 全部经独立验收并选择性合入后，四平台新账号管理的离线链路才可称完成；旧发布路径、真实平台登录保持与迁移仍需 P1 和授权账号验证。任何原文凭证/路径跨 IPC、旧账号被自动迁移或 UUID 被旧 runner 静默忽略都视为未通过。

# P1-3 第一段：抖音 / 快手普通发布队列适配层验证记录

输入基线 SHA：`ae34a48`。工作树：`zimeitijuzhen-ao-douyin-kuaishou-adapter`（detached HEAD）。
本记录只覆盖新增的离线适配边界，**不等于 P1-3 全项验收**；四平台真实登录、真实提交、
远端作品 ID 与最终状态均未验证。

本轮只新增 3 个文件，未改动 `runner.ts`、平台脚本、队列、账号库、IPC、契约、package/lock：

| 文件 | 内容 |
| --- | --- |
| `app/electron/publish/queue-platform-adapter.ts` | 可注入 `PublishExecutor` 工厂与稳定安全错误码枚举 |
| `app/tests/publish/queue-platform-adapter.test.ts` | 22 项纯离线边界测试（真实 `AccountVault` + 假加密器 + 假平台模块） |
| `docs/validation/p1-3-queue-platform-adapter.md` | 本文档 |

## 证据分级（按根 AGENTS.md）

| 层级 | 状态 |
| --- | --- |
| 源码可见 | ✅ 上述 3 文件；生产适配层不 import 浏览器 / 网络 / fs，不自行拼路径 |
| 自动化测试通过 | ✅ 聚焦测试 **22/22，退出码 0**；`tsc --noEmit` 退出码 0（Windows Node 22，2026-09-25） |
| 真实账号验证 | ❌ 未发生。测试只注入假平台模块，不读真实账号 / 素材 / Cookie，不触网 |
| 平台最终状态验证 | ❌ 未发生 |

验证命令（在 `app/` 下，按任务指定用 Windows Node 22）：

```bash
C:/Users/canqu/Documents/Codex/2026-09-24/new-chat/work/node22/node_modules/node/bin/node.exe \
  ./node_modules/vitest/vitest.mjs run tests/publish/queue-platform-adapter.test.ts
# RED（实现前）：Test Files 1 failed，加载 queue-platform-adapter 失败，退出码 1
# GREEN（实现后）：Test Files 1 passed / Tests 22 passed，退出码 0

C:/Users/canqu/Documents/Codex/2026-09-24/new-chat/work/node22/node_modules/node/bin/node.exe \
  ./node_modules/typescript/bin/tsc --noEmit
# 无输出，退出码 0
```

## 适配层边界（源码可见级）

`createQueuePlatformExecutor(deps): PublishExecutor`，其中注入项：

- `vault`：真实 `AccountVault` 的 `getAccount` / `withDecryptedStorageState` 投影；
- `platformModules`：只注入 `douyin` / `kuaishou` 的 `PlatformModule`，模块自报 `platform`
  与注入键不一致时工厂直接抛错；
- `resolveVideoRef(videoRef, context)`：由接线方负责把安全引用解析为可读本地路径
  （含越界 / 可读性预检）；本段**不**自造任意路径访问；
- `headless`：默认 `true`，仅透传给 `uploadVideo`；登录探针的无头策略由平台模块自身决定。

执行顺序：平台白名单 → 模块存在性 → 调用前 signal → 账号元数据 / 平台一致 / 会话存在 →
视频引用预检 → 调用前 signal → `withDecryptedStorageState` 短时作用域内 `checkCookie` 探针 →
`uploadVideo`。探针与上传共用同一次短时明文路径，作用域结束由账号仓 `finally` 清理。

## 保守状态映射

| 场景 | 返回 kind | 错误码 | `confirmedNotSubmitted` |
| --- | --- | --- | --- |
| 平台非 douyin / kuaishou（视频号、小红书等） | `needs_user_action` | `adapter_unsupported_platform` | `true` |
| 未注入对应平台模块 | `needs_user_action` | `adapter_platform_module_missing` | `true` |
| 调用前 signal 已取消 | `failed`（retryable） | `adapter_aborted_before_upload` | `true` |
| 账号 UUID 不存在 | `needs_user_action` | `adapter_account_not_found` | `true` |
| 账号仓不可读（registry 损坏等） | `needs_user_action` | `adapter_account_unreadable` | `true` |
| 账号平台与任务平台不一致 | `needs_user_action` | `adapter_account_platform_mismatch` | `true` |
| `sessionRef` 为空（未保存会话） | `needs_login` | `adapter_session_missing` | `true` |
| 账号状态 `expired` | `needs_login` | `adapter_session_expired` | `true` |
| 密文缺失 / 解密失败 | `needs_login` | `adapter_session_unreadable` | `true` |
| 加密子系统不可用 | `needs_user_action` | `adapter_vault_cipher_unavailable` | `true` |
| 视频引用解析抛错 / 返回空 | `needs_user_action` | `adapter_video_preflight_failed` | `true` |
| `checkCookie` 返回 false | `needs_login` | `adapter_session_probe_failed` | `true` |
| `checkCookie` 抛错 | `failed`（retryable） | `adapter_session_probe_error` | `true` |
| 上传方法抛错 | `unknown` | `adapter_upload_failed_unconfirmed` | 不设置 |
| 上传完整返回后 signal 已取消 | `unknown` | `adapter_upload_aborted_unconfirmed` | 不设置 |
| 上传 `void` 正常返回（本段唯一成功路径） | `unknown` | `adapter_upload_unverified` | 不设置 |
| 上传调用后短时明文清理失败 | `unknown` | `adapter_session_release_failed` | 不设置 |
| 上传前回调已完成但清理失败 | `needs_user_action` | `adapter_session_release_failed` | `true` |
| 其他内部异常且未上传 | `unknown` | `adapter_internal_error` | 不设置 |

所有错误码均在 `QUEUE_PLATFORM_ADAPTER_ERROR_CODES` 稳定枚举内，匹配队列审计的
`[a-z0-9_.-]{1,64}`；适配层不返回 / 不记录明文 storageState 路径、Cookie、临时目录或
原始异常文本。`uploadVideo` 的 resolve 不被当作远端最终状态；本模块没有核验器，
不重试未知提交。

## 测试覆盖（22 项）

- 两平台（douyin / kuaishou）各一次完整调用；
- 同平台两个内部 UUID：短时明文路径不同、各自明文内容不串用、调用后临时目录清空；
- 会话失效：`sessionRef` 为空、`expired`、密文丢失、cipher 不可用；
- 平台错配（账号平台与任务不一致）与范围外平台 / 缺模块；
- 视频引用解析抛错（异常文本含敏感串）与返回空路径均在上传前阻止；
- 探针 false / 探针抛错；
- 上传正常 `void` 返回、上传抛错、上传中取消均返回 `unknown`，且不带 `confirmedNotSubmitted`；
- 上传后短时清理失败返回 `unknown`，上传前清理失败返回 `needs_user_action`；
- 所有结果断言不含 Cookie 值、原始异常文本、账号仓 / 临时目录路径，且不出现 `submitted`。

## 本段不接线的原因（重要）

- 主库 P1-2 运行时仍有「租约超时释放账号锁但上传 Promise 未停止」的已知缺陷：
  适配器一旦进入 `uploadVideo` 就无法被中止，队列亦无法回收。必须先修 P1-2 再接线。
- 真实 `uploadVideo` 无 AbortSignal 参数，本适配层已按最保守方式处理取消与异常
  （等待结束 + `unknown`），但它不能替代队列侧的挂起执行器治理。
- 现有平台模块的封面参数需要各自的多比例封面路径；本段不解析 `coverRefs`，
  上传时不传封面，接线时需由接线方提供与 `resolveVideoRef` 同级的封面解析与预检。
- 四平台真实登录 / 过期探针 / 提交 / 远端 ID / 最终状态全部未验收；本段不能作为
  自动真实发布上线的依据。

## 后续缺口

- 远端核验器（作品 ID / 最终状态查询）尚未实现；在它可用前，本适配层的所有上传
  都会停在 `unknown_submission`，由人工或未来核对器接管。
- 平台登录态轮换：`uploadVideo` 会把刷新后的 storageState 写回短时明文路径，
  本段有意不写回账号仓；重新加密回仓的语义需在接线任务中单独设计并测试。
- 需要真实账号的端到端验证（登录、上传、核对、最终状态）后才能提升证据等级。
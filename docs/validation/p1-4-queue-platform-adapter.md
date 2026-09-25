# P1-4 第一段：视频号 / 小红书普通发布队列适配层验证记录

输入基线 SHA：`7a79790`（`7a7979007da0dcaac2a5471543db1b7bc297a234`，P1-3 第一段抖音 / 快手
保守适配已合入）。工作树：`zimeitijuzhen-ao-wechat-xiaohongshu-adapter`（detached HEAD）。
本记录只覆盖把视频号 / 小红书并入 P1-3 同一适配器接口的离线边界，**不等于 P1-4 全项验收**；
四平台真实登录、真实提交、远端作品 ID 与最终状态均未验证，P1-2 运行时锁缺陷未修复，
本模块保持**未接线**。

本轮只改动 3 个文件，未触碰 `runner.ts`、平台脚本、队列、账号仓、IPC、契约、依赖或用户数据
（`app/node_modules` 为预置 Windows Junction，未触碰）：

| 文件 | 内容 |
| --- | --- |
| `app/electron/publish/queue-platform-adapter.ts` | 平台白名单扩为四契约平台名；新增 `QUEUE_PLATFORM_ADAPTER_MODULE_PLATFORMS` 映射表（wechat-channels→tencent）；工厂注入校验与账号平台一致性检查按映射后上游名比对 |
| `app/tests/publish/queue-platform-adapter.test.ts` | 22 → 32 项离线边界测试：原抖音 / 快手用例全部保留，新增视频号 / 小红书映射、隔离与脱敏用例，改写 1 项前提反转的不支持平台用例 |
| `docs/validation/p1-4-queue-platform-adapter.md` | 本文档 |

## 平台名映射（全项目唯一映射点）

| 队列契约名（`QueuePlatform`，production-contracts） | 上游模块（`PlatformModule.platform`） | 账号仓（`AccountVaultPlatform`） |
| --- | --- | --- |
| `douyin` | `douyin` | `douyin` |
| `kuaishou` | `kuaishou` | `kuaishou` |
| `wechat-channels`（视频号） | `tencent` | `tencent` |
| `xiaohongshu` | `xiaohongshu` | `xiaohongshu` |

映射导出为 `QUEUE_PLATFORM_ADAPTER_MODULE_PLATFORMS`，只用于两处：

1. 工厂注入校验——`platformModules` 以契约名为键，模块自报 `platform` 必须等于映射后的
   上游名（`'wechat-channels'` 键只接受自报 `'tencent'` 的模块，错配创建即抛 `TypeError`）；
2. 账号平台一致性检查——`wechat-channels` 任务只接受账号仓 `platform === 'tencent'` 的账号。

映射是**单向**的：输入侧绝不接受上游名，`tencent` / `bilibili` 等非契约平台名仍显式返回
`adapter_unsupported_platform`（fail closed，无反向隐式映射）。`resolveVideoRef` 上下文携带
契约名（视频号是 `'wechat-channels'`，不是 `'tencent'`）。

## 证据分级（按根 AGENTS.md）

| 层级 | 状态 |
| --- | --- |
| 源码可见 | ✅ 上述 3 文件；生产适配层不 import 浏览器 / 网络 / fs，不自行拼路径，错误码枚举无新增、无泄露 |
| 自动化测试通过 | ✅ Codex 在隔离工作树独立运行适配器 32/32、账号仓 58/58、队列 35/35，合计 **125/125**，退出码 0；`tsc --noEmit` 退出码 0；worker 会话自身执行受阻（见下） |
| 真实账号验证 | ❌ 未发生。测试只注入假平台模块，不读真实账号 / 素材 / Cookie，不触网、不登录、不上传 |
| 平台最终状态验证 | ❌ 未发生 |

### 验证环境阻断记录（原样错误，未反复申请、未修改 Junction）

本 worker 会话运行于 WSL2，按任务指定应使用 Windows Node 22。实际尝试与阻断如下：

- Windows Node 22 路径探测被拒：
  `ls in '/mnt/c/Users/canqu/Documents/Codex/2026-09-24/new-chat/work/node22/node_modules/node/bin/node.exe' was blocked. For security, Claude Code may only list files in the allowed working directories for this session: '/mnt/d/AI编程库/项目库/进行中的项目/zimeitijuzhen-ao-wechat-xiaohongshu-adapter'.`
- 直接执行该 `node.exe` 与 WSL Node 兜底运行 vitest / tsc，均返回：`This command requires approval`（未获批）。
- 协作通道 `channel.py` 的 event / ask 同样返回 `This command requires approval`（未获批），阶段更新改为会话内文字记录。

Codex 随后在隔离工作树 `app/` 下用 Windows Node 22 独立执行（与 P1-3 记录同一路径）：

```bash
C:/Users/canqu/Documents/Codex/2026-09-24/new-chat/work/node22/node_modules/node/bin/node.exe \
  ./node_modules/vitest/vitest.mjs run tests/publish/queue-platform-adapter.test.ts
# 预期 RED（仅回退 queue-platform-adapter.ts 到 7a79790、保留新测试时）：11 项失败 =
#   10 项新增用例（旧实现对 wechat-channels / xiaohongshu 一律返回
#   adapter_unsupported_platform）+ 工厂注入边界 1 项（旧实现忽略未知注入键，
#   新增的映射错配断言不再抛错）；退出码 1。
#   本轮因执行被阻断，RED 未实际运行，仅按旧实现代码路径推断。
# 实际 GREEN（本轮完整改动）：Test Files 1 passed / Tests 32 passed，退出码 0。

C:/Users/canqu/Documents/Codex/2026-09-24/new-chat/work/node22/node_modules/node/bin/node.exe \
  ./node_modules/typescript/bin/tsc --noEmit
# 实际无输出，退出码 0（tsconfig include 仅 src / electron；tests 不在 tsc 范围，
# 与 P1-3 相同，测试类型正确性由 vitest 转译与人工核对保证）。
```

同次复测还运行 `tests/publish/accounts-v2.test.ts`（58/58）与
`tests/publish/durable-queue.test.ts`（35/35），三文件合计 125/125、退出码 0；
`git diff --check` 退出码 0。GLM 只读审查未发现阻断本离线适配层合入的问题；
GLM 会话没有 shell 工具，未独立复跑测试或 `git diff`。这些结果不提升真实账号及远端状态证据等级。

实际改动范围（`git diff --stat`，基线 `7a79790`）：

```text
 app/electron/publish/queue-platform-adapter.ts   |  56 +++-
 app/tests/publish/queue-platform-adapter.test.ts | 358 ++++++++++++++++++++++-
 2 files changed, 393 insertions(+), 21 deletions(-)
 （另有本文档新增；工作树除此之外只有预置的 ?? app/node_modules Junction，未触碰）
```

## 适配层边界（源码可见级）

工厂与依赖注入风格与 P1-3 完全一致，未复制账号解密 / 路径 / 错误处理逻辑：

- `vault`：真实 `AccountVault` 的 `getAccount` / `withDecryptedStorageState` 投影；
- `platformModules`：按契约名注入 0～4 个 `PlatformModule`；缺失平台任务返回
  `adapter_platform_module_missing`；模块自报 `platform` 与映射上游名不一致时工厂抛错；
- `resolveVideoRef(videoRef, context)`：接线方负责安全解析与越界 / 可读性预检，
  抛错或空路径在上传前阻止；
- `headless`：默认 `true`，仅透传 `uploadVideo`。

执行顺序（四平台一致）：平台白名单（契约名）→ 模块存在性 → 调用前 signal →
账号元数据 / 平台一致（按映射上游名）/ 会话存在 → 视频引用预检 → 调用前 signal →
`withDecryptedStorageState` 短时作用域内 `checkCookie` 探针 → `uploadVideo`。
探针与上传共用同一次短时明文路径，作用域结束由账号仓 `finally` 清理；
扫码过期、验证码、风控等需人工场景表现为探针 false / 上传抛错，只返回稳定错误码，
不把原始异常文本或明文路径带出作用域。

## 保守状态映射（与 P1-3 相同，仅第一行平台范围更新）

| 场景 | 返回 kind | 错误码 | `confirmedNotSubmitted` |
| --- | --- | --- | --- |
| 平台非四契约名（含上游 `tencent` / `bilibili`） | `needs_user_action` | `adapter_unsupported_platform` | `true` |
| 未注入对应平台模块 | `needs_user_action` | `adapter_platform_module_missing` | `true` |
| 调用前 signal 已取消 | `failed`（retryable） | `adapter_aborted_before_upload` | `true` |
| 账号 UUID 不存在 | `needs_user_action` | `adapter_account_not_found` | `true` |
| 账号仓不可读（registry 损坏等） | `needs_user_action` | `adapter_account_unreadable` | `true` |
| 账号平台与任务平台映射名不一致 | `needs_user_action` | `adapter_account_platform_mismatch` | `true` |
| `sessionRef` 为空（未保存会话） | `needs_login` | `adapter_session_missing` | `true` |
| 账号状态 `expired` | `needs_login` | `adapter_session_expired` | `true` |
| 密文缺失 / 解密失败 | `needs_login` | `adapter_session_unreadable` | `true` |
| 加密子系统不可用 | `needs_user_action` | `adapter_vault_cipher_unavailable` | `true` |
| 视频引用解析抛错 / 返回空 | `needs_user_action` | `adapter_video_preflight_failed` | `true` |
| `checkCookie` 返回 false | `needs_login` | `adapter_session_probe_failed` | `true` |
| `checkCookie` 抛错 | `failed`（retryable） | `adapter_session_probe_error` | `true` |
| 上传方法抛错 | `unknown` | `adapter_upload_failed_unconfirmed` | 不设置 |
| 上传完整返回后 signal 已取消 | `unknown` | `adapter_upload_aborted_unconfirmed` | 不设置 |
| 上传 `void` 正常返回（四平台唯一"成功"路径） | `unknown` | `adapter_upload_unverified` | 不设置 |
| 上传调用后短时明文清理失败 | `unknown` | `adapter_session_release_failed` | 不设置 |
| 上传前回调已完成但清理失败 | `needs_user_action` | `adapter_session_release_failed` | `true` |
| 其他内部异常且未上传 | `unknown` | `adapter_internal_error` | 不设置 |

视频号 / 小红书与抖音 / 快手共用同一套语义：`uploadVideo(): Promise<void>` 只证明本地方法
结束，**没有远端作品 ID / 最终核验就绝不返回 `submitted` / `published`**；上游上传无
AbortSignal，上传开始后的取消 / 异常一律 `unknown`，不盲重发。

## 商品（挂车）任务边界——只读核对，不在适配层伪造判断

- `PublishAttemptInput`（durable-queue.ts）不携带 `commerceRequest`，适配层**没有**做商品
  判断的输入，本轮未新增任何商品分支；
- 队列侧 fail closed：商品任务落库即 `needs_user_action` + `commerce_not_configured`
  （durable-queue.ts 入队校验），`doTick` 领取与核对均有 `task.commerceRequest !== null → continue`
  双保险，商品任务永远到不了 executor；
- 既有测试证据：`app/tests/publish/durable-queue.test.ts` 的 `commerce_not_configured` /
  `commerce_blocked` 用例（约 617–660 行），本轮未改动、直接沿用。

## 测试覆盖（32 项 = 原 22 项保留 / 改写 + 新增 10 项）

保留（抖音 / 快手原有用例，断言不变，防回归）：完整调用、headless 透传、调用前取消、
账号不存在 / 仓损坏 / 平台错配 / 会话缺失 / expired、密文丢失、cipher 不可用、探针 false /
抛错、视频引用抛错 / 空路径、上传抛错 / 中取消 / 后清理失败、上传前清理失败、
抖音同平台双 UUID 隔离。

改写 1 项（前提反转）：「不支持平台」用例从"拒绝 tencent / xiaohongshu"改为"拒绝非契约名
`tencent` / `bilibili`"，并断言四平台模块零调用、不触碰账号仓（反向隐式映射防线）。

扩展 1 项：工厂注入边界新增 `wechat-channels` 键 + 错误模块标记抛错、`xiaohongshu` 键 +
错误标记抛错、正确映射（tencent / xiaohongshu 模块）允许创建。

新增 10 项：

1. 未注入视频号 / 小红书模块 → `adapter_platform_module_missing`，不触碰账号仓；
2. 账号平台错配双向（小红书任务 × tencent 账号、视频号任务 × xiaohongshu 账号）→
   `adapter_account_platform_mismatch`，不打开会话、两模块零调用；
3. 视频号账号 `sessionRef` 为空 → `needs_login`，tencent 模块零调用；
4. 小红书账号 `expired` → `needs_login`，不打开会话；
5. 视频号视频引用解析抛错（敏感异常文本）→ 在调用 tencent 模块前阻止且不泄露；
6. 小红书探针 false（扫码会话失效 / 风控需人工）→ `needs_login`，明文清理、不上传；
7. 视频号 / 小红书完整调用：`void` 返回一律 `unknown`（`adapter_upload_unverified`），
   分别路由到 tencent / xiaohongshu 模块，抖音 / 快手模块零调用；元数据 / scheduleAt /
   headless / 解析路径透传；`resolveVideoRef` 上下文携带契约名；两账号明文互不串用、
   调用后临时目录清空；
8. 视频号上传开始后取消 → 等待结束、`unknown`（`adapter_upload_aborted_unconfirmed`），
   不盲重发；
9. 小红书上传中抛错（验证码 / 风控原始文本）→ `unknown`（`adapter_upload_failed_unconfirmed`）
   且脱敏、明文已清理；
10. 快手 / 视频号 / 小红书同平台双内部 UUID：短时明文路径彼此独立、Cookie 内容互不串用、
    调用后清理（与原有抖音隔离用例合计覆盖四平台）。

所有结果均断言：错误码属于稳定枚举、不含 Cookie 值 / 原始异常文本 / 账号仓与临时目录路径、
不出现 `submitted`、`unknown` 不带 `confirmedNotSubmitted`。

## 本段不接线的原因（重要）

- 主库 P1-2 运行时仍有「租约超时释放账号锁但上传 Promise 未停止」的已知缺陷：适配器一旦
  进入 `uploadVideo` 就无法被中止。必须先修 P1-2 再接线，本段四平台一律不接真实队列；
- 真实 `uploadVideo` 无 AbortSignal 参数，本适配层按最保守方式处理取消与异常
  （等待结束 + `unknown`），不能替代队列侧挂起执行器治理；
- 本段不解析 `coverRefs`，上传不传封面；接线时需由接线方提供与 `resolveVideoRef` 同级的
  封面解析与预检（视频号 4:3 + 3:4、小红书单封面等平台差异在接线段处理）；
- 四平台真实登录 / 过期探针 / 提交 / 远端作品 ID / 最终状态全部未验收；
  **P1-4 全项在无远端作品 ID 或真实账号证据前保持未通过**，本段不能作为自动真实发布
  上线的依据。

## 后续缺口

- 远端核验器（作品 ID / 最终状态查询）尚未实现；可用前四平台所有上传都会停在
  `unknown_submission`，由人工或未来核对器接管；
- 平台登录态轮换：`uploadVideo` 会把刷新后的 storageState 写回短时明文路径，本段有意
  不写回账号仓；重新加密回仓的语义需在接线任务中单独设计并测试；
- 接线时应拒绝动态注入的未知平台模块键；账号在预检后并发删除时应把仓的
  `account_not_found` 映射为账号不存在而非需要重登；探针失败后的账号仓状态回写
  也需要明确责任方。这三点是 GLM 只读审查提出的接线缺口，当前均不导致误上传。
- 视频号 / 小红书上传脚本对短时明文路径（Windows 临时目录、含中文 / 特殊字符路径）的
  真实兼容性未验证，只有真实账号端到端验证后才能提升证据等级。

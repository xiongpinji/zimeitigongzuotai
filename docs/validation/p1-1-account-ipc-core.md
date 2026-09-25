# A2-S1 `account-v2` 主进程账号服务 / IPC 验证记录

输入基线：隔离工作树 `zimeitijuzhen-ao-a2s1`，仓库 SHA `d9d0251`（detached HEAD）。
工作树环境：WSL2。本文档只覆盖 **A2-S1 离线范围**：新服务、新测试、本文档。
生产接线（A2-S2）、设置页（A2-S3）、旧数据迁移（A2-S4）、真实账号与平台发布
**未在本 job 完成，也不因本 job 宣称完成**。

## 接续修复记录（2026-09-26，opencode-bailian 路由）

- Qwen 路由在时限内写出候选 `app/electron/publish/accounts-v2-ipc.ts`（562 行）与
  `app/tests/publish/accounts-v2-ipc.test.ts`（1288 行，33 项）后超时；两份文件保持
  未跟踪（untracked）状态。
- Codex 在官方 Windows Node 22 Vitest 上对**候选原始字节**独立复跑：**33/33 通过**
  （本记录引用该基线，本次接续未重跑官方 runner）。
- 本次接续发现并修复一个源码级同账号竞态，并补齐本文档：
  - **竞态**：`handleCheck` 读取账号后 `await withDecryptedStorageState(checkCookie)`；
    若挂起期间该账号完成一次成功重登（A1 事务轮换 `sessionRef`），旧会话的过期探针
    返回后会无条件 `updateStatusFromProbe`，把**新提交的会话**错误置为 `expired`。
  - **修复（仅 `handleCheck`）**：探针前快照 `account.sessionRef`（`getAccount` 与
    `withDecryptedStorageState` 的同步段之间没有 await 点，快照即实际被解密的那一代）；
    await 返回且结果为布尔后重读账号：`sessionRef` 已轮换 → 固定 `session_changed`，
    不写状态；账号已被删除 → `getAccount` 抛 `account_not_found`，保持删除且不写状态。
  - 模块头“探针不加互斥”的说明同步为“探针不阻塞登录，但做 sessionRef 复核”。

## 证据分级（按根 AGENTS.md）

| 层级 | 状态 |
| --- | --- |
| 源码可见 | ✅ `app/electron/publish/accounts-v2-ipc.ts`、`app/tests/publish/accounts-v2-ipc.test.ts`（未接线、无生产调用方） |
| 自动化测试通过 | ⚠️ 官方 Windows Node 22 Vitest：Qwen 候选 **33/33**（Codex 复跑）；本次修复后由本工作树外部 harness 跑 **34/34**（见下）。`tsc --noEmit` **未运行**（无 `node_modules`），由 Codex 在 Windows 独立执行 |
| 真实账号验证 | ❌ 未发生。无真实浏览器 / Cookie / 平台登录 / 迁移执行 |
| 平台最终状态验证 | ❌ 未发生。旧 `publish:*` 链路与平台最终状态均不在本 job 证据内 |

## 本工作树的实际执行（如实记录）

环境：WSL2，Node **v22.22.3**（npm 10.9.8 可执行），`app/node_modules` **不存在**。
按任务约束：不安装依赖、不链接外部 `node_modules`、不创建 Junction、不改 package/lock。
因此**无法运行项目 Vitest 与 `tsc`**（本记录不宣称跑过这两者）。

为取得真实的 RED→GREEN 证据，我在仓库之外、不进入交付的
`/tmp/opencode/a2s1-harness/` 写了最小 harness：Node 22 原生 type-stripping +
自写 vitest 兼容 shim（`describe/it/expect/vi.hoisted/vi.mock('node:fs')`，经
`syncBuiltinESMExports` 实现 lstat 定向 mock），**直接加载测试文件原始字节**运行：

| 步骤 | 状态 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 候选测试字节（未加新用例，33 项） | 未改源码 | 0 | **33 passed / 0 failed / 33 total**（复现 Codex 基线） |
| 加入新竞态用例，源码未修 | REF | 1 | **33 passed / 1 failed / 34 total**（RED） |
| 源码修复后 | GREEN | 0 | **34 passed / 0 failed / 34 total**（GREEN） |

RED 失败原文（新用例第一处断言，摘要）：

```text
expected {"ok":true,"valid":false,"account":{...,"status":"expired",...}}
  to equal {"ok":false,"code":"session_changed","message":"The stored session changed during login; the commit was refused."}
```

GREEN 后同一用例断言：返回固定 `session_changed`；新 registry 条目逐字段不变
（`status: valid`、新 `sessionRef`）；新密文字节逐字节不变；`sessionFileNames()`
仅剩新密文；临时基目录零残留；序列化载荷无 `sessionRef` / 路径 / Cookie / 平台原文。

诚实声明：该 harness 只是外部证据补充，**不是官方 runner**，其文件全部位于
`/tmp/opencode/`，不属于三份白名单交付文件。官方复跑（Windows Node 22 Vitest、
`tsc --noEmit`）由 Codex 执行。

空白检查：`git diff --no-index --check /dev/null <file>` 对两个代码文件**无任何
whitespace 告警**（命令仅因存在差异返回 1）；两文件纯 LF、无尾随空白、末尾有换行、
无混合行尾。文件为 untracked，裸 `git diff --check` 不覆盖它们，故采用上述等价检查。

## 变更范围（仅允许的 3 个文件）

| 文件 | 变更 |
| --- | --- |
| `app/electron/publish/accounts-v2-ipc.ts` | `handleCheck`：新增 `probedSessionRef` 快照 + await 后 `getAccount` 复核（轮换 → `session_changed`；删除 → `account_not_found`）；模块头探针说明同步。其余零改动 |
| `app/tests/publish/accounts-v2-ipc.test.ts` | 在 check describe 末尾新增 1 个竞态用例；**原 33 项断言零改动、零弱化** |
| `docs/validation/p1-1-account-ipc-core.md` | 本文档（新增） |

其余一切未触碰：`main.ts` / `preload.ts` / renderer / 旧 `publish:*` 通道与
`ipc.ts` / `runner.ts` / `queue-platform-adapter.ts` / `accounts.ts` /
`accounts-v2.ts` / `AccountVault` 实现 / 平台模块 / package / lock / 配置 / 其他工作树。

SHA-256：

```text
候选（Qwen 原始字节，Codex 官方 33/33 基线）
a234a95b74d985a7349a0575d9c8cc6795d1d4e5e3dcebff2a3450cacfde010b  app/electron/publish/accounts-v2-ipc.ts        (562 行)
77ffc90742cfce2c7ce3231eaa088617fd0ba15bd9e6483e04eb569a24367cb3  app/tests/publish/accounts-v2-ipc.test.ts      (1288 行)

本次修复后
6e6145826d864eea34e2c9c38bbb53934c3c102c3d95cd29a8d6bbf4f47e4992  app/electron/publish/accounts-v2-ipc.ts        (572 行)
8f756f001f7121284d2625dc1e345bb262ea86ede1ac2a8bb331e6db7b4b84f8  app/tests/publish/accounts-v2-ipc.test.ts      (1342 行)
```

Codex 复跑命令（Windows Node 22，`app/` 目录下）：

```bash
node ./node_modules/vitest/vitest.mjs run tests/publish/accounts-v2-ipc.test.ts
node ./node_modules/typescript/bin/tsc --noEmit
```

预期：聚焦套件 **34/34 通过**；`tsc --noEmit` 退出码 0。

## 新增竞态用例（RED→GREEN 语义）

`探针挂起期间重登轮换 sessionRef：旧探针 false 返回 session_changed，新会话保持
valid 且密文不变`：

1. create 一个 `douyin` 账号并完成首次登录（fixture `race-old`），记录 `sessionRef = refOld`。
2. `check` 行为断言读到的是旧明文（`storageStateFixture('race-old')`）后挂起，
   并标记探针已进入（此时 `checkCalls === 1`）。
3. 挂起期间执行一次成功重登（fixture `race-new`，A1 事务写入不同于种子的新输出），
   断言 `sessionRef` 轮换为新值 `refNew`、`status: valid`、会话目录仅剩 `refNew.bin`。
4. 释放挂起，让旧探针以 `false` 返回。
5. 断言 `check` 返回固定 `session_changed`；`refNew` 的 registry 条目逐字段不变、
   密文逐字节不变、解密结果仍为 `race-new`；临时目录零残留；载荷无敏感串。

修复前（RED）：旧探针结果把新会话写成 `expired`。修复后（GREEN）：复核拒绝。

## 探针并发语义（源码可见级）

- 只有明确布尔结果才写状态；异常 / 非布尔 / vault 失败保持原状态（既有用例）。
- 探针前快照 `sessionRef`，await 后重读复核：轮换 → `session_changed`（频率型
  固定错误码，复用既有枚举与常量消息）；账号删除 → `account_not_found`（保持删除）。
- 探针**不阻塞登录**（不参与登录互斥）；复核与 `updateStatusFromProbe` 之间没有
  await 点，单进程事件循环内不可被打断。
- 局限披露：两个并发 `check` 都基于同一 `sessionRef` 时各自写状态、后写覆盖——
  两者都针对该代会话，语义允许；跨进程并发不在本 job 范围（registry 无跨进程锁，
  与 `p1-1-account-core.md` 的声明一致）。

## 安全 DTO / 错误契约（源码可见级）

- DTO 键固定：`id/platform/displayName/owner/status/hasSession/lastCheckedAt/createdAt`；
  `sessionRef` 只以 `hasSession` 布尔投影；无 `migratedFrom`、无任何路径、无 Cookie/Token。
- 错误为固定枚举 + 每码一条常量消息；`AccountVaultError.code` 经穷举映射表转换，
  vault / 平台 / 异常的 message、cause、原文一律不过 IPC。
- 二维码事件只含 `requestId/accountId/sequence/data:image/png;base64,...`，只走
  `account-v2:qrcode` 通道，无磁盘路径。
- 只注册固定五个 `account-v2:*` invoke 通道；不注册 / 不触碰任何旧 `publish:*`。

## 二维码策略与剩余 TOCTOU

- 目录约束：`gate.bind` 记录本次登录临时 storageState 的真实父目录；事件 PNG 的
  `realpath(dirname(...))` 必须与该目录完全一致。
- 普通文件检查：`lstat` 拒绝 symlink / 非普通文件（测试以定向 mock 保证 Windows
  确定性）；同 fd `fstat` + 有界读取（≤512 KiB）+ PNG 8 字节魔数；每次登录最多
  64 个事件；任何违规置失败闩锁并抛固定文案；即便平台吞掉回调异常并报
  `success:true`，回调返回处也强制 `success:false`、IPC 返回 `qrcode_failed`；
  事件发送异常同样 fail closed。
- **剩余 TOCTOU（未消除）**：`lstat → open → fstat/read` 之间存在窗口，理论上可
  在检查后把路径替换为 symlink / 其他文件。当前以“同 fd 校验 + 尺寸上限 + 魔数 +
  目录 realpath”收敛危害；Windows 无 `O_NOFOLLOW` 的跨平台等价，未加平台特定句柄
  校验。未做真实文件系统对抗验证。

## 未实现 / 未验证（不因本 job 宣称完成）

- **未接线**：`main.ts` / preload / renderer 零改动，本服务当前**零生产调用方**；
  在 A2-S2 之前 `account-v2:*` 不可达。
- **旧链路仍活跃**：旧 `publish:*` 通道与旧 `AccountStore` 链路按原样工作；
  本模块不触 runner / 队列 / 平台模块。
- **未执行迁移**：`migrateFromLegacy()` 未被 IPC 暴露，未对任何真实 userData 运行。
- **未验证**：真实四平台账号、真实扫码 / 登录 / 探针 / 重登、真实浏览器、生产
  `safeStorage` 加密适配、跨进程并发、Windows 真实 symlink 行为、平台最终发布状态、
  商品挂载资格。
- **未运行**：`tsc --noEmit`（本工作树无依赖）；官方 Vitest（由 Codex 在 Windows
  复跑）。本工作树的 34/34 来自仓库外 harness，不冒充官方 runner，也不构成真实
  平台或产品验收。

## Codex 主库独立验收（2026-09-26）

Codex 将上述三个白名单文件按原字节复制到主库依赖环境，核对源码与测试的
SHA-256 分别为 `6e6145826d864eea34e2c9c38bbb53934c3c102c3d95cd29a8d6bbf4f47e4992`
和 `8f756f001f7121284d2625dc1e345bb262ea86ede1ac2a8bb331e6db7b4b84f8`。
在 Windows Node v22.23.3 使用项目官方 Vitest 运行 A2-S1 IPC 与 A1 vault 两组测试，
**34/34 + 75/75 = 109/109 通过**；`tsc --noEmit --project app/tsconfig.json`
退出码 **0**。这补充了上文工作树中的执行记录，不改变其环境说明。

GLM-5.3 只读审查任务 `qwen-code-review-20260925-203709-98cd1e` 对当前三个文件
未发现 P0/P1 阻断项；审查路线自身未运行命令。以下 P2 边界进入 A2-S2 的明确
验收清单：登录事务结束后关闭二维码回调闸门，拒绝迟到事件；覆盖发送事件异常、
删除期间探针、同会话乱序探针和登录输出非法 JSON。当前同会话乱序探针为后写
状态覆盖前写状态；不能据此宣称 UI 展示的是最新远端状态。`displayName`/`owner`
长度、控制字符上限与 QR 文件检查的剩余 TOCTOU 也需在接线前评估。

本次验收层级只到**离线源码与自动化测试**。`account-v2:*` 尚无生产接线；真实四
平台扫码、登录保持、登录态探针和发布最终状态均未验证。

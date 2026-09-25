# P4-1 第一段：九类生产动作与预授权活动门控验证记录

输入基线 SHA：`7a79790`（工作树 `zimeitijuzhen-ao-agent-action-gate`，detached HEAD）。
本记录只覆盖新增的**纯函数门控与离线测试**；**不等于 P4-1 全项验收**，更不等于 R5
（全流程 Agent）通过。本轮未接 MCP / IPC / Agent runtime / 发布队列，未发行或持久化
任何 grant，也没有真实账号、真实素材或平台侧操作。

2026-09-25 第二轮定向修复（同日）：Codex 复测第一轮 35/35 通过后审查记
`repair_required`——配额三字段用 `Number.isInteger` 校验，`1e308` 与
`MAX_SAFE_INTEGER+1` 会被当作整数放行，超出安全范围后配额比较不可靠。本轮改为
安全整数校验 + 无溢出减法比较，新增 6 项边界 / 超界测试（合计 41 项），并修正本文档
关于运行时 import 的不准确表述、补充「门控不预留配额」边界。仍不接线、不发布。

## 1. 精确改动文件（最多 3 个）

| 文件 | sha256（第二轮修复后） | 内容 |
| --- | --- | --- |
| `app/electron/production/agent-action-gate.ts` | `a25a2f3475114becde6d78eef53100da1ce38e3bca02f4f6c62e68196cf48d5f` | 九类动作枚举、grant/context 契约、纯函数门控、稳定拒绝码、安全整数配额校验 |
| `app/tests/production-agent-action-gate.test.ts` | `3fe4ac468c8e697a146d990c83ba2b5fe5e99ac2da5cfc795270b11f622a1e4a` | 41 项合成输入测试（含 6 项安全整数边界反例；不触网 / 不登录 / 不发布） |
| `docs/validation/p4-1-agent-action-gate.md` | 本文档 | 验证记录与边界说明 |

第一轮 GREEN 时的 sha256（已被本轮修复取代，仅供审计对照）：门控
`7ceaa12b9caa78ce5c7a73cba97fc0ecc07de4395563633270e765546ceb5d88`、测试
`1cb03d32698d97d0b370e519ca8a2a4de1c159fd71201c87b222c68bb608df6d`。

未改动任何现有文件：`git diff --stat` 为空，`git status --short` 仅显示上述新文件与
预置的 `app/node_modules` Windows Junction（未触碰）。

## 2. 证据分级（按根 AGENTS.md）

| 层级 | 状态 |
| --- | --- |
| 源码可见 | ✅ 门控运行时仅 import `PRODUCTION_PLATFORMS` 常量数组（来自 `src/types/production-contracts.ts`，用于平台枚举的运行时校验），其余均为 `import type` 纯类型；不读 fs / 网络 / Electron / 系统时间 / 账号 / 素材 / 队列。此前「只 import 纯类型契约」的表述不准确，已修正 |
| 自动化测试通过 | 第一轮 worker 聚焦测试 **35/35**。第二轮 worker 权限层阻断执行（见 §3.1）；Codex 随后在隔离工作树用 Windows Node 22 独立运行门控 41/41、v1 契约 50/50、队列 35/35，合计 **126/126**，退出码 0；`tsc --noEmit` 退出码 0 |
| 真实账号验证 | ❌ 未发生。测试注入合成 grant / request / context，不读任何真实数据 |
| 平台最终状态验证 | ❌ 未发生。门控不执行发布，也不查询远端 |

## 3. 验证命令与结果

在 `app/` 下用 Windows Node 22（与 P1-3 相同运行器）：

```bash
C:/Users/canqu/Documents/Codex/2026-09-24/new-chat/work/node22/node_modules/node/bin/node.exe \
  ./node_modules/vitest/vitest.mjs run tests/production-agent-action-gate.test.ts
# RED（实现前，2026-09-25）：Tests no tests，Failed to load url ../electron/production/agent-action-gate，退出码 1
# 首次 GREEN：34/35，唯一失败为测试辅助函数默认参数吞掉显式 undefined（测试自身缺陷），修正后：
# GREEN（实现后）：Test Files 1 passed / Tests 35 passed，退出码 0

C:/Users/canqu/Documents/Codex/2026-09-24/new-chat/work/node22/node_modules/node/bin/node.exe \
  ./node_modules/typescript/bin/tsc --noEmit
# 无输出，退出码 0

# 相关整体检查（契约未被破坏）：
C:/Users/canqu/Documents/Codex/2026-09-24/new-chat/work/node22/node_modules/node/bin/node.exe \
  ./node_modules/vitest/vitest.mjs run tests/production-contracts.test.ts
# Test Files 1 passed / Tests 50 passed，退出码 0
```

`tsconfig.json` 的 `include` 只覆盖 `src/**` 与 `electron/**`，测试文件由 Vitest 转译执行；
静态类型结论以被测实现文件通过 `tsc --noEmit` 为准。

### 3.1 第二轮修复的验证记录（2026-09-25，worker 侧）

本轮 worker 的权限层阻断了全部执行通道，**未能在本地运行 vitest 与 tsc**。原样错误：

- Windows Node 22（`/mnt/c/.../node22/.../node.exe --version`）：`This command requires approval`。
- `app/node_modules` Junction：解析到另一工作树
  `zimeitijuzhen-ao-p0-1-opencode/app/node_modules` 后被路径策略阻断（`ls` 报
  `... was blocked. For security, Claude Code may only list files in the allowed working directories`）。
- WSL 本地 Node v22.22.3 经 Junction 运行 vitest：`This Bash command contains multiple operations ... requires approval`（node 执行段被阻断）。
- /tmp 独立 harness（最小 vitest shim + Node 22 类型剥离）：Write 与 Bash 写入均被阻断
  （`Claude requested permissions to write to /tmp/p41/...`）。
- 审查笔记 `/mnt/c/.../p4-1-agent-action-gate-review-notes.md`：读取被阻断（要点已在任务书中给出）。

按任务约束不再反复申请权限，独立复测交由 Codex 在 Windows Node 22 下执行：

```bash
# 在 app/ 下：
node ./node_modules/vitest/vitest.mjs run tests/production-agent-action-gate.test.ts \
  tests/production-contracts.test.ts tests/publish/durable-queue.test.ts
node ./node_modules/typescript/bin/tsc --noEmit
```

worker 侧 RED/GREEN 证据为对源码的逐项推演（新增 6 项测试，旧实现 → 新实现）：

| 新测试输入 | 旧实现（Number.isInteger + 加法比较） | 新实现（Number.isSafeInteger + 减法比较） |
| --- | --- | --- |
| `requestedJobs = MAX+1`（浮点存储为 2^53）或 `1e308` | 校验放行，落到配额比较返回 `publish_quota_exceeded` → **RED**（期望 `request_invalid`） | `request_invalid` ✅ |
| `usedQueuedJobs = MAX+1` 或 `1e308` | 校验放行，返回 `publish_quota_exceeded` → **RED**（期望 `used_jobs_invalid`） | `used_jobs_invalid` ✅ |
| `maxQueuedJobs = MAX+1` 或 `1e308` | parseGrant 放行，请求整体 `{allowed:true}` → **RED**（期望 `grant_invalid`） | `grant_invalid` ✅ |
| `max=used+requested=MAX` 精确边界（两组） | 允许（守卫，非 RED） | 允许 ✅ |
| `max=MAX, used=MAX-1, requested=MAX`（真实总和 2·MAX−1） | 浮点加法恰好仍大于 max，拒绝（守卫，非 RED） | `requested > max-used` 拒绝 ✅ |
| `used=5 > max=3` | 拒绝（守卫，非 RED） | 剩余额度为负，拒绝 ✅ |

即：3 项新测试在修复前必然失败（覆盖三个字段），修复后 41/41 应全绿；既有 35 项的
所有输入均在安全整数范围内，`Number.isSafeInteger` 与 `requested > max - used`
（安全整数域内与 `used + requested > max` 严格等价，减法不溢出）不改变其结论。
**该推演不能替代自动化测试证据。** Codex 已在隔离工作树按上方命令独立复测：
门控 41/41、v1 契约 50/50、队列 35/35，合计 126/126，退出码 0；
`tsc --noEmit` 无输出、退出码 0。GLM 只读审查未发现阻断此未接线纯门控合入的问题；
其会话没有 shell 工具，未独立复跑测试或 Git 差异。

## 4. 门控语义（源码可见级）

九类动作（顺序与集合在测试中固定）：`import_recordings`、`detect_highlights`、
`adjust_highlights`、`search_authorized_assets`、`build_compositions`、`edit_timeline`、
`render_variants`、`quality_check`、`queue_publish`。前八类为非发布创作动作，
`queue_publish` 只针对普通视频。

`evaluateAgentProductionAction(request, grant, context)` 为无副作用纯函数；三个入参都按
不可信输入做运行时校验，失败关闭：

- `grant` 最小字段：`projectId`、`issuedAtMs` / `expiresAtMs`、`allowedActions`、
  `accountIds`、`platforms`、`autoPublish`、`maxQueuedJobs`。只能由未来受信任 Electron main
  存储 / 装载并注入，**不能**从 Agent 工具参数自报；本轮不实现发行与 UI。
- `context` 注入 `nowMs` 与 `usedQueuedJobs`；不读取系统时间或文件。
- 时间边界：`nowMs < issuedAtMs` 拒绝（未生效），`nowMs >= expiresAtMs` 拒绝（过期）；
  发行时刻本身生效，失效时刻本身即过期。
- 配额边界（第二轮修复后）：`requestedJobs` 必须为**正安全整数**，`usedQueuedJobs` 与
  `maxQueuedJobs` 必须为**非负安全整数**（0 .. `Number.MAX_SAFE_INTEGER`），否则分别以
  `request_invalid` / `used_jobs_invalid` / `grant_invalid` 拒绝。比较采用
  `requestedJobs > maxQueuedJobs - usedQueuedJobs` 即拒绝（`publish_quota_exceeded`）：
  两个非负安全整数之差不会溢出，语义等价于 `used + requested > max`；
  `usedQueuedJobs > maxQueuedJobs` 时剩余额度为负，任何正请求数都拒绝。
  不用 `Number.isInteger`：它会把 `1e308` 与 `MAX_SAFE_INTEGER+1` 当作整数放行，
  超出安全范围后相邻计数可能相等，配额无法可靠执行。
- **门控是单次纯判定，不占用、不预留任何配额**，并发调用之间互不感知。未来接入并发
  发布队列时，必须在受信任 Electron main 的事务 / 锁内重新校验并原子预留配额，
  不得把本函数的通过结果直接当作已入队凭证。本轮不实现该接线。
- 非发布创作动作同样需要有效活动授权、项目匹配与时间窗，但不需要账号 / 平台 / 配额。
- `queue_publish` 必须显式 `autoPublish: true`、账号与平台均在活动范围、`commerceRequest`
  字段显式存在且为 `null`；任何非 null 商品请求一律拒绝，绝不静默降级为普通发布。

判定次序（先命中先返回，测试固定）：

1. `request_invalid` / `unknown_action`
2. `grant_missing` / `grant_invalid`
3. `clock_invalid`
4. `grant_not_yet_valid` / `grant_expired`
5. `project_mismatch`
6. `action_not_allowed`
7. 非发布动作到此允许
8. `account_not_allowed`
9. `platform_not_allowed`
10. `auto_publish_disabled`
11. `used_jobs_invalid` / `publish_quota_exceeded`
12. `commerce_not_supported`

拒绝结果只含 `{ allowed: false, reason }`，`reason` 为下列稳定机器码之一；不含账号、
项目、路径、Cookie 或任何原始输入（有脱敏反例测试）。允许结果为 `{ allowed: true }`。

| 拒绝码 | 触发场景 |
| --- | --- |
| `request_invalid` | 请求非对象 / action 非字符串 / 项目或发布字段缺失、类型非法 / `requestedJobs` 非正安全整数（含 `MAX_SAFE_INTEGER+1`、`1e308`） |
| `unknown_action` | action 字符串不在九类内 |
| `grant_missing` | grant 为 null / undefined |
| `grant_invalid` | grant 结构非法（字段缺失、时间倒置、动作 / 平台非法、`maxQueuedJobs` 非非负安全整数等） |
| `clock_invalid` | 注入时钟缺失或非有限数字 |
| `grant_not_yet_valid` | `nowMs < issuedAtMs` |
| `grant_expired` | `nowMs >= expiresAtMs` |
| `project_mismatch` | 请求项目与活动项目不一致 |
| `action_not_allowed` | 动作不在 `allowedActions` |
| `account_not_allowed` | 账号不在 `accountIds` |
| `platform_not_allowed` | 平台不在 `platforms` |
| `auto_publish_disabled` | `autoPublish !== true` |
| `used_jobs_invalid` | `usedQueuedJobs` 非非负安全整数（含 `MAX_SAFE_INTEGER+1`、`1e308`） |
| `publish_quota_exceeded` | `requestedJobs > maxQueuedJobs - usedQueuedJobs`（含 `used > max` 的负剩余情形） |
| `commerce_not_supported` | `commerceRequest` 非 null |

测试覆盖：九类动作顺序 / 冻结 / 守卫稳定性、全部拒绝路径、时间窗前后边界、配额临界
（`== max` 允许、`max + 1` 拒绝、`max = 0`）、安全整数边界（`MAX_SAFE_INTEGER` 精确
边界允许；三个配额字段对 `MAX_SAFE_INTEGER+1` 与 `1e308` 分别以 `request_invalid` /
`used_jobs_invalid` / `grant_invalid` 拒绝；`used + requested` 超上限不依赖浮点加法
取整放行；`used > max` 拒绝）、两个许可账号 × 两个许可平台、未授权平台（快手 /
视频号）、`autoPublish` 开关、商品请求非 null（对象与任意非对象值）、脱敏结果、
判定次序、纯函数不改写输入且结果可重复。合计 41 项（第一轮 35 项 + 第二轮 6 项）。

## 5. 未接线 / 未验收（不得宣称）

- 未接 MCP、IPC、Agent runtime、Skills、发布队列：本门控目前**没有调用方**，
  队列与素材链路尚未整体接线；不能据此声称 Agent 全链路可自动生产或发布。
- `grant` 的发行、存储、加载、UI 与审计未实现；本轮只有注入契约与纯判定。
- 通过门控**不代表**账号登录 / 会话有效、素材授权、质检合格、预检通过或远端发布成功；
  这些必须由 P1-1 / P1-3 / P2 / P3 / P4-2 等后续阶段分别检查。
- 没有真实账号、真实素材、真实平台或 Windows 安装包验证。
- 门控通过**不占用、不预留配额**：它是无状态单次判定。并发队列接线时必须由受信任
  main 进程在事务 / 锁内重验并原子预留，本记录不声称该机制已存在。
- 第二轮修复后 worker 本地未能运行 vitest / `tsc --noEmit`（权限层阻断，§3.1 原样
  记录）；上述 **126/126 与类型检查通过属于 Codex 独立复测**，不是 worker 自测。
- GLM 提醒：进程内构造的原型继承 `commerceRequest` 或抛异常 getter 不等同 JSON/IPC
  输入。接线时应检查字段自有性，且任何输入读取异常都必须按拒绝处理，不能由调用方
  误当放行；本段没有实际调用方，这两点没有真实越权路径。
- 本记录不关闭 R5、不关闭 P4-1（P4-1 还要求九项工具映射到本地任务 API 并完成
  录屏到渲染闭环）；也不构成 R6-P 或 R6-C 证据。

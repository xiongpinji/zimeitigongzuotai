# P4-2 有界实现：普通视频发布本地预检（offline preflight）验证记录

输入基线 SHA：`737a920`（工作树 `zimeitijuzhen-ao-p4-2`，detached HEAD）。
本记录只覆盖新增的**纯函数本地预检与离线测试**。它**不等于 P4-2 验收**（P4-2 还要求
在预授权活动内串接预检、排队与平台最终状态核验），**不等于 R5 全流程 Agent 验收**，
更**不是**四平台真实普通视频发布能力。本轮未接 IPC / 队列 / Agent / MCP / 平台适配器，
未使用真实账号、真实素材或任何网络调用；`ready_for_live_checks` 只是「允许进入实时
检查阶段」的名字，永远不构成发布授权。

## 1. 精确改动文件（恰好 3 个，全部新增）

| 文件 | sha256 | 内容 |
| --- | --- | --- |
| `app/electron/production/publish-preflight.ts` | `a8be961293ba98532a1f0972ab3639a53f23aa87543808fb554714c9d41126e0` | 纯函数本地预检：稳定阻止码、六项未决检查清单、fail-closed 判定次序 |
| `app/tests/production-publish-preflight.test.ts` | `6cbd5ab68cf08cad15db609ace7c0f5d8c4ff0d1bf3559b7323c6183e8c90804` | 41 项合成输入行为测试（RED 先行编写；不触网 / 不登录 / 不发布）；2026-09-25 有界修复非法 ID 用例，改为直接调用生产入口使显式 `undefined` 原样传入（修复前 sha256 为 `22550169b25c868ad52b0763a1bedd0905be1defefe893267573bf8abcebe6fa`） |
| `docs/validation/p4-2-local-publish-preflight.md` | 本文档 | 验证记录与边界说明 |

未改动任何现有代码、测试、构建、lockfile、依赖或配置文件。worker 交付时未提交、未推送；
Codex 只选择上述三份文件集成到主库。`git status --short` 在 worker 写文档前仅显示
上述两个新代码文件（`??` 未跟踪）。
其余在途工作树的改动未被触碰。

2026-09-25 有界修复只改了本表测试文件的一处（非法 ID 用例），生产模块
`app/electron/production/publish-preflight.ts` 的 sha256 仍为
`a8be961293ba98532a1f0972ab3639a53f23aa87543808fb554714c9d41126e0`，未改一字。
`app/node_modules` 是 Codex 在本任务之后添加的 Junction（指向其他工作树的 Windows 安装），
按基线对待：未触碰、未纳入改动、未随记录提交。

## 2. 证据分级（按根 AGENTS.md）

| 层级 | 状态 |
| --- | --- |
| 源码可见 | ✅ 运行时仅 import `parseProductionDocument` 与 `ProductionContractError`（`src/lib/production-document.ts`，纯函数边界）及类型导入；不读 fs / 网络 / Electron / 系统时间 / Cookie / 会话存储 / 队列 / IPC / Agent / MCP，不改写输入，不抛异常 |
| 自动化测试通过 | ✅ Codex 在 worker 结束后独立运行 Windows Node 22 Vitest：预检 41/41、契约 50/50、动作门控 41/41，共 132/132，退出码 0；`tsc --noEmit` 退出码 0。修复前 131/132 的唯一失败是测试 helper 吞掉显式 `undefined`，生产入口本身正确拒绝；worker 只修该用例。WSL 侧 Vitest 因 Junction 指向 Windows 原生依赖而阻断，不能算 worker 的通过证据（§3.2） |
| 真实账号验证 | ❌ 未发生。测试全部使用合成夹具 |
| 平台最终状态验证 | ❌ 未发生。本模块不调用平台，也不查询远端 |

## 3. 验证命令与结果（worker 侧阻断原样记录）

以下为 2026-09-25 首轮、Codex 添加 `app/node_modules` Junction **之前**的原样记录；
修复后带 Junction 的复跑记录见 §3.2。按任务约束：不安装依赖、不联网、不在三个允许
路径之外创建临时文件。当时本工作树 `app/node_modules` 与根 `node_modules` 均不存在，
且权限层拒绝了全部 node / python 执行通道。原样错误（各记录一次，不再重复申请）：

```text
$ ls -d app/node_modules node_modules
ls: cannot access 'app/node_modules': No such file or directory
ls: cannot access 'node_modules': No such file or directory        （退出码 2）

$ node app/node_modules/vitest/vitest.mjs run app/tests/production-contracts.test.ts
This command requires approval                                     （权限层拒绝）

$ node -e "console.log('probe-ok')"
This command requires approval                                     （权限层拒绝）

$ python3 ~/.codex/agent-orchestrator/jobs/claude-bailian-20260925-164051-4cd290/channel/channel.py event --phase inspect --message '...'
This command requires approval                                     （权限层拒绝；worker 未能发布阶段事件）
```

WSL 本地存在 Node v22.22.3（`node --version` 可运行），但无 `node_modules` 且脚本
执行被拒，故 Vitest 与 `tsc --noEmit` 均无法在 worker 侧运行。

**请 Codex 在 Windows Node 22（与 P4-1 相同运行器）下于 `app/` 目录独立执行：**

```bash
# RED 基线（如需复现：临时移走 publish-preflight.ts 后运行，预期加载失败、退出码 1）
node ./node_modules/vitest/vitest.mjs run tests/production-publish-preflight.test.ts
# 预期 RED 错误：Failed to load url ../electron/production/publish-preflight（模块不存在）

# GREEN：新增预检测试 + 两个相邻聚焦套件
node ./node_modules/vitest/vitest.mjs run tests/production-publish-preflight.test.ts \
  tests/production-contracts.test.ts tests/production-agent-action-gate.test.ts
# 预期：预检 41/41、契约 50/50、动作门控 41/41，退出码 0

node ./node_modules/typescript/bin/tsc --noEmit
# 预期：无输出，退出码 0（tsconfig include 覆盖 electron/**，含新实现文件；
# 测试文件与 P4-1 相同由 Vitest 转译执行，不在 tsc 范围内）
```

worker 侧 RED/GREEN 证据为对源码与夹具的逐行推演（先写测试、后写实现）：

- RED：测试文件先行落盘时 `../electron/production/publish-preflight` 不存在，任何
  Vitest 运行必然在 import 阶段失败（退出码 1）。
- GREEN 推演要点：默认夹具逐字段对照 `parseProductionDocument` 的校验规则（sha256
  64 位十六进制、ISO 8601、时间码边界、高光落界、分段不超素材时长、账号 ID ≠ 昵称、
  commerceRequest 账号/平台一致性、幂等键唯一）确认全部可解析；41 项测试的期望码与
  实现的判定次序逐一对齐（含 11 个非白名单任务状态、4 个非 qc_passed 状态、4 个非
  active 账号状态的穷举）。**该推演不能替代自动化测试证据。**

空白检查（worker 侧可运行）：

```bash
git -c core.whitespace=cr-at-eol diff --check   # 见 §7 报告，无输出为通过
```

### 3.2 Codex 独立复测（修复前基线）与 2026-09-25 有界修复

Codex 在 Windows Node 22 独立运行（修复前基线，真实结果）：

```text
node ./node_modules/vitest/vitest.mjs run          （全量 131/132 通过）
唯一失败：app/tests/production-publish-preflight.test.ts「非法任务 ID 一律 job_id_invalid」
原因：helper `function evaluate(doc, jobId: unknown = JOB_ID)` 在显式传入 `undefined`
      时按 JS 默认参数语义回退为 JOB_ID，该轮循环实际调用了合法任务；
      生产 `evaluateLocalPublishPreflight` 对显式 `undefined` 本就返回
      `job_id_invalid`（用例期望正确，缺陷只在夹具 helper 的传参路径）。
node ./node_modules/typescript/bin/tsc --noEmit   （通过，退出码 0）
```

修复（只动测试夹具的一处；生产模块零改动）：

```ts
for (const bad of ['', '   ', 42, null, undefined, {}, [], true]) {
  // 修复前：expectBlocked(evaluate(makeDocument(), bad), 'job_id_invalid');
  //   显式 undefined 被 helper 默认参数 JOB_ID 吞掉。
  expectBlocked(evaluateLocalPublishPreflight(asUnknownJson(makeDocument()), bad), 'job_id_invalid');
}
```

`undefined` 仍保留在非法值列表中；断言码 `job_id_invalid` 未放宽；其余 40 项用例与
合法路径测试未动。修复后测试文件 sha256 =
`6cbd5ab68cf08cad15db609ace7c0f5d8c4ff0d1bf3559b7323c6183e8c90804`。

修复后 worker 侧复跑（原样记录，各一次；未安装依赖、未联网、未改范围）：

```text
$ node --version
v22.22.3

$ readlink -f app/node_modules
/mnt/d/AI编程库/项目库/进行中的项目/zimeitijuzhen-ao-p0-1-opencode/app/node_modules
$ ls app/node_modules/@rollup
rollup-win32-x64-gnu  rollup-win32-x64-msvc        （无 linux-x64 原生包）

$ node ./node_modules/vitest/vitest.mjs run tests/production-publish-preflight.test.ts
⎯⎯ Startup Error ⎯⎯
Error: Cannot find module @rollup/rollup-linux-x64-gnu. npm has a bug related to
optional dependencies (https://github.com/npm/cli/issues/4828) ...
    code: 'MODULE_NOT_FOUND'
（WSL 无法使用 Windows 安装的 rollup 原生二进制运行 Vitest；按约束不安装依赖，
 交由 Codex 在 Windows Node 22 复跑。）

$ node ./node_modules/typescript/bin/tsc --noEmit
（无输出，退出码 0；测试文件不在 tsc include 范围内，仅证明生产源码类型通过）
```

Codex 在 worker 结束后于 Windows Node v22.23.3 独立复跑：

```text
tests/production-publish-preflight.test.ts      41/41 通过
tests/production-contracts.test.ts               50/50 通过
tests/production-agent-action-gate.test.ts        41/41 通过
Vitest 合计 132/132，退出码 0
node ./node_modules/typescript/bin/tsc --noEmit   退出码 0
```

这是离线契约与纯函数行为验证，不是发布链路或真实账号验收。

## 4. 预检语义（源码可见级）

入口：`evaluateLocalPublishPreflight(documentInput: unknown, publishJobId: unknown):
LocalPublishPreflightResult`。两个入参都按不可信输入处理；文档必须经
`parseProductionDocument` 完整重校验，不信任调用方 TS 类型。函数为无副作用纯函数，
自身从不抛异常，不修改输入文档（有快照测试）。

结果形状（可辨识联合，均运行时冻结；刻意不使用 `allowed: true` / `publishable` /
`authorized_to_publish` 等可被 Agent 误读为最终授权的形状）：

- 阻止：`{ status: 'blocked', reason }`，`reason` 为下表稳定机器码之一；不含解析器
  消息、JSON 路径、账号 ID、sessionRef、标题、路径或任何输入文本（有脱敏反例测试）。
- 成功：`{ status: 'ready_for_live_checks', pendingChecks }`，`pendingChecks` 为冻结的
  六项未决检查清单（下表），表示**义务移交给后续阶段**，不是本模块执行的验证。

判定次序（先命中先返回，测试固定）：

1. `job_id_invalid` — publishJobId 非非空白字符串（先于文档解析）
2. `document_invalid` — `parseProductionDocument` 抛 `ProductionContractError`
   （版本、字段、枚举、凭证材料、悬挂引用、重复 ID、时间码等全部结构失败）；
   `preflight_error` — 解析或其他环节的任何意外异常（含敌意 getter），失败关闭
3. `job_not_found` — ID 不在 `publishJobs`
4. `job_state_not_preflightable` — state 不在白名单 `{draft, preflight}`；
   queued / uploading / submitted / verifying / published / needs_* /
   retryable_failure / terminal_failure / `unknown_submission` 一律阻止且绝不本地重试
5. `commerce_request_present` — `commerceRequest !== null`（严格 null；`required:false`
   同样阻止，不存在把商品任务降级为普通发布的 fallback）
6. `account_not_active`（快照 status ≠ 'active'）/ `account_session_missing`
   （sessionRef === null）。这是**账号快照检查，不是实时登录探针**；实时探针属于
   未决项 `live_account_session`
7. 版本检查（依次）：`variant_not_qc_passed`（status ≠ 'qc_passed'）→
   `variant_output_missing`（outputRef / outputSha256 任一为 null）→
   `variant_duration_invalid`（durationMs 为 null 或 ≤ 0）→
   `variant_timeline_missing`（timelineRef === null，须绑定可编辑时间线）
8. 计划检查（依次）：`plan_empty`（segments 为空）→ `plan_timeline_missing`
   （plan.timelineRef === null）→ `plan_timeline_mismatch`（与 variant.timelineRef 不一致）
9. 分段来源检查：`kind:'asset'` 分段必须解析到 `AssetV1.authorizedForAutoUse === true`，
   否则 `asset_not_authorized`；recording / highlight 分段仅防御性确认引用存在。**不**从
   自由文本 `usageScope` 推断平台权利；**不**因录屏 / 高光存在于 sidecar 而视其权利
   已清——来源权利核验属于未决项 `source_rights`
10. `ready_for_live_checks` — 全部本地条件通过

| 阻止码 | 触发场景 |
| --- | --- |
| `job_id_invalid` | publishJobId 非字符串或空白 |
| `document_invalid` | 文档解析抛出任何 `ProductionContractError` |
| `job_not_found` | 文档中无该任务 ID |
| `job_state_not_preflightable` | 任务状态不是 draft / preflight |
| `commerce_request_present` | commerceRequest 非严格 null（含 required:false） |
| `account_not_active` | 账号快照 status ≠ 'active'（expired / needs_login / removed / unknown） |
| `account_session_missing` | status active 但 sessionRef 为 null |
| `reference_missing` | 防御分支：解析后引用意外缺失（正常不可达，失败关闭） |
| `variant_not_qc_passed` | 版本状态 planned / rendering / rendered / qc_failed |
| `variant_output_missing` | outputRef 或 outputSha256 为 null |
| `variant_duration_invalid` | durationMs 为 null 或非正 |
| `variant_timeline_missing` | 版本 timelineRef 为 null |
| `plan_empty` | 计划无分段 |
| `plan_timeline_missing` | 计划 timelineRef 为 null（尚未回写时间线） |
| `plan_timeline_mismatch` | 计划与版本 timelineRef 不一致 |
| `asset_not_authorized` | 被引用素材 authorizedForAutoUse ≠ true |
| `preflight_error` | 任何意外内部 / 解析异常（失败关闭兜底） |

未决检查清单（成功结果的 `pendingChecks`，顺序稳定、运行时冻结）：

| 未决项 | 含义 | 归属 |
| --- | --- | --- |
| `trusted_campaign_grant` | P4-1 预授权活动门控：grant 发行 / 装载 / 校验与原子配额预留 | 受信任 Electron main（未实现） |
| `live_account_session` | 账号实时登录 / 会话探针 | P1-1 账号核心（真实核验） |
| `source_rights` | v1 素材授权标志之外的录屏 / 高光 / 素材来源权利核验 | 权利追溯链路 |
| `platform_permission_and_user_awareness` | 平台应用权限、账号逐一授权与每次发布的用户可感知交互 | 各平台适配器（见官方门槛文档） |
| `output_file_integrity` | 产物文件字节与 outputSha256 的一致性 | 渲染 / 上传阶段 |
| `remote_final_state` | 提交后的平台远端最终状态核验；未知提交先查远端 | 队列 / 适配器 |

## 5. 不变量与测试覆盖（41 项）

- 合法夹具（draft 与 preflight 状态）→ `ready_for_live_checks`，六项未决检查齐全 ✅
- 成功 / 阻止结果均冻结；成功形状只有 `status + pendingChecks`，序列化不含
  `authorized_to_publish` / `publishable` / `"allowed"`，`pendingChecks` push 抛错 ✅
- 非法文档（非对象、schemaVersion 2/0/'1'/缺失、缺字段、未知字段、非法枚举、凭证
  字段、类实例、敌意 getter、循环引用）全部阻止且失败关闭 ✅
- 任务 ID 非法（含显式 `undefined` 原样直达生产入口，不被测试 helper 吞掉）/ 任务缺失 /
  11 个非白名单状态（含 `unknown_submission`、submitted、published 显式反例）全部阻止 ✅
- 商品请求 required=true 与 required=false 均阻止（无降级路径）✅
- 账号 expired / needs_login / removed / unknown、active+sessionRef null 阻止 ✅
- 版本 planned / rendering / rendered / qc_failed、缺产物引用 / 哈希、时长 null/0、
  时间线 null 阻止 ✅
- 空计划、计划未回写时间线、计划与版本时间线不一致阻止 ✅
- 被引用素材未授权（单 / 多分段）阻止；未引用的未授权素材不阻止 ✅
- 悬挂引用（账号 / 版本 / 计划 / 高光录屏 / 分段素材）在解析层失败关闭 ✅
- 判定次序固定（任务 ID → 文档 → 查找 → 状态 → 商品 → 账号 → 版本 → 计划 → 素材，
  及各组内部次序）✅
- 脱敏：阻止结果只含 `status + reason` 两键，不回显账号 ID、昵称、标题、描述、标签、
  封面引用、sessionRef、项目 ID、产物路径、解析器消息或异常文本 ✅
- 无副作用：输入文档 ready / blocked 路径均逐字节不变；重复调用结果一致；函数自身
  对任意输入不抛异常 ✅

## 6. 未接线 / 未验收（不得宣称）

- 本模块**没有调用方**：未接 `publish:run` IPC、durable queue、Agent runtime、MCP 或
  平台适配器；不能据此声称存在任何 Agent 到发布的可运行路径。
- 通过本地预检**不代表**：平台授权、账号实时登录有效、来源权利已清、产物文件完整、
  平台接受或远端发布成功——六项未决检查全部仍待后续阶段独立完成。
- `ready_for_live_checks` 不占用队列额度、不改变任务状态、不预留任何资源；与 P4-1
  门控的组接（trusted_campaign_grant 注入、配额原子预留）尚未实现。
- 首轮 worker 侧未能运行 Vitest / `tsc --noEmit`（§3 原样记录）；Codex 修复前独立复测
  为 131/132（唯一失败即上述非法 ID 用例）。修复后 worker 侧 Vitest 仍被 WSL 的
  Windows-only rollup 原生二进制阻断（§3.2，未安装依赖）；Codex 在 worker 结束后
  Windows Node 22 独立复测 132/132、`tsc --noEmit` 退出码 0。测试通过仅覆盖离线
  本地预检，不构成发布链路验收。
- 本轮未运行完整测试套件（其 Windows 基线在既有文档中记录为红），只要求上述三个
  聚焦文件。
- 本记录不关闭 P4-2、不关闭 R5 / R6-P，也不构成 R6-C 证据；商品挂载仍只有契约端口
  与拒绝路径。无「原创」认定或平台接受保证。

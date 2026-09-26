# HotClip 高光候选来源投影验证（P2-1 / H1-S1）

本页记录 `app/electron/highlights/project-hotclip-candidates.ts`（HotClip 高光候选 →
`HighlightV1` 纯来源投影）的验证状态。它只覆盖 H1-S1 离线纯映射与 H1-S2a 的 getter
快照硬化；H1-S2b/S2c 的多录屏持久任务、H1-S3 的真实 HotClip / 真实录屏盲审均未开始，
不能据此声称「AI 批量剪辑」或任何平台「原创」判定完成。相关边界见
[阶段一 H1 计划](../plans/2026-09-26-phase1-h1-highlight-batch.md) 与
[P0-3 HotClip 隔离试验](p0-3-hotclip-pilot.md)。

## 文件与来源边界

基线 `13dc306`，本工作树只涉及三个白名单文件：

- `app/electron/highlights/project-hotclip-candidates.ts`：纯函数投影。只从
  `hotclip-sidecar.ts` `import type` 候选类型，不导入、不复制、不分发 HotClip
  （AGPL-3.0-only）代码；不读文件系统、不哈希 / 读取媒体、不起子进程、不触网、不调用
  模型、不读系统时钟（`createdAt` 必须由调用方显式给出）。
- `app/tests/highlights/project-hotclip-candidates.test.ts`：合成夹具聚焦测试。
- `docs/validation/p2-1-highlight-projection.md`：本页。

许可边界不因本模块改变：正式分发前的 AGPL / 组合作品审查仍按 P0-3 记录单独进行，
本页不作任何许可结论。

## 前序超时与 RED

- 连续两个 `claude-bailian/qwen3.8-max` 执行任务分别在 1500 秒与 900 秒时限到达，
  工作树留下上述两个候选文件但未完成验证记录；超时任务不记为验收通过。
- Codex 在 Windows Node 22.23.3 以官方 Vitest v2.1.9 实跑修复前 14 项为 **13/14**，对修复前
  候选字节复跑仍为 **13/14**。唯一 RED 在测试约 431 行：`2026-02-31T00:00:00Z` 通过了当时
  的 `Date.parse` 兜底检查，因为运行时会把这个不存在的日历日期规范化为 3 月并返回有限
  时间戳（`2025-02-29`、`2026-04-31`、`24:00:00` 同理；本机 Node 22.22.3 复核一致）。

## 修复内容（2026-09-26）

`isIsoDateTime` 保留与 `src/lib/production-document.ts` 相同的严格形态正则
（`YYYY-MM-DDTHH:mm:ss[.1–9 位小数](Z|±HH:MM)`），在形态匹配后显式校验：

- 月份 01–12；日期按当月实际天数（含闰年二月 29 日）；
- 闰年规则：能被 4 整除，且百年仅当能被 400 整除才闰（`2024-02-29`、`2000-02-29`
  合法；`2025-02-29`、`1900-02-29`、`2100-02-29` 拒绝）；
- 时 00–23、分 / 秒 00–59（不接受 `24:00:00` 结尾形式与闰秒 `:60`）；
- 时区偏移时 00–23、分 00–59（`+23:59` / `-23:59` 合法；`+24:00`、`+00:60` 拒绝）；
- 完全移除 `Date.parse`：不再依赖运行时对非法日历日 / 时钟值的规范化行为。

`capturedAt`、`importedAt`、`createdAt` 三个入口共享同一 `isIsoDateTime` 语义；无效值按
入口分别返回固定错误码 `invalid_recording`（录屏字段）或 `invalid_created_at`（投影
时间）。错误消息是静态文本，不携带路径、候选内容、reason / hook / title 或视觉载荷。

## 验证结果

| 检查 | 实际结果 | 证据边界 |
| --- | --- | --- |
| 官方聚焦 Vitest | 本工作树 `app/node_modules` 为空目录：`node ./node_modules/vitest/vitest.mjs run tests/highlights/project-hotclip-candidates.test.ts` 退出码 **1**（`Cannot find module .../node_modules/vitest/vitest.mjs`），**未运行**。 | 无依赖环境，不能记为测试通过；待 Codex 在主库依赖环境复跑全部用例。 |
| 官方 `tsc --noEmit` | `node ./node_modules/typescript/bin/tsc --noEmit --project tsconfig.json` 退出码 **1**（`Cannot find module .../node_modules/typescript/bin/tsc`），**未运行**。 | 同上；本页不宣称类型检查通过。 |
| 修复前 RED（Codex 官方复跑） | 14 项 **13/14**，唯一失败为 `2026-02-31T00:00:00Z` 被放行。 | Windows Node 22.23.3 + 官方 Vitest v2.1.9。 |
| 修复后模块级补充检查 | 本机 Node 22.22.3 以类型剥离直接 `import` 真实模块（一次性脚本在仓库外，**非官方 Vitest，不计入「自动化测试通过」证据**）：5 个合法值 × 3 入口全部接受；14 个非法值 × 3 入口全部按入口返回预期错误码，退出码 0。 | 只补充证明 `isIsoDateTime` 行为与错误码映射；官方套件是否全绿由 Codex 复跑判定。 |
| Codex 主库正式复跑 | 选择性复制三个白名单路径到主库 `9c20f02` 后，以 Windows Node 22.23.3 + 官方 Vitest v2.1.9 运行聚焦套件：**15/15**，退出码 **0**；`tsc --noEmit --project app/tsconfig.json` 退出码 **0**。 | 仅本地离线契约与类型证据；未运行真实 HotClip、真实媒体或平台发布。 |

测试文件保留原有 14 个用例（修复前 13/14，其中 1 个因日历日期缺陷失败）并新增 1 个
边界用例：闰年 / 月份天数 / 时分秒 / 偏移范围 × `createdAt` / `capturedAt` /
`importedAt` 三入口；原有断言未削弱。修复后正式聚焦套件 **15/15**、退出码 **0**。

## H1-S2a：校验后重读封闭（2026-09-26，基线 `bd5ab99`）

GLM P2 指出的「候选 / 录屏字段先校验、后在投影循环重读」缺口在本节封闭。修复只涉及
`projectHotClipCandidates`：录屏、候选与输入对象的原始字段在**校验时一次读出**并固化
为 primitive 快照（`VerifiedRecording` / `VerifiedCandidate`），后续哈希比对、去重、
越界判定与 `HighlightV1` 投影只引用快照；`visualEvidence` 继续完全不读取、不输出。

- **动态 getter 翻转**：第一次读取返回合法值、第二次返回畸形 / 不同值的候选
  （`id` / `startMs` / `endMs` / `reason` / `score` / `recommended`）与录屏
  （`id` / `sourceSha256` / `durationMs`，以及输入对象自身的 `observedSourceSha256` /
  `createdAt` / `candidates`）只能按第一次已验证快照投影；输出与同值普通 JSON 输入
  逐字节一致，稳定 ID 不变，翻转值绝不进入 `HighlightV1` / 来源哈希 / 稳定 ID。
- **getter 抛错**：首次读取抛错映射为固定 `invalid_recording` / `invalid_candidate`
  （候选错误携带数值型下标），绝不携带异常原文、路径或敏感 marker，`cause` 保持
  `undefined`；第二次读取才抛错的 getter 在修复后不再发生第二次读取，投影成功。
- **读取计数**：新增用例断言校验用字段恰好读取一次、`visualEvidence` 读取次数为 0。

### RED→GREEN 证据（补充检查，非官方 Vitest）

本工作树 `app/node_modules` 不存在；主库安装的 Vitest v2.1.9 在本机（Linux / Node
22.22.3）因 Windows 原生 `@rollup/rollup-*` 二进制缺失而无法启动，**未运行任何用例**
（退出码 1，失败发生在 rollup 原生模块加载阶段）。Codex 将三处白名单路径选择性复制到
依赖完整的主库 `5ca64ca` 后，以 Windows Node 22.23.3 + 官方 Vitest v2.1.9 复跑
**19/19**、退出码 **0**；`tsc --noEmit --project app/tsconfig.json` 退出码 **0**。
这证明合成 getter 与普通 JSON 回归，不是 HotClip 或真实录屏验收。
补充检查使用仓库外一次性脚本，以 Node 22.22.3 类型剥离直接 `import` 真实模块
（**非官方 Vitest，不计入「自动化测试通过」**）：

| 检查 | 修复前（RED） | 修复后（GREEN） |
| --- | --- | --- |
| getter 翻转 / 抛错断言（A 组） | 10 项失败：候选翻转被误拒为 `invalid_candidate`、录屏翻转误触发 `source_hash_mismatch`、输入哈希翻转抛裸 `TypeError`、getter 抛出的 marker 原文外泄 | 0 项失败，退出码 0 |
| 普通 JSON 输出 / 稳定 ID / 错误码 / 消息 / 冻结标记快照（B 组） | 记录基线 | 与基线**逐字节一致** |

聚焦测试文件新增 4 个 getter 用例（候选字段翻转、录屏字段翻转、输入对象字段翻转、
getter 抛错映射），原有 15 项未改动，共 **19 项**；官方主库复跑结果见上。另做的隔离
类型检查（主库 TypeScript 6.0.2 + `@types/node`，仅包含本模块及其类型依赖，**非官方
`app/tsconfig.json` 全项目检查**）退出码 0。

### 独立审查反馈与 Codex 复核

GLM-5.3 的 H1-S2a 只读审查未发现 P0/P1，指出两个 P2：输入对象顶层 getter
首次抛错缺少测试，以及录屏 / 候选 getter 可以抛出伪造的 `HotClipProjectionError`
影响错误码诊断。Codex 增加两条反例，第二条在旧实现上使官方 Vitest **20/21**
（收到伪造的 `invalid_candidate` 而非本层 `invalid_recording`）；随后改为在录屏 / 候选
验证边界始终重建本层固定错误码，官方 Windows Node 22.23.3 + Vitest v2.1.9
聚焦测试 **21/21**、退出码 **0**，`tsc --noEmit --project app/tsconfig.json`
退出码 **0**。顶层 getter 抛错用例同时断言固定码、异常原文不外泄及无 `cause`。
这仍是合成纯映射证据，不是批处理调度、真实媒体或平台结果。

### `durationMs` 与日期的更严门槛（只拒不放）

- `durationMs` 必须是**非负安全整数**：`parseProductionDocument` 只要求非负普通整数
  （`Number.isInteger`），本投影额外要求 `Number.isSafeInteger`。超过 2^53−1 的毫秒值
  已失去精度，继续参与稳定 ID / 边界判定不安全；该差异是只拒不放的精度保护，不改变
  普通取值范围输入的结果。
- `capturedAt` / `importedAt` / `createdAt` 必须通过显式日历校验（月份天数、闰年二月、
  时分秒与偏移范围），相比 `parseProductionDocument` 的日期形态正则同样是更严门槛，
  只拒不放。

以上差异**不声称**修复了 `src/lib/production-document.ts` 解析器本身；本模块只对
普通对象访问器作出保证，**不对任意恶意 Proxy** 作任何承诺。

## 独立审查后的 P2 边界

GLM-5.3 经 `qwen-code-review` 路由只读审查本候选，未发现 P0/P1；以下为非阻断但需追踪的 P2：

- 候选先整体校验、再在投影循环重读字段。如果调用方传入带动态 getter 的普通对象，第二次读取可能与已校验值不同。当前 sidecar 的 `JSON.parse` 产物无法携带 getter，故现有路径不可触发；**H1-S2 扩大调用面前须改成“校验时快照原始字段，投影仅用快照”并增加反例测试**。本页的 fail-closed 断言只针对 JSON 数据形态，不对任意带访问器对象作保证。→ **已由 H1-S2a 封闭（见上节），主库官方聚焦 19/19。**
- 本投影要求 `durationMs` 为非负安全整数，且日期必须是实际存在的日历日；生产文档解析器当前仅要求普通整数与日期形态正则。已入库但不满足更严门槛的录屏会被本投影拒绝，属于只拒不放的契约差异；H1-S2 应统一或显式说明来源记录的规范化规则。→ **H1-S2a 在验证文档显式说明，H1-S2 后续 ingest 统一入口仍待做。**
- 审查指出本页修复前 `13/14` 叙述和修复后正式结果缺失可能误读；上文已在 Codex 合入时补正。

## 语义断言（源码可见级）

- **输入哈希只比对、不计算**：`observedSourceSha256` 必须是调用方（后续 ingest 步骤）
  已经算好的摘要，本模块只与 `RecordingV1.sourceSha256` 做大小写不敏感比对，失配 /
  畸形一律拒绝；模块绝不读取媒体，也绝不声称自己计算了媒体摘要。
- **恒定人工评审门槛**：每条投影结果固定 `reviewRequired: true`；上游 `recommended`
  无论真假都只作为启发式建议原样保留，**不构成**发布批准、质量 / 原创性判定或人工评审
  通过。
- **零候选合法**：空候选数组返回深冻结空数组，保留低高光负样本，不为数量制造候选。
- **fail closed 与不可变性**：重复候选 ID / 重复投影范围 / 越界时间码整体拒绝，绝不
  静默丢弃或截断；输出为深拷贝 + 深冻结，输入事后变异不影响结果。
- **来源追溯**：投影结果带规范化录屏哈希、上游候选 ID 与上游建议原样字段；稳定 ID 由
  录屏身份 / 哈希 / 候选 ID / 精确毫秒范围派生，同输入重跑不变。

## 尚未验证（不得据此宣称）

- 真实 HotClip 与真实媒体：本模块是合成映射，未运行真实 HotClip，也未用用户授权录屏
  做 Windows 本地试验（H1-S3）。
- 高光质量与叙事独立性：无真实样本盲审，不能判断候选是否值得剪辑、是否构成实质性
  叙事变化。
- 数据与许可：录屏来源、使用许可、AGPL / 组合分发边界均未在真实素材上验证；正式分发
  前仍需单独审查。
- 平台结果：无真实账号发布、商品挂载或平台最终状态验证，不承诺平台「原创」认定。
- H1-S2b/S2c（多录屏持久任务、有界并发、取消、失败恢复、崩溃重启）与批处理调度
  未实现；H1-S2a 只是对既有纯投影的 getter 快照硬化，本页不能作为「批量智能剪辑」
  完成证据。

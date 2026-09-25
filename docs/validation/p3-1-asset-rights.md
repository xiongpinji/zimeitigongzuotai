# P3-1 有界实现：授权素材目录与可注入语义检索边界验证记录

输入基线：main `617293c`，工作树 `zimeitijuzhen-ao-m1-repair`（detached HEAD）。
本候选源于 M1 隔离工作树；`app/tests/assets/asset-rights.test.ts` 为「原样导入的
59 项测试 + Codex 追加的 4 项 RED 验收测试」。四项 RED 已通过源码修复；原 59 项
断言未改。Codex 将三个允许文件选择性并入主库后，独立完成了测试与类型检查。

本记录只覆盖**离线、纯内存**的「授权闸门 + 可注入语义检索端口」协议与合成行为测试。
它**不是** R1–R5 验收：**不证明**真实 CLIP embedding / 向量索引、任何素材的法律授权
充分性、平台权限或混剪成片可发布性。本轮未接 IPC / renderer / 预检 / 合成计划 /
平台适配器，未下载模型、未读写真实媒体、未调用网络、LLM 或系统时间。
`app/electron/production/publish-preflight.ts` 中的 `source_rights` 仍是未决项，
本模块**未**与其接线。

## 1. 精确改动文件（恰好 3 个，与 main 的全部差异）

| 文件 | sha256 | 内容 |
| --- | --- | --- |
| `app/electron/assets/asset-rights.ts` | `ef03e4b596429b9a86a570bc56d78c9c66a9f742cd5ad0293be575598487f206` | 1035 行纯函数 / 内存模块：注册校验、fail-closed 授权闸门（含运行时形状复核）、目录、端口输出净化推荐、await 前不可变快照；不 import fs / 网络 / Electron / 模型 |
| `app/tests/assets/asset-rights.test.ts` | `59993cad2be2d958bb9ba90691bd654112b1e51056a57d954bde664cf5e7131f` | 1121 行 = 原样导入的 59 项（前 1063 行）+ Codex 追加的 4 项 RED 验收测试（末段 `describe('Codex 复核补充的授权负例')`）。**本轮修复未编辑该文件** |
| `docs/validation/p3-1-asset-rights.md` | 本文档 | 验证记录与边界说明 |

测试文件来源与哈希说明（更正上一版记录）：

- 原始导入版本与提交 `4a28e2a55f09f95bd1634a104b4c17c7c531c7b0` 逐字节一致，
  sha256 为 `71afe61dad982319e0577d8b1427b514e74a559017c8ec1e1c3923f06f5c82e0`（1063 行）。
- **Codex 在导入之后向文件追加了 4 项 RED 验收测试**，因此最终测试文件 sha256
  （`59993cad…`，见上表）**不同于**原始导入哈希 `71afe61d…`。
- 本轮已复核：当前文件前 1063 行与 `git show 4a28e2a:app/tests/assets/asset-rights.test.ts`
  的 `diff` 输出为空（逐字节一致），且该 blob 的 sha256 实测等于 `71afe61d…`；
  追加的 4 项测试原样保留，未做任何断言调整。追加的 4 项为：
  1. `仅授权 cn 的素材不能用于 worldwide 上下文`
  2. `绕过注册校验的损坏素材不能进入语义端口候选集`
  3. `凭证字段的任意后缀不出现在错误消息或错误路径`
  4. `异步检索期间外部改写输入不能伪造已筛选素材的来源和证据`

未改动 `AssetV1` / `PRODUCTION_PLATFORMS`（`app/src/types/production-contracts.ts`）、
`parseAsset`（`app/src/lib/production-document.ts`）、预检、合成、IPC、UI、构建、
依赖或 lockfile。`git status --short` 仅显示上述三个允许路径（两个未跟踪目录 +
本文档），对已跟踪文件 `git diff` 为空。工作树内 `app/node_modules` 不存在
（未被创建、未被链接、未被安装）。

## 2. 本轮修复的 4 项 RED（源码级修复说明）

| RED 测试 | 缺陷 | 修复（均在 `asset-rights.ts`） |
| --- | --- | --- |
| cn 授权 ≠ worldwide 上下文 | 地区匹配把上下文的 `worldwide` 反向解释为「任意授权均覆盖」 | `worldwide` 改为**单向保留词**：记录的 worldwide 授权覆盖任意具体地区；上下文要求 worldwide 时仅 worldwide 授权匹配。保留 trim + 小写归一化 |
| 畸形素材进入端口候选集 | 闸门只查来源 / mediaRef / 授权结构，不复核 `AssetV1` 形状，非法 sha256 可被 cast 绕过 | 闸门新增运行时形状复核 `isRuntimeValidAssetShape`（sha256 / 枚举 / 时长 / 标签 / ISO 时间等；按契约**不读取** `usageScope`），畸形按 `invalid_entry` 阻断；既有更具体原因（`missing_provenance`、`invalid_grant` 等）原样保留；不回显原始字段值 |
| 凭证键字节回显 | `credential_material_forbidden` 错误的 message 与 path 内插原始键名（如 `cookieSYNTHETIC_PRIVATE_VALUE_0123`） | 改为固定脱敏文案：path 使用 `$.<redacted-credential-key>` 形式的固定占位段，message 不含任何键名字节；code 保持机器可判定 |
| await 期间溯源可被篡改 | `recommendBrollFromEntries` 持有外部可变引用，端口 Promise 悬置期间调用方改写 `asset.source` / `evidence[*].ref` 会进入推荐结果 | 授权筛选后、调用端口前**同步**对合格条目做逐契约字段深拷贝 + 深冻结快照（`snapshotEligibleEntry`）；候选 ID、推荐记录的来源 / 证据全部取自快照；越权端口命中仍被过滤 |

修复刻意最小化：未触碰注册校验通过路径、端口输出净化、排序 / 截断、目录语义，
以保持原 59 项行为不变（含「闸门不读取 usageScope：空文本 + 有效结构化授权仍放行」
与「worldwide 保留词覆盖任意地区」两项既有契约）。

## 3. 证据分级（按根 AGENTS.md）

| 层级 | 状态 |
| --- | --- |
| 源码可见 | ✅ 运行时只 import `production-contracts.ts` 常量与类型；无 fs / 网络 / Electron / 模型 / 系统时间 / 随机数 / 全局状态；输入深拷贝、输出深冻结；不修改输入；错误消息不含凭证键名 / 值或媒体内容 |
| 自动化测试通过 | ✅ Codex 在主库 Windows Node 22 环境独立运行官方 Vitest：授权模块 **63/63**、生产契约 **50/50**，合计 **113/113**；`tsc --noEmit --project app/tsconfig.json` 退出码 **0**。此层级只覆盖离线合成数据与静态类型 |
| 真实账号验证 | ❌ 未发生。全部为合成元数据与假端口 |
| 平台最终状态验证 | ❌ 未发生。本模块不调用平台，也不查询远端 |

## 4. 验证命令与结果（本轮，worker 侧）

worker 侧 Node 为 `v22.22.3`，本工作树 `app/node_modules` 不存在。本轮会话沙箱
仅允许读写本工作树：对主仓 `zimeitijuzhen/app/node_modules` 的只读访问、
`node <脚本>` / `node -e` 执行与 `/tmp` 写入均被权限层拒绝（各尝试一次，不重复申请），
因此**官方 Vitest、`tsc --noEmit` 与上一候选使用过的转译 shim 替代执行本轮均未能运行**。
按任务约束未安装依赖、未创建 `node_modules` 链接、未做额外环境勘察。

本轮实际完成的验证：

```text
$ git status --short
?? app/electron/assets/
?? app/tests/assets/
?? docs/validation/p3-1-asset-rights.md        （与 main 的全部差异 = 三个允许文件）

$ git diff --no-index --check /dev/null app/electron/assets/asset-rights.ts
（无输出，退出码 0：无空白错误）

$ diff <(git show 4a28e2a:app/tests/assets/asset-rights.test.ts) 当前文件前 1063 行
（无输出：原始 59 项逐字节未改；4 项 RED 原样保留）

$ sha256sum（结果见 §1 表格；原始测试 blob 实测 71afe61d… 与记录一致）
```

类型安全说明：本轮未运行 `tsc`（被阻断）。新增代码经人工逐处核对类型
（`Record<string, unknown>` 收窄、`Array.isArray` 收窄、快照字面量对
`AssetCatalogEntry` 的结构兼容），最终判定以 Codex 的 Windows `tsc --noEmit` 为准。

### Codex 独立复跑（Windows Node 22，主库 `app/` 下）

```bash
node ./node_modules/vitest/vitest.mjs run tests/assets/asset-rights.test.ts tests/production-contracts.test.ts
node ./node_modules/typescript/bin/tsc --noEmit
```

实际：`asset-rights` **63/63**（59 原始 + 4 修复的 RED）、`production-contracts`
**50/50**，Vitest 退出码 **0**；`tsc --noEmit` 无诊断、退出码 **0**。
`tsconfig.json` 的 `include` 覆盖 `electron/**`，含本模块；测试文件由 Vitest
转译执行，不在 tsc 范围。此结果发生在主库，候选工作树的依赖缺失不影响该结论。

## 5. 模块语义（源码可见级，含本轮修复后的更新）

导出 API：`AssetRightsCatalog`、`AssetRightsError`、`validateAssetCatalogEntry`、
`validateAssetUsageContext`、`validateBrollQuery`、`evaluateAssetEligibility`、
`selectEligibleAssets`、`recommendBrollFromEntries`，以及 `AssetCatalogEntry`、
`AssetUsageContext`、`BrollQuery`、`RightsGrant`、`RightsEvidence`、
`SemanticSearchHit`、`SemanticSearchPort`、结果与阻断码类型。

- **注册校验**（`validateAssetCatalogEntry`）：先递归拒绝凭证字段名
  （`credential_material_forbidden`，**错误 path / message 使用固定脱敏文案，
  绝不回显原始键名字节**），再要求条目恰为 `{asset, mediaRef, rightsGrant}`；
  `asset` 按 `AssetV1` 形状复核（sha256、媒体类型、非负时长、非空白来源 /
  权利持有人 / 许可 / 使用范围、ISO 日期时间且 `Date.parse` 非 NaN），
  `rightsGrant` 为 `null` 或结构完整的 `RightsGrant`（精确键、四平台枚举、
  非空白地区、`allowed/prohibited/unknown`、日期合法且不早于生效、证据
  `kind/ref/collectedAt/note` 合法）。返回深拷贝 + 深冻结副本。
- **授权闸门**（`evaluateAssetEligibility`，fail-closed）：上下文非法抛
  `invalid_context`；非对象条目返回 `invalid_entry` 而非抛异常；按序收集阻断原因：
  `missing_provenance`（来源 / 权利持有人空白）、`missing_media_ref`、
  `invalid_entry`（**运行时 `AssetV1` 形状复核失败**，拦截 cast 绕过注册校验的
  畸形素材如非法 sha256；复核不读取 `usageScope`）、
  `missing_grant`、`invalid_grant`（防御性重验结构损坏的授权）、
  `auto_use_flag_false`、`platform_not_allowed`、`region_not_allowed`
  （trim + 小写比较；**`worldwide` 为单向保留词：记录的 worldwide 授权覆盖任意
  具体地区，worldwide 上下文仅匹配 worldwide 授权，具体地区授权绝不反向放大**；
  空地区数组阻断一切）、
  `commercial_use_prohibited` / `commercial_use_unknown`（仅商业短视频上下文）、
  `grant_not_started` / `grant_expired`（端点包含；`validUntil: null` 无固定截止）、
  `missing_evidence`（证据数组为空）。结果与原因数组均冻结。
  **`usageScope` 自由文本（以及 `license` 字符串）永不参与放行判定**；
  `authorizedForAutoUse: true` 单独不足以放行。
- **可注入端口**（`recommendBrollFromEntries` / `AssetRightsCatalog.recommendBroll`）：
  先校验查询与上下文并补齐默认值（`maxResults` 默认 10、`minScore` 默认 0、
  `preferredTags` 默认空数组；未知键拒绝），在**调用端口之前**完成授权筛选，
  并**同步**对合格条目做逐契约字段深拷贝 + 深冻结快照；端口只收到由快照生成的
  冻结候选 ID 集，畸形条目绝不进入候选。**端口 Promise 悬置期间调用方改写原始
  条目（`asset.source`、`rightsGrant.evidence[*].ref` 等）不影响推荐记录的
  来源 / 证据**。端口缺失、调用端口时同步 / 异步抛异常、返回非数组一律返回
  `index_unavailable`（消息为固定文案，不回显异常内容），绝不回退到随机或
  目录顺序推荐；无合格候选时返回 `no_eligible_assets` 且**不调用端口**。
- **端口输出净化**：未注册 / 未授权 ID 丢弃并计 `unauthorized`；非对象、ID 非
  字符串、分数非有限数或越界 [0,1] 计 `invalid`；重复 ID 保留第一条计
  `duplicate`；低于 `minScore` 计 `belowThreshold`。排序为分数降序、同分按资产
  ID 升序（确定性与端口返回顺序无关），随后按 `maxResults` 截断。
- **可追溯输出**：推荐条目透传（快照中的）`sha256`、`mediaRef`、`mediaType`、
  `source`、`rightsHolder`、`license`、证据引用列表、`grantValidFrom` /
  `grantValidUntil` 与端口**原始** `similarity`；`reasons` 明确标注分数来自
  「注入端口」、标签匹配为集合交集事实、权利字段来自元数据，不伪造模型证据。
  结果深冻结，两次调用返回不同实例，目录内部状态不可经返回值篡改。
- **目录**（`AssetRightsCatalog`）：按注册顺序保留条目；重复 ID（`duplicate_id`）
  与大写不敏感的重复 sha256（`duplicate_sha256`）显式报错且不覆盖；`get` 返回
  同一条目引用；`entries()` 返回冻结副本。`selectEligibleAssets` 独立纯函数
  仍返回原引用（快照仅发生在推荐入口内部）。
- **记录的元数据语义限制**：`validFrom: null` 被视为「未记录生效下界」（与
  被测试明确覆盖的 `validUntil: null` 对称），不是无限制授权；`license` /
  `usageScope` 文本仅作追溯展示，不作机器判定。这是本模块的明确边界。

## 6. 测试覆盖摘要（59 原始 + 4 Codex 追加 = 63 项）

- 注册校验与深拷贝冻结（9 项）：合法 / `rightsGrant:null` / 空数组结构、
  非对象与未知字段、凭证字段、空白 `mediaRef`、`AssetV1` 形状、授权结构、
  日历非法 ISO。
- fail-closed 闸门（19 项）：四平台放行、平台 / 地区 / 商业用途 / 有效期边界 /
  证据缺失阻断、`usageScope` 不参与、防御性绕过用例、非对象条目、非法上下文。
- 目录（7 项）：注册顺序、构造初始条目、重复 ID / sha256、注册后改输入不影响
  目录、`eligibleAssets` 隔离、独立纯函数一致性。
- 端口筛选与净化（13 项）：无候选不调用端口、冻结候选集、越权 / 幽灵 / 重复 /
  非法分数丢弃、`minScore`、端口异常 / 非数组 / 未注入 → `index_unavailable`、
  同步端口、零匹配。
- 排序、截断与理由（8 项）：分数降序、同分 ID 升序稳定、截断、理由事实与
  标签匹配、深冻结与实例隔离。
- 查询校验与独立纯函数（3 项）：非法查询 / 上下文在端口前抛出、垃圾条目
  fail-closed、纯函数与目录方法结果一致。
- **Codex 复核补充的授权负例（4 项，本轮修复对象）**：cn 授权不覆盖 worldwide
  上下文、非法 sha256 素材不进端口候选集、凭证键后缀不回显于 message / path、
  异步检索期间外部改写不能伪造来源与证据。

## 7. 权利与安全边界（明确不承诺）

- **GLM 只读复审**：`qwen-code-review-20260925-194141-a217be` 对当前候选源码与
  63 项测试未发现 P0/P1 阻断项。两个 P2 后续加固点：端口返回数组中若含带
  抛错 getter / Proxy 的命中对象，净化循环可抛出原始异常；尚缺一项测试钉住
  `license` 自由文本不能扩大结构化授权。这不构成真实素材或平台验收。
- **不证明法律授权**：模块只检查「已记录的结构化元数据」是否内部一致且在
  给定上下文下允许，不核验真实授权书、采购合同、平台条款或地区法律；证据
  引用仅为字符串追溯，未读取证据文件内容。
- **没有真实 CLIP / 向量索引**：`SemanticSearchPort` 是调用方注入的边界；本轮
  测试全部使用假端口与合成分数，未下载模型、未建索引、未做任何 embedding。
- **未接生产链路**：未改预检 / 合成 / IPC / UI / renderer；预检的
  `source_rights` 仍未决，本模块不构成其完成。
- **不构成混剪成片验收**：无真实录屏、素材、渲染、时间线回写或盲审；
  不承诺任何平台“原创”判定或发布资格。

## 8. 未遵守事项与说明

- 官方 `vitest`、根级 `tsc --noEmit` 与替代转译执行本轮均未能在 worker 侧运行：
  工作树无 `app/node_modules`，且会话权限层拒绝对主仓依赖的只读访问、`node`
  脚本执行与 `/tmp` 写入（§4 原样记录，各一次）。按任务约束未安装依赖、
  未创建链接。Codex 随后在主库 Windows Node 22 环境独立复跑，结果见 §3–§4。
- 向 Codex 通道发送阶段事件（`channel.py event`）在本会话被权限层拒绝，
  未能发布；以本记录与最终报告代替。
- 除上述环境阻断外，未偏离任务指令：未提交、未推送、未改凭证、未用子代理、
  未使用网络 / 真实媒体 / 平台账号，未编辑三个允许路径之外的文件（验证用
  临时文件均已删除，`git status --short` 仅剩三个允许路径）。

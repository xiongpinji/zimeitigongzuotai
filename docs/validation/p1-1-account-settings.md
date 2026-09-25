# 四平台安全账号设置页验证（P1-1 / A2-S3）

本页记录 `account-v2:*` 安全账号桥的 Renderer 端交付：独立设置页、UUID 键控仅内存
store、旧账号页 / 旧发布工作台的未切换边界。基线为 `9c20f02`（A2-S2 已合入）；本阶段
仍不接旧 `publish:*` 发布 runner，不做真实账号登录，也不宣称新账号已可发布。

## 交付路径（仅 9 个白名单文件）

1. `app/src/store/accounts-v2.ts`（新增）— UUID 键控仅内存 store 与固定中文错误文案。
2. `app/src/components/settings/SecureAccountsTab.tsx`（新增）— 创建 / 首登续登 / 检查 / 删除界面。
3. `app/src/components/settings/SecureAccountsTab.module.css`（新增）— 该页样式。
4. `app/src/pages/Settings.tsx`（修改）— 注册独立 `secure-accounts` tab。
5. `app/src/components/settings/PublishAccountsTab.tsx`（修改）— 仅加未切换边界提示，旧功能未改动。
6. `app/src/components/publish/PublishWorkbench.tsx`（修改）— 仅加未切换边界提示，runner / targets 未改动。
7. `app/tests/accounts-v2-store.test.ts`（新增）— store 合成测试（先于实现编写）。
8. `app/tests/accounts-v2-settings.test.tsx`（新增）— 设置页合成测试（先于实现编写）。
9. `docs/validation/p1-1-account-settings.md`（本页，新增）。

未修改 `electron/**`、preload、旧 `src/store/publish.ts`、队列、平台模块、package/lock。
本隔离工作树在任务开始前是干净的；Codex 对候选的精确文件清单核对为上述 9 个路径。

## 行为契约与实现要点

- **UUID 唯一身份**：`byId` + 顺序数组；同名同平台账号各自成行，绝不以
  `platform/displayName` 去重；create/login/check/delete 结果只合并到对应 UUID。列表读取
  若与本地操作交错，最多重读两次主进程列表；持续变化时保留当前投影，不用旧快照覆盖新行。
- **两步创建/登录**：create 成功立即出现独立 UUID 行（`unknown`、无会话）；login
  失败保留该行供续登或删除，不删除、不改 hasSession。
- **登录二维码关联**：组件在调用 `login` 前用 `crypto.randomUUID()`（缺失时回退到
  UUID v4 形状）生成 requestId 并先 `onQrcode` 订阅；只接收 `accountId` + `requestId`
  双匹配且 `sequence` 严格递增的事件。Promise 落定与组件卸载都真实退订并清除
  data URL；二维码只存在于组件内存，不写 store、不写 localStorage。同一渲染批次的
  重复登录点击由同步 ref 拦截；设置页登录进行中阻止切换标签或返回，结束后放行。
- **错误脱敏**：只消费主进程固定错误码，按仓内固定中文文案展示；主进程 message、
  平台原文、路径、Cookie / Token 不进入 store 与 DOM（`login_busy` 等亦可理解）。
- **显示安全**：显示名 / 归属人经 React 文本转义；C0/C1 控制符与 BiDi 方向控制 /
  隔离符（U+061C/200E/200F/2028–202E/2066–2069）替换为 U+FFFD 后展示，并始终附带完整
  UUID；对齐 A2-S2 验证文档第 26 条“A2-S3 需防视觉混淆”，不改变后端账号身份。
- **旧链隔离**：新页不引用 `publishAPI`、不传新 UUID 给 `publish:run`；旧账号页与旧
  发布工作台均显示“这里仍使用旧账号体系；新安全账号暂未接入发布”，且旧行为保留。

## 测试先行与主库复跑

测试先于实现编写：`accounts-v2-store.test.ts` 与 `accounts-v2-settings.test.tsx` 在
store / 组件文件创建前落盘；工作树缺依赖，**未观察到官方 Vitest RED 执行结果**，不将
“先写测试”的顺序冒充完整 RED→GREEN 证据。用例与验收标准对应：

- store：同平台同名两 UUID 各自成行且不写 localStorage；创建失败不新增且只返回固定
  中文文案；登录成功只更新目标 UUID；登录失败保留原 unknown 账号；检查只写目标 UUID；
  按 UUID 精确删除、删除失败不改状态；list 不按同名去重且失败保留内存状态；未知错误码
  归一到 `internal_error`；桥抛异常时不新增状态且只返回 `internal_error`。
- 设置页：同平台同名两行独立 UUID，删除只移除点选行；创建后登录失败保留账号、错误原文
  不进入 DOM；`login` 抛异常时真实退订 / 清除二维码 / 保留账号；二维码在 invoke 前订阅、
  跨账号 / 跨 requestId / 乱序过滤、Promise 落定与卸载退订清理；续登/检查只针对点选
  UUID 且 requestId 每次不同；请求中禁用冲突动作；`login_busy` 固定文案；BiDi 控制符
  安全展示 + UUID 身份；新账号操作全程零次旧 `publishAPI` 调用；新页 / 旧账号页 / 旧
  工作台三处未切换提示。

本工作树 `app/node_modules` 不存在。以下为真实执行的命令与结果（只记录事实，不把静态
检查冒充官方 Vitest / tsc）：

| 命令（cwd=`app`） | 结果 | 退出码 |
| --- | --- | --- |
| `node ./node_modules/vitest/vitest.mjs run tests/accounts-v2-store.test.ts tests/accounts-v2-settings.test.tsx` | `Error: Cannot find module .../node_modules/vitest/vitest.mjs`（`MODULE_NOT_FOUND`）→ **未运行** | 1 |
| `node ./node_modules/typescript/bin/tsc --noEmit --project tsconfig.json` | `Error: Cannot find module .../node_modules/typescript/bin/tsc`（`MODULE_NOT_FOUND`）→ **未运行** | 1 |

补充静态检查（工作树外只读工具，不作为官方验证）：

- `node --experimental-strip-types --check app/src/store/accounts-v2.ts` → 退出码 **0**。
- 以主库纯 JS 版 tsc 作为解析器对 7 个新增/修改 TS/TSX 代码文件（store、设置页组件、
  Settings 页、旧账号页、旧工作台、两套测试）做语法解析：无 TS1xxx 语法错误，剩余诊断
  均为工作树缺依赖导致的 `TS2307` / JSX 类型缺失级联。
- `git -c core.whitespace=cr-at-eol diff --check` → 退出码 **0**；5 个新增文件
  `git diff --no-index --check` 无空白告警。

Codex 将九个白名单路径选择性复制到依赖完整的主库 `bd5ab99` 后，以 Windows
Node 22.23.3 + 官方 Vitest v2.1.9 实跑：store **9/9**，界面套件首次 **9/10**。
唯一失败为测试中 `new URL(..., import.meta.url)` 在 jsdom/Vite 转换后不具有 `file:`
scheme，属于测试夹具路径定位；Codex 只把测试中的源码读取改为仓内既有的
`resolve(__dirname, ...)` 约定，界面套件随后 **10/10**、退出码 **0**。GLM 独立只读
审查未发现 P0/P1，提出 U+061C 展示净化与登录中切换标签两项 P2。Codex 另发现旧 list
快照可能覆盖同时创建的新账号；针对三项问题及重复点击，新增 4 个用例，先实跑为
**4 RED / 18 PASS**，再修复实现，聚焦套件为 **22/22**、退出码 **0**。主库
`tsc --noEmit --project app/tsconfig.json` 退出码 **0**。这些是合成交互/类型证据，
不是 Electron 真实窗口或真实平台账号验收。

## 证据分级

- 源码可见：是（上述 9 个路径即为全部编辑）。
- 自动化测试通过：**主库聚焦取得**（store 10/10、界面 12/12、`tsc` 0）；工作树自身缺依赖，未运行官方套件。
- 真实账号验证：未进行（本阶段只用合成账号 / 合成二维码，未调用真实平台）。
- 平台最终状态验证：未进行，也不在 A2-S3 范围内。

## 已知限制与后续门槛

- **单实例 / 跨进程安全**：Q2 单实例 gate 未验收前，本 UI 不得宣称跨进程安全。`publish-v2`
  registry 仍是读改写 + 原子 rename，无跨进程锁；完成 Q2-R3a 前不作为正式发行版验收。
- **新账号未接入发布**：发布工作台与旧账号页仍使用旧账号体系；旧 runner 对 UUID 目标的
  静默跳过保护属 A2-S4，本页仅做明确提示，不做行为改动。
- **二维码格式**：沿用 A2-S2 结论——未证明真实平台返回 PNG；若平台返回 JPEG/WebP，新闸门
  会安全拒绝为 `qrcode_failed`。真实四平台扫码首登/续登未验证。
- **仅内存 UI 状态**：新页账号列表来自 `list`，不持久化到浏览器；重启后由主进程 registry
  重新列出。列表若连续三次与本地改动交错，本次载入保留当前投影，需后续重新进入页面
  刷新。二维码 data URL 永不落盘 / 落 localStorage。
- **显示净化范围**：BiDi 净化只影响展示；主进程拒绝 C0/C1 但不拒绝 BiDi 控制符，账号身份
  仍以 UUID 为准。
- **真实 Windows `safeStorage` 跨重启解密、不同账号真实并发、平台页面行为** 均未验证；
  商品挂载与平台“原创”判定不在本阶段范围。

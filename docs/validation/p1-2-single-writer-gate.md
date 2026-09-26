# P1-2 单一写者门槛 Q2-R3a：Electron 产品入口单实例 gate（2026-09-26）

## Codex 主库复核结果

Codex 将 8 个白名单文件选择性纳入主库，并在 Windows Node 22.23.3 环境实跑：
`single-instance-gate` 10 项、`electron-vite-config` 5 项、Windows fixture 2 项，
合计 **17/17，退出码 0，无跳过**；`tsc --noEmit --project app/tsconfig.json`
退出码 **0**；`electron-vite build` 退出码 **0**。构建产物断言也通过：
`dist-electron/main.js` 仅有 gate 与 `Promise.resolve().then(() =>
require('./app-main.js'))` 晚加载，旧 `publish:list-accounts` / `account-v2` 标记
不在薄入口、只在 `app-main.js`；两个入口 `require` 同一个 gate chunk；
`preload.js` 与 `stealth.min.js` 存在，`package.json` 的 `main` 未变。

独立 GLM-5.3 只读审查未发现 P0/P1，提醒 asar 打包启动、调试模式 `app.relaunch()`
时序和 dev watch 尚未实测。构建产物实际使用延迟 `require`，消除了审查时针对
**原生** `import()` 在 asar 内解析的具体顾虑；但打包后产品启动仍单列未验证。
首轮 Windows fixture 虽报告 17/17，却用了约 121 秒，可能只是 owner 的 120 秒
TTL 自然退出。Codex 随即增加强制终止后 15 秒退出上限、排除 `owner-ttl-exit`
事件，并对递归删除的临时目录加绝对路径与名称前缀检查；复跑 17/17，真实
双进程用例约 1.5 秒，证明本次测试确实走了强制终止与重新取锁路径。

以下“未运行 / RED”表述记录的是 Qwen 候选工作树**交付时**的状态，不能覆盖上述
Codex 主库复核。R3b 的队列崩溃恢复、产品队列接线与真实账号发布仍未验收。

- 工作树：`/mnt/d/AI编程库/项目库/进行中的项目/zimeitijuzhen-ao-q2r3`，任务基线 SHA `9c20f02`
  （A2-S2 安全账号桥已接入 `main.ts`）。本环境权限系统拒绝执行 `git`，基线 SHA 未能在
  工作树内用 git 复核，以任务下发文本为准。
- 路由：`claude-bailian=qwen3.8-max` 单执行代理；未派生子代理；未提交、未推送、未部署、
  未真实发布/登录、未改依赖。
- **编排通道阻断声明**：`channel.py`（位于 `/home/canqu/.codex/...`，工作目录之外）在本会话
  被权限系统拦截，`event`/`ask` 均无法送达（4 次尝试均被拒）。阶段更新与澄清问答改由本
  记录与最终报告承载。任务执行期间没有遇到需要中止的语义歧义；所有设计决策均在任务
  Implementation guidance 的既定范围内。

## 改动文件（严格限于 8 项白名单）

| 文件 | 类型 | sha256 |
|---|---|---|
| `app/electron/single-instance-gate.ts` | 新增 | `1d6540f56d384530213db30c31b761096a4660049ffac93c4722cc6d8eaa3498` |
| `app/electron/single-instance-entry.ts` | 新增 | `9ec81655594a27765589797e74d9f187c65e0b1ad28a06ee89a4fd5e0d8ac0dd` |
| `app/electron/main.ts` | 最小编辑 | `8d1c4ed415ddfcbe2caa0ec54d368cff7aa6c8c32ed6bd560b2c9f1a3f87722c` |
| `app/electron.vite.config.ts` | 编辑 | `735efbf60ee4fe65ceb3e74899bfcdd34412d97b636befd223fa74e966aa7cda` |
| `app/tests/single-instance-gate.test.ts` | 新增 | `424891a926319ab646c77078716b6f0ed11e1652e2b2a718d5fd39f81253284d` |
| `app/tests/electron-vite-config.test.ts` | 更新 | `83a0f25828c4adea89198442c4706043f6386be29a9af6f52c55446e3b927b23` |
| `app/tests/single-instance.windows.test.ts` | 新增 | `426afc64b107b3e5fa488ffa4bbd3664d02a8fc6e96d85bdd714f920b361cf1c` |
| `docs/validation/p1-2-single-writer-gate.md` | 新增（本文件） | — |

未触碰（sha256 与 R1 验证记录逐字节一致）：

- `app/electron/publish/durable-queue.ts`：`11b3a1c0…498b75b`（同
  `p1-2-queue-instance-guard.md` 记录值）
- `app/tests/publish/durable-queue.test.ts`：`95c1a0d1…2447d0e`（同上，未改动）
- `app/electron/publish/ipc.ts`：`305e6691…47b7a1`（只读核查：旧仓仍懒构造，
  `registerPublishIpc` 仍只在 `main.ts` 顶层被调用——即只有 owner 进程会执行它）
- `app/package.json` / `package-lock.json`：未改动（`main` 仍为 `dist-electron/main.js`）

## 设计与顺序契约

1. **薄入口**（`single-instance-entry.ts`，main 构建入口 → 产物 `dist-electron/main.js`）：
   只静态导入 `electron` 的 `app` 与注入式 gate；对主运行时只有
   `loadMainRuntime: () => import('./main')` 一处运行时动态导入。不静态导入
   `./main`，因此 `main.ts` 顶层副作用（约 2800 行处的 `ipcMain.handle` 批量注册、
   `registerPublishIpc()`、`app.setName`、`app.whenReady` 调度，以及 whenReady 内的
   `bootstrapAccountsV2` → `<userData>/publish-v2` 构造）全部只在 lock owner 上执行。
2. **注入式 gate**（`single-instance-gate.ts`，零 electron 运行时依赖）：
   - loser：`requestSingleInstanceLock()` 为 false → 立即 `app.quit()`，绝不调用
     `loadMainRuntime`，绝不注册 `second-instance` 监听，不触碰任何 userData；
   - owner：先 `app.on('second-instance', …)`，再 `await loadMainRuntime()` 恰好一次；
     加载失败向上抛出，入口 `catch` 后 `app.exit(1)`（不静默保活半初始化进程）；
   - `registerSecondInstanceFocus` 注册表：主运行时加载后登记聚焦回调；
     second-instance 早于登记到达时安全忽略。
   - gate 不假设 Electron 锁作用域等同于 userData 路径（官方文档只保证锁取得布尔值、
     失败实例应退出、owner 收到 `second-instance` 事件）。
3. **main.ts 最小改动**：新增 gate 导入 + `registerSecondInstanceFocus` 回调
   （`isDestroyed` 防御 → `isMinimized` 则 `restore` → `show` → `focus`，与既有
   通知点击聚焦路径同构）。不新建第二主窗口；不改任何旧发布行为；不自持锁请求。
4. **构建配置**（`electron.vite.config.ts`）：main 目标改双入口
   `{ main: single-instance-entry.ts, 'app-main': main.ts }`，`formats: ['cjs']`，
   `fileName` 按入口名产出 `main.js` / `app-main.js`；显式
   `output.inlineDynamicImports: false`。**多入口在 Rollup 构造上禁止
   inlineDynamicImports=true**（会直接报错），因此「main.ts 顶层代码被 bundler
   提前压平进 main.js」只能显式构建失败，不可能静默发生——这是本方案对任务
   第 3 条风险的结构性防御。preload / renderer / external / stealth 复制插件均未动。

## 代理交付时的验证状态（候选工作树 0 项自动化测试被执行）

- 本会话按 RED-first 顺序创建文件：先写三个测试文件（对当时不存在的
  `single-instance-gate` / `single-instance-entry` 而言，import 解析必然失败 = 构造性
  RED），后写 gate / entry 源码与 main.ts / 构建配置改动。
- **但本工作树无 `node_modules`，且权限系统拦截一切 `node <script>` 执行**（含任务
  Validation 指定的三条命令与 `node --experimental-strip-types --check` 语法探针）、
  拦截工作目录外的一切访问（`~/.npm/_npx` 缓存 runner 不可探测）。按任务约束不安装、
  不复制、不链接依赖，因此：
  - `node ./node_modules/vitest/vitest.mjs run tests/single-instance-gate.test.ts tests/electron-vite-config.test.ts tests/single-instance.windows.test.ts`：**未运行**（node_modules 不存在 + 执行被权限拦截）；
  - `node ./node_modules/typescript/bin/tsc --noEmit --project tsconfig.json`：**未运行**（同上）；
  - `node ./node_modules/electron-vite/bin/electron-vite.js build`：**未运行**（同上）。未调用 `npm run build`（其 `clean:build` 会删除现有 dist；本工作树 `dist-electron/` 本就不存在）。
- 因此本轮全部产出的证据级别仅为 **源码可见**；「自动化测试通过」为 **RED/未验证**，
  必须由 Codex 在装有依赖的环境重跑。绝不把未运行写成通过。

### Codex 复核命令（预期结果）

```bash
cd app
node ./node_modules/vitest/vitest.mjs run \
  tests/single-instance-gate.test.ts \
  tests/electron-vite-config.test.ts \
  tests/single-instance.windows.test.ts
# 预期：gate 10 项 + config 5 项全绿；windows 文件中
# “fixture transpile pipeline” 1 项在 Node>=22.13 上运行，
# “Windows dual-process” describe 在 win32+electron 二进制齐备时运行 1 项，否则显式 skipped。

node ./node_modules/typescript/bin/tsc --noEmit --project tsconfig.json
# 预期 exit 0（新增 electron/*.ts 在 include 范围内；tests 不在 tsconfig include，与既有约定一致）

node ./node_modules/electron-vite/bin/electron-vite.js build
# 禁止 npm run build（clean:build 会删 dist）。
```

### 构建产物核验清单（build 后逐项检查）

1. `dist-electron/main.js` 存在且为薄入口：包含指向 `./app-main.js` 的**懒加载**
   （Rollup 4 CJS 输出默认 `dynamicImportInCjs:true` → 保留 `import('./app-main.js')`；
   若被转为 `Promise.resolve().then(() => require('./app-main.js'))` 同样满足晚加载）。
2. `dist-electron/main.js` **不得**包含 `main.ts` 顶层标记，例如：
   `grep -c "publish:list-accounts\|account-v2\|registerPublishIpc\|auto-run-telemetry" dist-electron/main.js`
   应为 0（这些字符串只允许出现在 `app-main.js` / 共享 chunk）。
3. `dist-electron/app-main.js` 存在，包含主运行时（上述标记应命中）。
4. gate 模块（`runSingleInstanceGate` / `registerSecondInstanceFocus`）应位于被
   `main.js` 与 `app-main.js` **共同 require 的同一 chunk**（grep 两文件中的
   `require('./chunk-*.js')` 交集），保证 focus 注册表是同一模块实例。
5. `dist-electron/preload.js`、`stealth.min.js` 照常产出；`package.json` `main` 不变。
6. `npm run build` 全链路（含 `scripts/obfuscate-build.cjs`）会把 `app-main.js` 与共享
   chunk 一并混淆（脚本递归收集 dist-electron 全部 .js）；混淆的字符串数组不改变
   `import()` 参数的运行时求值语义。本轮未运行该脚本，列为 Codex 复核项。
   打包脚本已只读核查：`scripts/package-mac-helpers.cjs` 的 `STAGED_PROJECT_ROOTS`
   含 `dist-electron`，`stageProjectFiles` 整目录复制 → `app-main.js` 与共享 chunk
   自动随包；`package-windows.cjs` / `package-mac.cjs` 的 `buildOutputs` 仅是
   main.js / preload.js 的存在性预检，二者仍照常产出，预检语义不变。
   Rollup CJS 输出无论保留原生 `import()`（`dynamicImportInCjs` 默认 true）还是转为
   Promise+require 包装，均为懒加载；两种形态在 Electron ≥28 的 asar 透明层内都可
   从 CJS 主入口加载（本轮未实测，列入构建核验）。
7. 若 electron-vite 5.0.0 / Vite 7.3.1 对多入口 lib 构建有任何默认值冲突，构建会
   **显式报错**而非静默内联；届时按任务要求通过问题通道报告构建证据，不得退回
   「`app.quit()` 后仍静态加载 main.ts」的伪门槛。

## Windows 真双进程测试（`tests/single-instance.windows.test.ts`）

- 机制：在 OS 临时目录生成无 BrowserWindow 的 fixture 应用（`package.json` +
  `fixture-main.mjs` + 用 Node 内置 `stripTypeScriptTypes` 从**真实**
  `electron/single-instance-gate.ts` 转出的 `single-instance-gate.mjs`），以仓内
  Electron 二进制（`node_modules/electron/path.txt` → `dist/electron.exe`，或
  `ELECTRON_BINARY_PATH` 覆盖）先后启动 owner / loser / third 三个真实进程。
  所有断言信号经 fixture 内 `appendFileSync` 同步写入 `events.jsonl`，不依赖
  stdout 管道在进程退出前的冲刷；临时数据全部位于 OS 临时目录，绝不触碰真实
  userData。
- 证明点（对应任务验收）：
  1. owner `gate-outcome`：`acquiredLock:true`、`loadedMainRuntime:true`，并写下
     `writer-constructed-<ownerPid>.flag`（模拟「写者已构造」）；
  2. loser `gate-outcome`：`acquiredLock:false`、`quitRequested:true`、
     `loadedMainRuntime:false`，退出码 0，事件流中**无任何**
     `main-runtime-load-start` / `main-runtime-loaded` / `second-instance-focus`，
     writers 目录**无** loser pid 的标记文件；
  3. owner 在 loser 启动后收到 `second-instance-focus`（即 `second-instance` 事件
     经 gate → focus 注册表送达）；
  4. owner 被 `taskkill /tree /force` 终止并退出后，第三实例
     `acquiredLock:true`（锁随 owner 退出可重新获取）；
  5. writers 标记文件 pid 集合 ⊆ {ownerPid, thirdPid}。
- 不依赖任何概率性 queue 并发测试；不构造 `DurablePublishQueue`。
- **显式 skip 语义**：`describe.skipIf(process.platform !== 'win32' || 无 Electron
  二进制 || Node < 22.13)`。本 WSL2 Linux 工作树上该 describe 必然 **skipped**；
  验证记录必须写「跳过」，不得写「通过」。跨平台保留一项
  「fixture transpile pipeline」测试：对真实 gate 源做 type-strip 并动态 import
  转出产物，验证 loser 语义（quit、不加载）在**将被 fixture 执行的同一份转出代码**
  上成立——这是源码级证据，仍不等于 Windows 双进程锁证据。
- 本工作树内该文件从未被执行（无 vitest / 无 Electron 二进制 / node 执行被拦截），
  状态：**RED/未运行**。

## 证据分级（按根 AGENTS.md 约定）

| 层级 | 状态 |
|---|---|
| 源码可见 | ✅ gate / 薄入口 / main.ts 最小改动 / 构建配置 / 三个测试文件 / 本文档均已落盘；顺序契约可由源码审读复核 |
| 自动化测试通过 | ✅ Codex 主库 Windows Node 22.23.3：聚焦 17/17、无跳过，`tsc` 与 `electron-vite build` 退出码 0；仅证明 Q2-R3a 门禁与构建产物，不涵盖 R3b / P1 |
| 真实账号验证通过 | ❌ 未验证（本任务不接触真实账号；fixture 不登录、不发布） |
| 平台最终状态验证通过 | ❌ 未验证（本任务不接触任何平台） |

## 红门与剩余风险（不得隐去）

1. **通用队列 API 仍跨进程不安全**：`DurablePublishQueue` 的读指纹→整文件 rename
   非跨进程 CAS 的事实不变；本轮产品入口门槛只约束「经该产品入口启动的 Electron
   进程」，**不得**表述为队列通用 API 跨进程原子/安全。CLI、sidecar、脚本或任何
   绕过薄入口的进程均可绕过本门槛；P1 接线时队列只允许在持锁 Electron main 内构造，
   其它写者形态需另行设计存储级锁（Q2-R3b 范围）。
2. **Windows 双进程门禁已实跑，但范围有限**：Q2-R3a fixture 的 owner / loser /
   second-instance / 锁重获路径在真实 Windows Electron 进程通过，含强制终止而非
   TTL 自然退出；它不覆盖产品打包后的入口与队列事务。锁作用域与 userData 路径的
   关系未做任何假设，也未验证。
3. **构建薄入口已实证，打包运行尚未实证**：electron-vite 5.0.0 + Vite 7.3.1
   多入口构建与晚加载 `require` 产物已核验；`npm run build` 混淆链、asar 打包应用
   启动、调试 `app.relaunch()` 与 dev watch 重启尚未运行，仍是产品发布前的检查项。
4. **崩溃/重启故障注入（Q2-R3b）未做**：owner 被强杀后的队列租约到期、
   `unknown_submission` 只核对不重发等路径不在本轮范围。
5. 二次启动聚焦回调在主运行时**加载完成前**到达时会被安全忽略（窗口尚不存在，
   无可聚焦对象）；这是设计内行为，不构成丢事件的产品缺陷，但如未来要求
   「加载期间的二次启动也必须在就绪后补聚焦」，需要另行排队该事件。
6. 远端核对、真实账号状态、平台最终状态、商品挂载资格与「原创」判定：本轮
   一律未验证、不承诺。
7. 环境事实：新增 5 个文件为 LF 行尾（本会话权限系统拦截了 `sed -i` / `node -e`
   等一切文件重写命令，无法转成仓库惯用 CRLF）；`main.ts` 与
   `electron.vite.config.ts` 的编辑保持了原文件 CRLF（`file` 复核无混合行尾）。
   仓库无 `.gitattributes`，此差异只影响显示/行尾一致性，不影响构建与测试。

## 复跑指引（Codex）

1. 在依赖齐备的 Windows 环境（官方 Node 22 ≥ 22.13、`npm ci` 后）执行上文三条命令；
2. 先跑 gate/config 单测（任何平台），再在 Windows 跑双进程测试（需
   `node_modules/electron/dist/electron.exe` 或设置 `ELECTRON_BINARY_PATH`）；
3. 执行 `electron-vite build` 并逐项过「构建产物核验清单」；
4. 对照 `p1-2-queue-instance-guard.md` 的红门清单更新 R3a 状态；R3b 与 P1 接线
   门槛保持独立红门，不因本记录降级。

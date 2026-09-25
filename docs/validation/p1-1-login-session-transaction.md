# P1-1 登录会话事务（`AccountVault.withLoginStorageState`）验证记录

输入基线：主库 `3ab2fff`（本工作树 detached HEAD 同点）。工作树：`zimeitijuzhen-ao-a1`（WSL2）。
本文档只覆盖**登录会话事务本身**：一个公共方法 + 配套测试。P1-1 整体（IPC 接线、
真实账号登录 / 探针 / 重登 / 删除端到端）**未在本 job 完成，也不因本 job 宣称完成**。

## 修复记录（2026-09-26，AO item-001 attempt 2）

- 第一个 30 分钟 AO job **超时**；候选实现、72 项聚焦测试与本文档初稿留在工作树（未提交）。
- Codex 在 Windows Node 22 独立复跑：**原 72/72 通过、`tsc --noEmit` 通过**。
- Codex 随后在 `accounts-v2.test.ts` 末尾追加 **2 个 RED 安全测试**：74 中 72 通过 / 2 失败。
  - RED-1：刷新路径的回调文件以旧 storageState 种子化；回调返回 `success:true` 但**未写任何
    输出**时，候选读取的是旧种子并照常轮换加密引用——把旧会话误当新登录（假成功）。
  - RED-2：回调 catch 分支把回调抛出的 `AccountVaultError` 原样上抛；回调可以**自建携带
    原文的 vault 错误**，Cookie / 临时路径随 message 离开保管库（泄露面）。
- 本次修复（仅改 3 个允许文件，RED 用例断言零改动）：
  1. `invokeLoginCallback` 在调用回调**前**对输出路径做逐字节快照（刷新路径快照即种子明文；
     新登录路径输出文件事先不存在，快照为 null）。`success:true` 后输出与快照**逐字节一致**
     （含"同内容重写"）即没有本次调用写出新输出的证据 → `invalid_storage_state`；抛出发生在
     清理作用域内，明文目录先被删除，既有账号元数据 / 加密字节 / sessionRef 全部不动。
     新鲜度判定不依赖 mtime / inode（Windows 时间戳粒度与惰性写入下不可靠）。
  2. 回调抛出的**一切**错误（包括回调自建的 `AccountVaultError`）统一包装为脱敏的
     `login_callback_failed`：原文不进 message；cause 仅保留匹配 `/^[A-Z0-9_]{1,32}$/` 的系统
     错误码（小写 vault 错误码不会进 cause）。回调**之外**抛出的 vault 错误
     （`session_missing` / `session_file_missing` / `cipher_unavailable` / `account_not_found`
     等）不经过该 catch，保留既有安全分类；清理失败优先级不变（finally 语义）。
  3. 追加 1 个针对性测试：同内容重写（`writeFileSync(p, readFileSync(p))` + `success:true`）
     → `invalid_storage_state`，registry 原文逐字段相等、唯一密文文件不变、临时目录零残留。
- 修复后套件预期：**75/75**（原 72 + Codex RED 2 + 本次追加 1）。

## 结论先行（诚实声明）

- **本修复会话（WSL）内 vitest、`tsc --noEmit`、`git -c core.whitespace=cr-at-eol diff --check`
  均无法执行**（精确阻塞见下节），因此本文档**不宣称测试通过**；所有通过 / 失败结论由
  Codex 在 Windows Node 22 环境独立复跑后作出。
- 离线正确性保障手段：对登录事务 describe 的全部 17 个用例（14 原有 + 2 RED + 1 新增）逐条
  人工推演了新实现下的断言路径（见"公共 API 与语义"）；改动只使用文件内既有 import
  （`readFileSync` / `existsSync` / `Buffer`），无新依赖、无公共签名变更。
- 第一个 job 遗留的 `app/.tmp/p11-smoke/` 冒烟脚本为**历史残留，不构成本次交付证据**；
  本次修复未创建任何新文件。

## 精确执行阻塞（一次性记录，未安装任何依赖）

1. 本会话 Bash 为窄白名单：`npm`、`npx`、`node -e`、`python3`（含 `-c`）、`sed`、`awk`、
   `git -c …`、`git config …` 一律 `This command requires approval`（无交互审批者，等同拒绝）。
   `node --version`（v22.22.3）可运行，但没有任何可执行的 runner 入口。
2. `app/node_modules` 是指向另一工作树（`…/zimeitijuzhen-ao-p0-1-opencode/app/node_modules`）
   的链接，沙箱拒绝跨出本工作树的目录枚举；结合第 1 条，WSL 内无法运行聚焦 Vitest 与 tsc。
3. 协调通道不可用：`channel.py event` 三次尝试（含禁用沙箱重试）均被权限系统拒绝，`ask`
   同样不可用；外部只读包 `/mnt/c/Users/canqu/…/ao-a1-login-transaction-packet.md` 与
   `/mnt/c/Users/canqu/…/ao-a1-repair-review-2026-09-26.md` 的读取也被拒绝。以仓内两个
   RED 测试为权威依据完成修复；裁量决策全部在本文档披露供 Codex 复核改判。
4. 裸 `git diff --check` 已运行：对**所有**新增行（含空行）报 "trailing whitespace"——这是
   仓库以 CRLF 落盘（blob 内含 CR）而默认 `core.whitespace` 未含 `cr-at-eol` 的既有全局
   现象，并非真实行尾空格；相关检查 `git -c core.whitespace=cr-at-eol diff --check`
   被权限拒绝，由 Codex 复跑裁定。

## Codex 复跑命令（Windows Node 22）

```bash
# app/ 目录下
node ./node_modules/vitest/vitest.mjs run tests/publish/accounts-v2.test.ts
node ./node_modules/typescript/bin/tsc --noEmit
# 仓库根目录下
git -c core.whitespace=cr-at-eol diff --check
```

预期：**75/75 通过**；`tsc` 退出码 0；diff --check 无输出。

## 变更范围（仅允许的 3 个文件）

| 文件 | 本次修复变更 |
| --- | --- |
| `app/electron/publish/accounts-v2.ts` | `invokeLoginCallback`：新增回调前逐字节基线快照（存在但不可读 → 回调前 `invalid_storage_state`）、`success:true` 后输出与快照逐字节比较（一致 → `invalid_storage_state`）、候选改以 Buffer 读取再 utf-8 解码；catch 分支移除 `if (err instanceof AccountVaultError) throw err`（回调错误一律包装 `login_callback_failed`）；模块头与两处方法注释同步更新。其余方法零改动 |
| `app/tests/publish/accounts-v2.test.ts` | 在 Codex 两个 RED 测试之后追加 1 个 `it`（同内容重写 fail closed）；RED 与原有 72 用例断言零改动、零弱化 |
| `docs/validation/p1-1-login-session-transaction.md` | 本文档（修复披露重写） |

`ipc.ts` / `runner.ts` / `accounts.ts` / `session-cipher-electron.ts` / preload / Renderer /
package / lock / 配置 / 主仓 / 其他工作树均未触碰。SHA-256（写入本文档时，代码两文件）：

```text
429a78c3ff485ec1932fb3230e7cf23f236261e8986124d9f6aafcf170d1a350  app/electron/publish/accounts-v2.ts
674c6f59e19541d887cd89776b90bba9e40714496e10d02e488ca15735da39ea  app/tests/publish/accounts-v2.test.ts
```

行尾：`git ls-files --eol` 两代码文件均 `i/crlf w/crlf`。说明：Codex 追加 RED 测试后工作树
一度为 `w/mixed`（追加行 LF）；本次修复经编辑工具把该文件整体归一回 CRLF，两个 RED 用例的
断言文本逐行未变（仅行尾统一），与仓库 `i/crlf` 约定一致。本文档自身为 LF（未跟踪新文件，
与初稿一致）。

## 公共 API 与语义（源码可见级）

```ts
async withLoginStorageState<T extends { success: boolean }>(
  accountId: string,
  loginCallback: (storageStatePath: string) => Promise<T> | T,
): Promise<T>
```

事务顺序（fail closed，任何一步失败都不触碰既有加密会话与元数据）：

1. **回调前拒绝**：未知账号 `account_not_found`；加密不可用 `cipher_unavailable`
   （不创建任何临时目录，回调零次执行——有测试断言 called === 0）。
2. **快照 `sessionRef`**（新账号为 null）。
3. **一次性临时路径**：
   - 无会话：`mkdtempSync(<tmpBaseDir>/login-*)` + `<dir>/storageState.json`，
     输出文件事先不存在，由平台登录写入；
   - 有会话：复用 `withDecryptedStorageState` 以旧明文种子化独立临时路径
     （清理重试 / `temp_cleanup_failed` 语义原样继承）。
4. **输出基线快照（修复新增）**：调用回调前 `readFileSync` 逐字节快照输出路径；
   文件存在却读不出基线时在暴露回调之前报 `invalid_storage_state`（新鲜度不可证明，
   先 fail closed）。
5. **回调**（可返回 Promise 或普通值）：结果必须是带**严格布尔** `success` 的对象；
   非对象或缺失 / 非布尔 `success`（含 truthy 的 `1`、`'true'`）一律 `login_result_invalid`，
   绝不当成功。回调抛出的**一切**异常（含回调自建的、message 携带原文的
   `AccountVaultError`）统一包装为 `login_callback_failed`——原始异常文本、临时路径、
   Cookie、平台返回体一律不进 message；cause 仅保留 `/^[A-Z0-9_]{1,32}$/` 的系统错误码。
6. **候选捕获与新鲜度核验（修复新增）**：仅 `success === true` 时把输出文件以 Buffer 读入；
   缺失 / 不可读 → `invalid_storage_state`；与第 4 步快照**逐字节一致**（回调未写任何输出，
   或做了同内容重写）→ 同样 `invalid_storage_state`，绝不把旧种子当作新登录轮换加密引用。
   候选明文即输出字节的 utf-8 解码文本，内容校验仍由 `saveStorageState` 统一执行。
   `success === false`：清理后**原样返回同一结果对象**（测试断言 `toBe` 引用相等）。
7. **清理先于提交**：临时明文目录经 `removeTempDir`（Windows EBUSY/EPERM 有界重试 5 次）
   删除；清理失败抛 `temp_cleanup_failed`（finally 优先级：取代任何回调侧错误上抛），
   **绝不提交**。
8. **并发防护**：清理成功后、同步 `saveStorageState` 之前重读账号；`sessionRef` 与快照
   不一致 → `session_changed`（不覆盖较新登录）；账号已被删除 → `account_not_found`。
   检查与提交之间无 await 点，单进程内不可打断。
9. **提交**：复用 `saveStorageState` 全部既有语义（JSON 结构校验 `invalid_storage_state`、
   加密、原子写、回读核验 `session_verify_failed`、registry 更新 `status: 'valid'` +
   `lastCheckedAt`、旧引用密文删除）。
10. **返回**：原始回调结果 `T`。临时路径绝不进入 registry 或账号元数据（测试对 registry
    原文断言不含临时路径 / `storageState.json` / Cookie 值）。

本次修复未新增错误码：复用 `invalid_storage_state`（输出缺失 / 非法 / 无新鲜度证据）与
`login_callback_failed`（全部回调错误）。错误码枚举本身零改动；`withDecryptedStorageState`、
`saveStorageState` 与迁移路径语义零改动。

## 登录事务测试套件（17 项）

原 58 项用例（元数据 / 加密仓 / 短时明文 / 删除隔离 / 迁移 / 崩溃清理 / 加密分类 /
清理重试 / fsync）零改动。登录事务 describe = 首个 job 14 项 + Codex RED 2 项 + 修复新增 1 项：

1–14.（首个 job，断言未动）新账号成功（同步回调）/ 刷新成功（异步回调，种子断言）/
刷新 `success:false` / 新账号 `success:false` / 回调抛普通 Error / 畸形结果 8 种 /
`success:true` 输出缺失 / `success:true` 输出非法 / 加密不可用 / 清理耗尽（EBUSY 注入，
5×2 次有界重试）/ 同平台同名两账号 / 并发替换（新账号）/ 并发替换（刷新）/ 未知 accountId。
15. **Codex RED-1**：既有会话回调声称成功却未写出新状态 → `invalid_storage_state`，账号
    逐字段等于登录前、旧密文字节不变、临时目录零残留。（修复前失败：旧种子被当作候选轮换入仓。）
16. **Codex RED-2**：回调抛出 message 携带 Cookie / 临时路径的 `AccountVaultError` →
    `login_callback_failed`，message 不含原文与临时路径、`cause` 为 undefined、临时目录
    零残留。（修复前失败：回调自建 vault 错误被原样上抛。）
17. **修复新增**：刷新时回调把种子逐字节复制回输出路径（同内容重写）并声称成功 →
    无新输出证据，`invalid_storage_state`；registry 原文逐字段相等、会话目录仅剩原密文、
    解密字节不变、临时目录零残留。

测试全部使用既有合成夹具风格（`storageStateFixture` / `FakeCipher` / `makeVault` 注入
`tmpBaseDir`、`now`、`removeDirSync`），无生产密钥、无真实 Cookie、无网络与浏览器调用。
离线测试只验证本模块事务语义；IPC 接线与真实平台登录验收不在本套件范围（见末节）。

## 裁量决策披露（ask 通道不可用，供 Codex 复核改判）

1. **【已修复，撤回初稿决策】回调错误一律包装**：初稿曾决定"回调抛出的 `AccountVaultError`
   保持原分类上抛"。该决策是 RED-2 的直接成因：回调可以自建携带任意 message 的
   `AccountVaultError`，与 vault 内部错误在类型上不可区分。现在回调内抛出的一切错误都按
   不可信输入包装为 `login_callback_failed`；vault 自身错误都产生于回调 try 块之外，
   分类不受影响。
2. **新鲜度证据 = 与调用前种子快照的逐字节比较**（不用 mtime / inode / ctime）：确定性、
   跨平台一致，不受 Windows 时间戳粒度与惰性写入影响。代价：真实登录若产出与旧密文
   **逐字节一致**的新状态会被拒绝——此时仓内已有完全相同的内容，无数据损失；Playwright
   storageState 含 Cookie 过期时间戳等字段，真实重登几乎不可能逐字节一致。同内容重写
   无法自证新鲜度，按任务指引 fail closed。
3. **输出文件存在但基线不可读 → 在暴露回调之前拒绝**（`invalid_storage_state`）：
   基线读不出则后续无法做新鲜度判定，先行 fail closed。
4. **清理失败优先级保持**：回调侧错误与临时目录清理失败同时发生时，`temp_cleanup_failed`
   经 finally 取代前者上抛——与既有测试"回调抛错且清理耗尽"一致；RED-1 的
   `invalid_storage_state` 抛出点位于清理作用域内，明文目录先删后报错。
5. 初稿其余披露（加密可用性在回调前检查、畸形结果抛错而非返回、`session_file_missing`
   复用、登录期间账号被删除 → `account_not_found`、新账号临时前缀 `login-`）继续有效，
   本次修复未改动。

## 安全 / 清理 / 并发假设

- 单 main 进程内串行调用 + 事件循环原子性是本事务并发防护的前提（registry 无跨进程锁，
  与既有 `p1-1-account-core.md` 的声明一致）；跨进程并发不在本 job 范围。同平台同
  displayName 的两个 UUID 账号各自持有独立临时目录与加密引用，互不影响（有测试断言）。
- 明文窗口 = 回调执行期间 + 清理重试期间；清理耗尽时明文可能残留于 OS tmp（显式报错，
  不静默），与既有 `withDecryptedStorageState` 风险声明一致。
- 候选明文在提交前只存在于内存 Buffer / 字符串；提交路径复用既有加密-回读核验。
- 错误 message / cause / 测试断言均不含临时路径、Cookie、Token、回调原文、storageState
  原文（负面断言逐条写入测试，RED-2 专门覆盖回调自建 vault 错误的泄露面）。

## 未实现 / 未验证（不因本 job 宣称完成）

- **未接线**：`ipc.ts` 仍走旧 `AccountStore` 明文链路（`publish:login` →
  `store.storageStatePath(platform, accountName)`），本方法当前零调用方；IPC / preload /
  electron-api / 设置页 UI 均由后续任务完成。**离线测试通过不等于 IPC 集成验收**。
- **未验证**：真实平台登录、真实浏览器、四平台真实账号、WSL 之外平台的清理重试行为。
  真实登录回调（如 Playwright `context.storageState({ path })`）正常会写出新的输出字节，
  与新鲜度校验兼容；若某平台模块"声称成功但不写文件"，将被显式拒绝——这正是契约意图。
- **未运行（本 WSL 会话）**：vitest（75 用例）、`tsc --noEmit`、
  `git -c core.whitespace=cr-at-eol diff --check`——全部因权限阻塞未执行（见"精确执行
  阻塞"）；裸 `git diff --check` 已运行，仅既有 CRLF 全局现象（见上）。**不宣称在 WSL
  跑过任何测试。**
- `app/.tmp/p11-smoke/` 为第一个 job 遗留的 git-ignored 历史残留，不作为本次交付证据；
  本次修复未新建任何文件。

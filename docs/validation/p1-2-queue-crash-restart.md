# P1-2 / Q2-R3b：Windows 双进程队列崩溃恢复验证

本记录针对主库 `3c912de` 的现有 `DurablePublishQueue` 实现新增一项**合成的**
Windows 故障注入测试。测试文件为 `app/tests/publish/durable-queue.windows.test.ts`；
队列生产源码未改。它验证强杀上传中的进程后，另一独立进程如何处理尚未到期与已到期
的租约；不触真实账号、视频、平台或网络。

## 测试机制

测试把仓内真实 `durable-queue.ts` 连同其契约依赖用现有 esbuild 打包到 OS 临时目录，
由当前 Node 二进制启动进程 A。A 用假 executor 领取合成普通视频任务，持久状态成为
`uploading`、`attempt:1`、`leaseUntil = START + 10000` 后，executor 挂起；父进程
等到 executor 进入事件，并直接读取磁盘确认已持久化，才对**本测试启动的 PID**发
`taskkill /tree /force`（失败时对该子进程用 `SIGKILL`），15 秒内确认退出。fixture
没有 TTL 自然结束路径，因此不能靠等待自然退出冒充强杀。

进程 B 随后用同一 storePath 和独立的进程内时钟打开：租约到期前 1 毫秒的一次
`tick()` 保持 `uploading`、不调用 executor/reconciler；恰好到期时的一次 `tick()`
转为 `unknown_submission`，历史含 `leased_upload_expired`，只调用假 reconciler
一次。假远端返回 `unknown`，最终仍为未知提交；B 的 executor 调用数为 0，
attempt 保持 1，`retryNow` 固定拒绝 `invalid_transition`。这体现“提交可能已发生时
先核对，不能盲重发”的本地状态机，不证明真实平台已发布或远端核对可用。

全部 fixture、store 和事件日志位于 OS 临时目录。递归清理前校验解析后的绝对路径
确是 `tmpdir()` 直接子目录且名字以 `lingji-q2r3b-` 开头。传给两个子进程的环境只含
启动 Node 所需的少数 OS 键和合成 fixture 路径，不继承 API Key 等其他环境变量；
事件与结果不写凭证、媒体正文或原始异常。非 Windows 平台该真双进程用例会显式
skip，不能把 skip 计为通过。

## Codex 主库复核

从独立工作树仅复制新增测试到主库 `3c912de` 后，在 Windows Node 22.23.3
与仓内官方 Vitest v2.1.9 运行：

| 检查 | 结果 | 含义 |
| --- | --- | --- |
| 新增双进程故障注入 | 1/1，退出码 0，未跳过 | 真正强杀 A、重开 B，未发生自动重发 |
| 合跑新增项、原持久队列 41 项、Q2-R3a Electron 单实例 2 项 | **44/44**，退出码 0，未跳过 | 同一 Windows 环境兼容旧状态机，并单独保留产品入口 loser 不加载写者的证据 |
| `tsc --noEmit --project app/tsconfig.json` | 退出码 0 | 项目源码类型检查；测试文件不在该 tsconfig 的 include 内，由 Vitest 转译运行 |
| 变更范围与 whitespace | 仅本测试和本文两项，`git diff --check` 退出码 0 | 无生产队列源码变动 |

此项测试起始为**覆盖缺口**：已有单进程重开测试先前是 GREEN，没有制造虚假的
RED 源码失败。新增 Windows 故障注入首次实跑即 GREEN；若未来把租约到期改为直接
重发、打开时清掉租约或允许未知提交 `retryNow`，此测试会失败。

GLM-5.3 只读审查未发现 P0/P1，确认 fixture 的强杀、持久化、独立进程与无重发断言
不存在明显假阳性。它指出原版 `finally` 中等待子进程退出一旦超时，会跳过临时目录
清理并遮蔽最初的断言失败。Codex 改为对清理等待使用 `Promise.allSettled`、始终尝试
受路径守卫保护的目录删除，并优先保留原始失败；修改后上述三个套件复跑仍为
**44/44**、无跳过。审查另指出测试文件不属于项目 `tsconfig` 的 include，本页的
类型检查证据只覆盖项目源码，不能代替测试文件本身的独立类型检查。

## 证据边界与后续门槛

- **源码可见**：进程 B 的逻辑是现有队列 `tick` 的租约回收与远端核对状态机；
  未改队列通用 API。
- **自动化测试通过**：上表 Windows 独立进程和 Electron 门禁 fixture 均实跑，
  仅使用合成任务和假 executor/reconciler。
- **真实账号验证**：未进行；无真实登录、授权、上传或吞吐压测。
- **平台最终状态**：未进行；`unknown_submission` 不是平台已发布或失败的结论。

`DurablePublishQueue` 的“读磁盘指纹 → 临时文件 rename”不是跨 OS 进程原子 CAS。
本测试是**先强杀 A、再启动 B**的串行恢复，不能用它宣称两个同时写同一 store 的
通用 API 安全。产品层必须只允许持锁 Electron main 构造队列写者；Q2-R3a 的
薄入口门禁已有单独 Windows 证据，但尚未把队列接到产品自动发布入口。打包产品的
asar 启动、真实平台远端核对、权限与频率限制、商品挂载和投稿最终状态仍需各自验收。

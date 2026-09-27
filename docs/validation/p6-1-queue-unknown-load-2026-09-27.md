# P6-1 千任务未知提交与重开核对测试（2026-09-27）

用户要求先测试、暂不打包。本轮在 Windows、Node v22.23.3、主库 `2a8243b` 上新增显式负载测试 `app/tests/load/durable-queue-unknown.load.ts`，以四个平台各 25 个模拟账号、每账号 10 个视频版本生成 1000 条持久发布任务；所有媒体引用和远端结果都是本地合成值，没有真实账号、平台请求或商品挂载。

| 阶段 | 实测结果 | 边界 |
| --- | --- | --- |
| 模拟提交不确定 | `global=8`、`device=8`、每平台 2、每账号 1；提交执行器峰值 8。125 轮后 1000 条任务均为 `unknown_submission`，每条尝试次数为 1、模拟提交次数为 1。 | 执行器直接返回 `unknown/simulated_timeout`；没有真实网络超时、进程崩溃或断电。 |
| 持久 store 重开 | 用同一路径新建队列对象，仍读到 1000 条 `unknown_submission`；重开后再 tick，先经注入的核对器确认，未调用第二次提交。 | 在同一 Node 测试进程中重开对象，不等于操作系统进程重启。 |
| 批量核对与终态 | 模拟核对器按任务 ID 返回 `published` 与远端 ID。125 轮后 1000 条均为 `published`，每条核对次数为 1、提交次数仍为 1；再次打开 store，1000 条终态仍在。 | “远端已发布”完全是测试桩结果，不证明任何平台真实发布或其查询接口能可靠返回远端 ID。 |
| 时间 | 250 轮，共 152,425 ms。 | 包含本机 JSON 持久化与零网络测试桩，不能外推为平台吞吐。 |

执行 `vitest run --config vitest.load.config.ts tests/load/durable-queue-unknown.load.ts --reporter=dot`：**1/1 通过**，无跳过，整体用时 153.52 秒。产品源码 `tsc --noEmit --project tsconfig.json` 退出码 0；该配置不包括测试文件，因此另对本测试文件执行 TypeScript 6 的 `tsc --ignoreConfig --noEmit --target es2022 --module esnext --moduleResolution bundler --types node --esModuleInterop --skipLibCheck`，退出码也是 0。运行日志保存在被 Git 忽略的 `data/runtime/validation/durable-queue-unknown-load-2026-09-27.log`，SHA-256：`0E21D6843B1C02B6EBF917EF512D9311C916B7404DC63C6F9399FD555D97C223`。测试自己的临时 store 在系统临时目录，仅在核对固定前缀与父目录后清理。

这项测试关闭本地千任务规模“未知提交 → store 重开 → 只核对不盲发”的场景。P6-1 的同规模限流、进程崩溃/断电、长期运行与真实平台速率仍待验证；产品主进程目前也没有真实平台队列调度接线。遵照用户要求，没有打包。

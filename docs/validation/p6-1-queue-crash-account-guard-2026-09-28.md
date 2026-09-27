# P6-1 同账号不确定提交守卫与千任务进程退出测试（2026-09-28）

用户要求先测试、暂不打包。本轮只验证本地持久发布队列，所有账号、视频引用、提交结果与远端 ID 均为合成数据；未登录或调用任何平台，也未创建安装包。

## 发现与修复

原队列只用当前进程的 `running` 集合和单轮 `busyAccounts` 限制同账号并发。进程退出后，磁盘上仍有 `uploading` 租约或 `unknown_submission`，新实例的 `running` 为空；下一轮可能先领取同账号的另一条任务，并占掉原任务的核对名额。

先新增两项回归测试，分别复现“未知提交时先提交同账号下一条”和“重开后未到期上传租约未挡住下一条”，两项均按预期失败。随后仅在领取阶段把存在 `uploading` 或 `unknown_submission` 的账号暂缓；这类任务仍进入原有租约恢复 / 远端核对流程。已收到明确远端 ID 的 `verifying` 继续按既有调度规则运行。确认核对完成后，同账号下一条任务可继续领取。原有队列单元测试 **43/43 通过**。

## 离线负载证据

| 测试 | 实测结果 | 限制 |
| --- | --- | --- |
| `durable-queue-unknown.load.ts` | 100 个模拟账号 × 10 个版本，共 1000 条任务；重开时 96 条未知提交、904 条排队；逐账号核对推进到 1000 条 `published`，每条提交和核对各一次，本地提交峰值 8；12 轮首段提交、238 轮后续处理，127,026 ms。 | 同一 Node 测试进程中重开对象；远端核对由测试桩立即返回成功。旧记录 `p6-1-queue-unknown-load-2026-09-27.md` 描述的是修复前“1000 条同时未知提交”行为，不能用于当前版本。 |
| `durable-queue-abrupt-exit.load.ts` | 独立 Node 子进程领取 8 条并原子落盘后，在结果未知时以状态码 73 退出；主测试重开同一 store，在租约到期前没有重发这 8 条或提前提交其同账号任务。到期后 8 条只经核对，另 992 条各提交一次；1000 条最终均为 `published`，本地提交峰值 8；248 轮、137,129 ms。 | 是强制进程退出，不是断电或真实平台请求；“远端成功”由合成核对器返回。 |

验证命令（`app/` 目录）：

```powershell
node ./node_modules/vitest/vitest.mjs run tests/publish/durable-queue.test.ts --reporter=dot
node ./node_modules/vitest/vitest.mjs run --config vitest.load.config.ts tests/load/durable-queue-unknown.load.ts --reporter=dot
node ./node_modules/vitest/vitest.mjs run --config vitest.load.config.ts tests/load/durable-queue-abrupt-exit.load.ts --reporter=dot
npx tsc --noEmit --project tsconfig.json
npx tsc --ignoreConfig --noEmit --target es2022 --module esnext --moduleResolution bundler --types node --esModuleInterop --skipLibCheck tests/load/durable-queue-unknown.load.ts tests/load/durable-queue-abrupt-exit.load.ts tests/load/fixtures/durable-queue-abrupt-exit.ts
```

上述三组测试分别为 **43/43、1/1、1/1 通过**；产品与新增负载测试的 TypeScript 检查退出码 0。测试临时 store 位于 OS 临时目录，清理前核对绝对父目录与专用前缀；仓库中没有录屏、会话或发布产物。

默认全集另用 `node ./node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=2 --reporter=dot` 运行：**394 个文件通过、2974 项通过、4 项跳过、0 项失败**。`npx electron-vite build` 退出码 0；这是源码构建，不是 Windows 安装包或产品发布。

Codex 已复查本轮变更范围与暂存 diff。指定的 GLM 只读路由此前返回 429，本轮未反复发起无效作业；独立外部审查仍待补，不把本地测试当成该审查结论。

P6-1 整体仍未关闭：同规模真实限流 / 网络超时组合、断电、长时运行、产品主进程平台适配器接线，以及四平台真实账号速率与最终状态仍需分层验收。未知提交若持续无法确认会保持等待核对或人工处置，不能为提升吞吐而盲重发。

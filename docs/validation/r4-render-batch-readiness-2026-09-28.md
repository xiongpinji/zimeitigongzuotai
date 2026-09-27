# R4 批量渲染前置验证（2026-09-28）

源码基线 `199b19e`。当前“先测试，不打包”持续有效。R4 独立版本工程已存在，但批量渲染、复核和产品入口仍未实现；安全账号到新发布队列的通道还依赖这些可信产物和主进程活动授权。完整细化计划见[R4 任务 5/6](../superpowers/plans/2026-09-28-r4-render-batch-orchestration.md)，B1 的精确合同见[批量渲染任务](../plans/2026-09-28-r4-render-batch-task.md)。

## 新增取消端口红灯

`node app/scripts/probe-remotion-abort-port.cjs` 在 Windows 退出 1，测试当前 `electron/remotion/render.ts` 的真实函数，仅把 `@remotion/renderer` 替换成本地接口探针。没有启动浏览器、编码媒体、访问平台或调用视频模型。探针没有改生产模块，也没有抛异常掩盖断言；四种情况均运行到底并形成可读结果。

| 情况 | 当前观察 | 门槛 |
| --- | --- | --- |
| 开始前 signal 已 abort | 仍选择 composition，仍调用编码端口，Promise 正常返回 | 未通过，应在副作用前拒绝。 |
| selectComposition 返回时 abort | 仍调用编码端口，Promise 正常返回 | 未通过，应在选中后阻止编码。 |
| 编码端口开始时 abort | 没有传 cancelSignal，cancel 调用 0，编码模拟正常返回 | 未通过，应贯通 Remotion 取消端口并等待编码调用落定。 |
| 不提供 signal 的旧调用 | 选择与编码各调用 1 次并完成 | 通过，保持旧用法兼容。 |

证据保留在 Git 忽略的 `app/data/runtime/validation/r4-abort-port-yWiynk/result.json`，两次运行结果一致。`node --check app/scripts/probe-remotion-abort-port.cjs` 退出 0。源码与 probe 只证明取消接口未连接，不能用本地模拟证明真实 Chromium/FFmpeg 被终止；真实合成编码的中途取消与进程清理是后续验证要求。这个红灯是批量功能实现前新覆盖的行为，和[上一轮全量测试通过](prepackage-source-validation-2026-09-28.md)不矛盾：当时没有覆盖 AbortSignal 端口。

## 并发和恢复待实现

`renderVideoHeadless` 每次默认使用 `cpuCount - 2` 的帧并发，批量调用不能让两版各占几乎全部核心。打包态还会 `process.chdir` 到共用 Remotion 缓存再在 finally 恢复，两个在途调用存在全局工作目录交叉的风险。因此 B1 明确要求两个 batch worker 上限、可选的帧并发预算、打包态调用串行保护、真实取消端口、每版状态/产物哈希、来源再次核验，以及重启遇到不确定输出不自动重渲染。

任务合同已通过 `validate-task`（12,882 bytes，无问题）。桌面应用的受管工作树工具返回 `Not a git repository`，本聊天目录是 projectless；因此按工具不可用的后备路径，在 WSL 创建隔离工作树 `/home/canqu/work/zmt-r4-render-batch-20260928`，基线干净、HEAD `199b19e`。Codex 预先提供被忽略的 Linux 依赖链接，Vitest CLI 版本探针通过；执行者不得创建依赖链接或扩展文件范围。

Agent Orchestrator 持久计划为 `plan-20260927-231131-ae6e7c`。Qwen 作业 `claude-bailian-20260927-231228-ccc0d3` 约 5.5 秒后因百炼月额度 429 终止，工作树无候选差异。DeepSeek 作业 `opencode-bailian-20260927-231357-3d6eaf` 在同一干净基线启动，达到 420 秒上限后终止为 `timed_out`（实际约 421 秒，exit -15）；stdout/stderr 均为 0 bytes，终态工作树仍干净，无候选差异。GLM 保持只读角色，没有转作实现。

`executor-options` 把 GLM 列为未尝试，并显示形式上的 `exhausted: false`；这不扩大用户指定的只读权限。两条可写路由均已有终态，后续没有自动重派或暗中接管。已在当前聊天及持久请求 `feedback-20260927-232537-6af974` 提出同一个 R4 B1 执行者选择：按已落库六文件合同由 Codex 直接实现并验证、保持原路由仅测试，或等待用户提供新的实现路由。该请求仍待用户答复，未把此前 Q2 的直接接管授权扩展到 R4 B1。运行时账本、问题文件与私有看板 token 不进入 Git。

本记录不标记 B1、R4、R5、R6 或阶段一完成。R2 原生预览红灯与新账号发布接线缺口仍按既有记录保留，安装包、真实录屏和平台动作尚未执行。

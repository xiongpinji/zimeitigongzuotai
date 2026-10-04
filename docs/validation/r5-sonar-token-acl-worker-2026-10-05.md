# R5 首次 MCP 启动 ACL 修复作业核查（2026-10-05）

用户的“先测试、不打包”约束持续有效。本轮主库 `91e18cce74ecac68975f07a13c0c301b1cc66cd8` 与 `origin/main` 一致；`app/electron/sonar/token.ts`、`app/tests/sonar-token.test.ts` 和此前通过全量源码测试的 `9f7f647` 没有差异。专用 WSL 工作树 `/home/canqu/work/zmt-r5-sonar-acl-20261005` 为干净的 `8ab5f86` 基线，Codex 仅预置被忽略的 Linux 测试依赖链接。当前没有接受任何业务修复差异。

## 真实 Windows 红灯

在主库 `app/` 下执行 `npx electron-vite build` 退出 0，只生成源码构建产物，没有打包。随后在仓库根运行默认 `node app/scripts/smoke-production-mcp-win.cjs` 退出 **1**：项目盘内全新隔离 home 的 MCP 状态 `running=false`，启动错误为 `sonar_token_acl_failed`；探针等待服务时还得到 `probe_condition_timeout`。后者是服务未启动后的等待结果，不改变初始 ACL 错误。证据在 Git 忽略的 `data/runtime/validation/r5-mcp-1791132553896/`。探针不使用真实账号、录屏、平台或付费模型，现有真实 `.lingji` 文件只读取元数据。

[旧诊断](r5-mcp-runtime-surface-2026-09-28.md)表明给**自建空 token 文件**预先准备受保护的当前用户 DACL 后，现有 MCP 工具可经真实协议调用；这个条件式通过不是默认首次启动修复。新任务要求测试文件 Owner 保持、受保护 DACL 仅允许当前用户，以及失败前不写 token。

## 固定路由的当前终态

新 R5 子计划为 `plan-20261004-170037-d60a47`，只含 `item-001`，任务范围固定为 token 源码与测试两文件。其[计划](../superpowers/plans/2026-10-05-r5-sonar-token-acl-orchestration.md)和[主任务合同](../plans/2026-10-05-r5-sonar-token-acl-task.md)已入库；主任务合同通过 `validate-task`，专用工作树在派发前干净、Linux Vitest 可用。第一次 Qwen CLI 派发因该 profile 不支持 `max_turns` 在参数校验阶段拒绝，没有创建作业或改文件；去掉该参数后才形成下表的真实作业。

| 作业 | 权威状态与输出 | 结论 |
| --- | --- | --- |
| `claude-bailian-20261004-170340-8ce6e3`，`qwen3.8-max` | `failed`、exit 1、约 9 秒。Provider 返回 429，称 token-plan 一个月额度已耗尽，给出 `10-22 16:00:00 UTC` 重置时间；模型用量 0。stderr 另有 `unrecognized_model` 诊断，不把这条独立警告当成已证实根因。 | 0 候选改动。重置时间是供应商本次响应，不是已验证的未来可用性保证。 |
| `opencode-bailian-20261004-170746-81f330`，`bailian-token-plan-personal/deepseek-v4.1-flash` | `timed_out`、exit -15、约 242.5 秒；stdout/stderr 均 0 bytes，运行期间有心跳，无待答问题。CLI 的 `opencode run --help` 可退出 0，仅证明参数入口可用。 | 0 候选改动。超时原因未证实；不能据此推定额度不足、模型输出已生成或源码已修改。 |

两次作业之后，`executor-options` 对此子项返回 `exhausted=true`、`untried=[]`、`unresolved_attempts=[]`，策略为 `request_user_approval`。工作树仍干净，`git diff --check` 退出 0；没有 worker diff 可供 Codex 审查或合入。GLM 路由仍只读，不能填补写入作业。全量测试、Windows 新回归和严格 MCP 绿灯均未因文档提交而重新成立。

下一步是按[备用任务合同](../plans/2026-10-05-r5-sonar-token-acl-deepseek-task.md)和两文件安全边界选择执行者；只有收到明确的 Codex 接管授权、用户确认重试经验证恢复的指定写入路由，或用户指定新路由，才继续实现。R2/R4 的原执行者问题及 R1–R6 完整目标仍保留；本轮不关闭 R5，更没有安装包或真实平台结果。

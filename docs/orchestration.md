# Agent Orchestrator 执行约定

## 当前状态

2026-09-25 已完成本机看板复用和三个自定义 CLI profile 的只读 `choices`/`catalog`/`doctor` 检查，均显示可用。P0-1 的前两轮 job 分别受 Claude Code 非交互权限和 Windows 创建的工作树在 WSL 下的 Git 路径影响，均未导入源码；Codex 已记录 `repair_required`。后续使用 WSL 创建且经 `git status` 验证干净的工作树。看板 URL 含本机私有 token，只在当前会话提供，不写入仓库。

阶段一持久计划 ID：`plan-20260925-034739-8a0572`（16 项，P0-1 仍待验收）。旧计划 `plan-20260925-032413-08fcab`（17 项、含已延期的商品实现）仅为历史账本；后续仅从阶段一计划派发任务，不使用旧计划的 checklist。

首个 P0-1 的[固定源码与 Windows 基线任务契约](plans/2026-09-25-p0-1-lingji-baseline.md)已准备并通过本地 `validate-task`；执行约束已明确，可在重新检查当前工作树、路由与任务合同后派发。持久计划是创建时的不可变快照，后续确认记录见[决策日志](decisions/2026-09-25-phase1-approval.md)。

用户已确认 [阶段一范围](phase1-scope.md)、[组件组合图](integration-map.md) 与[验收](roadmap-and-acceptance.md)，见[确认记录](decisions/2026-09-25-phase1-approval.md)。用户已撤销先前的 4000 Credits 上限，当前无硬性预算上限；不把逐项账单核对作为派发门槛。仍须限制每个 job 的范围和运行时间，并在任务状态不明时先查询，避免重复启动或无意义消耗。CLI 的 `cost=0` 不代表阿里云 Credits 为零。

## 固定路由与责任

| 角色 | Agent Orchestrator profile / 精确模型 | 允许范围 |
| --- | --- | --- |
| 总指挥 | 当前 Codex 任务 | 需求决策、任务拆分、集成、独立 diff/测试复核、最终验收和 Git 交付。 |
| 主实现 | `claude-bailian=qwen3.8-max` | 共享契约、核心队列/账号、跨模块实现；一次只领取一项可审查任务。 |
| 并行实现 | `opencode-bailian=bailian-token-plan-personal/deepseek-v4.1-flash` | 与主实现互不重叠的高光、索引、独立平台适配器或测试包。 |
| 只读审查 | `qwen-code-review=glm-5.3` | 审阅指定 SHA/diff、报告可复现问题和验收缺口；不修改文件。 |

`recommend-executors` 只是候选排序，不能把 `qwen-code-review` 自动转成写代码的执行者。任务合同要固定精确 CLI、模型、工作树、可改路径、依赖和测试。两条实现路由至多 2 个并行任务；审查在可审查的提交或工作树快照后进行。共享文件有依赖时串行执行。

## 启动及审查门槛

1. 用户确认方案与执行约束后，Codex 对当前 HEAD、`AGENTS.md`、适用源码和 `plan-checkpoint` 再检查；有新的平台规则或上游版本则复核。
2. 按持久计划 checklist 写独立任务合同，先运行 `validate-task`；任务合同需包含完整目标、文件范围、接口、边界、测试、禁令和报告要求。
3. 使用 Agent Orchestrator 按精确模型启动，任务目录放进独立工作树；执行 Agent 不提交、不推送、不部署。等待一次，后续按状态变化查看事件，问题通过看板/通道处理。
4. Codex 对每项完整 diff 做范围和安全检查、独立跑测试；高风险任务交 `qwen-code-review` 只读复审。写入 `record-review` 后才解除依赖项。
5. 本机代码验收、真实账号验收、平台最终状态和公开发布分别记录。任何成本/状态未知时停止自动重试，先核对记录。

本仓库的 [阶段一持久计划文件](plans/2026-09-25-phase1-core.md) 是目标与任务分解的版本控制副本；早期的[全量计划](plans/2026-09-25-product-delivery.md)仅作历史记录，其商品任务不得派发。运行时账本、job 日志与私有 dashboard token 位于 WSL 用户的 Agent Orchestrator 状态目录，不进入 Git。

## 2026-09-28 R4 任务 4 细化账本

阶段一 `item-011` 的历史任务过宽且旧候选已失败；当前 R4 时间线与版本工程采用[明确限定的子计划](superpowers/plans/2026-09-28-r4-task4-orchestration.md)，持久计划 ID 为 `plan-20260927-180216-0aae04`。它细化原阶段一目标，不把旧计划标为完成，也不扩大用户批准的三条模型路由。Qwen 主实现因百炼月额度 429 未产生改动；DeepSeek 并行任务运行约 10 分钟无输出或改动后依用户的节约时间要求取消；Codex 沿用用户此前对失败路由的直补选择，完成两项源码和离线测试。GLM 只读审查同样在读取代码前因 429 失败，因此该子计划的外部审查闸门仍未通过。详细证据见[任务 4 验证报告](validation/r4-timeline-version-projects-2026-09-28.md)。

## 2026-09-28 打包前源码复测

用户的“先不打包，我们先测试”仍有效。当前源码 `9f7f647` 的低并发全量测试、类型检查、源码构建和隔离桌面/合成编码结果见[本轮测试记录](validation/prepackage-source-validation-2026-09-28.md)：2974 项通过、4 项跳过、0 项失败，但 R2 原生预览逐帧门槛仍退出 1，新账号到发布页、R4 批量渲染/产品入口和 R5 全流程接线等验收缺口保留。未据此解除产品交付或真实平台验收闸门，没有生成安装包或执行平台动作。

## 2026-09-28 R4 批量渲染前置验证

在 `199b19e` 基线上新增[取消端口严格探针](../app/scripts/probe-remotion-abort-port.cjs)，三种 AbortSignal 情况均为红灯，旧调用兼容检查通过。它验证当前 Remotion 端口未连接取消信号，没有启动浏览器或编码媒体。[批量渲染到产品接线细化计划](superpowers/plans/2026-09-28-r4-render-batch-orchestration.md)和[六文件 B1 合同](plans/2026-09-28-r4-render-batch-task.md)已落库，持久计划 ID 为 `plan-20260927-231131-ae6e7c`。

Qwen 实现作业因月额度 429 失败；DeepSeek 达到 420 秒上限后超时，两者均无候选改动。GLM 仍只读。R4 B1 执行者选择已在聊天和持久反馈 `feedback-20260927-232537-6af974` 请求用户决定；没有自动接管。当前证据与明确未完成项见[前置验证报告](validation/r4-render-batch-readiness-2026-09-28.md)。

## 2026-09-28 R5 MCP 运行时测试

Codex 独立增加[真实本地 MCP/桌面入口探针](../app/scripts/smoke-production-mcp-win.cjs)。项目盘全新隔离 home 的首次启动因 `sonar_token_acl_failed` 退出 1；在自建空 token 文件上准备严格 DACL 后，真实协议可返回 31 个工具并完成合成工程创建、打开和 Renderer 状态读取。准备条件不构成产品修复，九类生产动作仍未接通，R5 未关闭。详细范围、权限对照与证据见[MCP 运行时报告](validation/r5-mcp-runtime-surface-2026-09-28.md)。

## 2026-09-28 R6 账号限流停派测试

在 `dea18f7` 业务基线上新增[账号限流严格探针](../app/scripts/probe-publish-account-cooldown.cjs)。四个平台标识分别测试同对象限流、重新打开 store 后的限流和未知提交对照，共 12 个场景。单任务 retry-after 与等待时间持久化通过；账号级停派 8 个场景均失败，未知提交守卫 4 个对照通过。完整脚本退出 1，没有修改业务代码、启动平台适配器或打包。

这些结果来自真实通用队列和模拟执行器，当前返回契约没有限流作用域，不能称为四平台真实限流验证。现有千任务容量/进程退出证据没有重复运行，R6-P 整体验收继续保留。时间码、代码原因和后续门槛见[账号限流停派报告](validation/r6-account-cooldown-readiness-2026-09-28.md)。

## 2026-09-28 剩余源码执行者集中选择

重新核查主库和账本后，R2/R4 的执行者反馈仍为 pending，两条 R4 写入作业均为终态，没有活动实现任务。本次将已复现的预览、批量渲染、MCP 初始化、账号冷却及后续产品接线汇总为[一次剩余源码执行者选择请求](decisions/2026-09-28-source-repair-executor-request.md)。该文件是可审查范围，不是批准记录；等待明确答复后才改变执行者。GLM 仍只读，打包和真实平台操作保持用户当前约束，阶段一完整验收目标保留。

## 2026-10-05 R5 首次 MCP 启动 ACL 作业

在当前源码构建通过后，默认隔离项目盘首次启动仍报 `sonar_token_acl_failed`。新 R5 子计划 `plan-20261004-170037-d60a47` 的两文件合同已落库，Qwen 主作业因供应商 429 失败，DeepSeek 备用作业在 240 秒上限后超时；两者都没有候选改动，`executor-options` 报告写入池耗尽。没有把 CLI 安装状态或条件式预置权限测试算作生产修复。具体命令、退出码、证据边界与待处理项见[本轮核查](validation/r5-sonar-token-acl-worker-2026-10-05.md)。R5 仍未完成，R1–R6 完整目标和不打包约束保持。

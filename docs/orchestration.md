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

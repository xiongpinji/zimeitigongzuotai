# Agent Orchestrator 执行约定

## 当前状态

2026-09-25 已完成本机看板复用和三个自定义 CLI profile 的只读 `choices`/`catalog`/`doctor` 检查，均显示可用。**没有派发开发任务，也没有因此产生百炼模型调用。** 看板 URL 含本机私有 token，只在当前会话提供，不写入仓库。

本项目首先等待用户确认 [架构](architecture.md)、[验收](roadmap-and-acceptance.md) 与实际 Credits 风险预算。此前即使持久计划存在，也不得 `launch`。过去其他项目或连通测试的 100 Credits 不是本项目默认预算；CLI 的 `cost=0` 也不代表阿里云 Credits 为零。

## 固定路由与责任

| 角色 | Agent Orchestrator profile / 精确模型 | 允许范围 |
| --- | --- | --- |
| 总指挥 | 当前 Codex 任务 | 需求决策、任务拆分、集成、独立 diff/测试复核、最终验收和 Git 交付。 |
| 主实现 | `claude-bailian=qwen3.8-max` | 共享契约、核心队列/账号、跨模块实现；一次只领取一项可审查任务。 |
| 并行实现 | `opencode-bailian=bailian-token-plan-personal/deepseek-v4.1-flash` | 与主实现互不重叠的高光、索引、独立平台适配器或测试包。 |
| 只读审查 | `qwen-code-review=glm-5.3` | 审阅指定 SHA/diff、报告可复现问题和验收缺口；不修改文件。 |

`recommend-executors` 只是候选排序，不能把 `qwen-code-review` 自动转成写代码的执行者。任务合同要固定精确 CLI、模型、工作树、可改路径、依赖和测试。两条实现路由至多 2 个并行任务；审查在可审查的提交或工作树快照后进行。共享文件有依赖时串行执行。

## 启动及审查门槛

1. 用户确认方案与预算后，Codex 对当前 HEAD、`AGENTS.md`、适用源码和 `plan-checkpoint` 再检查；有新的平台规则或上游版本则复核。
2. 按持久计划 checklist 写独立任务合同，先运行 `validate-task`；任务合同需包含完整目标、文件范围、接口、边界、测试、禁令和报告要求。
3. 使用 Agent Orchestrator 按精确模型启动，任务目录放进独立工作树；执行 Agent 不提交、不推送、不部署。等待一次，后续按状态变化查看事件，问题通过看板/通道处理。
4. Codex 对每项完整 diff 做范围和安全检查、独立跑测试；高风险任务交 `qwen-code-review` 只读复审。写入 `record-review` 后才解除依赖项。
5. 本机代码验收、真实账号验收、平台最终状态和公开发布分别记录。任何成本/状态未知时停止自动重试，先核对记录。

本仓库的 [持久计划文件](plans/2026-09-25-product-delivery.md) 是目标与任务分解的版本控制副本；运行时账本、job 日志与私有 dashboard token 位于 WSL 用户的 Agent Orchestrator 状态目录，不进入 Git。

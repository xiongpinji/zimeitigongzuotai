# P0-1 固定源码导入：OpenCode 修复任务合同

> 绑定阶段一计划 `plan-20260925-034739-8a0572` 的 `item-001`。第一轮 `claude-bailian / qwen3.8-max` 于 2026-09-25 因非交互权限层拒绝外部源码读取与 Bash 命令，零改动结束；Codex 已独立核对并记为 `repair_required`。本轮仅修复可执行的源码导入与来源记录。Windows 安装、测试、构建及编辑/导出烟测由 Codex 在审查阶段独立完成，不能因本轮导入成功宣称 P0-1 完成。

# Objective

在隔离的 Git 工作树中把已审阅的 Lingji Cut 固定提交 `59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1` 的 tracked 源码导入本仓库 `app/`，保留原始许可证和锁文件，并写出来源、许可证、子模块与忽略文件记录。不得修改导入的业务源码、锁文件或仓库其他方案。

# Why

本仓库当前仍无产品源码。P0-1 是后续多账号、剪辑、高光和任务队列的共同桌面基线。首轮失败是执行环境的权限问题，不能据此改用其他上游版本或把空仓库标为已完成。本轮走 WSL 内的 Git archive 复制路径，避免把 `.git`、缓存、未跟踪文件或私有数据带进产品仓库。

# Scope

允许新增 `app/**` 和 `docs/third-party/lingji-cut.md`；其他路径只读。工作树初始应干净，`app/` 应不存在。若源 SHA 不符、工作树重叠变脏、命令权限再次被拒绝、许可证不符、归档失败，立即停止并报告，不循环尝试权限升级或换来源。禁止修改 `AGENTS.md`、阶段一计划、Agent Orchestrator 状态、任何凭证、Git 远端和上游检出。

# Files to inspect

- 工作树根目录 `AGENTS.md`、`README.md`、`docs/source-selection.md`、`docs/integration-map.md`、`docs/plans/2026-09-25-p0-1-lingji-baseline.md`，确认已批准的基座和 P0-1 最终验收层级。
- 只读上游 `C:\Users\canqu\Documents\Codex\2026-09-24\new-chat\work\lingji-cut`，WSL 路径为 `/mnt/c/Users/canqu/Documents/Codex/2026-09-24/new-chat/work/lingji-cut`。核对 `git rev-parse HEAD`、`LICENSE`、`package.json`、`package-lock.json`、`.gitignore`、`.gitmodules`、`AGENTS.md`。上游 SHA 必须严格等于 `59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1`。
- 导入后的 `app/AGENTS.md` 只作为 `app/**` 的适用约定读取；若与本合同或根目录规则冲突，停止并向 Codex 报告。

# Implementation guidance

- [ ] 步骤 1：在隔离工作树执行只读 `pwd`、`git status --short`、`git rev-parse HEAD`、`test ! -e app`，再核对只读上游完整 SHA 与许可证。若工具权限不足，**在这一步就结束**，不要重复同一失败命令或产出空文档。
- [ ] 步骤 2：确认工作树绝对路径确为本项目的隔离 Git 工作树后，用 WSL 原生命令 `git -C "$sourceRepo" archive --format=tar --output="$archivePath" "$sourceSha"` 从固定提交创建临时归档，其中 `$sourceRepo` 为上述 WSL 路径，`$archivePath` 位于系统临时目录。检查退出码后创建原先不存在的 `app/` 并用 `tar -xf "$archivePath" -C app` 提取；检查退出码。不要复制整个上游目录，不使用 `git clone` 或更新上游，不运行递归清理。简单临时归档文件可在确认导入后删除。
- [ ] 步骤 3：核对 `app/LICENSE`、`app/package.json`、`app/package-lock.json` 与上游提交字节一致，记录上游 tracked 文件数量和导入后可见文件数量；若 gitlink 不经 archive 展开，记录官网子模块 `lingji-cut-homepage` 的状态。上游的 `.claude/skills/lingji-script-edit/SKILL.md` 和 `.claude/skills/lingji-video-edit/SKILL.md` 是被其 `.gitignore` 匹配的已跟踪文件，归档后在本仓库可能显示为被忽略的未跟踪文件；明确列出，留给 Codex 集成时逐个审核与强制纳入。不要因 `git status` 隐藏它们就宣称导入完整。
- [ ] 步骤 4：在 `docs/third-party/lingji-cut.md` 写原始仓库 URL、完整 SHA、Apache-2.0、archive 导入方式、许可证路径、原始业务源码未修改、子模块与两个 Skill 文件的状态，以及 Windows 基线尚待 Codex 独立验证的事实。
- [ ] 步骤 5：运行 `git diff --check`、`git status --short`，列出新增范围并核查无 `.git`、`node_modules`、构建产物、账号会话、Token 或用户素材进入差异。因任务范围只包含导入与来源记录，本轮**不运行** `npm ci`、`npm test`、`npm run build`、`npm run dist:win`；Codex 在审查阶段于 Windows PowerShell 逐项运行并写 `docs/validation/p0-1-windows.md`。本轮也不更新 README 的“当前状态”。

# Constraints

只使用 `opencode-bailian=bailian-token-plan-personal/deepseek-v4.1-flash` 的这一项执行 job；不得自行派生子 Agent、切换模型、追加任务或修改账号配置。不得登录平台、发布内容、调用产品云端 AI、部署、提交、推送、发版、改锁文件、升级依赖，或使用 `git add .`、`git reset`、`git clean`。不得递归删除或移动仓库路径。权限拒绝不是业务失败；一次明确拒绝后停止并交回 Codex。所有文件、素材与凭证仍遵守根 `AGENTS.md`。

# Acceptance criteria

1. `app/` 含固定 SHA 的 tracked 桌面应用源码和原始许可证、锁文件；没有第三方 repo 的 `.git`、缓存或构建输出。
2. `docs/third-party/lingji-cut.md` 明确来源、许可证、导入方法、官网子模块和两个被忽略的已跟踪 Skill 文件；没有冒充 Windows 验收或四平台真实账号能力。
3. `git diff --check` 通过，变更仅在允许路径；若工具拒绝或导入失败，明确给出失败点和零/部分改动状态，不给出“已完成”的结论。
4. 完整 P0-1 只有在 Codex 独立做 Windows `npm ci`、测试、构建、安装包定位、启动、编辑与导出验证后才能验收。本轮成功只解除源码导入阻塞。

# Validation

先核对两个工作树状态与固定 SHA；导入后核对关键文件字节、上游归档条目和 `app/` 目录内容，运行 `git diff --check` 与 `git status --short`。不得以 OpenCode 自己的报告代替 Codex 的 Windows 验证。

# Final report

报告实际工作树路径和 HEAD、上游 URL/SHA/许可证、导入文件数、关键文件字节核对结果、子模块与两个 Skill 文件状态、变更路径、实际运行命令/退出码、未运行的 Windows 验证、任何权限拒绝或剩余风险。不要提交或推送。

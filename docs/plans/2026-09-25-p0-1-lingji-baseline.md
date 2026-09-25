# P0-1 灵剪固定源码与 Windows 基线实现计划

> 面向 Agent Orchestrator 的单项任务契约。只在本项目百炼 Credits 上限明确后派发；执行者不得自行派生子 Agent、提交或推送。本文按仓库现有 `docs/plans/` 约定保存。

**目标：** 将 Lingji Cut 固定快照作为 `app/` 桌面基座导入，保留来源/许可，并取得可复核的 Windows 安装、测试、构建证据；Codex 随后独立进行启动、编辑与导出验收。

**架构：** 上游源码完整放在 `app/`，现有项目方案文档留在仓库根目录；后续功能以这个桌面应用为唯一时间线和发布入口。P0-1 不改上游业务行为，基线失败要原样记录，供 Codex 决定下一项修复。

**技术栈：** Electron、React、Remotion、TypeScript、Vitest、npm；Windows PowerShell 本机已核对 Node `v24.17.0`、npm `11.13.0`、Git `2.54.0`。

# Objective

在独立工作树中从 `yoqu/lingji-cut` 的 `59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1` 导入可追溯源码到 `app/`，生成来源与 Windows 基线报告。仓库现有阶段一方案、Agent Orchestrator 计划和商品挂载范围保持不变；这个任务不实现多账号队列、高光或商品功能。

# Why

当前仓库只有方案文档，尚无产品源码。Lingji Cut 已有 Electron 编辑器、Remotion 导出和四平台发布入口；但其发布代码串行、账号会话仍为 JSON、无每账号视频版本矩阵，因此先锁定一个可构建、可测试的基线，再在后续 P0-2/P1 等任务中改造。固定 SHA 当前与上游 `HEAD` 一致（2026-09-25 只读核查）；若执行时上游改变，仍用上述已审阅 SHA，不自行升级。

# Scope

允许新增 `app/**`（上游源码快照）、`docs/third-party/lingji-cut.md`（来源/许可与排除项）、`docs/validation/p0-1-windows.md`（实际命令和结果）；允许更新根目录 `README.md` 中的本地安装入口。`app/` 当前不存在，执行前确认它仍不存在且工作树没有他人改动。导入上游的 `LICENSE`、`package.json`、`package-lock.json`、`.npmrc`、`.gitignore` 和必要构建资源；不要导入上游 `.git`、`node_modules`、构建输出或私有数据。上游 `lingji-cut-homepage` 是 gitlink 子模块，仅为官网来源，不作为桌面应用构建前置；若归档时出现该空目录或嵌套 `.gitmodules`，记录其状态，不递归清理其他路径。上游已有两个被自身 `.gitignore` 匹配的**已跟踪** Skill 文件：`.claude/skills/lingji-script-edit/SKILL.md`、`.claude/skills/lingji-video-edit/SKILL.md`。归档后它们在本仓库会是被忽略的未跟踪文件，执行者必须在报告中列出，Codex 集成时单独审核是否强制纳入，不能因 `git status` 看不到就误称快照完整。

禁止修改根目录 `AGENTS.md`、`docs/plans/2026-09-25-phase1-core.md`、其他方案文件、Git 远端或 Agent Orchestrator 状态。不要登录平台、发布内容、填写 API Key、运行付费推理、部署或发版。不要为使测试变绿而升级依赖或改动上游业务代码；碰到需要改锁文件、许可证或行为的情况，停止并通过问题通道交给 Codex。

# Files to inspect

- 根目录 `AGENTS.md`：预算与安全门槛、执行者禁令。`README.md`、`docs/source-selection.md`、`docs/integration-map.md`、`docs/plans/2026-09-25-phase1-core.md`：已确认范围、固定 SHA 和 P0-1 退出条件。
- 上游只读检出 `C:\Users\canqu\Documents\Codex\2026-09-24\new-chat\work\lingji-cut` 的 `package.json`、`package-lock.json`、`LICENSE`、`.gitignore`、`.gitmodules`、`AGENTS.md`、`CLAUDE.md`：确定构建命令、源头许可、排除产物与适用的上游指引。该检出的 `git rev-parse HEAD` 应为 `59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1`；如不是，停止并报告。
- 上游 `electron/publish/runner.ts`、`electron/publish/accounts.ts`、`electron/publish/types.ts`：只为理解基线限制和报告，不在 P0-1 改动。`package.json` 的现有脚本是 `test`、`build`、`dist:win`。
- `app/` 内导入后的同名文件：确认复制与固定 SHA 一致，检查上游 `AGENTS.md` 对 `app/**` 的指引；不得将上游 release workflow 移到仓库根 `.github/`。

# Implementation guidance

- [ ] **步骤 1：核对基线。** 在执行工作树检查 `git status --short`、根目录 `AGENTS.md`、`app/` 是否不存在；核对只读上游检出的 SHA、许可证和包管理脚本。若源 SHA 不符、目标已有内容或工作树存在重叠修改，停止并问 Codex，不覆盖。
- [ ] **步骤 2：导入固定源码。** 在 Windows PowerShell 的任务工作树根目录使用下列命令；任务执行前再次确认路径及其解析结果都位于该工作树内。归档放在系统临时目录，不写进 Git：

  ```powershell
  $sourceRepo = 'C:\Users\canqu\Documents\Codex\2026-09-24\new-chat\work\lingji-cut'
  $sourceSha = '59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1'
  $targetDir = Join-Path (Get-Location).Path 'app'
  if (Test-Path -LiteralPath $targetDir) { throw 'app already exists; stop and ask Codex' }
  if ((git -C $sourceRepo rev-parse HEAD).Trim() -ne $sourceSha) { throw 'source SHA changed; stop and ask Codex' }
  $archivePath = Join-Path ([IO.Path]::GetTempPath()) "zimeiti-lingji-$sourceSha.tar"
  git -C $sourceRepo archive --format=tar --output=$archivePath $sourceSha
  if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
  New-Item -ItemType Directory -Path $targetDir | Out-Null
  tar -xf $archivePath -C $targetDir
  if ($LASTEXITCODE -ne 0) { throw 'tar extract failed' }
  ```

  只从上游仓库提取 tracked source；不要复制整个检出，避免带入 `.git`、本地缓存或未跟踪文件。检查归档中子模块 gitlink 和 `app/.gitmodules` 的状态；不要递归清理任何已有目录。
- [ ] **步骤 3：写来源记录。** 检查 `app/package.json`、锁文件和 `app/LICENSE`；用 `git ls-files -ci --exclude-standard` 核对上游被自身忽略的已跟踪路径。在 `docs/third-party/lingji-cut.md` 写上游 URL、完整 SHA、Apache-2.0、导入方法、官网子模块与两个 Skill 文件的状态、导入时上游业务文件改动为零。若构建确需该子模块或许可与快照不符，停止并问 Codex。
- [ ] **步骤 4：安装依赖。** 在 Windows PowerShell、工作目录 `app/` 运行 `npm ci`，记录实际版本、退出码、耗时和错误摘要。不使用 `--force`、`--legacy-peer-deps` 或锁文件重写。
- [ ] **步骤 5：运行自动测试。** 若安装成功，在 `app/` 运行 `npm test`，将 Vitest 结果写入 `docs/validation/p0-1-windows.md`；失败则不写通过。
- [ ] **步骤 6：运行构建。** 若依赖可用，在 `app/` 运行 `npm run build`；再运行 `npm run dist:win`。逐条记录实际退出码、产物路径和失败摘要；依赖前置步骤失败时，后续命令标为未运行，不静默跳过。
- [ ] **步骤 7：更新入口说明。** 根目录 `README.md` 增加 `app/` 来源、准确本地运行/测试命令与基线报告链接。只描述实际通过的层级；打包成功不代表四平台真号登录/发布或编辑器人工烟测已通过。
- [ ] **步骤 8：审查交接。** 执行 `git status --short`、`git diff --check` 和变更范围审查。Codex 后续独立核对导入字节、许可、构建、Windows 应用启动、样例时间线编辑与导出；执行 Agent 的报告不构成 P0-1 最终验收。任务若遇到不确定状态，不自动重试付费或平台操作，本任务不需要这些操作。

# Constraints

遵守根目录及导入后 `app/AGENTS.md` 的适用指引。仅允许本契约的文件范围；不得编辑账号凭证、项目素材或 `userData`。不得 `git add .`、`git reset`、`git clean`、递归删除/移动仓库路径、提交、推送、发版、部署、修改远端或本机模型配置。不要增设模型、修改预算或派生原生子 Agent；所有派发、重试与升级由 Agent Orchestrator 和 Codex 管理。Windows 的 `npm ci` 可能下载依赖，但不得调用云端 AI 或平台账号。

# Acceptance criteria

1. `app/` 含固定 SHA 的可追溯源码、原始 `LICENSE` 与原始锁文件；导入方法、官网子模块和被忽略的两个已跟踪 Skill 文件写入 `docs/third-party/lingji-cut.md`，无上游 `.git`、`node_modules`、凭证或构建缓存进入 Git 差异。
2. `docs/validation/p0-1-windows.md` 对四条验证命令逐项给出实际结果、退出码与产物位置；失败必须保留原始错误摘要，不写“已通过”。根 README 只引用已证实的能力。
3. Windows `npm test` 与 `npm run build` 成功才宣称自动化基线通过；`npm run dist:win` 成功且产物可定位才宣称安装包构建通过。应用启动、编辑器修改和导出必须由 Codex 另做烟测后才能关闭 P0-1。
4. `git status --short` 的改动仅在允许路径；工作树未产生账号会话、API Key、平台作品或发布动作。若因环境或上游缺陷无法通过，交出可复现故障与最小下一步，而非扩大任务范围。

# Validation

先在工作树根执行 `git status --short` 和 `git diff --check`，并核对上游 `git rev-parse HEAD`。导入后，在 Windows PowerShell 的 `app/` 中执行：`npm ci`、`npm test`、`npm run build`、`npm run dist:win`；再回到根目录执行 `git diff --check` 和 `git status --short`。预计 `npm test` 调用 Vitest，`npm run build` 调用 Electron Vite，`npm run dist:win` 包含 CLI、Remotion 与 Windows 打包；必须以实际退出码为准。不要运行平台登录/发布脚本、开发模型 API 调用、`git push`、GitHub Release 或任何生产部署命令。

# Final report

报告导入的上游 URL/SHA/许可证、变动文件与路径总数、所有测试/构建命令的退出码和产物路径、失败原文要点、导入快照是否有任何修改、排除子模块状态、未完成的 Windows UI 烟测及剩余风险。若无法遵守任何指引或需要改动锁文件/业务代码，明确指出并使用问题通道请求 Codex 决策；不得把自己的完成报告写成已经通过 Codex 最终验收。

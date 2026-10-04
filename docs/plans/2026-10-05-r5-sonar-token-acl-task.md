# Objective

修复 Windows 项目盘全新隔离 home 中 Sonar token 首次权限收紧失败。保持 token 文件 Owner，建立仅当前用户的受保护 DACL，之后才读取/写入 token。只交两文件的源码和回归测试，不打包。工作树基线 `8ab5f868d4788a4d444f8b6acf9d780caaa0ef9d`。

# Why

2026-10-05 Codex 从主库当前源码构建后执行默认 `node app/scripts/smoke-production-mcp-win.cjs`，退出 1：隔离项目盘 home 的 MCP `running=false`，启动错误 `sonar_token_acl_failed`，记录在 `data/runtime/validation/r5-mcp-1791132553896/`。产品 PowerShell 脚本先创建 `FileSecurity`，再设置 Owner 与 DACL；自建空文件的 DACL-only 对照已经成功。现有 `sonar-token.test.ts` 只使用系统临时盘，无法覆盖该问题。

# Scope

只允许修改：

- `app/electron/sonar/token.ts`
- `app/tests/sonar-token.test.ts`

不得修改 MCP 工具注册、主进程、Renderer、打包配置、依赖、锁文件、AGENTS、其他测试、私有用户文件或其他工作树。若必须扩范围，先通过 job question channel 向 Codex 提出具体理由，不能自行改写任务白名单。

# Files to inspect

- `AGENTS.md`、`app/AGENTS.md`、`app/CLAUDE.md`：凭证/权限、证据分层与 worker 限制。
- `app/electron/sonar/token.ts`：固定 PowerShell 脚本及“收紧后才读取/写入 token”的顺序。
- `app/tests/sonar-token.test.ts`：原有 9 例、Windows ACL helper、POSIX 跳过和失败不写入测试。
- `app/scripts/smoke-production-mcp-win.cjs` 与 `docs/validation/r5-mcp-runtime-surface-2026-09-28.md`：今日默认首次启动红灯及准备自建空 token DACL 的诊断对照。只读，不改探针。

# Implementation guidance

1. 先在 `sonar-token.test.ts` 加 Windows 专用行为用例：在项目根 `data/runtime/validation/` 下创建唯一前缀的**自建**子目录与空 token；记录初始 Owner，调用真实 `getOrCreateSonarToken`，断言 Owner 未变、DACL 已保护、允许规则仅当前用户、token 格式有效。测试要实际调用 Windows `powershell.exe` 读 ACL，不能只匹配源码字符串；失败时记录 RED。清理前校验目录绝对父路径和前缀，且只删除此测试创建的目录。不得访问真实用户 token。
2. 仅对 `WINDOWS_RESTRICT_ACL_SCRIPT` 做解决上述失败所需的最小调整。不要通过放宽继承、保留其他可访问 ACE、跳过权限异常、把明文写入提前，或无条件重置 Owner 换取通过。若 DACL-only 方案不适用于此条件，先报告观察和限制，再提出修复；不得假定诊断对照已经证明所有 Windows 安装卷。
3. 旧 `getOrCreateSonarToken(file)` API、已有 token 复用、POSIX `chmod(0600)`、execFile 固定 argv + 路径环境变量与错误码 `sonar_token_acl_failed` 均保持。错误消息/日志不可含 token、私有路径或原始 PowerShell stderr。

# Constraints

- 团队其他人可能并行工作；不要回滚别人的更改。只在分配的工作树编辑这两个文件。执行 Agent 不得派生子 Agent、不提交/推送、不打包、不修改凭证、不执行真实平台操作。

# Acceptance criteria

- 新 Windows 项目盘测试在原代码可复现失败、修复后通过；新文件 Owner 保持，受保护 DACL 仅当前用户有允许规则。
- 原 9 个 token 测试不倒退（其中 POSIX 用例在 Windows 按条件跳过），不可用的 PowerShell 仍拒绝写 token。
- Codex 集成后，默认真实 Electron/MCP 首次启动探针不需要 `--prepare-token-fixture` 即可通过，能完成已有合成工程协议调用；无真实账号、媒体、发布或付费模型动作。
- 若 worker 环境不能运行 Windows ACL 测试，明确报告未运行；不能用 Linux 通过冒充 Windows 验收。

# Validation

在 worker 工作树 `app/` 中，若现有依赖可用，运行聚焦 `tests/sonar-token.test.ts` 与 `tsc --noEmit`；若不可用，说明缺口，不自行安装依赖或建立链接。核对 `git diff --check` 和仅两文件的 diff。Codex 会在 Windows 主库独立运行新回归测试、默认 MCP 严格探针、相关全量回归、类型检查及 `electron-vite build`。不运行 `electron-builder` 或平台/模型任务。

# Final report

列出准确改动文件、失败前与修复后的测试命令/退出码、未运行的 Windows/产品验收、Owner/DACL 安全边界、残余风险及需 Codex 复核之处。不得声称 R5 整体、安装包或平台验收完成。

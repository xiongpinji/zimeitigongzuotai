# Objective

在现有干净 WSL 工作树中修复 R5 Windows 首次 Sonar token ACL 初始化失败。精确基线 `8ab5f868d4788a4d444f8b6acf9d780caaa0ef9d`。只交一项可复核结果：项目盘新建空 token 可安全收紧权限，然后现有 MCP 入口能启动。用户要求先测试、不打包。

# Why

Codex 于 2026-10-05 从当前源码构建后运行默认 `node app/scripts/smoke-production-mcp-win.cjs`，退出 1，报 `sonar_token_acl_failed`。现有 Windows 单元测试在系统临时盘通过，未覆盖项目盘。PowerShell 对照显示新建 `FileSecurity` 只写受保护 DACL、保留 Owner 可成功；产品脚本还调用了 `SetOwner`。Qwen 对同一子计划的作业 `claude-bailian-20261004-170340-8ce6e3` 在读取任务前返回月额度 429、0 输出 token，工作树无差异。因此本作业是已批准池内未尝试的 DeepSeek 路由，不重做 Qwen 作业。

# Scope

仅允许修改 `app/electron/sonar/token.ts` 与 `app/tests/sonar-token.test.ts`。先增 Windows 项目盘合成夹具测试，运行可执行的 RED，再最小修复权限命令。真实用户目录、MCP 工具注册、主进程、浏览器、依赖、锁文件和其他模块都不在范围内。确需扩围时通过作业问题通道提出，不自行修改。

# Files to inspect

- `AGENTS.md`、`app/AGENTS.md`、`app/CLAUDE.md`：协作与凭证边界。
- `app/electron/sonar/token.ts`、`app/tests/sonar-token.test.ts`：仅有的可改业务/测试文件。
- `app/scripts/smoke-production-mcp-win.cjs`、`docs/validation/r5-mcp-runtime-surface-2026-09-28.md`：Windows 失败条件与最小对照，只读。

# Constraints

- 团队还有其他工作树与协调者；不得回滚他人改动，不得派生子 Agent、提交、推送、打包、部署、修改凭证或访问真实账号/平台/媒体。
- 新测试只在项目根 Git 忽略的 `data/runtime/validation/` 下创建唯一目录；清理前验证绝对父目录与固定前缀。不得读取真实 `~/.lingji` 内容或在报告中显示 token。
- Windows token 必须先把 ACL 收紧为“受保护、仅当前用户允许”，再读取或写入内容；文件 Owner 不应因修复被重设。保留已有 token 复用、POSIX 0600、固定 `execFile` argv、路径环境变量以及失败时不写 token 的行为。不放宽 ACL 来换取绿灯。
- `app/node_modules` 已由 Codex 提供被忽略的 Linux 依赖链接；不要改动该链接、装包或增加依赖。不得把 Linux 跳过 Windows 用例当成 Windows 通过。

# Implementation guidance

1. 在 `sonar-token.test.ts` 构造项目盘自建空 token；用真实 PowerShell 读取收紧前后 Owner 和允许规则。断言行为和文件内容，不能仅匹配命令字符串。
2. 先执行环境允许的失败验证；Windows ACL 测试若在 Linux 条件跳过，须原样报告，不声称 TDD 已在 worker 环境完成。Codex 的 Windows 默认 MCP 探针已提供源码基线 RED。
3. 仅修改生产权限脚本的必要步骤。诊断对照提示多写 Owner 可能导致拒绝，但实现仍须用实际 ACL 结果验证，不能把推测当作成功。
4. 运行聚焦回归和类型检查，保留准确退出码与完整可审查 diff。

# Acceptance criteria

- 新 Windows 项目盘测试在旧实现能复现异常，修复后确认 Owner 未变、DACL 受保护、允许 SID 列表只有当前用户，新 token 正确落盘。
- 旧 token/失败不写入/POSIX 用例保持；没有原始 PowerShell stderr、token 或私有路径泄露。
- Codex 独立复核后，默认真实 Electron/MCP 严格探针无需 `--prepare-token-fixture` 通过；该验证由 Codex 在 Windows 主库完成。R5 全流程工具和四平台验收不由本小任务关闭。

# Validation

在工作树 `app/` 内运行可用的 `node node_modules/vitest/vitest.mjs run tests/sonar-token.test.ts --maxWorkers=2 --minWorkers=2`、`node node_modules/typescript/bin/tsc --noEmit` 和 `git diff --check`。报告每条命令退出码与 Windows 跳过数；不能运行的检查单列，不虚报。主库 Windows 真协议测试由 Codex 集成后执行，不在 worker 中打包或发布。

# Final report

给出两文件差异摘要、RED/GREEN 证据、未验证边界、异常与需要协调者复核的问题。作业结束时保留可审查 diff，不提交、不推送。

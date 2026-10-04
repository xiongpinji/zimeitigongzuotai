# Goal

修复 Windows 项目盘全新隔离用户目录中 Sonar token 的首次 ACL 收紧失败，使现有本地 MCP 服务无需测试前置权限准备即可启动。此项仅解除 R5 入口阻断；九项生产工具、R1–R6 其余要求、真实账号和平台验收仍保留。用户当前要求先测试、不打包。

# Decisions and assumptions

- 源码基线为 `8ab5f868d4788a4d444f8b6acf9d780caaa0ef9d`。2026-10-05 在该源码重新运行 `npx electron-vite build` 退出 0；默认 `node app/scripts/smoke-production-mcp-win.cjs` 退出 1，记录在被忽略的 `data/runtime/validation/r5-mcp-1791132553896/`，首次启动报 `sonar_token_acl_failed`。
- [既有诊断](../../validation/r5-mcp-runtime-surface-2026-09-28.md)证明自建空 token 文件保留 Owner、只写受保护 DACL 的最小对照成功，且有条件准备后现有 MCP 工具可以经真实协议调用。本任务不能把这个准备条件算作产品修复。
- 主实现仍由用户指定的 `claude-bailian=qwen3.8-max` 承担；它若真实失败才按 Agent Orchestrator 策略考虑已批准的 `opencode-bailian=bailian-token-plan-personal/deepseek-v4.1-flash`。`qwen-code-review=glm-5.3` 只读。两条已终止的 R2/R4 任务不在本新子计划内，不重启它们，也不把待答复的 Codex 全面接管请求视为批准。
- 固定两文件范围，以真实 Windows 项目盘测试为门槛；Linux 测试只能覆盖不依赖 Windows ACL 的路径。GLM 审查若路由不可用则保留未通过状态。

# Constraints and guardrails

- 执行 Agent 只在专用干净 WSL 工作树中修改 `app/electron/sonar/token.ts` 和 `app/tests/sonar-token.test.ts`；不提交、推送、派生 Agent、改账号凭证或读真实 `~/.lingji` 内容。Codex 拥有主库集成、独立测试和 Git 交付。
- 仅更改自建合成 token 夹具。当前用户不授权打包、真实账号登录/发布、平台请求、付费模型或商品挂载。保留 POSIX 0600、Windows 仅当前用户的受保护 ACL，以及 ACL 失败前不写 token 的行为。
- Windows 文件路径只经 `SONAR_TOKEN_ACL_FILE` 环境变量传给固定 PowerShell 程序，不可拼接到命令文本或日志。测试目录须为本项目 Git 忽略路径，清理仅限经绝对路径和固定前缀核验的自建目录。

# Checklist

- [ ] R5-ACL-1：先补项目盘全新空 token 的 Windows 回归用例，再最小化修复 DACL 写入；提交候选供 Codex 完整 diff 与 Windows 源码构建/测试核查。外部只读审查单列结论。

# Validation strategy

先保留今日真实 MCP 首次启动红灯，再运行新增回归测试的 RED 和修复后的 GREEN。worker 可在 WSL 运行可用的聚焦测试和 TypeScript 检查；Windows ACL 路径、完整 MCP 协议与安全边界由 Codex 在主库独立复测。`node app/scripts/smoke-production-mcp-win.cjs` 的默认路径必须无需 `--prepare-token-fixture` 退出 0；旧的准备条件只作诊断对照。业务代码变化后运行相关全量检查和源码构建，不将旧绿灯移作新 SHA 结论。

# Completion criteria

自建项目盘空 token 保持文件 Owner，收紧后 DACL 受保护且仅当前用户允许访问；失败时空文件中仍无 token。现有 token 的安全复用、POSIX 0600 和旧调用不倒退。默认 MCP 严格探针能经真实服务完成工具清单、创建和打开合成工程以及 Renderer 状态读取，不能只用单元 mock 证明。没有未经审查的业务 diff 或安装包；R5 整体仍需生产工具及活动授权闭环才能验收。

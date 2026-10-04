# R5 项目盘首次 MCP 启动权限修复验证（2026-10-05）

用户已[授权 Codex 接手剩余源码](../decisions/2026-10-05-codex-source-takeover.md)。本子项只改 `app/electron/sonar/token.ts` 与 `app/tests/sonar-token.test.ts`。项目盘全新空 token 文件的回归测试先在旧实现下退出 1，报 `sonar_token_acl_failed`；旧脚本在新建 DACL 上再次设置文件 Owner，触发 Windows 拒绝访问。删去多余的 `SetOwner` 后，同一测试通过，并确认 Owner SID 保持、DACL 禁止继承且允许 SID 仅为当前用户。生成/复用 token、ACL 操作失败前不写秘密、POSIX 0600 等既有行为未改。测试目录是 Git 忽略的 `data/runtime/validation/sonar-token-volume-*`，只清理本用例创建且经路径核验的目录。

| 核查 | 实际结果 |
| --- | --- |
| 新用例 RED，`npx vitest run tests/sonar-token.test.ts --maxWorkers=2 --minWorkers=2` | 退出 1，10 项中 1 项失败、1 项跳过；失败点为项目盘新用例 `sonar_token_acl_failed`。 |
| 同命令 GREEN | 退出 0，9 项通过、1 项 POSIX 权限用例在 Windows 跳过。 |
| `npx tsc --noEmit` | 退出 0。 |
| `npx electron-vite build` | 退出 0，仅源码构建，无安装包；浏览器兼容性外置警告仍在，不是此次权限修复引入。 |
| `npx vitest run --maxWorkers=2 --minWorkers=2` | 394 个文件通过，2975 项通过、4 项跳过、0 失败，耗时约 339 秒。 |
| `git diff --check` | 退出 0。 |

实际 Windows/Electron/MCP 探针 `node app/scripts/smoke-production-mcp-win.cjs` 在**没有** `--prepare-token-fixture` 的条件下，首次修复后一次运行出现 `running=true`、已返回工具列表并创建合成工程，但后续步骤报 `probe_failed` 且探针清理卡住。只结束该次探针自己的进程树；未把这次结果计入通过。随后在同目录临时加入异常打印的探针副本，以及原探针重跑，均退出 0；临时副本已移除。两次成功结果分别位于忽略目录 `data/runtime/validation/r5-mcp-1791135350392/result.json` 与 `data/runtime/validation/r5-mcp-1791135365644/result.json`：`fixtureTokenAclPrepared=false`、31 个工具、合成工程创建/打开和 Renderer IPC 读回通过、真实发现文件元数据未变。初次不稳定结果保存在 `r5-mcp-1791135067117/failure.json`，错误未由当前探针细分，原因未证实。

这只解除首次启动 ACL 故障。31 个旧工具不含九项生产动作，探针结果也标记 `productionAcceptanceTested=false`。R5 自动操控完整生产链、GLM 当前源码只读审查、真实素材/账号/平台最终状态均未通过；R1–R6 总体目标继续进行。本轮无打包、真实账号登录、平台发布或付费模型调用。

# Goal

继续阶段一 M1 素材权属边界：把已明确的四个合成负例从 RED 修到 GREEN，经 Codex 独立复核后才合入主库。原 M1 候选和测试位于隔离工作树 `zimeitijuzhen-ao-m1-repair`，尚未验收。

# Input and prior attempts

- 原候选由 DeepSeek 实现，59 项原测试与 50 项生产契约测试通过；Codex 补了四项负例，其中区域通配、运行时畸形资产、凭证键泄露和异步期间来源被篡改均失败（59/63）。
- 原清单第二次 DeepSeek 执行没有修改文件；第三次 Qwen 路由在进入修改前收到百炼 `unrecognized_model` 并以 127 退出，没有修复。原清单的三次尝试不再复用。
- 当前清单是以四项已复现缺陷和无依赖 Junction 的干净隔离工作树为输入的有界修复，不扩展到真实模型、真实素材、平台“原创”判定或法律授权核验。

# Decisions and constraints

- 保持已批准的路由：`opencode-bailian/bailian-token-plan-personal/deepseek-v4.1-flash` 执行本项；`claude-bailian/qwen3.8-max` 留给账号链路；`qwen-code-review/glm-5.3` 只读。Codex 审查、运行测试、选择性集成。
- 唯一允许变更：`app/electron/assets/asset-rights.ts`、`app/tests/assets/asset-rights.test.ts`、`docs/validation/p3-1-asset-rights.md`。保留四项 Codex 负例，禁止修改包、配置、真实凭证及其他工作树；不提交、不推送、不部署。
- WSL 工作树无需依赖链接。执行器若无法运行 Vitest，须继续做源码修复并准确报告；Codex 在 Windows Node 22 环境独立执行官方测试与类型检查。

# Checklist

- [ ] M1-R1：修正 `worldwide` 区域授权方向、畸形 AssetV1 的运行时拒绝、凭证样式键的固定脱敏错误、异步语义检索前的不可变来源快照；四项 RED 与原 59 项均通过，50 项生产契约测试保持通过，`tsc --noEmit` 退出 0。

# Completion criteria

Codex 核对仅三个允许文件的完整差异，独立复跑 63 项素材权属测试、50 项生产契约测试与类型检查，审阅来源/授权不被越权；未验证的法律、模型、平台行为保持未完成。验收通过后选择性合入并推送主库；失败时留在隔离工作树，不声明完成。

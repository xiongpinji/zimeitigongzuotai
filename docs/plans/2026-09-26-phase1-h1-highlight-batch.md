# 阶段一 H1：录屏高光候选到批处理管线

# Goal

把多个已授权录屏的 HotClip 高光候选安全映射为带源哈希和绝对时间码的
`HighlightV1`，再建立可恢复的批处理调度与人工评审门槛，按
[高光验收协议](../media-evaluation-protocol.md)验证真实样本。单段候选不等于
可发布切片，也不构成任何平台“原创”判定。

# Decisions and assumptions

- 主库已有 [HotClip 独立进程 sidecar](../../app/electron/highlights/hotclip-sidecar.ts)
  与 `RecordingV1` / `HighlightV1` 合约。HotClip 由用户另行安装；本项目
  不导入或打包其 AGPL 代码，正式分发前继续审查许可证与进程组合边界。
- 首段 H1-S1 只做纯映射：输入必须提供调用方已计算的录屏 sha256，并与
  `RecordingV1.sourceSha256` 相等；候选时间码必须落在录屏边界内。自动
  `recommended` 只作为上游建议保留，不变成发布许可或人工通过。
- 后续 H1-S2 才持久化多个录屏的任务、进度、取消和失败恢复；H1-S3 再用
  用户配置的外部 sidecar 与已授权样本进行 Windows 本地测试及盲审。

# Constraints and guardrails

- 仅使用已确认的 Qwen 主实现、DeepSeek 并行实现、GLM 只读审查三条 AO
  路由；Codex 负责精确文件白名单、测试、审查与合入。每项独立工作树，
  至多两个实现任务并行；执行 Agent 不派生子代理、不提交/推送/部署。
- 录屏本体、转写和素材不进 Git、任务提示或日志。无用户配置不下载模型，
  不调用付费 API。候选的视觉证据载荷为不可信原文，不能伪造成已核验事实。
- 高光候选可为零，不能为了数量制造低质量切片。映射不能擅自读取媒体或
  自动发片；真实录屏质量和叙事独立性由后续盲审判定。

# Checklist

- [ ] H1-S1：仅新增 `project-hotclip-candidates.ts`、聚焦测试和验证记录。
  显式校验录屏/观察哈希、候选 ID 和毫秒时间码，生成稳定 ID、来源追溯、
  `HighlightV1` 与只供评审的上游建议字段；重复或越界输入 fail closed。
  先 RED 后 GREEN，不接文件系统、模型、UI 或发布。
- [ ] H1-S2：在 S1 契约上实现多录屏持久任务与有界并发、取消、失败重试、
  崩溃重启和相同输入去重；以可注入 sidecar runner 做合成故障注入。
- [ ] H1-S3：以用户配置的外部 HotClip 和已授权真实录屏运行 Windows
  本地试验，记录转写、场景/音频/互动证据、时间边界、人审调整和负对照。
  正式分发前审查 AGPL 与模型/依赖成本，未通过则保持侧车可选且不打包。

# Validation strategy

S1 测试同一输入重跑稳定、哈希不一致拒绝、越界/舍入后零长度拒绝、重复
候选拒绝、空候选、上游 `recommended` 不产生自动批准。Codex 复跑聚焦
Vitest、`tsc --noEmit` 和差异检查。S2 覆盖多个录屏、取消、崩溃重启和
单片重试。S3 按验收协议对 2 小时高信号、跨主题和低高光负样本独立盲审；
任何合成测试不得充作真实模型/媒体验收。

# Completion criteria

S1–S3 分层证据齐全且用户授权样本盲审通过后才关闭本计划。
S1 的离线映射单独落库时，只能声称来源与时间码契约已验证，不能声称
“AI 批量剪辑”已完成，更不能声称平台认可为原创。

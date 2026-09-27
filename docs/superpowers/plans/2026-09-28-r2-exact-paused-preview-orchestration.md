# Goal

在已确认的阶段一范围内，修复 R2 独立剪辑台暂停/逐帧预览与导出选帧不一致的问题，以可复现的 Windows 源码 UI 测试证明 15/30 fps 合成视频逐帧一致；保留完整 R1–R6 目标及后续打包、真实素材验收门槛。

# Decisions and constraints

- 固定 [源码阶段设计](../specs/2026-09-28-r2-exact-paused-preview-design.md)：播放仍由 Remotion Player 承担，暂停/拖动用 `renderStill()` 的目标帧覆盖；过期帧永不显示。不得修改导出为原生 `<video>`，不得加固定 seek 偏移冒充通解。
- 依据：[实际呈现帧诊断](../../validation/r2-presented-frame-diagnosis-2026-09-28.md)与[静帧可行性探针](../../validation/r2-renderstill-feasibility-2026-09-28.md)。两者仅证明当前缺陷和候选路径，不证明 UI 已修复。
- 只用 `claude-bailian=qwen3.8-max` 主实现、`opencode-bailian=bailian-token-plan-personal/deepseek-v4.1-flash` 审查不通过时的有界实现候选；`qwen-code-review=glm-5.3` 只读复核。Codex 独立检查 diff、复跑测试并集成。
- Worker 在隔离工作树修改，仅改合同允许路径，不提交、不推送、不打包、不部署、不触碰凭证、真实录屏和平台发布。当前用户要求先测试，打包与真号验收仍保留未通过。

# Checklist

- [ ] R2-S1：实现版本化精确暂停帧主进程服务、受限 IPC 和渲染进程覆盖层；先写有意义的失败测试，保持导出路径与播放行为。按任务合同完成聚焦源码测试与 15/30 fps 实际桌面 UI 比对。
- [ ] R2-S2：Codex 独立复核完整 diff 和安全边界，运行相关 Vitest、类型检查、源码构建、Windows 逐帧 UI 验收；GLM 做只读复审。记录 VFR、字幕/卡片、默认 GPU 和打包态证据或明确未通过。

# Validation and completion

本子计划完成只表示 R2 暂停帧源码阶段验收，不能代替阶段一其他 R1–R6 条目，更不能代替 Windows 打包、真实录屏、四平台登录/发布最终状态。任一严格 UI 帧低于 SSIM 0.92 时保持红色。运行时私有素材和测试产物只在被忽略的本地目录；账本记录测试命令、退出码和 Codex verdict。

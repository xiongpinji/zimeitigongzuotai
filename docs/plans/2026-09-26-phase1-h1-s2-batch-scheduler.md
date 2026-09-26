# H1-S2：高光候选安全投影硬化与多录屏持久调度

# Goal

在已落库 H1-S1 的来源投影上，先封闭带访问器对象的校验后重读缺口，再交付仅生成待人工审核高光候选的多录屏持久任务调度。调度必须有界并发、可取消、可恢复、可重试且同输入不重复提交结果。真实 HotClip、真实录屏盲审与平台发布仍属于 H1-S3 和后续阶段。

# Decisions and assumptions

- 主库 H1-S1 为 `3d268f9`，当前进度基线 `d74efe1`。GLM 审查无 P0/P1，但指出候选字段在校验与投影之间重读的 P2；现有 sidecar 的 `JSON.parse` 输入不可携带 getter，扩大调用面前仍应修复。
- `durationMs` 继续坚持非负安全整数，以免大数失去毫秒精度；明确它比生产文档解析器更严格，并在后续 ingest 统一入口。日期按真实日历校验。
- H1-S2 只持久化录屏引用、内容摘要、候选/高光契约和任务状态，不存录屏本体、凭证、转写原文或视觉载荷；来源媒体和 HotClip 可执行文件由 H1-S3 的授权本地适配器提供。
- 进程崩溃后的 sidecar **可能重复计算**，但最终高光 ID 和任务提交必须幂等；不宣称 sidecar 子进程在主进程强杀时总能随之退出。调度存储只允许未来 Electron 单实例所有者写；跨进程通用写入原子性仍需另行证明。
- 每条结果固定 `reviewRequired: true`。零候选合法，不能为了批量数量造片。无自动发布、无平台原创认定。

# Constraints and guardrails

- 仅使用已确认的 Qwen 主实现、DeepSeek 并行实现、GLM 只读审查；Codex 负责精确文件白名单、审查、测试和选择性合入。实现代理各在独立工作树，至多两个并行；不得派生子代理、提交、推送、部署、触真实素材或下载模型。
- 所有外部 runner、时钟、ID、存储根目录与源摘要观察者应可注入。错误和持久状态只存固定码/必要数字，不存 stderr、绝对路径或提示词原文。任何存储损坏与来源哈希失配 fail closed。

# Checklist

- [x] H1-S2a：`projectHotClipCandidates` 在一次校验中快照候选必要原始字段，后续去重、越界与投影只用快照。新增带 getter 翻转的 RED 用例，确保畸形二次值不能进入 `HighlightV1`；保留既有 15 项和输出深冻结。验证文档补记安全整数拒绝差异。主库 `fb1a442` 聚焦 21/21、类型检查退出码 0；见 [验证记录](../validation/p2-1-highlight-projection.md)。
- [ ] H1-S2b：新增可注入 `HighlightBatchQueue` 及聚焦测试和验证文档。批任务按录屏 ID + 规范化源哈希 + 处理选项的稳定键去重；每个录屏独立状态/尝试次数，已完成高光按稳定 ID 幂等提交。队列持久化 schema 校验、同进程唯一写者、损坏拒绝、有界并发、取消传播、失败隔离与手工/有界重试。
  - [x] S2b1 持久化身份/存储核心已在主库 `65d705d` 交付，Windows 相关套件 83 passed、1 个 symlink 用例因建链权限 skipped；GLM 修复后复审无开放 P0/P1，详见[验证记录](../validation/p2-2-highlight-batch-queue.md)。
  - [x] S2b2a 持久状态转移、尝试令牌、显式有界重试、取消决定及候选/高光 ID 幂等提交已在主库 `9dc5014` 交付，Windows 相关套件 97 passed、1 个 symlink 用例因建链权限 skipped，类型检查和 Electron 构建通过；GLM 首审后的增量复审受 CLI 会话轮数限制未形成最终独立报告，Codex 审查及证据边界见[验证记录](../validation/p2-2-highlight-batch-transitions.md)。
  - [x] S2b2b 有界并发调度、AbortSignal 到合成 sidecar 子进程、单录屏失败隔离与显式重试已在主库 `5e2327f` 交付；Windows 相关套件 108 passed、1 个 symlink 用例 skipped，类型检查与 Electron 构建通过。前段 GLM 增量复审因会话轮数问题未形成最终报告，本段未另起模型审查；Codex 自审和产品边界见[验证记录](../validation/p2-2-highlight-batch-scheduler.md)。目前只提交结果 ID，候选正文/高光投影及人工审核记录尚无原子持久化，不能称为产品批量高光生产。
- [ ] H1-S2c：故障注入与恢复：从“已排队/运行中/候选已算出但未提交/提交后未回执”四个持久点重开，证明状态不误报成功、结果不重复；Windows 双进程写者测试保持 RED 或经产品单实例门槛证明产品路径单一写者。在接真实 sidecar 前保留 H1-S3 门槛。
  - [x] S2c1 本地产物回执与合成故障恢复核心已在主库 `3471243` 交付：文件提交后补队列 ID、缺失/损坏/失配拒绝、旧尝试不冒充完成、源哈希观察端口及内容摘要。相关 Windows 套件 122 passed、1 skipped，类型检查和 Electron 构建通过；GLM 只读作业超时，未形成独立最终报告。见[验证记录](../validation/p2-2-highlight-batch-recovery.md)。
  - [ ] S2c2 产品持锁 Electron main 单写者入口、双进程写者/打包启动核对、真实源摘要观察器接线与真实样本盲审仍未完成，不启用自动高光生产。

# Validation strategy

S2a 先 RED getter 用例，再 GREEN，Codex 在主库运行全部 H1-S1 聚焦测试与 `tsc --noEmit`。S2b/c 用合成录屏、假 runner 和受控时钟/进程测试：并发上限、不同录屏独立、取消中断、超时/畸形输出、单片重试、重复 enqueue、存储读写故障、崩溃重启。检查实际持久字节不含媒体正文、Cookie/Token、stderr 或视觉载荷。GLM 只读复核状态机及证据分级。上述离线测试不替代两小时真实样本与盲审协议。

# Completion criteria

S2a–S2c 全部通过并选择性合入后，才称“多录屏高光候选持久调度离线链路完成”。H1-S3 真实 sidecar/样本盲审、后续时间线/渲染/发布仍须分别验收；不把候选算法推荐映射成发布许可。

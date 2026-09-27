# R4 任务 5/6：批量渲染到产品接线细化计划

## Goal

完成已确认的 R4 多叙事混剪计划剩余部分：把三份独立可编辑工程受控渲染成可核验产物，保留来源、时间线、失败/取消/恢复状态与人工复核证据，再从产品界面调用。它是阶段一 R4 和后续安全账号发布接线的前置工作，不替代 R1–R6 全部交付。

源码基线为 `199b19e`。当前有 `plan-proposals`、`source-resolver`、`timeline-builder`、`version-projects`，没有 `render-batch`、`review` 或 CompositionWorkbench。2026-09-28 全量本地测试通过，但单版 synthetic smoke 不能证明三版批量能力。相关设计与六项实现计划仍以 `2026-09-28-r4-multi-version-composition-design.md` 和 `2026-09-28-r4-multi-version-composition.md` 为准。

## Decisions and assumptions

- 固定用户路由：主实现 `claude-bailian=qwen3.8-max`，备用/并行实现 `opencode-bailian=bailian-token-plan-personal/deepseek-v4.1-flash`，只读复审 `qwen-code-review=glm-5.3`。每项先有限时任务，失败只按已批准池处理；不把只读审查路由改作实现。
- 当前“先测试，不打包”持续有效。先做源码与合成素材，真实录屏、登录、上传、付费模型和商品实现不在本批执行范围。
- 复用 `readCompositionVersion`、`resolveCompositionSources` 和 `renderVideoHeadless`。主进程加载文档及服务，Renderer 只给 ID/操作意图，不提供任意输入/输出路径或伪造授权。
- 每版渲染前及复用旧产物前重新核验来源和权限。时间线被手工修改时先停为需重新审阅，不能直接继承旧来源快照。
- 渲染 worker 最多两个，活动版本只占一个 slot；不同版本错误隔离。取消要传入真实 Remotion 编码器，等活动调用落定才释放 slot。
- 每版在自己的工程目录保存渲染记录，输出路径由主进程派生。重启发现 `rendering` 时转为 `unknown`，不自动重渲染；已完成产物必须以输入指纹和文件 SHA-256 验证后才能复用。
- 渲染状态不等于质检通过。文本、来源时间码、画面与音频的差异形成复核证据；平台原创判定仍需平台结果，不能由这些分数代替。

## Constraints and guardrails

执行者没有提交、推送、发布、修改凭证、装依赖或派生子 Agent 权限。每个 job 有精确文件白名单和超时。Codex 独立审查完整差异、验证 Windows 与本地进程行为后才集成。打包态 renderer 的 `process.chdir` 与全局缓存是并发风险，必须避免同进程多个打包导出互相改 cwd；本批不以 mock 证明打包态验收。

## Checklist

- [ ] B1：按有界任务合同实现批量渲染、真实取消、状态落盘、哈希复用和不确定输出恢复；先跑 RED，再实现 GREEN，Codex 独立验证。
- [ ] B2：实现四类相似度证据与人工复核记录，并用三份合成工程实际编码证明三版产物和失败隔离；只记录离线质检，不声明原创。
- [ ] B3：受限 Composition IPC、主进程服务注册和产品界面接线，允许打开三版独立时间线、批量渲染、查看错误与人工审阅；给后续安全发布提供可信产物 ID。
- [ ] B4：完整 diff 审查、GLM 只读复审、相关全量回归/类型检查/源码构建和隔离桌面验收；真实授权样本与双人盲审未完成前，R4 产品验收保持未完成。

## Validation strategy

B1 的聚焦行为测试必须证明：三版独立结果、两个 worker 上限、失败隔离、取消信号贯通、崩溃后未知状态不自动重试、完成产物跨实例哈希复用、篡改与权限变化阻断、根工程未改、路径/状态文件损坏拒绝。

Codex 集成后运行相关 composition/Remotion 套件、`npx tsc --noEmit` 和源码构建。B2/B3 再进行至少三版实际合成编码与隔离桌面路径。所有完成状态按当前字节和 SHA 记录，不以代理报告或前一提交的绿灯代替。

## Completion criteria

B1–B4 均有当前源码的独立验证记录、三版编码与产品路径证据，且没有开放的 P0/P1 审查项，才可关闭本细化计划。真实授权样本与双人盲审、外部只读复审属于 B4 的未完成闸门，不能由模拟输入或 Codex 自检代替。

本批完成也不关闭新账号发布、Agent 全流程、R2 原生预览、真实平台吞吐或整个阶段一目标。安全账号发布接线须使用本批后续形成的受信任产物与质检记录，不能把当前旧发布 UI 直接改为接受加密账号 UUID。

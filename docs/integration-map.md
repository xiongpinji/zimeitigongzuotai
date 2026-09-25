# 阶段一组件组合与接入图（已确认，组件仍待验证）

用户允许按功能组合开源源码、AI Skills、MCP 插件和本项目新写的连接层。**选择组件不等于功能已交付**：本文件记录 2026-09-25 的源码审阅快照、拟接入方式和必须补齐的能力；导入前重新固定版本、复核许可证与构建。项目现在仍是规划仓库，没有运行中的组合成品。

## 方案比较与选型

| 方案 | 能复用的基础 | 主要缺口 | 决定 |
| --- | --- | --- | --- |
| Easel 整体为基座 | 运营 Skill 和内容流程 | 独立多轨时间线、四平台同平台多账号隔离、可恢复并发队列仍需大幅新建 | 不选作桌面基座，选择性取其 Skill 设计和已审阅脚本。 |
| **Lingji Cut 为桌面基座，专业工具独立接入** | 时间线、Remotion 导出、Agent/MCP 入口及多平台发布入口已有代码 | 批量高光、授权素材语义匹配、账号级队列与四平台真实稳定性需补齐 | **阶段一推荐**。保持一个项目模型、一个账号会话权威源和一个发布账本。 |
| 全新应用 + 多个外部 CLI | 边界完全自主 | 编辑器、预览、发布入口、打包均重建，交付周期和集成风险最高 | 仅在基座构建或许可证复核失败时重估。 |

## 功能到组件的可执行映射

| 功能 | 优先组件及已见入口 | 组合方式 | 本项目必须补写的连接层与验收 |
| --- | --- | --- | --- |
| 独立剪辑台、项目保存、导出 | [Lingji Cut](https://github.com/yoqu/lingji-cut) 的 Electron/React 编辑器与 Remotion；现有 `electron/mcp/tools.ts` 暴露编辑器状态和素材导入工具 | 固定 SHA 后集成源码，沿用一个时间线工程模型 | 接受高光片段和 `CompositionPlan` 的结构化时间线回写；多轨、人手修改、保存重开、预览/导出一致性按 R2 验收。先验证 Windows 构建，不按 README 直接认定 R2 通过。 |
| 批量直播录屏高光与切片 | [HotClip](https://github.com/xixihhhh/hotclip) 的 `transcribe_video`、`detect_highlights`、`clip_video` CLI/本地 stdio MCP；[Easel video-highlights Skill](https://github.com/ZJU-REAL/Easel/tree/main/skills/openclaw/video-highlights) 的 `skills/shared/scripts/highlight_cut.py` | 首选隔离进程/CLI，以版本化 JSON + 文件哈希交换任务；MCP 用于 Agent 调用相同服务。Easel Skill 可作候选生成/裁切辅助 | 多录屏调度、断点、转写/视觉/音频证据统一、边界校正、低高光负对照和批量导出。HotClip 的 AGPL-3.0 分发义务先审查；许可无法满足则保持协议并换实现。单个 Skill 或 `max-clips` 参数不等于批量处理。按 R3 盲审协议验收。 |
| 授权素材库与语义匹配 | [OpenCut-AI](https://github.com/GinoongFlores/OpenCut-AI) 的 `services/ai-backend/app/routes/broll.py` 展示 CLIP 帧索引与文本匹配路线；Easel `asset-manager` Skill 可参考资产操作 | 先用独立索引服务接口试验，选择性移植必要的 MIT 模块或重写适配器；Skill 仅调用本地资产 API | 建素材哈希、许可/来源、使用范围和索引版本；输出带理由的候选镜头和时间码；未获授权素材不可自动入片。对 Windows 本地运行、索引成本和检索质量做样本验证。 |
| 多叙事合成和批量渲染 | Lingji 时间线/Remotion + FFmpeg；Easel `clipify`、`batch-process`、`skill-quality-gate` 可作为流程参考 | `CompositionPlan` 先生成，再通过类型化工具写入**同一**时间线；持久任务引擎执行渲染 | 版本脚本、段落/镜头来源和差异解释、字幕/封面/画幅、失败单片重试及重复度复核。至少 3 个实质不同版本；只换 BGM/封面等对照必须拒绝。按 R4 人审，不承诺平台认原创。 |
| 四平台同平台多账号登录 | Lingji 发布实现及 `electron/publish/accounts.ts` 的平台/账号浏览器状态；[social-auto-upload](https://github.com/dreammis/social-auto-upload) 仅作适配器缺口参考 | 一个加密会话仓和内部 `accountId`；每个平台发布适配器通过账号引用取会话 | 账号隔离、到期探针、重登、删除和审计。不能把 Lingji 与 social-auto-upload 的 Cookie 目录同时当可写权威源。按平台分别验证两组授权账号重启后的保持与互不干扰。 |
| 批量普通发布与恢复 | Lingji 四平台发布入口；social-auto-upload 的抖音、快手、小红书上传 Skill/脚本及相关平台实现可作补位参考；Easel `skill-cross-platform-publish` 只提供路由/逐平台委派 | 本项目新建**唯一持久发布队列**，平台插件实现统一 `prepare/submit/querySubmission`；Skill 只能经队列提交 | `视频版本 × 账号` 映射、同账号互斥、跨账号并行、平台预算、限流退避、未知提交核查、最终远端 ID/状态。模拟负载与四平台真实账号普通发布分开验收。Easel 的逐平台 Skill 派发和 MCP 调用均不能替代队列。 |
| 智能体全流程自动操作 | Lingji 已有 MCP 工具入口；Easel 的工作流/质量/发布 Skills；HotClip MCP | 本项目定义版本化、可审计的生产 Skills，并让 MCP 工具只调用本地任务 API，不直接读取凭证或绕开任务状态机 | 九项工具覆盖导入、找高光、版本规划、匹配、编辑、渲染质检、预检、发布及核验。默认止于草稿；仅在账号、时间窗、上限均预授权时自动提交。异常停机与人工接管按 R5 验收。 |
| 商品挂载预留 | 暂无可证明覆盖四平台、所有商品类型的共同组件 | 只在发布任务/平台插件保留 `CommerceRequest` 和四步接口 | 阶段一所有商品插件返回 `not_implemented`；请求带货时预检拒绝或显式等待改为普通任务。真实商品 ID、资质、接口和挂载核验列 R6-C，待用户后续研究，不计阶段一完成。 |

## 组合的系统边界

`Recording/Asset → Highlight/CompositionPlan → VideoVariant → PublishJob → PlatformResult` 是唯一主链。CLI、MCP 和 Skill 只是调用形式：它们都通过版本化对象、任务 ID 和审计事件连接，不直接共享任意文件路径或账号 Cookie。桌面 UI 和 Agent 看到同一任务状态；高光、素材索引及渲染进程不拿发布会话；平台适配器不拿原始素材库全量权限。账号状态与本地队列始终由本项目管理。

## 灵剪发布源码缺口（固定快照 `59a2fc9`）

下表依据固定 SHA 的实现，而不是上游功能介绍。它决定哪些代码可以复用、哪些必须重做或加适配层；导入时需对当前上游重新核查。

| 已见源码证据 | 对本项目的含义 |
| --- | --- |
| [`account-id.ts`](https://github.com/yoqu/lingji-cut/blob/59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1/electron/publish/account-id.ts) 以 `platform + accountName` 组成 ID；[`accounts.ts`](https://github.com/yoqu/lingji-cut/blob/59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1/electron/publish/accounts.ts) 将注册表和 Playwright `storageState` 保存为本地 JSON。 | 不能直接把昵称当永久主键或把 JSON 会话文件当加密仓。需内部 UUID、显示名与会话引用分离、账号名/导入路径校验、加密与迁移测试，并验证同平台账号互不覆盖。 |
| [`runner.ts`](https://github.com/yoqu/lingji-cut/blob/59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1/electron/publish/runner.ts) 以 `for ... await` 逐个目标上传；[`ipc.ts`](https://github.com/yoqu/lingji-cut/blob/59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1/electron/publish/ipc.ts) 使用一个模块级 `cancelled` 标志。 | 现有一次多账号派发不等于跨账号并发，更不能承诺重启恢复。须以本项目持久任务队列取代串行派发和全局取消：每个 `PublishJob` 独立状态/取消、同账号互斥、跨账号按预算调度。 |
| [`types.ts`](https://github.com/yoqu/lingji-cut/blob/59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1/electron/publish/types.ts) 的一个 `PublishJob` 只有一个 `filePath`，目标只覆盖文案；`PlatformModule.uploadVideo` 返回 `Promise<void>`。 | “每账号选择不同视频版本”与“远端作品 ID/最终状态”需要新契约：任务固定 `videoVariantId`，平台适配器返回可核对的提交引用，并独立查询最终状态。页面点击成功或 `Promise<void>` 返回不能算发布验收。 |
| [`engine.ts`](https://github.com/yoqu/lingji-cut/blob/59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1/electron/publish/engine.ts) 每次上传启动一个 Chromium 进程/上下文。 | 并发度首先受本机 RAM、CPU、磁盘和网络约束，再受平台速率/权限约束。模拟 8 worker 是调度器容量目标；真实账号并发需资源准入、平台预算、动态降速和逐平台测量。 |

产品运行时的 AI 推理费用与 Agent Orchestrator 的**开发 Credits 预算分开**。[HotClip Skill](https://github.com/xixihhhh/hotclip/blob/62aef3919fdd7d8a974f80a9b721e0177eb408c2/skills/hotclip/SKILL.md)要求为高光检测配置本地或云端 LLM 入口，首次端侧 ASR 可能下载约 1 GB 模型；使用云端入口时会向其发送转写文本，不能把“视频文件留在本机”误解为“内容完全不出本机”。语义匹配与多叙事规划也可能调用模型。接入前记录每条流程的模型来源、模型/依赖下载大小、每小时录屏的运行时间、上传数据范围和可计费调用上限；未经用户配置和启用，不应静默调用付费推理端点。第三方 Skill/MCP 包要固定版本并审查其可执行脚本和工具权限，不能仅凭 Skill 文本给予账号会话或任意文件访问权。

每项第三方能力按四层证据标记：`upstream_claim`（上游说明）、`source_seen`（源码入口）、`local_tested`（本机可重复测试）、`real_platform_verified`（真实账号及平台最终状态）。上表至多证明前两层，不能从插件名、Skill 文本或可配置线程数推断生产可用性。组件接入前需记录固定 SHA、许可证、NOTICE、依赖和 Windows 运行验证；独立 AGPL 进程的分发方式需专门审查。

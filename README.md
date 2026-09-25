# 自媒体工作台

面向自有或已获授权账号的本地优先视频生产与多平台发布工作台。阶段一目标是抖音、快手、微信视频号、小红书的同平台多账号管理、独立时间线编辑、直播录屏批量高光切片、素材语义匹配与实质性再创作、智能体全流程操作，以及可恢复的批量普通视频发布。商品挂载保留平台专属商品 ID 扩展端口，具体接入和真实验收待后续研究。

**当前状态：阶段一方案已获用户确认，产品开发正在推进；用户已撤销百炼 Credits 硬性上限。** 在首项源码基线任务完成前，本仓库仍只有架构和执行计划；不能把路线图视为已经交付的功能，也不能把第三方仓库的 README 声明视为真实账号验收。

- [架构与关键契约](docs/architecture.md)
- [开源组件选择及许可证边界](docs/source-selection.md)
- [各功能的开源、Skill 与 MCP 组件组合图](docs/integration-map.md)
- [四平台发布与带货能力准入门槛](docs/platform-capability-gates.md)
- [直播高光与混剪验收协议](docs/media-evaluation-protocol.md)
- [阶段计划与验收矩阵](docs/roadmap-and-acceptance.md)
- [阶段一范围和商品端口边界](docs/phase1-scope.md)
- [阶段一 Agent Orchestrator 持久计划](docs/plans/2026-09-25-phase1-core.md)
- [团队协作与路由](docs/orchestration.md)
- [阶段一确认记录](docs/decisions/2026-09-25-phase1-approval.md)

已确认的方案：以 [Lingji Cut](https://github.com/yoqu/lingji-cut) 为桌面编辑与发布基座，按功能组合 [Easel](https://github.com/ZJU-REAL/Easel) Skills、[HotClip](https://github.com/xixihhhh/hotclip) CLI/MCP 候选、[OpenCut-AI](https://github.com/GinoongFlores/OpenCut-AI) 语义索引路线和本项目的持久任务引擎。组件可选择性移植源码或以独立进程接入，统一通过版本化契约和本地任务 API 协作。原仓库代码尚未导入；开发 Agent 按 [编排约定](docs/orchestration.md) 启动。

“原创”只指有授权来源、具有实质性新表达的作品生产流程；任何程序都不能保证平台给出原创认定或流量。阶段一验收区分本地渲染、模拟发布、真实账号普通发布和平台最终状态；商品挂载另列为后续验收，不以预留接口冒充完成。

# 自媒体工作台

面向自有或已获授权账号的本地优先视频生产与多平台发布工作台。目标覆盖抖音、快手、微信视频号、小红书的同平台多账号管理，独立时间线编辑，直播录屏批量高光切片，素材语义匹配与实质性再创作，智能体全流程操作，以及按账号选择商品挂载的可恢复发布队列。

**当前状态：方案待确认，尚未开始产品开发。** 本仓库目前只有架构和执行计划；不能把路线图视为已经交付的功能，也不能把第三方仓库的 README 声明视为真实账号验收。

- [架构与关键契约](docs/architecture.md)
- [开源组件选择及许可证边界](docs/source-selection.md)
- [四平台发布与带货能力准入门槛](docs/platform-capability-gates.md)
- [阶段计划与验收矩阵](docs/roadmap-and-acceptance.md)
- [Agent Orchestrator 持久计划](docs/plans/2026-09-25-product-delivery.md)
- [团队协作与路由](docs/orchestration.md)

规划决策：以 [Lingji Cut](https://github.com/yoqu/lingji-cut) 为桌面编辑与发布基座，借鉴并按需移植 [Easel](https://github.com/ZJU-REAL/Easel) 的运营 Skills；将高光分析、语义素材匹配与批量任务调度放在独立边界内。原仓库代码尚未导入。完成方案确认后，才会启动任何开发 Agent 或付费模型调用。

“原创”只指有授权来源、具有实质性新表达的作品生产流程；任何程序都不能保证平台给出原创认定、流量或带货权限。最终验收会区分本地渲染通过、沙箱发布通过、真实账号发布通过、商品挂载通过和平台后续状态。

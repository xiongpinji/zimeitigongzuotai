# AI 全流程 · Spec 拆分总览

- 日期：2026-06-15
- 来源：《video-web-master AI 全流程产品规划》(`/Users/yoqu/Documents/story/video-web-master-AI全流程产品规划.md`)
- 状态：拆分已确认，各 spec 设计陆续落盘

## 决策记录

原规划是一份 4 阶段、10 个软件侧建设点的路线图，单份 spec 装不下。经讨论确认：

- **本期实现范围**：轨道一（成片闭环）+ 轨道二（写稿闭环），共 5 份独立 spec。
- **本期不做**：轨道三的控制层（统一审批中心 / 成本权限 / 能力发现）与发布闭环（多平台发布 / 数据反馈）。即原计划的 Spec 6、Spec 7 暂缓。
- 每份 spec 独立走「设计 → 计划 → 实现」一轮；本轮先把 5 份**设计**全部落盘，再回头逐份做实现计划。

## Spec 列表与依赖

```text
轨道一 · 成片闭环 (Phase 0-1)
  Spec 1  持久化基座 + 契约版本治理      ← 地基
  Spec 2  成片技术能力补齐              ← 依赖 1
  Spec 3  持久化编排器 + v1 交付         ← 依赖 1、2   ★ AI Creation Loop v1

轨道二 · 写稿闭环 (Phase 2)
  Spec 4  Creative Brief / Style Bible  ← 依赖 1
  Spec 5  研究 + 事实核验 + 文稿闭环      ← 依赖 1、4
```

| Spec | 文档 | 覆盖原规划章节 |
|---|---|---|
| 1 | `2026-06-15-spec1-持久化基座-design.md` | §三.2 持久化、§三.7 契约版本 |
| 2 | `2026-06-15-spec2-成片技术能力-design.md` | §三.3 工具闭环、§五.1/3/4 |
| 3 | `2026-06-15-spec3-持久化编排器-design.md` | §三.1 编排、§三.5 任务中心(基础)、§六 首个可交付版本 |
| 4 | `2026-06-15-spec4-creative-brief-style-bible-design.md` | §三.8 Brief / Style Bible |
| 5 | `2026-06-15-spec5-研究与事实核验-design.md` | §三.3 文稿、Phase 2 |

## 与现有代码的总体关系

现状比原规划假设的更靠前：已有 pipeline 任务注册表、22+ 个 `lingji_*` MCP 工具、`lingji` CLI、内存态一键流程、卡片→时间线装配雏形、SRT 解析/重切分、Remotion 无头导出、完整风格预设与三层提示词体系、写稿/审稿/版本历史、多 provider LLM 层。

因此这 5 份 spec 的基调是**补齐缺口 + 持久化 + 编排**，而非另起炉灶。各 spec 的「代码落点」一节均优先复用既有模块。

## 跨 spec 的约定

- `waiting_approval` 状态与 `approvals` 概念在 Spec 1 schema 预留、Spec 3 实现最小门禁；统一审批中心（原 Spec 6）本期不做。
- 所有耗时能力产出统一登记到 Spec 1 的 `artifacts.json`（来源 + 输入哈希 + stale），供 Spec 3 编排器判断重跑。
- 所有新增 CLI/MCP 工具复用既有 `cli/src/` 与 `electron/pipeline/tools` 注册范式。

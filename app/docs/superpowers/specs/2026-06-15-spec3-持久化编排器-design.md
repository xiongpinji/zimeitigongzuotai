# Spec 3 · 持久化编排器 + AI Creation Loop v1

- 日期：2026-06-15
- 状态：设计草稿，待 review
- 所属轨道：轨道一 · 成片闭环（Phase 1）★ 首个可交付版本
- 依赖：Spec 1（持久化容器 / 任务落盘）、Spec 2（装配 / 校验 / 修复 / QC 能力）

## 1. 背景与目标

有了 Spec 1 的持久化容器与 Spec 2 的纯能力，本 spec 做**编排器**，把现有生成工具 + Spec 2 能力串成 **AI Creation Loop v1**：`script.md → TTS → 字幕校验/重对齐 → AI 分析/卡片 → 封面 → 时间线装配 → 校验/修复 → 导出 → QC → final.mp4`，无人值守、可断点续作、QC 门禁。

现状关键事实：

- 现有一键流程是**内存态** React hook：`src/hooks/useAIVideoWorkflow.ts`（6 步：script→tts→analyze→cover→arrange→done），进程重启即丢，"走到哪步"靠磁盘产物推断；`src/lib/auto-run-resume.ts` 提供从失败步恢复。
- 生成能力多已具备：`lingji_generate_audio/analyze_subtitles/generate_covers/generate_cards/export_video` 等 headless 工具（`electron/pipeline/`）。
- 统一进度系统已存在：`src/store/task-progress.ts` + `AppStatusBar`（PROGRESS-SPEC.md），新耗时任务必须接入它。

目标：用持久化、可恢复的编排层替换内存一键流程，并补 `timeline assemble/validate/repair` + `qc` 步骤，闭合"无需手动时间线操作即可产出技术合格视频"。

## 2. 交付边界

纳入：

- Pipeline Orchestrator + workflow-registry + retry-policy。
- `pipeline run / resume / retry / status / cancel / skip / invalidate / dry-run`（CLI + MCP）。
- 把 `useAIVideoWorkflow` 迁移到编排器（renderer 调用编排，不再自持状态机）。
- **最小审批门禁**：step 支持 `auto / review`，`review` 时进入 `waiting_approval` 等确认（复用 Spec 1 预留状态）。
- 基础 AI 任务中心 UI + "AI 完成整片"按钮 + 失败"自动修复并重试" + QC 报告 + 查看成片。

不纳入（本期砍 / 留后续）：

- 统一审批中心、AI 操作 diff、一键撤销、成本预估、Provider fallback、权限档位 → 原 Spec 6，本期不做（仅保留最小 review 门禁）。
- 写稿 / 研究 / 事实核验步骤 → Spec 5（编排器预留挂载点）。

## 3. Workflow Registry

`electron/pipeline-v2/workflow-registry.ts` 定义 workflow 的 step DAG。首个 workflow `full-creation`：

```text
tts → subtitle.validate → subtitle.resync(条件) → analyze
    → cards → covers → timeline.assemble → timeline.validate
    → timeline.repair(条件) → export → qc
```

每个 step 声明：

```jsonc
{
  "id": "timeline.assemble",
  "inputs": ["cards", "audio"],        // 依赖的 artifact kind
  "capability": "timeline.assemble",   // 调用 Spec 2 能力或现有 headless 工具
  "approval": "auto",                  // auto | review
  "retry": { "max": 2, "backoffMs": 1000 },
  "optional": false                    // 可 skip
}
```

step 的 inputs/outputs 写进 Spec 1 的 `workflow.json` 与 `artifacts.json`。

## 4. Orchestrator

`electron/pipeline-v2/orchestrator.ts`，消费 Spec 1 的 `workflow-store` / `artifact-registry`、Spec 2 能力、现有 headless 工具：

- `run`：从头按 DAG 执行；每 step 产出登记 artifact（含输入哈希）。
- `resume`：读 `workflow.json` 找首个非 `succeeded` step，从那继续（含 Spec 1 恢复出的 `interrupted` 任务）。
- `retry`：重跑当前 / 指定 step。
- `skip`：跳过 `optional` step。
- `invalidate`：某 artifact 内容哈希变化 → 依赖它的下游 step 置 `pending`、其 artifact 置 `stale`，下次 run/resume 重跑。
- `cancel`：取消当前及后续。
- `dry-run`：只输出执行计划 + 预计耗时（**成本估算本期不做**），不落产物。

QC 门禁：`qc` step 失败时，按 Spec 2 报告里的"建议回退步骤"自动把对应上游 step 置 `pending`（如 `timeline.repair` / `cards`），由 retry-policy 触发重跑，而非只记日志（原规划 §三.3 要求）。

## 5. Retry Policy

`electron/pipeline-v2/retry-policy.ts`：每 step 的最大重试、退避；Spec 1 恢复出的 `interrupted` 任务自动纳入可重试；超过上限置 `failed` 并停在该 step 等人工。

## 6. 最小审批门禁

- step 标 `auto` 直接过；标 `review` 时完成后置 `waiting_approval`，等 UI/CLI `approve` 才继续。
- v1 默认审批节点裁剪到**成片预览**一处（其余 auto）。原规划的选题/文稿/声音/封面审批待 Spec 4/5 与未来控制层补。

> **开放决策点 A**：v1 是否需要"成片预览"之外的审批节点（如封面选择）？默认仅成片预览，保持"全自动到成片"体验。

## 7. CLI / MCP

- CLI（`cli/src/`）：`lingji pipeline run|resume|retry|status|cancel|skip|invalidate|dry-run --project <path> [--wait]`。
- MCP（`electron/pipeline/tools`）：`lingji_pipeline_run` / `_resume` / `_status` / `_approve` 等，复用现有工具注册范式。
- 对外契约：与 Spec 1 的 `workflow.json` schema 一致，状态可被外部 Agent 轮询。

## 8. UI（基础任务中心）

复用现有 `task-progress` store 与 PipelineTask 落盘（Spec 1），新增/增强：

- "AI 完成整片"按钮（编辑器入口）：触发 `pipeline run`。
- 任务中心：工作流步骤树、每步输入/输出/耗时、当前调用的能力、取消/重试/跳过、失败原因与"自动修复并重试"入口、QC 报告、"查看成片 / 打开项目"。
- 进度接入统一底部进度系统（PROGRESS-SPEC.md），不新增独立进度弹窗。

> **开放决策点 B**：任务中心 UI 落点——并入现有 Agent 对话面板（`src/components/agent/`）还是独立页面/抽屉？默认建议在编辑器内做抽屉式任务中心，复用 task-progress。

## 9. 代码落点

新增：

```text
electron/pipeline-v2/
  orchestrator.ts
  workflow-registry.ts
  retry-policy.ts
  workflows/full-creation.ts
```

改动既有：

- `src/hooks/useAIVideoWorkflow.ts`：改为调用编排器（薄封装），不再自持 6 步状态机；`src/lib/auto-run-resume.ts` 的恢复语义迁到 orchestrator.resume。
- `electron/pipeline/index.ts`：编排器复用其任务注册 + Spec 1 落盘。
- `cli/src/` + `electron/pipeline/tools`：注册 `pipeline_*`。
- UI：新增任务中心组件 + "AI 完成整片"按钮。

## 10. 测试（Vitest）

- workflow-registry：DAG 依赖正确、optional/skip 行为。
- orchestrator：run 全流程（mock 各能力）、resume 从中断点续、invalidate 触发下游重跑、cancel 终止。
- retry-policy：超限置 failed、interrupted 自动重试。
- QC 门禁：qc 失败 → 自动回退到建议 step 并重跑。
- dry-run：输出计划不落产物。

## 11. 验收标准（对齐原规划 §六）

1. 从 `script.md` 开始，一条命令 `lingji pipeline run --project <path> --wait` 生成音频、字幕、卡片、封面、时间线，并通过 QC 产出 MP4。
2. 应用重启后 `lingji pipeline resume` / UI 可从中断点恢复，不重跑已完成步骤。
3. QC 失败能自动回到可修复步骤重试，而非只输出日志。
4. UI "AI 完成整片"按钮可走完整流程并展示步骤进度、QC 报告、查看成片。

## 12. 风险与影响面

- 与现有内存一键流程并存期的迁移风险：需保证迁移后行为等价，旧"恢复横幅"（`workflowMeta`）逻辑平滑过渡到编排器 resume。
- 触及高风险项：修改 IPC（新增 pipeline_* ）、编排导出入口、与 Spec 1 持久化耦合。
- 边界纪律：成本/权限/统一审批/diff 撤销均**不在本期**，只做最小 review 门禁，避免范围蔓延。
- 长流程稳定性：单 step 失败不应污染 workflow.json，需保证状态写入原子性（复用 Spec 1 写锁 + append 日志）。

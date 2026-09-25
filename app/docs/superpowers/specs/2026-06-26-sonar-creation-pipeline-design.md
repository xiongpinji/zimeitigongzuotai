# 声呐「工作流」重做为创作流水线工作台

日期：2026-06-26
状态：已批准（产品口头确认方向，授权自动实现）

## 背景与问题

声呐（Sonar）扩展现有的「工作流」是一个**手动三列看板**（待处理/处理中/已完成，`WorkflowBoard.tsx`）。它不产出任何东西、不连下游，副标题自承「不触发自动发布」。产品判断：它是个冒名顶替者，对内容创作零辅助。

真正服务灵机剪影的是「桥」：监听/手动 → 转录 → 推送 → 待创作箱 → 一键二创。但桥只传转录稿，缺少"怎么改成自己的"这层创作辅助。

## 定位

Sonar = 灵机剪影的**上游选题/素材雷达**。用户场景是「偶尔刷到单条爆款 → 就地深挖 → 高质量送进灵机剪影二创」。它活在抖音登录态里，是 app 自己做不到的那只手。

## 目标

把「工作流」从手动看板重做成**单条视频自动流动的创作流水线**：

```
拉入 → ① 准备素材(抓取源+转录) → ② 爆款拆解(AI) → ③ 待你确认 → ④ 送进灵机剪影
        [自动]                    [自动]            [人工决策点]   [一键，复用桥]
```

①② 全自动连跑；停在③等用户确认（创作判断必须人工）；④复用现有桥，把**爆款拆解报告**一并送进待创作箱，并写入 `original.md` 顶部作为 AI 二创的创作参考。

## 数据模型（extensions/sonar/src/domain/models.ts）

替换 `WorkflowStatus` / `WorkflowItem`：

```ts
export type WorkflowStage =
  | 'collected'   // 刚拉进来
  | 'preparing'   // 抓取源 + 转录中
  | 'analyzing'   // 爆款拆解中
  | 'ready'       // 拆解完成，待确认送二创
  | 'pushed'      // 已送进灵机剪影待创作箱
  | 'failed';

export interface ViralInsight {
  videoId: string;
  angle: string;              // 选题角度（一句话点破）
  hook: string;               // 开头钩子（原话 + 为什么抓人）
  structure: string[];        // 内容骨架（分段提纲）
  highlights: string[];       // 记忆点 / 金句
  dataPoints: string[];       // 引用的数据 / 论据（提醒二创核实）
  remixSuggestions: string[]; // 二创改造建议
  model: string;
  createdAt: number;
}

export interface WorkflowItem {
  id: string;
  videoId: string;
  stage: WorkflowStage;
  error?: string;
  note: string;
  insight?: ViralInsight; // listWorkflowItems 注入；落库记录不含
  createdAt: number;
  updatedAt: number;
}
```

`ViralInsight` 独立存储，按 videoId 索引（与 analyses 同构），供工作流卡片水合 + 桥 payload 复用。

## 流水线编排（新 background/workflow-runner.ts）

`run(itemId)`：preparing → 确保转录（无则 `processing.process(videoId,{requireSummary:false})`）→ analyzing → 跑 insightProvider → putInsight → ready；任意失败 setStage('failed', {error})。后台 fire-and-forget，阶段写 repo 供 UI 轮询。

## 爆款拆解 AI（新 processing/insight-provider.ts + insight 校验）

抽出共享 LLM 调用 `processing/llm-json.ts`（openai/anthropic + 400 重试 + loose JSON 解析，从 summary-provider 平移），summary-provider 与 insight-provider 共用，保持既有请求形状不变（summary 测试必须仍绿）。insight-provider 用拆解 prompt + `validateInsight`，复用现有 LLM Provider 配置。

## 协议/方法变更

- 删 `updateWorkflowItem`；增 `retryWorkflowItem(id)` / `removeWorkflowItem(id)` / `pushWorkflowItem(id)`。
- Repository：增 `getWorkflowItem` / `setWorkflowStage` / `removeWorkflowItem` / `getInsight` / `putInsight`；`addWorkflowItem` 起始 stage=collected；`listWorkflowItems` 水合 insight。旧记录（无 stage）读时降级为 collected。
- handlers：`addToWorkflow` 创建后 `void services.workflow.run(item.id)`；`pushWorkflowItem` 复用 `bridge.push(videoId,{force,refresh})` 成功后 setStage('pushed')。

## UI（重写 WorkflowBoard.tsx）

视频卡片列表：封面/博主/标题 + 阶段进度条；ready 显示「查看拆解 / 送进灵机剪影」；failed 显示原因 + 「重试」；轮询 listWorkflowItems 自动推进。拆解报告抽屉/展开展示六字段。删除三列看板与手动移动。

## 桥与 app 侧

- `BridgePayload` 增 `insight?`；`buildBridgePayload(...,insight?)`；push-on-processed 读 `repo.getInsight(videoId)` 传入。
- app `SonarEnqueueInput`/`SonarInboxItem` 增 `insight?`；routes 校验透传（可选字段，缺省不影响既有）。
- `inboxItemToOriginalMarkdown`：有 insight 时在转录稿前加一段清晰标记的「创作参考」块（角度/钩子/骨架/二创建议），供 AI 二创模板吸收；无 insight 保持纯转录（向后兼容）。
- `SonarInboxPanel`：卡片增 insight 概览（角度+钩子），让用户在「生成初稿」前看到拆解。

## 测试

- insight 校验器（合法/缺字段/数组容错）
- workflow-runner 编排（无转录→先转录→拆解→ready；缺 Provider→failed；转录失败→failed）
- llm-json 共享调用（保持 summary 测试绿）
- payload 带 insight；inbox enqueue 带 insight；original.md 组装含创作参考
- 更新 `_repository-contract.ts` / `e2e-client.test.ts` 的 workflow 段为 stage 模型

## 非目标

- 不恢复自动监听一批博主的批量推送重心（产品选「单条深挖」）。
- 不下载原片进 app（桥仍只传文本）。
- ④之前不全自动（保留人工确认）。
```

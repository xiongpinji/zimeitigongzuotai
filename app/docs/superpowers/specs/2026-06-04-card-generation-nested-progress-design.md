# AI 卡片生成：父任务 + 子任务嵌套进度设计

> 日期：2026-06-04
> 分支：`feat/remotion-migration`
> 状态：设计已确认，待出实现计划

## 1. 背景与问题

AI 卡片生成（`src/lib/ai-analysis.ts` 的 `analyzeSrt`）实际上是一个**多阶段、含并发**的操作：

1. **planning** — 1 次大 LLM 请求，做分段 + 封面提示词规划（最慢，1–3 分钟）。
2. **cards** — N 个分段**并发**生成（默认 4 并发，`cardGenerationConcurrency`）。每段是 1 次内容 LLM 调用；图片卡还要额外 1 次提示词 LLM + 1 次图片 provider 调用；motion 卡生成自由 Remotion TSX。
3. **cover.regeneration** — 与 cards 并行的独立封面提示词重生成。
4. **done** — 汇总。

但底部统一进度系统（`src/store/task-progress.ts` + `AppStatusBar`）只把它表达成 **1 条进度**：

- `AIPanel.tsx:352` 起一个 task（`ai-analyze-cards-*`），`mode` 从 `streaming`（planning 脉冲）→ `determinate`（cards 30%→95%）→ 100%。
- 阶段文字塞在 `phase` 字段里（"生成内容卡片 3/10"），**只在展开的 `TaskProgressPanel` 显示**；底部摘要行 `StatusBarTaskSummary` 不显示 `phase`。
- 卡片内部"正在生成图片 / 正在编译 motion"只通过 telemetry（`card.image.start` 等）上报，**不走 IPC 进度通道**，前端完全看不见。
- `TaskProgressItem.level`（0|1|2）字段**全程未被 UI 使用**——本为父子嵌套设计，`AIPanel` 还传了 `level: 2`，渲染层忽略。

**"底部进度条永远只有一个执行中"的根因**：`derivePrimaryTask` 只选一个 task 当 `primaryTask`，底部条只渲染它；而整个卡片生成本身就是单 task，阶段信息被压平、且不在底部可见。

## 2. 目标

让用户在底部统一进度系统里**直观看到卡片生成的每个阶段与每段卡片的进度**：

- 顶层一个父任务，展示总进度 + 当前阶段文案（底部 28px 摘要行）。
- 展开的 `TaskProgressPanel` 里以**嵌套树**呈现子任务：planning、每张卡片（含内部子状态：生成内容 / 生成图片 / 编译 motion TSX）、封面提示词。
- 每张卡片可见 `等待中 / 生成中(子阶段) / 成功 / 失败` 状态。

## 3. 范围决策（已与用户确认）

- **粒度**：父任务 + 每段子任务，且**展示卡片内部子阶段**（生成内容 / 生成图片 / 编译 motion）。
- **store 能力**：改造成**通用**父/子任务模型（新增 `parentId`，复用 `level`），UI 支持嵌套渲染；本次**只接入卡片分析**，导出 / TTS 等以后可复用，不在本次范围。
- **接入入口**：手动入口 `AIPanel` 与一键流水线 `useAIVideoWorkflow` **两边都用**卡片子任务展示。共享单元是进度桥 `src/lib/analyze-progress-bridge.ts`。

非目标（YAGNI）：

- 不把导出 / TTS / 抖音导入改成嵌套（仅预留通用能力）。
- 不改父任务进度的百分比算法（继续由 analyze percent 驱动），避免破坏一键流水线的 3 轨合成数学。
- 不做子任务可取消（卡片并发由后端 worker 池管理，单段取消不在本次）。

## 4. 数据模型改造（`src/store/task-progress.ts`）

### 4.1 字段

给 `TaskProgressItem` 增加：

```ts
parentId?: string;   // 指向父任务 id；顶层任务为 undefined
```

`parentId` 是真正的归属关系；`level`（0|1|2）保留为缩进 / 视觉层级提示。

### 4.2 派生逻辑（关键，否则子任务污染底部条）

- **`derivePrimaryTask`**：只在**顶层任务**（`!parentId`）中选 primary。否则某张卡片子任务一 `active` 就抢走底部主显示——这正是当前"永远只有一个执行中"的对偶坑。
- **`deriveActiveCount`**：只统计顶层 `active` 任务，保证摘要 `· +N` 不被一堆卡片子任务灌爆。

### 4.3 生命周期级联

- **`completeTask(parentId)` / `failTask(parentId)`**：对**父任务**操作时，把仍 `active` 的子任务一并收尾（父成功 → 残留子任务标 `completed`；父失败 → 残留 active 子任务标 `error`，已成功的保留）。
- **`removeTask(parentId)`**：连带移除其所有子任务，并清理它们的 removal timer。
- 子任务自身的 `completeTask` / `failTask` / 5s/10s 自动移除逻辑复用现有路径，不变。

### 4.4 新增便捷 API（可选语法糖）

```ts
startChildTask: (parentId: string, input: Omit<StartTaskInput, ...>) => void;
```

内部即 `startTask` + 自动注入 `parentId` 与 `level`。也可不加，调用方直接在 `startTask` input 里带 `parentId`。

### 4.5 不变量

- 父任务进度**仍由现有 analyze percent 驱动**（planning 脉冲 → cards 30%→95% → done）。子任务只提供"每段到哪了"的细节，不参与父进度计算。
- 一键流水线 `useAIVideoWorkflow` 的 3 轨合成百分比数学完全不动；卡片子任务作为**附加细节**挂在它的 `workflowTaskId` 下，仅出现在展开面板。

## 5. 后端事件改造（`ai-analysis.ts` + IPC 三件套）

### 5.1 进度 payload 扩展

扩展 `AnalyzeSrtProgress`（`src/lib/ai-analysis.ts:37-43`），新增一个**可选的 per-card 生命周期事件**字段；不破坏现有 `phase/percent/cardIndex/cardTotal` 字段：

```ts
export interface AnalyzeSrtProgress {
  phase: 'planning' | 'cards' | 'done';
  percent: number;
  message?: string;
  cardIndex?: number;
  cardTotal?: number;
  // 新增：仅在卡片生命周期变化时出现
  card?: {
    segmentIndex: number;
    segmentId: string;
    title?: string;
    visualType?: 'motion' | 'image' | string;
    status:
      | 'start'              // 进入该段，生成内容中（含 motion 卡的 TSX 生成）
      | 'generating-image'   // 图片卡：内容已出，开始生成图片
      | 'motion-fix'         // motion 卡：TSX 校验/autofix（条件性，见下）
      | 'done'
      | 'failed';
    error?: string;
  };
}
```

> `start` 即"生成内容中"——对 motion 卡，TSX 由该步的 LLM 直接产出，因此 motion 卡通常只有 `start → done/failed`。
>
> **需在实现时核实**：motion TSX 的 **esbuild 编译**发生在导出/预览的渲染期（`electron/main.ts`），**不在 `analyzeSrt` 分析期**。仅当分析期确实会编译/校验 TSX 并触发 `motion.autofix` 重生成时，才发 `motion-fix` 子状态；若分析期不编译，则去掉 `motion-fix`，motion 卡只保留 `start → done/failed`。图片卡的 `generating-image` 是确定存在的（`materializeImageCard` 的二次 provider 调用）。

### 5.2 emit 点（`analyzeSrt` 的 `runOne` 并发循环内）

在现有 `telemetry.emit('card.*')` 旁，同步追加 `onProgress({ phase:'cards', percent:<不变>, card:{...} })`：

| 位置（约） | 现有 telemetry | 新增 onProgress.card.status |
|---|---|---|
| `card.start`（~:1364） | `card.start` | `start` |
| `card.image.start`（~:1394） | `card.image.start` | `generating-image` |
| motion autofix 前（若分析期存在，见 5.1 核实点） | （按需新增标记点） | `motion-fix`（条件性） |
| `card.end` ok（~:1404） | `card.end ok` | `done` |
| `card.end` error（~:1420） | `card.end err` | `failed` |

注意：`runOne` 是 N 路并发共享 `cursor`，因此同一时刻会有多个 `card` 事件交错到达——前端按 `segmentIndex` 路由到对应子任务即可，天然支持并发显示。

`percent` 字段在 `card` 事件里继续沿用既有"每段完成时"的整体百分比逻辑（父进度不变）。

### 5.3 IPC 三件套同步（CLAUDE.md 铁律）

- `electron/main.ts:735` `webContents.send('analyze-progress', progress)` —— payload 自动带上新 `card` 字段，无需改逻辑，但要确认透传完整对象。
- `electron/preload.ts:268-289` `onAnalyzeProgress` 回调类型补 `card?` 字段。
- `src/lib/electron-api.ts:387-395` `onAnalyzeProgress` 类型签名补 `card?` 字段。
- 三处类型必须与 `AnalyzeSrtProgress` 保持一致，避免漂移。

## 6. 进度桥改造（`src/lib/analyze-progress-bridge.ts`）

进度桥是 `AIPanel` 与 `useAIVideoWorkflow` 共享的"订阅 + 心跳 + 文案/百分比映射"单元。在此集中处理**子任务的创建/更新**，两个入口都受益。

### 6.1 新增依赖

`AnalyzeProgressBridgeDeps` 增加子任务操作钩子（注入便于测试）：

```ts
startChildTask?: (childId: string, input: { label; phase; ... }) => void;
updateChildTask?: (childId: string, patch) => void;
completeChildTask?: (childId: string) => void;
failChildTask?: (childId: string, error: string) => void;
```

`createAnalyzeProgressBridge(parentTaskId, deps)` 已持有 `parentTaskId` 作为 `parentId`。

### 6.2 行为

- 现有 planning 心跳、cards/done 的父任务 `updateTask` 逻辑**保持不变**。
- 收到带 `card` 的事件时，按 `segmentIndex` 映射到子任务 id：`${parentTaskId}-card-${segmentIndex}`。
  - `start`：若子任务不存在则 `startChildTask`（`parentId = parentTaskId`，`level = 1`，`label = 卡片#<i+1> <title>`，`phase = '生成内容…'`，`mode = 'indeterminate'`）。
  - `generating-image` / `motion-fix`：`updateChildTask` 改 `phase` 文案（"生成图片…" / "修复动效…"）。
  - `done`：`completeChildTask`。
  - `failed`：`failChildTask(error)`。
- `dispose()` 时，父任务的 `completeTask/failTask` 已会级联收尾子任务（见 4.3），桥本身只需停心跳 + 退订（现有逻辑）。

### 6.3 文案映射

`describeAnalyzeProgress` 复用；子任务 phase 文案新增小映射：

```
start            → '生成内容…'
generating-image → '生成图片…'
motion-fix       → '修复动效…'   // 条件性，见 5.1
```

## 7. UI 渲染改造（`TaskProgressPanel`）

### 7.1 嵌套渲染（`src/components/TaskProgressPanel.tsx`）

- 当前：对 `tasks` Map 全量按 `startedAt` 倒序平铺渲染。
- 改为：**先取顶层任务**（`!parentId`）按 `startedAt` 倒序；每个顶层任务下，紧跟其子任务（`parentId === parent.id`），子任务按 `segmentIndex`（或 `startedAt`）升序，缩进一级。
- 子任务行复用 `TaskRow`，但用 `level` / `parentId` 决定缩进与紧凑样式（更小的行高、状态点图标 ✓ ◉ ○ ✗，而非完整进度条）。
- 子任务 `phase` 文案在 active 时展示（"生成图片…"），复用现有 `.taskPhase` 样式。
- 失败子任务保留可见（红色 ✗ + error），不自动塌缩，方便用户对照 `AIPanel` 的失败段重试列表。

### 7.2 底部摘要（基本不动）

- `StatusBarProgressLine` / `StatusBarTaskSummary` 继续只显示 `primaryTask`（现在保证是顶层父任务）。
- 父任务 `phase` 文案可顺带在摘要展示当前阶段（"生成内容卡片 3/10"），属增强项，非必须。
- `· +N` 计数因 `deriveActiveCount` 改为只数顶层，不再被卡片子任务灌爆。

### 7.3 不变量（PROGRESS-SPEC 铁律）

- 不增加 `AppStatusBar` 28px 高度。
- 不新增独立进度弹窗 / 顶部条。
- 不动编辑器内打字机 / 审阅光标动画。
- 子任务嵌套树只在**可展开面板**内呈现。

## 8. 接入点

### 8.1 `AIPanel.tsx`（手动入口）

- `handleAnalyze`（:326）创建父任务后（现有 `startTask`），给 `createAnalyzeProgressBridge` 注入 4.4/6.1 的子任务钩子（指向 `useTaskProgressStore`）。
- 其余逻辑不变；`completeTask/failTask` 级联收尾子任务。

### 8.2 `useAIVideoWorkflow.ts`（一键流水线）

- 该 hook 用自定义订阅（`window.electronAPI.onAnalyzeProgress`，:797）算 3 轨合成百分比，**不用** `createAnalyzeProgressBridge`。
- 改造：在 analyze 阶段，同样按 `card` 事件创建/更新挂在 `workflowTaskId` 下的子任务（`parentId = workflowTaskId`）。可抽出 6.x 的"card 事件 → 子任务"纯函数供两边复用，避免逻辑重复。
- 3 轨合成的 `combinedPercent` / `nextGlobal` 数学**完全不动**；卡片子任务仅是面板内附加细节。

## 9. 受影响文件清单

| 文件 | 改动 |
|---|---|
| `src/store/task-progress.ts` | 加 `parentId`；改 `derivePrimaryTask` / `deriveActiveCount`；级联 complete/fail/remove；可选 `startChildTask` |
| `src/lib/ai-analysis.ts` | `AnalyzeSrtProgress` 加 `card`；`runOne` 各生命周期点追加 `onProgress({card})`；motion 编译前加标记点 |
| `electron/main.ts` | 确认 `analyze-progress` 透传完整 payload（含 `card`） |
| `electron/preload.ts` | `onAnalyzeProgress` 回调类型补 `card?` |
| `src/lib/electron-api.ts` | `onAnalyzeProgress` 类型补 `card?` |
| `src/lib/analyze-progress-bridge.ts` | 加子任务钩子依赖；`card` 事件 → 子任务映射；文案映射 |
| `src/components/TaskProgressPanel.tsx` | 嵌套渲染顶层→子任务；子任务紧凑行 + 状态点 |
| `src/components/AIPanel.tsx` | 给桥注入子任务钩子 |
| `src/hooks/useAIVideoWorkflow.ts` | analyze 阶段按 `card` 事件挂子任务到 `workflowTaskId` |

## 10. 测试策略

- `tests/analyze-progress-bridge.test.ts`（已存在）：扩展覆盖 `card` 事件 → 子任务 start/update/complete/fail 的映射，并发多段交错到达，dispose 不泄漏。
- 新增 `tests/task-progress-nesting.test.ts`：`derivePrimaryTask`/`deriveActiveCount` 忽略子任务；父 complete/fail/remove 的级联；`startChildTask`。
- `ai-analysis` 相关测试：断言 `card` 生命周期事件在内容/图片/motion/失败路径都正确 emit（可用 telemetry/onProgress 双探针）。
- 组件层：`TaskProgressPanel` 嵌套渲染快照 / 关键断言（顶层 + 缩进子行 + 状态点 + 失败保留）。
- 回归：`useAIVideoWorkflow` 3 轨合成百分比不变（现有测试若有则跑，无则补一个合成数学的纯函数测试）。

## 11. 风险与缓解

- **并发交错**：4 路并发的 `card` 事件交错到达 → 按 `segmentIndex` 路由子任务，幂等创建（已存在则只 update）。
- **类型漂移**：IPC 三件套 + `AnalyzeSrtProgress` 四处类型必须同步（CLAUDE.md 铁律）。
- **面板过长**：N 段卡片子任务可能很多 → 子行紧凑（状态点而非完整进度条）；失败保留但成功可在父完成后随父一起 5s 移除。
- **破坏一键流水线**：严格不动 3 轨合成数学，子任务仅附加 → 用回归测试兜底。

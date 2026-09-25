# AI 一键分析 — 卡片增量流式呈现与自动落轨

日期：2026-06-05
分支：feat/remotion-migration
状态：设计已确认，待评审

## 背景与目标

视频编辑器「AI 内容」面板的「一键分析」当前是**批处理**：核心分析在 Electron 主进程跑，所有卡片全部生成完后才一次性 `return` 回渲染端，内容区与时间线都在结尾一次性出现。用户在长时间分析过程中只看到底部进度条推进，看不到任何已完成的实际成果，体感差。

目标：把「批处理结尾出现」改为**增量呈现**：

1. 规划（布局/分段）一完成，内容区立即铺出每个分段的**骨架占位卡**（状态=生成中）。
2. 每张卡片生成完成即**就地填充**为真实卡片（乱序到达按分段定位）。
3. 每张 enabled 卡片生成完成即**自动落轨**（进入时间线），无需手动点「上轨」。
4. 「重新分析」先清除本批旧 AI 卡，再走同一条增量重建路径。

## 关键决策（已与用户确认）

- **呈现节奏**：骨架占位 → 逐张填充（而非只在完整卡片好后才出现）。
- **落轨策略**：每张生成好自动落轨；手动「上轨 N」按钮保留作兜底/重试。
- **重分析**：先清旧卡再增量重建，避免新旧重叠/重复。
- **取消/报错语义**：**保留已生成并落轨的卡片**，只清理剩余 pending 骨架。

## 现状关键事实（调研结论）

- 核心 `analyzeSrt()` 位于 `src/lib/ai-analysis.ts`（约 L1344），**在主进程运行**。两阶段：规划（单次 LLM）→ 卡片（并发池 `CARD_CONCURRENCY` 默认 4，乱序完成）。返回完整 `AIAnalysisResult`。
- 已有 `onProgress`（每卡 start/generating-image/done/failed 元数据）、`onPlanningDone`、`onCoverPromptsReady` 回调。
- IPC：`electron/main.ts` 的 `analyze-srt` handler 把这些回调桥接到 `webContents.send`：
  - `analyze-progress`（仅元数据，约 300B/条）
  - `analyze-planning-done`（携带完整 `segments[]`）
  - `analyze-cover-prompts-ready`
- `analyze-progress` 的 `card` 字段**只带生命周期元数据**（segmentIndex/segmentId/title/visualType/status），**不带卡片数据**。
- 单张 `AICard` 很小：只含相对路径（`assetPath: 'ai-cards/<id>/image.png'`），**无内联 base64**；MotionCard 是编译后 TSX 源（约 5–50KB）。逐张走 IPC 完全可行。
- 落轨：渲染端 `handleApplyToTimeline`（`AIPanel.tsx` L618）→ `addAICardsToTimeline`（`timeline.ts` L731）批量 for 循环 push overlays，结尾一次 commit。当前由用户手动点「上轨 N」触发。
- 内容区列表：`AICardList.tsx`，已用 Framer `AnimatePresence`，每卡有入场动画；当前仅在整个 `analysisResult` 替换时才重渲染。
- store：`src/store/ai.ts` 的 `setAnalysisResult` 整体替换，无单卡增量能力。

## 架构设计

### 数据流

```
planTranscriptSegments() 完成
  └─ onPlanningDone → 'analyze-planning-done'(已存在，含 segments)
       └─ 渲染端：为每个 segment 铺骨架卡(状态=pending)到内容区

每张卡在并发池完成
  └─ 新增 onCardGenerated(card, index) → 'analyze-card-completed'(新通道)
       └─ 渲染端：① 按 segmentId 用真实卡替换骨架
                  ② 若 card.enabled，单卡增量落轨到时间线

全部完成
  └─ analyzeSrt() invoke 返回完整 result(照旧)
       └─ 渲染端：最终对账(替换为权威结果) + persistAIState 一次落盘
```

骨架只活在内容区；时间线只接收真实卡片，逐张落轨。并发乱序完成不影响：骨架按 `segmentId` 索引填充，落轨按 segment 时间定位。

### 选型理由

新增**专用通道** `analyze-card-completed` 而非扩展 `analyze-progress`：与现有 `analyze-planning-done` / `analyze-cover-prompts-ready` 先例一致，职责分离，不让每条进度事件都背上完整卡片负载。

### 改动清单（三件套 + 核心 + UI）

| 层 | 文件 | 改动 |
|---|---|---|
| 核心分析 | `src/lib/ai-analysis.ts` | 新增 `onCardGenerated?(card, index)` 选项；并发池每张卡 `done` 落入 `cardSlots[i]` 后调用；`failed` 不调用（由 onProgress 的 failed 表达） |
| 主进程 | `electron/main.ts` | `onCardGenerated` → `webContents.send('analyze-card-completed', { card, index })` |
| preload | `electron/preload.ts` | 暴露 `onAnalyzeCardCompleted(cb)`（对照 `onAnalyzePlanningDone` 写法，返回 unsubscribe） |
| 类型契约 | `src/lib/electron-api.ts` | 补 `onAnalyzeCardCompleted` 类型签名 |
| Store | `src/store/ai.ts` | 新增 action：`beginIncrementalAnalysis(skeletons)`(铺骨架)、`upsertAnalyzedCard(card)`(单卡填充)、`markCardFailed(segmentId)`、`finalizeAnalysis(result)`(对账)、`clearBatchCards(batchKey)`(重分析清旧) |
| UI | `src/components/AICardList.tsx` | 骨架卡的「生成中 / 失败」视觉态，复用现有 `AnimatePresence` 入场 |
| 面板编排 | `src/components/AIPanel.tsx` | `handleAnalyze` 内订阅 `onAnalyzeCardCompleted`；planning-done→铺骨架；card-completed→填充 + 自动落轨；结束/取消清理 |
| 时间线 | `src/store/timeline.ts` | 单卡增量落轨能力 `appendAICardToTimeline(draft)`（与批量 `addAICardsToTimeline` 等价定位/碰撞逻辑） |

### 骨架卡表示

不污染 `AICard` 类型。渲染端维护「本次分析占位列表」：planning 的每个 segment 生成轻量骨架项 `{ segmentId, title, status: 'pending' | 'failed' }`。内容区列表 = 已填充真实卡 ∪ 仍 pending/failed 的骨架。卡片 `done` 事件用 segmentId 把骨架替换为真实卡；`failed` 标记失败态（不落轨，可手动重试）。

### 自动落轨与重分析

- **首次分析**：每张 enabled 卡到达即 `appendAICardToTimeline`，placement 复用 `buildAICardTimelineDraft` + 现有放置/碰撞逻辑，保证与批量「上轨」结果一致。
- **重分析**：开始前按本批 segmentId / 卡片来源从时间线移除旧 AI 卡，再走增量重建（与首次同路径）。
- 手动「上轨 N」保留作兜底（失败卡重试、手动补轨）。
- 增量落轨 undo：本批多张 append 合并为一次可撤销操作（批次标记），避免撤销要点几十下。

### 错误 / 取消处理

- 单卡失败：骨架转失败态，不落轨；进度条照旧记 failed。
- 取消 / 异常：**保留已落轨的真实卡片**，仅清理剩余 pending 骨架；复位 `analyzeInFlightRef`；不回滚已生成成果。
- 持久化：增量期间不每张落盘（防抖动），沿用结束时 `persistAIState` 一次落盘；自动落轨对时间线 store 的修改照常进入 undo 栈。

## 测试策略

- `tests/ai-analysis*`：断言 `onCardGenerated` 按完成顺序逐张回调、次数 = 成功卡片数；失败卡不触发 `onCardGenerated`。
- `src/store/ai.ts` 新 action 单测：铺骨架 → 逐张 upsert → pending 清零；`finalizeAnalysis` 对账；`clearBatchCards` 清旧。
- 时间线 `appendAICardToTimeline` 单测：与批量落轨结果等价（轨道 / 位置 / 碰撞一致）。
- 桥接三件套：`onAnalyzeCardCompleted` 在 main / preload / electron-api 类型对齐（按 CLAUDE.md IPC 约束）。
- 视情况 `npm run build` 验证类型与打包。

## 影响面与风险（对照 CLAUDE.md 高风险清单）

- **新增 IPC 通道**：`analyze-card-completed`，需同步 main / preload / electron-api 三件套 + 测试。
- **时间线写入**：增量落轨在分析进行中修改时间线 store；需确认与 undo/redo、并发保存不冲突。
- **不改共享类型结构**：`AICard` / `AIAnalysisResult` 结构不变，骨架为渲染端瞬态，降低迁移与持久化风险。
- 渲染引擎、提示词、Agent/MCP、安全边界均不涉及。

## 非目标（YAGNI）

- 不改卡片生成算法、并发度、提示词。
- 不改导出/Remotion 渲染链路。
- 不引入新的进度弹窗（继续用底部统一进度系统）。
- 不做失败卡的自动重试（保留手动「上轨」/重试入口即可）。

# 图片卡 → Motion 动画卡 转换 设计文档

- 日期：2026-06-07
- 状态：待实现
- 范围：编辑器内容卡片，从 image/video 媒体卡转换为 motion 动画卡

## 背景与问题

当前编辑器里内容卡片支持在 image / video 之间相互转换（`AICardList` 下拉里的「转为图片卡 / 转为视频卡」，由 `convertCardToMedia` 即时完成）。但**没有任何入口能把图片卡转换为 motion 动画卡**。

用户期望：在视频编辑器中，对一张图片卡（content 卡片）通过菜单一键转换为 motion 内容动画卡。

## 关键发现

转换引擎本身已经存在，缺的只是 UI 入口 + 统一的异步编排：

- `buildMotionCardShell`（`src/lib/ai-analysis.ts:403-407`）在重生成时，只要 `currentCard.type` 是 `image` 或 `video`，就会**强制把类型改成 `motion`、`renderMode` 改成 `motion-card`**，并写入 `motionCard` payload。
- 所以「图片卡 → motion 卡」本质上 = 对一张图片卡跑一次 motion 生成流水线，让其走 `else`（非 image）分支生成 Remotion TSX。

不同于 image↔video 的即时数据交换，image→motion 需要一次 LLM 调用生成 Remotion TSX，是**异步耗时操作**，可能失败。

### 两类图片卡（重要边界）

| 类型 | 来源 | 背景段 | 字幕文本 |
|------|------|--------|----------|
| AI 分析卡 | AI 分析流水线 | `analysisResult.segments` 里有 `card.segmentId` | 有真实逐字稿 |
| 手动插入卡 | 时间线右键「插入图片卡」/ `createImageCard` | synthetic `segmentId`（如 `manual:uuid`），无背景段 | 无 |

`buildMediaCardSkeleton`（`src/store/ai.ts:91`）对手动卡找不到 segment 时，`startMs/endMs` 为 0、无逐字稿。所以两类卡的 motion 生成路径必须分流。

### 现有可复用 IPC（无需新增/修改 IPC）

- `electronAPI.regenerateAICard`（`src/lib/electron-api.ts:233`）→ 主进程 `regenerateAICard`（`electron/main.ts:826`）：需要 `card` + `segment` + `entries`，走真实段落字幕生成。
- `electronAPI.generateCardFromSubtitles`（`src/lib/electron-api.ts:246`）→ 主进程 `generateSingleCardFromSubtitles`（`electron/main.ts:992`）：接受合成 `SubtitleCardDraftInput`（text/startMs/endMs/displayDurationMs/type/promptHint），用合成段落生成 motion。

**本设计不改动任何 IPC 名称/参数/返回值，不触发 IPC 三件套同步。**

## 用户决策（已确认）

1. 入口位置：**AI 面板卡片列表下拉菜单 + 时间线右键菜单**（两处都做）。
2. 转换流程：**一键转换 + 自动生成**（点击后立即调 LLM 生成 motion TSX，复用统一进度，可重试）。
3. 支持范围：**AI 分析卡 + 手动插入卡都支持**。

## 设计

### 1. 核心编排：`convertCardToMotion(cardId)` store 动作

在 `src/store/ai.ts` 新增 async store 动作 `convertCardToMotion(cardId: string): Promise<AICard | null>`，作为两个菜单入口的**唯一调用点**，内部完成完整流程：

1. 找到卡片；若卡片已是 motion 家族（`type !== 'image' && type !== 'video'`）直接返回 null。
2. 加载 AI 设置；`getAISettingsIssue` 失败 → `setAnalysisError` 并返回 null。
3. 启动底部统一进度任务（`startTask`，category `ai-analyze`，indeterminate）。
4. **按是否有真实背景段分流生成**（见 2）。
5. **字段合并保号**（见 3）写回 `analysisResult`。
6. 持久化（`saveAIAnalysis`）。
7. 若卡片已上轨，触发时间线 overlay 同步（`addAICardsToTimeline([buildAICardTimelineDraft(card)])`）。
8. `completeTask` / 失败时 `failTask` 且不破坏原卡片。

> 选择「集中到 store 动作」而非共享 hook：两个入口分散在 `AICardList`（AI 面板）和 `Timeline.tsx`（命令式 `useAIStore.getState()`）。store 动作能被两处统一调用，避免逻辑重复。现有 `useAICardInspector.regenerateCard` 的持久化 + overlay 同步逻辑可抽取为内部共享函数复用，避免重复实现。

### 2. 双生成路径

```
有真实背景段（analysisResult.segments 命中 card.segmentId）
  → electronAPI.regenerateAICard({ entries: srtEntries, card, segment, settings, ... })
    走 motion 分支（visualType 未传 → 默认 motion）

无真实背景段（手动卡）
  → 合成 SubtitleCardDraftInput:
      text:               card.content.prompt || card.title
      startMs / endMs:    取卡片 startMs；endMs 非法时用 startMs + displayDurationMs 兜底（保证 start < end）
      displayDurationMs:  card.displayDurationMs || 媒体默认
      type:               'motion'
      promptHint:         card.title / cardPrompt
  → electronAPI.generateCardFromSubtitles({ entries: srtEntries(可空), draft, settings, ... })
```

两条路径都不传 `visualType: 'image'`，确保走 motion 生成分支。

### 3. 字段合并保号规则

生成返回的卡片**不能直接替换**原卡片（否则丢失 id / 时间 / 上轨链路）。合并规则：

- **保留原值**：`id`、`segmentId`、`startMs`、`endMs`、`displayMode`、`enabled`、`cardPrompt`（若用户设过）。
- **接管新值**：`type`（→ motion 家族）、`renderMode`（→ `'motion-card'`）、`content`（→ string）、`motionCard`（payload）、`style`、`template`。

时间线 overlay 通过 `aiCardData.sourceCardId` 关联卡片 id，保号后已放置的 overlay 不断链，仅刷新渲染内容。

### 4. 入口 A：AI 面板卡片列表下拉

`src/components/AICardList.tsx`：

- 在「转为图片卡 / 转为视频卡」下方新增 `DropdownMenuItem`「转为动画卡」。
- `disabled` 条件：`card.type !== 'image' && card.type !== 'video'`（已是 motion 家族时禁用）。
- 转换进行中：该项显示禁用 + spinner。新增本地 `convertingCardId` state 控制行内反馈（底部统一进度同时展示）。
- 调用 `useAIStore` 的 `convertCardToMotion(card.id)`。

### 5. 入口 B：时间线右键菜单

- `src/lib/timeline-context-menu.ts`：`TimelineContextMenuActionKey` 新增 `'convert-to-motion'`；`getTimelineContextMenuItems` 在 overlay 为 `ai-card` 且其源卡为 image/video 时追加该项（需要把「overlay 是否为可转换 ai-card」作为入参传入，参照现有 overlay 判定）。
- `src/components/Timeline.tsx`：`handleContextMenuAction` 处理 `convert-to-motion`：由 `options.overlayId` → 查 `timeline.overlays` → `aiCardData.sourceCardId` → 调 `useAIStore.getState().convertCardToMotion(sourceCardId)`。

### 6. 进度 / 错误 / 边界

- **进度**：耗时 ≥2s，必须接入底部统一进度系统（`src/store/task-progress.ts` 的 `startTask/updateTask/completeTask/failTask`），复用现有 `regenerateCard` 的 task 写法。禁止新增独立进度弹窗。
- **错误**：
  - AI 未配置 → `getAISettingsIssue` 报错，不进入生成。
  - TSX 编译/生成失败 → IPC 抛错，`failTask` 标记失败，**原图片卡保持不变**（不破坏原状态），用户可重试。
- **边界**：
  - 手动卡时间范围非法（start ≥ end）→ 用 `displayDurationMs` 兜底合成有效区间。
  - 无 SRT → `entries` 传空数组，motion 由 title/prompt 驱动（best-effort，质量受限但不报错）。
  - 卡片已是 motion 家族 → 入口禁用 + 动作内二次防御返回 null。

## 改动文件清单（无 IPC 三件套变更）

- `src/store/ai.ts`：新增 `convertCardToMotion` 动作 + 接口声明；抽取共享的「持久化 + overlay 同步」内部函数。
- `src/components/AICardList.tsx`：新增菜单项 + 行内 converting 反馈。
- `src/lib/timeline-context-menu.ts`：新增 action key + 菜单项。
- `src/components/Timeline.tsx`：右键菜单 handler 接 `convert-to-motion`。
- `tests/`：相应单测。

## 测试计划

- `convertCardToMotion` 两条路径单测（mock IPC）：
  - AI 分析卡 → 走 `regenerateAICard`，验证返回卡片 `type` 为 motion 家族、`renderMode === 'motion-card'`、`motionCard.tsx` 落位。
  - 手动卡 → 走 `generateCardFromSubtitles`，验证合成 draft 字段（含时间兜底）。
  - 保号合并：原 `id/segmentId/startMs/endMs/displayMode/enabled` 不变。
  - 已上轨卡片触发 overlay 同步（`addAICardsToTimeline` 被调用）。
  - 失败路径：IPC 抛错时 `failTask` 且 `analysisResult` 中原卡片不被破坏。
- 时间线右键菜单可见性单测：image/video overlay 出现「转为动画卡」、motion overlay 不出现。
- `AICardList` 下拉禁用逻辑单测：motion 家族卡禁用该项。

## 非目标（YAGNI）

- 不支持 motion → image/video 的反向转换（已有 `convertCardToMedia` 覆盖）。
- 不在转换时让用户输入额外 prompt 草稿（一键自动生成；后续可在检查器内再编辑/重生成）。
- 不改动 motion 生成提示词或 Remotion 渲染链路。

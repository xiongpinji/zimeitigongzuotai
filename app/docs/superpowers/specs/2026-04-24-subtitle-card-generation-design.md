# 字幕区间选中生成单张内容卡片 · 设计文档

- 日期：2026-04-24
- 状态：Draft，待用户复核
- 作者：Claude (via brainstorming)
- 所属链路：时间轴字幕 · AI 内容卡片 · 一键分析

## 1. 背景与目标

当前 AI 内容卡片只能通过"一键分析"批量生成，粒度不够细。
用户希望在视频编辑器时间轴的字幕条带上：

1. 能通过鼠标**框选（marquee）**选中若干连续字幕
2. 对选中字幕**右键**唤出菜单，点击"生成内容卡片"
3. 弹窗呈现选中内容与时间区间，并允许**二次编辑**
4. 确认后**异步**生成 1 张 web-card 并落到时间轴

这要求复用现有 `cards.segment` → web-card 的 LLM 生成链路，而不是另造一套。

## 2. 非目标

- 不新增提示词 Kind；复用 `cards.segment`（决策自 Q5）
- 不支持非连续字幕选择，但 A 框选天然可能跨越字幕之间的静默间隙——此时时间区间以首条 startMs 到末条 endMs 为准
- 不做生成失败自动降级，任何非 web-card 产物直接报错让用户手动重试（决策自 Q3 确认轮）
- 不重构现有一键分析 / 导入 HTML / AI 卡片面板
- 不引入新的 UI primitive / dialog 库

## 3. 用户交互流程

```text
[字幕条带空闲]
   │ 在 subtitle 条带空白处按下鼠标并拖动
   ▼
[marquee 进行中]  —— 虚线矩形框跟随鼠标，被矩形覆盖的字幕实时高亮
   │ 松开鼠标
   ▼
[已选中 N 条]    —— 字幕保留高亮；Esc / 点击空白清空；切换页面清空
   │ 在任意选中字幕上右键
   ▼
[上下文菜单]     —— 仅在 N ≥ 1 时出现 "生成内容卡片" 项
   │ 点击
   ▼
[SubtitleCardDialog 弹窗]
   - 字幕文本 textarea（默认 = 选中字幕文本拼接）
   - 起止时间（两个 ms 输入）
   - 展示时长（ms 输入）
   - 卡片类型 Select（summary/insight/quote/data/chapter）
   - Prompt Hint 单行 input
   - [取消] [生成并插入]
   │ 点击"生成并插入"
   ▼
[关闭弹窗 + 启动底部统一进度条 task]
   │ LLM 返回
   ├─ 成功 → 写入 aiAnalysis.cards + addAICardsToTimeline（智能避让）
   └─ 失败 / 产物非 web-card → 进度条标失败 + toast "生成失败，请重试"
```

右键菜单入口可见性：**仅当 subtitleSelection.length ≥ 1 时出现**，空选中态不显示。

## 4. 架构与职责划分

设计按"小而独立单元 + 复用现有 action"原则切分：

| # | 单元 | 文件 | 职责 | 依赖 |
|---|---|---|---|---|
| 1 | 字幕选择 Store 切片 | `src/store/timeline.ts` | `subtitleSelection: number[]` 状态 + `setSubtitleSelection` / `extendSubtitleSelection` / `clearSubtitleSelection` actions | Zustand |
| 2 | 框选逻辑 Hook / 工具 | `src/lib/subtitle-marquee.ts`（新） | 纯函数：输入鼠标矩形 + 字幕 layout，输出命中的 index 数组 | 无 |
| 3 | 字幕条带组件改造 | `src/components/TimelineSubtitleBlocks.tsx` | 接入 store + marquee hook、渲染虚线矩形、绑定 `onContextMenu`、渲染高亮 | store + hook |
| 4 | 右键菜单扩展 | `src/lib/timeline-context-menu.ts` | 新增 `target: 'subtitle'` 分支，返回"生成内容卡片"项 | 现有 ContextMenu |
| 5 | 生成卡片弹窗 | `src/components/SubtitleCardDialog.tsx`（新） | 表单 + 校验 + 提交；关闭后交给异步流程 | `ui/components/dialog` + ModalFooter |
| 6 | LLM 调用入口 | `src/lib/ai-analysis.ts` 新增 `generateSingleCardFromSubtitles(draft, settings)` | 拼单 segment + 注入 extraInstruction + 断言产物为单张 web-card | 现有 `analyzeSrtSegmentsWithCards` |
| 7 | 提示词扩展参数 | `src/lib/ai-analysis.ts`（签名调整） | `analyzeSrtSegmentsWithCards` 新增可选参数 `extraInstruction?: string` + `maxCards?: number`（向后兼容） | LLM 管线 |
| 8 | 插入与持久化 | 复用 `useTimelineStore.addAICardsToTimeline` + `useAIStore` 现有 add 逻辑 | 写入 `aiAnalysis.cards` + 插入 overlay（智能避让） | 现有 action |
| 9 | 进度反馈 | `src/store/task-progress.ts` | `startTask` / `completeTask` / `failTask` 统一底部进度条 | PROGRESS-SPEC.md 铁律 |

**复用优先**：AI 卡片生成、timeline 插入、统一进度、ContextMenu 原语全部零改签名，只在表层新增。

### 4.1 存储位置决策

`subtitleSelection` 放在 `src/store/timeline.ts`（而非 Timeline 组件 local state）的原因：

- 右键菜单生成（`timeline-context-menu.ts`）需要读取
- 弹窗（`SubtitleCardDialog`）需要读取
- 未来 AI 面板 / 快捷键 / 脚本工作台可能接入
- 局部 state 下跨组件读取会引入 prop drilling 或额外 context

## 5. 数据结构

### 5.1 表单草稿

```typescript
interface SubtitleCardDraft {
  /** 拼接后的字幕文本，默认用 \n 连接选中字幕的 text */
  text: string;
  /** 起始毫秒，默认 = 选中字幕首条 startMs */
  startMs: number;
  /** 结束毫秒，默认 = 选中字幕末条 endMs */
  endMs: number;
  /** 卡片实际展示时长，默认 = endMs - startMs */
  displayDurationMs: number;
  /** 卡片类型倾向，传给 LLM 作为 hint */
  type: 'summary' | 'insight' | 'quote' | 'data' | 'chapter';
  /** 用户补充指令，可选 */
  promptHint: string;
}
```

### 5.2 表单校验

- `startMs < endMs`
- `displayDurationMs ∈ [1000, (endMs - startMs) + 5000]`（允许略长于时间区间，保留淡出缓冲）
- `text.trim().length > 0`
- `type` 必须为上述枚举值之一
- `promptHint` 长度 ≤ 200 字（避免塞爆 prompt）

校验失败时，禁用"生成并插入"按钮并在字段下方给出错误文案。

### 5.3 Store Slice 新增

```typescript
// src/store/timeline.ts
interface TimelineState {
  // ... 现有字段
  subtitleSelection: number[]; // 字幕 SrtEntry.index 列表（保持有序）
}

interface TimelineActions {
  setSubtitleSelection: (indices: number[]) => void;
  extendSubtitleSelection: (index: number) => void; // Shift+Click 用
  clearSubtitleSelection: () => void;
}
```

页面切换（`App.tsx` 的 `AppPage` 变化）时触发 `clearSubtitleSelection`，避免跨页面脏状态。

## 6. LLM 调用与错误处理

### 6.1 调用流程

```typescript
async function generateSingleCardFromSubtitles(
  draft: SubtitleCardDraft,
  settings: AISettings,
): Promise<AICard> {
  const segment = {
    startMs: draft.startMs,
    endMs: draft.endMs,
    text: draft.text,
  };

  const extraInstruction = [
    `只产出 1 张卡片；renderMode 必须为 "web-card"。`,
    `卡片类型建议为 "${draft.type}"，可根据内容微调。`,
    draft.promptHint ? `用户补充：${draft.promptHint}` : null,
  ].filter(Boolean).join('\n');

  const cards = await analyzeSrtSegmentsWithCards(
    [segment],
    settings,
    { extraInstruction, maxCards: 1 },
  );

  if (cards.length === 0) {
    throw new Error('LLM 未产出卡片');
  }
  const card = cards[0];
  if (card.renderMode !== 'web-card') {
    throw new Error('LLM 未按要求产出 web-card，请重试');
  }

  return {
    ...card,
    startMs: draft.startMs,
    endMs: draft.endMs,
    displayDurationMs: draft.displayDurationMs,
  };
}
```

关键点：
- LLM 返回后用 draft 的时间强制覆盖（防止 LLM 自行计算偏移）
- 非 web-card 直接抛错，不做 fallback（用户决策 Q3）
- `analyzeSrtSegmentsWithCards` 新增可选参数 `extraInstruction` / `maxCards`，不修改现有调用点行为

### 6.2 错误场景

| 场景 | 处理 |
|---|---|
| LLM 超时 | 进度条失败 + toast `"生成超时，请重试"` |
| LLM 返回 0 张卡片 | 进度条失败 + toast `"未产出卡片，请重试"` |
| renderMode ≠ `web-card` | 进度条失败 + toast `"生成结果格式错误，请重试"` |
| 保存 `aiAnalysis.cards` 失败 | toast `"保存失败"`，overlay 已插入时间轴仍可用但下次打开项目可能丢失（写入失败已有通用日志） |
| 生成过程中切换项目 | taskId 绑定项目 path，完成时校验一致性；不一致则丢弃结果 |

## 7. 边界情况

| 情况 | 处理 |
|---|---|
| 选中字幕覆盖已有 AI 卡片时间段 | 依赖 `addAICardsToTimeline` 的智能避让（现有能力），自动找空轨或新建轨 |
| 选中字幕中间有较大静默 | 允许，时间区间以首条 startMs 到末条 endMs 为准，字幕文本拼接时保留顺序 |
| 选中后用户删改字幕 | 弹窗表单是本地 draft，和字幕源数据脱钩；生成时也用 draft 的文本，不回读字幕 |
| 项目没有字幕（srtEntries 为空） | 字幕条带不渲染，右键菜单不出现，本功能不触发 |
| 字幕条带被滚动裁剪 | marquee 只在可见区域生效，滚动区外的字幕不纳入命中 |
| 生成过程中用户关闭应用 | taskId 在 task-progress store 中，应用重启不恢复未完成任务（现有行为） |
| 弹窗打开后用户修改底层字幕 | draft 已脱钩，不受影响；但选中 indices 可能失效——此时直接以 draft 内容为准 |

## 8. 测试策略

### 8.1 单元测试

- `tests/subtitle-marquee.test.ts`：给定字幕 layout + 鼠标矩形，验证命中 index 列表（含：完全覆盖、部分覆盖、不覆盖、反向拖动）
- `tests/subtitle-selection-store.test.ts`：`setSubtitleSelection` / `extendSubtitleSelection` / `clearSubtitleSelection` 行为（含：页面切换清空）
- `tests/generate-single-card.test.ts`：mock `analyzeSrtSegmentsWithCards`
  - 正常返回 1 张 web-card → 校验时间覆盖
  - 返回 0 张 → 抛错
  - 返回非 web-card → 抛错
  - 返回 >1 张 → 取第一张（`maxCards: 1` 已约束，但兜底断言）

### 8.2 组件测试

- `tests/timeline-subtitle-blocks-marquee.test.tsx`：框选交互，验证 store 状态更新
- `tests/subtitle-card-dialog.test.tsx`：表单默认值填充、校验失败时按钮禁用、提交时调用生成函数

### 8.3 手动验收

1. 框选 3 条连续字幕 → 右键 → 弹窗字段默认值正确
2. 弹窗里改写文本 + 调整时长 + 填 Prompt Hint → 生成 → 卡片落在时间轴正确时间点、渲染为 web-card
3. 生成过程中底部进度条正常推进、完成后淡出
4. 故意让 LLM 返回错误格式 → toast 报错、进度条标红
5. 选中字幕后切换到 settings 页再切回 → 字幕选中态被清空

## 9. 提交前检查（对齐 CLAUDE.md Change Delivery Gate）

- Renderer 不直接使用 Node API：本功能无需 IPC 新增
- 共享类型变更：仅在 timeline store 内扩展，不改 `TimelineData` / `OverlayItem` / `AICard`
- 提示词绑定：复用 `cards.segment`，不涉及 `electron/prompt-bindings-io.ts`
- 统一进度：调用 `task-progress` store，不新增独立进度 UI
- AI 视觉反馈铁律：本功能不涉及文档内虚拟光标 / 审阅扫描，无需接入
- 项目持久化：卡片写入 `aiAnalysis.cards`，沿用现有 `save-project-section` IPC

## 10. 后续可能的延展（非本次范围）

- 支持 Shift+Click 扩选（已在 store 预留 `extendSubtitleSelection`，但 marquee 为主交互）
- 在 AI 面板"卡片列表"区域展示手动生成的卡片来源（区别于一键分析）
- 框选时键盘 Tab / 方向键辅助选择
- 卡片模板 / 风格选择（作为"高级设置"折叠区）

以上留作后续迭代，当前 spec 只覆盖 MVP。

## 11. 决策记录（来自 brainstorming）

| 问题 | 决策 |
|---|---|
| Q1 卡片生成方式 | web-card LLM 生成，复用现有方法 |
| Q2 弹窗可编辑字段 | 字幕文本 + 时间范围 + 展示时长 + 卡片类型 + Prompt Hint |
| Q3 拖动选中交互 | A 框选（marquee） |
| Q4 卡片落位 | 智能避让 (2-C) + 写入 `aiAnalysis.cards` (3) + 异步 + 统一进度条 (4) |
| Q5 LLM 提示词策略 | A 复用 `cards.segment` + extraInstruction 注入 |
| Q3 重 fallback 策略 | 非 web-card 直接报错，不降级 |
| 右键菜单可见性 | 仅选中态显示 |
| 选择状态存储 | 放 timeline store |
| `analyzeSrtSegmentsWithCards` 签名 | 新增可选 `extraInstruction` / `maxCards`，向后兼容 |

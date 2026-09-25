# AI Analysis Segment Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 分析改造成“全文理解 -> AI 拆 segment -> 单段统一生成卡片”的流水线，并让单卡重生成复用同一条 segment card generation 逻辑。

**Architecture:** 在 `src/lib/ai-analysis.ts` 中拆出 segment planning 与 segment card generation 两个阶段；`AIAnalysisResult` 持久化 `segments`，每张卡片增加 `segmentId`；`analyzeSrt()` 负责 orchestration，`regenerateAICard()` 内部不再维护独立 prompt，而是按 `segmentId` 找回段落并复用单段生成逻辑。前端 IPC 与卡片列表 UI 尽量保持不变，只扩展消费结构。

**Tech Stack:** TypeScript 6, React 19, Zustand 5, Electron IPC, Vitest

---

## 文件清单

| 文件 | 操作 | 责任 |
|------|------|------|
| `src/types/ai.ts` | 修改 | 新增 `AISegment`，扩展 `AIAnalysisResult` 与 `AICard` |
| `src/lib/ai-analysis.ts` | 重构 | 新 pipeline、统一 prompt、统一单段卡片生成逻辑 |
| `src/lib/ai-persistence.ts` | 修改 | 切到 `version: 2` 严格 schema，移除旧 AI 结果兼容分支 |
| `src/lib/electron-api.ts` | 修改 | IPC 类型签名同步新结构 |
| `electron/main.ts` | 修改 | `analyze-srt` / `regenerate-ai-card` 走新 pipeline |
| `src/store/ai.ts` | 可能修改 | 若类型扩展影响 store 推导，补齐类型 |
| `src/components/AIPanel.tsx` | 可能修改 | 如有新结果字段导致渲染或持久化类型报错，做最小适配 |
| `src/hooks/useAICardInspector.ts` | 修改 | 单卡重生成继续走旧入口，但依赖新返回结构 |
| `tests/ai-analysis.test.ts` | 重写/修改 | 覆盖 segment planning、segment card generation、统一重生成 |
| `tests/ai-persistence.test.ts` | 修改 | 覆盖 `segments`、`segmentId` 与 `version: 2` 严格校验 |
| `tests/project-persistence.test.ts` | 修改 | 覆盖新结构在项目持久化中的保存与加载 |
| `tests/ai-panel.test.tsx` | 可能修改 | 如断言依赖 `AIAnalysisResult` 结构，补充 `segments` |

---

## Task 1: 扩展 AI 类型与持久化结构

**Files:**
- Modify: `src/types/ai.ts`
- Modify: `src/lib/ai-persistence.ts`
- Test: `tests/ai-persistence.test.ts`
- Test: `tests/project-persistence.test.ts`

- [ ] **Step 1: 在 `src/types/ai.ts` 新增 `AISegment` 类型**

添加：

```ts
export interface AISegment {
  id: string;
  title: string;
  summary: string;
  startMs: number;
  endMs: number;
  transcriptExcerpt?: string;
}
```

- [ ] **Step 2: 在 `src/types/ai.ts` 为 `AICard` 增加 `segmentId`**

插入字段：

```ts
segmentId: string;
```

放在 `id` 后面，便于快速定位。

- [ ] **Step 3: 在 `src/types/ai.ts` 扩展 `AIAnalysisResult`**

新增：

```ts
segments: AISegment[];
```

并检查所有直接构造 `AIAnalysisResult` 的位置，先记录受影响测试和调用点。

- [ ] **Step 4: 在 `src/lib/ai-persistence.ts` 增加 `AISegment` 校验函数**

新增：

```ts
function isAISegment(value: unknown): value is AISegment { ... }
```

要求校验：

- `id/title/summary` 为字符串
- `startMs/endMs` 为有限数字
- `transcriptExcerpt` 可选字符串

- [ ] **Step 5: 更新 `isAIAnalysisResult()`，允许 `segments` 缺失但支持新结构**

策略：

- `segments` 必须存在且为 `AISegment[]`
- 每张 `AICard` 必须存在 `segmentId`
- 不再接受旧结构

- [ ] **Step 6: 在 `createPersistedAIState()` / `normalizeAnalysisResult()` 中保留 `segments`**

确保新结构不会在持久化阶段被意外丢弃。

- [ ] **Step 7: 将 `PersistedAIState.version` 升级为 `2` 并严格解析**

要求：

- `createPersistedAIState()` 产出 `version: 2`
- `parsePersistedAIState()` 只接受 `version: 2`
- 旧结构直接返回 `null`

- [ ] **Step 8: 在 `tests/ai-persistence.test.ts` 新增新结构测试**

添加断言：

```ts
expect(parsePersistedAIState({
  version: 2,
  analysisResult: {
    segments: [{ id: 'seg-1', title: '段1', summary: '摘要', startMs: 0, endMs: 1000 }],
    cards: [...],
    coverPrompts: ['封面'],
    summary: '节目总结',
    keywords: ['AI'],
  },
  coverCandidates: [],
})).not.toBeNull();
```

- [ ] **Step 9: 在 `tests/ai-persistence.test.ts` 新增旧结构拒绝测试**

构造一个没有 `segments`、卡片也没有 `segmentId` 的旧对象，确保：

```ts
expect(parsePersistedAIState(legacyState)).toBeNull();
```

- [ ] **Step 10: 在 `tests/project-persistence.test.ts` 同步补新结构样例**

把直接写死的 `analysisResult` fixture 增加 `segments`，避免后续类型或断言失真。

- [ ] **Step 11: 运行持久化相关测试**

Run:

```bash
npx vitest run tests/ai-persistence.test.ts tests/project-persistence.test.ts
```

Expected:

- 新结构测试通过
- 旧结构拒绝测试通过

---

## Task 2: 重构 `ai-analysis.ts` 为 segment pipeline

**Files:**
- Modify: `src/lib/ai-analysis.ts`
- Test: `tests/ai-analysis.test.ts`

- [ ] **Step 1: 删除主流程对 `chunkSrtEntries()` 的依赖**

要求：

- `analyzeSrt()` 不再调用 `chunkSrtEntries()`
- 先不要急着删函数，先把主链路切走

- [ ] **Step 2: 在 `src/lib/ai-analysis.ts` 增加 planning 结果类型**

建议新增内部类型：

```ts
interface SegmentPlanningResult {
  segments: AISegment[];
  coverPrompts: string[];
  summary: string;
  keywords: string[];
  globalPrompt?: string;
}
```

- [ ] **Step 3: 新增 `buildSegmentPlanningPrompt(globalPrompt?)`**

要求：

- 只让模型输出节目级 summary / keywords / coverPrompts / segments
- 明确 segment 字段要求
- 不生成 `webCard`
- 仍保留“必须严格 JSON”

- [ ] **Step 4: 新增 `buildSegmentCardPrompt()`**

入参建议：

```ts
function buildSegmentCardPrompt(params: {
  fullTranscript: string;
  segment: AISegment;
  globalPrompt?: string;
  cardPrompt?: string;
  currentCard?: AICard;
  programSummary?: string;
  keywords?: string[];
}): string
```

要求：

- 首次生成和重生成统一使用
- 包含全文 context
- 包含 segment 结构化信息
- `currentCard` 仅作为延续线索
- 保留公共视觉/时间轴约束 helper

- [ ] **Step 5: 新增 `parseSegmentPlanningResult()`**

职责：

- 校验 AI 返回对象
- 解析 `segments`
- 清洗 `coverPrompts`
- 清洗 `summary/keywords/globalPrompt`

- [ ] **Step 6: 新增 `planTranscriptSegments()`**

签名建议：

```ts
export async function planTranscriptSegments(
  entries: SrtEntry[],
  settings: AISettings,
  options: AnalyzeSrtOptions = {},
): Promise<SegmentPlanningResult>
```

行为要求：

- 输入必须是完整字幕
- 调 `generateStructuredData(settings, planningPrompt, buildSrtText(entries))`
- 返回结构化 planning result
- 空字幕时报错

- [ ] **Step 7: 新增 `generateCardForSegment()`**

签名建议：

```ts
export async function generateCardForSegment(
  entries: SrtEntry[],
  planning: SegmentPlanningResult,
  segment: AISegment,
  settings: AISettings,
  options?: {
    generateStructuredData?: typeof generateStructuredData;
    globalPrompt?: string;
    cardPrompt?: string;
    currentCard?: AICard;
  },
): Promise<AICard>
```

行为要求：

- `buildSrtText(entries)` 作为全文 context
- 返回的 card 必须强制补齐 `segmentId: segment.id`
- 若模型缺失 `segmentId`，也由业务层补齐
- 若模型缺失 `id`，沿用当前逻辑生成兜底 id

- [ ] **Step 8: 重写 `analyzeSrt()`**

目标流程：

```ts
const planning = await planTranscriptSegments(...);
const cards = [];
for (const segment of planning.segments) {
  cards.push(await generateCardForSegment(entries, planning, segment, settings, ...));
}
return { segments: planning.segments, cards, ... };
```

特别要求：

- 不再 `mergeAnalysisResults()`
- 不再做 token chunk merge

- [ ] **Step 9: 为全文超长输入增加显式错误**

如果后续 LLM provider 返回上下文过长错误，不做静默 chunk fallback。  
至少保证错误会直接向上抛，并在文案中保留原始模型错误。

- [ ] **Step 10: 用统一逻辑改写 `regenerateAICard()`**

新逻辑：

- 入参显式接收 `segment: AISegment`
- 若未传 `segment`，直接抛错
- 调 `generateCardForSegment(..., { currentCard: card, cardPrompt })`
- 返回时保留原卡片 `id` 与 `enabled`

- [ ] **Step 11: 清理无效 helper 或标记旧函数退役**

处理对象：

- `buildAnalysisPrompt()`
- `buildCardRegenerationPrompt()`
- `mergeAnalysisResults()`
- `getCardContextEntries()`
- `chunkSrtEntries()`

策略：

- 若暂时保留，则明确不再用于主流程
- 若删除，先同步更新测试

- [ ] **Step 12: 重写 `tests/ai-analysis.test.ts`**

重点新增或改写以下测试：

- `buildSegmentPlanningPrompt` 返回要求包含 `segments`
- `buildSegmentCardPrompt` 同时包含全文 context 和 segment 信息
- `analyzeSrt` 调用 planning + per-segment generation
- `regenerateAICard` 复用 `generateCardForSegment`
- `regenerateAICard` 缺少 `segment` 时会失败

- [ ] **Step 13: 运行 AI 分析相关测试**

Run:

```bash
npx vitest run tests/ai-analysis.test.ts
```

Expected:

- 所有新旧测试通过
- 不再断言 `chunkSrtEntries()` 参与主流程

---

## Task 3: 更新 IPC 与 Renderer API 类型

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/lib/electron-api.ts`
- Possibly Modify: `electron/preload.ts`

- [ ] **Step 1: 更新 `src/lib/electron-api.ts` 的类型引用**

确保：

- `regenerateAICard` 返回的 `AICard` 已包含 `segmentId`
- `regenerateAICard` 请求参数新增 `segment: AISegment`
- `analyzeSrt` 返回的新 `AIAnalysisResult` 类型可被 renderer 正确推断

- [ ] **Step 2: 检查 `electron/preload.ts` 是否需要类型同步**

如果 preload 直接依赖 AI 类型或 `contextBridge` 暴露的方法签名有显式类型，补齐。

- [ ] **Step 3: 在 `electron/main.ts` 保持 IPC 名称不变，切换内部逻辑**

要求：

- `analyze-srt` 继续调用 `analyzeSrt()`
- `regenerate-ai-card` 继续调用 `regenerateAICard()`
- 外部调用方无需感知新 pipeline

- [ ] **Step 4: 为新的报错路径保留日志**

确保全文过长或 segment 解析失败时，仍会通过 `writeAppLog('error', 'ai-analysis', ...)` 打印细节。

- [ ] **Step 5: 做一次 TypeScript 编译检查**

Run:

```bash
npx tsc --noEmit
```

Expected:

- AI 类型扩展不会破坏 Electron/Renderer API 边界

---

## Task 4: 让前端消费新结构但保持现有 UI 行为

**Files:**
- Modify: `src/hooks/useAICardInspector.ts`
- Possibly Modify: `src/components/AIPanel.tsx`
- Possibly Modify: `src/store/ai.ts`
- Possibly Modify: `src/App.tsx`
- Possibly Modify: `src/pages/Editor.tsx`

- [ ] **Step 1: 在 `src/hooks/useAICardInspector.ts` 确认重生成仍只走一个入口**

要求：

- UI 行为不变
- 仍然调用 `window.electronAPI.regenerateAICard(...)`
- 调用前先从 `analysisResult.segments` 中找到当前卡片的 `segment`
- 不新增前端层 prompt 分叉逻辑

- [ ] **Step 2: 检查 `draftCard` 合并逻辑是否保留 `segmentId`**

在构造 `draftCard` 时确保：

- `segmentId` 不会因局部编辑而丢失
- 即便 `draftUpdates` 不含 `segmentId`，原值也能保留

- [ ] **Step 3: 检查 `AIPanel` 与 store 对新 `analysisResult.segments` 的兼容**

目标：

- UI 仍以 `cards` 为中心
- 但新的 `analysisResult` 结构不会导致序列化、反序列化或渲染报错
- 不需要为旧 `analysisResult` 做兼容分支

- [ ] **Step 4: 如需更新默认 fixture，同步补 `segments`**

常见位置：

- `tests/ai-panel.test.tsx`
- `tests/ai-store.test.ts`
- 其它直接构造 `AIAnalysisResult` 的测试

- [ ] **Step 5: 运行面板和 store 相关测试**

Run:

```bash
npx vitest run tests/ai-panel.test.tsx tests/ai-store.test.ts
```

Expected:

- 卡片列表仍能显示
- 单卡重生成相关流程不报类型或结构错误

---

## Task 5: 补齐严格 schema 下的回归验证

**Files:**
- Modify: `tests/project-file.test.ts`
- Possibly Modify: `tests/ai-video-workflow-regression.test.ts`
- Possibly Modify: `tests/timeline-ai-overlay.test.tsx`

- [ ] **Step 1: 在 `tests/project-file.test.ts` 新增旧 AI 结果失效样例**

构造一个旧版 `analysisResult`：

- 无 `segments`
- card 无 `segmentId`

验证它在加载后会被视为无效 AI 分析结果，而不是继续进入新流程。

- [ ] **Step 2: 如 `analysisResult` fixture 被多个测试共享，统一补一个 builder**

如果当前多个测试里都手写 `AIAnalysisResult`，建议抽公共 helper，避免后续每次加字段都要四处改。

- [ ] **Step 3: 运行受影响回归测试**

Run:

```bash
npx vitest run tests/project-file.test.ts tests/ai-video-workflow-regression.test.ts tests/timeline-ai-overlay.test.tsx
```

Expected:

- 项目持久化正常
- AI 工作流回归测试正常
- 时间轴 AI overlay 不受 `segmentId` 扩展影响

- [ ] **Step 4: 做一次最终的聚合验证**

Run:

```bash
npx vitest run tests/ai-analysis.test.ts tests/ai-persistence.test.ts tests/project-persistence.test.ts tests/project-file.test.ts tests/ai-panel.test.tsx tests/ai-store.test.ts
```

Expected:

- 新 pipeline 相关核心测试全部通过
- 严格 schema 行为符合预期

---

## 收尾说明

- 本计划默认不在本轮新增“段落列表 UI”
- 本计划默认不保留双 prompt 主流程
- 本计划默认不保留旧 AI 结果兼容逻辑
- 若实现中发现上下文窗口不足导致体验不可接受，再单独立一个 spec 讨论“超长全文上下文降级策略”，不要在本轮偷偷把本地 chunk 加回来

---

Plan complete and saved to `docs/superpowers/plans/2026-04-13-ai-analysis-segment-pipeline.md`. Ready to execute?

# AI 视觉编排系统 V1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于字幕自动生成统一的“内容卡片 + 动画建议”，支持建议模式与全自动模式，并把结果应用到底部时间轴。

**Architecture:** 在现有 `SRT -> 内容卡片分析` 与 `Prompt -> motion card` 两条链路之间新增 `Storyboard Planner`。Planner 负责把字幕分段结果提升为 `AISegmentAnalysis` 和 `AIVisualSuggestion`，再由模板渲染层将建议转成卡片或动画产物，最终统一落到双 AI 轨和建议预览层。

**Tech Stack:** React 19、TypeScript、Zustand、Vitest、Remotion、现有 AI 分析与 motion card 基础设施。

---

## Chunk 1: 数据模型与持久化

### Task 1: 扩展 AI 类型定义

**Files:**
- Modify: `src/types/ai.ts`
- Modify: `src/types/motion.ts`
- Test: `tests/ai-storyboard-types.test.ts`

- [ ] **Step 1: 写失败测试，锁定新类型的基本结构**

```ts
import { describe, expect, it } from 'vitest';
import { buildDefaultStoryboardPlan } from '../src/types/ai';

describe('storyboard types', () => {
  it('builds an empty storyboard plan', () => {
    expect(buildDefaultStoryboardPlan().suggestions).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/ai-storyboard-types.test.ts`
Expected: FAIL，提示 `buildDefaultStoryboardPlan` 未定义

- [ ] **Step 3: 在 `src/types/ai.ts` 增加下列类型**

```ts
export interface AISegmentAnalysis { /* spec 中定义 */ }
export interface AIVisualSuggestion { /* spec 中定义 */ }
export interface AIStoryboardPlan { /* spec 中定义 */ }
export function buildDefaultStoryboardPlan(): AIStoryboardPlan {
  return { segments: [], suggestions: [], summary: '', generatedAt: 0 };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/ai-storyboard-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai-storyboard-types.test.ts src/types/ai.ts src/types/motion.ts
git commit -m "feat(ai): add storyboard planning types"
```

### Task 2: 扩展项目级 AI 持久化

**Files:**
- Modify: `src/lib/ai-persistence.ts`
- Modify: `src/lib/project-persistence.ts`
- Modify: `src/store/ai.ts`
- Test: `tests/ai-persistence-storyboard.test.ts`

- [ ] **Step 1: 写失败测试，验证 storyboard 进入持久化结构**

```ts
import { describe, expect, it } from 'vitest';
import { createPersistedAIState } from '../src/lib/ai-persistence';

describe('ai persistence storyboard', () => {
  it('stores storyboard plan when provided', () => {
    const state = createPersistedAIState(null, [], [], {
      segments: [],
      suggestions: [],
      summary: '',
      generatedAt: 1,
    });
    expect(state.storyboardPlan?.generatedAt).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/ai-persistence-storyboard.test.ts`
Expected: FAIL，提示 `storyboardPlan` 不存在

- [ ] **Step 3: 扩展 `PersistedAIState` 与 `AIStore`**

```ts
interface PersistedAIState {
  version: 3;
  analysisResult: AIAnalysisResult | null;
  coverCandidates: CoverCandidate[];
  motionCards?: AICard[];
  storyboardPlan?: AIStoryboardPlan | null;
}
```

并在 store 中新增：

```ts
storyboardPlan: AIStoryboardPlan | null;
autoApplyVisualSuggestions: boolean;
setStoryboardPlan(...)
setAutoApplyVisualSuggestions(...)
```

- [ ] **Step 4: 运行测试与相关旧测试**

Run: `npm test -- tests/ai-persistence-storyboard.test.ts tests/ai-card-list.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai-persistence-storyboard.test.ts src/lib/ai-persistence.ts src/lib/project-persistence.ts src/store/ai.ts
git commit -m "feat(ai): persist storyboard planning state"
```

---

## Chunk 2: 字幕分析与编排决策

### Task 3: 在 AI 分析层补齐段落可视化分析

**Files:**
- Modify: `src/lib/ai-analysis.ts`
- Test: `tests/ai-segment-analysis.test.ts`

- [ ] **Step 1: 写失败测试，验证段落分析字段**

```ts
import { describe, expect, it } from 'vitest';
import { parseSegmentPlanningResult } from '../src/lib/ai-analysis';

describe('segment analysis parsing', () => {
  it('parses semantic and visualization fields', () => {
    const result = parseSegmentPlanningResult({
      segments: [{
        id: 's1',
        title: '增长',
        summary: '讲增长',
        startMs: 0,
        endMs: 3000,
        semanticType: 'data',
        complexityLevel: 'medium',
        visualizationScore: 88,
        pacingNeed: 'accent',
        keywords: ['增长'],
        entities: ['营收'],
      }],
      coverPrompts: [],
      summary: '',
      keywords: [],
    });
    expect(result?.segments[0].visualizationScore).toBe(88);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/ai-segment-analysis.test.ts`
Expected: FAIL，提示 `visualizationScore` 或相关字段未解析

- [ ] **Step 3: 更新 prompt 与 normalize 逻辑**

重点修改：

- `buildSegmentPlanningPrompt()`
- `normalizeSegment()`
- `SegmentPlanningResult`

让 LLM 返回并解析：

- `semanticType`
- `complexityLevel`
- `visualizationScore`
- `pacingNeed`
- `keywords`
- `entities`

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/ai-segment-analysis.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai-segment-analysis.test.ts src/lib/ai-analysis.ts
git commit -m "feat(ai): enrich segment analysis for storyboard planning"
```

### Task 4: 新增 Storyboard Planner

**Files:**
- Create: `src/lib/storyboard-planner.ts`
- Test: `tests/storyboard-planner.test.ts`

- [ ] **Step 1: 写失败测试，验证建议生成**

```ts
import { describe, expect, it } from 'vitest';
import { buildStoryboardSuggestions } from '../src/lib/storyboard-planner';

describe('storyboard planner', () => {
  it('creates data motion suggestion for high-score data segment', () => {
    const plan = buildStoryboardSuggestions([{
      id: 's1',
      startMs: 0,
      endMs: 4000,
      title: '增长数据',
      summary: '营收上涨',
      semanticType: 'data',
      complexityLevel: 'medium',
      visualizationScore: 90,
      pacingNeed: 'accent',
      keywords: ['增长'],
      entities: ['营收'],
    }]);
    expect(plan.suggestions[0].suggestionType).toBe('data-motion');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/storyboard-planner.test.ts`
Expected: FAIL，提示模块不存在

- [ ] **Step 3: 实现规划函数**

```ts
export function buildStoryboardSuggestions(
  segments: AISegmentAnalysis[],
): AIStoryboardPlan {
  // 基于 semanticType + visualizationScore + pacingNeed 产出 suggestion
}
```

实现要求：

- 数据高分段优先出 `data-motion`
- 解释型高复杂度段优先出 `explainer-motion`
- 转场段优先出 `chapter-transition`
- 低分或高密度段降级为 `content-card`

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/storyboard-planner.test.ts tests/ai-segment-analysis.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/storyboard-planner.test.ts src/lib/storyboard-planner.ts
git commit -m "feat(ai): add storyboard suggestion planner"
```

---

## Chunk 3: 模板动画与统一产物生成

### Task 5: 新增模板化视觉产物生成服务

**Files:**
- Create: `src/lib/visual-template-service.ts`
- Create: `src/remotion/templates/KpiCountup.tsx`
- Create: `src/remotion/templates/BarChartReveal.tsx`
- Create: `src/remotion/templates/RankingStack.tsx`
- Create: `src/remotion/templates/BeforeAfterCompare.tsx`
- Create: `src/remotion/templates/StepFlowExplainer.tsx`
- Create: `src/remotion/templates/ChapterStinger.tsx`
- Test: `tests/visual-template-service.test.ts`

- [ ] **Step 1: 写失败测试，验证 suggestion 能转为可上轨产物**

```ts
import { describe, expect, it } from 'vitest';
import { buildVisualAssetFromSuggestion } from '../src/lib/visual-template-service';

describe('visual template service', () => {
  it('creates motion asset from data motion suggestion', () => {
    const asset = buildVisualAssetFromSuggestion({
      id: 'v1',
      segmentId: 's1',
      suggestionType: 'data-motion',
      priority: 1,
      reason: '需要强调数据',
      enabled: true,
      startMs: 0,
      endMs: 4000,
      displayDurationMs: 3000,
      displayMode: 'fullscreen',
      templateKey: 'kpi-countup',
      visualBrief: '营收上涨 12%',
      autoApplyEligible: true,
    });
    expect(asset.renderMode).toBe('motion-card');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/visual-template-service.test.ts`
Expected: FAIL，提示服务不存在

- [ ] **Step 3: 实现模板服务**

要求：

- 内容卡片 suggestion 转为 `AICard`
- 模板动画 suggestion 转为带 `motionCard` 的 `AICard`
- 模板组件使用稳定的结构化 props
- 自由生成逻辑暂不进入默认路径

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/visual-template-service.test.ts tests/motion-card-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/visual-template-service.test.ts src/lib/visual-template-service.ts src/remotion/templates
git commit -m "feat(remotion): add storyboard visual templates"
```

### Task 6: 增加自动降级策略

**Files:**
- Modify: `src/lib/visual-template-service.ts`
- Modify: `src/lib/motion-card-service.ts`
- Test: `tests/visual-fallback.test.ts`

- [ ] **Step 1: 写失败测试，验证模板失败时自动降级**

```ts
import { describe, expect, it } from 'vitest';
import { resolveSuggestionFallback } from '../src/lib/visual-template-service';

describe('visual fallback', () => {
  it('downgrades failed data motion to content card', () => {
    expect(resolveSuggestionFallback('data-motion')).toBe('content-card');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/visual-fallback.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现固定降级链路**

```ts
高级自由动画 -> 模板动画 -> 内容卡片 -> 跳过
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/visual-fallback.test.ts tests/visual-template-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/visual-fallback.test.ts src/lib/visual-template-service.ts src/lib/motion-card-service.ts
git commit -m "feat(ai): add storyboard visual fallback rules"
```

---

## Chunk 4: AI 面板与 Inspector 交互

### Task 7: 新增“视觉编排”面板状态与列表

**Files:**
- Modify: `src/components/AIPanel.tsx`
- Create: `src/components/AIVisualSuggestionList.tsx`
- Create: `src/components/AIVisualSuggestionItem.tsx`
- Modify: `src/components/AIPanel.module.css`
- Test: `tests/ai-visual-suggestion-list.test.tsx`

- [ ] **Step 1: 写失败测试，锁定新标签页与自动应用开关**

```tsx
import { render, screen } from '@testing-library/react';
import { AIPanel } from '../src/components/AIPanel';

it('shows storyboard tab and auto apply toggle', () => {
  render(<AIPanel compact={false} />);
  expect(screen.getByText('视觉编排')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/ai-visual-suggestion-list.test.tsx`
Expected: FAIL

- [ ] **Step 3: 修改 AI 面板结构**

要求：

- `motion` tab 更名并升级为 `视觉编排`
- 增加自动应用开关
- 建议列表展示 `AIVisualSuggestion[]`
- 建议模式下显示“应用到时间轴”按钮

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/ai-visual-suggestion-list.test.tsx tests/ai-card-list.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai-visual-suggestion-list.test.tsx src/components/AIPanel.tsx src/components/AIVisualSuggestionList.tsx src/components/AIVisualSuggestionItem.tsx src/components/AIPanel.module.css
git commit -m "feat(ui): add storyboard suggestion panel"
```

### Task 8: 引入统一 AIVisualInspector

**Files:**
- Create: `src/components/AIVisualInspector.tsx`
- Modify: `src/components/EditorInspector.tsx`
- Modify: `src/components/MotionCardInspector.tsx`
- Modify: `src/components/AICardInspector.tsx`
- Test: `tests/ai-visual-inspector.test.tsx`

- [ ] **Step 1: 写失败测试，验证 suggestion 进入统一 inspector**

```tsx
import { render, screen } from '@testing-library/react';
import { AIVisualInspector } from '../src/components/AIVisualInspector';

it('renders shared fields for visual suggestion', () => {
  render(<AIVisualInspector suggestion={{ id: 'v1', suggestionType: 'content-card' }} />);
  expect(screen.getByText('显示模式')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/ai-visual-inspector.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现统一 inspector**

实现要求：

- 通用字段与类型特有字段分区
- 动画项保留进入高级模式入口
- 高级模式再转到现有 motion card 编辑能力

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/ai-visual-inspector.test.tsx tests/editor-inspector.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai-visual-inspector.test.tsx src/components/AIVisualInspector.tsx src/components/EditorInspector.tsx src/components/MotionCardInspector.tsx src/components/AICardInspector.tsx
git commit -m "feat(ui): unify ai visual inspector"
```

---

## Chunk 5: 时间轴预览层与双 AI 轨落地

### Task 9: 增加双 AI 轨与建议预览层

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/timeline-tracks.ts`
- Modify: `src/store/timeline.ts`
- Create: `src/components/TimelineVisualSuggestions.tsx`
- Modify: `src/components/Timeline.tsx`
- Test: `tests/timeline-visual-suggestions.test.tsx`

- [ ] **Step 1: 写失败测试，验证双 AI 轨存在**

```ts
import { createDefaultTimeline } from '../src/types';

it('creates separate ai card and ai motion tracks', () => {
  const timeline = createDefaultTimeline();
  expect(timeline.tracks.some((track) => track.id === 'visual-ai-cards')).toBe(true);
  expect(timeline.tracks.some((track) => track.id === 'visual-ai-motion')).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/timeline-visual-suggestions.test.tsx`
Expected: FAIL

- [ ] **Step 3: 扩展时间轴与预览层**

实现要求：

- 新增 `AI 卡片轨`
- 新增 `AI 动画轨`
- `addStoryboardVisualsToTimeline()` 根据 suggestion 类型选择默认轨
- `Timeline` 支持渲染未应用的建议预览块

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/timeline-visual-suggestions.test.tsx tests/timeline-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/timeline-visual-suggestions.test.tsx src/types.ts src/lib/timeline-tracks.ts src/store/timeline.ts src/components/TimelineVisualSuggestions.tsx src/components/Timeline.tsx
git commit -m "feat(timeline): add storyboard preview layer and dual ai tracks"
```

### Task 10: 接入全自动应用与密度控制

**Files:**
- Modify: `src/hooks/useAIVideoWorkflow.ts`
- Modify: `src/lib/storyboard-planner.ts`
- Modify: `src/components/TimelineAIOverlay.tsx`
- Test: `tests/ai-visual-auto-apply.test.tsx`

- [ ] **Step 1: 写失败测试，验证自动应用开关会触发落轨**

```tsx
import { describe, expect, it } from 'vitest';
import { shouldAutoApplyStoryboard } from '../src/lib/storyboard-planner';

describe('auto apply storyboard', () => {
  it('allows eligible suggestion when auto apply is enabled', () => {
    expect(shouldAutoApplyStoryboard(true, [{ autoApplyEligible: true }])).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/ai-visual-auto-apply.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现自动应用与密度控制**

要求：

- workflow 结束后若自动应用开启，则直接落轨
- 同一时间只允许 1 个 fullscreen
- 每个 segment 默认最多 1 个主视觉
- 连续 20 秒强视觉块数量受限

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/ai-visual-auto-apply.test.tsx tests/timeline-ai-overlay.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai-visual-auto-apply.test.tsx src/hooks/useAIVideoWorkflow.ts src/lib/storyboard-planner.ts src/components/TimelineAIOverlay.tsx
git commit -m "feat(ai): auto apply storyboard suggestions with density guardrails"
```

---

## Chunk 6: 整体验证与收尾

### Task 11: 跑回归测试并修正文案/样式遗漏

**Files:**
- Modify: `src/components/*.tsx`（按实际回归结果精确修改）
- Modify: `src/components/*.module.css`（按实际回归结果精确修改）
- Test: `tests/ai-visual-suggestion-list.test.tsx`
- Test: `tests/ai-visual-inspector.test.tsx`
- Test: `tests/timeline-visual-suggestions.test.tsx`
- Test: `tests/ai-visual-auto-apply.test.tsx`

- [ ] **Step 1: 运行核心回归测试**

Run:

```bash
npm test -- tests/ai-visual-suggestion-list.test.tsx tests/ai-visual-inspector.test.tsx tests/timeline-visual-suggestions.test.tsx tests/ai-visual-auto-apply.test.tsx tests/motion-card-service.test.ts tests/timeline-store.test.ts
```

Expected: 全部 PASS

- [ ] **Step 2: 若失败，精确修复最小范围问题**

优先检查：

- 文案是否与测试一致
- 新轨道 id 是否与时间轴逻辑一致
- 建议预览层是否误进入正式 overlay 渲染

- [ ] **Step 3: 再跑一次完整相关回归**

Run:

```bash
npm test -- tests/ai-visual-suggestion-list.test.tsx tests/ai-visual-inspector.test.tsx tests/timeline-visual-suggestions.test.tsx tests/ai-visual-auto-apply.test.tsx tests/motion-card-service.test.ts tests/editor-inspector.test.tsx tests/timeline-store.test.ts
```

Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "test(ai): verify storyboard visual orchestration flow"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-13-ai-visual-storyboard.md`. Ready to execute?

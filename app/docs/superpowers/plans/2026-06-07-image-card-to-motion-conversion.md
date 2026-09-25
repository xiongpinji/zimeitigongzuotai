# 图片卡 → Motion 动画卡 转换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让编辑器里的 image/video 内容卡能通过 AI 面板下拉菜单和时间线右键菜单一键转换为 motion 动画卡（自动调 LLM 生成 Remotion TSX）。

**Architecture:** 新增纯函数 helper（转换路径规划 + 保号合并）+ 一个 `convertCardToMotion` store 动作作为两个入口的唯一调用点。有真实背景段的 AI 卡走 `regenerateAICard` IPC，手动插入卡走 `generateCardFromSubtitles` IPC。无任何 IPC 名称/参数变更。

**Tech Stack:** React 19 / TypeScript / Zustand / Vitest（node + SSR，无 jsdom）。

参考 spec：`docs/superpowers/specs/2026-06-07-image-card-to-motion-conversion-design.md`

---

## 文件结构

- **Create** `src/lib/ai-card-conversion.ts` — 纯函数：`planMotionConversion`（决定走 segment 还是 subtitles 路径、合成 draft）+ `mergeMotionConversionResult`（保号合并生成结果）。无副作用、可纯单测。
- **Create** `tests/ai-card-conversion.test.ts` — helper 单测。
- **Modify** `src/store/ai.ts` — 新增 `convertCardToMotion` 动作 + 接口声明 + 必要 import。
- **Modify** `tests/store-ai-card-media.test.ts` — `convertCardToMotion` 集成测试。
- **Modify** `src/lib/timeline-context-menu.ts` — 新增 `convert-to-motion` action key + 菜单项 + `convertibleToMotion` 入参。
- **Modify** `tests/timeline-context-menu.test.ts` — 菜单项可见/禁用断言。
- **Modify** `src/components/AICardList.tsx` — 「转为动画卡」下拉项 + 行内 converting 状态。
- **Modify** `tests/ai-card-list.test.tsx` — 下拉项存在/禁用 + 点击调用断言。
- **Modify** `src/components/Timeline.tsx` — 右键菜单 handler 接 `convert-to-motion` + overlay 菜单传 `convertibleToMotion`。

---

## Task 1: 纯函数 helper（转换路径规划 + 保号合并）

**Files:**
- Create: `src/lib/ai-card-conversion.ts`
- Test: `tests/ai-card-conversion.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/ai-card-conversion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  planMotionConversion,
  mergeMotionConversionResult,
} from '../src/lib/ai-card-conversion';
import type { AIAnalysisResult, AICard, MediaCardContent } from '../src/types/ai';

function imageCard(overrides: Partial<AICard> = {}): AICard {
  const content: MediaCardContent = {
    mediaType: 'image',
    assetPath: 'ai-cards/c/image.png',
    aspectRatio: '16:9',
    prompt: '一只猫',
    providerId: null,
    model: null,
    generationStatus: 'ready',
  };
  return {
    id: 'card-1',
    segmentId: 'seg-1',
    type: 'image',
    title: '原标题',
    content,
    startMs: 1000,
    endMs: 4000,
    displayDurationMs: 3000,
    displayMode: 'fullscreen',
    template: 'image',
    enabled: true,
    style: {} as AICard['style'],
    renderMode: 'legacy',
    ...overrides,
  };
}

function analysis(): AIAnalysisResult {
  return {
    segments: [{ id: 'seg-1', title: 't', summary: 's', startMs: 1000, endMs: 4000 }],
    cards: [],
    coverPrompts: [],
    summary: '',
    keywords: [],
  };
}

describe('planMotionConversion', () => {
  it('已是 motion 家族 → noop', () => {
    expect(planMotionConversion(imageCard({ type: 'motion' }), analysis())).toEqual({
      kind: 'noop',
    });
  });

  it('命中背景段 → segment 路径', () => {
    const plan = planMotionConversion(imageCard(), analysis());
    expect(plan.kind).toBe('segment');
    if (plan.kind === 'segment') expect(plan.segment.id).toBe('seg-1');
  });

  it('无背景段（手动卡）→ subtitles 路径，draft 用 prompt/时间兜底', () => {
    const card = imageCard({ segmentId: 'manual:x', startMs: 0, endMs: 0, displayDurationMs: 5000 });
    const plan = planMotionConversion(card, analysis());
    expect(plan.kind).toBe('subtitles');
    if (plan.kind === 'subtitles') {
      expect(plan.draft.type).toBe('motion');
      expect(plan.draft.text).toBe('一只猫');
      expect(plan.draft.startMs).toBe(0);
      expect(plan.draft.endMs).toBe(5000); // start>=end → start + displayDurationMs
      expect(plan.draft.displayDurationMs).toBe(5000);
    }
  });
});

describe('mergeMotionConversionResult', () => {
  it('保留原 id/segmentId/时间/displayMode/enabled/title，接管 motion 字段', () => {
    const original = imageCard();
    const generated = imageCard({
      id: 'NEW',
      segmentId: 'manual-999',
      title: '生成标题',
      type: 'motion',
      content: '逐字稿文本',
      renderMode: 'motion-card',
      startMs: 0,
      endMs: 5000,
      displayDurationMs: 5000,
      motionCard: { tsx: 'export default () => null', compiledAt: 0, prompt: '', retryCount: 0 },
    });
    const merged = mergeMotionConversionResult(original, generated);
    expect(merged.id).toBe('card-1');
    expect(merged.segmentId).toBe('seg-1');
    expect(merged.title).toBe('原标题');
    expect(merged.startMs).toBe(1000);
    expect(merged.endMs).toBe(4000);
    expect(merged.displayMode).toBe('fullscreen');
    expect(merged.enabled).toBe(true);
    expect(merged.displayDurationMs).toBe(3000); // 原有效值优先
    expect(merged.type).toBe('motion');
    expect(merged.renderMode).toBe('motion-card');
    expect(merged.content).toBe('逐字稿文本');
    expect(merged.motionCard?.tsx).toContain('export default');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/ai-card-conversion.test.ts`
Expected: FAIL（模块/导出不存在）。

- [ ] **Step 3: 实现 helper**

Create `src/lib/ai-card-conversion.ts`:

```ts
import type { AIAnalysisResult, AICard, AISegment, MediaCardContent } from '../types/ai';
import type { SubtitleCardDraftInput } from './ai-analysis';

/** image/video 卡转 motion 时的执行计划。 */
export type MotionConversionPlan =
  | { kind: 'segment'; segment: AISegment }
  | { kind: 'subtitles'; draft: SubtitleCardDraftInput }
  | { kind: 'noop' };

/** 手动卡无有效时长时的兜底展示时长（ms）。 */
const FALLBACK_DURATION_MS = 5000;

function getMediaPrompt(card: AICard): string {
  if (card.content && typeof card.content === 'object' && 'mediaType' in card.content) {
    return (card.content as MediaCardContent).prompt ?? '';
  }
  return '';
}

/**
 * 决定一张卡片转 motion 的路径：
 * - 非 image/video → 'noop'（已是 motion 家族，无需转换）。
 * - 命中 analysisResult.segments → 'segment'（用真实字幕逐字稿生成）。
 * - 否则（手动插入卡）→ 'subtitles'（用 title/prompt + 时间范围合成草稿）。
 */
export function planMotionConversion(
  card: AICard,
  analysis: AIAnalysisResult | null,
): MotionConversionPlan {
  if (card.type !== 'image' && card.type !== 'video') {
    return { kind: 'noop' };
  }

  const segment = analysis?.segments.find((s) => s.id === card.segmentId);
  if (segment) {
    return { kind: 'segment', segment };
  }

  const duration =
    Number.isFinite(card.displayDurationMs) && card.displayDurationMs > 0
      ? Math.round(card.displayDurationMs)
      : FALLBACK_DURATION_MS;
  const startMs =
    Number.isFinite(card.startMs) && card.startMs >= 0 ? Math.round(card.startMs) : 0;
  const endMs =
    Number.isFinite(card.endMs) && card.endMs > startMs ? Math.round(card.endMs) : startMs + duration;
  const text = getMediaPrompt(card).trim() || card.title?.trim() || '动画卡片';

  const draft: SubtitleCardDraftInput = {
    text,
    startMs,
    endMs,
    displayDurationMs: duration,
    type: 'motion',
    promptHint: card.cardPrompt?.trim() || card.title?.trim() || undefined,
  };
  return { kind: 'subtitles', draft };
}

/**
 * 把生成结果合并回原卡片：保号（id/segmentId/时间/displayMode/enabled/title），
 * 接管 motion 相关字段（type/renderMode/content/motionCard/style/template）。
 * 时间线 overlay 以 sourceCardId === card.id 关联，保号确保已上轨卡片不断链。
 */
export function mergeMotionConversionResult(original: AICard, generated: AICard): AICard {
  return {
    ...generated,
    id: original.id,
    segmentId: original.segmentId,
    title: original.title,
    startMs: original.startMs,
    endMs: original.endMs,
    displayMode: original.displayMode,
    enabled: original.enabled,
    displayDurationMs:
      Number.isFinite(original.displayDurationMs) && original.displayDurationMs > 0
        ? original.displayDurationMs
        : generated.displayDurationMs,
    cardPrompt: original.cardPrompt?.trim() || generated.cardPrompt,
    type:
      generated.type === 'image' || generated.type === 'video' ? 'motion' : generated.type,
    renderMode: 'motion-card',
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/ai-card-conversion.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/ai-card-conversion.ts tests/ai-card-conversion.test.ts
git commit -m "feat(ai-card): 新增 image→motion 转换的纯函数 helper"
```

---

## Task 2: `convertCardToMotion` store 动作

**Files:**
- Modify: `src/store/ai.ts`（接口声明区 ~`convertCardToMedia` 附近；实现区 ~`convertCardToMedia` 之后）
- Test: `tests/store-ai-card-media.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/store-ai-card-media.test.ts` 的 `describe('AI store: media card actions', ...)` 末尾（最后一个 `it` 之后、`})` 之前）追加：

```ts
  it('convertCardToMotion: 有背景段 → 走 regenerateAICard 并保号', async () => {
    useAIStore.setState({
      analysisResult: {
        segments: [{ id: 'seg-1', title: 't', summary: 's', startMs: 0, endMs: 1000 }],
        cards: [
          {
            id: 'card-x',
            segmentId: 'seg-1',
            type: 'image',
            title: '原标题',
            content: {
              mediaType: 'image',
              assetPath: 'ai-cards/c/i.png',
              aspectRatio: '16:9',
              prompt: 'p',
              providerId: null,
              model: null,
              generationStatus: 'ready',
            },
            startMs: 0,
            endMs: 1000,
            displayDurationMs: 1000,
            displayMode: 'fullscreen',
            template: 'image',
            enabled: true,
            style: {} as never,
            renderMode: 'legacy',
          },
        ],
        coverPrompts: [],
        summary: '',
        keywords: [],
      },
      currentProjectDir: '/tmp/proj',
      projectBindings: null,
    });

    const calls: { regen: number; subs: number } = { regen: 0, subs: 0 };
    vi.stubGlobal('window', {
      electronAPI: {
        loadGlobalSettings: async () =>
          JSON.stringify({
            aiSettings: {
              llmProviders: [{ id: 'p1', name: 'p', type: 'openai', baseUrl: 'x', apiKey: 'k', models: ['m'] }],
              defaultProviderId: 'p1',
              defaultModel: 'm',
            },
          }),
        regenerateAICard: async (args: { card: { id: string } }) => {
          calls.regen += 1;
          return {
            ...args.card,
            id: args.card.id,
            type: 'motion',
            content: '逐字稿',
            renderMode: 'motion-card',
            motionCard: { tsx: 'export default () => null', compiledAt: 0, prompt: '', retryCount: 0 },
          };
        },
        generateCardFromSubtitles: async () => {
          calls.subs += 1;
          throw new Error('不该走到 subtitles 路径');
        },
        saveProjectSection: async () => undefined,
      },
    });

    const result = await useAIStore.getState().convertCardToMotion('card-x');
    expect(calls.regen).toBe(1);
    expect(calls.subs).toBe(0);
    expect(result?.type).toBe('motion');
    expect(result?.renderMode).toBe('motion-card');
    const stored = useAIStore.getState().analysisResult!.cards.find((c) => c.id === 'card-x')!;
    expect(stored.type).toBe('motion');
    expect(stored.title).toBe('原标题'); // 保号
    expect(stored.motionCard?.tsx).toContain('export default');
  });

  it('convertCardToMotion: 无背景段（手动卡）→ 走 generateCardFromSubtitles', async () => {
    useAIStore.setState({
      analysisResult: {
        segments: [],
        cards: [
          {
            id: 'manual-1',
            segmentId: 'manual:abc',
            type: 'image',
            title: '手动卡',
            content: {
              mediaType: 'image',
              assetPath: null,
              aspectRatio: '16:9',
              prompt: '海边日落',
              providerId: null,
              model: null,
              generationStatus: 'idle',
            },
            startMs: 0,
            endMs: 0,
            displayDurationMs: 5000,
            displayMode: 'fullscreen',
            template: 'image',
            enabled: true,
            style: {} as never,
            renderMode: 'legacy',
          },
        ],
        coverPrompts: [],
        summary: '',
        keywords: [],
      },
      currentProjectDir: '/tmp/proj',
      projectBindings: null,
    });

    let draftSeen: { text: string; type: string } | null = null;
    vi.stubGlobal('window', {
      electronAPI: {
        loadGlobalSettings: async () =>
          JSON.stringify({
            aiSettings: {
              llmProviders: [{ id: 'p1', name: 'p', type: 'openai', baseUrl: 'x', apiKey: 'k', models: ['m'] }],
              defaultProviderId: 'p1',
              defaultModel: 'm',
            },
          }),
        generateCardFromSubtitles: async (args: { draft: { text: string; type: string } }) => {
          draftSeen = args.draft;
          return {
            id: 'GEN',
            segmentId: 'manual-xyz',
            type: 'motion',
            title: '生成',
            content: '海边日落',
            startMs: 0,
            endMs: 5000,
            displayDurationMs: 5000,
            displayMode: 'fullscreen',
            template: 'motion',
            enabled: true,
            style: {},
            renderMode: 'motion-card',
            motionCard: { tsx: 'export default () => null', compiledAt: 0, prompt: '', retryCount: 0 },
          };
        },
        saveProjectSection: async () => undefined,
      },
    });

    const result = await useAIStore.getState().convertCardToMotion('manual-1');
    expect(draftSeen).not.toBeNull();
    expect(draftSeen!.text).toBe('海边日落');
    expect(draftSeen!.type).toBe('motion');
    expect(result?.id).toBe('manual-1'); // 保号
    expect(result?.title).toBe('手动卡');
  });

  it('convertCardToMotion: 已是 motion 家族 → 返回 null 不调用 IPC', async () => {
    useAIStore.setState({
      analysisResult: {
        segments: [],
        cards: [
          {
            id: 'm1',
            segmentId: 'seg',
            type: 'motion',
            title: 't',
            content: 'x',
            startMs: 0,
            endMs: 1000,
            displayDurationMs: 1000,
            displayMode: 'fullscreen',
            template: 'motion',
            enabled: true,
            style: {} as never,
            renderMode: 'motion-card',
          },
        ],
        coverPrompts: [],
        summary: '',
        keywords: [],
      },
    });
    const result = await useAIStore.getState().convertCardToMotion('m1');
    expect(result).toBeNull();
  });
```

注意：本测试文件 `afterEach` 已有 `vi.unstubAllGlobals()`。`convertCardToMotion` 读取 `srtEntries` / `addAICardsToTimeline` 来自 timeline store，本用例卡片未上轨，timeline store 默认 `srtEntries: []`、overlays 为空，故不会触发 `addAICardsToTimeline`，无需额外桩。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/store-ai-card-media.test.ts`
Expected: FAIL（`convertCardToMotion is not a function`）。

- [ ] **Step 3a: 在 `AIStore` 接口声明中加方法**

在 `src/store/ai.ts` 的 `convertCardToMedia` 接口声明（`convertCardToMedia: (cardId: string, mediaType: 'image' | 'video') => Promise<AICard | null>;`）之后追加：

```ts
  /**
   * 把 image/video 卡转换为 motion 动画卡：调 LLM 生成 Remotion TSX，
   * 保留 cardId / segmentId / 时间区间 / displayMode / enabled。
   * 有背景段走 regenerateAICard，手动卡走 generateCardFromSubtitles。
   * 卡片不存在、已是 motion、AI 未配置或生成失败时返回 null。
   */
  convertCardToMotion: (cardId: string) => Promise<AICard | null>;
```

- [ ] **Step 3b: 加 import**

在 `src/store/ai.ts` 顶部 import 区追加（与同目录/同库分组对齐）：

```ts
import { getAISettingsIssue } from '../lib/ai-settings';
import { planMotionConversion, mergeMotionConversionResult } from '../lib/ai-card-conversion';
import { useTimelineStore } from './timeline';
import { buildAICardTimelineDraft } from '../types/ai';
```

注意：`getCurrentProjectDir` 已在文件中 import（来自 `'./timeline'`），不要重复；`buildAICardTimelineDraft` 若 `'../types/ai'` 已有大块 import，可并入该 import 语句而非新增一行。

- [ ] **Step 3c: 实现动作**

在 `src/store/ai.ts` 的 `convertCardToMedia` 实现（以 `convertCardToMedia: async (cardId, mediaType) => { ... },` 结尾）之后追加：

```ts
  convertCardToMotion: async (cardId) => {
    const state = get();
    const result = state.analysisResult;
    const card = result?.cards.find((c) => c.id === cardId);
    if (!card || !result) return null;

    const plan = planMotionConversion(card, result);
    if (plan.kind === 'noop') return null;

    const settings = await loadAISettings();
    const issue = getAISettingsIssue(settings);
    if (issue || !settings) {
      get().setAnalysisError(issue ?? '请先完成 AI 配置');
      return null;
    }

    const taskId = `convert-card-motion-${card.id}-${Date.now()}`;
    const taskProgress = useTaskProgressStore.getState();
    taskProgress.startTask({
      id: taskId,
      category: 'ai-analyze',
      label: `转为动画卡：${card.title}`,
      mode: 'indeterminate',
      progress: 0,
      phase: '生成 Motion 卡片',
      level: 2,
      canCancel: false,
    });

    try {
      const timeline = useTimelineStore.getState();
      const projectBindings = get().projectBindings;
      const projectDir = getCurrentProjectDir() || undefined;
      const globalPrompt = result.globalPrompt?.trim() || undefined;

      let generated: AICard;
      if (plan.kind === 'segment') {
        generated = await window.electronAPI.regenerateAICard({
          entries: timeline.srtEntries,
          card,
          segment: plan.segment,
          settings,
          globalPrompt,
          cardPrompt: card.cardPrompt,
          programSummary: result.summary,
          keywords: result.keywords,
          projectDir,
          projectBindings,
        });
      } else {
        generated = await window.electronAPI.generateCardFromSubtitles({
          entries: timeline.srtEntries,
          draft: plan.draft,
          settings,
          globalPrompt,
          programSummary: result.summary,
          keywords: result.keywords,
          projectDir,
          projectBindings,
        });
      }

      const merged = mergeMotionConversionResult(card, generated);

      set((s) => {
        if (!s.analysisResult) return {};
        return {
          analysisResult: {
            ...s.analysisResult,
            cards: s.analysisResult.cards.map((c) => (c.id === cardId ? merged : c)),
          },
        };
      });
      get().setAnalysisError(null);

      const placed = timeline.timeline.overlays.some(
        (o) => o.overlayType === 'ai-card' && o.aiCardData?.sourceCardId === cardId,
      );
      if (placed) {
        timeline.addAICardsToTimeline([buildAICardTimelineDraft(merged)]);
      }

      taskProgress.completeTask(taskId);
      return merged;
    } catch (error) {
      const message = error instanceof Error ? error.message : '转换为动画卡失败';
      get().setAnalysisError(message);
      taskProgress.failTask(taskId, message);
      return null;
    }
  },
```

注意：`result.globalPrompt` 字段存在于 `AIAnalysisResult`（参见 `useAICardInspector.regenerateCard` 同款用法）；`setAnalysisError`、`projectBindings` 均为 store 既有成员。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/store-ai-card-media.test.ts`
Expected: PASS（含 3 个新用例）。

- [ ] **Step 5: 提交**

```bash
git add src/store/ai.ts tests/store-ai-card-media.test.ts
git commit -m "feat(ai-card): convertCardToMotion store 动作（双路径+保号+进度）"
```

---

## Task 3: 时间线右键菜单项

**Files:**
- Modify: `src/lib/timeline-context-menu.ts`
- Test: `tests/timeline-context-menu.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/timeline-context-menu.test.ts` 末尾 `})`（最外层 describe 收尾）之前追加：

```ts
  it('overlay 且可转换 motion 时，追加启用的「转为动画卡」项', () => {
    const items = getTimelineContextMenuItems({
      target: 'overlay',
      canPaste: false,
      convertibleToMotion: true,
    });
    const convert = items.find((i) => i.key === 'convert-to-motion');
    expect(convert).toEqual({
      key: 'convert-to-motion',
      label: '转为动画卡',
      icon: 'sparkles',
      shortcut: '',
      separatorBefore: true,
      disabled: false,
    });
  });

  it('overlay 不可转换时，「转为动画卡」存在但禁用', () => {
    const items = getTimelineContextMenuItems({
      target: 'overlay',
      canPaste: false,
      convertibleToMotion: false,
    });
    expect(items.find((i) => i.key === 'convert-to-motion')?.disabled).toBe(true);
  });

  it('track 目标不含「转为动画卡」', () => {
    const items = getTimelineContextMenuItems({ target: 'track', canPaste: true });
    expect(items.some((i) => i.key === 'convert-to-motion')).toBe(false);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/timeline-context-menu.test.ts`
Expected: FAIL（无 `convert-to-motion`；类型不接受 `convertibleToMotion`）。

- [ ] **Step 3: 实现菜单项**

编辑 `src/lib/timeline-context-menu.ts`：

3a. action key 联合类型加一项：

```ts
export type TimelineContextMenuActionKey =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'insert-image-card'
  | 'insert-video-card'
  | 'convert-to-motion';
```

3b. options 接口加可选字段：

```ts
interface TimelineContextMenuOptions {
  target: TimelineContextMenuTarget;
  canPaste: boolean;
  /** 仅 overlay 目标：源卡为 image/video 时为 true，决定「转为动画卡」是否启用。 */
  convertibleToMotion?: boolean;
}
```

3c. 把函数体改为先构建基础数组，再在 overlay 目标时追加 convert 项。将现有 `return [ ... ];` 改为：

```ts
  const items: TimelineContextMenuItem[] = [
    {
      key: 'copy',
      label: '复制',
      icon: 'copy',
      shortcut: '⌘C',
      disabled: disableSourceActions,
    },
    {
      key: 'cut',
      label: '剪切',
      icon: 'scissors',
      shortcut: '⌘X',
      disabled: disableSourceActions,
    },
    {
      key: 'paste',
      label: '粘贴',
      icon: 'clipboard',
      shortcut: '⌘V',
      disabled: !options.canPaste,
    },
    {
      key: 'delete',
      label: '删除',
      icon: 'trash-2',
      shortcut: '⌫',
      destructive: true,
      separatorBefore: true,
      disabled: disableSourceActions,
    },
    {
      key: 'insert-image-card',
      label: '在此插入图片卡',
      icon: 'image',
      shortcut: '',
      separatorBefore: true,
      disabled: !isTrack,
    },
    {
      key: 'insert-video-card',
      label: '在此插入视频卡',
      icon: 'film',
      shortcut: '',
      disabled: !isTrack,
    },
  ];

  if (options.target === 'overlay') {
    items.push({
      key: 'convert-to-motion',
      label: '转为动画卡',
      icon: 'sparkles',
      shortcut: '',
      separatorBefore: true,
      disabled: !options.convertibleToMotion,
    });
  }

  return items;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/timeline-context-menu.test.ts`
Expected: PASS。

注意：原有 `'returns the overlay menu in design order'` 用例用 `toEqual` 全等匹配整数组，现在 overlay 会多出 `convert-to-motion` 项，该用例需补上对应对象。若该用例失败，在其期望数组末尾追加：

```ts
      {
        key: 'convert-to-motion',
        label: '转为动画卡',
        icon: 'sparkles',
        shortcut: '',
        separatorBefore: true,
        disabled: true,
      },
```
（该用例未传 `convertibleToMotion`，故 `disabled: true`。）

- [ ] **Step 5: 提交**

```bash
git add src/lib/timeline-context-menu.ts tests/timeline-context-menu.test.ts
git commit -m "feat(timeline): 右键菜单新增「转为动画卡」项"
```

---

## Task 4: 时间线 handler 接线

**Files:**
- Modify: `src/components/Timeline.tsx`（`handleContextMenuAction` ~428；overlay 菜单构建 ~1499）

- [ ] **Step 1: overlay 菜单传 `convertibleToMotion`**

在 `src/components/Timeline.tsx` overlay 菜单构建处（约 1499 行）：

```ts
                          const overlayMenuItems = getTimelineContextMenuItems({
                            target: 'overlay',
                            canPaste: canPasteOverlay,
                          });
```

改为：

```ts
                          const overlayCardType = overlay.aiCardData?.cardType;
                          const overlayMenuItems = getTimelineContextMenuItems({
                            target: 'overlay',
                            canPaste: canPasteOverlay,
                            convertibleToMotion:
                              overlay.overlayType === 'ai-card' &&
                              (overlayCardType === 'image' || overlayCardType === 'video'),
                          });
```

`overlay.aiCardData.cardType` 由 `buildAICardOverlayData` 写入，无需查 AI store。

- [ ] **Step 2: handler 处理 `convert-to-motion`**

在 `handleContextMenuAction` 内，`insert-image-card / insert-video-card` 分支之后、`if (!options.overlayId)`（delete 兜底）之前插入：

```ts
      if (action === 'convert-to-motion') {
        if (!options.overlayId) {
          return;
        }
        const overlay = useTimelineStore
          .getState()
          .timeline.overlays.find((o) => o.id === options.overlayId);
        const sourceCardId = overlay?.aiCardData?.sourceCardId;
        if (overlay?.overlayType === 'ai-card' && sourceCardId) {
          void useAIStore.getState().convertCardToMotion(sourceCardId);
        }
        return;
      }
```

注意：`useAIStore` 已在 `Timeline.tsx` import（见 `insert-image-card` 分支用 `useAIStore.getState()`）。确认 `useTimelineStore` 已 import；若文件内访问 timeline store 用的是组件内 hook 而非 `useTimelineStore` 直接 import，则改用文件中既有的获取方式（搜索 `useTimelineStore` 确认 import 存在，缺失则补 `import { useTimelineStore } from '../store/timeline';`）。

- [ ] **Step 3: 更新 handler 依赖数组**

`handleContextMenuAction` 的 `useCallback` 依赖数组当前为：
`[copyOverlay, cutOverlay, pasteOverlay, removeOverlay, selectedOverlayId, onOpenAICardInspector]`
无需新增依赖（`useTimelineStore` / `useAIStore` 为模块级稳定引用）。保持不变即可。

- [ ] **Step 4: 类型/构建校验**

Run: `npx vitest run tests/timeline-ai-overlay.test.tsx tests/timeline-context-menu.test.ts`
Expected: PASS（确认 Timeline 相关测试未回归）。

- [ ] **Step 5: 提交**

```bash
git add src/components/Timeline.tsx
git commit -m "feat(timeline): 右键「转为动画卡」接线 convertCardToMotion"
```

---

## Task 5: AI 面板卡片列表下拉项

**Files:**
- Modify: `src/components/AICardList.tsx`
- Test: `tests/ai-card-list.test.tsx`

- [ ] **Step 1: 写失败测试**

先在 `tests/ai-card-list.test.tsx` 顶部对 `useAIStore` 的 mock 初始 state 中补上 `convertCardToMotion`：

```ts
  let state: Record<string, unknown> = {
    currentProjectDir: null,
    convertCardToMedia: async () => null,
    convertCardToMotion: async () => null,
  };
```

再在文件末尾 `describe(...)` 内追加用例（沿用本文件既有的 `findElement` / 按 `aria-label` 命中 + 读取 `onSelect`/`children` 的方式；下例断言菜单项文案存在且 image 卡未禁用、motion 卡禁用）：

```ts
  it('image 卡渲染启用的「转为动画卡」项', () => {
    const card: AICard = {
      id: 'c1',
      segmentId: 's1',
      type: 'image',
      title: '图卡',
      content: {
        mediaType: 'image',
        assetPath: null,
        aspectRatio: '16:9',
        prompt: 'p',
        providerId: null,
        model: null,
        generationStatus: 'idle',
      },
      startMs: 0,
      endMs: 1000,
      displayDurationMs: 1000,
      displayMode: 'fullscreen',
      template: 'image',
      enabled: true,
      style: {} as never,
      renderMode: 'legacy',
    };
    const tree = AICardList({
      cards: [card],
      onToggleEnabled: () => {},
      onDeleteCard: () => {},
      onEditCard: () => {},
    }) as ReactElement;
    const item = findElement(
      tree,
      (el) =>
        typeof el.props?.children === 'string' &&
        (el.props.children as string).includes('转为动画卡'),
    );
    expect(item).not.toBeNull();
    expect(item!.props.disabled).toBe(false);
  });

  it('motion 卡的「转为动画卡」项被禁用', () => {
    const card: AICard = {
      id: 'c2',
      segmentId: 's2',
      type: 'motion',
      title: '动卡',
      content: 'x',
      startMs: 0,
      endMs: 1000,
      displayDurationMs: 1000,
      displayMode: 'fullscreen',
      template: 'motion',
      enabled: true,
      style: {} as never,
      renderMode: 'motion-card',
    };
    const tree = AICardList({
      cards: [card],
      onToggleEnabled: () => {},
      onDeleteCard: () => {},
      onEditCard: () => {},
    }) as ReactElement;
    const item = findElement(
      tree,
      (el) =>
        typeof el.props?.children === 'string' &&
        (el.props.children as string).includes('转为动画卡'),
    );
    expect(item).not.toBeNull();
    expect(item!.props.disabled).toBe(true);
  });
```

> 若本文件既有用例不是直接调用 `AICardList({...})` 而是 `renderToStaticMarkup(<AICardList .../>)`，则照既有写法改：用 `renderToStaticMarkup` 渲染后断言 HTML 含「转为动画卡」。两类断言任选其一，与文件现状对齐即可（不要两种混用）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/ai-card-list.test.tsx`
Expected: FAIL（找不到「转为动画卡」）。

- [ ] **Step 3: 实现下拉项 + converting 状态**

编辑 `src/components/AICardList.tsx`：

3a. 顶部已 `import { useState } from 'react';`。在组件内 `const convertCardToMedia = useAIStore((s) => s.convertCardToMedia);` 之后追加：

```tsx
  const convertCardToMotion = useAIStore((s) => s.convertCardToMotion);
  const [convertingCardId, setConvertingCardId] = useState<string | null>(null);
```

3b. 在 `handleConvert` 之后追加：

```tsx
  const handleConvertToMotion = async (cardId: string): Promise<void> => {
    setConvertingCardId(cardId);
    try {
      const next = await convertCardToMotion(cardId);
      if (next) {
        onSelect?.(next.id);
      }
    } finally {
      setConvertingCardId(null);
    }
  };
```

3c. 在 map 内已有 `const isMedia = card.type === 'image' || card.type === 'video';`。下拉菜单 `<DropdownMenuContent>` 中，「转为视频卡」项（`onSelect={() => { void handleConvert(card.id, 'video'); }}` 的 `DropdownMenuItem`）之后追加：

```tsx
                      <DropdownMenuItem
                        disabled={!isMedia || convertingCardId === card.id}
                        onSelect={() => {
                          void handleConvertToMotion(card.id);
                        }}
                      >
                        转为动画卡
                      </DropdownMenuItem>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/ai-card-list.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/AICardList.tsx tests/ai-card-list.test.tsx
git commit -m "feat(ai-panel): 卡片列表新增「转为动画卡」下拉项"
```

---

## Task 6: 全量回归与构建校验

**Files:** 无（仅验证）

- [ ] **Step 1: 全量单测**

Run: `npm test`
Expected: 全绿。若有红，定位到上面对应 Task 修复（重点看 `tests/ai-panel.test.tsx`、`tests/timeline-ai-overlay.test.tsx` 是否因菜单/store 变更回归）。

- [ ] **Step 2: 构建（类型 + 混淆）**

Run: `npm run build`
Expected: 编译通过，无 TS 报错。

- [ ] **Step 3: 提交（如有构建期补丁）**

```bash
git add -A
git commit -m "chore(ai-card): image→motion 转换全量校验修复"
```
（无改动则跳过。）

---

## Self-Review 结论

- **Spec 覆盖**：双入口（Task 4/5）、一键自动生成（Task 2）、双路径分流（Task 1/2）、保号合并（Task 1）、统一进度（Task 2）、错误/边界（Task 1/2）、测试计划（Task 1/2/3/5）、全量校验（Task 6）均有对应任务。
- **无占位符**：所有步骤含真实代码与命令。
- **类型一致**：`convertCardToMotion`、`planMotionConversion`、`mergeMotionConversionResult`、`MotionConversionPlan`、`convertibleToMotion`、`convert-to-motion` 在定义与调用处命名一致。
- **无 IPC 三件套变更**：仅复用既有 `regenerateAICard` / `generateCardFromSubtitles`。

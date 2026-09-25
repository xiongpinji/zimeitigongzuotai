# 内容自适应动画指导（Content-Adaptive Animation Direction）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Motion Card 出卡前插入一步「内容→逐拍动画脚本」的 AI 生成（`AICard.animationDirection`），默认全自动、并提供手动按钮，元提示词 `cards.animation` 纳入统一配置。

**Architecture:** 新增 PromptKind `cards.animation`（纯文本输出），由 `generateAnimationDirection` 经现有 `src/lib/llm` 的 `generateText` 调用生成；结果注入 `cards.segment` 的新变量 `{{animationDirection}}`，与既有 `{{cardPrompt}}` 并存。仅对 motion 卡生效，失败兜底为空串不阻断出卡。手动档经新 IPC `generate-animation-direction` 三件套驱动 AICardInspector 的「动画指导」区。

**Tech Stack:** TypeScript / React 19 / Electron / Vitest；提示词体系（`src/lib/prompts`）、AI 分析链路（`src/lib/ai-analysis.ts`）、IPC 三件套（main/preload/electron-api）。

参考 spec：`docs/superpowers/specs/2026-06-24-content-adaptive-animation-direction-design.md`

---

## 文件结构（改/建一览）

- 修改 `src/types/ai.ts`：`AICard.animationDirection?`、`AISettings.autoAnimationDirection?`
- 修改 `src/lib/prompts/types.ts`：`PROMPT_KINDS` 加 `'cards.animation'`、`PROMPT_KIND_META` 加条目
- 修改 `src/lib/prompts/defaults.ts`：新增 `CARDS_ANIMATION` 模板并注册；`CARDS_SEGMENT` 模板加 `{{animationDirection}}` 引导行
- 修改 `src/lib/ai-analysis.ts`：`buildAnimationDirectionPrompt` + `generateAnimationDirection`；`buildSegmentCardPrompt` 注入新变量；`generateCardForSegment` 自动触发 + 写回字段；`RegenerateCardOptions` + `regenerateAICard` 透传
- 修改 `electron/pipeline/runs/card-run.ts`：`buildRegenerateOptions` 加载 `cards.animation` 模板并透传
- 修改 `electron/main.ts` / `electron/preload.ts` / `src/lib/electron-api.ts`：新增 `generate-animation-direction` IPC 三件套
- 修改 `src/components/AICardInspector.tsx`：「动画指导」textarea + 「✨ 生成动画指导」按钮 + 统一进度
- 测试：`tests/ai-analysis.test.ts`、`tests/prompts-io.test.ts`（或 `tests/prompts.test.ts`）、`tests/card-run.test.ts`、`tests/ai-card-inspector.test.tsx`

> 约定：每个 Task 末尾 commit。测试统一用 `npx vitest run <file>`。

---

### Task 1: 共享类型与 PromptKind 注册

**Files:**
- Modify: `src/types/ai.ts:140-158`（AICard）、`src/types/ai.ts:338+`（AISettings）
- Modify: `src/lib/prompts/types.ts:1-9`（PROMPT_KINDS）、`src/lib/prompts/types.ts:200+`（PROMPT_KIND_META）
- Test: `tests/ai-card-types.test.ts`

- [ ] **Step 1: 写失败测试**（确认类型与 kind 存在）

在 `tests/ai-card-types.test.ts` 追加：

```ts
import { PROMPT_KINDS, isPromptKind } from '../src/lib/prompts/types';

describe('cards.animation prompt kind', () => {
  it('registers cards.animation as a valid prompt kind', () => {
    expect(PROMPT_KINDS).toContain('cards.animation');
    expect(isPromptKind('cards.animation')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ai-card-types.test.ts`
Expected: FAIL —— `cards.animation` 不在 PROMPT_KINDS。

- [ ] **Step 3: 加类型字段**

`src/types/ai.ts` —— `AICard` 接口在 `cardPrompt?: string;`（第 154 行）后新增：

```ts
  /** AI 生成的逐拍动画脚本，由 cards.animation 元提示词产出，注入 cards.segment 指导出卡。仅 motion 卡使用。 */
  animationDirection?: string;
```

`AISettings` 接口（第 338 行起）内新增（放在合适的 AI 卡片相关字段附近）：

```ts
  /** 出卡前是否自动为 motion 卡生成动画指导（cards.animation）。缺省视为 true。 */
  autoAnimationDirection?: boolean;
```

- [ ] **Step 4: 注册 PromptKind**

`src/lib/prompts/types.ts` —— `PROMPT_KINDS`（第 1-9 行）在 `'cards.segment',` 后加一行 `'cards.animation',`。

在 `PROMPT_KIND_META`（第 200 行起）`'cards.segment'` 条目之后新增（**无 lockedContract**，因为输出是自由文本）：

```ts
  'cards.animation': {
    kind: 'cards.animation',
    label: '动画指导生成',
    description: '为单个 motion 段落生成逐拍动画脚本（自然语言），供 cards.segment 出卡时遵循其节拍与形变意图',
    group: 'ai-analysis',
    variables: [
      { name: 'globalPrompt', description: '整期创作提示词（为空填"无"）' },
      { name: 'programSummary', description: '节目级总结（为空填"无"）' },
      { name: 'keywords', description: '节目关键词（顿号分隔，无则为"无"）' },
      { name: 'segmentId', description: 'segment id' },
      { name: 'segmentTitle', description: 'segment 标题' },
      { name: 'segmentStartMs', description: 'segment 起始毫秒' },
      { name: 'segmentEndMs', description: 'segment 结束毫秒' },
      { name: 'segmentSummary', description: 'segment 摘要' },
      { name: 'segmentTranscriptExcerpt', description: 'segment 原始摘录' },
      { name: 'segmentCues', description: '本段逐句字幕节拍列表（[k] +秒数 文本；索引 k 与运行时 cues 对齐）' },
      { name: 'cardPrompt', description: '用户单卡追加提示词（风格/语气参考；无则为"无"）' },
    ],
  },
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/ai-card-types.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/ai.ts src/lib/prompts/types.ts tests/ai-card-types.test.ts
git commit -m "feat(ai-card): 新增 animationDirection 字段与 cards.animation prompt kind"
```

---

### Task 2: `cards.animation` 默认模板 + `cards.segment` 注入位

**Files:**
- Modify: `src/lib/prompts/defaults.ts:67-163`（CARDS_SEGMENT）、`src/lib/prompts/defaults.ts:289`（注册表）
- Test: `tests/prompts.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/prompts.test.ts` 追加（若该文件不存在则用 `tests/prompts-io.test.ts`，import 路径相应调整）：

```ts
import { getBuiltinPromptTemplate } from '../src/lib/prompts';

describe('cards.animation default template', () => {
  it('has a builtin template that mentions 逐拍 and segmentCues variable', () => {
    const tpl = getBuiltinPromptTemplate('cards.animation');
    expect(tpl.user).toContain('{{segmentCues}}');
    expect(tpl.user).toContain('逐拍');
  });

  it('cards.segment template exposes an animationDirection injection point', () => {
    const seg = getBuiltinPromptTemplate('cards.segment');
    expect(seg.user).toContain('{{animationDirection}}');
  });
});
```

> 若 `getBuiltinPromptTemplate` 不是导出名，改用本仓库实际的内置模板取值函数（参考 `src/lib/ai-analysis.ts` 里 `getBuiltinPromptTemplate('cards.segment')` 的同名引用）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/prompts.test.ts`
Expected: FAIL —— `cards.animation` 无内置模板 / `cards.segment` 无 `{{animationDirection}}`。

- [ ] **Step 3: 新增 `CARDS_ANIMATION` 模板**

在 `src/lib/prompts/defaults.ts` 中（`CARDS_SEGMENT` 常量之后）新增：

```ts
const CARDS_ANIMATION = `name: cards.animation
description: 内容自适应动画指导生成（输出逐拍动画脚本，供 cards.segment 出卡遵循）
version: 1
user: |-
  任务：你是 MG / 解说视频动效导演。给定下面这一段口播的内容，为它编排一份**逐拍动画脚本**，用于指导后续生成 Remotion Motion Card。只输出脚本本身，不要代码、不要解释、不要 markdown 代码块。

  ===== 动效方法论（必须贯彻，源自高端 MG 短片的可泛化核心）=====
  1. 连续形变叙事：拍与拍之间用"变换/morph"衔接，上一拍的结束态尽量成为下一拍的起点；避免一切硬切与闪现。
  2. 单一焦点：任一时刻屏幕只有一个视觉焦点，一拍只讲一件事；宁缺毋滥、大量留白。
  3. 跟口播逐句推进：每个焦点元素锚定到"它的内容被讲到"的那一句（见下方逐句节拍），讲到哪、哪才亮；可略提前，绝不迟到。
  4. 三段式节拍：每个元素"诞生 → 转化 → 让位/解构成下一个"，而不是出现后僵在原地。
  5. 有机缓动：用先快后慢（ease-out / 弹性缓出）推进，转场处可加一次轻微脉动或高光提示，杜绝匀速与机械感。
  6. 几何与克制：构图规整、对齐网格、去装饰；不堆叠并列、不滥用特效。

  ===== 输入上下文 =====
  - 全局提示：{{globalPrompt}}
  - 节目总结：{{programSummary}}
  - 关键词：{{keywords}}
  - segment：{{segmentId}}｜{{segmentTitle}}｜{{segmentStartMs}}-{{segmentEndMs}}ms
  - 摘要：{{segmentSummary}}
  - 摘录：{{segmentTranscriptExcerpt}}
  - 逐句字幕节拍（索引 k 对应运行时 cues[k]，用于把元素锚到讲出它的那一句）：
  {{segmentCues}}
  - 用户风格补充（可选，作为视觉/语气偏好参考，不得与上述方法论冲突）：{{cardPrompt}}

  ===== 输出格式（严格遵守）=====
  先用一句话给出"视觉母题"：本卡用什么核心视觉意象贯穿（呼应内容，便于连续形变）。
  然后给出 1~4 拍，每拍一行，格式：
  「拍i ｜ 锚:cues[k]（或 入场/兜底）｜ 焦点元素：<一句话> ｜ 动作/形变：<如何出现与如何转化> ｜ 缓动：<ease-out/弹性/脉动等>」
  最后一行可选「收束：<整卡如何收尾或最后焦点如何沉淀>」。

  ===== 约束 =====
  - 焦点元素个数 1~4，且必须与口播顺序一致（k 单调不减）。
  - 只描述节奏与形变意图，不写具体颜色十六进制、不写代码、不规定像素坐标。
  - 忠于内容，不臆造数字与人名；不要求画面出现水印/署名。
  - 全文控制在 ~400 字以内，密度高、可执行，避免空泛形容词。
`;
```

在注册表（`src/lib/prompts/defaults.ts:289` 附近，`'cards.segment': CARDS_SEGMENT,` 那一组对象）加一行：

```ts
  'cards.animation': CARDS_ANIMATION,
```

- [ ] **Step 4: `cards.segment` 模板加注入位**

在 `src/lib/prompts/defaults.ts` 的 `CARDS_SEGMENT` 模板里，找到第 87 行 `- 单卡提示：{{cardPrompt}}`，在其**下一行**插入：

```
  - 动画指导（针对本卡内容编排的逐拍动画脚本，若有则在不违反下方所有铁律的前提下优先遵循其节拍与形变意图；若为"无"则按通用节奏契约处理）：
  {{animationDirection}}
```

并在 `src/lib/prompts/types.ts` 的 `PROMPT_KIND_META['cards.segment'].variables` 数组（第 236-254 行）中，于 `cardPrompt` 条目后追加：

```ts
      { name: 'animationDirection', description: '本卡逐拍动画脚本（cards.animation 产出；无则为"无"）' },
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/prompts.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/prompts/defaults.ts src/lib/prompts/types.ts tests/prompts.test.ts
git commit -m "feat(prompts): 新增 cards.animation 默认模板与 cards.segment 动画指导注入位"
```

---

### Task 3: `generateAnimationDirection` 生成函数

**Files:**
- Modify: `src/lib/ai-analysis.ts`（新增 `buildAnimationDirectionPrompt` + `generateAnimationDirection`，建议放在 `buildSegmentCardPrompt`/`generateImagePromptForSegment` 附近）
- Test: `tests/ai-analysis.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/ai-analysis.test.ts` 追加：

```ts
import { generateAnimationDirection } from '../src/lib/ai-analysis';

describe('generateAnimationDirection', () => {
  const segment = {
    id: 'seg-1',
    title: '增长拐点',
    summary: '讲三组数据',
    startMs: 0,
    endMs: 8000,
    transcriptExcerpt: '今年用户翻倍',
    visualType: 'motion',
  } as any;
  const entries = [
    { index: 1, startMs: 0, endMs: 2000, text: '今年用户翻倍' },
    { index: 2, startMs: 2000, endMs: 4000, text: '硕士28842人' },
  ] as any;
  const settings = {} as any;

  it('renders cards.animation prompt and returns trimmed model text', async () => {
    const generateText = vi.fn().mockResolvedValue('  视觉母题：折线\n拍1 ｜ 入场 ｜ ...  ');
    const result = await generateAnimationDirection(entries, { summary: '总结', keywords: ['增长'], globalPrompt: '' }, segment, settings, {
      generateText,
      projectBindings: null,
    });
    expect(result).toBe('视觉母题：折线\n拍1 ｜ 入场 ｜ ...');
    const userMessage = generateText.mock.calls[0][2] as string;
    expect(userMessage).toContain('增长拐点');
    expect(userMessage).toContain('今年用户翻倍');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ai-analysis.test.ts -t generateAnimationDirection`
Expected: FAIL —— `generateAnimationDirection` 未导出。

- [ ] **Step 3: 实现函数**

在 `src/lib/ai-analysis.ts` 新增（`buildSegmentCardPrompt` 之后）：

```ts
/** 渲染 cards.animation 模板：把段落级 / 节目级信息注入动画指导元提示词。 */
export function buildAnimationDirectionPrompt(
  params: {
    segment: AISegment;
    globalPrompt?: string;
    programSummary?: string;
    keywords?: string[];
    cardPrompt?: string;
    segmentCues?: string;
  },
  template?: PromptTemplate,
): string {
  const { segment, globalPrompt, programSummary, keywords = [], cardPrompt, segmentCues } = params;
  const tpl = template ?? getBuiltinPromptTemplate('cards.animation');
  return renderUserPromptWithLock('cards.animation', tpl, {
    globalPrompt: truncatePromptValue(globalPrompt ?? '', 240) || '无',
    programSummary: truncatePromptValue(programSummary ?? '', 180) || '无',
    keywords: keywords.length > 0 ? keywords.join('、') : '无',
    segmentId: segment.id,
    segmentTitle: truncatePromptValue(segment.title, 60),
    segmentStartMs: segment.startMs,
    segmentEndMs: segment.endMs,
    segmentSummary: truncatePromptValue(segment.summary, 180),
    segmentTranscriptExcerpt: truncatePromptValue(segment.transcriptExcerpt ?? '', 260) || '无',
    segmentCues: segmentCues?.trim() ? segmentCues : '  （无逐句字幕节拍可用）',
    cardPrompt: truncatePromptValue(cardPrompt ?? '', 240) || '无',
  });
}

/**
 * 为单个 motion 段落生成逐拍动画脚本（cards.animation）。纯文本输出，供 cards.segment 出卡遵循。
 * 失败由调用方决定是否兜底（出卡链路里 catch 后以空串继续）。
 */
export async function generateAnimationDirection(
  entries: SrtEntry[],
  planning: Pick<SegmentPlanningResult, 'summary' | 'keywords' | 'globalPrompt'>,
  segment: AISegment,
  settings: AISettings,
  options: {
    generateText?: typeof generateText;
    cardPrompt?: string;
    animationTemplate?: PromptTemplate;
    projectBindings?: PromptBindingMap | null;
  } = {},
): Promise<string> {
  const {
    generateText: requestText = generateText,
    cardPrompt,
    animationTemplate,
    projectBindings,
  } = options;
  const binding = maybeResolveBinding('cards.animation', settings, projectBindings);
  const userMessage = buildAnimationDirectionPrompt(
    {
      segment,
      globalPrompt: planning.globalPrompt,
      programSummary: planning.summary,
      keywords: planning.keywords,
      cardPrompt,
      segmentCues: buildSegmentCuesBlock(entries, segment.startMs, segment.endMs),
    },
    animationTemplate,
  );
  // cards.animation 的指令全在 user 段，传空 system。
  const text = await requestText(settings, '', userMessage, binding);
  return text.trim();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/ai-analysis.test.ts -t generateAnimationDirection`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai-analysis.ts tests/ai-analysis.test.ts
git commit -m "feat(ai-analysis): 新增 generateAnimationDirection 逐拍动画脚本生成"
```

---

### Task 4: 出卡链路自动触发 + 写回字段 + 注入

**Files:**
- Modify: `src/lib/ai-analysis.ts` —— `buildSegmentCardPrompt`（908-977）、`generateCardForSegment` motion 分支（1243-1285）、`RegenerateCardOptions`（117-132）、`regenerateAICard`（1663-1719）、`buildMotionCardShell`
- Test: `tests/ai-analysis.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/ai-analysis.test.ts` 追加：

```ts
import { generateCardForSegment } from '../src/lib/ai-analysis';

describe('generateCardForSegment auto animationDirection', () => {
  const baseEntries = [{ index: 1, startMs: 0, endMs: 2000, text: '今年用户翻倍' }] as any;
  const segment = { id: 's1', title: 'T', summary: 'S', startMs: 0, endMs: 2000, transcriptExcerpt: '今年用户翻倍', visualType: 'motion' } as any;

  function makeDeps() {
    const generateText = vi.fn().mockResolvedValue('视觉母题：折线');
    const generateMotionSource = vi.fn().mockResolvedValue('export default function Card(){return null}');
    return { generateText, generateMotionSource };
  }

  it('auto-generates animationDirection for motion cards and injects it into the card prompt', async () => {
    const { generateText, generateMotionSource } = makeDeps();
    const card = await generateCardForSegment(baseEntries, { summary: 'S', keywords: [], globalPrompt: '' }, segment, { autoAnimationDirection: true } as any, {
      generateText, generateMotionSource, visualType: 'motion', projectBindings: null,
    });
    expect(generateText).toHaveBeenCalled(); // animationDirection 被生成
    expect(card.animationDirection).toBe('视觉母题：折线');
    const cardUserMsg = generateMotionSource.mock.calls[0][2] as string;
    expect(cardUserMsg).toContain('视觉母题：折线'); // 注入 cards.segment
  });

  it('skips animationDirection when autoAnimationDirection is false', async () => {
    const { generateText, generateMotionSource } = makeDeps();
    const card = await generateCardForSegment(baseEntries, { summary: 'S', keywords: [], globalPrompt: '' }, segment, { autoAnimationDirection: false } as any, {
      generateText, generateMotionSource, visualType: 'motion', projectBindings: null,
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(card.animationDirection).toBeUndefined();
  });

  it('does not block card generation when animationDirection generation throws', async () => {
    const generateText = vi.fn().mockRejectedValue(new Error('llm down'));
    const generateMotionSource = vi.fn().mockResolvedValue('export default function Card(){return null}');
    const card = await generateCardForSegment(baseEntries, { summary: 'S', keywords: [], globalPrompt: '' }, segment, { autoAnimationDirection: true } as any, {
      generateText, generateMotionSource, visualType: 'motion', projectBindings: null,
    });
    expect(generateMotionSource).toHaveBeenCalled(); // 出卡仍继续
    expect(card.animationDirection).toBeUndefined();
  });
});
```

> 注意：image 段落不应触发动画指导。若现有测试已覆盖 image 分支，可不另加；否则补一条断言 `visualType:'image'` 时 `generateText` 不因动画指导被调用（image 自身的 card.image 调用会用到 generateText，断言时区分调用次数或用单独 mock）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ai-analysis.test.ts -t "auto animationDirection"`
Expected: FAIL —— `card.animationDirection` 未定义 / 未注入。

- [ ] **Step 3: `buildSegmentCardPrompt` 接受并注入 `animationDirection`**

在 `src/lib/ai-analysis.ts` `buildSegmentCardPrompt` 的 `params` 类型（909-921）加 `animationDirection?: string;`，解构（924-935）加 `animationDirection`，并在 `renderUserPromptWithLock('cards.segment', ...)` 的对象（955-976）中、`cardPrompt` 行之后加：

```ts
    animationDirection: truncatePromptValue(animationDirection ?? '', 1200) || '无',
```

- [ ] **Step 4: `generateCardForSegment` 自动触发 + 写回**

`src/lib/ai-analysis.ts`：在 options 类型（1177-1197）加 `animationDirection?: string;`，解构（1199-1217）加 `animationDirection`。

在 motion 分支 `else {`（1243）内、`const binding = ...`（1247）之前插入：

```ts
    // 动画指导：手动传入优先；否则按开关自动生成（仅 motion 卡）。失败兜底为空串，不阻断出卡。
    let resolvedAnimationDirection = animationDirection?.trim() || undefined;
    if (!resolvedAnimationDirection && settings.autoAnimationDirection !== false) {
      try {
        resolvedAnimationDirection =
          (await generateAnimationDirection(entries, planning, segment, settings, {
            generateText: requestText,
            cardPrompt,
            animationTemplate: options.animationTemplate,
            projectBindings,
          })) || undefined;
      } catch (err) {
        telemetry?.emit?.('llm.end', {
          label: `cards.animation(${segment.id})`,
          attempt: 0,
          durationMs: 0,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
```

> 在 options 类型里同时新增 `animationTemplate?: PromptTemplate;`（供 card-run 透传已解析模板）。

把 `buildSegmentCardPrompt({...})` 调用（1256-1270）的对象里加一行 `animationDirection: resolvedAnimationDirection,`。

把 `buildMotionCardShell({...})`（1278-1284）调用里加一行 `animationDirection: resolvedAnimationDirection,`。

- [ ] **Step 5: `buildMotionCardShell` 写入字段**

找到 `buildMotionCardShell` 定义（在 `src/lib/ai-analysis.ts` 内，`grep -n "function buildMotionCardShell"` 定位），其参数加 `animationDirection?: string;`，并在返回的 card 对象里加 `animationDirection,`（与 `cardPrompt` 并列）。

- [ ] **Step 6: `regenerateAICard` 透传**

`RegenerateCardOptions`（117-132）加 `animationDirection?: string;` 与 `animationTemplate?: PromptTemplate;`。

`regenerateAICard`（1663-1719）解构 options（1670-1684）加 `animationDirection = card.animationDirection,` 和 `animationTemplate,`；在调用 `generateCardForSegment` 的 options 对象（1706-1718）里加 `animationDirection,` 与 `animationTemplate,`。

并确认返回对象（1721+ `return { ...card, ... }`）保留 `regenerated.animationDirection`（若用 `...regenerated` 覆盖则自动带上；否则显式加 `animationDirection: regenerated.animationDirection`）。

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run tests/ai-analysis.test.ts`
Expected: PASS（全部，含已有用例不回归）

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai-analysis.ts tests/ai-analysis.test.ts
git commit -m "feat(ai-analysis): 出卡前自动生成动画指导并注入 cards.segment（含兜底与透传）"
```

---

### Task 5: `card-run` 加载并透传 `cards.animation` 模板

**Files:**
- Modify: `electron/pipeline/runs/card-run.ts:137-178`（buildRegenerateOptions / runRegenerateCard）
- Test: `tests/card-run.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/card-run.test.ts` 追加（对齐该文件既有 mock 风格；下示意断言点）：

```ts
it('loads cards.animation template and passes animationDirection through to regenerate', async () => {
  // 安排：mock loadEffectivePromptTemplate 对 'cards.animation' 返回可识别模板；
  // mock regenerate 捕获 opts。
  // 断言：
  //   expect(loadEffectivePromptTemplate).toHaveBeenCalledWith('cards.animation', expect.anything());
  //   expect(captured.animationTemplate).toBeDefined();
  //   expect(captured.animationDirection).toBe(loadedCard.animationDirection);
});
```

> 实测时按 `tests/card-run.test.ts` 现有对 `cards.segment`/`card.image` 的 mock 方式照抄一份给 `cards.animation`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/card-run.test.ts`
Expected: FAIL —— 未加载 `cards.animation` 模板 / 未透传字段。

- [ ] **Step 3: 实现**

`electron/pipeline/runs/card-run.ts` `buildRegenerateOptions`（137-166）的 `Promise.all`（142-147）加载列表里加：

```ts
    loadEffectivePromptTemplate('cards.animation', {
      projectDir: ctx.projectDir,
      bindings: l.projectBindings,
    }),
```

（与现有 `cards.segment` / `card.image` 同款参数；解构接收 `const [cardTemplate, imageTemplate, animationTemplate] = await Promise.all([...])`。）

返回对象（149-165）里加：

```ts
    animationTemplate,
    animationDirection: l.card.animationDirection,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/card-run.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/pipeline/runs/card-run.ts tests/card-run.test.ts
git commit -m "feat(card-run): 加载 cards.animation 模板并透传动画指导"
```

---

### Task 6: IPC `generate-animation-direction` 三件套

**Files:**
- Modify: `electron/main.ts`（参考既有 `regenerate-ai-card` handler）
- Modify: `electron/preload.ts`（参考既有 `regenerateAICard` 暴露）
- Modify: `src/lib/electron-api.ts`（参考既有 `regenerateAICard` 类型）
- Test: `tests/ai-analysis.test.ts` 已覆盖核心逻辑；IPC 仅做连通（无独立单测时跳过，靠 `npm run build` 类型校验）

- [ ] **Step 1: main 注册 handler**

在 `electron/main.ts` 中，定位 `ipcMain.handle('regenerate-ai-card', ...)`（`grep -n "regenerate-ai-card" electron/main.ts`），在其旁新增：

```ts
ipcMain.handle('generate-animation-direction', async (_evt, args: {
  entries: SrtEntry[];
  segment: AISegment;
  settings: AISettings;
  globalPrompt?: string;
  programSummary?: string;
  keywords?: string[];
  cardPrompt?: string;
  projectDir?: string;
  projectBindings?: PromptBindingMap | null;
}) => {
  const animationTemplate = await loadEffectivePromptTemplate('cards.animation', {
    projectDir: args.projectDir,
    bindings: args.projectBindings ?? null,
  });
  return generateAnimationDirection(
    args.entries,
    { summary: args.programSummary ?? '', keywords: args.keywords ?? [], globalPrompt: args.globalPrompt?.trim() || undefined },
    args.segment,
    args.settings,
    { cardPrompt: args.cardPrompt, animationTemplate, projectBindings: args.projectBindings ?? null },
  );
});
```

> 确保 `generateAnimationDirection` 与 `loadEffectivePromptTemplate` 已在 `electron/main.ts` import（参考 `regenerateAICard` 的 import 来源 `../src/lib/ai-analysis` 与 `./prompts-io`）。

- [ ] **Step 2: preload 暴露**

`electron/preload.ts` 在 `electronAPI` 对象里，`regenerateAICard` 旁新增：

```ts
  generateAnimationDirection: (args: GenerateAnimationDirectionArgs) =>
    ipcRenderer.invoke('generate-animation-direction', args),
```

- [ ] **Step 3: electron-api 类型契约**

`src/lib/electron-api.ts` 在 `ElectronAPI` 接口中，`regenerateAICard` 旁新增（并定义入参类型，沿用 `regenerateAICard` 的 args 形状裁剪）：

```ts
  generateAnimationDirection: (args: {
    entries: SrtEntry[];
    segment: AISegment;
    settings: AISettings;
    globalPrompt?: string;
    programSummary?: string;
    keywords?: string[];
    cardPrompt?: string;
    projectDir?: string;
    projectBindings?: PromptBindingMap | null;
  }) => Promise<string>;
```

（preload 侧 `GenerateAnimationDirectionArgs` 用同一形状；可在 preload 顶部本地声明或从共享类型 import。）

- [ ] **Step 4: 类型校验**

Run: `npx tsc -p tsconfig.json --noEmit`（或 `npm run build` 的类型阶段）
Expected: 无新增类型错误（三件套契约一致）。

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/lib/electron-api.ts
git commit -m "feat(ipc): 新增 generate-animation-direction 三件套"
```

---

### Task 7: AICardInspector「动画指导」UI（手动档 + 统一进度）

**Files:**
- Modify: `src/components/AICardInspector.tsx`（state 区 65-72、effect 同步、draftUpdates、追加提示词区块之后、handleRegenerateClick 附近）
- Modify: `src/components/AICardInspector.module.css`（如需新样式，复用 `fieldStack`/`promptArea`）
- Test: `tests/ai-card-inspector.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `tests/ai-card-inspector.test.tsx` 追加（对齐该文件渲染/查询风格）：

```ts
it('shows the 动画指导 field for motion cards and fills it via generate button', async () => {
  (window as any).electronAPI = {
    ...(window as any).electronAPI,
    generateAnimationDirection: vi.fn().mockResolvedValue('视觉母题：折线\n拍1 ｜ 入场 ｜ ...'),
  };
  // 渲染 AICardInspector，传入一张 motion 卡（card.motionCard.tsx 非空）
  // 断言：能看到「动画指导」label；点击「生成动画指导」后 textarea 值被填入返回脚本
  // 断言：generateAnimationDirection 被调用一次
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ai-card-inspector.test.tsx`
Expected: FAIL —— 无「动画指导」区块。

- [ ] **Step 3: 加 state 与同步**

`src/components/AICardInspector.tsx`：在 `const [cardPrompt, setCardPrompt] = useState('');`（67）后加：

```tsx
  const [animationDirection, setAnimationDirection] = useState('');
  const [isGeneratingDirection, setIsGeneratingDirection] = useState(false);
```

在同步 effect（`setCardPrompt(card.cardPrompt ?? '');` 那段）加：

```tsx
    setAnimationDirection(card.animationDirection ?? '');
```

`draftUpdates` 对象（含 `cardPrompt: cardPrompt.trim() || undefined,`）加：

```tsx
    animationDirection: animationDirection.trim() || undefined,
```

- [ ] **Step 4: 加生成处理 + 统一进度**

在 `handleRegenerateClick` 附近新增（`isMotionCard` 用现有 `hasCompiledMotion` 或 `card.type` 判定）：

```tsx
  const handleGenerateDirection = async () => {
    if (!card) return;
    setIsGeneratingDirection(true);
    const taskId = startTask({ kind: 'ai', title: '生成动画指导' });
    try {
      const text = await window.electronAPI.generateAnimationDirection({
        entries: srtEntriesForCard,            // 复用本组件已有的 SRT 入参来源（参考 onRegenerate 的取数）
        segment: segmentForCard,               // 同上
        settings: aiSettings,
        globalPrompt,
        programSummary,
        keywords,
        cardPrompt: cardPrompt.trim() || undefined,
        projectDir: getProjectDir() ?? undefined,
        projectBindings: useAIStore.getState().projectBindings,
      });
      setAnimationDirection(text);
      completeTask(taskId);
    } catch (err) {
      failTask(taskId, err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingDirection(false);
    }
  };
```

> 取数来源（entries/segment/settings/globalPrompt/...）与现有 `useAICardInspector.ts` 的 `regenerateCard` 完全一致（参考 spec §5.3）；实现时直接复用同一处上下文，避免重复推导。进度 API 来自 `src/store/task-progress.ts`。

在「追加提示词」`</label>` 之后、该 section 闭合 `</div>` 之前，仅当 motion 卡时渲染：

```tsx
        {hasCompiledMotion || card.type !== 'image' ? (
          <label className={styles.fieldStack}>
            <span className={styles.fieldLabel}>动画指导</span>
            <Textarea
              size="sm"
              value={animationDirection}
              rows={6}
              resize="none"
              className={styles.promptArea}
              placeholder="AI 会自动生成；也可点下方按钮单独生成后再出卡…"
              onChange={(event) => setAnimationDirection(event.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<AppIcon name="sparkles" size={12} />}
              onClick={() => { void handleGenerateDirection(); }}
              disabled={isGeneratingDirection}
            >
              {isGeneratingDirection ? '生成中...' : '✨ 生成动画指导'}
            </Button>
          </label>
        ) : null}
```

> `AppIcon name="sparkles"` 若图标集无此名，换用现有可用图标（参考其它按钮的 `name`，如 `refresh-cw`/`wand`）。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/ai-card-inspector.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/AICardInspector.tsx src/components/AICardInspector.module.css tests/ai-card-inspector.test.tsx
git commit -m "feat(ai-card): AICardInspector 新增动画指导编辑与手动生成"
```

---

### Task 8: 全量验证

- [ ] **Step 1: 跑相关测试套件**

Run:
```bash
npx vitest run tests/ai-analysis.test.ts tests/prompts.test.ts tests/card-run.test.ts tests/ai-card-inspector.test.tsx tests/ai-card-types.test.ts
```
Expected: 全部 PASS。

- [ ] **Step 2: 类型与构建**

Run: `npm run build`
Expected: 编译通过（main + preload + renderer + 混淆）；无类型漂移。

- [ ] **Step 3: 回归扫描**

Run: `npx vitest run`
Expected: 无既有用例回归（如有 motion/card 相关快照断言因新增字段变化，按预期更新）。

- [ ] **Step 4: Commit（如有快照/收尾改动）**

```bash
git add -A
git commit -m "test: 动画指导功能全量验证与回归修复"
```

---

## Self-Review 记录

- **Spec 覆盖**：①数据模型→Task1；②生成链路 A→Task3/4；③`cards.animation` 配置化→Task1/2；④元提示词内容→Task2；⑤UI 手动档→Task7；⑥IPC→Task6；⑦测试→各 Task + Task8。无遗漏。
- **类型一致**：`animationDirection`（字段）、`autoAnimationDirection`（开关，判定一律用 `!== false`）、`cards.animation`（kind）、`animationTemplate`（透传模板）、`generateAnimationDirection`/`buildAnimationDirectionPrompt`（函数名）在全文一致。
- **Placeholder**：UI/IPC 的「取数来源」明确指向复用 `useAICardInspector.ts` 既有 `regenerateCard` 上下文，非待填空白；图标名给了回退说明。
- **风险**：触及共享类型与 `cards.segment` 模板（高风险清单），故 Task1/2 单列、Task8 全量回归兜底。

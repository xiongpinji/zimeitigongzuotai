# 段落卡 / 图片卡「风格模板库」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户从多个系统预设风格中自由选择，统一驱动段落 Motion 卡、封面图、图片信息卡的生成提示词，并为每个风格提供零 LLM 的静态预览 demo。

**Architecture:** 风格只在「生成时」通过提示词生效——把三个生成提示词里写死的「视觉系统」块抽成占位符 `{{styleSystemBlock}}`，由一个纯数据模块（main/renderer 共用）按 `单卡 → 项目 → 全局 → 内置默认` 解析出当前风格的对应 facet 注入。导出渲染管线零改动（motion HTML 在生成时已烘焙）。无新增 IPC——三层选择复用现有 AISettings / project.json 持久化通道。

**Tech Stack:** TypeScript / React 19 / Zustand / electron-vite / GSAP（预览）/ Vitest。

参考规格：`docs/superpowers/specs/2026-06-01-card-style-template-library-design.md`

---

## File Structure

新增：

- `src/lib/card-style.ts` —— 风格预设解析层（纯函数，main + renderer 共用）：`resolveStylePresetId`、`getStyleFacetBlock`、`getStylePresetById`。
- `src/lib/card-style-presets.ts` —— 10 个 `VisualStylePreset` 数据（facet 提示词块 + 预览资产引用）。**纯数据，无副作用，可被主进程 import。**
- `src/lib/card-style-previews/` —— 每个风格的静态 `motionHtml` 字符串（`*.preview.ts`，导出常量）+ 封面示意图资产引用常量。
- `src/components/StylePresetPreview.tsx` —— 单个风格的 iframe 预览（注入 gsap + 自动播放）。
- `src/components/StyleLibraryPanel.tsx` + `.module.css` —— 风格库网格选择面板。
- `tests/card-style.test.ts` —— 解析层单测。
- `tests/card-style-prompt-injection.test.ts` —— 提示词注入与向后兼容回归。

修改：

- `src/types/ai.ts` —— `VisualStylePreset` 系列接口；`AICard.stylePresetId?`、`AICardOverlayData.stylePresetId?`、`AISettings.defaultStylePresetId?`；`buildAICardOverlayData` 透传。
- `src/lib/prompts/defaults.ts` —— 三提示词抽 `{{styleSystemBlock}}` + version 递增。
- `src/lib/prompts/types.ts` —— 三个 kind 的 `variables` 增加 `styleSystemBlock` 元数据。
- `src/lib/ai-analysis.ts` —— 三个 build 函数注入 `styleSystemBlock`；`analyzeSrt` 与重生成入口透传 `stylePresetId`（沿 `projectStylePrompt` 同路径）。
- `src/store/ai.ts` —— `buildDefaultAISettings`、`loadAISettings`、`saveAISettings` 处理 `defaultStylePresetId`。
- `src/lib/project-persistence.ts` —— `ProjectData` 增加项目级 `stylePresetId` + 读时默认。
- `src/pages/Settings.tsx` —— 新增「风格库」tab。
- `src/components/AICardInspector.tsx` —— type pill 旁新增风格选择器。

---

## Task 1: 类型定义（VisualStylePreset + 字段扩展）

**Files:**
- Modify: `src/types/ai.ts`（接口区在 `CardStyle` 之后；`AICard` 在 99-115；`AICardOverlayData` 在 264-277；`AISettings` 在 204-260；`buildAICardOverlayData` 在 345-360）
- Test: `tests/card-style.test.ts`

- [ ] **Step 1: 写失败测试（buildAICardOverlayData 透传 stylePresetId）**

新建 `tests/card-style.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildAICardOverlayData, getDefaultCardStyle, type AICard } from '../src/types/ai';

function makeCard(overrides: Partial<AICard> = {}): AICard {
  return {
    id: 'c1',
    segmentId: 's1',
    type: 'summary',
    title: 'T',
    content: '',
    startMs: 0,
    endMs: 1000,
    displayDurationMs: 5000,
    displayMode: 'fullscreen',
    template: 'summary-default',
    enabled: true,
    style: getDefaultCardStyle('summary'),
    ...overrides,
  };
}

describe('buildAICardOverlayData stylePresetId 透传', () => {
  it('保留单卡 stylePresetId', () => {
    const overlay = buildAICardOverlayData(makeCard({ stylePresetId: 'swiss-grid' }));
    expect(overlay.stylePresetId).toBe('swiss-grid');
  });

  it('未设置时为 undefined', () => {
    const overlay = buildAICardOverlayData(makeCard());
    expect(overlay.stylePresetId).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/card-style.test.ts`
Expected: FAIL（`Object literal may only specify known properties` 编译错误，或 `stylePresetId` 为 undefined 因为未透传）

- [ ] **Step 3: 在 `src/types/ai.ts` 加接口与字段**

在 `CardStyle`（55-59）之后插入：

```ts
export type VisualStyleFacetKind = 'motion' | 'cover' | 'image';

export interface VisualStylePalette {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
}

export interface VisualStyleFonts {
  display: string;
  body: string;
  mono?: string;
}

/** 三个生成表面的「视觉系统」提示词块；缺省表示该表面回退默认风格 */
export interface VisualStyleFacets {
  motion?: string;
  cover?: string;
  image?: string;
}

export interface VisualStylePreview {
  /** 静态 Motion Card HTML 片段（含内联 <style> + 同步 <script>，遵守 motion-card 契约） */
  motionHtml?: string;
  /** 封面示意图资产路径（renderer 通过 import 取得的 URL 字符串） */
  coverImageAsset?: string;
}

export interface VisualStylePreset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** 来源 html-anything skill，便于追溯 */
  source: string;
  palette: VisualStylePalette;
  fonts: VisualStyleFonts;
  facets: VisualStyleFacets;
  preview: VisualStylePreview;
}

/** 内置默认风格 id；旧数据 / 未知 id 一律回退到它 */
export const DEFAULT_STYLE_PRESET_ID = 'editorial-eink';
```

在 `AICard`（99-115）末尾 `motionCard?` 之后加：

```ts
  /** 单卡级风格覆盖；缺省继承项目 / 全局 / 内置默认 */
  stylePresetId?: string;
```

在 `AICardOverlayData`（264-277）末尾加：

```ts
  stylePresetId?: string;
```

在 `AISettings`（promptBindings 之后，260 前）加：

```ts
  /** 全局默认风格预设 id；缺省视为 DEFAULT_STYLE_PRESET_ID */
  defaultStylePresetId?: string;
```

在 `buildAICardOverlayData`（345-360）的返回对象末尾加：

```ts
    stylePresetId: card.stylePresetId,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/card-style.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/types/ai.ts tests/card-style.test.ts
git commit -m "feat(style): VisualStylePreset 类型与卡片/设置字段扩展"
```

---

## Task 2: 风格解析层（card-style.ts）

**Files:**
- Create: `src/lib/card-style.ts`
- Create: `src/lib/card-style-presets.ts`（本任务先放最小骨架：仅 `editorial-eink` 占位，facet 内容在 Task 3 填入）
- Test: `tests/card-style.test.ts`（追加）

- [ ] **Step 1: 写失败测试（解析优先级 + facet 回退 + 未知 id）**

向 `tests/card-style.test.ts` 追加：

```ts
import {
  resolveStylePresetId,
  getStylePresetById,
  getStyleFacetBlock,
} from '../src/lib/card-style';
import { DEFAULT_STYLE_PRESET_ID } from '../src/types/ai';

describe('resolveStylePresetId 优先级', () => {
  it('单卡 > 项目 > 全局 > 默认', () => {
    expect(
      resolveStylePresetId({ card: 'a', project: 'b', global: 'c' }),
    ).toBe('a');
    expect(resolveStylePresetId({ project: 'b', global: 'c' })).toBe('b');
    expect(resolveStylePresetId({ global: 'c' })).toBe('c');
    expect(resolveStylePresetId({})).toBe(DEFAULT_STYLE_PRESET_ID);
  });

  it('未知 id 回退默认', () => {
    expect(resolveStylePresetId({ card: 'does-not-exist' })).toBe(
      DEFAULT_STYLE_PRESET_ID,
    );
  });

  it('空白字符串视为未设置', () => {
    expect(resolveStylePresetId({ card: '  ', project: 'editorial-eink' })).toBe(
      'editorial-eink',
    );
  });
});

describe('getStyleFacetBlock facet 回退', () => {
  it('缺失 facet 回退到默认风格同 facet', () => {
    // 'editorial-eink' 一定有 motion facet
    const block = getStyleFacetBlock('editorial-eink', 'motion');
    expect(block.length).toBeGreaterThan(0);
  });

  it('未知 id 取默认风格的 facet', () => {
    const fromUnknown = getStyleFacetBlock('nope', 'motion');
    const fromDefault = getStyleFacetBlock('editorial-eink', 'motion');
    expect(fromUnknown).toBe(fromDefault);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/card-style.test.ts`
Expected: FAIL（`Cannot find module '../src/lib/card-style'`）

- [ ] **Step 3: 创建 `src/lib/card-style-presets.ts` 最小骨架**

```ts
import type { VisualStylePreset } from '../types/ai';
import { DEFAULT_STYLE_PRESET_ID } from '../types/ai';

// facet 内容在 Task 3 填入；此处先放最小可用骨架，保证解析层可测试。
const EDITORIAL_EINK: VisualStylePreset = {
  id: DEFAULT_STYLE_PRESET_ID,
  name: '电子杂志墨水',
  description: '深色克制社论风：衬线标题、hairline 分隔、无渐变无阴影、单一系统蓝 accent。',
  tags: ['深色', '社论', '克制'],
  source: 'deck-guizang-editorial / web-proto-editorial',
  palette: { bg: '#0E0E10', ink: '#ECE7DA', muted: '#8A8478', accent: '#0A84FF' },
  fonts: {
    display: "'Noto Serif SC', Georgia, serif",
    body: "'PingFang SC', 'Noto Sans SC', sans-serif",
    mono: "'SF Mono', 'JetBrains Mono', monospace",
  },
  // Task 3 会把 defaults.ts 抽出的视觉系统块填进来；先占位非空，避免回退测试误判。
  facets: { motion: 'PLACEHOLDER_FILLED_IN_TASK_3', cover: '', image: '' },
  preview: {},
};

export const VISUAL_STYLE_PRESETS: VisualStylePreset[] = [EDITORIAL_EINK];

export function listStylePresets(): VisualStylePreset[] {
  return VISUAL_STYLE_PRESETS;
}
```

- [ ] **Step 4: 创建 `src/lib/card-style.ts`**

```ts
import {
  DEFAULT_STYLE_PRESET_ID,
  type VisualStyleFacetKind,
  type VisualStylePreset,
} from '../types/ai';
import { VISUAL_STYLE_PRESETS } from './card-style-presets';

const PRESET_BY_ID = new Map<string, VisualStylePreset>(
  VISUAL_STYLE_PRESETS.map((p) => [p.id, p]),
);

export function getStylePresetById(id: string | undefined | null): VisualStylePreset {
  const found = id ? PRESET_BY_ID.get(id) : undefined;
  return found ?? PRESET_BY_ID.get(DEFAULT_STYLE_PRESET_ID)!;
}

export interface StylePresetScope {
  card?: string | null;
  project?: string | null;
  global?: string | null;
}

function pick(value: string | null | undefined): string | undefined {
  const v = typeof value === 'string' ? value.trim() : '';
  return v.length > 0 ? v : undefined;
}

/** 单卡 → 项目 → 全局 → 内置默认；未知 id 回退默认。返回一定存在的 preset id。 */
export function resolveStylePresetId(scope: StylePresetScope): string {
  const candidate = pick(scope.card) ?? pick(scope.project) ?? pick(scope.global);
  if (candidate && PRESET_BY_ID.has(candidate)) return candidate;
  return DEFAULT_STYLE_PRESET_ID;
}

/**
 * 取某风格某 facet 的提示词块；缺失 facet（空串 / undefined）回退到内置默认风格的同 facet。
 * 注入到提示词的 {{styleSystemBlock}}。
 */
export function getStyleFacetBlock(
  presetId: string | undefined | null,
  facet: VisualStyleFacetKind,
): string {
  const preset = getStylePresetById(presetId);
  const block = preset.facets[facet];
  if (block && block.trim().length > 0) return block;
  const fallback = getStylePresetById(DEFAULT_STYLE_PRESET_ID).facets[facet];
  return fallback ?? '';
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/card-style.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/card-style.ts src/lib/card-style-presets.ts tests/card-style.test.ts
git commit -m "feat(style): 风格解析层 resolveStylePresetId/getStyleFacetBlock"
```

---

## Task 3: 抽出视觉系统块到 editorial-eink + 提示词占位符

**Files:**
- Modify: `src/lib/prompts/defaults.ts`（`CARDS_SEGMENT` 213-357；`COVER_REGENERATION` 75-146；`CARD_IMAGE` 412-428）
- Modify: `src/lib/prompts/types.ts`（三个 kind 的 `variables` 数组）
- Modify: `src/lib/card-style-presets.ts`（把抽出的块填入 editorial-eink.facets）
- Test: `tests/card-style-prompt-injection.test.ts`

> **关键约束：editorial-eink 注入后必须与改造前的提示词逐字节等价（向后兼容回归）。**

- [ ] **Step 1: 写失败测试（占位符存在 + editorial-eink 注入还原）**

新建 `tests/card-style-prompt-injection.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT_YAML } from '../src/lib/prompts/defaults';
import { getStyleFacetBlock } from '../src/lib/card-style';

describe('提示词 styleSystemBlock 占位符', () => {
  it('cards.segment 含占位符', () => {
    expect(DEFAULT_PROMPT_YAML['cards.segment']).toContain('{{styleSystemBlock}}');
  });
  it('cover.regeneration 含占位符', () => {
    expect(DEFAULT_PROMPT_YAML['cover.regeneration']).toContain('{{styleSystemBlock}}');
  });
  it('card.image 含占位符', () => {
    expect(DEFAULT_PROMPT_YAML['card.image']).toContain('{{styleSystemBlock}}');
  });
});

describe('editorial-eink facet 非空（motion/cover）', () => {
  it('motion facet 含「电子杂志」锚点', () => {
    expect(getStyleFacetBlock('editorial-eink', 'motion')).toContain('电子杂志');
  });
  it('cover facet 含「缩略图」锚点', () => {
    expect(getStyleFacetBlock('editorial-eink', 'cover')).toContain('缩略图');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/card-style-prompt-injection.test.ts`
Expected: FAIL（占位符尚不存在 / motion facet 仍是 PLACEHOLDER）

- [ ] **Step 3: 抽 cards.segment 视觉系统块**

在 `src/lib/prompts/defaults.ts`：将 `CARDS_SEGMENT` 模板里**第 213 行**（`===== 视觉系统：电子杂志 × 电子墨水（深色变体）=====`）起、到**第 357 行**（失败示例最后一条 `✗ hairline 分隔线压在 tile...`）止的整段，**剪切**出来，替换为单行：

```
  {{styleSystemBlock}}
```

> 注意：保留其上方的「布局反禁忌」（204-211）与其下方的「节目定位 {{programContext}}」（359-361）在主干不动。剪出的文本即为 editorial-eink 的 motion facet（Step 6 填入）。
> 同时把 `CARDS_SEGMENT` 顶部 `version: 8` 改为 `version: 9`。

- [ ] **Step 4: 抽 cover.regeneration 视觉系统块**

将 `COVER_REGENERATION` 里**第 75 行**（`===== 视觉系统：短视频缩略图 / Thumbnail 风（默认锁定，禁止替换）=====`）起、到**第 146 行**（参考示例整段结束）止剪出，替换为：

```
  {{styleSystemBlock}}
```

把 `version: 5` 改为 `version: 6`。剪出文本即 editorial-eink 的 cover facet。

- [ ] **Step 5: 在 card.image 插入风格锚点占位符**

`CARD_IMAGE` 当前无写死的美学块（靠 `{{projectStylePrompt}}`）。在「节目级上下文」块（391-395）之后、空行处插入新段：

```
  ===== 风格锚点（系统风格库注入）=====
  {{styleSystemBlock}}
```

把 `version: 2` 改为 `version: 3`。editorial-eink 的 image facet 留空（`''`），渲染为空 → 行为与今日一致。

- [ ] **Step 6: 把抽出的块填入 editorial-eink.facets**

在 `src/lib/card-style-presets.ts`，把 Step 3 / Step 4 剪出的两段文本分别作为字符串常量 `EDITORIAL_EINK_MOTION`、`EDITORIAL_EINK_COVER`（用模板字符串，注意原文中的反引号需转义为 `\``），并：

```ts
const EDITORIAL_EINK_MOTION = `===== 视觉系统：电子杂志 × 电子墨水（深色变体）=====
...剪出的全部原文...`;

const EDITORIAL_EINK_COVER = `===== 视觉系统：短视频缩略图 / Thumbnail 风（默认锁定，禁止替换）=====
...剪出的全部原文...`;

// 修改 EDITORIAL_EINK.facets：
facets: { motion: EDITORIAL_EINK_MOTION, cover: EDITORIAL_EINK_COVER, image: '' },
```

- [ ] **Step 7: 更新 prompts/types.ts 的 variables 元数据**

在 `PROMPT_KIND_META` 的 `cards.segment`、`cover.regeneration`、`card.image` 三处 `variables` 数组各加一项：

```ts
      { name: 'styleSystemBlock', description: '系统风格库注入的视觉系统块；由所选风格预设的对应 facet 决定' },
```

- [ ] **Step 8: 运行确认通过**

Run: `npx vitest run tests/card-style-prompt-injection.test.ts tests/card-style.test.ts`
Expected: PASS

- [ ] **Step 9: 跑既有提示词相关测试，确认无回归**

Run: `npx vitest run tests/`（或现存 prompts/ai-analysis 相关用例）
Expected: PASS（既有用例不应因抽块而变红；若有断言依赖完整 cards.segment 文本，更新为注入后等价）

- [ ] **Step 10: 提交**

```bash
git add src/lib/prompts/defaults.ts src/lib/prompts/types.ts src/lib/card-style-presets.ts tests/card-style-prompt-injection.test.ts
git commit -m "refactor(prompts): 抽视觉系统为 {{styleSystemBlock}} 占位符，editorial-eink 承接默认"
```

---

## Task 4: 三个 build 函数注入 styleSystemBlock

**Files:**
- Modify: `src/lib/ai-analysis.ts`（`buildCoverPrompt` 706-711；`buildSegmentCardPrompt` 758-779；`buildSegmentImagePrompt` 814-829）
- Test: `tests/card-style-prompt-injection.test.ts`（追加；若这些 build 函数未导出，本任务 Step 1 先导出）

- [ ] **Step 1: 写失败测试（不同 preset 注入不同 facet）**

先确认 `buildSegmentCardPrompt` 等是否 `export`；若否，加 `export`。追加测试：

```ts
import { buildSegmentCardPrompt } from '../src/lib/ai-analysis';

describe('buildSegmentCardPrompt 注入风格', () => {
  const segment = {
    id: 's1', title: '标题', summary: '摘要', startMs: 0, endMs: 5000,
    transcriptExcerpt: '原始摘录',
  };
  const base = {
    segment, globalPrompt: '', projectStylePrompt: '', programSummary: '',
    keywords: [] as string[], cardPrompt: '', programContext: '节目定位',
  };

  it('默认风格注入电子杂志块', () => {
    const prompt = buildSegmentCardPrompt({ ...base });
    expect(prompt).toContain('电子杂志');
  });

  it('指定 swiss-grid 注入瑞士网格块（待 Task 12 填充后断言其锚点）', () => {
    const prompt = buildSegmentCardPrompt({ ...base, stylePresetId: 'editorial-eink' });
    expect(prompt).toContain('电子杂志'); // editorial-eink facet 已存在
  });
});
```

> 注：`buildSegmentCardPrompt` 的真实参数形态以源码为准（当前为多个位置/选项参数）。若它接收的是 options 对象，按其字段名传；若是位置参数，按签名顺序构造测试。实现 Step 时以源码签名为准，测试同步对齐。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/card-style-prompt-injection.test.ts`
Expected: FAIL（`styleSystemBlock` 未注入 → `电子杂志` 不在结果中，因为占位符渲染为空串）

- [ ] **Step 3: 在三个 build 函数注入**

在 `src/lib/ai-analysis.ts` 顶部 import：

```ts
import { getStyleFacetBlock } from './card-style';
```

为三个 build 函数各增加可选入参 `stylePresetId?: string`（沿用它们已有的 `projectStylePrompt` 入参位置/字段同款方式），并在各自 `renderUserPromptWithLock(...)` 的 vars 对象里加一行：

- `buildSegmentCardPrompt`（758-779 vars）：
```ts
  styleSystemBlock: getStyleFacetBlock(stylePresetId, 'motion'),
```
- `buildCoverPrompt`（706-711 vars）：
```ts
  styleSystemBlock: getStyleFacetBlock(stylePresetId, 'cover'),
```
- `buildSegmentImagePrompt`（814-829 vars）：
```ts
  styleSystemBlock: getStyleFacetBlock(stylePresetId, 'image'),
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/card-style-prompt-injection.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/ai-analysis.ts tests/card-style-prompt-injection.test.ts
git commit -m "feat(style): 三个生成提示词按风格 facet 注入 styleSystemBlock"
```

---

## Task 5: 透传 stylePresetId 到 analyzeSrt 与重生成入口

**Files:**
- Modify: `src/lib/ai-analysis.ts`（`analyzeSrt` 及其内部对三个 build 函数的调用；以及单段重生成 / 封面重生成 / 单卡重生成的导出入口）
- Modify: 调用方——renderer 侧 `src/store/ai.ts`（发起分析 / 重生成处）；main 侧 `electron/main.ts`（1211 / 1287 / 1542 调用 build 链处）
- Test: 复用 Task 4 测试 + 手动验证

> **锚点：`stylePresetId` 走 `projectStylePrompt` 完全相同的链路。** 凡是当前把 `projectStylePrompt` 传进 `analyzeSrt` / build 函数的地方，并排传一个 `stylePresetId`。

- [ ] **Step 1: 在 analyzeSrt 的 options 增加 stylePresetId**

定位 `analyzeSrt` 签名（接收 srt、AISettings、projectStylePrompt 等的 options）。增加可选字段 `stylePresetId?: string`，并在它内部调用 `buildCoverPrompt` / `buildSegmentCardPrompt` / `buildSegmentImagePrompt` 时把：

```ts
stylePresetId: resolveStylePresetId({
  card: undefined,            // 分析阶段尚无单卡覆盖
  project: options.projectStylePresetId,
  global: options.defaultStylePresetId,
}),
```

传入。import：

```ts
import { resolveStylePresetId } from './card-style';
```

> options 同时新增 `projectStylePresetId?: string` 与 `defaultStylePresetId?: string` 两个透传字段（与 projectStylePrompt 并列）。

- [ ] **Step 2: renderer 调用方传值（src/store/ai.ts）**

在 `src/store/ai.ts` 发起 `analyzeSrt`（及封面 / 单卡重生成）的位置，从 store 取：

- `defaultStylePresetId`：`useAIStore.getState().settings.defaultStylePresetId`
- `projectStylePresetId`：项目级（Task 7 提供的项目状态字段）
- 单卡重生成时额外传 `card.stylePresetId` 作为 `card` 层

把这三者按 `resolveStylePresetId` 入参传入。单卡重生成入口（对应 `AICardInspector.onRegenerate`）解析时 `card` 层用该卡的 `stylePresetId`。

- [ ] **Step 3: main 调用方传值（electron/main.ts）**

`electron/main.ts` 在 1211 / 1287 / 1542 处调用分析 / 重生成时，从 IPC 入参透传 `stylePresetId`（renderer 已在 payload 里带上解析所需字段）。若 main 侧只是转发 renderer 已渲染好的 prompt，则无需改动——**实现时先确认 main 是否复用 build 函数**（Explore 显示 main 也 import 了 ai-analysis）；若复用，则按 Step 1 同样补 options 透传。

- [ ] **Step 4: 验证（构建 + 既有分析测试）**

Run: `npx vitest run tests/ && npm run build`
Expected: 测试 PASS；build 通过（类型对齐）

- [ ] **Step 5: 提交**

```bash
git add src/lib/ai-analysis.ts src/store/ai.ts electron/main.ts
git commit -m "feat(style): analyzeSrt 与重生成入口透传 stylePresetId"
```

---

## Task 6: AISettings 全局默认风格持久化

**Files:**
- Modify: `src/store/ai.ts`（`buildDefaultAISettings` 169-202；`loadAISettings` 779-886；`saveAISettings` 887-898）
- Test: `tests/card-style.test.ts`（追加，针对纯函数 `buildDefaultAISettings`）

- [ ] **Step 1: 写失败测试**

```ts
import { buildDefaultAISettings } from '../src/store/ai';
import { DEFAULT_STYLE_PRESET_ID } from '../src/types/ai';

describe('AISettings 默认风格', () => {
  it('buildDefaultAISettings 给出默认风格 id', () => {
    expect(buildDefaultAISettings().defaultStylePresetId).toBe(DEFAULT_STYLE_PRESET_ID);
  });
});
```

> 若 `buildDefaultAISettings` 未导出，先 `export`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/card-style.test.ts`
Expected: FAIL（`undefined !== 'editorial-eink'`）

- [ ] **Step 3: 实现**

`buildDefaultAISettings`（169-202）返回对象加：

```ts
    defaultStylePresetId: DEFAULT_STYLE_PRESET_ID,
```

`loadAISettings`（779-886）合并已存设置时，缺字段回退默认：

```ts
    defaultStylePresetId:
      typeof raw.defaultStylePresetId === 'string'
        ? raw.defaultStylePresetId
        : DEFAULT_STYLE_PRESET_ID,
```

`saveAISettings`（887-898）若是整对象序列化则自动包含；确认 `defaultStylePresetId` 在写出对象里。import `DEFAULT_STYLE_PRESET_ID`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/card-style.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/ai.ts tests/card-style.test.ts
git commit -m "feat(style): AISettings.defaultStylePresetId 默认值与读写"
```

---

## Task 7: 项目级 stylePresetId 持久化 + 迁移

**Files:**
- Modify: `src/lib/project-persistence.ts`（`ProjectData` 37-45 + 默认 / 迁移逻辑）
- Modify: 项目状态持有处（与 `projectStylePrompt` 同源的 store；实现时定位其加载点）
- Test: `tests/card-style.test.ts` 或 `tests/project-persistence.test.ts`（若存在则追加）

- [ ] **Step 1: 写失败测试（旧项目无字段 → 读时 undefined，解析回退默认）**

在 `tests/card-style.test.ts` 追加（纯解析层即可覆盖迁移语义）：

```ts
it('项目缺 stylePresetId 时解析回退默认', () => {
  const projectStylePresetId = undefined; // 旧 project.json
  expect(resolveStylePresetId({ project: projectStylePresetId })).toBe(
    DEFAULT_STYLE_PRESET_ID,
  );
});
```

若仓库已有 `tests/project-persistence.test.ts`，另加一例断言 `loadProjectFile` 对缺字段旧文件返回 `stylePresetId === undefined`（不写默认，读时由解析层兜底）。

- [ ] **Step 2: 运行确认状态**

Run: `npx vitest run tests/card-style.test.ts`
Expected: 解析层用例 PASS（已由 Task 2 覆盖）；project-persistence 用例 FAIL（字段未定义）

- [ ] **Step 3: 在 ProjectData 加项目级字段**

`src/lib/project-persistence.ts` 的 `ProjectData`（37-45）加：

```ts
  /** 项目级默认风格预设 id；缺省继承全局 */
  stylePresetId?: string;
```

加载逻辑：旧文件无该字段时**不写默认**，保持 `undefined`，由 `resolveStylePresetId` 在生成时兜底（保证旧项目零行为变化）。保存逻辑（`save-project-section`）走现有通道——若项目风格作为独立 section 持久化，新增一个轻量 section key（如 `styleLibrary`），或复用现有 project meta section；实现时与现有 section 划分保持一致，**不新增 IPC 名称**。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/project-persistence.ts tests/
git commit -m "feat(style): 项目级 stylePresetId 持久化与旧项目兼容"
```

---

## Task 8: StylePresetPreview 组件（iframe + GSAP 自动播放）

**Files:**
- Create: `src/components/StylePresetPreview.tsx`
- 参考：`src/components/HyperframesPreviewPlayer.tsx`（gsap raw 注入模式，line 2 / 56 / 123-135）

- [ ] **Step 1: 实现组件**

```tsx
import { useMemo } from 'react';
import gsapScript from 'gsap/dist/gsap.min.js?raw';

interface StylePresetPreviewProps {
  motionHtml?: string;
  className?: string;
}

const BOOTSTRAP = `
<script>
  window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
  window.addEventListener('load', function () {
    var master = gsap.timeline({ repeat: -1, repeatDelay: 0.8 });
    (window.__lingjiMotionTimelines || []).forEach(function (tl) {
      tl.progress(0).play();
      master.add(tl, 0);
    });
    master.play();
  });
</script>`;

export function StylePresetPreview({ motionHtml, className }: StylePresetPreviewProps) {
  const srcDoc = useMemo(() => {
    if (!motionHtml) return '';
    return [
      '<!doctype html><html><head><meta charset="utf-8" />',
      '<style>html,body{margin:0;height:100%;background:#0E0E10;overflow:hidden}',
      '#root{width:100%;height:100%}</style>',
      `<script>${gsapScript}</script>`,
      '</head><body><div id="root">',
      motionHtml,
      '</div>',
      BOOTSTRAP,
      '</body></html>',
    ].join('\n');
  }, [motionHtml]);

  if (!motionHtml) {
    return <div className={className} aria-label="无 Motion 预览" />;
  }
  return (
    <iframe
      className={className}
      title="风格预览"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
    />
  );
}
```

> 不自造 blinking/typing/breathing 效果——仅复用 GSAP 播放风格自带 timeline（遵守视觉反馈铁律）。`repeat:-1` 让库内预览循环展示。

- [ ] **Step 2: 验证编译**

Run: `npm run build`
Expected: 通过（gsap raw import 已在 HyperframesPreviewPlayer 用过，路径有效）

- [ ] **Step 3: 提交**

```bash
git add src/components/StylePresetPreview.tsx
git commit -m "feat(style): StylePresetPreview 沙箱 iframe + GSAP 自动播放"
```

---

## Task 9: StyleLibraryPanel 选择面板

**Files:**
- Create: `src/components/StyleLibraryPanel.tsx` + `src/components/StyleLibraryPanel.module.css`
- 复用：`src/ui/components` / `src/ui/primitives`（系统蓝 accent，不引第二套彩色）

- [ ] **Step 1: 实现面板**

```tsx
import { listStylePresets } from '../lib/card-style-presets';
import { StylePresetPreview } from './StylePresetPreview';
import styles from './StyleLibraryPanel.module.css';

interface StyleLibraryPanelProps {
  /** 当前选中的风格 id（已解析后的有效值） */
  value: string;
  onChange: (id: string) => void;
  /** 哪些 facet 与当前场景相关，用于在卡上提示「该风格仅支持 X」 */
  facetHint?: 'motion' | 'cover' | 'image';
}

export function StyleLibraryPanel({ value, onChange, facetHint }: StyleLibraryPanelProps) {
  const presets = listStylePresets();
  return (
    <div className={styles.grid}>
      {presets.map((preset) => {
        const selected = preset.id === value;
        const missingFacet =
          facetHint != null &&
          !(preset.facets[facetHint] && preset.facets[facetHint]!.trim());
        return (
          <button
            key={preset.id}
            type="button"
            className={`${styles.card} ${selected ? styles.selected : ''}`}
            onClick={() => onChange(preset.id)}
            aria-pressed={selected}
          >
            <div className={styles.previewBox}>
              <StylePresetPreview motionHtml={preset.preview.motionHtml} className={styles.iframe} />
              {preset.preview.coverImageAsset && (
                <img className={styles.coverThumb} src={preset.preview.coverImageAsset} alt="" />
              )}
            </div>
            <div className={styles.meta}>
              <span className={styles.name}>{preset.name}</span>
              <span className={styles.desc}>{preset.description}</span>
              <span className={styles.tags}>{preset.tags.join(' · ')}</span>
              {missingFacet && (
                <span className={styles.facetWarn}>该风格未定义此场景，将回退默认风格</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 写最小样式 `StyleLibraryPanel.module.css`**

```css
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.card { display: flex; flex-direction: column; text-align: left; padding: 0; border: 1px solid var(--color-separator, rgba(255,255,255,.12)); border-radius: 10px; background: var(--color-bg-elevated, #1b1d22); overflow: hidden; cursor: pointer; }
.selected { border-color: var(--color-system-blue); box-shadow: 0 0 0 1px var(--color-system-blue); }
.previewBox { position: relative; aspect-ratio: 16/9; background: #0E0E10; }
.iframe { width: 100%; height: 100%; border: 0; display: block; }
.coverThumb { position: absolute; right: 8px; bottom: 8px; width: 38%; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
.meta { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; }
.name { font-weight: 600; }
.desc { font-size: 12px; opacity: .75; }
.tags { font-size: 11px; opacity: .55; }
.facetWarn { font-size: 11px; color: var(--color-system-orange, #ff9f0a); }
```

- [ ] **Step 3: 验证编译**

Run: `npm run build`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/components/StyleLibraryPanel.tsx src/components/StyleLibraryPanel.module.css
git commit -m "feat(style): StyleLibraryPanel 风格网格选择面板"
```

---

## Task 10: Settings「风格库」tab + 全局默认接线

**Files:**
- Modify: `src/pages/Settings.tsx`（`SettingsTab` 13；`TABS` 21；`TabsContent` 100-126）

- [ ] **Step 1: 接线**

`SettingsTab` 联合类型加 `| 'style-library'`；`TABS` 加（import `Palette` from `lucide-react`）：

```ts
  { id: 'style-library', label: '风格库', icon: Palette },
```

新增 `TabsContent`：

```tsx
<TabsContent value="style-library" className={styles.contentPanel}>
  <StyleLibraryPanel
    value={resolveStylePresetId({ global: settings.defaultStylePresetId })}
    onChange={(id) => updateSettings({ defaultStylePresetId: id })}
  />
</TabsContent>
```

`settings` / `updateSettings` 取自现有 AI store hook（与同页其它 tab 一致）。import `StyleLibraryPanel`、`resolveStylePresetId`。

- [ ] **Step 2: 验证编译 + 手动**

Run: `npm run build`
Expected: 通过。手动：`npm run dev` → 设置 → 风格库 → 选风格 → 重开应用仍保留（落 settings.json）。

- [ ] **Step 3: 提交**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(style): 设置页风格库 tab 接入全局默认风格"
```

---

## Task 11: AICardInspector 单卡风格选择器

**Files:**
- Modify: `src/components/AICardInspector.tsx`（type pill 32-38 / 147-154；草稿 state 与 onSave/onRegenerate 136-138）

- [ ] **Step 1: 加单卡风格 state + 选择器**

在组件内加 state（初值取 `card.stylePresetId`）：

```tsx
const [stylePresetId, setStylePresetId] = useState<string | undefined>(card.stylePresetId);
```

在 type `PillGroup`（154）之后插入风格选择（用现有 `Select`/`PillGroup` primitive，选项来自 `listStylePresets()`，含一项「跟随项目/全局」=`undefined`）：

```tsx
<label className={styles.fieldLabel}>卡片风格</label>
<select
  className={styles.select}
  value={stylePresetId ?? ''}
  onChange={(e) => setStylePresetId(e.target.value || undefined)}
>
  <option value="">跟随项目 / 全局</option>
  {listStylePresets().map((p) => (
    <option key={p.id} value={p.id}>{p.name}</option>
  ))}
</select>
```

- [ ] **Step 2: 把 stylePresetId 纳入草稿更新**

在构造 `draftUpdates`（传给 `onSave` / `onRegenerate`）的对象里加 `stylePresetId`，使保存与重生成都携带单卡风格。重生成链路（Task 5 Step 2）解析时把它作为 `card` 层。

- [ ] **Step 3: 验证编译 + 手动**

Run: `npm run build`
Expected: 通过。手动：编辑器选一张卡 → 改风格 → 重生成 → 输出贴合所选风格。

- [ ] **Step 4: 提交**

```bash
git add src/components/AICardInspector.tsx
git commit -m "feat(style): 单卡 Inspector 风格选择器（含跟随项目/全局）"
```

---

## Task 12: 补全其余 9 个风格（facet 内容 + 预览资产）

> 每个风格一个独立步骤组，互不依赖，可并行。每个风格须产出：① `motion` facet 提示词块；② `cover` facet（适用时）；③ `image` facet（适用时）；④ `preview.motionHtml` 静态样例；⑤ `preview.coverImageAsset` 示意图（适用时）。

**Facet 编写契约（所有风格通用，必须遵守）：**

- **motion facet** 结构对齐 editorial-eink 的 motion 块骨架：`视觉系统锚点` → `Design DNA（4-6 条硬规则）` → `主题 tokens（色值锁定）` → `字体栈` → `排版阶梯` → `版式语法（该风格的布局单元 = step）` → `六类 type 适配指引` → `强制硬规则` → `失败示例`。**不得违反主干已有的 Motion Card 技术约束与入场/揭示/退场时序契约**；若该风格不用 Bento tile，须在块内显式重定义「step 单元」。
- **cover / image facet** 对齐 cover.regeneration 的维度结构（主体→…→风格→美学→质量→文字排版），替换美学锚点、色彩 token、字体倾向；保留「16:9 / 画幅」「文字准确率」等通用约束。
- **preview.motionHtml** 必须是自包含 motion 片段：内联 `<style>` + 同步 `<script>`，用 `gsap.timeline({ paused: true })` 并 `window.__lingjiMotionTimelines.push(tl)`；禁止 import/async/外部资源；体现该风格视觉，时长约 3-5s 可循环。
- **preview.coverImageAsset**：放 `src/components/style-assets/<id>-cover.png`（占位可用纯色/示意图），通过 `import xxx from './style-assets/<id>-cover.png'` 取 URL 字符串赋给 preset。
- 每个风格在 `card-style-presets.ts` 追加一个 `VisualStylePreset` 并加入 `VISUAL_STYLE_PRESETS`。
- 每加一个风格，更新 `tests/card-style-prompt-injection.test.ts`：断言该风格 motion facet 含其专属锚点关键词。

各风格 DNA 输入（来自 html-anything 清单）：

- [ ] **swiss-grid（瑞士国际主义）** — source: deck-swiss-international。palette: bg `#FAF8F2` ink `#111` accent `#002FA7`(克莱因蓝)/`#FFD500`。fonts: Inter Tight + Noto Sans SC + JetBrains Mono。DNA: 16 栏网格、极致字号对比、直角、1px hairline、无阴影无渐变。facets: motion + cover。预览：超大数字 + 网格分栏揭示。
- [ ] **nyt-data（NYT 数据社论）** — source: frame-data-chart-nyt。palette: bg `#f7f5ee`/`#0e0e0e` ink `#111` accent `#a91d1d`(新闻红)。fonts: Noto Serif SC + 等宽脚注。DNA: serif insight 大标题、手写 SVG 折线/柱、单墨色+accent、虚线网格、序列 dashoffset 揭示。facets: motion + image。预览：折线 strokeDashoffset 揭示。
- [ ] **cyber-glitch（赛博故障）** — source: frame-glitch-title / deck-hermes-cyber。palette: bg `#070708` ink `#e8e8e8` accent `#00d4ff`/`#ff2ec4`。fonts: Space Grotesk / JetBrains Mono。DNA: 色差抖动、CRT 扫描线、近黑底、6% grain。**重定义 step = 文本块逐段揭示**。facets: motion + cover。预览：标题 chromatic aberration。
- [ ] **film-leak（胶片电影）** — source: frame-light-leak-cinema。palette: bg 红棕/深蓝 ink 奶油 `#f3ead6` accent 暖橙 `#ff8a3d`。fonts: 斜体 serif。DNA: 2.39:1 信箱、暖漏光径向、14% 颗粒、亮度 0.3→1 入场。facets: motion + cover + image。预览：信箱画幅 + 漏光漂移。
- [ ] **hand-sketch（手绘便签）** — source: wireframe-sketch / frame-flowchart-sticky。palette: bg `#f4ede1` ink `#2b2b2b` accent 便利贴黄 `#ffd84d`。fonts: Caveat/Kalam + Noto Sans SC。DNA: 方格纸底、手写体、便利贴卡 ±2° 旋转、虚线连线。facets: 仅 motion（cover/image 留空 → 回退默认，UI 显示「仅支持 Motion」提示）。预览：便利贴依次贴上。
- [ ] **soft-apple（温柔苹果）** — source: web-proto-soft。palette: bg `#f0f1f4` ink `#1d1d1f` accent 系统蓝 `#0A84FF`。fonts: SF Pro / PingFang SC。DNA: squircle 圆角、嵌套半径双描边、环境网格光、弹性微动（GSAP `back.out`）。facets: motion + cover + image。预览：squircle 卡 spring 入场。
- [ ] **dark-graph（暗色数据图谱）** — source: deck-graphify-dark / deck-obsidian-claude。palette: bg `#06060c→#0e1020` ink `#e6e8f0` accent 渐变 `#a855f7→#60a5fa→#34d399`。fonts: Inter + JetBrains Mono。DNA: 模糊光球、玻璃拟态卡、渐变标题、力导向图示意。facets: motion + cover。预览：渐变标题 + 玻璃卡。
- [ ] **xhs-pastel（小红书柔彩）** — source: deck-xhs-pastel / card-xiaohongshu。palette: bg `#fef8f1` ink `#3a3a3a` accent 马卡龙桃/薄荷。fonts: Playfair 斜体 + Noto Sans SC。DNA: 奶油底、3 柔焦色块、28px 圆角马卡龙卡、01-04 编号序列。facets: motion + cover + image。预览：柔彩卡 + 编号序列。
- [ ] **mono-bold（极简大字）** — source: deck-dir-key-nav / deck-simple。palette: 单色满版循环（靛蓝/奶油/栗色…）ink 反色 accent 4px 色条。fonts: 大号无衬线 display。DNA: 单色满铺、超大显示标题、accent 短色条、mono 列表。facets: motion + cover。预览：满版色 + 超大标题入场。

每个风格完成后：

- [ ] **Step（每风格）：追加 preset 数据 + 测试 + 提交**

```bash
npx vitest run tests/card-style-prompt-injection.test.ts
git add src/lib/card-style-presets.ts src/lib/card-style-previews/ src/components/style-assets/ tests/card-style-prompt-injection.test.ts
git commit -m "feat(style): 新增 <preset-id> 风格预设与静态预览"
```

---

## Task 13: 全链路验证

- [ ] **Step 1: 全量测试**

Run: `npx vitest run`
Expected: 全绿（含解析层、注入、兼容、持久化）

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: 通过（含混淆）

- [ ] **Step 3: 手动验收（npm run dev）**

逐条确认验收标准：

1. 设置 → 风格库可选全局默认，重启保留。
2. 风格库每卡静态 motion 预览播放 + 封面示意图，秒开。
3. 项目级 / 单卡覆盖解析顺序正确（单卡 > 项目 > 全局 > 默认）。
4. 旧项目打开视觉零变化（解析回退 editorial-eink）。
5. 选非默认风格重生成 motion 卡 / 封面 / 图片卡，输出贴合该风格 DNA。
6. 仅 motion 的风格（hand-sketch）在 cover/image 场景显示回退提示。

- [ ] **Step 4: 收尾提交**

```bash
git add -A
git commit -m "chore(style): 风格模板库全链路验证收尾"
```

---

## Self-Review（写完后自检结论）

- **Spec coverage**：规格 12 节逐条对应——数据模型→T1；预设数据/解析→T2；提示词改造→T3；注入→T4；透传→T5；全局/项目/单卡持久化→T6/T7/T11；预览→T8；UI 库→T9/T10/T11；导出零改动→（无任务，设计即不动）；10 个风格→T3(默认)+T12(其余 9)；验收→T13。
- **类型一致性**：`VisualStylePreset` / `resolveStylePresetId` / `getStyleFacetBlock` / `DEFAULT_STYLE_PRESET_ID` / `stylePresetId` / `defaultStylePresetId` 跨任务命名统一。
- **已知 v1 取舍**：(a) cards.segment 主干保留的入场/揭示时序与「布局反禁忌」仍含 Bento tile 语汇，新风格须在自身 motion facet 内重定义 step 单元（已写进 T12 契约）；(b) editorial-eink 的 cover facet 沿用现有「缩略图」美学，与其 motion 的「电子杂志」美学不完全统一，但这是今日既有行为，按零变化原则保留。
- **实现期待确认**：build 函数 / analyzeSrt 的真实签名（位置参数 vs options）以源码为准（T4 Step1、T5 已标注）；main 是否复用 build 函数（T5 Step3 已标注先确认）。

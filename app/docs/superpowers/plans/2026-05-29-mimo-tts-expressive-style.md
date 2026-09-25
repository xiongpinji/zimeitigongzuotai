# MiMo TTS 表现力增强 + 长文本分块合成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MiMo TTS 按口播模板的演绎人设朗读、对长稿按句分块合成并拼接、用 AI 句级标签增强语气，同时字幕保持干净。

**Architecture:** TTS 配置作为口播模板（`UserPromptEntry`）字段（`ttsStyle`/`ttsAnnotateHint`）。renderer 合成前取当前模板人设、分句、调 LLM 句级打标（结构化、可校验、失败回退），构造 `{subtitle, speak}` 句子数组经 IPC 传入主进程；主进程按字数预算分块、逐块请求 MiMo、ffmpeg 拼接、按块真实时长出多条字幕。MiniMax 维持原单请求路径。

**Tech Stack:** TypeScript、Electron、React、Zustand、LangChain（`generateStructuredData`）、Vitest、ffmpeg/ffprobe（已随应用打包）。

参考 spec：`docs/superpowers/specs/2026-05-29-mimo-tts-expressive-style-design.md`

---

## 文件结构

新建：
- `src/lib/tts/types.ts` — 共享类型 `TtsUnit`
- `src/lib/tts/sentence-split.ts` — 确定性分句
- `src/lib/tts/mimo-style.ts` — 取演绎人设 + 默认人设常量
- `src/lib/tts/mimo-annotate.ts` — 打标引擎（白名单、prompt、LLM 调用、忠实校验、重组）
- `electron/tts-chunking.ts` — 句子按预算分块 + 按块字幕（纯函数）
- `electron/media-concat.ts` — ffmpeg 拼接 WAV
- 对应 `tests/*.test.ts`

修改：
- `src/lib/prompts/types.ts`、`src/lib/prompts/render.ts` — 模板新增字段 + YAML 读写
- `src/lib/prompts/script-template-defaults.ts` — seed 补 `ttsStyle`
- `electron/user-prompts-io.ts` — 写入保留新字段
- `src/types/ai.ts` — `AISettings.ttsMimoAutoAnnotate`
- `src/lib/electron-api.ts`、`electron/preload.ts` — `generateTTS` 新增入参
- `electron/tts-provider-runner.ts`、`src/lib/xiaomi-mimo-tts.ts` — runner/请求体支持人设+speak
- `electron/main.ts` — `generate-tts` 分块循环 + 拼接 + 按块字幕
- `src/hooks/useAIVideoWorkflow.ts` — 合成前置：取模板/分句/打标/构造 units
- `src/components/settings/PromptsConfigTab.tsx`（及模板编辑组件） — TTS 字段 UI

---

## Task 1: 共享类型与设置开关

**Files:**
- Create: `src/lib/tts/types.ts`
- Modify: `src/types/ai.ts`（`AISettings` 接口）
- Modify: `src/lib/prompts/types.ts`（`UserPromptEntry`、`UserPromptSeed`）

- [ ] **Step 1: 新建共享类型**

`src/lib/tts/types.ts`：
```ts
/** 一个句子的双轨表示：subtitle 进字幕（干净），speak 进 TTS 音频（可能带 MiMo 标签）。 */
export interface TtsUnit {
  subtitle: string;
  speak: string;
}
```

- [ ] **Step 2: 给口播模板类型加 TTS 字段**

在 `src/lib/prompts/types.ts` 的 `UserPromptEntry`（约 52-63 行）与 `UserPromptSeed`（约 65 行起）两个接口各加两个可选字段：
```ts
  /** MiMo 演绎人设：原样作为 MiMo role:user 指令；仅 MiMo 使用 */
  ttsStyle?: string;
  /** 打标风格倾向：注入打标 prompt 的一句话偏好 */
  ttsAnnotateHint?: string;
```

- [ ] **Step 3: 给 AISettings 加全局打标开关**

在 `src/types/ai.ts` 的 `AISettings` 接口（TTS 字段附近，约 230-234 行）加：
```ts
  /** MiMo 智能语气打标开关；缺省视为 true */
  ttsMimoAutoAnnotate?: boolean;
```

- [ ] **Step 4: 校验类型编译**

Run: `npx tsc --noEmit 2>&1 | grep -E "tts/types|prompts/types|types/ai" || echo "no new errors in edited type files"`
Expected: `no new errors in edited type files`

- [ ] **Step 5: Commit**

```bash
git add src/lib/tts/types.ts src/types/ai.ts src/lib/prompts/types.ts
git commit -m "feat(tts): add口播模板 TTS 字段与打标开关类型"
```

---

## Task 2: 确定性分句 `splitIntoSentences`

**Files:**
- Create: `src/lib/tts/sentence-split.ts`
- Test: `tests/sentence-split.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/sentence-split.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { splitIntoSentences } from '../src/lib/tts/sentence-split';

describe('splitIntoSentences', () => {
  it('按中文句末标点切分并保留标点', () => {
    expect(splitIntoSentences('你好。今天聊存储！为什么呢？')).toEqual([
      '你好。',
      '今天聊存储！',
      '为什么呢？',
    ]);
  });

  it('把换行/空行归一为不产生空句', () => {
    expect(splitIntoSentences('第一段。\n\n第二段。')).toEqual(['第一段。', '第二段。']);
  });

  it('处理中英混排与省略号', () => {
    const out = splitIntoSentences('这是 SSD……很快。It is fast.');
    expect(out).toEqual(['这是 SSD……很快。', 'It is fast.']);
  });

  it('无句末标点时整体作为一句', () => {
    expect(splitIntoSentences('没有标点的一段话')).toEqual(['没有标点的一段话']);
  });

  it('空白输入返回空数组', () => {
    expect(splitIntoSentences('   \n\n ')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/sentence-split.test.ts`
Expected: FAIL（`splitIntoSentences` is not a function / 模块不存在）

- [ ] **Step 3: 实现**

`src/lib/tts/sentence-split.ts`：
```ts
const SENTENCE_END = /[。！？；…!?;]+(?:["'”’）)】」』]+)?/g;

/**
 * 把文本按中英句末标点切分，保留标点；换行/多空白归一为单空格后再切。
 * 末尾无句末标点的残余作为最后一句。空白输入返回 []。
 */
export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences: string[] = [];
  let lastIndex = 0;
  for (const match of normalized.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    const piece = normalized.slice(lastIndex, end).trim();
    if (piece) sentences.push(piece);
    lastIndex = end;
  }
  const tail = normalized.slice(lastIndex).trim();
  if (tail) sentences.push(tail);
  return sentences;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/sentence-split.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: Commit**

```bash
git add src/lib/tts/sentence-split.ts tests/sentence-split.test.ts
git commit -m "feat(tts): 确定性分句 splitIntoSentences"
```

---

## Task 3: 按预算分块 + 按块字幕 `tts-chunking`

**Files:**
- Create: `electron/tts-chunking.ts`
- Test: `tests/tts-chunking.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/tts-chunking.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import {
  MIMO_TTS_CHUNK_CHAR_BUDGET,
  groupSentencesByBudget,
  buildSrtFromChunks,
} from '../electron/tts-chunking';
import { parseSrt } from '../src/lib/srt-parser';
import type { TtsUnit } from '../src/lib/tts/types';

const u = (s: string): TtsUnit => ({ subtitle: s, speak: s });

describe('groupSentencesByBudget', () => {
  it('连续句打包且不超预算', () => {
    const chunks = groupSentencesByBudget([u('一二三'), u('四五六'), u('七八九')], 6);
    expect(chunks.map((c) => c.map((x) => x.subtitle).join(''))).toEqual(['一二三四五六', '七八九']);
  });

  it('绝不切断单句：单句超预算自成一块', () => {
    const chunks = groupSentencesByBudget([u('一二三四五六七八'), u('九十')], 5);
    expect(chunks).toHaveLength(2);
    expect(chunks[0][0].subtitle).toBe('一二三四五六七八');
  });

  it('空输入返回空数组', () => {
    expect(groupSentencesByBudget([], 100)).toEqual([]);
  });

  it('导出默认预算常量', () => {
    expect(MIMO_TTS_CHUNK_CHAR_BUDGET).toBeGreaterThan(0);
  });
});

describe('buildSrtFromChunks', () => {
  it('块间偏移累加、末块 endMs 等于总时长、可被 parseSrt 解析', () => {
    const parts = [
      { durMs: 2000, units: [u('第一句话。'), u('第二句话。')] },
      { durMs: 1000, units: [u('第三句。')] },
    ];
    const srt = buildSrtFromChunks(parts);
    const entries = parseSrt(srt);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(entries[0].startMs).toBe(0);
    expect(entries[entries.length - 1].endMs).toBe(3000);
    expect(entries.every((e) => !e.text.includes('\n'))).toBe(true);
  });

  it('字幕文本取 subtitle（干净），不含 speak 的标签', () => {
    const parts = [{ durMs: 1000, units: [{ subtitle: '重点来了。', speak: '(强调)重点来了。' }] }];
    const srt = buildSrtFromChunks(parts);
    expect(srt).toContain('重点来了。');
    expect(srt).not.toContain('(强调)');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/tts-chunking.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`electron/tts-chunking.ts`：
```ts
import type { SrtEntry } from '../src/types';
import type { TtsUnit } from '../src/lib/tts/types';
import { resegmentSrtEntries, DEFAULT_MAX_CHARS_PER_ENTRY } from '../src/lib/srt-resegment';
import { serializeSrtEntries } from '../src/lib/srt-parser';

/** MiMo 单次请求字数预算；3000–8000 字稿约 4–10 块。限制未文档化，保守可调。 */
export const MIMO_TTS_CHUNK_CHAR_BUDGET = 800;

export interface ChunkPart {
  durMs: number;
  units: TtsUnit[];
}

/** 连续句按 speak 字数打包，绝不切断单句；单句超预算自成一块。 */
export function groupSentencesByBudget(units: TtsUnit[], budget: number): TtsUnit[][] {
  const chunks: TtsUnit[][] = [];
  let current: TtsUnit[] = [];
  let currentLen = 0;
  for (const unit of units) {
    const len = unit.speak.length;
    if (current.length > 0 && currentLen + len > budget) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(unit);
    currentLen += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * 用每块的真实时长构建多条字幕：
 * 每块按字幕文本拼成一条 entry [offset, offset+durMs]，再用 resegmentSrtEntries 切到合适长度；
 * offset 在块间累加。字幕文本取 units.subtitle（干净）。
 */
export function buildSrtFromChunks(parts: ChunkPart[]): string {
  const entries: SrtEntry[] = [];
  let offset = 0;
  for (const part of parts) {
    const text = part.units.map((u) => u.subtitle).join('');
    if (text) {
      const local = resegmentSrtEntries(
        [{ index: 1, startMs: 0, endMs: Math.max(1, Math.round(part.durMs)), text }],
        DEFAULT_MAX_CHARS_PER_ENTRY,
      );
      for (const e of local) {
        entries.push({ ...e, startMs: e.startMs + offset, endMs: e.endMs + offset });
      }
    }
    offset += Math.max(0, Math.round(part.durMs));
  }
  return serializeSrtEntries(entries.map((e, i) => ({ ...e, index: i + 1 })));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/tts-chunking.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/tts-chunking.ts tests/tts-chunking.test.ts
git commit -m "feat(tts): 句子按预算分块 + 按块真实时长出字幕"
```

---

## Task 4: 打标引擎 `mimo-annotate`

**Files:**
- Create: `src/lib/tts/mimo-annotate.ts`
- Test: `tests/mimo-annotate.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/mimo-annotate.test.ts`：
```ts
import { describe, expect, it, vi } from 'vitest';
import {
  MIMO_TAG_WHITELIST,
  isAnnotationFaithful,
  sanitizeAnnotation,
  buildAnnotateSystemPrompt,
} from '../src/lib/tts/mimo-annotate';

describe('isAnnotationFaithful', () => {
  const clean = ['第一句。', '第二句。'];
  it('字词顺序一致 → true', () => {
    expect(isAnnotationFaithful([{ sentence: '第一句。', tag: '强调' }, { sentence: '第二句。', tag: null }], clean)).toBe(true);
  });
  it('改了字 → false', () => {
    expect(isAnnotationFaithful([{ sentence: '第一句！', tag: null }, { sentence: '第二句。', tag: null }], clean)).toBe(false);
  });
  it('句数不符 → false', () => {
    expect(isAnnotationFaithful([{ sentence: '第一句。', tag: null }], clean)).toBe(false);
  });
});

describe('sanitizeAnnotation', () => {
  it('非白名单标签置 null', () => {
    const out = sanitizeAnnotation([{ sentence: 'a', tag: '咆哮' }, { sentence: 'b', tag: '强调' }]);
    expect(out).toEqual([{ sentence: 'a', tag: null }, { sentence: 'b', tag: '强调' }]);
  });
});

describe('buildAnnotateSystemPrompt', () => {
  it('包含白名单且在有 hint 时注入', () => {
    const p = buildAnnotateSystemPrompt('偏深度，多停顿');
    for (const tag of MIMO_TAG_WHITELIST) expect(p).toContain(tag);
    expect(p).toContain('偏深度，多停顿');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/mimo-annotate.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数部分**

`src/lib/tts/mimo-annotate.ts`：
```ts
import type { AISettings } from '../../types/ai';
import { generateStructuredData } from '../llm';

export const MIMO_TAG_WHITELIST = [
  '强调', '停顿', '轻松', '认真', '好奇', '感叹', '加快', '放慢',
] as const;
export type MimoTag = (typeof MIMO_TAG_WHITELIST)[number];

export interface AnnotatedSentence {
  sentence: string;
  tag: MimoTag | string | null;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 校验：打标结果的句子拼接（忽略空白）必须与原句拼接完全一致，且句数相同。 */
export function isAnnotationFaithful(ann: AnnotatedSentence[], clean: string[]): boolean {
  if (ann.length !== clean.length) return false;
  return normalize(ann.map((a) => a.sentence).join('')) === normalize(clean.join(''));
}

/** 非白名单标签一律置 null。 */
export function sanitizeAnnotation(ann: AnnotatedSentence[]): Array<{ sentence: string; tag: MimoTag | null }> {
  const allow = new Set<string>(MIMO_TAG_WHITELIST);
  return ann.map((a) => ({
    sentence: a.sentence,
    tag: a.tag && allow.has(a.tag) ? (a.tag as MimoTag) : null,
  }));
}

export function buildAnnotateSystemPrompt(hint: string): string {
  const whitelist = MIMO_TAG_WHITELIST.join('、');
  const hintLine = hint.trim() ? `\n本节目风格偏好（在不违反上述规则前提下参考）：${hint.trim()}` : '';
  return `你是口播语气标注助手。给定按编号排列的句子，为每句可选地附加一个"演绎标签"，用于语音合成时调整语气。

标签白名单（只能从中选，或不打标）：${whitelist}

铁律：
1. 绝不改动任何字词、标点、顺序；sentence 必须与输入句逐字一致。
2. 多数句子应不打标（tag 为 null）；只在能真正增强表达时打标。
3. 按修辞角色选标签：转折/反问→强调或好奇；关键数据/结论/金句→强调或停顿；铺垫/过渡→轻松或放慢。
4. 只输出一个 JSON 对象：{"items":[{"sentence":"原句原文","tag":"强调"|null}, ...]}，items 顺序与数量必须与输入完全一致，不要 markdown、不要解释。${hintLine}`;
}
```

- [ ] **Step 4: 运行纯函数测试通过**

Run: `npx vitest run tests/mimo-annotate.test.ts`
Expected: PASS

- [ ] **Step 5: 追加 `annotateForMimo`（带 LLM 注入）测试**

在 `tests/mimo-annotate.test.ts` 追加：
```ts
import { annotateForMimo } from '../src/lib/tts/mimo-annotate';

const settings = { ttsMimoAutoAnnotate: true } as unknown as import('../src/types/ai').AISettings;

describe('annotateForMimo', () => {
  const clean = ['第一句。', '第二句。'];

  it('LLM 合法返回 → 产出每句标签', async () => {
    const gen = vi.fn().mockResolvedValue({ items: [{ sentence: '第一句。', tag: '强调' }, { sentence: '第二句。', tag: null }] });
    const tags = await annotateForMimo(clean, '', settings, { generate: gen });
    expect(tags).toEqual(['强调', null]);
  });

  it('LLM 改写文本 → 整体回退全 null', async () => {
    const gen = vi.fn().mockResolvedValue({ items: [{ sentence: '改写了。', tag: '强调' }, { sentence: '第二句。', tag: null }] });
    const tags = await annotateForMimo(clean, '', settings, { generate: gen });
    expect(tags).toEqual([null, null]);
  });

  it('LLM 抛错 → 回退全 null', async () => {
    const gen = vi.fn().mockRejectedValue(new Error('boom'));
    const tags = await annotateForMimo(clean, '', settings, { generate: gen });
    expect(tags).toEqual([null, null]);
  });

  it('开关关闭 → 跳过、全 null、不调用 LLM', async () => {
    const gen = vi.fn();
    const off = { ttsMimoAutoAnnotate: false } as unknown as import('../src/types/ai').AISettings;
    const tags = await annotateForMimo(clean, '', off, { generate: gen });
    expect(tags).toEqual([null, null]);
    expect(gen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 运行确认新测试失败**

Run: `npx vitest run tests/mimo-annotate.test.ts`
Expected: FAIL（`annotateForMimo` is not a function）

- [ ] **Step 7: 实现 `annotateForMimo`**

在 `src/lib/tts/mimo-annotate.ts` 追加：
```ts
export interface AnnotateDeps {
  /** 注入点，默认用真实 LLM。测试传 mock。 */
  generate?: (
    settings: AISettings,
    systemPrompt: string,
    userMessage: string,
  ) => Promise<Record<string, unknown>>;
}

function buildAnnotateUserMessage(clean: string[]): string {
  return clean.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

/**
 * 返回与 clean 等长的标签数组（每项为白名单标签或 null）。
 * 开关关闭 / LLM 失败 / 校验不通过 → 全 null（永不抛错、永不阻断合成）。
 */
export async function annotateForMimo(
  clean: string[],
  hint: string,
  settings: AISettings,
  deps: AnnotateDeps = {},
): Promise<Array<MimoTag | null>> {
  const allNull = (): Array<MimoTag | null> => clean.map(() => null);
  if (clean.length === 0) return [];
  if (settings.ttsMimoAutoAnnotate === false) return allNull();

  const generate = deps.generate ?? ((s, sys, usr) => generateStructuredData(s, sys, usr));
  try {
    const raw = await generate(settings, buildAnnotateSystemPrompt(hint), buildAnnotateUserMessage(clean));
    const items = Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: AnnotatedSentence[] }).items)
      : [];
    if (!isAnnotationFaithful(items, clean)) return allNull();
    return sanitizeAnnotation(items).map((x) => x.tag);
  } catch {
    return allNull();
  }
}
```

- [ ] **Step 8: 运行确认全部通过**

Run: `npx vitest run tests/mimo-annotate.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/tts/mimo-annotate.ts tests/mimo-annotate.test.ts
git commit -m "feat(tts): MiMo 句级打标引擎（白名单+校验+回退）"
```

---

## Task 5: 取演绎人设 `mimo-style`

**Files:**
- Create: `src/lib/tts/mimo-style.ts`
- Test: `tests/mimo-style.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/mimo-style.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_MIMO_STYLE, resolveMimoStyleInstruction } from '../src/lib/tts/mimo-style';
import type { UserPromptEntry } from '../src/lib/prompts/types';

const tpl = (ttsStyle?: string): UserPromptEntry => ({
  id: 'x', category: 'script-template', name: 'X', description: '', system: '', user: '{{rawText}}', isBuiltin: false, ttsStyle,
});

describe('resolveMimoStyleInstruction', () => {
  it('模板 ttsStyle 优先', () => {
    expect(resolveMimoStyleInstruction(tpl('沉稳清晰'))).toBe('沉稳清晰');
  });
  it('模板为空或缺失 → 默认人设', () => {
    expect(resolveMimoStyleInstruction(tpl('   '))).toBe(DEFAULT_MIMO_STYLE);
    expect(resolveMimoStyleInstruction(undefined)).toBe(DEFAULT_MIMO_STYLE);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/mimo-style.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/lib/tts/mimo-style.ts`：
```ts
import type { UserPromptEntry } from '../prompts/types';

/** 模板未配置 ttsStyle 时的兜底演绎人设。 */
export const DEFAULT_MIMO_STYLE =
  '用自然、亲切、有分享欲的口播状态来念，像在跟懂行的朋友交流而不是照稿播报；语速中等偏快、有节奏感；抛出观点或关键数据前可略作停顿，讲到亮点时语气微微上扬，陈述事实时沉稳清晰；避免平铺直叙的播音腔与机械感。';

export function resolveMimoStyleInstruction(template: UserPromptEntry | undefined): string {
  const style = template?.ttsStyle?.trim();
  return style || DEFAULT_MIMO_STYLE;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/mimo-style.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tts/mimo-style.ts tests/mimo-style.test.ts
git commit -m "feat(tts): 取口播模板演绎人设 + 默认兜底"
```

---

## Task 6: 内置模板补默认演绎人设

**Files:**
- Modify: `src/lib/prompts/script-template-defaults.ts`
- Test: `tests/script-template-defaults.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/script-template-defaults.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { SCRIPT_TEMPLATE_SEEDS } from '../src/lib/prompts/script-template-defaults';

describe('SCRIPT_TEMPLATE_SEEDS ttsStyle', () => {
  it('三个内置 seed 都带非空 ttsStyle', () => {
    expect(SCRIPT_TEMPLATE_SEEDS).toHaveLength(3);
    for (const seed of SCRIPT_TEMPLATE_SEEDS) {
      expect(typeof seed.ttsStyle).toBe('string');
      expect((seed.ttsStyle ?? '').trim().length).toBeGreaterThan(10);
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/script-template-defaults.test.ts`
Expected: FAIL（ttsStyle undefined）

- [ ] **Step 3: 实现 — 给三个 seed 加 `ttsStyle`**

在 `src/lib/prompts/script-template-defaults.ts` 顶部常量区加：
```ts
const NEWS_BROADCAST_TTS_STYLE =
  '用专业新闻主播的状态播读：沉稳、客观、清晰、可信；语速平稳、咬字清楚；陈述数据与事实时坚定有力，段落过渡自然。避免夸张情绪与口水音。';
const TECH_REVIEW_TTS_STYLE =
  '用科技自媒体主播的状态来念：轻松、专业、有分享欲，像跟朋友聊技术；语速中等偏快、有节奏；讲到亮点或反差时语气微微上扬带点兴奋，解释概念时清晰耐心；抛关键数据前略作停顿。避免播音腔与机械感。';
const KNOWLEDGE_POPULAR_TTS_STYLE =
  '用知识科普主播的状态来念：亲切、生动、有引导感；语速适中、抑扬有致；提问句略带好奇上扬，讲比喻或故事时柔和有画面感，点要点时清晰强调。避免枯燥平铺。';
```
然后在三个 seed 对象里各加一行 `ttsStyle`：
- `news-broadcast`：`ttsStyle: NEWS_BROADCAST_TTS_STYLE,`
- `tech-review`：`ttsStyle: TECH_REVIEW_TTS_STYLE,`
- `knowledge-popular`：`ttsStyle: KNOWLEDGE_POPULAR_TTS_STYLE,`

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/script-template-defaults.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts/script-template-defaults.ts tests/script-template-defaults.test.ts
git commit -m "feat(tts): 内置口播模板补默认演绎人设"
```

---

## Task 7: 模板 YAML 读写保留 TTS 字段

**Files:**
- Modify: `src/lib/prompts/render.ts`（`UserPromptYamlBody`、`parseUserPromptYaml`、`serializeUserPromptYaml`）
- Modify: `electron/user-prompts-io.ts`（`WriteUserPromptInput` 与写入处）
- Test: `tests/user-prompt-yaml-tts.test.ts`

- [ ] **Step 1: 写失败测试（往返保留新字段）**

`tests/user-prompt-yaml-tts.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { parseUserPromptYaml, serializeUserPromptYaml } from '../src/lib/prompts/render';

describe('user-prompt YAML 保留 TTS 字段', () => {
  it('serialize → parse 往返保留 ttsStyle / ttsAnnotateHint', () => {
    const yaml = serializeUserPromptYaml({
      name: '一叶知秋', description: 'd', system: 's', user: '{{rawText}}',
      ttsStyle: '沉稳清晰有温度', ttsAnnotateHint: '多停顿',
    });
    const entry = parseUserPromptYaml(yaml, { id: 'yzq', category: 'script-template' });
    expect(entry.ttsStyle).toBe('沉稳清晰有温度');
    expect(entry.ttsAnnotateHint).toBe('多停顿');
  });

  it('旧 YAML 无 TTS 字段时不报错且为 undefined', () => {
    const entry = parseUserPromptYaml('name: A\nuser: "{{rawText}}"\n', { id: 'a', category: 'script-template' });
    expect(entry.ttsStyle).toBeUndefined();
    expect(entry.ttsAnnotateHint).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/user-prompt-yaml-tts.test.ts`
Expected: FAIL（ttsStyle undefined after round-trip）

- [ ] **Step 3: 扩展 `UserPromptYamlBody` 与解析**

在 `src/lib/prompts/render.ts`：
- `UserPromptYamlBody` 接口加：
```ts
  ttsStyle?: string;
  ttsAnnotateHint?: string;
```
- `parseUserPromptYaml` 在读取 createdAt/updatedAt 附近加：
```ts
  const ttsStyle = typeof obj.ttsStyle === 'string' ? obj.ttsStyle : undefined;
  const ttsAnnotateHint = typeof obj.ttsAnnotateHint === 'string' ? obj.ttsAnnotateHint : undefined;
```
并在 `return { ... }` 对象里加 `ttsStyle, ttsAnnotateHint,`。

- [ ] **Step 4: 扩展 `serializeUserPromptYaml`**

在 `serializeUserPromptYaml` 的 payload 组装处（`payload.user = body.user;` 之后）加：
```ts
  if (typeof body.ttsStyle === 'string' && body.ttsStyle.trim()) payload.ttsStyle = body.ttsStyle;
  if (typeof body.ttsAnnotateHint === 'string' && body.ttsAnnotateHint.trim()) payload.ttsAnnotateHint = body.ttsAnnotateHint;
```

- [ ] **Step 5: 运行往返测试通过**

Run: `npx vitest run tests/user-prompt-yaml-tts.test.ts`
Expected: PASS

- [ ] **Step 6: 让写入入口透传新字段**

在 `electron/user-prompts-io.ts`：
- `WriteUserPromptInput` 接口（约 147 行起）加可选 `ttsStyle?: string; ttsAnnotateHint?: string;`
- 在调用 `serializeUserPromptYaml(...)` 的写入处，把这两个字段一并传入 body。

Run: `npx tsc --noEmit 2>&1 | grep -E "user-prompts-io|render.ts" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 7: Commit**

```bash
git add src/lib/prompts/render.ts electron/user-prompts-io.ts tests/user-prompt-yaml-tts.test.ts
git commit -m "feat(tts): 口播模板 YAML 读写保留 ttsStyle/ttsAnnotateHint"
```

---

## Task 8: 请求体 + runner 支持人设与 speak 文本

**Files:**
- Modify: `src/lib/xiaomi-mimo-tts.ts`（`buildXiaomiMimoTtsRequestBody`、`BuildXiaomiMimoTtsRequestOptions`）
- Modify: `electron/tts-provider-runner.ts`（`TTSRunnerOptions`、`runXiaomiMimoTTS`）
- Test: `tests/xiaomi-mimo-tts.test.ts`（新建或扩展）

- [ ] **Step 1: 写失败测试**

`tests/xiaomi-mimo-tts.test.ts`（若已存在则追加这个 describe）：
```ts
import { describe, expect, it } from 'vitest';
import { buildXiaomiMimoTtsRequestBody } from '../src/lib/xiaomi-mimo-tts';
import type { TTSProvider, TTSVoicePreset } from '../src/types/ai';

const provider = { id: 'p', name: 'mimo', type: 'xiaomi_mimo', baseUrl: '', apiKey: 'k', models: ['mimo-v2.5-tts-voiceclone'] } as TTSProvider;
const voice = { id: 'v', name: 'V', providerId: 'p', providerType: 'xiaomi_mimo', source: 'cloned', referenceAudioPath: '/a.wav', params: { speed: 1, vol: 1, pitch: 0, emotion: '' }, createdAt: 0, updatedAt: 0 } as TTSVoicePreset;

describe('buildXiaomiMimoTtsRequestBody styleInstruction/speak', () => {
  it('styleInstruction 作 user、speak 作 assistant', () => {
    const body = buildXiaomiMimoTtsRequestBody({
      text: '原文', provider, voice, referenceAudioBase64: 'AA', referenceAudioMime: 'audio/wav',
      styleInstruction: '沉稳清晰', speakText: '(强调)原文',
    }) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0]).toEqual({ role: 'user', content: '沉稳清晰' });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '(强调)原文' });
  });

  it('未传 styleInstruction/speakText 时回退默认指令 + text', () => {
    const body = buildXiaomiMimoTtsRequestBody({
      text: '原文', provider, voice, referenceAudioBase64: 'AA', referenceAudioMime: 'audio/wav',
    }) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0].content).toContain('朗读');
    expect(body.messages[1].content).toBe('原文');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/xiaomi-mimo-tts.test.ts`
Expected: FAIL（不接受 styleInstruction/speakText，或断言不符）

- [ ] **Step 3: 实现 — 扩展请求体构造**

在 `src/lib/xiaomi-mimo-tts.ts`：
- `BuildXiaomiMimoTtsRequestOptions` 接口加：
```ts
  styleInstruction?: string;
  speakText?: string;
```
- `buildXiaomiMimoTtsRequestBody` 的 messages 改为：
```ts
    messages: [
      {
        role: 'user',
        content:
          options.styleInstruction?.trim() ||
          '请使用自然、清晰、适合视频口播的语气朗读下面的文本。',
      },
      {
        role: 'assistant',
        content: options.speakText?.trim() || options.text,
      },
    ],
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/xiaomi-mimo-tts.test.ts`
Expected: PASS

- [ ] **Step 5: 给 runner 增加可选透传字段**

在 `electron/tts-provider-runner.ts`：
- `TTSRunnerOptions` 接口加：
```ts
  styleInstruction?: string;
  speakText?: string;
```
- `runXiaomiMimoTTS` 内构造请求体处，把 `styleInstruction: options.styleInstruction` 与 `speakText: options.speakText` 传入 `buildXiaomiMimoTtsRequestBody(...)`。

Run: `npx tsc --noEmit 2>&1 | grep -E "tts-provider-runner|xiaomi-mimo-tts" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 6: Commit**

```bash
git add src/lib/xiaomi-mimo-tts.ts electron/tts-provider-runner.ts tests/xiaomi-mimo-tts.test.ts
git commit -m "feat(tts): MiMo 请求体支持演绎人设与带标签文本"
```

---

## Task 9: ffmpeg 拼接 `media-concat`

**Files:**
- Create: `electron/media-concat.ts`
- Test: `tests/media-concat.test.ts`

- [ ] **Step 1: 写失败测试（注入 execFile）**

`tests/media-concat.test.ts`：
```ts
import { describe, expect, it, vi } from 'vitest';
import { concatWavFiles } from '../electron/media-concat';

describe('concatWavFiles', () => {
  it('用 concat demuxer + -c copy 调 ffmpeg，输出到目标路径', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const execFile = vi.fn(async (file: string, args: string[]) => {
      calls.push({ file, args });
      return { stdout: '', stderr: '' };
    });
    await concatWavFiles(['/tmp/a.wav', '/tmp/b.wav'], '/tmp/out.wav', {
      ffmpegPath: '/usr/bin/ffmpeg',
      execFile,
      writeListFile: vi.fn(async () => '/tmp/list.txt'),
    });
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(calls[0].file).toBe('/usr/bin/ffmpeg');
    expect(calls[0].args).toEqual(
      expect.arrayContaining(['-f', 'concat', '-safe', '0', '-i', '/tmp/list.txt', '-c', 'copy', '/tmp/out.wav']),
    );
  });

  it('单文件直接走 ffmpeg copy（仍产出目标文件）', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
    await concatWavFiles(['/tmp/only.wav'], '/tmp/out.wav', {
      ffmpegPath: 'ffmpeg', execFile, writeListFile: vi.fn(async () => '/tmp/list.txt'),
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/media-concat.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`electron/media-concat.ts`：
```ts
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);

export interface ConcatWavOptions {
  ffmpegPath: string;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  /** 写 concat 列表文件，返回其路径；默认写到系统临时目录。 */
  writeListFile?: (lines: string[]) => Promise<string>;
}

function escapeForConcatList(p: string): string {
  // ffmpeg concat 列表：单引号包裹，内部单引号转义
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

async function defaultWriteListFile(lines: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingji-concat-'));
  const listPath = path.join(dir, 'list.txt');
  await fs.writeFile(listPath, lines.join('\n') + '\n', 'utf-8');
  return listPath;
}

/** 用 ffmpeg concat demuxer 把同格式 WAV 无损拼接为单个文件。 */
export async function concatWavFiles(
  inputs: string[],
  output: string,
  options: ConcatWavOptions,
): Promise<void> {
  if (inputs.length === 0) throw new Error('concatWavFiles: 输入为空');
  const execFile = options.execFile ?? execFileAsync;
  const writeListFile = options.writeListFile ?? defaultWriteListFile;
  const listPath = await writeListFile(inputs.map(escapeForConcatList));
  await execFile(options.ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', output,
  ]);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/media-concat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/media-concat.ts tests/media-concat.test.ts
git commit -m "feat(tts): ffmpeg 无损拼接 WAV"
```

---

## Task 10: IPC 契约扩展 `generateTTS`

**Files:**
- Modify: `src/lib/electron-api.ts:381-395`
- Modify: `electron/preload.ts:248-262`

- [ ] **Step 1: 扩展 electron-api 类型**

在 `src/lib/electron-api.ts` 的 `generateTTS` 入参对象类型里，`projectDir` 之前加：
```ts
    styleInstruction?: string;
    sentences?: Array<{ subtitle: string; speak: string }>;
```

- [ ] **Step 2: 扩展 preload 类型**

在 `electron/preload.ts` 的 `generateTTS` 入参类型里同样加这两行（与 electron-api 保持一致）。preload 实现仍是 `ipcRenderer.invoke('generate-tts', args)`，无需改逻辑。

- [ ] **Step 3: 校验编译**

Run: `npx tsc --noEmit 2>&1 | grep -E "electron-api|preload" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 4: Commit**

```bash
git add src/lib/electron-api.ts electron/preload.ts
git commit -m "feat(tts): generateTTS IPC 增加 styleInstruction/sentences"
```

---

## Task 11: 主进程分块合成 + 拼接 + 按块字幕

**Files:**
- Modify: `electron/main.ts`（`generate-tts` handler，约 2133-2293；导入区）

- [ ] **Step 1: 加导入**

在 `electron/main.ts` 导入区加：
```ts
import { groupSentencesByBudget, buildSrtFromChunks, MIMO_TTS_CHUNK_CHAR_BUDGET, type ChunkPart } from './tts-chunking';
import { concatWavFiles } from './media-concat';
```

- [ ] **Step 2: 扩展 handler 入参类型**

在 `generate-tts` 的 `args` 类型里加：
```ts
      styleInstruction?: string;
      sentences?: Array<{ subtitle: string; speak: string }>;
```

- [ ] **Step 3: 在写音频前分流：MiMo+sentences 走分块路径**

定位现有"单请求"段落（`const result = await runTTSProvider({...})` 到写 `audioPath` 与 `srtText` 之间，约 2196-2250）。改为：当 `provider.type === 'xiaomi_mimo' && args.sentences?.length` 时走新分块分支，否则保持原有单请求逻辑。新分支核心代码：
```ts
      const audioPath = path.join(projectDir, 'podcast-audio.wav');
      let durationMs = 0;
      let srtText = '';

      if (provider.type === 'xiaomi_mimo' && args.sentences && args.sentences.length > 0) {
        const chunks = groupSentencesByBudget(args.sentences, MIMO_TTS_CHUNK_CHAR_BUDGET);
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingji-tts-'));
        const parts: ChunkPart[] = [];
        const partPaths: string[] = [];
        const { ffmpegPath, ffprobePath } = resolveRuntimeBinaries();
        try {
          for (let i = 0; i < chunks.length; i++) {
            const speakText = chunks[i].map((u) => u.speak).join('');
            let buf: Buffer | null = null;
            let lastErr: unknown;
            for (let attempt = 0; attempt <= 2 && !buf; attempt++) {
              try {
                const r = await runTTSProvider({
                  text: speakText, provider, voice, signal: controller.signal,
                  styleInstruction: args.styleInstruction, speakText,
                });
                buf = r.audioBuffer;
              } catch (err) {
                lastErr = err;
                if ((err as { name?: string }).name === 'AbortError') throw err;
              }
            }
            if (!buf) throw lastErr instanceof Error ? lastErr : new Error('MiMo 分块合成失败');
            const partPath = path.join(tmpDir, `chunk-${i}.wav`);
            await fs.writeFile(partPath, buf);
            partPaths.push(partPath);
            const durMs = await readAudioDurationMs(partPath, { ffprobePath });
            parts.push({ durMs, units: chunks[i] });
            mainWindow?.webContents.send('tts-progress', 35 + Math.round((50 * (i + 1)) / chunks.length));
          }
          await concatWavFiles(partPaths, audioPath, { ffmpegPath });
          durationMs = parts.reduce((sum, p) => sum + p.durMs, 0);
          srtText = buildSrtFromChunks(parts);
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true });
        }
      } else {
        // —— 原单请求路径（保留现有逻辑）——
        const result = await runTTSProvider({ text, provider, voice, signal: controller.signal });
        const audioBuf = result.audioBuffer;
        if (audioBuf.byteLength === 0) throw new Error('TTS 未返回任何音频数据，请检查 API Key 及配置');
        await fs.writeFile(audioPath, audioBuf);
        durationMs = result.durationMs ?? 0;
        if (durationMs <= 0) {
          try {
            durationMs = await readAudioDurationMs(audioPath, { ffprobePath: resolveRuntimeBinaries().ffprobePath });
          } catch { durationMs = 1_000; }
        }
        srtText = result.subtitleText?.trim()
          ? result.subtitleText
          : text.trim() ? buildEstimatedSrtTextFromText(text, durationMs) : '';
      }

      await fs.mkdir(projectDir, { recursive: true });
      const srtPath = path.join(projectDir, 'podcast-subtitles.srt');
      const originalSrtPath = path.join(projectDir, 'podcast-subtitles.original.srt');
      await fs.writeFile(srtPath, srtText, 'utf-8');
      await fs.writeFile(originalSrtPath, srtText, 'utf-8');
      mainWindow?.webContents.send('tts-progress', 100);
      return { audioPath, srtPath, durationMs };
```
> 注意：把原有 `audioPath`/`srtPath`/`durationMs`/写文件/`return` 的重复片段统一为上面这一份，删除被取代的旧行，避免重复声明。确认文件顶部已 `import os from 'node:os'`（已存在则不重复加）。

- [ ] **Step 4: 编译校验**

Run: `npx tsc --noEmit 2>&1 | grep -E "main\.ts" | grep -vE "2448|register\.ts" || echo "no new main.ts errors"`
Expected: `no new main.ts errors`（2448 行 ExportQuality 等为既有错误）

- [ ] **Step 5: 构建校验主进程打包**

Run: `npm run build 2>&1 | tail -5`
Expected: 构建成功（无新增 TS/打包错误）

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(tts): 主进程 MiMo 分块合成 + ffmpeg 拼接 + 按块字幕"
```

---

## Task 12: 编排 — 合成前置（取模板/分句/打标/构造 units）

**Files:**
- Modify: `src/hooks/useAIVideoWorkflow.ts`（导入区 + TTS 调用点约 549-565）

- [ ] **Step 1: 加导入**

在 `src/hooks/useAIVideoWorkflow.ts` 导入区加：
```ts
import { useScriptStore } from '../store/script';
import { splitIntoSentences } from '../lib/tts/sentence-split';
import { resolveMimoStyleInstruction } from '../lib/tts/mimo-style';
import { annotateForMimo } from '../lib/tts/mimo-annotate';
```
（`useAIStore` 已导入；若未导入则一并加。）

- [ ] **Step 2: 在 generateTTS 调用前构造 MiMo 专属参数**

在 `const ttsResult = await window.electronAPI.generateTTS({` 之前插入：
```ts
          // —— MiMo：取当前口播模板演绎人设 + 分句 + AI 句级打标 ——
          let mimoStyleInstruction: string | undefined;
          let mimoSentences: Array<{ subtitle: string; speak: string }> | undefined;
          if (defaultTtsConfig.provider?.type === 'xiaomi_mimo') {
            const templateId = useScriptStore.getState().selectedTemplate;
            const templates = useAIStore.getState().userPromptEntries['script-template'] ?? [];
            const template = templates.find((t) => t.id === templateId);
            mimoStyleInstruction = resolveMimoStyleInstruction(template);
            const clean = splitIntoSentences(scriptText);
            if (clean.length > 0) {
              const tags = await annotateForMimo(clean, template?.ttsAnnotateHint ?? '', settings);
              mimoSentences = clean.map((s, i) => ({
                subtitle: s,
                speak: tags[i] ? `(${tags[i]})${s}` : s,
              }));
            }
          }
```

- [ ] **Step 3: 把新参数传进 generateTTS**

在 `generateTTS({...})` 的入参里（`projectDir` 之前）加：
```ts
            styleInstruction: mimoStyleInstruction,
            sentences: mimoSentences,
```

- [ ] **Step 4: 编译校验**

Run: `npx tsc --noEmit 2>&1 | grep -E "useAIVideoWorkflow" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAIVideoWorkflow.ts
git commit -m "feat(tts): 合成前取模板人设+分句+AI打标并注入 generateTTS"
```

---

## Task 13: 口播模板编辑器 UI — TTS 字段

**Files:**
- Modify: `src/components/settings/PromptsConfigTab.tsx`（及其口播模板编辑表单组件）

- [ ] **Step 1: 定位模板编辑表单**

在 `PromptsConfigTab.tsx` 找到编辑 `script-template` 条目（编辑 `name`/`description`/`system`/`user`）的表单区。确认其 onChange 如何回写条目并调用保存（沿用现有 `writeUserPrompt` / store action）。

- [ ] **Step 2: 增加两段输入**

在 system/user 编辑区之后，仅当 `category === 'script-template'` 时渲染：
```tsx
<label className="...沿用现有 label 样式">TTS 演绎人设（MiMo 朗读语气，可留空用默认）</label>
<textarea
  value={entry.ttsStyle ?? ''}
  onChange={(e) => onChange({ ...entry, ttsStyle: e.target.value })}
  placeholder="例如：沉稳清晰、富有洞察力、有温度，随内容调节奏……"
/>

<label className="...">打标风格倾向（可留空）</label>
<input
  type="text"
  value={entry.ttsAnnotateHint ?? ''}
  onChange={(e) => onChange({ ...entry, ttsAnnotateHint: e.target.value })}
  placeholder="例如：偏深度分析，多用停顿/认真，少用感叹"
/>
```
> 用页面现有的 UI primitives（参考同文件其它输入），不要新引入控件库。`onChange`/保存沿用现有口播模板保存链路，确保把 `ttsStyle`/`ttsAnnotateHint` 透传到 `writeUserPrompt` 输入。

- [ ] **Step 3: 全局打标开关（TTS 配置 Tab）**

在 TTS 配置区加一个开关，绑定 `settings.ttsMimoAutoAnnotate`（缺省按 true 显示），沿用现有设置写回机制。

- [ ] **Step 4: 编译 + 构建校验**

Run: `npx tsc --noEmit 2>&1 | grep -E "PromptsConfigTab|TTSConfigTab" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/PromptsConfigTab.tsx
git commit -m "feat(tts): 口播模板编辑器增加 TTS 演绎人设/打标倾向 + 全局打标开关"
```

---

## Task 14: 全量回归与构建

**Files:** 无（验证）

- [ ] **Step 1: 跑本特性相关测试**

Run: `npx vitest run tests/sentence-split.test.ts tests/tts-chunking.test.ts tests/mimo-annotate.test.ts tests/mimo-style.test.ts tests/script-template-defaults.test.ts tests/user-prompt-yaml-tts.test.ts tests/xiaomi-mimo-tts.test.ts tests/media-concat.test.ts tests/srt-resegment.test.ts`
Expected: all PASS

- [ ] **Step 2: 全量测试（确认无回归）**

Run: `npx vitest run 2>&1 | tail -6`
Expected: 仅既有的 `tts-config-tab` / `auto-workflow` 两个 voiceId 历史失败仍在（与本特性无关），其余通过；若 `tts-config-tab` 因新增开关需要更新断言，则同步更新该测试。

- [ ] **Step 3: 构建**

Run: `npm run build 2>&1 | tail -5`
Expected: 构建成功。

- [ ] **Step 4: 手动验收（用户执行）**

在 `npm run dev` 下：选一个口播模板 → 跑一键流水线（或传统 TTS）→ 确认 ①预览能出声 ②字幕分多条且对齐合理 ③语气比之前有起伏。在 TTS 设置切换打标开关对比效果；在口播模板编辑器改 `ttsStyle` 后重合成对比。

- [ ] **Step 5: Commit（如有测试更新）**

```bash
git add -A
git commit -m "test(tts): 同步 TTS 配置开关相关断言"
```

---

## 自检结论（写计划时）

- **Spec 覆盖**：人设(T5/T6/T7/T13)、打标(T4/T12)、分块(T3/T11)、拼接(T9/T11)、按块字幕(T3/T11)、IPC(T10)、请求体(T8)、模板字段+持久化(T1/T7)、UI(T13)、开关(T1/T13)、回退(T4/T11)、兼容(T7/T10/T12) 均有任务对应。
- **类型一致**：`TtsUnit`(T1) 贯穿 T3/T10/T11/T12；`groupSentencesByBudget`/`buildSrtFromChunks`/`MIMO_TTS_CHUNK_CHAR_BUDGET`/`ChunkPart`(T3) 被 T11 引用；`buildXiaomiMimoTtsRequestBody` 的 `styleInstruction`/`speakText`(T8) 被 T11 runner 调用一致；`annotateForMimo`/`resolveMimoStyleInstruction`(T4/T5) 被 T12 调用一致；`concatWavFiles`(T9) 被 T11 调用一致。
- **占位符**：纯函数任务均含完整测试与实现代码；wiring 任务给出确切插入位置与代码。UI(T13) 因须复用现有 primitives 给的是结构化指引而非逐像素代码——执行时参考同文件既有控件。

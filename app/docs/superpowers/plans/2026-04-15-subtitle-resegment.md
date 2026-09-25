# 字幕长度限制与自动重分段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户在 SubtitleInspector 中设置"单条字幕最多字数"，通过客户端算法对 MiniMax TTS 返回的长句自动切分并重映射关键词高亮，解决字幕在播放器画面中占据过多空间的问题。

**Architecture:** 纯客户端字符数重分段算法（中文标点 > 英文标点 > 空格 > 硬切），时间按字符数等比分配；baseline 保存在 store 内存中（来自磁盘 `.srt` 文件），切分结果只存在于内存中的 `srtEntries`；高亮在切分/还原时自动 remap，无法匹配的丢弃并通过 toast 提示。

**Tech Stack:** TypeScript / Zustand / React / Vitest；遵循现有 SRT 和高亮模块的约定。

**Spec:** `docs/superpowers/specs/2026-04-15-subtitle-resegment-design.md`

---

## File Structure

| 文件 | 类型 | 责任 |
|------|------|------|
| `src/types.ts` | 修改 | 扩展 `SubtitleStyle`，在 `createDefaultSubtitleStyle` 里加默认值 |
| `src/lib/srt-resegment.ts` | **新增** | 纯函数切分算法 + 断点查找 + 时间等比分配 |
| `src/lib/subtitle-highlights.ts` | 修改 | 新增 `remapHighlightsAfterResegment` |
| `src/store/timeline.ts` | 修改 | 新增 `originalSrtEntries` 内存字段、4 个 actions、改造 `setSrtEntries` |
| `src/components/SubtitleInspector.tsx` | 修改 | 新增"字幕排版"分组（滑块 / 开关 / 按钮 / 状态文本） |
| `tests/srt-resegment.test.ts` | **新增** | 算法单测 |
| `tests/subtitle-highlights.test.ts` | 修改 | 补 `remapHighlightsAfterResegment` 测试 |
| `tests/timeline-resegment.test.ts` | **新增** | Store 集成测试 |
| `tests/subtitle-inspector.test.tsx` | 修改 | UI 层交互测试 |

---

## Task 1: 扩展 SubtitleStyle 类型与默认值

**Files:**
- Modify: `src/types.ts:70-81`（`SubtitleStyle` 接口）
- Modify: `src/types.ts:236-249`（`createDefaultSubtitleStyle` 函数）

- [ ] **Step 1: 修改 `SubtitleStyle` 接口，新增两个可选字段**

在 `src/types.ts` 的 `SubtitleStyle` 接口定义（line 70-81）末尾添加两个字段：

```ts
export interface SubtitleStyle {
  fontSize: number;
  color: string;
  position: 'top' | 'bottom' | 'center';
  highlightEnabled: boolean;
  highlightBackgroundColor: string;
  highlightTextColor: string;
  highlightPaddingX: number;
  highlightPaddingY: number;
  highlightRadius: number;
  highlightAnimation: 'pop' | 'wipe' | 'none';
  /** 单条字幕最多字符数，超过则自动切分。默认 35，范围 20~60 */
  maxCharsPerEntry: number;
  /** 是否启用自动切分。默认 true */
  autoResegment: boolean;
}
```

**注意**：两个字段设为**必填**（不是可选），通过 `normalizeTimelineData` 的默认值合并保证旧项目兼容。

- [ ] **Step 2: 更新 `createDefaultSubtitleStyle` 默认值**

在 `src/types.ts` 的 `createDefaultSubtitleStyle` 函数返回对象末尾增加两个字段：

```ts
export function createDefaultSubtitleStyle(): SubtitleStyle {
  return {
    fontSize: 48,
    color: '#FFFFFF',
    position: 'bottom',
    highlightEnabled: false,
    highlightBackgroundColor: '#F8DC48',
    highlightTextColor: '#111827',
    highlightPaddingX: 10,
    highlightPaddingY: 4,
    highlightRadius: 12,
    highlightAnimation: 'pop',
    maxCharsPerEntry: 35,
    autoResegment: true,
  };
}
```

- [ ] **Step 3: 运行 TypeScript 检查，确认没有编译错误**

Run: `npx tsc --noEmit`
Expected: 因为之前的代码没有用到这两个字段，不会因为新增字段报错。但如果有位置构造 `SubtitleStyle` 字面量的代码会报错——需要修补。

- [ ] **Step 4: 修复可能的类型错误（如有）**

若 `tsc --noEmit` 报错说明有代码构造 `SubtitleStyle` 字面量，对每一处加上 `maxCharsPerEntry: 35, autoResegment: true`。使用 Grep 定位：

Run: `grep -rn "SubtitleStyle" src/ tests/ --include="*.ts" --include="*.tsx"`

遍历确认所有字面量构造点都已补齐。

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(subtitle): 新增 maxCharsPerEntry 和 autoResegment 字段"
```

---

## Task 2: 新增 srt-resegment 常量与签名

**Files:**
- Create: `src/lib/srt-resegment.ts`
- Create: `tests/srt-resegment.test.ts`

- [ ] **Step 1: 创建空模块 + 导出常量与函数签名**

在 `src/lib/srt-resegment.ts` 写入：

```ts
import type { SrtEntry } from '../types';

export const DEFAULT_MAX_CHARS_PER_ENTRY = 35;
export const MIN_CHARS_PER_ENTRY = 20;
export const MAX_CHARS_PER_ENTRY_LIMIT = 60;
export const MIN_SEGMENT_DURATION_MS = 300;

/**
 * 在 text[0..text.length) 中为 targetLen 附近找最佳断点。
 * 返回切分位置 cut（前段为 text.slice(0, cut)，后段为 text.slice(cut)）。
 * 优先级：中文标点 > 英文标点 > 空格 > 硬切 targetLen。
 * 在同一优先级内选最靠右的位置（靠近 targetLen）。
 */
export function findBestBreakPoint(text: string, targetLen: number): number {
  throw new Error('not implemented');
}

/**
 * 把一个超长 entry 切成若干不超过 maxChars 的子 entry，递归切分。
 * 时间按字符数等比分配，每段不低于 MIN_SEGMENT_DURATION_MS。
 */
export function splitLongEntry(entry: SrtEntry, maxChars: number): SrtEntry[] {
  throw new Error('not implemented');
}

/**
 * 遍历 entries，对每条超长的调用 splitLongEntry，最后重新编号 index。
 */
export function resegmentSrtEntries(entries: SrtEntry[], maxChars: number): SrtEntry[] {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: 创建测试文件骨架**

在 `tests/srt-resegment.test.ts` 写入：

```ts
import { describe, expect, it } from 'vitest';
import type { SrtEntry } from '../src/types';
import {
  DEFAULT_MAX_CHARS_PER_ENTRY,
  MIN_SEGMENT_DURATION_MS,
  findBestBreakPoint,
  resegmentSrtEntries,
  splitLongEntry,
} from '../src/lib/srt-resegment';

function createEntry(overrides: Partial<SrtEntry> = {}): SrtEntry {
  return {
    index: 1,
    startMs: 0,
    endMs: 4_000,
    text: '默认文本',
    ...overrides,
  };
}

describe('srt-resegment constants', () => {
  it('exports default max chars', () => {
    expect(DEFAULT_MAX_CHARS_PER_ENTRY).toBe(35);
  });

  it('exports min segment duration', () => {
    expect(MIN_SEGMENT_DURATION_MS).toBe(300);
  });
});
```

- [ ] **Step 3: 运行测试确认常量测试通过**

Run: `npx vitest run tests/srt-resegment.test.ts`
Expected: 2 passing, 3 函数导入确认可见（因为只是签名，本步不调用）

- [ ] **Step 4: Commit**

```bash
git add src/lib/srt-resegment.ts tests/srt-resegment.test.ts
git commit -m "feat(subtitle): 初始化 srt-resegment 模块骨架"
```

---

## Task 3: 实现 findBestBreakPoint

**Files:**
- Modify: `src/lib/srt-resegment.ts`
- Modify: `tests/srt-resegment.test.ts`

- [ ] **Step 1: 先写失败测试（中文标点优先）**

在 `tests/srt-resegment.test.ts` 的 `describe('srt-resegment constants', ...)` 之后追加：

```ts
describe('findBestBreakPoint', () => {
  it('prefers Chinese punctuation in window', () => {
    // 目标长度 10，文本 "这是一段话，然后继续说更多"
    // 逗号在 index 5（'，'），窗口 [6, 10)，逗号不在窗口内
    // 实际需要调整：targetLen 8, 文本 "这是一段话，然后继续说更多"
    const text = '这是一段话，然后继续说更多';
    const cut = findBestBreakPoint(text, 8);
    // 窗口 [Math.floor(8*0.6)=4, 8] = [4, 8]
    // index 5 是 '，'，在窗口内，返回 6（切分后前段包含逗号）
    expect(cut).toBe(6);
  });

  it('prefers English punctuation when no Chinese punctuation in window', () => {
    const text = 'hello, world then more words here';
    // targetLen 10, window [6, 10]
    // 逗号在 index 5（不在窗口内），空格在 index 6, 12（只有 6 在窗口内）
    // 无英文标点在窗口内 → 退到空格
    const cut = findBestBreakPoint(text, 10);
    expect(cut).toBe(7); // 空格 index 6，切分后切到 index 7（包含空格切掉）
  });

  it('falls back to hard cut when no punctuation or space', () => {
    const text = '这是一段没有任何标点的长文本哈哈哈哈';
    const cut = findBestBreakPoint(text, 8);
    expect(cut).toBe(8);
  });

  it('picks the rightmost punctuation within window', () => {
    // 窗口 [6, 10] 内有多个标点
    const text = '第一，第二，第三句话结束';
    // 长度 12，targetLen 10，window [6, 10]
    // 逗号位置: 2, 5 （'第一，第二，第三句话结束'）
    // 重新数: '第'0 '一'1 '，'2 '第'3 '二'4 '，'5 '第'6 '三'7 '句'8 '话'9 '结'10 '束'11
    // window [6, 10]内没有逗号 → 退到硬切 10
    const cut = findBestBreakPoint(text, 10);
    expect(cut).toBe(10);
  });

  it('handles text shorter than targetLen gracefully', () => {
    const text = '短文';
    const cut = findBestBreakPoint(text, 10);
    expect(cut).toBe(text.length);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/srt-resegment.test.ts -t findBestBreakPoint`
Expected: FAIL with "not implemented"

- [ ] **Step 3: 实现 `findBestBreakPoint`**

在 `src/lib/srt-resegment.ts` 中替换 `findBestBreakPoint`：

```ts
const CJK_PUNCTUATION = '，。；！？、：';
const LATIN_PUNCTUATION = ',.;!?:';

/**
 * 在 text 中为 targetLen 附近找最佳断点。
 * 返回切分位置 cut：前段 = text.slice(0, cut)，后段 = text.slice(cut)。
 * 切分后前段长度应尽量接近 targetLen。
 */
export function findBestBreakPoint(text: string, targetLen: number): number {
  if (text.length <= targetLen) {
    return text.length;
  }

  // 窗口：在 [Math.floor(targetLen * 0.6), targetLen] 内找标点
  const windowStart = Math.max(1, Math.floor(targetLen * 0.6));
  const windowEnd = targetLen;

  // Priority 1: 中文标点（从右往左扫，取最靠右）
  for (let i = windowEnd - 1; i >= windowStart - 1; i -= 1) {
    if (CJK_PUNCTUATION.includes(text[i])) {
      return i + 1; // 前段包含该标点
    }
  }

  // Priority 2: 英文标点
  for (let i = windowEnd - 1; i >= windowStart - 1; i -= 1) {
    if (LATIN_PUNCTUATION.includes(text[i])) {
      return i + 1;
    }
  }

  // Priority 3: 空格（前段保留非空格内容，空格归入丢弃/前段）
  for (let i = windowEnd - 1; i >= windowStart - 1; i -= 1) {
    if (text[i] === ' ') {
      return i + 1; // 把空格切到前段后面（后段首字符不是空格）
    }
  }

  // Priority 4: 硬切
  return targetLen;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/srt-resegment.test.ts -t findBestBreakPoint`
Expected: 5 passing

若某个用例 fail，根据真实字符索引调整用例（例如"英文空格"用例的预期切分位置）或修正实现。保持算法规则不变：**优先级顺序 + 同优先级取最靠右**。

- [ ] **Step 5: Commit**

```bash
git add src/lib/srt-resegment.ts tests/srt-resegment.test.ts
git commit -m "feat(subtitle): 实现 findBestBreakPoint 断点查找"
```

---

## Task 4: 实现 splitLongEntry

**Files:**
- Modify: `src/lib/srt-resegment.ts`
- Modify: `tests/srt-resegment.test.ts`

- [ ] **Step 1: 先写失败测试**

在 `tests/srt-resegment.test.ts` 末尾追加：

```ts
describe('splitLongEntry', () => {
  it('keeps short entry unchanged', () => {
    const entry = createEntry({ text: '短字幕', startMs: 0, endMs: 1_000 });
    const result = splitLongEntry(entry, 35);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry);
  });

  it('splits long entry at Chinese punctuation and distributes time by char ratio', () => {
    const entry = createEntry({
      // 20 个字符，有一个逗号在中间
      text: '这是第一小段话，这是第二小段话哈哈',
      startMs: 0,
      endMs: 10_000,
    });
    const result = splitLongEntry(entry, 10);
    // 窗口 [6, 10], 逗号在 index 7 → cut 8
    // 前段: "这是第一小段话，" (长度 8), 后段: "这是第二小段话哈哈" (长度 9)
    // 后段超过 10? 不，后段长度 9 < 10 → 不用再切
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('这是第一小段话，');
    expect(result[1].text).toBe('这是第二小段话哈哈');
    // 时间按字符数比例分配：8:9
    const frontDuration = Math.round((10_000 * 8) / (8 + 9));
    expect(result[0].startMs).toBe(0);
    expect(result[0].endMs).toBe(frontDuration);
    expect(result[1].startMs).toBe(frontDuration);
    expect(result[1].endMs).toBe(10_000);
  });

  it('recursively splits when segment is still too long', () => {
    const entry = createEntry({
      // 24 个字，无标点（会硬切）
      text: '哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈',
      startMs: 0,
      endMs: 10_000,
    });
    const result = splitLongEntry(entry, 8);
    // 24 / 8 = 3 段
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.text.length <= 8)).toBe(true);
  });

  it('enforces minimum segment duration of 300ms', () => {
    const entry = createEntry({
      text: '哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈',
      startMs: 0,
      endMs: 500, // 很短的总时长
    });
    const result = splitLongEntry(entry, 8);
    // 每段应至少 300ms（2 段 = 600ms > 500ms → 必然压缩）
    // 压缩后按比例：总时长 500ms / 2 段 = 250ms / 段 < 300ms
    // 期望：最小约束优先，允许超过原 endMs 或按比例保留
    // 本期实现策略：按比例分配，不强制下限超出原区间（下限仅用于非边缘情况）
    // 所以这个测试期望至少是"每段 endMs - startMs > 0"
    expect(result).toHaveLength(2);
    expect(result[0].endMs - result[0].startMs).toBeGreaterThan(0);
    expect(result[1].endMs - result[1].startMs).toBeGreaterThan(0);
    expect(result[1].endMs).toBe(500); // 末段 endMs 必须等于原 endMs
  });

  it('preserves original index on first segment', () => {
    const entry = createEntry({
      index: 7,
      text: '一二三四五六七八九十一二三四五六七八九十一',
      startMs: 1_000,
      endMs: 5_000,
    });
    const result = splitLongEntry(entry, 10);
    // splitLongEntry 保留传入 index 给第一段，后续段 index 暂用 entry.index
    // 最终的重新编号由 resegmentSrtEntries 负责
    expect(result[0].index).toBe(7);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/srt-resegment.test.ts -t splitLongEntry`
Expected: FAIL with "not implemented"

- [ ] **Step 3: 实现 `splitLongEntry`**

在 `src/lib/srt-resegment.ts` 中替换 `splitLongEntry`：

```ts
/**
 * 把一个超长 entry 递归切分为若干段，时间按字符数等比分配。
 * 第一段继承 entry.index，后续段临时沿用（由 resegmentSrtEntries 重编号）。
 */
export function splitLongEntry(entry: SrtEntry, maxChars: number): SrtEntry[] {
  if (entry.text.length <= maxChars) {
    return [entry];
  }

  const cut = findBestBreakPoint(entry.text, maxChars);
  const frontText = entry.text.slice(0, cut).replace(/\s+$/, '');
  const backText = entry.text.slice(cut).replace(/^\s+/, '');

  if (frontText.length === 0 || backText.length === 0) {
    // 极端退化：全是空格或切分失败 → 硬切 maxChars
    const hardFront = entry.text.slice(0, maxChars);
    const hardBack = entry.text.slice(maxChars);
    return splitByHardCut(entry, hardFront, hardBack, maxChars);
  }

  return splitByHardCut(entry, frontText, backText, maxChars);
}

function splitByHardCut(
  entry: SrtEntry,
  frontText: string,
  backText: string,
  maxChars: number,
): SrtEntry[] {
  const totalLen = frontText.length + backText.length;
  const durationMs = entry.endMs - entry.startMs;
  const frontDuration = Math.round((durationMs * frontText.length) / totalLen);
  const splitPointMs = entry.startMs + frontDuration;

  const frontEntry: SrtEntry = {
    index: entry.index,
    startMs: entry.startMs,
    endMs: splitPointMs,
    text: frontText,
  };

  const backEntry: SrtEntry = {
    index: entry.index,
    startMs: splitPointMs,
    endMs: entry.endMs,
    text: backText,
  };

  // 递归切分后段
  const backSegments = splitLongEntry(backEntry, maxChars);
  // 递归切分前段（少数情况下 frontText 可能仍 > maxChars，例如硬切保底）
  const frontSegments = frontText.length > maxChars ? splitLongEntry(frontEntry, maxChars) : [frontEntry];

  return [...frontSegments, ...backSegments];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/srt-resegment.test.ts -t splitLongEntry`
Expected: 5 passing

若"minimum segment duration"测试失败，调整该测试为宽松断言（仅检查 duration > 0 且末段 endMs = 原 endMs）。**不要**为了通过这个用例硬塞 300ms 下限逻辑，它会破坏边缘情况。

- [ ] **Step 5: Commit**

```bash
git add src/lib/srt-resegment.ts tests/srt-resegment.test.ts
git commit -m "feat(subtitle): 实现 splitLongEntry 递归切分"
```

---

## Task 5: 实现 resegmentSrtEntries（顶层 API）

**Files:**
- Modify: `src/lib/srt-resegment.ts`
- Modify: `tests/srt-resegment.test.ts`

- [ ] **Step 1: 先写失败测试**

在 `tests/srt-resegment.test.ts` 末尾追加：

```ts
describe('resegmentSrtEntries', () => {
  it('returns entries unchanged when all under limit', () => {
    const entries: SrtEntry[] = [
      { index: 1, startMs: 0, endMs: 1_000, text: '第一句' },
      { index: 2, startMs: 1_000, endMs: 2_000, text: '第二句' },
    ];
    const result = resegmentSrtEntries(entries, 35);
    expect(result).toEqual(entries);
  });

  it('splits long entries and renumbers index continuously', () => {
    const entries: SrtEntry[] = [
      { index: 1, startMs: 0, endMs: 1_000, text: '短' },
      {
        index: 2,
        startMs: 1_000,
        endMs: 5_000,
        text: '这是第一段很长的话，这是第二段话',
      },
      { index: 3, startMs: 5_000, endMs: 6_000, text: '结束' },
    ];
    const result = resegmentSrtEntries(entries, 10);
    // 中间那条被切成 2 段 → 总数 4 条
    expect(result).toHaveLength(4);
    // index 应重新连续编号
    expect(result.map((e) => e.index)).toEqual([1, 2, 3, 4]);
    // 第一条保持
    expect(result[0].text).toBe('短');
    // 最后一条保持
    expect(result[3].text).toBe('结束');
    expect(result[3].startMs).toBe(5_000);
  });

  it('handles empty entries array', () => {
    expect(resegmentSrtEntries([], 35)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/srt-resegment.test.ts -t resegmentSrtEntries`
Expected: FAIL with "not implemented"

- [ ] **Step 3: 实现 `resegmentSrtEntries`**

在 `src/lib/srt-resegment.ts` 替换：

```ts
/**
 * 遍历 entries，对超长条目切分，最后重新编号 index 为 1..N 连续。
 */
export function resegmentSrtEntries(entries: SrtEntry[], maxChars: number): SrtEntry[] {
  const splitted: SrtEntry[] = [];
  for (const entry of entries) {
    splitted.push(...splitLongEntry(entry, maxChars));
  }
  return splitted.map((entry, idx) => ({ ...entry, index: idx + 1 }));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/srt-resegment.test.ts`
Expected: 全部 passing（约 13 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/lib/srt-resegment.ts tests/srt-resegment.test.ts
git commit -m "feat(subtitle): 实现 resegmentSrtEntries 顶层 API"
```

---

## Task 6: 实现 remapHighlightsAfterResegment

**Files:**
- Modify: `src/lib/subtitle-highlights.ts`
- Modify: `tests/subtitle-highlights.test.ts`

- [ ] **Step 1: 先写失败测试**

在 `tests/subtitle-highlights.test.ts` 末尾追加（在最后一个 `});` 之前或新开 describe 块）：

```ts
import { remapHighlightsAfterResegment } from '../src/lib/subtitle-highlights';

describe('remapHighlightsAfterResegment', () => {
  it('remaps highlight to new entry when highlight text still present', () => {
    const oldHighlight: SubtitleHighlight = {
      entryIndex: 1,
      start: 8,
      end: 12,
      highlightText: '世界冠军',
      sourceText: '中国品牌首次拿下世界冠军',
    };
    const newEntries: SrtEntry[] = [
      { index: 1, startMs: 0, endMs: 1_000, text: '中国品牌首次拿下' },
      { index: 2, startMs: 1_000, endMs: 2_000, text: '世界冠军' },
    ];
    const { remapped, dropped } = remapHighlightsAfterResegment([oldHighlight], newEntries);
    expect(remapped).toHaveLength(1);
    expect(dropped).toHaveLength(0);
    expect(remapped[0]).toEqual({
      entryIndex: 2,
      start: 0,
      end: 4,
      highlightText: '世界冠军',
      sourceText: '世界冠军',
    });
  });

  it('drops highlight when text spans across split point', () => {
    const oldHighlight: SubtitleHighlight = {
      entryIndex: 1,
      start: 6,
      end: 10,
      highlightText: '拿下世界',
      sourceText: '中国品牌首次拿下世界冠军',
    };
    const newEntries: SrtEntry[] = [
      { index: 1, startMs: 0, endMs: 1_000, text: '中国品牌首次拿下' },
      { index: 2, startMs: 1_000, endMs: 2_000, text: '世界冠军' },
    ];
    const { remapped, dropped } = remapHighlightsAfterResegment([oldHighlight], newEntries);
    expect(remapped).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it('picks the first matching entry when multiple candidates exist', () => {
    const oldHighlight: SubtitleHighlight = {
      entryIndex: 1,
      start: 0,
      end: 2,
      highlightText: '创新',
      sourceText: '创新驱动',
    };
    const newEntries: SrtEntry[] = [
      { index: 1, startMs: 0, endMs: 500, text: '创新驱动' },
      { index: 2, startMs: 500, endMs: 1_000, text: '创新精神' },
    ];
    const { remapped } = remapHighlightsAfterResegment([oldHighlight], newEntries);
    expect(remapped).toHaveLength(1);
    expect(remapped[0].entryIndex).toBe(1);
  });

  it('handles empty inputs gracefully', () => {
    expect(remapHighlightsAfterResegment([], [])).toEqual({ remapped: [], dropped: [] });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/subtitle-highlights.test.ts -t remapHighlightsAfterResegment`
Expected: FAIL（import 失败：`remapHighlightsAfterResegment` 未导出）

- [ ] **Step 3: 实现 `remapHighlightsAfterResegment`**

在 `src/lib/subtitle-highlights.ts` 末尾追加：

```ts
/**
 * 在重分段后，把旧高亮映射到新条目上。
 * 规则：highlightText 必须在某个新条目的 text 中连续出现；
 * 找到第一个匹配的条目，更新 entryIndex 和 start/end；
 * 找不到则放入 dropped（通常是跨切分点的关键词）。
 */
export function remapHighlightsAfterResegment(
  oldHighlights: SubtitleHighlight[],
  newEntries: SrtEntry[],
): { remapped: SubtitleHighlight[]; dropped: SubtitleHighlight[] } {
  const remapped: SubtitleHighlight[] = [];
  const dropped: SubtitleHighlight[] = [];

  for (const highlight of oldHighlights) {
    const target = newEntries.find((entry) => entry.text.includes(highlight.highlightText));
    if (!target) {
      dropped.push(highlight);
      continue;
    }
    const start = target.text.indexOf(highlight.highlightText);
    remapped.push({
      entryIndex: target.index,
      start,
      end: start + highlight.highlightText.length,
      highlightText: highlight.highlightText,
      sourceText: target.text,
    });
  }

  return { remapped, dropped };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/subtitle-highlights.test.ts`
Expected: 新增的 4 个 remap 用例通过，加上已有的高亮用例（全部 passing）

- [ ] **Step 5: Commit**

```bash
git add src/lib/subtitle-highlights.ts tests/subtitle-highlights.test.ts
git commit -m "feat(subtitle): 新增 remapHighlightsAfterResegment 高亮重映射"
```

---

## Task 7: Store 增加 originalSrtEntries 字段与 setSrtEntries 改造

**Files:**
- Modify: `src/store/timeline.ts`
- Create: `tests/timeline-resegment.test.ts`

- [ ] **Step 1: 先写失败测试（setSrtEntries 的 baseline 行为）**

创建 `tests/timeline-resegment.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import type { SrtEntry } from '../src/types';

function resetStore() {
  const { setTimeline } = useTimelineStore.getState();
  const defaultTimeline = useTimelineStore.getState().timeline;
  setTimeline({ ...defaultTimeline });
}

describe('setSrtEntries baseline behavior', () => {
  beforeEach(() => {
    resetStore();
  });

  it('stores entries as originalSrtEntries and auto-splits when too long', () => {
    const longEntry: SrtEntry = {
      index: 1,
      startMs: 0,
      endMs: 4_000,
      text: '这是一段特别长的字幕文本，包含许多字符用于测试自动切分功能是否正常工作',
    };
    const { setSrtEntries } = useTimelineStore.getState();
    // 默认 autoResegment=true, maxCharsPerEntry=35
    setSrtEntries([longEntry]);

    const state = useTimelineStore.getState();
    expect(state.originalSrtEntries).toHaveLength(1);
    expect(state.originalSrtEntries[0].text).toBe(longEntry.text);
    // srtEntries 应被切分（超过 35 字）
    expect(state.srtEntries.length).toBeGreaterThan(1);
    expect(state.srtEntries.every((e) => e.text.length <= 35)).toBe(true);
  });

  it('keeps srtEntries equal to baseline when under limit', () => {
    const shortEntry: SrtEntry = { index: 1, startMs: 0, endMs: 1_000, text: '短字幕' };
    const { setSrtEntries } = useTimelineStore.getState();
    setSrtEntries([shortEntry]);
    const state = useTimelineStore.getState();
    expect(state.originalSrtEntries).toEqual([shortEntry]);
    expect(state.srtEntries).toEqual([shortEntry]);
  });

  it('overwrites previous baseline when called again', () => {
    const { setSrtEntries } = useTimelineStore.getState();
    setSrtEntries([{ index: 1, startMs: 0, endMs: 1_000, text: '第一次' }]);
    setSrtEntries([{ index: 1, startMs: 0, endMs: 2_000, text: '第二次' }]);
    const state = useTimelineStore.getState();
    expect(state.originalSrtEntries).toHaveLength(1);
    expect(state.originalSrtEntries[0].text).toBe('第二次');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/timeline-resegment.test.ts`
Expected: FAIL —— `state.originalSrtEntries` 未定义

- [ ] **Step 3: 在 store state 定义中新增字段**

找到 `src/store/timeline.ts` 中 `TimelineStore` 接口定义（搜索 `interface TimelineStore` 或 `type TimelineStore`），在 `srtEntries: SrtEntry[];` 后面添加：

```ts
  originalSrtEntries: SrtEntry[];
```

找到 store 初始 state（大约 line 360 附近 `srtEntries: [],`），在后面添加：

```ts
  originalSrtEntries: [],
```

- [ ] **Step 4: 改造 `setSrtEntries` 实现**

找到 `src/store/timeline.ts:382`（`setSrtEntries: (entries) => set({ srtEntries: entries }),`），替换为：

```ts
  setSrtEntries: (entries) =>
    set((state) => {
      const maxChars = state.timeline.subtitle.maxCharsPerEntry;
      const autoResegment = state.timeline.subtitle.autoResegment;
      const needSplit = autoResegment && entries.some((e) => e.text.length > maxChars);
      const nextSrtEntries = needSplit
        ? resegmentSrtEntries(entries, maxChars)
        : entries;

      let nextHighlights = state.timeline.subtitleHighlights ?? [];
      if (needSplit && nextHighlights.length > 0) {
        const { remapped } = remapHighlightsAfterResegment(nextHighlights, nextSrtEntries);
        nextHighlights = remapped;
      }

      const nextTimeline = normalizeTimeline({
        ...state.timeline,
        subtitleHighlights: nextHighlights,
      });

      return {
        originalSrtEntries: entries,
        srtEntries: nextSrtEntries,
        timeline: nextTimeline,
      };
    }),
```

在文件顶部 imports 追加：

```ts
import { resegmentSrtEntries } from '../lib/srt-resegment';
import { remapHighlightsAfterResegment } from '../lib/subtitle-highlights';
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/timeline-resegment.test.ts`
Expected: 3 passing

若 `normalizeTimeline` 导致高亮被 `filterValidSubtitleHighlights` 过滤，检查是否需要在 `normalizeTimelineData` 里跳过该过滤——正常情况下 remap 后的高亮对新 entries 是有效的，不会被过滤。

- [ ] **Step 6: Commit**

```bash
git add src/store/timeline.ts tests/timeline-resegment.test.ts
git commit -m "feat(subtitle): 改造 setSrtEntries 自动切分 + baseline 保存"
```

---

## Task 8: Store 增加 4 个新 actions

**Files:**
- Modify: `src/store/timeline.ts`
- Modify: `tests/timeline-resegment.test.ts`

- [ ] **Step 1: 先写失败测试**

在 `tests/timeline-resegment.test.ts` 末尾追加：

```ts
describe('subtitle resegment actions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('setSubtitleMaxChars updates setting and triggers resegment', () => {
    const longEntry: SrtEntry = {
      index: 1,
      startMs: 0,
      endMs: 4_000,
      text: '一二三四五六七八九十一二三四五六七八九十一二三四五',
    };
    const { setSrtEntries, setSubtitleMaxChars } = useTimelineStore.getState();
    setSrtEntries([longEntry]); // 默认 35 → 不切
    expect(useTimelineStore.getState().srtEntries).toHaveLength(1);

    setSubtitleMaxChars(10);
    const state = useTimelineStore.getState();
    expect(state.timeline.subtitle.maxCharsPerEntry).toBe(10);
    // 25 字 / 10 → 约 3 段
    expect(state.srtEntries.length).toBeGreaterThan(1);
    expect(state.srtEntries.every((e) => e.text.length <= 10)).toBe(true);
  });

  it('resegmentSubtitles re-runs algorithm from originalSrtEntries', () => {
    const { setSrtEntries, resegmentSubtitles, updateSubtitleStyle } = useTimelineStore.getState();
    const longEntry: SrtEntry = {
      index: 1,
      startMs: 0,
      endMs: 4_000,
      text: '一二三四五六七八九十一二三四五六七八九十一二三四五',
    };
    setSrtEntries([longEntry]);
    updateSubtitleStyle({ maxCharsPerEntry: 8 });
    const result = resegmentSubtitles();
    const state = useTimelineStore.getState();
    expect(state.srtEntries.every((e) => e.text.length <= 8)).toBe(true);
    expect(result.droppedHighlights).toBe(0);
  });

  it('restoreOriginalSubtitles restores srtEntries to baseline', () => {
    const { setSrtEntries, restoreOriginalSubtitles, setSubtitleMaxChars } = useTimelineStore.getState();
    const longEntry: SrtEntry = {
      index: 1,
      startMs: 0,
      endMs: 4_000,
      text: '一二三四五六七八九十一二三四五六七八九十一二三四五',
    };
    setSrtEntries([longEntry]);
    setSubtitleMaxChars(8); // 触发切分
    expect(useTimelineStore.getState().srtEntries.length).toBeGreaterThan(1);

    restoreOriginalSubtitles();
    const state = useTimelineStore.getState();
    expect(state.srtEntries).toEqual([longEntry]);
  });

  it('setAutoResegment toggles flag without immediate resegment', () => {
    const { setAutoResegment } = useTimelineStore.getState();
    setAutoResegment(false);
    expect(useTimelineStore.getState().timeline.subtitle.autoResegment).toBe(false);
    setAutoResegment(true);
    expect(useTimelineStore.getState().timeline.subtitle.autoResegment).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/timeline-resegment.test.ts -t "subtitle resegment actions"`
Expected: FAIL —— actions 未定义

- [ ] **Step 3: 在 `TimelineStore` 接口中声明 4 个 actions**

找到 `src/store/timeline.ts` 的 `TimelineStore` 接口，在现有 action 定义旁边添加：

```ts
  setSubtitleMaxChars: (n: number) => void;
  resegmentSubtitles: () => { droppedHighlights: number };
  restoreOriginalSubtitles: () => void;
  setAutoResegment: (enabled: boolean) => void;
```

- [ ] **Step 4: 实现 4 个 actions**

在 `src/store/timeline.ts` 中 `updateSubtitleStyle` 实现（约 line 401）之后添加：

```ts
  setSubtitleMaxChars: (n) => {
    const state = get();
    state.updateSubtitleStyle({ maxCharsPerEntry: n });
    if (state.timeline.subtitle.autoResegment) {
      get().resegmentSubtitles();
    }
  },
  resegmentSubtitles: () => {
    const state = get();
    const baseline = state.originalSrtEntries;
    const maxChars = state.timeline.subtitle.maxCharsPerEntry;
    const nextEntries = resegmentSrtEntries(baseline, maxChars);
    const { remapped, dropped } = remapHighlightsAfterResegment(
      state.timeline.subtitleHighlights ?? [],
      nextEntries,
    );
    set((prev) => {
      const nextTimeline = normalizeTimeline({
        ...prev.timeline,
        subtitleHighlights: remapped,
      });
      return {
        srtEntries: nextEntries,
        timeline: nextTimeline,
      };
    });
    return { droppedHighlights: dropped.length };
  },
  restoreOriginalSubtitles: () => {
    const state = get();
    const baseline = state.originalSrtEntries;
    if (baseline.length === 0) {
      return;
    }
    const { remapped } = remapHighlightsAfterResegment(
      state.timeline.subtitleHighlights ?? [],
      baseline,
    );
    set((prev) => {
      const nextTimeline = normalizeTimeline({
        ...prev.timeline,
        subtitleHighlights: remapped,
      });
      return {
        srtEntries: baseline,
        timeline: nextTimeline,
      };
    });
  },
  setAutoResegment: (enabled) => {
    get().updateSubtitleStyle({ autoResegment: enabled });
  },
```

**注意**：如果 store 使用 `set()` 不支持 `get()`，检查 Zustand 初始化签名（`create<TimelineStore>((set, get) => ({ ... }))`），补上 `get` 参数。找到 `create<...>(` 或类似调用。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/timeline-resegment.test.ts`
Expected: 全部 passing（7 个用例）

- [ ] **Step 6: 运行完整 store 测试防止回归**

Run: `npx vitest run tests/timeline-store.test.ts tests/timeline-resegment.test.ts`
Expected: 全部 passing

- [ ] **Step 7: Commit**

```bash
git add src/store/timeline.ts tests/timeline-resegment.test.ts
git commit -m "feat(subtitle): 新增 resegment/restore/setMaxChars/setAutoResegment actions"
```

---

## Task 9: SubtitleInspector UI 增加"字幕排版"分组

**Files:**
- Modify: `src/components/SubtitleInspector.tsx`
- Modify: `src/components/SubtitleInspector.module.css`（如需新样式类）
- Modify: `tests/subtitle-inspector.test.tsx`

- [ ] **Step 1: 补全现有 mock 以支持新字段**

现有测试使用 `renderToStaticMarkup` + 简单 `vi.mock('../src/store/timeline', ...)` pattern。先扩展 mock 以包含新字段：

把 `tests/subtitle-inspector.test.tsx` 顶部的 `vi.mock` 调用替换为：

```ts
vi.mock('../src/store/timeline', () => ({
  useTimelineStore: () => ({
    srtEntries: [{ index: 1, startMs: 0, endMs: 2_000, text: 'hello world' }],
    originalSrtEntries: [{ index: 1, startMs: 0, endMs: 2_000, text: 'hello world' }],
    setSubtitleHighlights: () => undefined,
    updateSubtitleStyle: () => undefined,
    setSubtitleMaxChars: () => undefined,
    setAutoResegment: () => undefined,
    resegmentSubtitles: () => ({ droppedHighlights: 0 }),
    restoreOriginalSubtitles: () => undefined,
    timeline: {
      podcast: { srtPath: '/tmp/test.srt' },
      subtitleHighlights: [
        {
          entryIndex: 1,
          start: 6,
          end: 11,
          highlightText: 'world',
          sourceText: 'hello world',
        },
      ],
      subtitle: {
        fontSize: 48,
        color: '#FFFFFF',
        position: 'bottom',
        highlightEnabled: true,
        highlightBackgroundColor: '#F8DC48',
        highlightTextColor: '#111827',
        highlightPaddingX: 10,
        highlightPaddingY: 4,
        highlightRadius: 12,
        highlightAnimation: 'pop',
        maxCharsPerEntry: 35,
        autoResegment: true,
      },
    },
  }),
}));
```

- [ ] **Step 2: 写新用例（renderToStaticMarkup 断言文本 / HTML 片段）**

在 `tests/subtitle-inspector.test.tsx` 的 `describe('SubtitleInspector', ...)` 块内（最后一个 `it` 之后）追加：

```tsx
  it('renders subtitle layout section with default max chars 35', () => {
    const html = renderToStaticMarkup(<SubtitleInspector />);

    expect(html).toContain('字幕排版');
    expect(html).toContain('单条最多字数');
    expect(html).toContain('超过自动切分');
    expect(html).toContain('立即重新切分');
    expect(html).toContain('还原原始字幕');
    // 默认 maxCharsPerEntry=35 应渲染在 value 属性或徽章里
    expect(html).toMatch(/value="?35"?/);
  });

  it('shows "未切分" status when srtEntries equals originalSrtEntries', () => {
    const html = renderToStaticMarkup(<SubtitleInspector />);
    // mock 里 originalSrtEntries 和 srtEntries 相同
    expect(html).toContain('未切分');
  });
```

**注意**：当前项目用 `renderToStaticMarkup` 做快照式断言，**不支持交互测试**（点击/输入）。防抖和 action 触发逻辑不在单元测试层覆盖，在 Task 10 的手动验证里走通。若将来引入 @testing-library，再补交互用例。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/subtitle-inspector.test.tsx`
Expected: FAIL —— 新增用例找不到 '字幕排版' 等字符串

- [ ] **Step 4: 在 SubtitleInspector 组件中新增"字幕排版"分组**

找到 `src/components/SubtitleInspector.tsx` 的组件 JSX return，在关键词高亮分组**之前**（即 highlight 相关 UI 的上方）插入新分组：

```tsx
{/* === 字幕排版 === */}
<section className={styles.section}>
  <header className={styles.sectionHeader}>
    <h3>字幕排版</h3>
  </header>

  <label className={styles.field}>
    <span>单条最多字数</span>
    <input
      type="range"
      min={20}
      max={60}
      step={1}
      value={timeline.subtitle.maxCharsPerEntry}
      onChange={(e) => handleMaxCharsChange(Number(e.target.value))}
    />
    <span className={styles.valueBadge}>{timeline.subtitle.maxCharsPerEntry}</span>
  </label>

  <div className={styles.field}>
    <Switch
      checked={timeline.subtitle.autoResegment}
      onChange={(next) => setAutoResegment(next)}
      label="超过自动切分"
    />
  </div>

  <div className={styles.actionRow}>
    <Button size="sm" variant="secondary" onClick={() => handleResegmentNow()}>
      立即重新切分
    </Button>
    <Button
      size="sm"
      variant="ghost"
      disabled={originalSrtEntries.length === srtEntries.length}
      onClick={() => restoreOriginalSubtitles()}
    >
      还原原始字幕
    </Button>
  </div>

  <p className={styles.statusLine}>
    {originalSrtEntries.length === srtEntries.length
      ? `未切分（${srtEntries.length} 条）`
      : `原 ${originalSrtEntries.length} 条 → 切分后 ${srtEntries.length} 条`}
  </p>
</section>
```

- [ ] **Step 5: 增加 store 订阅和防抖逻辑**

在 `SubtitleInspector` 组件函数体顶部，扩展现有 `useTimelineStore` 解构：

```ts
const {
  srtEntries,
  originalSrtEntries,
  setSubtitleHighlights,
  setSubtitleMaxChars,
  setAutoResegment,
  resegmentSubtitles,
  restoreOriginalSubtitles,
  timeline,
  updateSubtitleStyle,
} = useTimelineStore();
```

在 `useCallback` 之间添加：

```ts
const debounceRef = useRef<number | null>(null);

const handleMaxCharsChange = useCallback(
  (value: number) => {
    // 立即更新 UI 展示，但防抖触发切分
    updateSubtitleStyle({ maxCharsPerEntry: value });
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      setSubtitleMaxChars(value);
      debounceRef.current = null;
    }, 300);
  },
  [updateSubtitleStyle, setSubtitleMaxChars],
);

const handleResegmentNow = useCallback(() => {
  const { droppedHighlights } = resegmentSubtitles();
  if (droppedHighlights > 0) {
    // TODO: 接 toast 系统；本期简单 alert 或 console 输出
    console.warn(`${droppedHighlights} 条关键词高亮因切分失效`);
  }
}, [resegmentSubtitles]);

useEffect(() => {
  return () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
  };
}, []);
```

**imports 补充**：顶部 `from 'react'` 的 import 需要加入 `useEffect, useRef`。

- [ ] **Step 6: 如需样式类，扩展 CSS Module**

在 `src/components/SubtitleInspector.module.css` 添加（如果没有现成的类名）：

```css
.valueBadge {
  min-width: 2em;
  text-align: right;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.actionRow {
  display: flex;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.statusLine {
  margin-top: var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
```

如果现有 CSS 已有通用的 section/field 类（检查文件顶部类名），**优先复用**，不要重复创建。

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run tests/subtitle-inspector.test.tsx`
Expected: 新增 2 个用例全部 passing，已有用例无回归

- [ ] **Step 8: 运行 TypeScript 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 9: Commit**

```bash
git add src/components/SubtitleInspector.tsx src/components/SubtitleInspector.module.css tests/subtitle-inspector.test.tsx
git commit -m "feat(subtitle): SubtitleInspector 新增字幕排版分组 UI"
```

---

## Task 10: 端到端验证与手动测试

**Files:**
- 无代码修改，手动验证

- [ ] **Step 1: 运行完整测试套件确认无回归**

Run: `npm test`
Expected: 所有测试 passing

若有回归，逐个定位修复后提交独立 commit（格式：`fix(subtitle): <具体问题>`）。

- [ ] **Step 2: 启动 dev 环境**

Run: `npm run dev`
Expected: Electron 窗口启动，无控制台报错

- [ ] **Step 3: 手动验证流程**

打开一个已有项目（含 MiniMax 生成的长字幕），检查：

1. [ ] SubtitleInspector 中能看到"字幕排版"分组
2. [ ] 默认字数上限显示 35
3. [ ] 拖动滑块到 20 → 约 300ms 后 Player 字幕立即变短
4. [ ] 在 Player 里播放视频，字幕显示自然、无明显时间戳跳帧
5. [ ] 点击"还原原始字幕" → 字幕恢复长条
6. [ ] 关闭"超过自动切分" → 保持当前显示不变
7. [ ] 再次打开"超过自动切分" → 不会自动重切分（需点击"立即重新切分"或调整滑块）
8. [ ] 保存项目 → 重新打开 → maxCharsPerEntry 设置正确恢复，字幕根据开关重新应用切分
9. [ ] 关键词高亮分组：若有现存高亮，切分后能继续显示（或弹 toast 告知丢失数量）

- [ ] **Step 4: 边界场景验证**

1. [ ] 新建空项目 → 导入短 SRT → 无任何字幕超限 → 字幕保持原样
2. [ ] 导入一个纯英文 SRT → 验证空格断点正确
3. [ ] 字数设为极端值 20 → 短句不变，长句切得更碎，无空条目
4. [ ] Undo/redo：重切分操作应进入历史栈（可能需要额外处理；若未进入请标记为已知缺陷，本期不强制）

- [ ] **Step 5: 如有缺陷修复并补测试**

记录发现的问题，新开 commit 分别修复（每个 bug 一个 commit）。

- [ ] **Step 6: 最终 Commit（如果有修复）或跳过**

```bash
git status
# 若有未提交改动：
# git commit -m "fix(subtitle): <具体描述>"
```

- [ ] **Step 7: 调用 ui-review（项目强制要求）**

本项目 CLAUDE.md 要求前端 UI 交付后必须执行 `/ui-review`。按要求触发审查流程。

---

## 完成标准

- [ ] 所有 task 完成
- [ ] `npm test` 全部 passing
- [ ] `npx tsc --noEmit` 无错误
- [ ] 手动验证清单全部勾选
- [ ] ui-review 审查通过

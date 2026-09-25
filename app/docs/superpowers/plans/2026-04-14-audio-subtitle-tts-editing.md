# 音频/字幕二次加工 + TTS 配音替换 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在视频编辑器中落地字幕二次编辑、音频 Clip 虚拟合成、TTS 素材库与配音替换的 P0 核心闭环。

**Architecture:** 非破坏性虚拟音频合成 — 原始 MP3 保持只读，新增 `AudioClip` 序列引用原始音频或 TTS 素材；字幕数据持久化到 timeline store（不写回原 SRT）；Remotion 通过 `<Sequence>` + 多 `<Audio>` 合成预览与导出；音色预设通过 Electron IPC 持久化到 userData 全局目录。

**Tech Stack:** TypeScript 6 · React 19 · Zustand · Remotion 4 · Electron 41 · Vitest · MiniMax TTS v2

**关联文档:** [2026-04-14-audio-subtitle-tts-editing-design.md](../specs/2026-04-14-audio-subtitle-tts-editing-design.md)

---

## 文件结构概览

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/lib/minimax-voices.ts` | 硬编码 MiniMax 系统音色列表 |
| `src/lib/subtitle-builder.ts` | 字级时间戳 → SrtEntry 聚合纯函数 |
| `src/lib/clip-init.ts` | 按字幕切分 AudioClip 纯函数 |
| `src/lib/tts-service.ts` | TTS 生成高层封装（调用 IPC + 构造 TTSAsset） |
| `src/lib/voice-preset-defaults.ts` | 默认预设参数工厂 |
| `src/store/voice-presets.ts` | 全局音色预设 store |
| `src/components/SubtitleTabPanel.tsx` | 右侧 Inspector 字幕 Tab 内容 |
| `src/components/SubtitleTabPanel.module.css` | 字幕 Tab 样式 |
| `src/components/NewTTSDialog.tsx` | 新建 TTS 对话框 |
| `src/components/ReVoiceDialog.tsx` | 右键重新配音对话框 |
| `src/components/VoicePresetManager.tsx` | 音色预设管理 Modal |
| `src/components/TimelineClipWaveform.tsx` | 按 Clip 切片的波形组件 |
| `src/components/TTSAssetCard.tsx` | 左侧素材区 TTS 素材卡片 |
| `tests/subtitle-builder.test.ts` | 聚合函数单测 |
| `tests/clip-init.test.ts` | Clip 初始化单测 |
| `tests/timeline-subtitle-edit.test.ts` | 字幕编辑 action 测试 |
| `tests/timeline-clip-replace.test.ts` | `replaceClipWithTTS` 测试 |
| `tests/voice-presets-store.test.ts` | 音色预设 store 测试 |
| `tests/tts-asset-lifecycle.test.ts` | TTS 素材生成与引用快照测试 |

### 修改文件

| 文件 | 改动摘要 |
|------|---------|
| `src/types.ts` | 新增 `AudioClip` / `TTSAsset` / `VoicePreset` / `VoiceParams` / `WordTimestamp` / 扩展 `TimelineData` |
| `src/store/timeline.ts` | 新增 `audioClips` / `ttsAssets` / 字幕 CRUD / `replaceClipWithTTS` / 惰性初始化 |
| `electron/main.ts` | 扩展 `generate-tts` 返回 `wordTimestamps`；新增 `voice-presets:*` 处理器 |
| `electron/preload.ts` | 暴露新 IPC |
| `src/lib/electron-api.ts` | 同步类型定义 |
| `src/lib/minimax-tts.ts` | 从 MiniMax 响应中提取 `wordTimestamps` 的辅助导出 |
| `src/remotion/PodcastComposition.tsx` | 改造为多 Clip `<Sequence>` 渲染，向后兼容 |
| `src/components/EditorInspector.tsx` | 包一层 Tab 容器（详情 Tab / 字幕 Tab） |
| `src/components/EditorInspector.module.css` | Tab 样式 |
| `src/components/AssetPanel.tsx` | 音频 Tab 顶部插入 TTS 生成区 |
| `src/components/Timeline.tsx`（或 Clip 渲染组件） | 右键菜单接入「重新配音」|
| `src/pages/Settings.tsx` | 新增「音色预设」分区入口 |

### 任务依赖

```
Phase 1 (基础) → Phase 2 (Store) → Phase 3 (IPC)
                                        ↓
Phase 4 (Service) → Phase 5 (Remotion/波形)
                        ↓
Phase 6 (字幕 UI) → Phase 7 (TTS UI) → Phase 8 (配音闭环)
                        ↓
                Phase 9 (集成 + 兼容 + 压测)
```

---

# Phase 1 · 基础类型与纯函数

## Task 1: 新增核心类型定义

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: 在 src/types.ts 末尾追加新增类型**

```ts
// =============================================================================
// 音频 Clip / TTS 素材 / 音色预设（audio-subtitle-tts 二次加工）
// =============================================================================

/** MiniMax TTS 返回的字级时间戳 */
export interface WordTimestamp {
  text: string;
  startMs: number;
  endMs: number;
}

/** 音色生成参数（语速 / 音量 / 音高 / 情绪） */
export interface VoiceParams {
  speed: number;
  vol?: number;
  pitch?: number;
  emotion?: string;
}

/** 音色预设（全局跨项目复用） */
export interface VoicePreset {
  id: string;
  name: string;
  provider: 'minimax';
  voiceId: string;
  params: VoiceParams;
  voiceSource: 'system' | 'cloned';
  createdAt: number;
  updatedAt: number;
}

/** TTS 素材（持久化到 <projectDir>/tts/） */
export interface TTSAsset {
  id: string;
  filePath: string;
  text: string;
  durationMs: number;
  voicePresetId: string;
  voicePresetSnapshot: VoicePreset;
  voiceOverrides?: Partial<VoiceParams>;
  wordTimestamps?: WordTimestamp[];
  createdAt: number;
  voiceSource?: 'system' | 'cloned';
}

/** 音频 Clip —— 虚拟合成的基本单元 */
export type AudioClipSource =
  | { kind: 'origin'; startMs: number; endMs: number }
  | { kind: 'tts'; assetId: string };

export interface AudioClip {
  id: string;
  source: AudioClipSource;
  timelineStartMs: number;
  durationMs: number;
  linkedSubtitleIndexes: number[];
  muted?: boolean;
}
```

- [ ] **Step 2: 在 TimelineData 接口中追加可选字段**

找到 `export interface TimelineData {` 定义（当前在 src/types.ts:121），在 `subtitleHighlights?` 下面追加：

```ts
export interface TimelineData {
  version: number;
  fps: number;
  width: number;
  height: number;
  podcast: {
    audioPath: string;
    srtPath: string;
    durationMs: number;
  };
  tracks: TimelineTrack[];
  overlays: OverlayItem[];
  subtitle: SubtitleStyle;
  subtitleHighlights?: SubtitleHighlight[];

  // 新增：音频/字幕二次加工
  audioClips?: AudioClip[];
  ttsAssets?: TTSAsset[];
  editedSubtitles?: SrtEntry[];
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npm run build`
Expected: PASS（无类型错误）

- [ ] **Step 4: 提交**

```bash
git add src/types.ts
git commit -m "feat(types): 新增 AudioClip/TTSAsset/VoicePreset 类型"
```

---

## Task 2: 字级时间戳聚合纯函数

**Files:**
- Create: `src/lib/subtitle-builder.ts`
- Test: `tests/subtitle-builder.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/subtitle-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildSubtitlesFromWordTimestamps } from '../src/lib/subtitle-builder';
import type { WordTimestamp } from '../src/types';

describe('buildSubtitlesFromWordTimestamps', () => {
  it('empty input returns empty array', () => {
    expect(buildSubtitlesFromWordTimestamps([], 0)).toEqual([]);
  });

  it('splits at Chinese punctuation', () => {
    const input: WordTimestamp[] = [
      { text: '你', startMs: 0, endMs: 100 },
      { text: '好', startMs: 100, endMs: 200 },
      { text: '，', startMs: 200, endMs: 250 },
      { text: '世', startMs: 250, endMs: 350 },
      { text: '界', startMs: 350, endMs: 450 },
    ];
    const result = buildSubtitlesFromWordTimestamps(input, 0);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('你好，');
    expect(result[0].startMs).toBe(0);
    expect(result[0].endMs).toBe(250);
    expect(result[1].text).toBe('世界');
    expect(result[1].startMs).toBe(250);
    expect(result[1].endMs).toBe(450);
  });

  it('applies offset to all timestamps', () => {
    const input: WordTimestamp[] = [
      { text: '测', startMs: 0, endMs: 100 },
      { text: '试', startMs: 100, endMs: 200 },
    ];
    const result = buildSubtitlesFromWordTimestamps(input, 5000);
    expect(result[0].startMs).toBe(5000);
    expect(result[0].endMs).toBe(5200);
  });

  it('forces split when bucket exceeds 20 chars without punctuation', () => {
    const input: WordTimestamp[] = Array.from({ length: 25 }, (_, i) => ({
      text: String.fromCharCode(0x4e00 + i),
      startMs: i * 100,
      endMs: (i + 1) * 100,
    }));
    const result = buildSubtitlesFromWordTimestamps(input, 0);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].text.length).toBeLessThanOrEqual(20);
  });

  it('forces split when bucket exceeds 3000ms', () => {
    const input: WordTimestamp[] = [
      { text: 'a', startMs: 0, endMs: 1000 },
      { text: 'b', startMs: 1000, endMs: 2000 },
      { text: 'c', startMs: 2000, endMs: 3500 },
      { text: 'd', startMs: 3500, endMs: 4500 },
    ];
    const result = buildSubtitlesFromWordTimestamps(input, 0);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('returned SrtEntry.index is sequential starting from 1 (assigned by caller)', () => {
    const input: WordTimestamp[] = [
      { text: '一', startMs: 0, endMs: 100 },
      { text: '。', startMs: 100, endMs: 200 },
      { text: '二', startMs: 200, endMs: 300 },
    ];
    const result = buildSubtitlesFromWordTimestamps(input, 0);
    // index 字段由调用方重新编号，此处可为 -1 占位
    expect(result.every(r => typeof r.index === 'number')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/subtitle-builder.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现聚合函数**

```ts
// src/lib/subtitle-builder.ts
import type { SrtEntry, WordTimestamp } from '../types';

const PUNCTUATION_REGEX = /[，。？！,.?!；;：:]/;
const MAX_BUCKET_CHARS = 20;
const MAX_BUCKET_MS = 3000;

/**
 * 把 TTS 字级时间戳聚合为字幕条。
 * 规则：按标点切分；兜底限制 ≤20 字 或 ≤3000ms。
 * 返回的 SrtEntry.index 占位为 -1，由调用方重编号。
 */
export function buildSubtitlesFromWordTimestamps(
  timestamps: WordTimestamp[],
  offsetMs: number
): SrtEntry[] {
  const result: SrtEntry[] = [];
  let bucket: WordTimestamp[] = [];

  const flush = () => {
    if (bucket.length === 0) return;
    const startMs = bucket[0].startMs + offsetMs;
    const endMs = bucket[bucket.length - 1].endMs + offsetMs;
    result.push({
      index: -1,
      startMs,
      endMs,
      text: bucket.map((b) => b.text).join(''),
    });
    bucket = [];
  };

  for (const ts of timestamps) {
    bucket.push(ts);
    const isPunct = PUNCTUATION_REGEX.test(ts.text);
    const tooManyChars = bucket.length >= MAX_BUCKET_CHARS;
    const tooLong =
      bucket[bucket.length - 1].endMs - bucket[0].startMs >= MAX_BUCKET_MS;
    if (isPunct || tooManyChars || tooLong) {
      flush();
    }
  }

  flush();
  return result;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/subtitle-builder.test.ts`
Expected: PASS — 全部用例通过

- [ ] **Step 5: 提交**

```bash
git add src/lib/subtitle-builder.ts tests/subtitle-builder.test.ts
git commit -m "feat(subtitle): 新增字级时间戳聚合函数"
```

---

## Task 3: 按字幕切分 AudioClip 纯函数

**Files:**
- Create: `src/lib/clip-init.ts`
- Test: `tests/clip-init.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/clip-init.test.ts
import { describe, it, expect } from 'vitest';
import { initAudioClipsFromSubtitles } from '../src/lib/clip-init';
import type { SrtEntry } from '../src/types';

const entries: SrtEntry[] = [
  { index: 1, startMs: 0, endMs: 2000, text: '第一句' },
  { index: 2, startMs: 2000, endMs: 5000, text: '第二句' },
  { index: 3, startMs: 5500, endMs: 8000, text: '第三句（有间隙）' },
];

describe('initAudioClipsFromSubtitles', () => {
  it('returns one clip per subtitle entry by default', () => {
    const clips = initAudioClipsFromSubtitles(entries, 10000);
    expect(clips).toHaveLength(3);
  });

  it('clip source.startMs/endMs equals subtitle time range', () => {
    const clips = initAudioClipsFromSubtitles(entries, 10000);
    expect(clips[0].source).toEqual({ kind: 'origin', startMs: 0, endMs: 2000 });
    expect(clips[1].source).toEqual({ kind: 'origin', startMs: 2000, endMs: 5000 });
  });

  it('timelineStartMs matches subtitle startMs on init (1:1 mapping)', () => {
    const clips = initAudioClipsFromSubtitles(entries, 10000);
    expect(clips[0].timelineStartMs).toBe(0);
    expect(clips[1].timelineStartMs).toBe(2000);
    expect(clips[2].timelineStartMs).toBe(5500);
  });

  it('durationMs equals subtitle endMs - startMs', () => {
    const clips = initAudioClipsFromSubtitles(entries, 10000);
    expect(clips[0].durationMs).toBe(2000);
    expect(clips[1].durationMs).toBe(3000);
    expect(clips[2].durationMs).toBe(2500);
  });

  it('linkedSubtitleIndexes contains the source subtitle index', () => {
    const clips = initAudioClipsFromSubtitles(entries, 10000);
    expect(clips[0].linkedSubtitleIndexes).toEqual([1]);
    expect(clips[2].linkedSubtitleIndexes).toEqual([3]);
  });

  it('generates unique clip ids', () => {
    const clips = initAudioClipsFromSubtitles(entries, 10000);
    const ids = new Set(clips.map((c) => c.id));
    expect(ids.size).toBe(clips.length);
  });

  it('returns empty array when entries is empty', () => {
    expect(initAudioClipsFromSubtitles([], 10000)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/clip-init.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现初始化函数**

```ts
// src/lib/clip-init.ts
import type { AudioClip, SrtEntry } from '../types';

function generateClipId(): string {
  return `clip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 按字幕条生成初始 AudioClip 数组。
 * 每条字幕对应一个 Clip，source 引用原始音频的对应时间段。
 */
export function initAudioClipsFromSubtitles(
  entries: SrtEntry[],
  _totalAudioDurationMs: number
): AudioClip[] {
  return entries.map((entry) => ({
    id: generateClipId(),
    source: {
      kind: 'origin',
      startMs: entry.startMs,
      endMs: entry.endMs,
    },
    timelineStartMs: entry.startMs,
    durationMs: entry.endMs - entry.startMs,
    linkedSubtitleIndexes: [entry.index],
  }));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/clip-init.test.ts`
Expected: PASS — 全部用例通过

- [ ] **Step 5: 提交**

```bash
git add src/lib/clip-init.ts tests/clip-init.test.ts
git commit -m "feat(clip): 新增按字幕切分 AudioClip 的初始化函数"
```

---

## Task 4: MiniMax 系统音色硬编码列表

**Files:**
- Create: `src/lib/minimax-voices.ts`

- [ ] **Step 1: 创建音色常量表**

```ts
// src/lib/minimax-voices.ts
export interface MinimaxVoiceDef {
  voiceId: string;
  name: string;
  description: string;
  gender: 'male' | 'female' | 'neutral';
  category: '主播' | '旁白' | '角色' | '其他';
}

/**
 * MiniMax 系统音色列表（硬编码，P0 只覆盖常用场景）。
 * 后续若需动态获取，可扩展 VoicePreset.voiceSource = 'cloned'。
 */
export const MINIMAX_SYSTEM_VOICES: MinimaxVoiceDef[] = [
  {
    voiceId: 'male-qn-qingse',
    name: '青涩青年男声',
    description: '自然清爽,适合日常播客',
    gender: 'male',
    category: '主播',
  },
  {
    voiceId: 'male-qn-jingying',
    name: '精英青年男声',
    description: '沉稳有力,适合商业财经',
    gender: 'male',
    category: '主播',
  },
  {
    voiceId: 'male-qn-badao',
    name: '霸道青年男声',
    description: '低沉浑厚,适合剧情解说',
    gender: 'male',
    category: '角色',
  },
  {
    voiceId: 'female-shaonv',
    name: '少女音',
    description: '清亮甜美,适合轻松话题',
    gender: 'female',
    category: '主播',
  },
  {
    voiceId: 'female-yujie',
    name: '御姐音',
    description: '成熟知性,适合深度访谈',
    gender: 'female',
    category: '主播',
  },
  {
    voiceId: 'female-chengshu',
    name: '成熟女声',
    description: '温婉稳重,适合文化节目',
    gender: 'female',
    category: '旁白',
  },
  {
    voiceId: 'female-tianmei',
    name: '甜美女声',
    description: '亲和力强,适合生活类内容',
    gender: 'female',
    category: '主播',
  },
  {
    voiceId: 'presenter_male',
    name: '男性主持人',
    description: '标准播音风格',
    gender: 'male',
    category: '旁白',
  },
  {
    voiceId: 'presenter_female',
    name: '女性主持人',
    description: '标准播音风格',
    gender: 'female',
    category: '旁白',
  },
];

export function findMinimaxVoice(voiceId: string): MinimaxVoiceDef | undefined {
  return MINIMAX_SYSTEM_VOICES.find((v) => v.voiceId === voiceId);
}

export const DEFAULT_VOICE_PARAMS = {
  speed: 1.0,
  vol: 1.0,
  pitch: 0,
  emotion: 'neutral',
} as const;

export const MINIMAX_EMOTIONS = [
  { value: 'neutral', label: '自然' },
  { value: 'happy', label: '愉悦' },
  { value: 'sad', label: '低落' },
  { value: 'angry', label: '激昂' },
  { value: 'fearful', label: '紧张' },
  { value: 'disgusted', label: '不屑' },
  { value: 'surprised', label: '惊讶' },
] as const;
```

- [ ] **Step 2: 运行类型检查**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/lib/minimax-voices.ts
git commit -m "feat(tts): 硬编码 MiniMax 系统音色列表"
```

---

## Task 5: 从 MiniMax 响应中提取字级时间戳

**Files:**
- Modify: `src/lib/minimax-tts.ts`

- [ ] **Step 1: 新增导出函数 extractWordTimestamps**

在 `src/lib/minimax-tts.ts` 末尾追加：

```ts
import type { WordTimestamp } from '../types';

/**
 * 从 MiniMax 返回的 subtitles 数组转换为统一的 WordTimestamp 结构。
 * 兼容 begin_time/end_time 与 time_begin/time_end 两种字段命名。
 */
export function extractWordTimestamps(
  sentences: MinimaxSubtitleSentence[] | undefined
): WordTimestamp[] {
  if (!sentences || sentences.length === 0) return [];
  const result: WordTimestamp[] = [];
  for (const s of sentences) {
    const text = s.text ?? s.pronounce_text ?? '';
    if (!text) continue;
    const startMs = s.begin_time ?? s.time_begin;
    const endMs = s.end_time ?? s.time_end;
    if (typeof startMs !== 'number' || typeof endMs !== 'number') continue;
    result.push({ text, startMs, endMs });
  }
  return result;
}
```

- [ ] **Step 2: 运行类型检查**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/lib/minimax-tts.ts
git commit -m "feat(tts): 导出 extractWordTimestamps 辅助函数"
```

---

# Phase 2 · IPC 层扩展

## Task 6: 扩展 generate-tts IPC 返回 wordTimestamps

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/lib/electron-api.ts`

- [ ] **Step 1: 在 electron/main.ts 找到 generate-tts 处理器**

用 Grep 定位：
```
Grep pattern: generate-tts
File: electron/main.ts
```

找到 `ipcMain.handle('generate-tts', ...)` 的实现，找到调用 MiniMax API 之后解析响应的位置（通常是 `extractMinimaxSubtitleSentences(payload)` 或类似）。

- [ ] **Step 2: 在 handler 内导入并调用 extractWordTimestamps**

修改 handler 返回值：
```ts
// electron/main.ts
import { extractMinimaxSubtitleSentences, extractWordTimestamps } from '../src/lib/minimax-tts';

// 在现有 handler 中找到生成 response 对象的位置
// 原: return { audioPath, srtPath, durationMs };
// 改为:
const sentences = extractMinimaxSubtitleSentences(payload);
const wordTimestamps = extractWordTimestamps(sentences);
return { audioPath, srtPath, durationMs, wordTimestamps };
```

- [ ] **Step 3: 在 electron/preload.ts 确认签名自动透传**

preload 通常是透明转发 `ipcRenderer.invoke`，无需修改。仅需确认 `generateTTS` 是透明传递的（Grep `generateTTS` 确认）。

- [ ] **Step 4: 更新 src/lib/electron-api.ts 类型**

找到 `generateTTS` 的类型定义（约 108-223 行之间），在返回类型中增加 `wordTimestamps`：

```ts
generateTTS: (args: {
  requestId: string;
  text: string;
  voiceId: string;
  speed: number;
  vol: number;
  pitch: number;
  emotion: string;
  model: string;
  apiKey: string;
  projectDir: string;
}) => Promise<{
  audioPath: string;
  srtPath: string;
  durationMs: number;
  wordTimestamps: WordTimestamp[];
}>;
```

在文件顶部导入 `WordTimestamp`：
```ts
import type { WordTimestamp } from '../types';
```

- [ ] **Step 5: 运行类型检查**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add electron/main.ts src/lib/electron-api.ts
git commit -m "feat(ipc): generate-tts 返回 wordTimestamps"
```

---

## Task 7: 新增 voice-presets IPC

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/lib/electron-api.ts`

- [ ] **Step 1: 在 electron/main.ts 新增三个 handler**

在靠近其他 ipcMain.handle 的位置追加：

```ts
// ---- voice-presets (全局跨项目) ----
import path from 'node:path';
import fs from 'node:fs/promises';

async function getVoicePresetsPath(): Promise<string> {
  const userData = app.getPath('userData');
  return path.join(userData, 'voice-presets.json');
}

async function readVoicePresetsFile(): Promise<{
  presets: VoicePreset[];
  defaultPresetId: string | null;
}> {
  const filePath = await getVoicePresetsPath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      presets: Array.isArray(parsed.presets) ? parsed.presets : [],
      defaultPresetId: parsed.defaultPresetId ?? null,
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { presets: [], defaultPresetId: null };
    }
    throw err;
  }
}

async function writeVoicePresetsFile(data: {
  presets: VoicePreset[];
  defaultPresetId: string | null;
}) {
  const filePath = await getVoicePresetsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

ipcMain.handle('voice-presets:list', async () => {
  return await readVoicePresetsFile();
});

ipcMain.handle('voice-presets:save', async (_, preset: VoicePreset) => {
  const data = await readVoicePresetsFile();
  const existingIndex = data.presets.findIndex((p) => p.id === preset.id);
  if (existingIndex >= 0) {
    data.presets[existingIndex] = { ...preset, updatedAt: Date.now() };
  } else {
    data.presets.push(preset);
  }
  await writeVoicePresetsFile(data);
  return data;
});

ipcMain.handle('voice-presets:delete', async (_, id: string) => {
  const data = await readVoicePresetsFile();
  data.presets = data.presets.filter((p) => p.id !== id);
  if (data.defaultPresetId === id) {
    data.defaultPresetId = null;
  }
  await writeVoicePresetsFile(data);
  return data;
});

ipcMain.handle('voice-presets:set-default', async (_, id: string | null) => {
  const data = await readVoicePresetsFile();
  data.defaultPresetId = id;
  await writeVoicePresetsFile(data);
  return data;
});
```

在文件顶部导入 `VoicePreset`：
```ts
import type { VoicePreset } from '../src/types';
```

- [ ] **Step 2: 在 electron/preload.ts 暴露 API**

在 contextBridge 对象中追加：

```ts
listVoicePresets: () => ipcRenderer.invoke('voice-presets:list'),
saveVoicePreset: (preset: VoicePreset) =>
  ipcRenderer.invoke('voice-presets:save', preset),
deleteVoicePreset: (id: string) =>
  ipcRenderer.invoke('voice-presets:delete', id),
setDefaultVoicePreset: (id: string | null) =>
  ipcRenderer.invoke('voice-presets:set-default', id),
```

- [ ] **Step 3: 在 src/lib/electron-api.ts 新增类型定义**

在 `ElectronAPI` interface 末尾追加：

```ts
listVoicePresets: () => Promise<{
  presets: VoicePreset[];
  defaultPresetId: string | null;
}>;
saveVoicePreset: (preset: VoicePreset) => Promise<{
  presets: VoicePreset[];
  defaultPresetId: string | null;
}>;
deleteVoicePreset: (id: string) => Promise<{
  presets: VoicePreset[];
  defaultPresetId: string | null;
}>;
setDefaultVoicePreset: (id: string | null) => Promise<{
  presets: VoicePreset[];
  defaultPresetId: string | null;
}>;
```

确认文件顶部导入了 `VoicePreset`。

- [ ] **Step 4: 运行类型检查**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/main.ts electron/preload.ts src/lib/electron-api.ts
git commit -m "feat(ipc): 新增 voice-presets 全局预设持久化"
```

---

# Phase 3 · Store 层

## Task 8: 创建音色预设全局 Store

**Files:**
- Create: `src/store/voice-presets.ts`
- Test: `tests/voice-presets-store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/voice-presets-store.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useVoicePresetsStore } from '../src/store/voice-presets';
import type { VoicePreset } from '../src/types';

const mockApi = {
  listVoicePresets: vi.fn(),
  saveVoicePreset: vi.fn(),
  deleteVoicePreset: vi.fn(),
  setDefaultVoicePreset: vi.fn(),
};

// @ts-expect-error - 测试环境注入
globalThis.window = { electronAPI: mockApi };

beforeEach(() => {
  mockApi.listVoicePresets.mockReset();
  mockApi.saveVoicePreset.mockReset();
  mockApi.deleteVoicePreset.mockReset();
  mockApi.setDefaultVoicePreset.mockReset();
  useVoicePresetsStore.setState({ presets: [], defaultPresetId: null, loaded: false });
});

describe('useVoicePresetsStore', () => {
  it('load() pulls data from electronAPI', async () => {
    const sample: VoicePreset = {
      id: 'p1',
      name: '主播男声',
      provider: 'minimax',
      voiceId: 'male-qn-qingse',
      params: { speed: 1, vol: 1, pitch: 0, emotion: 'neutral' },
      voiceSource: 'system',
      createdAt: 1,
      updatedAt: 1,
    };
    mockApi.listVoicePresets.mockResolvedValue({ presets: [sample], defaultPresetId: 'p1' });
    await useVoicePresetsStore.getState().load();
    expect(useVoicePresetsStore.getState().presets).toEqual([sample]);
    expect(useVoicePresetsStore.getState().defaultPresetId).toBe('p1');
    expect(useVoicePresetsStore.getState().loaded).toBe(true);
  });

  it('create() generates id and calls saveVoicePreset', async () => {
    mockApi.saveVoicePreset.mockImplementation(async (p: VoicePreset) => ({
      presets: [p],
      defaultPresetId: null,
    }));
    const created = await useVoicePresetsStore.getState().create({
      name: '旁白女声',
      provider: 'minimax',
      voiceId: 'female-tianmei',
      params: { speed: 1, vol: 1, pitch: 0, emotion: 'neutral' },
      voiceSource: 'system',
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeGreaterThan(0);
    expect(mockApi.saveVoicePreset).toHaveBeenCalledOnce();
  });

  it('remove() calls deleteVoicePreset and updates state', async () => {
    const sample: VoicePreset = {
      id: 'p2',
      name: 'X',
      provider: 'minimax',
      voiceId: 'v',
      params: { speed: 1 },
      voiceSource: 'system',
      createdAt: 0,
      updatedAt: 0,
    };
    useVoicePresetsStore.setState({ presets: [sample], defaultPresetId: 'p2', loaded: true });
    mockApi.deleteVoicePreset.mockResolvedValue({ presets: [], defaultPresetId: null });
    await useVoicePresetsStore.getState().remove('p2');
    expect(useVoicePresetsStore.getState().presets).toEqual([]);
    expect(useVoicePresetsStore.getState().defaultPresetId).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/voice-presets-store.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 store**

```ts
// src/store/voice-presets.ts
import { create } from 'zustand';
import type { VoicePreset, VoiceParams } from '../types';

function generatePresetId(): string {
  return `vp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface VoicePresetsState {
  presets: VoicePreset[];
  defaultPresetId: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  create: (
    input: Omit<VoicePreset, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<VoicePreset>;
  update: (id: string, patch: Partial<Omit<VoicePreset, 'id' | 'createdAt'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setDefault: (id: string | null) => Promise<void>;
  getDefault: () => VoicePreset | null;
  findById: (id: string) => VoicePreset | null;
}

export const useVoicePresetsStore = create<VoicePresetsState>((set, get) => ({
  presets: [],
  defaultPresetId: null,
  loaded: false,

  async load() {
    const api = window.electronAPI;
    const data = await api.listVoicePresets();
    set({
      presets: data.presets,
      defaultPresetId: data.defaultPresetId,
      loaded: true,
    });
  },

  async create(input) {
    const now = Date.now();
    const preset: VoicePreset = {
      ...input,
      id: generatePresetId(),
      createdAt: now,
      updatedAt: now,
    };
    const data = await window.electronAPI.saveVoicePreset(preset);
    set({ presets: data.presets, defaultPresetId: data.defaultPresetId });
    return preset;
  },

  async update(id, patch) {
    const existing = get().presets.find((p) => p.id === id);
    if (!existing) return;
    const updated: VoicePreset = { ...existing, ...patch, updatedAt: Date.now() };
    const data = await window.electronAPI.saveVoicePreset(updated);
    set({ presets: data.presets, defaultPresetId: data.defaultPresetId });
  },

  async remove(id) {
    const data = await window.electronAPI.deleteVoicePreset(id);
    set({ presets: data.presets, defaultPresetId: data.defaultPresetId });
  },

  async setDefault(id) {
    const data = await window.electronAPI.setDefaultVoicePreset(id);
    set({ presets: data.presets, defaultPresetId: data.defaultPresetId });
  },

  getDefault() {
    const { defaultPresetId, presets } = get();
    if (!defaultPresetId) return presets[0] ?? null;
    return presets.find((p) => p.id === defaultPresetId) ?? null;
  },

  findById(id) {
    return get().presets.find((p) => p.id === id) ?? null;
  },
}));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/voice-presets-store.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/voice-presets.ts tests/voice-presets-store.test.ts
git commit -m "feat(store): 新增全局音色预设 store"
```

---

## Task 9: Timeline Store 新增 audioClips/ttsAssets 字段

**Files:**
- Modify: `src/store/timeline.ts`

- [ ] **Step 1: 在 TimelineStore interface 中追加字段**

在 `src/store/timeline.ts` 找到 `export interface TimelineStore {`，在现有字段末尾（historyFuture 之前的 action 之前）追加：

```ts
export interface TimelineStore {
  timeline: TimelineData;
  srtEntries: SrtEntry[];
  assets: AssetItem[];
  overlayClipboard: OverlayClipboardItem | null;
  canUndo: boolean;
  canRedo: boolean;
  historyPast: TimelineSnapshot[];
  historyFuture: TimelineSnapshot[];

  // 新增：音频 Clip / TTS 素材 / 字幕编辑
  audioClips: AudioClip[];
  ttsAssets: TTSAsset[];
  editedSubtitles: SrtEntry[] | null; // null = 尚未进入编辑模式，使用 srtEntries
  selectedSubtitleIndex: number | null;
  selectedAudioClipId: string | null;

  // ... 现有 action signatures
  setTimeline: (timeline: TimelineData) => void;
  // ...
}
```

导入 `AudioClip` / `TTSAsset`：
```ts
import type {
  // ... 现有
  AudioClip,
  TTSAsset,
  VoicePreset,
  VoiceParams,
  WordTimestamp,
} from '../types';
```

- [ ] **Step 2: 在 initial state 里初始化新字段**

找到 store 的 initial state 对象（`create<TimelineStore>((set, get) => ({` 后紧跟的字段），在合适的位置追加：

```ts
audioClips: [],
ttsAssets: [],
editedSubtitles: null,
selectedSubtitleIndex: null,
selectedAudioClipId: null,
```

- [ ] **Step 3: 在 setTimeline 中同步加载 audioClips/ttsAssets/editedSubtitles**

找到 `setTimeline: (timeline: TimelineData) => { ... }`，修改实现为同时恢复新字段：

```ts
setTimeline: (timeline: TimelineData) => {
  set({
    timeline,
    audioClips: timeline.audioClips ?? [],
    ttsAssets: timeline.ttsAssets ?? [],
    editedSubtitles: timeline.editedSubtitles ?? null,
    historyPast: [],
    historyFuture: [],
    canUndo: false,
    canRedo: false,
  });
},
```

- [ ] **Step 4: 新增一个 selector 把 audioClips/ttsAssets 持久化回 timeline 的辅助函数**

在 store 内部（不暴露）或导出新增：

```ts
function commitClipsToTimeline(state: TimelineStore): TimelineData {
  return {
    ...state.timeline,
    audioClips: state.audioClips,
    ttsAssets: state.ttsAssets,
    editedSubtitles: state.editedSubtitles ?? undefined,
  };
}
```

将此函数放在文件内 `create<TimelineStore>` 之前。

- [ ] **Step 5: 运行现有 timeline 测试**

Run: `npx vitest run tests/timeline.test.tsx tests/timeline-store-lock.test.ts`
Expected: PASS（旧测试不应被破坏）

- [ ] **Step 6: 运行类型检查**

Run: `npm run build`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/store/timeline.ts
git commit -m "feat(store): timeline 新增 audioClips/ttsAssets/editedSubtitles 字段"
```

---

## Task 10: Timeline Store 字幕编辑 Actions

**Files:**
- Modify: `src/store/timeline.ts`
- Test: `tests/timeline-subtitle-edit.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/timeline-subtitle-edit.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import type { SrtEntry, TimelineData } from '../src/types';

const baseTimeline: TimelineData = {
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  podcast: { audioPath: '/a.mp3', srtPath: '/a.srt', durationMs: 10000 },
  tracks: [],
  overlays: [],
  subtitle: {
    fontSize: 32,
    color: '#fff',
    position: 'bottom',
    highlightEnabled: false,
    highlightBackgroundColor: '#000',
    highlightTextColor: '#fff',
    highlightPaddingX: 4,
    highlightPaddingY: 2,
    highlightRadius: 4,
    highlightAnimation: 'none',
  },
};

const entries: SrtEntry[] = [
  { index: 1, startMs: 0, endMs: 2000, text: '一' },
  { index: 2, startMs: 2000, endMs: 4000, text: '二' },
  { index: 3, startMs: 4000, endMs: 6000, text: '三' },
];

beforeEach(() => {
  useTimelineStore.getState().setTimeline(baseTimeline);
  useTimelineStore.getState().setSrtEntries(entries);
  useTimelineStore.setState({ editedSubtitles: null });
});

describe('字幕编辑 actions', () => {
  it('updateSubtitle 修改单条文本,持久化到 editedSubtitles', () => {
    useTimelineStore.getState().updateSubtitle(2, { text: '新二' });
    const subs = useTimelineStore.getState().editedSubtitles!;
    expect(subs[1].text).toBe('新二');
  });

  it('updateSubtitle 首次调用时从 srtEntries 初始化 editedSubtitles', () => {
    expect(useTimelineStore.getState().editedSubtitles).toBeNull();
    useTimelineStore.getState().updateSubtitle(1, { text: 'x' });
    expect(useTimelineStore.getState().editedSubtitles).toHaveLength(3);
  });

  it('deleteSubtitle 删除后重编 index', () => {
    useTimelineStore.getState().deleteSubtitle(2);
    const subs = useTimelineStore.getState().editedSubtitles!;
    expect(subs).toHaveLength(2);
    expect(subs[0].index).toBe(1);
    expect(subs[1].index).toBe(2);
    expect(subs[1].text).toBe('三');
  });

  it('insertSubtitle 插入新条,按 startMs 重排', () => {
    useTimelineStore.getState().insertSubtitle(1, {
      startMs: 1000,
      endMs: 1500,
      text: '插入',
    });
    const subs = useTimelineStore.getState().editedSubtitles!;
    expect(subs).toHaveLength(4);
    expect(subs[1].text).toBe('插入');
    expect(subs[1].index).toBe(2);
  });

  it('replaceAllSubtitles 返回替换次数', () => {
    useTimelineStore.getState().updateSubtitle(1, { text: '你好世界' });
    useTimelineStore.getState().updateSubtitle(2, { text: '世界你好' });
    const count = useTimelineStore.getState().replaceAllSubtitles('你好', '大家');
    expect(count).toBe(2);
    const subs = useTimelineStore.getState().editedSubtitles!;
    expect(subs[0].text).toBe('大家世界');
    expect(subs[1].text).toBe('世界大家');
  });

  it('setSelectedSubtitleIndex 可设置和清除', () => {
    useTimelineStore.getState().setSelectedSubtitleIndex(2);
    expect(useTimelineStore.getState().selectedSubtitleIndex).toBe(2);
    useTimelineStore.getState().setSelectedSubtitleIndex(null);
    expect(useTimelineStore.getState().selectedSubtitleIndex).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/timeline-subtitle-edit.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 src/store/timeline.ts 追加 action 签名**

在 interface 中追加：
```ts
updateSubtitle: (index: number, patch: Partial<SrtEntry>) => void;
deleteSubtitle: (index: number) => void;
insertSubtitle: (afterIndex: number, entry: Omit<SrtEntry, 'index'>) => void;
replaceAllSubtitles: (find: string, replace: string) => number;
setSelectedSubtitleIndex: (index: number | null) => void;
```

- [ ] **Step 4: 实现 actions（在 create 函数内部追加）**

在 `create<TimelineStore>((set, get) => ({ ... }))` 里追加这些 action 实现：

```ts
updateSubtitle: (index, patch) => {
  set((state) => {
    const source = state.editedSubtitles ?? state.srtEntries;
    const next = source.map((e) => (e.index === index ? { ...e, ...patch, index } : e));
    return { editedSubtitles: next };
  });
},

deleteSubtitle: (index) => {
  set((state) => {
    const source = state.editedSubtitles ?? state.srtEntries;
    const next = source
      .filter((e) => e.index !== index)
      .sort((a, b) => a.startMs - b.startMs)
      .map((e, i) => ({ ...e, index: i + 1 }));
    return { editedSubtitles: next };
  });
},

insertSubtitle: (afterIndex, entry) => {
  set((state) => {
    const source = state.editedSubtitles ?? state.srtEntries;
    const newEntry: SrtEntry = { ...entry, index: -1 };
    const next = [...source, newEntry]
      .sort((a, b) => a.startMs - b.startMs)
      .map((e, i) => ({ ...e, index: i + 1 }));
    return { editedSubtitles: next };
  });
},

replaceAllSubtitles: (find, replace) => {
  if (!find) return 0;
  let count = 0;
  set((state) => {
    const source = state.editedSubtitles ?? state.srtEntries;
    const next = source.map((e) => {
      if (!e.text.includes(find)) return e;
      const replaced = e.text.split(find);
      count += replaced.length - 1;
      return { ...e, text: replaced.join(replace) };
    });
    return { editedSubtitles: next };
  });
  return count;
},

setSelectedSubtitleIndex: (index) => set({ selectedSubtitleIndex: index }),
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/timeline-subtitle-edit.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/store/timeline.ts tests/timeline-subtitle-edit.test.ts
git commit -m "feat(store): 字幕编辑 CRUD actions"
```

---

## Task 11: Timeline Store replaceClipWithTTS Action

**Files:**
- Modify: `src/store/timeline.ts`
- Test: `tests/timeline-clip-replace.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/timeline-clip-replace.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import type { AudioClip, TTSAsset, TimelineData, SrtEntry } from '../src/types';

const baseTimeline: TimelineData = {
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  podcast: { audioPath: '/a.mp3', srtPath: '/a.srt', durationMs: 10000 },
  tracks: [],
  overlays: [],
  subtitle: {
    fontSize: 32, color: '#fff', position: 'bottom',
    highlightEnabled: false,
    highlightBackgroundColor: '#000', highlightTextColor: '#fff',
    highlightPaddingX: 4, highlightPaddingY: 2, highlightRadius: 4,
    highlightAnimation: 'none',
  },
};

const initialClips: AudioClip[] = [
  { id: 'c1', source: { kind: 'origin', startMs: 0, endMs: 2000 }, timelineStartMs: 0, durationMs: 2000, linkedSubtitleIndexes: [1] },
  { id: 'c2', source: { kind: 'origin', startMs: 2000, endMs: 5000 }, timelineStartMs: 2000, durationMs: 3000, linkedSubtitleIndexes: [2] },
  { id: 'c3', source: { kind: 'origin', startMs: 5000, endMs: 8000 }, timelineStartMs: 5000, durationMs: 3000, linkedSubtitleIndexes: [3] },
];

const ttsAsset: TTSAsset = {
  id: 'a1',
  filePath: '/tts/a1.mp3',
  text: '替换文本',
  durationMs: 4000, // 比原 c2 的 3000 长 1000
  voicePresetId: 'vp1',
  voicePresetSnapshot: {
    id: 'vp1', name: 'x', provider: 'minimax', voiceId: 'v',
    params: { speed: 1 }, voiceSource: 'system', createdAt: 0, updatedAt: 0,
  },
  wordTimestamps: [
    { text: '替', startMs: 0, endMs: 1000 },
    { text: '换', startMs: 1000, endMs: 2000 },
    { text: '，', startMs: 2000, endMs: 2500 },
    { text: '文', startMs: 2500, endMs: 3200 },
    { text: '本', startMs: 3200, endMs: 4000 },
  ],
  createdAt: 0,
};

const initialSubs: SrtEntry[] = [
  { index: 1, startMs: 0, endMs: 2000, text: '一' },
  { index: 2, startMs: 2000, endMs: 5000, text: '二' },
  { index: 3, startMs: 5000, endMs: 8000, text: '三' },
];

beforeEach(() => {
  useTimelineStore.getState().setTimeline(baseTimeline);
  useTimelineStore.getState().setSrtEntries(initialSubs);
  useTimelineStore.setState({
    audioClips: initialClips,
    ttsAssets: [ttsAsset],
    editedSubtitles: initialSubs,
  });
});

describe('replaceClipWithTTS', () => {
  it('替换目标 Clip 的 source 为 tts', () => {
    useTimelineStore.getState().replaceClipWithTTS('c2', 'a1');
    const c2 = useTimelineStore.getState().audioClips.find((c) => c.id === 'c2')!;
    expect(c2.source).toEqual({ kind: 'tts', assetId: 'a1' });
    expect(c2.durationMs).toBe(4000);
  });

  it('后续 Clip 按时长差顺延', () => {
    useTimelineStore.getState().replaceClipWithTTS('c2', 'a1');
    const c3 = useTimelineStore.getState().audioClips.find((c) => c.id === 'c3')!;
    expect(c3.timelineStartMs).toBe(6000); // 原 5000 + 1000
  });

  it('替换 Clip 之前的 Clip 保持不变', () => {
    useTimelineStore.getState().replaceClipWithTTS('c2', 'a1');
    const c1 = useTimelineStore.getState().audioClips.find((c) => c.id === 'c1')!;
    expect(c1.timelineStartMs).toBe(0);
  });

  it('删除旧 Clip 时间范围内的字幕,按 wordTimestamps 重建新字幕', () => {
    useTimelineStore.getState().replaceClipWithTTS('c2', 'a1');
    const subs = useTimelineStore.getState().editedSubtitles!;
    // 原 '二' (2000-5000) 被删,新字幕按 wordTimestamps 生成(offset=2000)
    expect(subs.find((s) => s.text === '二')).toBeUndefined();
    const newSubs = subs.filter((s) => s.startMs >= 2000 && s.startMs < 6000);
    expect(newSubs.length).toBeGreaterThanOrEqual(1);
    expect(newSubs[0].startMs).toBeGreaterThanOrEqual(2000);
  });

  it('后续字幕 startMs 不偏移(脱钩原则)', () => {
    useTimelineStore.getState().replaceClipWithTTS('c2', 'a1');
    const subs = useTimelineStore.getState().editedSubtitles!;
    const third = subs.find((s) => s.text === '三')!;
    expect(third.startMs).toBe(5000); // 原位置不变
  });

  it('替换 Clip 时长相同时后续 Clip 不移动', () => {
    useTimelineStore.setState({
      ttsAssets: [{ ...ttsAsset, durationMs: 3000 }],
    });
    useTimelineStore.getState().replaceClipWithTTS('c2', 'a1');
    const c3 = useTimelineStore.getState().audioClips.find((c) => c.id === 'c3')!;
    expect(c3.timelineStartMs).toBe(5000);
  });

  it('无 wordTimestamps 时退化为整段一条字幕', () => {
    useTimelineStore.setState({
      ttsAssets: [{ ...ttsAsset, wordTimestamps: undefined }],
    });
    useTimelineStore.getState().replaceClipWithTTS('c2', 'a1');
    const subs = useTimelineStore.getState().editedSubtitles!;
    const fallback = subs.find((s) => s.text === '替换文本');
    expect(fallback).toBeDefined();
    expect(fallback!.startMs).toBe(2000);
    expect(fallback!.endMs).toBe(6000);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/timeline-clip-replace.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 interface 中追加 replaceClipWithTTS 签名**

```ts
replaceClipWithTTS: (clipId: string, ttsAssetId: string) => void;
```

- [ ] **Step 4: 实现 replaceClipWithTTS action**

在 store 内追加：

```ts
replaceClipWithTTS: (clipId, ttsAssetId) => {
  set((state) => {
    const clipIndex = state.audioClips.findIndex((c) => c.id === clipId);
    if (clipIndex < 0) return state;
    const asset = state.ttsAssets.find((a) => a.id === ttsAssetId);
    if (!asset) return state;

    const oldClip = state.audioClips[clipIndex];
    const oldDuration = oldClip.durationMs;
    const newDuration = asset.durationMs;
    const delta = newDuration - oldDuration;

    const newClip: AudioClip = {
      ...oldClip,
      source: { kind: 'tts', assetId: ttsAssetId },
      durationMs: newDuration,
    };

    const newAudioClips = state.audioClips.map((c, i) => {
      if (i === clipIndex) return newClip;
      if (i > clipIndex) return { ...c, timelineStartMs: c.timelineStartMs + delta };
      return c;
    });

    const oldRangeStart = oldClip.timelineStartMs;
    const oldRangeEnd = oldClip.timelineStartMs + oldClip.durationMs;
    const newRangeStart = oldClip.timelineStartMs;
    const newRangeEnd = oldClip.timelineStartMs + newDuration;

    const sourceSubs = state.editedSubtitles ?? state.srtEntries;
    let nextSubtitles = sourceSubs.filter(
      (s) => s.endMs <= oldRangeStart || s.startMs >= oldRangeEnd
    );

    if (asset.wordTimestamps && asset.wordTimestamps.length > 0) {
      const generated = buildSubtitlesFromWordTimestamps(asset.wordTimestamps, newRangeStart);
      nextSubtitles = [...nextSubtitles, ...generated];
    } else {
      nextSubtitles = [
        ...nextSubtitles,
        { index: -1, startMs: newRangeStart, endMs: newRangeEnd, text: asset.text },
      ];
    }

    nextSubtitles = nextSubtitles
      .sort((a, b) => a.startMs - b.startMs)
      .map((s, i) => ({ ...s, index: i + 1 }));

    return {
      audioClips: newAudioClips,
      editedSubtitles: nextSubtitles,
    };
  });
},
```

在 src/store/timeline.ts 顶部导入：
```ts
import { buildSubtitlesFromWordTimestamps } from '../lib/subtitle-builder';
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/timeline-clip-replace.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/store/timeline.ts tests/timeline-clip-replace.test.ts
git commit -m "feat(store): replaceClipWithTTS 替换 Clip 并回写字幕"
```

---

## Task 12: Timeline Store 惰性初始化 audioClips

**Files:**
- Modify: `src/store/timeline.ts`

- [ ] **Step 1: 追加 ensureAudioClipsInitialized action**

在 interface 追加：
```ts
ensureAudioClipsInitialized: () => void;
```

实现：
```ts
ensureAudioClipsInitialized: () => {
  const state = get();
  if (state.audioClips.length > 0) return;
  if (state.srtEntries.length === 0) return;
  const clips = initAudioClipsFromSubtitles(
    state.srtEntries,
    state.timeline.podcast.durationMs
  );
  set({ audioClips: clips });
},
```

在文件顶部导入：
```ts
import { initAudioClipsFromSubtitles } from '../lib/clip-init';
```

- [ ] **Step 2: 运行类型检查**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 运行所有 store 测试确认没有回归**

Run: `npx vitest run tests/timeline.test.tsx tests/timeline-store-lock.test.ts tests/timeline-subtitle-edit.test.ts tests/timeline-clip-replace.test.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/store/timeline.ts
git commit -m "feat(store): 惰性初始化 audioClips"
```

---

# Phase 4 · 服务层

## Task 13: TTS 生成高层封装 tts-service

**Files:**
- Create: `src/lib/tts-service.ts`
- Test: `tests/tts-asset-lifecycle.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/tts-asset-lifecycle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateTTSAsset } from '../src/lib/tts-service';
import type { VoicePreset } from '../src/types';

const mockApi = {
  generateTTS: vi.fn(),
};

// @ts-expect-error 注入
globalThis.window = { electronAPI: mockApi };

const preset: VoicePreset = {
  id: 'vp1',
  name: '主播',
  provider: 'minimax',
  voiceId: 'male-qn-qingse',
  params: { speed: 1, vol: 1, pitch: 0, emotion: 'neutral' },
  voiceSource: 'system',
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(() => {
  mockApi.generateTTS.mockReset();
});

describe('generateTTSAsset', () => {
  it('调用 IPC 并返回包含快照的 TTSAsset', async () => {
    mockApi.generateTTS.mockResolvedValue({
      audioPath: '/p/tts/x.mp3',
      srtPath: '/p/tts/x.srt',
      durationMs: 4200,
      wordTimestamps: [
        { text: '你', startMs: 0, endMs: 100 },
        { text: '好', startMs: 100, endMs: 200 },
      ],
    });

    const asset = await generateTTSAsset({
      text: '你好',
      voicePreset: preset,
      projectDir: '/p',
      apiKey: 'key',
    });

    expect(asset.filePath).toBe('/p/tts/x.mp3');
    expect(asset.durationMs).toBe(4200);
    expect(asset.voicePresetSnapshot).toEqual(preset);
    expect(asset.wordTimestamps).toHaveLength(2);
    expect(asset.id).toMatch(/^tts-/);
  });

  it('merges voiceOverrides with preset params', async () => {
    mockApi.generateTTS.mockResolvedValue({
      audioPath: '/p/tts/x.mp3',
      srtPath: '/p/tts/x.srt',
      durationMs: 1000,
      wordTimestamps: [],
    });

    await generateTTSAsset({
      text: 't',
      voicePreset: preset,
      overrides: { speed: 1.5, emotion: 'happy' },
      projectDir: '/p',
      apiKey: 'key',
    });

    const callArgs = mockApi.generateTTS.mock.calls[0][0];
    expect(callArgs.speed).toBe(1.5);
    expect(callArgs.emotion).toBe('happy');
    expect(callArgs.voiceId).toBe('male-qn-qingse');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/tts-asset-lifecycle.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 tts-service**

```ts
// src/lib/tts-service.ts
import type { TTSAsset, VoicePreset, VoiceParams, WordTimestamp } from '../types';

function generateAssetId(): string {
  return `tts-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateRequestId(): string {
  return `tts-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface GenerateTTSAssetParams {
  text: string;
  voicePreset: VoicePreset;
  overrides?: Partial<VoiceParams>;
  projectDir: string;
  apiKey: string;
  model?: string;
}

/**
 * 生成 TTS 素材:合并预设参数、调用主进程 IPC、构造 TTSAsset。
 * 失败时直接抛出,由调用方处理 toast 与 task-progress。
 */
export async function generateTTSAsset(
  params: GenerateTTSAssetParams
): Promise<TTSAsset> {
  const { text, voicePreset, overrides, projectDir, apiKey } = params;
  const merged: VoiceParams = {
    speed: overrides?.speed ?? voicePreset.params.speed ?? 1.0,
    vol: overrides?.vol ?? voicePreset.params.vol ?? 1.0,
    pitch: overrides?.pitch ?? voicePreset.params.pitch ?? 0,
    emotion: overrides?.emotion ?? voicePreset.params.emotion ?? 'neutral',
  };

  const response = await window.electronAPI.generateTTS({
    requestId: generateRequestId(),
    text,
    voiceId: voicePreset.voiceId,
    speed: merged.speed,
    vol: merged.vol ?? 1.0,
    pitch: merged.pitch ?? 0,
    emotion: merged.emotion ?? 'neutral',
    model: params.model ?? 'speech-01-hd',
    apiKey,
    projectDir,
  });

  const asset: TTSAsset = {
    id: generateAssetId(),
    filePath: response.audioPath,
    text,
    durationMs: response.durationMs,
    voicePresetId: voicePreset.id,
    voicePresetSnapshot: { ...voicePreset },
    voiceOverrides: overrides,
    wordTimestamps: response.wordTimestamps as WordTimestamp[] | undefined,
    createdAt: Date.now(),
    voiceSource: voicePreset.voiceSource,
  };

  return asset;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/tts-asset-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/tts-service.ts tests/tts-asset-lifecycle.test.ts
git commit -m "feat(tts): 新增 generateTTSAsset 高层封装"
```

---

# Phase 5 · Remotion 与波形渲染

## Task 14: PodcastComposition 多 Clip 合成

**Files:**
- Modify: `src/remotion/PodcastComposition.tsx`

- [ ] **Step 1: 打开文件理解现状**

Read file: `/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/remotion/PodcastComposition.tsx`

确认：
- 接收 props `{ timeline, srtEntries, renderConfig }`
- 当前 Audio 渲染方式为单一 `<Audio src={resolveRemotionAssetSrc(timeline.podcast.audioPath)} />`

- [ ] **Step 2: 提取音频渲染为子组件 PodcastAudio**

在 `src/remotion/PodcastComposition.tsx` 顶部追加导入：
```ts
import { Audio, Sequence } from 'remotion';
import type { AudioClip, TTSAsset, TimelineData } from '../types';
import { resolveRemotionAssetSrc } from '../lib/remotion-assets';
```

在文件内新增（或修改现有 Audio 使用处）一个子组件：

```tsx
interface PodcastAudioProps {
  timeline: TimelineData;
  fps: number;
}

function msToFrame(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

function PodcastAudio({ timeline, fps }: PodcastAudioProps) {
  const audioClips = timeline.audioClips ?? [];
  const ttsAssets = timeline.ttsAssets ?? [];

  // 向后兼容:无 audioClips 走旧路径
  if (audioClips.length === 0) {
    if (!timeline.podcast.audioPath) return null;
    return <Audio src={resolveRemotionAssetSrc(timeline.podcast.audioPath)} />;
  }

  return (
    <>
      {audioClips.map((clip) => {
        if (clip.muted) return null;
        const startFrame = msToFrame(clip.timelineStartMs, fps);
        const durationFrames = msToFrame(clip.durationMs, fps);
        if (durationFrames <= 0) return null;

        if (clip.source.kind === 'origin') {
          return (
            <Sequence
              key={clip.id}
              from={startFrame}
              durationInFrames={durationFrames}
              layout="none"
            >
              <Audio
                src={resolveRemotionAssetSrc(timeline.podcast.audioPath)}
                trimBefore={msToFrame(clip.source.startMs, fps)}
                trimAfter={msToFrame(clip.source.endMs, fps)}
              />
            </Sequence>
          );
        }

        const asset = ttsAssets.find((a) => a.id === clip.source.assetId);
        if (!asset) return null;
        return (
          <Sequence
            key={clip.id}
            from={startFrame}
            durationInFrames={durationFrames}
            layout="none"
          >
            <Audio src={resolveRemotionAssetSrc(asset.filePath)} />
          </Sequence>
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: 在 PodcastComposition 中替换原 Audio 使用**

将原来的：
```tsx
{timeline.podcast.audioPath ? <Audio src={resolveRemotionAssetSrc(timeline.podcast.audioPath)} /> : null}
```

改为：
```tsx
<PodcastAudio timeline={timeline} fps={timeline.fps} />
```

- [ ] **Step 4: 运行类型检查**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: 运行 remotion-assets 相关测试**

Run: `npx vitest run tests/remotion-assets.test.ts tests/preview-panel.test.tsx`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/remotion/PodcastComposition.tsx
git commit -m "feat(remotion): PodcastComposition 支持多 Clip 音频合成"
```

---

## Task 15: TimelineClipWaveform 组件

**Files:**
- Create: `src/components/TimelineClipWaveform.tsx`

- [ ] **Step 1: 创建波形切片组件**

```tsx
// src/components/TimelineClipWaveform.tsx
import { useEffect, useMemo, useState } from 'react';
import { toFileSrc } from '../lib/utils';
import type { AudioClip, TTSAsset } from '../types';
import styles from './TimelineAudioWaveform.module.css';

interface TimelineClipWaveformProps {
  clip: AudioClip;
  originAudioPath: string;
  originDurationMs: number;
  ttsAssets: TTSAsset[];
  clipWidth: number;
  clipHeight: number;
}

const waveformPeakCache = new Map<string, Promise<number[]>>();

async function loadPeaksForPath(
  audioPath: string,
  durationMs: number
): Promise<number[]> {
  const cacheKey = `${audioPath}:${durationMs}`;
  const cached = waveformPeakCache.get(cacheKey);
  if (cached) return cached;

  const pending = (async () => {
    const { default: WaveSurfer } = await import('wavesurfer.js');
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-99999px';
    document.body.appendChild(host);

    const ws = WaveSurfer.create({
      container: host,
      width: 1,
      height: 1,
      waveColor: '#0ea5e9',
      progressColor: '#0ea5e9',
      cursorWidth: 0,
      interact: false,
      hideScrollbar: true,
      backend: 'WebAudio',
      sampleRate: 8_000,
    });

    try {
      await ws.load(toFileSrc(audioPath));
      const resolution = Math.max(240, Math.min(4_000, Math.round(durationMs / 20)));
      const channels = ws.exportPeaks({ maxLength: resolution });
      const maxLen = Math.max(...channels.map((c) => c.length));
      return Array.from({ length: maxLen }, (_, i) =>
        channels.reduce((peak, ch) => Math.max(peak, Math.abs(ch[i] ?? 0)), 0)
      );
    } finally {
      ws.destroy();
      host.remove();
    }
  })().catch((err) => {
    waveformPeakCache.delete(cacheKey);
    throw err;
  });

  waveformPeakCache.set(cacheKey, pending);
  return pending;
}

function sliceClipPeaks(
  fullPeaks: number[],
  sourceDurationMs: number,
  clipSourceStartMs: number,
  clipSourceEndMs: number
): number[] {
  if (fullPeaks.length === 0 || sourceDurationMs <= 0) return [];
  const ratio = fullPeaks.length / sourceDurationMs;
  const start = Math.max(0, Math.floor(clipSourceStartMs * ratio));
  const end = Math.min(fullPeaks.length, Math.ceil(clipSourceEndMs * ratio));
  return fullPeaks.slice(start, end);
}

function sampleToWidth(peaks: number[], targetLength: number): number[] {
  if (peaks.length === 0 || targetLength <= 0) return [];
  if (peaks.length <= targetLength) return peaks;
  const bucketSize = peaks.length / targetLength;
  return Array.from({ length: targetLength }, (_, i) => {
    const s = Math.floor(i * bucketSize);
    const e = Math.min(peaks.length, Math.ceil((i + 1) * bucketSize));
    let peak = 0;
    for (let j = s; j < e; j += 1) peak = Math.max(peak, peaks[j] ?? 0);
    return peak;
  });
}

export function TimelineClipWaveform({
  clip,
  originAudioPath,
  originDurationMs,
  ttsAssets,
  clipWidth,
  clipHeight,
}: TimelineClipWaveformProps) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof window === 'undefined') return;

    const load = async () => {
      try {
        if (clip.source.kind === 'origin') {
          const full = await loadPeaksForPath(originAudioPath, originDurationMs);
          if (cancelled) return;
          setPeaks(
            sliceClipPeaks(
              full,
              originDurationMs,
              clip.source.startMs,
              clip.source.endMs
            )
          );
        } else {
          const asset = ttsAssets.find((a) => a.id === clip.source.assetId);
          if (!asset) {
            setPeaks([]);
            return;
          }
          const full = await loadPeaksForPath(asset.filePath, asset.durationMs);
          if (!cancelled) setPeaks(full);
        }
      } catch (err) {
        console.error('加载 Clip 波形失败:', err);
        if (!cancelled) setPeaks([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [clip, originAudioPath, originDurationMs, ttsAssets]);

  const barCount = Math.min(2_400, Math.max(16, Math.floor(clipWidth / 3)));
  const sampled = useMemo(() => sampleToWidth(peaks ?? [], barCount), [peaks, barCount]);
  const maxBarHeight = Math.max(6, clipHeight - 8);

  if (!peaks || sampled.length === 0) {
    return <div className={[styles.shell, styles.loadingShell].join(' ')}><div className={styles.loadingLine} /></div>;
  }

  return (
    <div className={[styles.shell, styles.peaksShell].join(' ')}>
      {sampled.map((p, i) => (
        <span
          key={i}
          className={styles.peak}
          style={{ height: `${Math.max(2, Math.round(p * maxBarHeight))}px` }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 运行类型检查**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/components/TimelineClipWaveform.tsx
git commit -m "feat(timeline): 新增 Clip 级波形渲染组件"
```

---

# Phase 6 · 字幕编辑 UI

## Task 16: EditorInspector 新增 Tab 容器

**Files:**
- Modify: `src/components/EditorInspector.tsx`
- Modify: `src/components/EditorInspector.module.css`（如不存在则创建）

- [ ] **Step 1: 阅读当前 EditorInspector 结构**

Read: `/Users/yoqu/Documents/code/self/self-boke/video-web-master/src/components/EditorInspector.tsx`

找出 return 语句的主容器位置（例如 `return <div className={styles.inspector}>...`）。

- [ ] **Step 2: 在 EditorInspector 顶部新增 Tab 状态**

在函数组件体内最上方追加：

```tsx
type InspectorTab = 'details' | 'subtitles';
const [activeTab, setActiveTab] = useState<InspectorTab>('details');
```

导入 `useState`（如未导入）。

- [ ] **Step 3: 在 return 主容器内,最顶部插入 Tab 切换栏**

在 return 的最外层容器内部最顶部追加：

```tsx
<div className={styles.tabBar} role="tablist">
  <button
    type="button"
    role="tab"
    aria-selected={activeTab === 'details'}
    className={[styles.tabButton, activeTab === 'details' && styles.tabButtonActive].filter(Boolean).join(' ')}
    onClick={() => setActiveTab('details')}
  >
    属性
  </button>
  <button
    type="button"
    role="tab"
    aria-selected={activeTab === 'subtitles'}
    className={[styles.tabButton, activeTab === 'subtitles' && styles.tabButtonActive].filter(Boolean).join(' ')}
    onClick={() => setActiveTab('subtitles')}
  >
    字幕
  </button>
</div>

{activeTab === 'subtitles' ? (
  <SubtitleTabPanel />
) : (
  <>
    {/* 原有 selection-based 条件渲染保持不动 */}
  </>
)}
```

- [ ] **Step 4: 在 EditorInspector.module.css 追加 Tab 样式**

```css
.tabBar {
  display: flex;
  border-bottom: 1px solid var(--color-separator);
  padding: 0 12px;
  gap: 4px;
}

.tabButton {
  background: none;
  border: none;
  padding: 10px 14px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-md);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tabButton:hover {
  color: var(--color-text-primary);
}

.tabButtonActive {
  color: var(--color-system-blue);
  border-bottom-color: var(--color-system-blue);
}
```

- [ ] **Step 5: 引入 SubtitleTabPanel 占位**

在文件顶部导入：
```tsx
import { SubtitleTabPanel } from './SubtitleTabPanel';
```

SubtitleTabPanel 会在下一个 Task 实现。为了让类型检查通过,先在 Task 17 里实现 SubtitleTabPanel 再运行此 Task 的构建。

- [ ] **Step 6: 暂不提交,等 Task 17 完成后一起提交**

---

## Task 17: SubtitleTabPanel 基础骨架与列表渲染

**Files:**
- Create: `src/components/SubtitleTabPanel.tsx`
- Create: `src/components/SubtitleTabPanel.module.css`

- [ ] **Step 1: 创建骨架组件**

```tsx
// src/components/SubtitleTabPanel.tsx
import { useMemo, useState } from 'react';
import { useTimelineStore } from '../store/timeline';
import type { SrtEntry } from '../types';
import styles from './SubtitleTabPanel.module.css';

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hh = Math.floor(totalSec / 3600).toString().padStart(2, '0');
  const mm = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
  const ss = (totalSec % 60).toString().padStart(2, '0');
  const mmm = (ms % 1000).toString().padStart(3, '0');
  return `${hh}:${mm}:${ss},${mmm}`;
}

export function SubtitleTabPanel() {
  const srtEntries = useTimelineStore((s) => s.srtEntries);
  const editedSubtitles = useTimelineStore((s) => s.editedSubtitles);
  const selectedIndex = useTimelineStore((s) => s.selectedSubtitleIndex);
  const setSelectedIndex = useTimelineStore((s) => s.setSelectedSubtitleIndex);
  const [search, setSearch] = useState('');

  const subtitles: SrtEntry[] = editedSubtitles ?? srtEntries;
  const filtered = useMemo(() => {
    if (!search.trim()) return subtitles;
    const q = search.trim().toLowerCase();
    return subtitles.filter((s) => s.text.toLowerCase().includes(q));
  }, [subtitles, search]);

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="搜索字幕..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.list} data-testid="subtitle-list">
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            {subtitles.length === 0 ? '暂无字幕' : '未匹配到结果'}
          </div>
        ) : (
          filtered.map((entry) => (
            <SubtitleRow
              key={entry.index}
              entry={entry}
              selected={entry.index === selectedIndex}
              onSelect={() => setSelectedIndex(entry.index)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface SubtitleRowProps {
  entry: SrtEntry;
  selected: boolean;
  onSelect: () => void;
}

function SubtitleRow({ entry, selected, onSelect }: SubtitleRowProps) {
  return (
    <div
      className={[styles.row, selected && styles.rowSelected].filter(Boolean).join(' ')}
      onClick={onSelect}
      role="button"
      tabIndex={0}
    >
      <div className={styles.rowHeader}>
        <span className={styles.rowIndex}>#{entry.index.toString().padStart(3, '0')}</span>
        <span className={styles.rowTime}>
          {formatTime(entry.startMs)} → {formatTime(entry.endMs)}
        </span>
      </div>
      <div className={styles.rowText}>{entry.text}</div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 CSS Module**

```css
/* src/components/SubtitleTabPanel.module.css */
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.toolbar {
  padding: 8px 12px;
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--color-separator);
}

.searchInput {
  flex: 1;
  background: var(--color-panel-elevated);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
}

.searchInput:focus {
  outline: 2px solid var(--color-system-blue);
  outline-offset: -1px;
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-separator);
  cursor: pointer;
  transition: background 0.15s;
}

.row:hover {
  background: var(--color-panel-elevated);
}

.rowSelected {
  background: rgba(10, 132, 255, 0.1);
}

.rowHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.rowIndex {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.rowTime {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.rowText {
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
  line-height: 1.5;
  word-break: break-word;
}

.empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
```

- [ ] **Step 3: 运行类型检查与构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: 提交（合并 Task 16 + 17）**

```bash
git add src/components/EditorInspector.tsx src/components/EditorInspector.module.css src/components/SubtitleTabPanel.tsx src/components/SubtitleTabPanel.module.css
git commit -m "feat(inspector): 新增字幕 Tab 容器与列表骨架"
```

---

## Task 18: SubtitleTabPanel 内联编辑与删除

**Files:**
- Modify: `src/components/SubtitleTabPanel.tsx`
- Modify: `src/components/SubtitleTabPanel.module.css`

- [ ] **Step 1: 升级 SubtitleRow 支持编辑态**

替换 `SubtitleRow` 组件为：

```tsx
interface SubtitleRowProps {
  entry: SrtEntry;
  selected: boolean;
  onSelect: () => void;
}

function SubtitleRow({ entry, selected, onSelect }: SubtitleRowProps) {
  const updateSubtitle = useTimelineStore((s) => s.updateSubtitle);
  const deleteSubtitle = useTimelineStore((s) => s.deleteSubtitle);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(entry.text);

  const commit = () => {
    const trimmed = draftText.trim();
    if (trimmed && trimmed !== entry.text) {
      updateSubtitle(entry.index, { text: trimmed });
    }
    setEditing(false);
  };

  return (
    <div
      className={[styles.row, selected && styles.rowSelected].filter(Boolean).join(' ')}
      onClick={() => {
        onSelect();
        if (!editing) {
          setDraftText(entry.text);
          setEditing(true);
        }
      }}
    >
      <div className={styles.rowHeader}>
        <span className={styles.rowIndex}>#{entry.index.toString().padStart(3, '0')}</span>
        <span className={styles.rowTime}>
          {formatTime(entry.startMs)} → {formatTime(entry.endMs)}
        </span>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`删除字幕 #${entry.index}?`)) {
              deleteSubtitle(entry.index);
            }
          }}
          aria-label="删除字幕"
        >
          🗑
        </button>
      </div>
      {editing ? (
        <textarea
          className={styles.editInput}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              setDraftText(entry.text);
              setEditing(false);
            }
          }}
          autoFocus
          rows={2}
        />
      ) : (
        <div className={styles.rowText}>{entry.text}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 在 CSS 追加按钮与编辑输入样式**

```css
.deleteButton {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-md);
  margin-left: auto;
}

.deleteButton:hover {
  background: var(--color-danger);
  color: #fff;
}

.editInput {
  width: 100%;
  background: var(--color-panel-elevated);
  border: 1px solid var(--color-system-blue);
  border-radius: var(--radius-md);
  padding: 6px 8px;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-family: inherit;
  line-height: 1.5;
  resize: vertical;
}

.editInput:focus {
  outline: none;
}
```

注意 `.rowHeader` 需要调整为 `justify-content: flex-start; gap: 8px;` 以便删除按钮用 margin-left:auto 靠右。更新它：

```css
.rowHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
```

- [ ] **Step 3: 运行构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/components/SubtitleTabPanel.tsx src/components/SubtitleTabPanel.module.css
git commit -m "feat(subtitle-tab): 内联编辑与删除"
```

---

## Task 19: SubtitleTabPanel 新增、查找替换与双向联动

**Files:**
- Modify: `src/components/SubtitleTabPanel.tsx`
- Modify: `src/components/SubtitleTabPanel.module.css`

- [ ] **Step 1: 顶部工具栏增加「+新增」和查找替换入口**

在 `SubtitleTabPanel` 函数体内增加状态：

```tsx
const insertSubtitle = useTimelineStore((s) => s.insertSubtitle);
const replaceAllSubtitles = useTimelineStore((s) => s.replaceAllSubtitles);
const [replaceMode, setReplaceMode] = useState(false);
const [replaceText, setReplaceText] = useState('');

const handleInsert = () => {
  const now = subtitles.length === 0 ? 0 : subtitles[subtitles.length - 1].endMs;
  insertSubtitle(subtitles.length, {
    startMs: now,
    endMs: now + 2000,
    text: '新字幕',
  });
};

const handleReplaceAll = () => {
  if (!search.trim()) return;
  const count = replaceAllSubtitles(search, replaceText);
  window.alert(`已替换 ${count} 处`);
};
```

替换 toolbar 部分为：

```tsx
<div className={styles.toolbar}>
  <input
    type="text"
    className={styles.searchInput}
    placeholder="搜索字幕..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
  />
  <button
    type="button"
    className={styles.toolbarButton}
    onClick={() => setReplaceMode((v) => !v)}
    aria-label="查找替换"
  >
    替换
  </button>
  <button
    type="button"
    className={styles.toolbarButton}
    onClick={handleInsert}
    aria-label="新增字幕"
  >
    + 新增
  </button>
</div>
{replaceMode && (
  <div className={styles.replaceBar}>
    <input
      type="text"
      className={styles.searchInput}
      placeholder="替换为..."
      value={replaceText}
      onChange={(e) => setReplaceText(e.target.value)}
    />
    <button
      type="button"
      className={styles.toolbarButton}
      onClick={handleReplaceAll}
      disabled={!search.trim()}
    >
      全部替换
    </button>
  </div>
)}
```

- [ ] **Step 2: 自动定位滚动**

在 `SubtitleTabPanel` 函数体内追加：

```tsx
const listRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  if (selectedIndex == null) return;
  const el = listRef.current?.querySelector(`[data-subtitle-index="${selectedIndex}"]`);
  if (el && 'scrollIntoView' in el) {
    (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}, [selectedIndex]);
```

在 list 容器上挂 ref：

```tsx
<div ref={listRef} className={styles.list} data-testid="subtitle-list">
```

在 SubtitleRow 外层 div 上加 `data-subtitle-index={entry.index}`。

导入 `useEffect` 和 `useRef`。

- [ ] **Step 3: 在 CSS 追加 toolbar 按钮与 replaceBar 样式**

```css
.toolbarButton {
  background: var(--color-panel-elevated);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.toolbarButton:hover {
  background: var(--color-system-blue);
  color: #fff;
  border-color: var(--color-system-blue);
}

.toolbarButton:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.replaceBar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-separator);
  background: var(--color-panel-elevated);
}
```

- [ ] **Step 4: 运行构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/SubtitleTabPanel.tsx src/components/SubtitleTabPanel.module.css
git commit -m "feat(subtitle-tab): 新增/查找替换/自动定位"
```

---

# Phase 7 · TTS 素材 UI

## Task 20: AssetPanel 音频分类增加 TTS 区

**Files:**
- Modify: `src/components/AssetPanel.tsx`
- Create: `src/components/TTSAssetCard.tsx`

- [ ] **Step 1: 创建 TTSAssetCard 组件**

```tsx
// src/components/TTSAssetCard.tsx
import type { TTSAsset } from '../types';
import styles from './TTSAssetCard.module.css';

interface TTSAssetCardProps {
  asset: TTSAsset;
  onDragStart?: (asset: TTSAsset) => void;
}

export function TTSAssetCard({ asset, onDragStart }: TTSAssetCardProps) {
  const previewText = asset.text.length > 20 ? asset.text.slice(0, 20) + '…' : asset.text;
  const durationSec = (asset.durationMs / 1000).toFixed(1);

  return (
    <div
      className={styles.card}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-tts-asset-id', asset.id);
        e.dataTransfer.effectAllowed = 'copy';
        onDragStart?.(asset);
      }}
      title={asset.text}
    >
      <div className={styles.header}>
        <span className={styles.duration}>{durationSec}s</span>
      </div>
      <div className={styles.text}>{previewText}</div>
      <div className={styles.voice}>{asset.voicePresetSnapshot.name}</div>
    </div>
  );
}
```

- [ ] **Step 2: 创建对应 CSS Module**

```css
/* src/components/TTSAssetCard.module.css */
.card {
  width: 88px;
  background: var(--color-panel-elevated);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-md);
  padding: 8px;
  cursor: grab;
  transition: border-color 0.15s;
}

.card:hover {
  border-color: var(--color-system-blue);
}

.card:active {
  cursor: grabbing;
}

.header {
  display: flex;
  justify-content: flex-end;
}

.duration {
  font-size: var(--font-size-xs);
  color: var(--color-system-blue);
  font-variant-numeric: tabular-nums;
}

.text {
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  margin: 4px 0;
  line-height: 1.3;
  min-height: 28px;
  word-break: break-word;
}

.voice {
  font-size: 10px;
  color: var(--color-text-secondary);
  border-top: 1px solid var(--color-separator);
  padding-top: 4px;
}
```

- [ ] **Step 3: 在 AssetPanel 顶部音频分类插入 TTS 区**

阅读 `src/components/AssetPanel.tsx`，找到音频分类渲染位置。在过滤后的 AssetItem 列表**前**插入一个条件渲染的 TTS 区块：

```tsx
import { useTimelineStore } from '../store/timeline';
import { TTSAssetCard } from './TTSAssetCard';
import { NewTTSDialog } from './NewTTSDialog'; // Task 21

// 在组件顶层
const ttsAssets = useTimelineStore((s) => s.ttsAssets);
const [newTTSOpen, setNewTTSOpen] = useState(false);
const showTTSSection = filter === 'audio' || filter === 'all';

// 在列表渲染之前追加
{showTTSSection && (
  <section className={styles.ttsSection}>
    <header className={styles.ttsHeader}>
      <span className={styles.ttsTitle}>🎤 TTS 生成</span>
      <button
        type="button"
        className={styles.newTtsButton}
        onClick={() => setNewTTSOpen(true)}
      >
        + 新建 TTS 音频
      </button>
    </header>
    {ttsAssets.length > 0 && (
      <>
        <div className={styles.ttsLabel}>🗂 最近生成</div>
        <div className={styles.ttsGrid}>
          {ttsAssets.slice(0, 12).map((a) => (
            <TTSAssetCard key={a.id} asset={a} />
          ))}
        </div>
      </>
    )}
  </section>
)}

<NewTTSDialog open={newTTSOpen} onClose={() => setNewTTSOpen(false)} />
```

在 AssetPanel 对应的 CSS 追加：

```css
.ttsSection {
  border-bottom: 1px solid var(--color-separator);
  padding: 12px;
}

.ttsHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.ttsTitle {
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
  font-weight: 600;
}

.newTtsButton {
  background: var(--color-system-blue);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  padding: 5px 10px;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.newTtsButton:hover {
  filter: brightness(1.1);
}

.ttsLabel {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.ttsGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
}
```

- [ ] **Step 4: 运行构建（NewTTSDialog 会暂时缺失,将在 Task 21 补充）**

这一 Task 先不运行 build，等 Task 21 完成后一起验证。

- [ ] **Step 5: 暂不提交，等 Task 21 完成后合并提交**

---

## Task 21: NewTTSDialog 组件

**Files:**
- Create: `src/components/NewTTSDialog.tsx`
- Create: `src/components/NewTTSDialog.module.css`

- [ ] **Step 1: 创建对话框组件**

```tsx
// src/components/NewTTSDialog.tsx
import { useEffect, useState } from 'react';
import { useTimelineStore } from '../store/timeline';
import { useVoicePresetsStore } from '../store/voice-presets';
import { useTaskProgressStore } from '../store/task-progress';
import { generateTTSAsset } from '../lib/tts-service';
import { DEFAULT_VOICE_PARAMS, MINIMAX_EMOTIONS } from '../lib/minimax-voices';
import type { VoiceParams } from '../types';
import styles from './NewTTSDialog.module.css';

interface NewTTSDialogProps {
  open: boolean;
  onClose: () => void;
  defaultText?: string;
  onGenerated?: (assetId: string) => void;
}

export function NewTTSDialog({ open, onClose, defaultText = '', onGenerated }: NewTTSDialogProps) {
  const presets = useVoicePresetsStore((s) => s.presets);
  const defaultPresetId = useVoicePresetsStore((s) => s.defaultPresetId);
  const loadPresets = useVoicePresetsStore((s) => s.load);
  const projectDir = useTimelineStore((s) => s.projectDir);
  const ttsAssets = useTimelineStore((s) => s.ttsAssets);
  const startTask = useTaskProgressStore((s) => s.startTask);
  const updateTask = useTaskProgressStore((s) => s.updateTask);
  const completeTask = useTaskProgressStore((s) => s.completeTask);
  const failTask = useTaskProgressStore((s) => s.failTask);

  const [text, setText] = useState(defaultText);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(defaultPresetId);
  const [overrides, setOverrides] = useState<Partial<VoiceParams>>({});
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (open) {
      void loadPresets();
      setText(defaultText);
      setSelectedPresetId(defaultPresetId ?? presets[0]?.id ?? null);
      setOverrides({});
    }
  }, [open, defaultText, defaultPresetId, loadPresets, presets]);

  if (!open) return null;

  const selectedPreset = presets.find((p) => p.id === selectedPresetId) ?? null;

  const handleGenerate = async () => {
    if (!selectedPreset) {
      window.alert('请先选择或创建音色预设');
      return;
    }
    if (!text.trim()) {
      window.alert('请输入文本内容');
      return;
    }
    if (!projectDir) {
      window.alert('未打开项目,无法生成 TTS');
      return;
    }

    setGenerating(true);
    const taskId = `tts-${Date.now()}`;
    startTask({
      id: taskId,
      category: 'tts',
      label: '生成 TTS 音频',
      mode: 'indeterminate',
      progress: 0,
      phase: '调用 MiniMax',
      level: 1,
      canCancel: false,
    });

    try {
      const apiKey = await getMinimaxApiKey();
      updateTask(taskId, { phase: '生成语音', progress: 0.3 });
      const asset = await generateTTSAsset({
        text: text.trim(),
        voicePreset: selectedPreset,
        overrides,
        projectDir,
        apiKey,
      });
      updateTask(taskId, { phase: '写入素材', progress: 0.8 });
      useTimelineStore.setState({ ttsAssets: [...ttsAssets, asset] });
      completeTask(taskId);
      onGenerated?.(asset.id);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failTask(taskId, msg);
      window.alert(`生成失败: ${msg}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>新建 TTS 音频</h2>

        <label className={styles.label}>文本内容</label>
        <textarea
          className={styles.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="输入要生成音频的文本..."
        />
        <div className={styles.hint}>字数: {text.length} / 建议 ≤ 500</div>

        <label className={styles.label}>音色预设</label>
        <select
          className={styles.select}
          value={selectedPresetId ?? ''}
          onChange={(e) => setSelectedPresetId(e.target.value || null)}
        >
          <option value="">-- 选择预设 --</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className={styles.params}>
          <div className={styles.paramRow}>
            <label>语速</label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={overrides.speed ?? selectedPreset?.params.speed ?? 1}
              onChange={(e) =>
                setOverrides((o) => ({ ...o, speed: Number(e.target.value) }))
              }
            />
            <span>{(overrides.speed ?? selectedPreset?.params.speed ?? 1).toFixed(1)}×</span>
          </div>
          <div className={styles.paramRow}>
            <label>情绪</label>
            <select
              value={overrides.emotion ?? selectedPreset?.params.emotion ?? 'neutral'}
              onChange={(e) =>
                setOverrides((o) => ({ ...o, emotion: e.target.value }))
              }
            >
              {MINIMAX_EMOTIONS.map((em) => (
                <option key={em.value} value={em.value}>
                  {em.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={onClose} disabled={generating}>
            取消
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? '生成中...' : '生成'}
          </button>
        </div>
      </div>
    </div>
  );
}

async function getMinimaxApiKey(): Promise<string> {
  const settings = await window.electronAPI.loadGlobalSettings();
  const key = (settings as { minimaxApiKey?: string })?.minimaxApiKey;
  if (!key) throw new Error('未配置 MiniMax API Key,请到设置页面填写');
  return key;
}
```

- [ ] **Step 2: 创建 CSS Module**

```css
/* src/components/NewTTSDialog.module.css */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal {
  width: 520px;
  max-width: 90vw;
  background: var(--color-panel-bg);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  border: 1px solid var(--color-separator);
}

.title {
  font-size: var(--font-size-xl);
  color: var(--color-text-primary);
  margin: 0 0 16px;
}

.label {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 12px 0 4px;
}

.textarea {
  width: 100%;
  background: var(--color-panel-elevated);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-md);
  resize: vertical;
}

.textarea:focus {
  outline: 2px solid var(--color-system-blue);
  outline-offset: -1px;
}

.hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.select {
  width: 100%;
  background: var(--color-panel-elevated);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
}

.params {
  margin: 12px 0;
  padding: 12px;
  background: var(--color-panel-elevated);
  border-radius: var(--radius-md);
}

.paramRow {
  display: grid;
  grid-template-columns: 80px 1fr 60px;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.paramRow label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.actions button {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-separator);
  background: var(--color-panel-elevated);
  color: var(--color-text-primary);
  cursor: pointer;
}

.actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary {
  background: var(--color-system-blue) !important;
  color: #fff !important;
  border-color: var(--color-system-blue) !important;
}
```

- [ ] **Step 3: 确认 timeline store 暴露 projectDir**

Grep: `projectDir` in `src/store/timeline.ts`
若 store 中没有 `projectDir` 字段，需要从其他 store 或 context 读取。查 `useTimelineStore` 和 `App.tsx` 中 `projectDir` 的来源。

如果 projectDir 在另一个 store / localStorage，替换 `useTimelineStore((s) => s.projectDir)` 为：

```tsx
const [projectDir] = useState(() => localStorage.getItem('podcast-editor-project-dir'));
```

- [ ] **Step 4: 运行构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: 提交（合并 Task 20 + 21）**

```bash
git add src/components/AssetPanel.tsx src/components/TTSAssetCard.tsx src/components/TTSAssetCard.module.css src/components/NewTTSDialog.tsx src/components/NewTTSDialog.module.css
git commit -m "feat(tts): 左侧素材区 TTS 区 + 新建 TTS 对话框"
```

---

## Task 22: VoicePresetManager 组件

**Files:**
- Create: `src/components/VoicePresetManager.tsx`
- Create: `src/components/VoicePresetManager.module.css`

- [ ] **Step 1: 创建管理器组件**

```tsx
// src/components/VoicePresetManager.tsx
import { useEffect, useState } from 'react';
import { useVoicePresetsStore } from '../store/voice-presets';
import { MINIMAX_SYSTEM_VOICES, MINIMAX_EMOTIONS, DEFAULT_VOICE_PARAMS } from '../lib/minimax-voices';
import type { VoicePreset, VoiceParams } from '../types';
import styles from './VoicePresetManager.module.css';

interface VoicePresetManagerProps {
  open: boolean;
  onClose: () => void;
}

export function VoicePresetManager({ open, onClose }: VoicePresetManagerProps) {
  const presets = useVoicePresetsStore((s) => s.presets);
  const defaultPresetId = useVoicePresetsStore((s) => s.defaultPresetId);
  const load = useVoicePresetsStore((s) => s.load);
  const create = useVoicePresetsStore((s) => s.create);
  const update = useVoicePresetsStore((s) => s.update);
  const remove = useVoicePresetsStore((s) => s.remove);
  const setDefault = useVoicePresetsStore((s) => s.setDefault);
  const [editing, setEditing] = useState<VoicePreset | null>(null);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const handleSave = async (draft: Omit<VoicePreset, 'createdAt' | 'updatedAt'> & { id?: string }) => {
    if (draft.id) {
      await update(draft.id, {
        name: draft.name,
        voiceId: draft.voiceId,
        params: draft.params,
      });
    } else {
      await create({
        name: draft.name,
        provider: 'minimax',
        voiceId: draft.voiceId,
        params: draft.params,
        voiceSource: 'system',
      });
    }
    setEditing(null);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>音色预设管理</h2>
          <button onClick={() => setEditing({
            id: '' as string,
            name: '新建预设',
            provider: 'minimax',
            voiceId: MINIMAX_SYSTEM_VOICES[0].voiceId,
            params: { ...DEFAULT_VOICE_PARAMS },
            voiceSource: 'system',
            createdAt: 0,
            updatedAt: 0,
          } as VoicePreset)}>
            + 新建预设
          </button>
        </div>

        <div className={styles.list}>
          {presets.length === 0 ? (
            <div className={styles.empty}>暂无预设,点击上方「新建」开始</div>
          ) : (
            presets.map((p) => (
              <div key={p.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowName}>
                    {p.name}
                    {p.id === defaultPresetId && <span className={styles.badge}>默认</span>}
                  </div>
                  <div className={styles.rowMeta}>
                    voice_id: {p.voiceId} · 语速 {p.params.speed} · 情绪 {p.params.emotion ?? 'neutral'}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <button onClick={() => setEditing(p)}>编辑</button>
                  {p.id !== defaultPresetId && (
                    <button onClick={() => setDefault(p.id)}>设为默认</button>
                  )}
                  <button
                    className={styles.danger}
                    onClick={() => {
                      if (window.confirm(`删除预设「${p.name}」?`)) {
                        void remove(p.id);
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {editing && (
          <PresetEditForm
            draft={editing}
            onCancel={() => setEditing(null)}
            onSave={handleSave}
          />
        )}

        <div className={styles.footer}>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

interface PresetEditFormProps {
  draft: VoicePreset;
  onCancel: () => void;
  onSave: (d: VoicePreset) => void;
}

function PresetEditForm({ draft, onCancel, onSave }: PresetEditFormProps) {
  const [name, setName] = useState(draft.name);
  const [voiceId, setVoiceId] = useState(draft.voiceId);
  const [params, setParams] = useState<VoiceParams>({ ...draft.params });

  return (
    <div className={styles.form}>
      <h3>{draft.id ? '编辑预设' : '新建预设'}</h3>
      <label>名称</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <label>MiniMax 音色</label>
      <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
        {MINIMAX_SYSTEM_VOICES.map((v) => (
          <option key={v.voiceId} value={v.voiceId}>
            {v.name} · {v.description}
          </option>
        ))}
      </select>
      <label>语速: {params.speed.toFixed(1)}×</label>
      <input
        type="range"
        min="0.5"
        max="2"
        step="0.1"
        value={params.speed}
        onChange={(e) => setParams((p) => ({ ...p, speed: Number(e.target.value) }))}
      />
      <label>情绪</label>
      <select
        value={params.emotion ?? 'neutral'}
        onChange={(e) => setParams((p) => ({ ...p, emotion: e.target.value }))}
      >
        {MINIMAX_EMOTIONS.map((em) => (
          <option key={em.value} value={em.value}>
            {em.label}
          </option>
        ))}
      </select>
      <div className={styles.formActions}>
        <button onClick={onCancel}>取消</button>
        <button
          className={styles.primary}
          onClick={() => onSave({ ...draft, name, voiceId, params })}
          disabled={!name.trim()}
        >
          保存
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建对应 CSS（简化）**

```css
/* src/components/VoicePresetManager.module.css */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal {
  width: 640px;
  max-width: 92vw;
  max-height: 80vh;
  background: var(--color-panel-bg);
  border-radius: var(--radius-lg);
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--color-separator);
  padding-bottom: 12px;
}

.header h2 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-xl);
}

.header button {
  background: var(--color-system-blue);
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}

.rowName {
  color: var(--color-text-primary);
  font-weight: 600;
}

.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: var(--font-size-xs);
  background: var(--color-system-blue);
  color: #fff;
  border-radius: var(--radius-pill);
}

.rowMeta {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.rowActions {
  display: flex;
  gap: 6px;
}

.rowActions button {
  padding: 4px 8px;
  font-size: var(--font-size-xs);
  border: 1px solid var(--color-separator);
  background: transparent;
  color: var(--color-text-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.danger {
  color: var(--color-danger) !important;
}

.form {
  padding: 16px;
  border-top: 1px solid var(--color-separator);
  background: var(--color-panel-elevated);
  border-radius: var(--radius-md);
}

.form label {
  display: block;
  margin: 8px 0 4px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.form input[type="text"],
.form input:not([type="range"]),
.form select {
  width: 100%;
  padding: 6px 10px;
  background: var(--color-panel-bg);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
}

.formActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.formActions button {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-separator);
  background: var(--color-panel-bg);
  color: var(--color-text-primary);
  cursor: pointer;
}

.primary {
  background: var(--color-system-blue) !important;
  color: #fff !important;
  border-color: var(--color-system-blue) !important;
}

.empty {
  padding: 40px;
  text-align: center;
  color: var(--color-text-secondary);
}

.footer {
  border-top: 1px solid var(--color-separator);
  padding-top: 12px;
  display: flex;
  justify-content: flex-end;
}

.footer button {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-separator);
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
}
```

- [ ] **Step 3: 在 NewTTSDialog 顶部追加「管理预设」链接**

在 NewTTSDialog 组件内部，`音色预设` 下拉旁追加：

```tsx
const [managerOpen, setManagerOpen] = useState(false);
// ... 在 select 下方
<button type="button" className={styles.link} onClick={() => setManagerOpen(true)}>
  ⚙ 管理预设
</button>

{/* 最底部 */}
<VoicePresetManager open={managerOpen} onClose={() => setManagerOpen(false)} />
```

在 CSS 追加 `.link`：
```css
.link {
  background: none;
  border: none;
  color: var(--color-system-blue);
  cursor: pointer;
  font-size: var(--font-size-xs);
  margin-top: 4px;
}
```

导入 `VoicePresetManager`。

- [ ] **Step 4: 运行构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/VoicePresetManager.tsx src/components/VoicePresetManager.module.css src/components/NewTTSDialog.tsx src/components/NewTTSDialog.module.css
git commit -m "feat(tts): 音色预设管理器 Modal"
```

---

# Phase 8 · 配音闭环 UI

## Task 23: ReVoiceDialog 与 Clip 右键菜单集成

**Files:**
- Create: `src/components/ReVoiceDialog.tsx`
- Modify: 时间线 Clip 渲染组件（如 `src/components/Timeline.tsx` 或 AudioClip 专用组件）

- [ ] **Step 1: 创建 ReVoiceDialog，复用 NewTTSDialog 的大部分逻辑**

```tsx
// src/components/ReVoiceDialog.tsx
import { useEffect, useMemo, useState } from 'react';
import { useTimelineStore } from '../store/timeline';
import { useVoicePresetsStore } from '../store/voice-presets';
import { useTaskProgressStore } from '../store/task-progress';
import { generateTTSAsset } from '../lib/tts-service';
import { MINIMAX_EMOTIONS } from '../lib/minimax-voices';
import type { VoiceParams, AudioClip } from '../types';
import styles from './NewTTSDialog.module.css';

interface ReVoiceDialogProps {
  clipId: string | null;
  onClose: () => void;
}

export function ReVoiceDialog({ clipId, onClose }: ReVoiceDialogProps) {
  const open = clipId != null;
  const audioClips = useTimelineStore((s) => s.audioClips);
  const srtEntries = useTimelineStore((s) => s.srtEntries);
  const editedSubtitles = useTimelineStore((s) => s.editedSubtitles);
  const ttsAssets = useTimelineStore((s) => s.ttsAssets);
  const replaceClipWithTTS = useTimelineStore((s) => s.replaceClipWithTTS);

  const presets = useVoicePresetsStore((s) => s.presets);
  const defaultPresetId = useVoicePresetsStore((s) => s.defaultPresetId);
  const loadPresets = useVoicePresetsStore((s) => s.load);

  const startTask = useTaskProgressStore((s) => s.startTask);
  const updateTask = useTaskProgressStore((s) => s.updateTask);
  const completeTask = useTaskProgressStore((s) => s.completeTask);
  const failTask = useTaskProgressStore((s) => s.failTask);

  const clip: AudioClip | null = useMemo(
    () => audioClips.find((c) => c.id === clipId) ?? null,
    [audioClips, clipId]
  );

  const originalText = useMemo(() => {
    if (!clip) return '';
    const source = editedSubtitles ?? srtEntries;
    return clip.linkedSubtitleIndexes
      .map((idx) => source.find((s) => s.index === idx)?.text ?? '')
      .join(' ')
      .trim();
  }, [clip, editedSubtitles, srtEntries]);

  const [text, setText] = useState('');
  const [presetId, setPresetId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Partial<VoiceParams>>({});
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (open) {
      void loadPresets();
      setText(originalText);
      setPresetId(defaultPresetId ?? presets[0]?.id ?? null);
      setOverrides({});
    }
  }, [open, originalText, defaultPresetId, presets, loadPresets]);

  if (!open || !clip) return null;

  const preset = presets.find((p) => p.id === presetId);
  const projectDir = localStorage.getItem('podcast-editor-project-dir') ?? '';

  const handleGenerate = async () => {
    if (!preset) {
      window.alert('请选择音色预设');
      return;
    }
    if (!text.trim()) {
      window.alert('请输入替换文本');
      return;
    }
    if (!projectDir) {
      window.alert('未打开项目');
      return;
    }

    setGenerating(true);
    const taskId = `tts-re-${Date.now()}`;
    startTask({
      id: taskId,
      category: 'tts',
      label: '重新配音',
      mode: 'indeterminate',
      progress: 0,
      phase: '生成音频',
      level: 1,
      canCancel: false,
    });

    try {
      const apiKey = await getApiKey();
      updateTask(taskId, { progress: 0.3 });
      const asset = await generateTTSAsset({
        text: text.trim(),
        voicePreset: preset,
        overrides,
        projectDir,
        apiKey,
      });
      updateTask(taskId, { progress: 0.7, phase: '写入并替换' });
      useTimelineStore.setState({ ttsAssets: [...ttsAssets, asset] });
      replaceClipWithTTS(clip.id, asset.id);
      completeTask(taskId);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failTask(taskId, msg);
      window.alert(`生成失败: ${msg}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>重新配音 · Clip {clip.id.slice(-6)}</h2>

        <label className={styles.label}>原字幕(只读)</label>
        <div className={styles.readOnlyBox}>{originalText || '(无对应字幕)'}</div>

        <label className={styles.label}>替换文本</label>
        <textarea
          className={styles.textarea}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <label className={styles.label}>音色预设</label>
        <select
          className={styles.select}
          value={presetId ?? ''}
          onChange={(e) => setPresetId(e.target.value || null)}
        >
          <option value="">-- 选择预设 --</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className={styles.params}>
          <div className={styles.paramRow}>
            <label>语速</label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={overrides.speed ?? preset?.params.speed ?? 1}
              onChange={(e) =>
                setOverrides((o) => ({ ...o, speed: Number(e.target.value) }))
              }
            />
            <span>{(overrides.speed ?? preset?.params.speed ?? 1).toFixed(1)}×</span>
          </div>
          <div className={styles.paramRow}>
            <label>情绪</label>
            <select
              value={overrides.emotion ?? preset?.params.emotion ?? 'neutral'}
              onChange={(e) =>
                setOverrides((o) => ({ ...o, emotion: e.target.value }))
              }
            >
              {MINIMAX_EMOTIONS.map((em) => (
                <option key={em.value} value={em.value}>
                  {em.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.hint}>
          ⚠ 原片段时长 {(clip.durationMs / 1000).toFixed(1)}s · 生成后后续片段会顺延
        </div>

        <div className={styles.actions}>
          <button onClick={onClose} disabled={generating}>取消</button>
          <button
            className={styles.primary}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? '生成中...' : '生成并替换'}
          </button>
        </div>
      </div>
    </div>
  );
}

async function getApiKey(): Promise<string> {
  const settings = await window.electronAPI.loadGlobalSettings();
  const key = (settings as { minimaxApiKey?: string })?.minimaxApiKey;
  if (!key) throw new Error('未配置 MiniMax API Key');
  return key;
}
```

- [ ] **Step 2: 在 NewTTSDialog.module.css 追加 readOnlyBox 样式（或在 ReVoiceDialog 中）**

```css
.readOnlyBox {
  padding: 8px 10px;
  background: var(--color-panel-elevated);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  min-height: 32px;
}
```

- [ ] **Step 3: 在时间线 Clip 渲染组件接入右键菜单**

Grep: 查找时间线上渲染 AudioClip 的组件 - 可能是 Timeline.tsx 或新创建的 AudioClipBlock.tsx

如果当前时间线只渲染整段音频（单一 TimelineAudioWaveform），需要改造为按 `audioClips` 数组渲染每个 Clip：

在 Timeline 相关组件中，用 Grep 找到音频轨道的渲染位置（搜索 `TimelineAudioWaveform` 用法），在其附近增加按 `audioClips` 渲染的逻辑。

由于时间线轨道的具体组件层级需要现场确认，此步骤分成两个子步骤：

- [ ] **Step 3.1: 定位音频轨道渲染组件**

```
Grep pattern: TimelineAudioWaveform
```

找到其唯一使用点，在同一组件内（通常是 Timeline.tsx），确认音频轨道的 JSX 位置。

- [ ] **Step 3.2: 在音频 Clip 渲染层追加右键监听**

假设 Clip 用 `<div className={styles.audioClip} key={clip.id} />` 渲染（如果没有则需要先添加按 `audioClips` 遍历），在上层组件追加状态：

```tsx
const [reVoiceClipId, setReVoiceClipId] = useState<string | null>(null);
```

在 clip 元素上追加：
```tsx
onContextMenu={(e) => {
  e.preventDefault();
  setReVoiceClipId(clip.id);
}}
```

在组件末尾追加：
```tsx
<ReVoiceDialog clipId={reVoiceClipId} onClose={() => setReVoiceClipId(null)} />
```

导入 `ReVoiceDialog` 和 `useState`。

**注意**：如果当前 Timeline 尚未按 `audioClips` 渲染（仍是单一波形），这里需要先做一个最小改造：在音频轨道上迭代 `audioClips` 并为每个 clip 渲染一个可右键的透明层块（仅作为右键热区，不替换波形显示，这一期先不替换）。

- [ ] **Step 4: 运行构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/ReVoiceDialog.tsx src/components/Timeline.tsx src/components/NewTTSDialog.module.css
git commit -m "feat(tts): 右键 Clip 重新配音对话框"
```

---

## Task 24: TTS 素材拖拽替换 Clip

**Files:**
- Modify: Timeline Clip 渲染组件（同上）

- [ ] **Step 1: 在音频 Clip 热区追加 drop 处理**

在音频 Clip 元素上追加：

```tsx
onDragOver={(e) => {
  if (e.dataTransfer.types.includes('application/x-tts-asset-id')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}}
onDrop={(e) => {
  const assetId = e.dataTransfer.getData('application/x-tts-asset-id');
  if (!assetId) return;
  e.preventDefault();
  if (window.confirm('将此 Clip 替换为 TTS 素材?')) {
    useTimelineStore.getState().replaceClipWithTTS(clip.id, assetId);
  }
}}
```

在同文件顶部导入 `useTimelineStore`（如未导入）。

- [ ] **Step 2: 运行构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/components/Timeline.tsx
git commit -m "feat(tts): 支持拖拽 TTS 素材替换 Clip"
```

---

# Phase 9 · 集成、兼容、性能

## Task 25: 持久化 audioClips/ttsAssets/editedSubtitles

**Files:**
- Modify: `src/store/timeline.ts`

- [ ] **Step 1: 找到 saveTimeline 触发点**

Grep `saveTimeline` 在 `src/store/timeline.ts` 中的使用位置。确认：
- Timeline 保存逻辑：通常是在 `setTimeline` 后或手动保存按钮触发
- 保存时传入的 `TimelineData` 是否包含 `audioClips/ttsAssets/editedSubtitles`

- [ ] **Step 2: 确保保存时合并新字段**

找到构造保存数据的代码（可能在 `src/pages/Editor.tsx` 或 `App.tsx` 的自动保存逻辑），在生成 `TimelineData` 的位置：

```ts
const timelineToSave: TimelineData = {
  ...timeline,
  audioClips: audioClips.length > 0 ? audioClips : undefined,
  ttsAssets: ttsAssets.length > 0 ? ttsAssets : undefined,
  editedSubtitles: editedSubtitles ?? undefined,
};
await window.electronAPI.saveTimeline(projectDir, timelineToSave);
```

- [ ] **Step 3: 确认 setTimeline 从 TimelineData 中恢复（Task 9 已完成）**

复查 Task 9 step 3 的修改已就绪。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/timeline.test.tsx tests/project-persistence.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/timeline.ts src/pages/Editor.tsx src/App.tsx
git commit -m "feat(persistence): 持久化音频 Clip 与字幕编辑状态"
```

---

## Task 26: 应用启动时加载全局音色预设

**Files:**
- Modify: `src/App.tsx` 或 `src/main.tsx`

- [ ] **Step 1: 在 App 启动时调用 loadPresets**

在 `src/App.tsx` 根组件内追加：

```tsx
import { useVoicePresetsStore } from './store/voice-presets';

// 在 App 函数组件内
useEffect(() => {
  void useVoicePresetsStore.getState().load();
}, []);
```

若已有 useEffect 初始化代码块，加入 load 调用即可。

- [ ] **Step 2: 运行构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/App.tsx
git commit -m "feat(boot): 启动时预加载全局音色预设"
```

---

## Task 27: 向后兼容集成测试

**Files:**
- Create: `tests/backwards-compat.test.ts`

- [ ] **Step 1: 写向后兼容测试**

```ts
// tests/backwards-compat.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import type { TimelineData } from '../src/types';

const legacyTimeline: TimelineData = {
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  podcast: { audioPath: '/legacy.mp3', srtPath: '/legacy.srt', durationMs: 60000 },
  tracks: [],
  overlays: [],
  subtitle: {
    fontSize: 32, color: '#fff', position: 'bottom',
    highlightEnabled: false,
    highlightBackgroundColor: '#000', highlightTextColor: '#fff',
    highlightPaddingX: 4, highlightPaddingY: 2, highlightRadius: 4,
    highlightAnimation: 'none',
  },
  // 没有 audioClips / ttsAssets / editedSubtitles
};

beforeEach(() => {
  useTimelineStore.getState().setTimeline(legacyTimeline);
});

describe('向后兼容 - 旧项目', () => {
  it('setTimeline 对缺失字段使用空默认值', () => {
    const state = useTimelineStore.getState();
    expect(state.audioClips).toEqual([]);
    expect(state.ttsAssets).toEqual([]);
    expect(state.editedSubtitles).toBeNull();
  });

  it('ensureAudioClipsInitialized 按 srtEntries 首次初始化', () => {
    useTimelineStore.getState().setSrtEntries([
      { index: 1, startMs: 0, endMs: 2000, text: '一' },
      { index: 2, startMs: 2000, endMs: 4000, text: '二' },
    ]);
    useTimelineStore.getState().ensureAudioClipsInitialized();
    expect(useTimelineStore.getState().audioClips).toHaveLength(2);
  });

  it('ensureAudioClipsInitialized 已有 Clip 时是幂等的', () => {
    useTimelineStore.setState({
      audioClips: [{
        id: 'pre', source: { kind: 'origin', startMs: 0, endMs: 1000 },
        timelineStartMs: 0, durationMs: 1000, linkedSubtitleIndexes: [1],
      }],
    });
    useTimelineStore.getState().ensureAudioClipsInitialized();
    expect(useTimelineStore.getState().audioClips).toHaveLength(1);
    expect(useTimelineStore.getState().audioClips[0].id).toBe('pre');
  });

  it('旧 TimelineData JSON 序列化往返无丢失', () => {
    const serialized = JSON.stringify(legacyTimeline);
    const parsed = JSON.parse(serialized) as TimelineData;
    expect(parsed.audioClips).toBeUndefined();
    expect(parsed.ttsAssets).toBeUndefined();
    useTimelineStore.getState().setTimeline(parsed);
    expect(useTimelineStore.getState().timeline.podcast.audioPath).toBe('/legacy.mp3');
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/backwards-compat.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add tests/backwards-compat.test.ts
git commit -m "test: 向后兼容集成测试"
```

---

## Task 28: 全部测试套件回归 + 手动冒烟

**Files:**
- N/A

- [ ] **Step 1: 运行完整测试套件**

Run: `npm test`
Expected: PASS — 所有测试通过

若有回归，定位到具体 fail 用例并修复。

- [ ] **Step 2: 启动 dev 环境手动冒烟**

Run: `npm run dev`
Expected: 应用正常启动

手动验证：
1. 打开旧项目（无 audioClips 字段）→ 预览正常播放原始 MP3 ✓
2. 进入编辑器 → 右侧 Inspector 切换到「字幕」Tab → 字幕列表显示 ✓
3. 点击某条字幕 → 进入内联编辑态 → 修改文本 → 失焦提交 ✓
4. 删除按钮 → 确认 → 字幕被删除 ✓
5. 顶部「+ 新增」→ 列表末尾出现「新字幕」占位 ✓
6. 搜索框输入关键字 → 列表过滤 ✓
7. 「替换」展开 → 输入替换文本 → 「全部替换」→ 提示替换次数 ✓
8. 左侧素材区 → 「音频」分类 → 看到「🎤 TTS 生成」区 ✓
9. 「+ 新建 TTS 音频」→ 对话框 → 填写文本 → 选择预设（若无预设先创建）→ 生成 ✓
10. 生成成功后「最近生成」区出现卡片 ✓
11. 右键时间线音频 Clip → 「重新配音」菜单（如 Timeline Clip 已接入）→ 对话框预填原字幕 → 生成 ✓
12. 拖拽 TTS 卡片到音频 Clip → 确认弹窗 → 替换成功 ✓
13. 替换后预览 → 音频播放到替换段时切换到 TTS 音频 ✓
14. 进入设置页面 → 「音色预设」分区 → 新建/编辑/删除/设默认 ✓

把冒烟结果记录在 commit 或 PR 描述中。

- [ ] **Step 3: 运行类型检查与完整 build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: 提交冒烟修复（如有）**

若冒烟发现 bug，每个 bug 一次提交：

```bash
git add -A
git commit -m "fix(<scope>): <问题摘要>"
```

---

## Task 29: 性能压测 Remotion 多 Audio 渲染

**Files:**
- Create: `tests/perf-clip-rendering.test.ts`（可选，或用 dev 环境手工测试）

- [ ] **Step 1: 构造 100/200/500 Clip 的测试项目**

在 dev 环境：
1. 准备一个约 10 分钟的 MP3 + SRT（约 100-200 条字幕）
2. 导入后自动初始化 Clip
3. 选 20% 的 Clip 用 TTS 替换（模拟实际使用）

- [ ] **Step 2: 测量指标**

记录以下指标：
- Remotion Player 初次加载耗时
- 播放跳转到中段的响应延迟（seek）
- CPU/内存占用（macOS 活动监视器）
- 导出一次完整视频的耗时

- [ ] **Step 3: 评估是否达标**

**达标标准**：
- 100 Clip：播放流畅，seek < 500ms
- 200 Clip：播放可用，seek < 1s
- 500 Clip：可能有肉眼可见的 seek 延迟但不卡死

若不达标，触发 P1 的 ffmpeg 预合成 Fallback（超出本 plan 范围，开新 issue 跟进）。

- [ ] **Step 4: 记录压测结果**

在 `docs/superpowers/specs/2026-04-14-audio-subtitle-tts-editing-design.md` 的「风险与应对」章节追加压测实测数据：

```markdown
## 压测实测（2026-04-XX）
- 100 Clip 场景：...
- 200 Clip 场景：...
- 500 Clip 场景：...
- 结论：达标 / 未达标 → 需 P1 Fallback
```

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-04-14-audio-subtitle-tts-editing-design.md
git commit -m "docs: 记录 Remotion 多 Clip 压测结果"
```

---

## Task 30: 最终 PR 准备

- [ ] **Step 1: 浏览所有提交**

Run: `git log master..HEAD --oneline`
Expected: 清晰的提交历史，每个 commit 对应一个 Task

- [ ] **Step 2: 运行完整质量门禁**

Run: `npm test && npm run build`
Expected: 全部 PASS

- [ ] **Step 3: 创建 PR**

```bash
gh pr create --title "feat: 音频/字幕二次加工 + TTS 配音替换 P0" --body "$(cat <<'EOF'
## Summary
- 字幕二次编辑（右侧 Inspector 字幕 Tab，支持查看/编辑/新增/删除/查找替换/自动定位）
- 音频 Clip 虚拟合成模型（非破坏性,按字幕自动切分）
- TTS 素材库 + 全局音色预设管理
- 右键 Clip「重新配音」+ 拖拽 TTS 素材替换
- Remotion PodcastComposition 改造为多 Clip `<Sequence>` + `<Audio>` 合成
- 完整向后兼容:旧项目字段缺失时惰性初始化

## 关联文档
- Spec: docs/superpowers/specs/2026-04-14-audio-subtitle-tts-editing-design.md
- Plan: docs/superpowers/plans/2026-04-14-audio-subtitle-tts-editing.md

## Test plan
- [ ] npm test 全部通过
- [ ] 旧项目打开无回归
- [ ] 字幕编辑 + undo/redo
- [ ] TTS 生成 → 替换 Clip → 预览 → 导出
- [ ] 100+ Clip 规模性能压测
EOF
)"
```

---

# 附录 A · 任务执行顺序与依赖

```
Task 1  (types)
   ↓
Task 2  (subtitle-builder)  ─┐
Task 3  (clip-init)         ─┤
Task 4  (minimax-voices)    ─┤
Task 5  (extractWordTimestamps) → Task 6 (generate-tts IPC)
                               ↓
                            Task 7 (voice-presets IPC)
                               ↓
                            Task 8 (voice-presets store)
                               ↓
Task 9  (timeline store 字段)
   ↓
Task 10 (字幕 CRUD) ← 依赖 Task 2
Task 11 (replaceClipWithTTS) ← 依赖 Task 2
Task 12 (惰性初始化) ← 依赖 Task 3
   ↓
Task 13 (tts-service) ← 依赖 Task 6, 8
   ↓
Task 14 (PodcastComposition) ← 依赖 Task 1
Task 15 (TimelineClipWaveform) ← 依赖 Task 1
   ↓
Task 16 (EditorInspector Tab) ─┐
Task 17 (SubtitleTabPanel)      ├─ Task 18, 19
                                ↓
Task 20 (AssetPanel TTS 区) ←   Task 21 (NewTTSDialog)
                                ↓
                            Task 22 (VoicePresetManager)
                                ↓
Task 23 (ReVoiceDialog + 右键) ← 依赖所有 Phase 5,7
Task 24 (拖拽替换) ← 依赖 Task 23
   ↓
Task 25 (持久化)
Task 26 (启动加载)
Task 27 (兼容测试)
Task 28 (回归 + 冒烟)
Task 29 (压测)
Task 30 (PR)
```

---

# 附录 B · 自检清单

✅ **Spec 覆盖检查**：
- §3 架构 → Task 1, 9, 14
- §4 数据模型 → Task 1
- §5 Remotion 改造 → Task 14, 15
- §6 字幕 Tab → Task 10, 16-19
- §7 TTS 素材库 → Task 4, 5, 6, 7, 8, 13, 20, 21, 22
- §8 配音闭环 → Task 2, 11, 23, 24
- §9 向后兼容 → Task 9, 12, 27
- §10 P0 交付清单 → 全部 Task 覆盖
- §12 风险应对 → Task 29 (压测)
- §14 测试策略 → Task 2, 3, 8, 10, 11, 13, 27, 28
- §15 验收标准 → Task 28 (手动冒烟)

✅ **无占位文字**：所有 TDD 测试、实现、命令均已展开

✅ **类型一致性**：
- `AudioClip` / `TTSAsset` / `VoicePreset` / `VoiceParams` / `WordTimestamp` 在所有相关 Task 中签名一致
- `replaceClipWithTTS(clipId, ttsAssetId)` 签名在 Task 11 定义,Task 23/24 使用一致
- `generateTTSAsset` 参数签名在 Task 13 定义,Task 21/23 调用一致
- `useVoicePresetsStore` API 在 Task 8 定义,Task 21/22/23 使用一致
- `useTimelineStore` 字幕 Action 签名在 Task 10 定义,Task 18/19 使用一致
- `useTaskProgressStore.startTask/updateTask/completeTask/failTask` 在 Task 21/23 使用的参数与现有 src/store/task-progress.ts 的 `StartTaskInput` 契合

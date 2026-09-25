# 字幕长度限制与自动重分段设计

**创建日期**：2026-04-15
**状态**：草案（等待复核）
**负责人**：yoqu
**关联模块**：`src/types.ts` · `src/store/timeline.ts` · `src/components/SubtitleInspector.tsx` · `src/lib/subtitle-highlights.ts` · `src/lib/project-persistence.ts`

---

## 1. 背景与目标

### 1.1 背景

灵机剪影当前的字幕来源是 MiniMax TTS 合成后返回的 sentence-level subtitle 数据（`src/lib/minimax-tts.ts`）。每条 subtitle 对应脚本中的一个完整句子，由脚本原始标点决定切分边界。

当脚本中存在长句（独白式、标点稀疏），MiniMax 返回的单条字幕可能有 40~80 个字符，在 Player 预览中会占据大片画面，挤压主视觉空间，影响播客视频的视觉质量。

### 1.2 根因分析

- **MiniMax 只返回句子级时间戳**（`begin_time` / `end_time`），没有 word-level 时间戳，无法在合成阶段精确切分
- **重跑 bcut ASR 没意义**：对 TTS 合成音频做 ASR 会产生完全不同的（且不可信的）时间戳
- **重跑 MiniMax 没意义**：同样的脚本 → 同样的长句输出
- **唯一可行路径**：对现有 `srtEntries` 做客户端二次切分，按字符数上限 + 标点优先策略重分段，时间戳按字符数等比分配

好消息：MiniMax 返回的 `[start, end]` 区间是 TTS 精确合成时间，切分后按字符比例内插出来的时间戳精度足够观感使用。

### 1.3 目标

让创作者能够：

1. 在 SubtitleInspector 中设置"**单条字幕最多字数**"
2. 拖动滑块即时看到切分效果（防抖重切分）
3. 原始 MiniMax 字幕作为 baseline 保留，可随时**还原**
4. 切分后，已有的关键词高亮**自动重映射**到新条目，无法匹配的丢弃并提示

### 1.4 非目标（本期不做）

- 磁盘 `.srt` 文件的写回（所有切分仅存在于 `timeline.json`）
- 支持"最小字数合并"（合并短字幕为长字幕）
- 语义级切分（用 LLM 在最优断点切）
- 手动编辑单条字幕的切分位置（只走算法）
- 多项目批量重切分

---

## 2. 用户故事

**US-1**：用户用 MiniMax 生成了一段播客音频，发现某几条字幕在画面上字太多挤占空间。他打开 SubtitleInspector 的"字幕排版"分组，拖动"单条最多字数"滑块从默认 35 往下调到 25，Player 预览里长字幕立即被切成 2~3 段，视觉密度明显降低。

**US-2**：用户之前对字幕生成过关键词高亮。重切分后，原来的"创新驱动"高亮自动定位到新字幕条目上继续显示，而一个跨越切分点的"人工智能时代"高亮因无法在任何单条中完整找到，被丢弃并弹出 toast："2 条高亮因切分失效"。

**US-3**：用户觉得切分后字幕太碎，点击"还原原始字幕"按钮，字幕回到 MiniMax 最初返回的状态，关闭"自动切分"开关，高亮保持不变。

**US-4**：用户重新打开一个之前保存的项目，该项目没有 `originalSrtEntries` 字段。系统读取时把当前 `srtEntries` 作为 baseline 填入，用户依然可以使用重切分功能。

---

## 3. 架构与数据模型

### 3.1 类型扩展（`src/types.ts`）

```ts
// SubtitleStyle 新增两个可选字段（持久化到 timeline.json）
export interface SubtitleStyle {
  // ...existing fields
  /** 单条字幕最多字符数，超过则自动切分。默认 35，范围 20~60 */
  maxCharsPerEntry?: number;
  /** 是否启用自动切分。默认 true */
  autoResegment?: boolean;
}
```

**关于 baseline（原始字幕）存储位置**：

当前 `srtEntries` **不持久化在 `timeline.json` 中**，而是每次加载项目时通过 `electronAPI.parseSrtFile(srtPath)` 从磁盘 `.srt` 文件重新解析而得。由于磁盘 `.srt` 文件**始终保持 MiniMax 原始输出**（本期不写回），它本身就是天然的 baseline。

因此 baseline（原始条目）**不需要**写入 `timeline.json`，只作为 store 的内存字段存在：

```ts
// TimelineStore 新增内存字段
interface TimelineStore {
  // ...existing fields
  /** baseline：来自磁盘 .srt 文件的原始字幕，切分和还原都以此为输入 */
  originalSrtEntries: SrtEntry[];
}
```

好处：
- 磁盘 `.srt` 是单一事实源，不会因为 timeline.json 旧/新导致 baseline 漂移
- timeline.json 精简，只保存用户设置（`maxCharsPerEntry` / `autoResegment`）
- 旧项目零迁移成本

**默认值与常量**（建议在 `src/lib/srt-resegment.ts` 导出）：

- `DEFAULT_MAX_CHARS_PER_ENTRY = 35`
- `MIN_CHARS_PER_ENTRY = 20`
- `MAX_CHARS_PER_ENTRY_LIMIT = 60`
- `MIN_SEGMENT_DURATION_MS = 300`

### 3.2 新增纯函数模块 `src/lib/srt-resegment.ts`

**职责**：无副作用的字幕切分算法 + 单测覆盖。

**导出 API**：

```ts
export function resegmentSrtEntries(
  entries: SrtEntry[],
  maxChars: number,
): SrtEntry[];

export function splitLongEntry(
  entry: SrtEntry,
  maxChars: number,
): SrtEntry[];

export function findBestBreakPoint(
  text: string,
  targetLen: number,
): number;
```

**算法规范**：

1. **整体流程**：遍历 entries，对每条长度 `> maxChars` 的条目调用 `splitLongEntry`，其余原样保留，然后重新编号 `index`。
2. **断点策略**（`findBestBreakPoint`），在 `[Math.floor(maxChars * 0.6), maxChars]` 搜索窗口内，按优先级找：
   - Priority 1：中文标点 `，。；！？、：`
   - Priority 2：英文标点 `,.;!?:`
   - Priority 3：空格 ` `
   - Priority 4：找不到则硬切在 `maxChars` 位置
   - 在同一优先级内选**最靠右**的位置（保证单段尽量接近 maxChars）
3. **时间分配**：原条目时长 `durationMs = endMs - startMs`，按切分后每段的字符数占比等分时间，并确保每段 `>= MIN_SEGMENT_DURATION_MS`。若因下限导致总时长超出原区间，按比例压缩。
4. **递归切分**：切分后若某子段仍然 `> maxChars`，继续递归切分。
5. **空白处理**：切分点附近的前导/尾随空格归入前一段（或丢弃），避免出现"空格开头"的字幕。

### 3.3 高亮重映射（扩展 `src/lib/subtitle-highlights.ts`）

**新增函数**：

```ts
export function remapHighlightsAfterResegment(
  oldHighlights: SubtitleHighlight[],
  newEntries: SrtEntry[],
): {
  remapped: SubtitleHighlight[];
  dropped: SubtitleHighlight[];
};
```

**策略**：

- 对每条旧 highlight，在 `newEntries` 中查找满足两个条件的目标条目：
  1. `newEntry.text.includes(highlight.highlightText)`
  2. `highlight.sourceText`（旧字幕完整文本）中的这段关键词在新条目中连续存在
- 找到 → 更新 `entryIndex` 和 `start` / `end`（在新条目中 `indexOf(highlightText)` 重新定位），同时更新 `sourceText` 为新条目的 `text`
- 找不到（通常是关键词跨越切分点）→ 放入 `dropped`
- 若同一关键词能匹配多条，默认取第一条（罕见但需确定性）

**调用时机**：`resegmentSubtitles()` action 内部调用，store 拿到 `{remapped, dropped}` 后：
- 把 `remapped` 写回 `timeline.subtitleHighlights`
- 若 `dropped.length > 0`，调度一个 UI 层 toast（通过 store 暴露的 `setLastHighlightDropCount` 或直接在 action 里触发回调）

### 3.4 Store 扩展（`src/store/timeline.ts`）

**新增 actions**：

```ts
// 设置字数上限并触发重切分
setSubtitleMaxChars: (n: number) => void;

// 基于 originalSrtEntries + 当前 maxCharsPerEntry 重切分，并重映射高亮
resegmentSubtitles: () => { droppedHighlights: number };

// 还原到 originalSrtEntries（保留高亮不变）
restoreOriginalSubtitles: () => void;

// 切换自动切分开关
setAutoResegment: (enabled: boolean) => void;
```

**行为规范**：

1. `setSubtitleMaxChars(n)`：
   - 更新 `timeline.subtitle.maxCharsPerEntry = n`
   - 若 `autoResegment` 为 true → 调用 `resegmentSubtitles()`
   - UI 层负责 300ms 防抖（见 §3.5）

2. `resegmentSubtitles()`：
   - 以 `originalSrtEntries`（store 内存中的 baseline）为输入
   - `resegmentSrtEntries(originalSrtEntries, maxCharsPerEntry)` → 新 entries
   - `remapHighlightsAfterResegment(subtitleHighlights, newEntries)` → 更新高亮
   - 写入 `srtEntries` 和 `subtitleHighlights`（注意：`originalSrtEntries` 不变）
   - 返回 `{ droppedHighlights }` 供 UI 显示 toast
   - 进入 undo/redo 历史（单步）

3. `restoreOriginalSubtitles()`：
   - 前置条件：`originalSrtEntries.length > 0` 且与 `srtEntries` 结构不同
   - `srtEntries = originalSrtEntries`
   - 调用 `remapHighlightsAfterResegment(currentHighlights, originalSrtEntries)`，把当前绑定在切分条目上的高亮反向映射回原始条目；无法匹配的丢弃并提示
   - 进入 undo/redo 历史

4. **baseline 设定**：当 `setSrtEntries(entries)` 被调用时（项目加载解析 .srt / 新导入 / TTS 生成 / 重新转录）：
   - **始终**把传入的 `entries` 作为新的 `originalSrtEntries`（覆盖旧 baseline）
   - 若 `autoResegment` 为 true 且存在任一条 `text.length > maxCharsPerEntry`，立即调用 `resegmentSrtEntries()` 生成切分版本作为 `srtEntries`
   - 否则直接 `srtEntries = entries`
   - 同时对 `subtitleHighlights` 做一次 `remapHighlightsAfterResegment`（若切分了）或保留不变
   - **注意**：`setSrtEntries` 此时承担三件事（baseline 覆写 + 条件切分 + 高亮重映射），应注意封装避免在组件层重复调用
   - 该行为保证任何时候都有可还原的 baseline，且旧的切分状态被新输入覆盖而不是合并

### 3.5 UI（`src/components/SubtitleInspector.tsx`）

**位置**：在 SubtitleInspector 顶部新增 "**字幕排版**" 分组，位于"关键词高亮"分组之上。

**控件**：

| 控件 | 绑定状态 | 行为 |
|------|---------|------|
| 数字输入 / 滑块 | `timeline.subtitle.maxCharsPerEntry` | 范围 20-60，默认 35，变更防抖 300ms 后调用 `setSubtitleMaxChars` |
| Toggle："超过自动切分" | `timeline.subtitle.autoResegment` | 默认 on。关闭时不触发切分，但滑块仍可调整 |
| 按钮："立即重新切分" | — | 显式调用 `resegmentSubtitles()` |
| 按钮："还原原始字幕" | — | 显式调用 `restoreOriginalSubtitles()`，仅在 `originalSrtEntries` 与 `srtEntries` 不同时高亮可点 |
| 状态文本 | — | 展示："原 N 条 → 当前 M 条"；若 `N === M` 显示"未切分" |

**Toast 集成**：`resegmentSubtitles` 返回 `droppedHighlights > 0` 时，通过现有 toast 系统提示："X 条关键词高亮因切分失效，可重新生成高亮"。

**防抖实现**：SubtitleInspector 组件内部用 `useRef<number>` 保存 setTimeout 句柄，滑块 onChange 时先 `clearTimeout` 再 `setTimeout(() => store.setSubtitleMaxChars(value), 300)`。卸载时清理。

### 3.6 持久化与加载（`src/lib/timeline-tracks.ts` · `src/App.tsx`）

**序列化**：TimelineData 新字段 `subtitle.maxCharsPerEntry` 和 `subtitle.autoResegment` 随 `timeline.json` 自然落盘，由 `normalizeTimelineData` 的 `subtitle` 字段展开负责兼容。

**反序列化迁移**（`normalizeTimelineData` 中的 `subtitle` 合并）：

- `createDefaultSubtitleStyle()` 返回的默认值包含 `maxCharsPerEntry: 35` 和 `autoResegment: true`
- `normalizeTimelineData` 用 `{ ...defaultSubtitleStyle, ...timeline.subtitle }` 的方式合并，旧项目自然补齐

**加载流程**（`src/App.tsx` 的 `loadProject` 逻辑，大约 line 389-405）：

```
1. electronAPI.loadProject(dir) → projectData
2. setTimeline(projectData.timeline) → 内存中 subtitle.maxCharsPerEntry 已就位
3. electronAPI.parseSrtFile(srtPath) → entries（原始磁盘 SRT）
4. setSrtEntries(entries) → 触发 baseline 覆写 + 条件切分
5. Player / Timeline 显示最终切分后的 srtEntries
```

**无需迁移磁盘文件**：`.srt` 文件本身不变，旧项目打开后若 `autoResegment` 为 true 会自动应用切分显示，关闭开关即可恢复原样。

---

## 4. 数据流与交互时序

### 4.1 初次 TTS 生成流程

```
用户在 ScriptWorkbench 点击 "生成音频"
  → electron/main.ts 调用 MiniMax TTS
  → 返回 audio + subtitleSentences
  → renderer 把 sentences 转为 SrtEntry[]
  → store.setSrtEntries(entries)
    → 若 autoResegment && 存在长条 → 保存 originalSrtEntries + 触发 resegment
    → 否则仅写 srtEntries
  → SubtitleInspector 显示"原 N 条 → 切分后 M 条"
```

### 4.2 用户调整字数上限

```
用户拖动滑块：35 → 25
  → SubtitleInspector 本地 state 立即更新（UI 响应）
  → 防抖 300ms
  → store.setSubtitleMaxChars(25)
    → 更新 subtitle.maxCharsPerEntry
    → 调用 resegmentSubtitles()
      → resegmentSrtEntries(originalSrtEntries, 25)
      → remapHighlightsAfterResegment(...)
      → 写入 srtEntries + subtitleHighlights
    → 返回 { droppedHighlights }
  → UI：Player 实时更新；若 droppedHighlights > 0 显示 toast
```

### 4.3 还原原始字幕

```
用户点击 "还原原始字幕"
  → store.restoreOriginalSubtitles()
    → srtEntries = originalSrtEntries
    → 重映射高亮（通常能完全恢复，因为字幕变回原始）
  → UI 更新，状态文本变回 "未切分"
```

---

## 5. 测试策略

### 5.1 单元测试（Vitest，`tests/` 目录）

**`tests/srt-resegment.test.ts`**（新建）：
- `splitLongEntry` 中文标点切分：`"这是一段很长的文本，包含多个逗号，还有句号。" → ["这是一段很长的文本，", "包含多个逗号，", "还有句号。"]`
- 英文空格切分：长英文句子在空格处断开
- 混合中英文切分
- 硬切保底：无标点无空格的连续字符
- 递归切分：超长条目切分后仍然超长时继续切
- 时间等比分配 + 最小时长下限
- 边界：空字符串、`entries.length === 0`、`maxChars < MIN_CHARS_PER_ENTRY`
- `resegmentSrtEntries` 保持 index 连续递增

**`tests/subtitle-highlights.test.ts`**（扩展）：
- `remapHighlightsAfterResegment` 高亮能在新条目中找到 → 正确更新 entryIndex 和 offset
- 跨切分点的高亮 → 放入 dropped
- 多个候选 → 取第一个
- sourceText 验证防止误映射

**`tests/timeline-store.test.ts` / 新 `tests/timeline-resegment.test.ts`**：
- `setSrtEntries` 时 autoResegment 开关行为
- `setSubtitleMaxChars` 更新字段 + 触发切分
- `resegmentSubtitles` 返回 droppedHighlights 数量
- `restoreOriginalSubtitles` 正确还原
- Undo/redo 覆盖重切分操作

**`tests/project-persistence.test.ts`**（扩展）：
- 旧项目读取时的字段迁移
- `originalSrtEntries` 缺失的 baseline 填充
- 不触发自动重切分

### 5.2 UI 组件测试

**`tests/subtitle-inspector.test.tsx`**（扩展或新建）：
- 滑块拖动触发防抖
- Toggle 切换自动切分开关
- 按钮点击调用对应 action
- 状态文本正确展示原 N → 切分后 M
- dropped > 0 时触发 toast mock

### 5.3 手动验证

- 用真实 MiniMax TTS 生成一段含长句的音频，验证切分效果
- 在 Player 里确认字幕显示位置和时机
- 验证高亮在切分前后的视觉连续性
- Undo/redo 操作手动验证
- 项目保存 → 重新打开 → 字幕状态正确恢复

---

## 6. 风险与边界

| 风险 | 说明 | 缓解方式 |
|------|------|---------|
| **时间戳不准** | 按字符等比分配无法反映实际语速变化 | 用户可接受，字幕是观感辅助；最小 300ms 下限避免闪烁 |
| **高亮大量失效** | 用户调小 maxChars 后高亮全丢 | toast 明确提示数量 + "可重新生成高亮"引导 |
| **频繁切分性能** | 长播客大量字幕 + 滑块频繁拖动 | 300ms 防抖 + 纯同步算法，1000 条字幕预估 <10ms |
| **旧项目兼容** | 首次打开老项目找不到 baseline | 加载时用当前 srtEntries 填 baseline，不自动切分 |
| **切分后无法精确编辑** | 本期不支持手动调整切分点 | 明确声明非目标；未来需求时再扩展 |
| **特殊标点遗漏** | 省略号 `……` 等复合标点处理 | 算法中显式处理：识别为一个"标点块"不在中间切开 |
| **极短 maxChars** | 用户设为 20 字时，短句依然可能被硬切 | 最小片段 300ms 下限 + 滑块最低 20 字限制 |

---

## 7. 受影响文件清单

| 文件 | 改动类型 | 说明 |
|------|--------|------|
| `src/types.ts` | 修改 | 扩展 `SubtitleStyle`、更新 `createDefaultSubtitleStyle` 默认值 |
| `src/lib/srt-resegment.ts` | **新增** | 切分算法纯函数 |
| `src/lib/subtitle-highlights.ts` | 修改 | 新增 `remapHighlightsAfterResegment` |
| `src/store/timeline.ts` | 修改 | 新增 `originalSrtEntries` 字段 + 4 个 actions + `setSrtEntries` 行为调整 |
| `src/components/SubtitleInspector.tsx` | 修改 | 新增"字幕排版"分组 UI |
| `tests/srt-resegment.test.ts` | **新增** | 切分算法测试 |
| `tests/subtitle-highlights.test.ts` | 修改 | 补充 remap 测试 |
| `tests/timeline-resegment.test.ts` | **新增** | Store 层集成测试 |
| `tests/subtitle-inspector.test.tsx` | 修改 | UI 层测试补充 |

**不改动**：

- `src/remotion/SubtitleTrack.tsx` / `PodcastComposition.tsx` —— 只看 `srtEntries`，透明支持
- `src/components/TimelineSubtitleBlocks.tsx` —— 同上
- `electron/video-import/bcut-asr.ts` / `electron/main.ts` 的 MiniMax TTS 路径 —— 不涉及
- 磁盘 `.srt` 文件 —— 保持原状
- AI Agent 操作视觉系统 / 统一进度条 —— 本期切分是纯同步计算，不接入

---

## 8. 开放问题

本期无开放问题。所有参数（默认 35 字、范围 20-60、防抖 300ms、最小片段 300ms、自动重映射策略）已在设计阶段确认。

---

## 9. 参考

- 现有 MiniMax TTS 集成：`src/lib/minimax-tts.ts`、`electron/main.ts:1157-1263`
- 现有 SRT 解析：`src/lib/srt-parser.ts`
- 现有高亮体系：`src/lib/subtitle-highlights.ts` · `src/components/SubtitleInspector.tsx`
- CLAUDE.md 中关于字幕与设计规范的约定

# Spec 2 · 成片技术能力补齐

- 日期：2026-06-15
- 状态：设计草稿，待 review
- 所属轨道：轨道一 · 成片闭环（Phase 1）
- 依赖：Spec 1（持久化基座，artifacts 登记、`.lingji/` 目录）

## 1. 背景与目标

把"卡片→时间线装配 / 时间线校验 / 修复 / 导出 QC / 字幕校验/重对齐/转写"做成**无人值守的纯能力**（主进程函数 + MCP/CLI），供 Spec 3 编排器消费。本 spec 不含编排、resume、审批。

现状关键事实（已核对代码）：

- 卡片→时间线装配已有雏形：`buildAICardTimelineDraft`（`src/types/ai.ts`，默认时长 `DEFAULT_CARD_DURATION_MS=5000`）+ `applyAICardDraftToTimeline`（`src/store/timeline.ts`，按 displayMode 算 pip/fullscreen 位置），**但装配时不做任何重叠/空档/首帧/全覆盖检测**。
- 碰撞零件已存在但装配未调用：`src/lib/timeline-placement.ts` 提供 `canPlaceAt`/`overlaysOverlap`/`findNearestAvailablePlacement`/`findCollidingItems`/`clampOverlayDurationByNeighbors`。
- **ffprobe / ffmpeg 已可用**：`electron/media-duration.ts`（`readAudioDurationMs`/`readVideoDurationMs`）、`electron/media-concat.ts`、`electron/runtime-binaries.ts`（`resolveFfmpegPath`/`resolveFfprobePath`）。QC 可直接复用，无需新引依赖。
- 导出：`electron/remotion/render-video-headless.ts` 接受 `ExportConfig{resolution,quality}`（`src/lib/export-settings.ts`，4×3 预设），**导出前后无任何校验**。
- 字幕：`src/lib/srt-parser.ts`（parse/serialize）、`src/lib/srt-resegment.ts`（仅过长切分）。**无越界/重叠/与音频时长一致性校验，无 ASR**。`.original.srt` 备份机制已存在。

目标：补齐上述全部缺失校验与修复能力，全部以**纯函数 + 主进程能力 + MCP/CLI** 形态交付，并把 QC 报告落盘到 `.lingji/qc/`。

## 2. 交付边界

纳入：

- `timeline assemble / validate / repair`（纯 TS 能力 + MCP/CLI）。
- `qc run` + `export-and-qc`（ffprobe/ffmpeg 检查 + 结构化报告）。
- `subtitle validate / resync / transcribe`。

不纳入（留给后续 spec）：

- 跨步骤编排、resume、QC 失败后的自动回退执行 → Spec 3（本 spec 只产出"建议回到哪步"）。
- 审批 UI → Spec 3 最小门禁。
- 创作意图驱动的装配偏好（卡片密度等）→ Spec 4 提供数据，本 spec 预留读取入口。

## 3. 时间线装配（assemble）

把现有 store 内的装配逻辑抽成**纯函数** `src/lib/timeline-assemble.ts`（不依赖 zustand store，renderer 与 main 可共用）：

- 输入：`enabled cards`、`audioDurationMs`、当前 `TimelineData`、装配选项（默认时长、pip/fullscreen 偏好）。
- 输出：新的 overlay 集合 + 装配报告。
- 复用 `buildAICardTimelineDraft` 做单卡草稿，复用 `timeline-placement` 做落位：`findCollidingItems` 检测冲突、`findNearestAvailablePlacement` 寻空位、`clampOverlayDurationByNeighbors` 收时长。

装配规则（原规划 §三.3）：

- 卡片与语义段落对齐（按 card.sourceStartMs/endMs）。
- 从 0 到音频结尾**视觉全覆盖**：无覆盖区段插入兜底（延展邻近卡片或占位）。
- 卡片间无非法重叠、无超阈值长空档。
- 首帧（t=0）必须有可见画面。
- fullscreen/pip、字幕安全区、轨道规则（复用 `timeline-tracks` 的 `DEFAULT_AI_CARDS_TRACK_ID` 与 `normalizeTimelineData`）。
- 进出场时长不超过卡片持续时间。
- 背景图 / 媒体 / Motion Card 资源可解析（路径存在）。

## 4. 时间线校验（validate）

`src/lib/timeline-validate.ts`，产出结构化报告：

```jsonc
{
  "issues": [
    { "code": "black_gap|out_of_bounds|overlap|missing_asset|motion_compile|enter_exit_too_long|empty_first_frame|low_coverage",
      "severity": "error|warning",
      "overlayId": "...", "timeMs": 0, "message": "...", "repairable": true }
  ],
  "coverageRatio": 0.0,        // 0..1，视觉覆盖音频时长的比例
  "ok": false
}
```

检查项：黑屏空档、超音频边界、重叠、缺素材、Motion Card 编译失败、进出场过长、首帧空、覆盖率不足。Motion 编译检查复用现有 esbuild 卡片编译路径做 smoke compile。

## 5. 时间线修复（repair）

`src/lib/timeline-repair.ts`，针对 validate 标 `repairable` 的项自动修补，输出 patch + 残留不可自动修项：

- 黑屏空档：延展邻近卡片或插入占位卡。
- 超音频边界：裁到边界内。
- 进出场过长：按卡片时长收敛。
- 缺素材 / Motion 编译失败：标记 `needsRegeneration`，不假装修好（交给 Spec 3 触发重生成）。

> **开放决策点 A**：空档修复策略——优先"延展邻近卡片"还是"插入占位黑屏卡 / 背景图"？默认建议先延展邻近卡片，无邻居再插项目背景。review 时确认。

## 6. 导出 QC（qc run + export-and-qc）

`electron/qc/`，复用 `resolveFfprobePath`/`resolveFfmpegPath`：

- `ffprobe-probe.ts`：音视频流、分辨率、帧率、时长；音视频时长差。
- `black-freeze.ts`：黑帧 / 长静止帧（ffmpeg `blackdetect` / `freezedetect`）；0 秒首帧可见性。
- `audio-stats.ts`：音量峰值、静音段、削波（ffmpeg `volumedetect` / `astats`）。
- 复用 Spec 2 §4 的字幕与覆盖率检查：字幕越界/重叠/过长、时间线视觉覆盖率、缺素材 404、Motion Card 编译 + smoke render。

`qc-run.ts` 汇总成报告，落盘 `.lingji/qc/<runId>.json`（补充 Spec 1 目录，新增 `qc/` 子目录）。

`export-and-qc`：导出后自动跑 qc；失败时报告里给出**建议回退步骤**（如 `repair` / `regenerate_card`），但**不自动执行回退**（执行由 Spec 3）。

## 7. 字幕能力（validate / resync / transcribe）

- `subtitle-validate.ts`（纯 TS）：越界（startMs<0 / endMs>audioDuration）、相邻重叠、单条过长、末条与音频时长一致性。复用 `srt-parser` + `media-duration`。
- `subtitle-resync.ts`：在原稿（script.md）约束下纠正漂移时间戳。**保留原字幕**：新版本写为新文件，不覆盖唯一产物（`.original.srt` 备份机制已有，复用）。
- `electron/subtitle/transcribe.ts`：既有音频 ASR（文本 + 词/短语级时间戳）。

> **开放决策点 B**：ASR provider 选型——MiniMax / 本地 Whisper / 外部 API？本 spec 先定义能力接口与数据契约（`{text, segments:[{startMs,endMs,text}]}`），provider 实现标记待定，可先接一个再扩展。

## 8. 代码落点

新增：

```text
src/lib/timeline-assemble.ts      # 纯函数装配
src/lib/timeline-validate.ts      # 纯函数校验
src/lib/timeline-repair.ts        # 纯函数修复
src/lib/subtitle-validate.ts
src/lib/subtitle-resync.ts
electron/qc/
  ffprobe-probe.ts
  black-freeze.ts
  audio-stats.ts
  qc-run.ts
electron/subtitle/transcribe.ts
```

改动既有：

- `src/store/timeline.ts`：`addAICardsToTimeline` 改为调用 `timeline-assemble` 纯函数，store 只负责套用结果。
- `electron/pipeline/tools/` + `cli/src/`：注册 `lingji timeline assemble/validate/repair`、`lingji subtitle validate/resync/transcribe`、`lingji qc run`、`lingji export-and-qc`，登记产物到 `artifacts.json`。
- `electron/runtime-binaries.ts`：确认 ffmpeg/ffprobe 路径在打包后可用（已有，复核 freezedetect/blackdetect 滤镜可用性）。

## 9. 测试（Vitest）

- timeline-assemble：全覆盖、无重叠、首帧可见、进出场收敛、资源解析（纯函数易测，构造 cards+audioDuration 断言 overlays）。
- timeline-validate：每类 issue 的命中与 `coverageRatio` 计算。
- timeline-repair：黑屏空档延展/占位、超界裁剪、缺素材标记 needsRegeneration。
- subtitle-validate / resync：越界/重叠/过长/一致性；resync 不覆盖原文件。
- qc：用小样本 mp4 跑 ffprobe/blackdetect 断言报告字段（或对 ffmpeg 输出做解析单测）。

## 10. 验收标准

1. 给定 enabled cards + 音频，`timeline assemble` 产出**从 0 到音频结尾全覆盖、无非法重叠、首帧可见**的时间线。
2. `timeline validate` 对人为构造的黑屏/越界/缺素材项给出结构化报告；`repair` 能自动修补可修项并如实标记不可修项。
3. `qc run` 对一个导出 mp4 产出含流信息/音视频时长差/黑帧/字幕/覆盖率的报告，落盘 `.lingji/qc/<runId>.json`。
4. `subtitle validate` 能发现越界与不一致；`resync` 产出新版本且保留原字幕。
5. 全部能力可经 MCP/CLI 无头调用，产物登记进 `artifacts.json`。

## 11. 风险与影响面

- 触及原规划/CLAUDE.md 高风险项：修改时间线装配逻辑（影响 `addAICardsToTimeline` 调用方与现有项目）、导出链路旁路新增 QC。需覆盖"已有项目装配不回归"。
- ffmpeg 滤镜（blackdetect/freezedetect）在打包后的可用性需实测；若缺失需降级为仅 ffprobe 级检查。
- 与 Spec 3 切线：本 spec 只产出"建议回退步骤"，真正自动回退/重试由 Spec 3，避免在能力层写编排。
- 装配纯函数化需确保与 store 行为等价，迁移时用快照测试兜底。

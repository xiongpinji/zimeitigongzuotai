# Subtitle Keyword Highlight Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 16:9 视频博客字幕增加由 AI 自动生成的关键词高亮能力，并以统一的 Impact Highlight 风格稳定渲染。

**Architecture:** 保持原始 `SrtEntry` 不变，在 `TimelineData` 上新增字幕高亮标注集合；新增独立的 AI 高亮服务与结果校验逻辑；Remotion 渲染层只读取合法高亮结果并拆分为前缀、高亮段、后缀三段输出。编辑器侧提供显式生成与重新生成入口，不在字幕编辑时自动触发模型。

**Tech Stack:** React 19, TypeScript, Zustand, Remotion, Vitest, fetch-based LLM API

---

## Chunk 1: 建立高亮数据结构与校验基础

### Task 1: 扩展字幕样式与高亮标注类型

**Files:**
- Modify: `src/types.ts`
- Test: `tests/timeline-store.test.ts`

- [ ] Step 1: 在 `src/types.ts` 中新增 `SubtitleHighlight` 类型，字段包含 `entryIndex`、`start`、`end`、`highlightText`、`sourceText`
- [ ] Step 2: 扩展 `SubtitleStyle`，加入 `highlightEnabled`、`highlightBackgroundColor`、`highlightTextColor`、`highlightPaddingX`、`highlightPaddingY`、`highlightRadius`、`highlightAnimation`
- [ ] Step 3: 在 `TimelineData` 中新增 `subtitleHighlights?: SubtitleHighlight[]`
- [ ] Step 4: 更新 `createDefaultTimeline()` 的默认字幕样式值，确保不破坏现有普通字幕渲染
- [ ] Step 5: 在 `tests/timeline-store.test.ts` 中新增默认时间线断言，验证默认字幕配置包含新的高亮字段
- [ ] Step 6: 运行 `npm test -- tests/timeline-store.test.ts`

### Task 2: 实现高亮结果校验与失效判断工具

**Files:**
- Create: `src/lib/subtitle-highlights.ts`
- Test: `tests/subtitle-highlights.test.ts`

- [ ] Step 1: 在 `src/lib/subtitle-highlights.ts` 中实现 `isValidSubtitleHighlight(entry, highlight)`，校验坐标范围与 `highlightText === entry.text.slice(start, end)`
- [ ] Step 2: 实现 `isExpiredSubtitleHighlight(entry, highlight)`，当 `entry.text !== sourceText` 时返回过期
- [ ] Step 3: 实现 `filterValidSubtitleHighlights(entries, highlights)`，仅保留合法且未过期的高亮结果
- [ ] Step 4: 在 `tests/subtitle-highlights.test.ts` 中写失败用例，覆盖非法坐标、文本切片不匹配、字幕变更后过期三类场景
- [ ] Step 5: 运行 `npm test -- tests/subtitle-highlights.test.ts`

## Chunk 2: 接入 AI 关键词高亮生成链路

### Task 3: 定义 AI 高亮请求与响应结构

**Files:**
- Create: `src/lib/subtitle-highlight-ai.ts`
- Modify: `src/lib/llm-client.ts`
- Test: `tests/subtitle-highlight-ai.test.ts`

- [ ] Step 1: 在 `src/lib/subtitle-highlight-ai.ts` 中定义 `SubtitleHighlightLLMResult` 类型，仅包含 `entryIndex`、`shouldHighlight`、`highlightText`、`start`、`end`
- [ ] Step 2: 实现 `buildSubtitleHighlightSystemPrompt()`，明确高亮标准、单条最多一段、`end` 为 exclusive、无重点时返回 `shouldHighlight=false`
- [ ] Step 3: 实现 `buildSubtitleHighlightUserMessage(entries, context)`，向模型提供当前字幕和前后文
- [ ] Step 4: 复用 `src/lib/llm-client.ts` 的 JSON 调用能力，不新增新的网络协议
- [ ] Step 5: 在 `tests/subtitle-highlight-ai.test.ts` 中验证 prompt 和 user message 包含关键约束，不允许出现样式控制字段
- [ ] Step 6: 运行 `npm test -- tests/subtitle-highlight-ai.test.ts`

### Task 4: 实现 AI 返回结果解析与存储映射

**Files:**
- Create: `src/lib/subtitle-highlight-service.ts`
- Modify: `src/lib/llm-client.ts`
- Test: `tests/subtitle-highlight-service.test.ts`

- [ ] Step 1: 在 `src/lib/subtitle-highlight-service.ts` 中实现 `parseSubtitleHighlightResponse(payload)`，读取模型 JSON 并转换为内部结果数组
- [ ] Step 2: 将 `shouldHighlight=false` 的结果映射为“无高亮”，不写入最终高亮集合
- [ ] Step 3: 对 `shouldHighlight=true` 的结果补齐 `sourceText`
- [ ] Step 4: 使用 `filterValidSubtitleHighlights` 过滤非法结果，保证只输出合法高亮标注
- [ ] Step 5: 在 `tests/subtitle-highlight-service.test.ts` 中覆盖：合法结果保留、无高亮结果丢弃、非法切片结果被过滤
- [ ] Step 6: 运行 `npm test -- tests/subtitle-highlight-service.test.ts`

## Chunk 3: 扩展状态管理与编辑器入口

### Task 5: 为时间线 store 增加高亮标注写入能力

**Files:**
- Modify: `src/store/timeline.ts`
- Test: `tests/timeline-store.test.ts`

- [ ] Step 1: 在 `TimelineStore` 中新增 `setSubtitleHighlights(highlights)` 方法
- [ ] Step 2: 新增 `clearSubtitleHighlights()` 方法，供重新生成前或失败后使用
- [ ] Step 3: 保证写入高亮结果会进入 undo/redo 历史，而不是直接静默覆盖
- [ ] Step 4: 当 `setSrtEntries()` 被调用且文本变更时，不自动删结果，但依赖渲染层校验判定过期
- [ ] Step 5: 在 `tests/timeline-store.test.ts` 中新增高亮写入与清空的 store 行为测试
- [ ] Step 6: 运行 `npm test -- tests/timeline-store.test.ts`

### Task 6: 在时间线字幕轨提供生成与重生成功能入口

**Files:**
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/TimelineSubtitleBlocks.tsx`
- Modify: `src/store/ai.ts`
- Test: `tests/timeline.test.tsx`

- [ ] Step 1: 在 `src/components/Timeline.tsx` 中找到字幕轨区域的操作入口，加入“生成关键词高亮”与“重新生成高亮”按钮
- [ ] Step 2: 为按钮接入 AI 配置缺失校验，复用 `getAISettingsIssue()`，缺配置时给出明确提示
- [ ] Step 3: 在 `src/components/TimelineSubtitleBlocks.tsx` 中加入“高亮已过期”或“未生成高亮”的可视反馈占位，避免用户不知道当前状态
- [ ] Step 4: 在 `src/store/ai.ts` 或相邻 UI 状态中补充生成中/失败状态，避免把该状态混进卡片分析流程
- [ ] Step 5: 在 `tests/timeline.test.tsx` 中添加字幕轨按钮与状态提示渲染测试
- [ ] Step 6: 运行 `npm test -- tests/timeline.test.tsx`

## Chunk 4: 实现 Remotion 渲染与视觉样式

### Task 7: 将字幕渲染改为三段式输出

**Files:**
- Modify: `src/remotion/SubtitleTrack.tsx`
- Modify: `src/lib/subtitle-highlights.ts`
- Test: `tests/preview.test.ts`

- [ ] Step 1: 在 `SubtitleTrack` 中根据 `entry.index` 查找当前字幕的合法高亮结果
- [ ] Step 2: 将字幕文本拆成 `before`、`highlight`、`after`
- [ ] Step 3: 仅当高亮结果合法且未过期时渲染高亮块，否则退回普通整句字幕
- [ ] Step 4: 将高亮块实现为圆角 chip，颜色、内边距、圆角由 `timeline.subtitle` 提供
- [ ] Step 5: 在 `tests/preview.test.ts` 中新增高亮字幕渲染断言，验证高亮文本与普通文本可同时输出
- [ ] Step 6: 运行 `npm test -- tests/preview.test.ts`

### Task 8: 加入轻量高亮动画与默认样式调优

**Files:**
- Modify: `src/remotion/SubtitleTrack.tsx`
- Modify: `src/types.ts`
- Test: `tests/remotion-assets.test.ts`

- [ ] Step 1: 为 `highlightAnimation` 提供 `pop | wipe | none` 的类型约束，第一版默认 `pop`
- [ ] Step 2: 在 `SubtitleTrack` 中仅实现一套轻量强调动画，避免逐词闪动或持续跳动
- [ ] Step 3: 收敛阴影和高亮块样式，确保在亮背景和暗背景中都可读
- [ ] Step 4: 在 `tests/remotion-assets.test.ts` 或相邻 Remotion 测试中补充默认字幕样式快照/结构断言
- [ ] Step 5: 运行 `npm test -- tests/remotion-assets.test.ts`

## Chunk 5: 打通 AI 生成流程与完成验证

### Task 9: 打通批量生成流程

**Files:**
- Create: `src/lib/subtitle-highlight-runner.ts`
- Modify: `src/components/Timeline.tsx`
- Modify: `src/lib/ai-settings.ts`
- Test: `tests/subtitle-highlight-runner.test.ts`

- [ ] Step 1: 在 `src/lib/subtitle-highlight-runner.ts` 中实现批量调用流程：读取 AI 配置、构建请求、调用模型、解析、校验、返回最终高亮结果
- [ ] Step 2: 对超长字幕列表采用分批提交，避免一次请求内容过大
- [ ] Step 3: 失败时返回用户可理解的错误信息，不污染现有高亮结果
- [ ] Step 4: 在 `tests/subtitle-highlight-runner.test.ts` 中覆盖成功生成、部分条目非法、调用失败三类场景
- [ ] Step 5: 运行 `npm test -- tests/subtitle-highlight-runner.test.ts`

### Task 10: 回归验证与文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-04-03-subtitle-keyword-highlight-design.md`
- Modify: `src/components/Timeline.tsx`
- Modify: `src/store/timeline.ts`
- Modify: `src/remotion/SubtitleTrack.tsx`
- Test: `tests/timeline-store.test.ts`
- Test: `tests/timeline.test.tsx`
- Test: `tests/preview.test.ts`

- [ ] Step 1: 运行 `npm test -- tests/timeline-store.test.ts tests/timeline.test.tsx tests/preview.test.ts tests/subtitle-highlights.test.ts tests/subtitle-highlight-ai.test.ts tests/subtitle-highlight-service.test.ts tests/subtitle-highlight-runner.test.ts`
- [ ] Step 2: 运行 `npm run build`
- [ ] Step 3: 手动验证导入 SRT、点击生成关键词高亮、查看亮背景与暗背景中的字幕效果
- [ ] Step 4: 手动修改一条字幕文本，确认旧高亮自动失效并提示可重新生成
- [ ] Step 5: 若实现与 spec 存在偏差，回写 `docs/superpowers/specs/2026-04-03-subtitle-keyword-highlight-design.md`

## 交付完成定义

- [ ] AI 能批量为字幕返回结构化高亮区间
- [ ] 前端只渲染合法高亮结果
- [ ] 非法或过期高亮不会破坏普通字幕显示
- [ ] 用户可在字幕轨显式生成和重新生成高亮
- [ ] 默认样式符合 16:9 视频博客的 Impact Highlight 风格
- [ ] 测试与构建通过

# Spec 5 · 研究 + 事实核验 + 文稿闭环

- 日期：2026-06-15
- 状态：设计草稿，待 review
- 所属轨道：轨道二 · 写稿闭环（Phase 2）
- 依赖：Spec 1（持久化 / artifacts）、Spec 4（creative-brief 的引用事实标准）

## 1. 背景与目标

让 AI 参与内容创作而不仅是视频生成：补齐**研究、结构化事实核验、高风险门禁、文稿版本对比、口播试听审批**。写稿 / 审稿 / 版本历史已大量存在，本 spec **不重写**它们，重点补研究与事实核验（原规划 §三.3 文稿、Phase 2）。

现状关键事实（已核对代码）：

- LLM 层完整：`src/lib/llm/`（`model.ts` 多 provider；`index.ts` 的 `streamText` / `generateStructuredData` 带 JSON 校验重试）。
- 写稿管线完整：`lingji_write_script`（`electron/mcp/tools.ts`）+ 虚拟光标/流式编辑（`virtual-cursor.ts` / `live-streaming-editor.ts` / `streaming-editor.ts`）。
- 审稿管线完整：`lingji_review_script` + `Annotation` 数据结构（`src/store/script.ts`）+ `review-cursor-animator.ts`；prompt kind `script.review`。
- 版本历史完整：每次保存触发 `scriptHistoryAPI.create()`（SQLite）+ `VersionDropdown` / `VersionPreviewBar`。**缺版本 diff 视图**。
- **研究、事实核验完全为零**：无 web search/fetch、无 fact-check 代码 / prompt / 数据结构。
- 口播试听**部分**：TTS 生成完整（`electron/pipeline/runs/tts-run.ts`），但**缺试听 / 改提示词重生成 / 审批 UI**。

目标：新增研究与事实核验能力（含高风险门禁）、补文稿 diff 与口播试听审批，全部复用既有 LLM / prompts / 版本 / 审稿体系。

## 2. 交付边界

纳入：

- `research run`（联网研究 → 报告 + 引用来源）。
- 结构化 `fact-check run`（断言核验 → 结构化报告）+ 高风险选题门禁。
- 文稿版本 diff 视图。
- 口播试听审批 UI（试听 / 改提示词重生成 / 通过）。
- 新增 prompt kind：`research.*` / `fact.check` / `audio.review`。
- 引用溯源（研究/核验来源贯穿稿件与 artifacts）。

不纳入：

- 写稿 / 审稿管线重写（已有，仅复用）。
- 多 Agent 协作。

## 3. 研究能力（research run）

- 输入：选题 / 素材（original.md、用户提供链接）+ creative-brief。输出：研究报告 + 结构化引用来源，登记为 artifact（`kind: research`，Spec 1）。
- 用 `generateStructuredData` 产出 `{ summary, keyPoints[], sources:[{title,url,snippet}] }`。

> **开放决策点 A（关键）**：联网信息源——项目当前**无任何 web search/fetch 能力**。可选：
> 1. 接外部搜索 API（Exa / Tavily / Bing）——需 API key 管理。
> 2. 复用外部 Agent（Claude Code / Codex）已有的 WebSearch 工具，软件只编排。
> 3. 仅用用户提供的素材/链接做整理，不主动联网。
>
> 建议先定义 `ResearchProvider` 抽象，一期接一个（倾向方案 2 或 3，避免新增 key 管理），review 时定。

## 4. 事实核验（fact-check run）

结构化 schema（原规划原文）：

```jsonc
{
  "claim": "原稿中的具体断言",
  "status": "verified|uncertain|incorrect",
  "sourceUrls": [],
  "evidence": "",
  "suggestion": ""
}
```

- `fact-check run`：从 script.md 抽取断言 → 逐条核验（用研究来源 + LLM）→ 产出报告数组，登记 artifact（`kind: factcheck`）。核验结果可转成审稿 `Annotation`（复用现有批注 UI 展示 incorrect/uncertain 项）。
- **高风险门禁**：金融 / 医疗 / 法律等选题必须通过 `fact_check` 才能进入 TTS。门禁与 Spec 3 编排器挂钩——该类项目的 `tts` step 依赖 `fact-check` step 为 `verified/通过`。

> **开放决策点 B**：高风险选题如何判定——creative-brief 里用户显式标注 `riskLevel`，还是 LLM 自动分类？默认用 brief 显式标注 + LLM 兜底建议。

## 5. 文稿版本对比（diff）

补 diff 视图：现有版本历史是 SQLite + 预览（`VersionPreviewBar`），无 diff。复用 `scriptHistoryAPI.get()` 取两版本内容，渲染行级 diff（复用项目已有 diff 能力或轻量 diff 库）。入口在 `VersionDropdown` 旁加"对比"。

## 6. 口播试听审批

TTS 生成后进入试听审批：播放 podcast-audio + 字幕预览 → 用户可"通过 / 改提示词重生成"。对接 Spec 3 编排器的 `voice` 审批节点（`review` 策略）。复用现有播放器（`RemotionPreviewPlayer` / 音频播放），新增审批操作条。

## 7. Prompt Kind 扩展

走现有三层 prompts 体系（builtin/global/project），新增：

- `research.prepare`：研究整理。
- `fact.check`：事实核验。
- `audio.review`：口播试听反馈（可选，供 AI 给试听建议）。

在 `src/lib/prompts/defaults.ts` 加默认 YAML，`PROMPT_KIND_META` 加元数据。

## 8. 引用溯源

研究/核验的 `sources` 写入对应 artifact 的 `inputs`/元数据；fact-check 的 incorrect 项以 `Annotation` 形式落到文稿，`suggestion` 可一键采纳（复用现有审稿采纳路径）。

## 9. 代码落点

新增：

```text
electron/research/run.ts          # research run + ResearchProvider 抽象
electron/fact-check/run.ts        # fact-check run
src/types/research.ts             # ResearchReport / FactCheckResult 类型
src/components/script/VersionDiff.tsx
src/components/script/VoiceAuditionBar.tsx
```

改动既有：

- `src/lib/prompts/defaults.ts` + `types.ts`：新增 kind。
- `electron/pipeline/tools` + `cli/src/`：`lingji research run` / `lingji fact-check run`。
- `electron/mcp/tools.ts`：可选暴露给外部 Agent。
- Spec 3 编排器：插入 `research` / `fact-check` step 与高风险 `tts` 门禁；插入 `voice` 审批节点。
- `src/components/script/VersionDropdown.tsx`：加"对比"入口。

## 10. 测试（Vitest）

- fact-check：结构化 schema 校验、断言抽取、incorrect→Annotation 转换。
- research：ResearchProvider 抽象 mock、报告结构、sources 登记。
- 高风险门禁：标注高风险项目时 tts step 被 fact-check 阻塞 / 通过后放行。
- diff：两版本行级差异渲染。
- 试听审批：通过 / 重生成的状态流转。

## 11. 验收标准（对齐原规划 Phase 2）

1. 用户输入选题 + 素材 → AI 产出带引用、可溯源的研究报告。
2. 文稿经结构化事实核验，incorrect/uncertain 断言以批注呈现并可采纳建议。
3. 高风险选题未过 fact-check 时无法进入 TTS。
4. 文稿可在两版本间看 diff；TTS 后可试听并审批/重生成，再自动进入成片流程（Spec 3）。

## 12. 风险与影响面

- 联网研究信息源是最大未决项（开放决策点 A），直接影响能否真正"研究"；若一期只做素材整理，需如实说明能力边界。
- 事实核验质量依赖来源质量，`uncertain` 应是默认保守态，避免给出虚假"verified"。
- 触及高风险项：新增联网调用（安全/隐私）、API key 管理（若选外部搜索，key 不得进 Agent 上下文 / 项目文件）。
- 与 Spec 3 编排器耦合：门禁与审批节点需在 Spec 3 的 workflow-registry 留好挂载点，避免回头改 DAG。

# Spec 4 · Creative Brief / Style Bible

- 日期：2026-06-15
- 状态：设计草稿，待 review
- 所属轨道：轨道二 · 写稿闭环（Phase 2）
- 依赖：Spec 1（持久化基座 / 契约版本）

## 1. 背景与目标

让软件存储**长期创作意图**，而不是每次靠聊天上下文，使 AI 稳定产出统一风格的作品；用户改一次即可全链路生效（原规划 §三.8）。

现状关键事实（已核对代码）：

- 风格体系已完整：`VisualStylePreset`（`src/types/ai.ts`，含 palette/fonts/facets）+ 10 个内置预设（`src/lib/card-style-presets.ts`）；字幕样式 `SubtitleStyle`（`src/types.ts`，存 timeline 段）；脚本模板 3 个（`src/lib/prompts/script-template-defaults.ts`）；`CustomRole` 角色指令（全局 settings）。
- 三层提示词 + 绑定：6 个 PromptKind（`src/lib/prompts/types.ts`），builtin/global/project 三层（`electron/prompts-io.ts`），`PromptBindingMap`（`electron/prompt-bindings-io.ts`，项目级存 `configs/prompt-bindings.json`）。
- 注入点已存在：`src/lib/ai-analysis.ts` 的 `AnalyzeSrtOptions`（`globalPrompt` / `projectStylePresetId` / `defaultStylePresetId` / `projectBindings`）。
- 项目级风格：`ProjectData.stylePresetId`；全局 `AISettings.defaultStylePresetId`；全局封面提示词 `globalCoverImagePrompt`。
- **缺失**：平台 / 受众 / 时长 / 画幅 / 内容目标 / 禁区 / 口播语言风格 / 引用事实标准 / 封面规范 / 片头尾 / 水印 / 创作者信息等**长期创作意图字段**。

目标：新增 `creative-brief.json` 与 `style-bible.json` 两个项目级配置，定义 schema + 读写 IO + 注入既有生成链路 + 设置 UI；复用现有风格/模板/绑定体系，不另起炉灶。

## 2. 交付边界

纳入：

- `creative-brief.json` / `style-bible.json` 的 schema、读写 IO、契约版本（接入 Spec 1）。
- 注入既有生成链路：`ai-analysis` 分析、cover/card/motion 提示词拼接、TTS 风格、字幕样式默认。
- 设置 UI：编辑 brief 与 style-bible。
- 与现有 `stylePresetId` 的优先级关系。

不纳入：

- 研究 / 事实核验（Spec 5，brief 里的"引用事实标准"仅作为 Spec 5 门禁的输入数据）。
- 从 brief 自动生成内容（仍由各生成步骤消费 brief，不在本 spec 做新生成器）。

## 3. 数据模型

落点：`<projectDir>/configs/`（与现有 `prompt-bindings.json`、`configs/prompts/` 一致）。

> **开放决策点 A**：放 `configs/` 还是项目根目录？默认 `configs/`，与既有项目级配置统一、不污染根目录。

**`configs/creative-brief.json`**：

```jsonc
{
  "schemaVersion": 1,
  "platform": "douyin|xiaohongshu|bilibili|...",
  "audience": "面向人群描述",
  "durationTargetSec": 180,
  "aspectRatio": "9:16|16:9|1:1",
  "contentGoal": "内容目标",
  "coreThesis": "核心观点",
  "forbidden": ["禁区/不能说的话题"],
  "narration": { "roleId": "引用 CustomRole 或内联", "languageStyle": "口播语言风格" },
  "citationStandard": "引用与事实标准（供 Spec 5 门禁读取）",
  "subtitleStyleOverride": { /* 部分 SubtitleStyle 字段覆盖 */ }
}
```

**`configs/style-bible.json`**：

```jsonc
{
  "schemaVersion": 1,
  "baseStylePresetId": "editorial-eink",   // 引用现有 VisualStylePreset 作基底
  "paletteOverride": { "bg": "", "ink": "", "accent": "" },
  "fontsOverride": { "display": "", "body": "", "mono": "" },
  "cardDensity": "low|medium|high",
  "coverSpec": "封面规范（与 globalCoverImagePrompt 协同）",
  "intro": "片头规范", "outro": "片尾规范",
  "watermark": "水印", "creator": "创作者信息"
}
```

## 4. 注入既有生成链路

- 扩展 `AnalyzeSrtOptions`，注入 `creativeBrief` / `styleBible`；`ai-analysis` 在生成 planning/cards/cover 提示词时拼接为 system block。
- cover / card.image / card.video / motion 提示词：在现有 `{{styleSystemBlock}}` 拼接位追加 style-bible 的色板/字体/封面/卡片密度。
- TTS：读 brief 的 `narration`（角色 + 语言风格）。
- 字幕样式：新项目默认从 brief 的 `subtitleStyleOverride` 套用到 `TimelineData.subtitle`。

## 5. 与现有 stylePresetId 的优先级

定义单一优先级链，避免双源冲突：

```text
style-bible.paletteOverride/fontsOverride
  > style-bible.baseStylePresetId 指向的 VisualStylePreset
  > ProjectData.stylePresetId
  > AISettings.defaultStylePresetId（全局）
```

即：style-bible 存在时它是项目风格的权威来源，`baseStylePresetId` 提供基底、override 字段逐项覆盖；无 style-bible 时回退到现有 `stylePresetId` 行为。

## 6. 设置 UI

在现有设置中心的模板/风格区新增 Brief 与 Style Bible 编辑面板（复用 `src/components/settings/` 既有 pattern），改动即时写 `configs/*.json`。

## 7. 代码落点

新增：

```text
electron/creative-brief-io.ts    # 仿 prompt-bindings-io.ts
electron/style-bible-io.ts
src/types/creative.ts            # CreativeBrief / StyleBible 类型
src/components/settings/CreativeBriefTab.tsx (或并入现有 tab)
```

改动既有：

- `src/lib/ai-analysis.ts`：`AnalyzeSrtOptions` 注入 brief/style-bible。
- `src/lib/prompts/` 或生成提示词拼接处：拼接 style block。
- 各 headless 生成工具（`electron/pipeline/`）：读取 brief/style-bible 传入。
- Spec 1 契约：`creative-brief.json` / `style-bible.json` 的 `schemaVersion` 纳入统一校验器。

## 8. 迁移与兼容

旧项目无 brief/style-bible → 全部回退到现有全局默认 / `stylePresetId` 行为，不强制创建；首次在设置里编辑时才落盘文件。

## 9. 测试（Vitest）

- brief/style-bible 读写 + schema 校验 + 缺省回退。
- 优先级链：style-bible override > baseStylePresetId > project stylePresetId > 全局默认。
- 注入：`AnalyzeSrtOptions` 带 brief 时提示词拼接包含对应字段。
- 兼容：无 brief 的旧项目分析行为不回归。

## 10. 验收标准

1. 在设置里填一次 brief（平台/受众/画幅/语言风格）与 style-bible（色板/字体/卡片密度/封面规范），落盘到 `configs/`。
2. 后续 AI 分析、卡片、封面、TTS、字幕默认样式都读取这两个文件，改一次全链路生效。
3. 无 brief 的旧项目行为保持不变。

## 11. 风险与影响面

- 触及高风险项：修改 AI 提示词拼接与 `AnalyzeSrtOptions`（影响所有生成质量），需用快照测试保证无 brief 时输出不变。
- 风格优先级链必须单一明确，否则 style-bible 与 stylePresetId 双源会产生不可预期的视觉漂移。
- 字段集合不宜一次铺满——优先覆盖对生成质量影响最大的字段（平台/画幅/语言风格/色板/卡片密度），其余迭代补。

> **开放决策点 B**：字段集合的最终范围（是否一期就纳入片头/片尾/水印），review 时确认。

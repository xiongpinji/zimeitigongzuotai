# 设计规格：风格库与「项目统一风格」合并（移除自由文本 project.style）

- 日期：2026-06-01
- 状态：已通过 brainstorming 评审，待写实现计划
- 作者：yoqu + Claude Code
- 前置：`2026-06-01-card-style-template-library-design.md`（已实现并合入 develop）

## 1. 背景

风格模板库已落地，但留下了两个语义重叠的「项目风格」概念：

- **自由文本 `project.style`** → `{{projectStylePrompt}}` / `{{projectStylePromptBlock}}`，注入全部 5 个提示词（planning.segment、cover.regeneration、cards.segment、card.image、card.video），表达整期统一调性/品牌。
- **风格预设 facet** → `{{styleSystemBlock}}`，仅注入 3 个卡片提示词（cover.regeneration、cards.segment、card.image），表达卡片视觉系统。

两者并存导致配置入口分散、概念冗余。本次将其合并为**只选模板**：删除自由文本 `project.style`，项目统一风格完全由所选风格预设承载。

## 2. 关键决策（brainstorming 结论）

| 维度 | 结论 |
|---|---|
| 自由文本 project.style | **完全移除**，只选模板 |
| UI 整合 | **彻底整合**：提示词配置内的「项目统一风格」改为模板选择器；删独立风格库 tab 与 AIPanel 风格弹窗；保留 Inspector 单卡覆盖 |
| 派生风格摘要 | **否**：不为无 styleSystemBlock 的 prompt 派生摘要，直接移除 `{{projectStylePrompt}}` 注入 |

## 3. 提示词层改动

### 3.1 移除 projectStylePrompt 注入

从全部 5 个提示词移除 `{{projectStylePrompt}}` 与 `{{projectStylePromptBlock}}` 占位符，并从 `PROMPT_KIND_META` 对应 `variables` 数组移除这两个变量元数据：

- **cards.segment / cover.regeneration / card.image**：保留 `{{styleSystemBlock}}`。删除「项目风格：{{projectStylePrompt}}」上下文行（cards.segment）/「项目统一风格要求：{{projectStylePrompt}}」块。风格完全由 facet 承载。版本号各 +1。
- **planning.segment**：移除 `{{projectStylePromptBlock}}`（该 prompt 无 styleSystemBlock）。移除后仅保留 `{{globalPrompt}}`（整期创作提示词）。版本号 +1。
- **card.video**：移除 `{{projectStylePrompt}}`。仅保留段落信息 + globalPrompt 链路。版本号 +1。

### 3.2 移除 project.style 提示词类型

- 从 `PROMPT_KINDS`（`src/lib/prompts/types.ts`）移除 `'project.style'`。
- 从 `DEFAULT_PROMPT_YAML`（`defaults.ts`）移除 `PROJECT_STYLE` 条目与常量。
- 从 `PROMPT_KIND_META` 移除 `'project.style'`。
- 删除 `src/lib/project-style-prompt.ts`（`getProjectStylePromptFromTemplate` / `projectStylePromptValue` / `buildProjectStylePromptBlock`）。
- 移除 `src/lib/ai-analysis.ts` 中对上述助手的 import 与 5 个 build 函数里的 `projectStylePrompt` / `projectStylePromptBlock` 入参与 vars 行。
- 移除 `electron/main.ts` 中 `loadEffectivePromptTemplate('project.style', ...)` + `getProjectStylePromptFromTemplate(...)` 的装载逻辑（各分析/重生成 handler）。

### 3.3 行为变更须知（有意）

- 默认情况下，3 个卡片提示词原本除 styleSystemBlock 外还注入默认项目风格文本（「冷静克制的现代科技纪录片…」）；移除后卡片视觉**纯由所选预设 facet 决定**（默认 editorial-eink 即"深色克制·系统蓝"，与原默认文本语义高度重叠）。
- planning.segment / card.video 不再获得统一风格引导（仍有 globalPrompt）。
- 这是合并的必然结果，非回归。原 card-style-template-library 的「editorial-eink 注入后与原 cards.segment 字节一致」属性在本次后**不再适用**（因为有意移除了 projectStylePrompt 行）；新的等价基线 = 不含 projectStylePrompt 的提示词 + 所选 facet。

## 4. UI 整合

### 4.1 提示词配置 tab（`src/components/settings/PromptsConfigTab.tsx`）

- `project` 分组当前唯一成员是 `project.style`。移除该 kind 后，将该分组（或其原编辑区）替换为**风格模板选择器**（复用 `StyleLibraryPanel`）。
- 复用现有「全局 / 当前项目」scope 切换：
  - scope=全局 → `value = resolveStylePresetId({ global: settings.defaultStylePresetId })`，`onChange` 写 `defaultStylePresetId`（经 `saveAISettings`）。
  - scope=项目（仅项目打开时可用）→ `value = projectStylePresetId ?? ''`，`onChange` 调 `setProjectStylePresetId`；提供「跟随全局默认」清除项（→ `setProjectStylePresetId(undefined)`）。
- 该选择器不走 readPrompt/writePrompt 文本路径，而是走风格预设的 store/持久化（已存在）。其余 prompt kind 的文本编辑路径不变。

### 4.2 删除冗余入口

- 删除 `src/components/settings/StyleLibraryTab.tsx` 与 `Settings.tsx` 中 `'style-library'` tab（union、TABS 条目、TabsContent、Palette import）。
- 删除 `src/components/AIPanel.tsx` 中项目风格 Dialog（撤回上轮 Task 11b 改动：styleRow、Dialog、相关 state、CSS 类、imports）。
- 保留 `src/components/AICardInspector.tsx` 单卡风格选择器不变。

## 5. 持久化与迁移

- `settings.defaultStylePresetId`（全局）/ `ProjectData.stylePresetId`（项目）/ `AICard.stylePresetId`（单卡）机制全部不变。
- 已保存的自定义 `project.style` 覆盖（全局 prompts 目录 / 项目 `configs/prompts/`）变为**孤立文件，不再读取**，不做迁移（保留磁盘，无副作用）。
- `resolveStylePresetId` 缺省仍回退 `editorial-eink`。

## 6. 改动文件清单

修改：
- `src/lib/prompts/defaults.ts`：移除 PROJECT_STYLE；5 个提示词去 projectStylePrompt 占位符；版本号递增；从 DEFAULT_PROMPT_YAML 移除 project.style。
- `src/lib/prompts/types.ts`：PROMPT_KINDS 去 'project.style'；PROMPT_KIND_META 去该条；5 处 variables 去 projectStylePrompt/projectStylePromptBlock。
- `src/lib/ai-analysis.ts`：5 个 build 函数去 projectStylePrompt 相关入参/vars + import。
- `electron/main.ts`：去 project.style 装载逻辑（保留 loadProjectStylePresetId 等风格预设逻辑）。
- `src/components/settings/PromptsConfigTab.tsx`：project.style 区改为 StyleLibraryPanel 选择器（全局/项目 scope）。
- `src/pages/Settings.tsx`：删 style-library tab。
- `src/components/AIPanel.tsx`（+ `.module.css`）：删项目风格 Dialog。

删除：
- `src/lib/project-style-prompt.ts`
- `src/components/settings/StyleLibraryTab.tsx`

测试：
- 更新 `tests/ai-analysis.test.ts`：去除依赖 projectStylePrompt 文本（如 `必须使用简体中文` 之类若来自 facet 仍在；`项目统一风格要求` 断言移除）。
- 更新 `tests/card-style-prompt-injection.test.ts`：保留 styleSystemBlock 注入断言；新增断言提示词**不再含** `{{projectStylePrompt}}`。
- 新增/更新 PromptsConfigTab 选择器相关测试（若现有该组件有测试）。
- 移除/更新引用 project.style kind 的测试。

## 7. 验收标准

1. 提示词配置「项目统一风格」处显示风格模板选择器；全局/项目 scope 切换分别写 defaultStylePresetId / projectStylePresetId；项目可「跟随全局默认」。
2. 独立风格库设置 tab 与 AIPanel 风格弹窗已删除；Inspector 单卡覆盖仍在。
3. 选定风格后生成 3 个卡片提示词正确注入对应 facet；提示词中不再出现 `{{projectStylePrompt}}` / 项目风格文本。
4. planning.segment / card.video 不再含 projectStylePrompt，仍含 globalPrompt。
5. `project.style` 提示词类型及自由文本编辑入口完全移除；无悬挂引用（`npm run build` 通过、类型无误）。
6. 旧项目打开不崩溃；风格缺省解析为 editorial-eink。
7. `npm test` 相关用例通过。

## 8. 风险

- 删除 `project.style` PromptKind 是受影响面较广的类型变更（`Record<PromptKind,...>`、遍历 PROMPT_KINDS 处由 TS 兜底）。实现时以 `npm run build` 全量类型检查兜底。
- 有意的默认生成行为变更（见 3.3），需在 CHANGELOG/发版说明体现。

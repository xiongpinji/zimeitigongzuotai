# 风格库合并进项目统一风格（移除 project.style）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除自由文本 `project.style` 与 `{{projectStylePrompt}}` 注入，把「项目统一风格」收敛为只选风格模板，并整合 UI 入口。

**Architecture:** 分阶段拆除 projectStylePrompt：先从提示词模板与元数据移除占位符（保持 build 绿），再从 `ai-analysis.ts` 拆参数，再从 `electron/main.ts` + `card-media-handlers.ts` 拆装载，最后删除 `project.style` 提示词类型与助手；UI 侧把提示词配置的 project 分组改为风格选择器并删除冗余入口。每个任务保持 `npm run build` 绿。

**Tech Stack:** TypeScript / React 19 / electron-vite / Zustand / Vitest。

参考规格：`docs/superpowers/specs/2026-06-01-merge-style-library-into-project-style-design.md`

**关键安全网：** 这是一次大面积的机械式移除（projectStylePrompt 在 ai-analysis.ts/main.ts 有 ~40 处）。每个任务以 `npm run build`（全量 TS 检查）+ 目标 grep 归零 + 既有测试不回归作为门槛。

---

## File Structure

- `src/lib/prompts/defaults.ts` — 5 个提示词去 `{{projectStylePrompt}}`/`{{projectStylePromptBlock}}`；删 `PROJECT_STYLE` 常量与 DEFAULT_PROMPT_YAML 条目。
- `src/lib/prompts/types.ts` — `PROMPT_KINDS` 去 `'project.style'`；`PROMPT_KIND_META` 去该条；5 处 `variables` 去 projectStylePrompt 两个变量。
- `src/lib/ai-analysis.ts` — 拆 projectStylePrompt 参数/vars/import（~25 处）。
- `electron/main.ts` — 拆 project.style 装载与传参；修 `appendProjectStylePrompt(withCoverSuffix, projectStylePrompt)`。
- `electron/card-media-handlers.ts` — 拆 `appendProjectStylePrompt` + `ctx.projectStylePrompt`。
- 删除 `src/lib/project-style-prompt.ts` + `src/lib/project-style-prompt.test.ts`。
- `src/components/settings/PromptsConfigTab.tsx` — project 分组改为 `StyleLibraryPanel` 选择器（全局/项目 scope）。
- `src/pages/Settings.tsx` — 删 `style-library` tab。删除 `src/components/settings/StyleLibraryTab.tsx`。
- `src/components/AIPanel.tsx`(+`.module.css`) — 删项目风格 Dialog（撤回上轮 Task 11b）。
- 测试：`tests/ai-analysis.test.ts`、`tests/card-style-prompt-injection.test.ts` 更新。

---

## Task 1: 提示词模板与元数据去 projectStylePrompt 占位符

**Files:**
- Modify: `src/lib/prompts/defaults.ts`
- Modify: `src/lib/prompts/types.ts`
- Test: `tests/card-style-prompt-injection.test.ts`

> 本任务保留 `project.style` kind 与 `PROJECT_STYLE` 常量（Task 4 才删），只移除 5 个**业务**提示词里的 projectStylePrompt 占位符与其变量元数据。`PROJECT_STYLE`（project.style 自身的 user 文本）不动。

- [ ] **Step 1: 写失败测试** — 追加到 `tests/card-style-prompt-injection.test.ts`：

```ts
describe('提示词移除 projectStylePrompt 注入', () => {
  const kinds = ['planning.segment', 'cover.regeneration', 'cards.segment', 'card.image', 'card.video'] as const;
  it('5 个业务提示词不再含 projectStylePrompt 占位符', () => {
    for (const k of kinds) {
      expect(DEFAULT_PROMPT_YAML[k]).not.toContain('{{projectStylePrompt}}');
      expect(DEFAULT_PROMPT_YAML[k]).not.toContain('{{projectStylePromptBlock}}');
    }
  });
  it('卡片提示词仍含 styleSystemBlock', () => {
    expect(DEFAULT_PROMPT_YAML['cards.segment']).toContain('{{styleSystemBlock}}');
    expect(DEFAULT_PROMPT_YAML['cover.regeneration']).toContain('{{styleSystemBlock}}');
    expect(DEFAULT_PROMPT_YAML['card.image']).toContain('{{styleSystemBlock}}');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/card-style-prompt-injection.test.ts`
Expected: FAIL（占位符仍在）

- [ ] **Step 3: 编辑 `src/lib/prompts/defaults.ts`** — 删除以下行（定位见内容）：
  - `planning.segment`（PLANNING_SEGMENT）：删除独占一行的 `  {{projectStylePromptBlock}}`（约 line 16）。
  - `cover.regeneration`（COVER_REGENERATION）：删除 `  {{projectStylePrompt}}`（约 line 70）连同其上方的「项目统一风格要求：」标签行（若该标签与 `{{projectStylePrompt}}` 在同一段，整段移除，保持上下文通顺，不要留空标题）。
  - `cards.segment`（CARDS_SEGMENT）：删除上下文行 `  - 项目风格：{{projectStylePrompt}}`（约 line 86）。
  - `card.image`（CARD_IMAGE）：删除 `  项目统一风格要求：{{projectStylePrompt}}`（约 line 178）。
  - `card.video`（CARD_VIDEO）：删除 `  项目统一风格要求：{{projectStylePrompt}}`（约 line 224）。
  - 每个被改动的提示词常量头部 `version:` +1（planning/cover/cards/card.image/card.video 各自递增；注意 cards/cover/card.image 上一轮已经各自 bump 过，再 +1）。
  保持其余文本与缩进不变，不要误删相邻的 `{{globalPrompt}}` / `{{styleSystemBlock}}` / `{{programContext}}` 等。

- [ ] **Step 4: 编辑 `src/lib/prompts/types.ts`** — 在 `PROMPT_KIND_META` 的 `planning.segment`、`cover.regeneration`、`cards.segment`、`card.image`、`card.video` 五处 `variables` 数组中，删除这两行：
```ts
      { name: 'projectStylePrompt', description: '项目统一风格要求（为空填"无"）' },
      { name: 'projectStylePromptBlock', description: '项目统一风格要求块；无值为空字符串' },
```
（注意：`project.style` 自身条目的 `description` 文案里也提到 `{{projectStylePrompt}}`，本任务先不动它，Task 4 删整条。）

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/card-style-prompt-injection.test.ts tests/card-style.test.ts`
Expected: PASS

- [ ] **Step 6: 全量类型/构建**

Run: `npm run build`
Expected: PASS（ai-analysis 仍传 projectStylePrompt 变量但 renderTemplate 忽略未知变量，无类型破坏）

- [ ] **Step 7: 提交**

```bash
git add src/lib/prompts/defaults.ts src/lib/prompts/types.ts tests/card-style-prompt-injection.test.ts
git commit -m "refactor(prompts): 5 个业务提示词移除 projectStylePrompt 占位符"
```

---

## Task 2: ai-analysis.ts 拆除 projectStylePrompt 参数

**Files:**
- Modify: `src/lib/ai-analysis.ts`
- Test: `tests/ai-analysis.test.ts`、`tests/card-style-prompt-injection.test.ts`

> 目标：`src/lib/ai-analysis.ts` 内 `grep -n projectStylePrompt` 归零（保留 projectStylePresetId 不动）。保留 `project-style-prompt.ts` 文件本身（Task 4 删），本任务只移除 ai-analysis 对它的 import 与所有 projectStylePrompt 形参/实参/vars。

- [ ] **Step 1: 先看现状**

Run: `grep -n "projectStylePrompt" src/lib/ai-analysis.ts | grep -v PresetId`
记录所有出现点（options 类型字段、函数形参、build 函数 vars、内部调用透传、`buildSegmentPlanningPrompt` 调用）。

- [ ] **Step 2: 更新依赖测试为失败基线** — 在 `tests/ai-analysis.test.ts` 中，找到断言渲染结果包含 `项目统一风格要求` 或依赖 projectStylePrompt 文本的用例，改为断言**不再包含** `项目统一风格要求`：
```ts
// 原本断言 cover/card prompt 含「项目统一风格要求」的用例，改为：
expect(prompt).not.toContain('项目统一风格要求');
```
其余断言（如 styleSystemBlock 注入、`必须使用简体中文` 等来自 facet 的文本）保持不变。

- [ ] **Step 3: 运行确认当前状态**

Run: `npx vitest run tests/ai-analysis.test.ts`
Expected: 改写的「not.toContain」用例 FAIL（projectStylePrompt 文本仍注入）。

- [ ] **Step 4: 移除 import** — 删除顶部：
```ts
import {
  buildProjectStylePromptBlock,
  projectStylePromptValue,
} from './project-style-prompt';
```
（若该 import 块还含其它仍需的导出，仅删这两个名；本仓库该文件只导出这两个 + appendProjectStylePrompt，ai-analysis 不用 append，故整块删。）

- [ ] **Step 5: 移除所有 projectStylePrompt 形参与 vars** — 逐处处理（用 Step 1 的清单）：
  - 各 options 接口 / 函数签名里的 `projectStylePrompt?: string;` 形参 → 删除。
  - 各 build 函数 vars 对象里的 `projectStylePrompt: ...,` 与 `projectStylePromptBlock: ...,` 两行 → 删除。
  - 各内部调用透传 `projectStylePrompt,` → 删除。
  - `buildSegmentPlanningPrompt(globalPrompt, projectStylePrompt, planningTemplate)` → 改为 `buildSegmentPlanningPrompt(globalPrompt, planningTemplate)`，并同步修改 `buildSegmentPlanningPrompt` 自身签名移除该形参（其 vars 已在 Task 1 不再需要 projectStylePrompt）。
  - 保留 `projectStylePresetId` / `defaultStylePresetId` / `resolveStylePresetId` / `getStyleFacetBlock` 一切不动。

- [ ] **Step 6: grep 归零 + 测试 + 构建**

Run: `grep -n "projectStylePrompt" src/lib/ai-analysis.ts | grep -v PresetId`
Expected: 无输出。

Run: `npx vitest run tests/ai-analysis.test.ts tests/card-style-prompt-injection.test.ts tests/card-style.test.ts`
Expected: PASS（含 Step 2 改写的 not.toContain）。

Run: `npm run build`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/lib/ai-analysis.ts tests/ai-analysis.test.ts
git commit -m "refactor(ai-analysis): 拆除 projectStylePrompt 参数与注入"
```

---

## Task 3: electron/main.ts + card-media-handlers.ts 拆除 project.style 装载

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/card-media-handlers.ts`

> 目标：两文件内 `project.style` / `getProjectStylePromptFromTemplate` / `projectStylePrompt`（非 PresetId）/ `appendProjectStylePrompt` 归零。`globalCoverImagePrompt`（独立的全局封面图后缀）**保留**。`project-style-prompt.ts` 文件仍在（Task 4 删）。

- [ ] **Step 1: 看现状**

Run: `grep -n "project\.style\|getProjectStylePromptFromTemplate\|projectStylePrompt\|appendProjectStylePrompt" electron/main.ts electron/card-media-handlers.ts | grep -v PresetId`

- [ ] **Step 2: electron/main.ts** — 对每个分析/重生成 handler（约 8 处，line 731/864/933/1041/1097/1220/1264 等）：
  - 删除该 handler 内：
    ```ts
    const projectStyleTemplate = await loadEffectivePromptTemplate('project.style', { ... });
    const projectStylePrompt = getProjectStylePromptFromTemplate(projectStyleTemplate);
    ```
  - 删除随后传入 analyzeSrt / regenerate* / generateCardForSegment / generateSingleCardFromSubtitles 调用里的 `projectStylePrompt,` 实参（保留 `projectStylePresetId` 相关）。
  - cover 图生成 handler（line ~1156-1159）：将
    ```ts
    const coverSuffix = (args.settings.globalCoverImagePrompt ?? '').trim();
    ...
    return appendProjectStylePrompt(withCoverSuffix, projectStylePrompt);
    ```
    改为直接 `return withCoverSuffix;`（保留 globalCoverImagePrompt 的 coverSuffix 逻辑，仅去掉 project.style 追加）。删掉该 handler 里 project.style 装载两行。
  - 删除顶部 import：
    ```ts
    import { getProjectStylePromptFromTemplate } from '../src/lib/project-style-prompt';
    import { appendProjectStylePrompt } from '../src/lib/project-style-prompt';
    ```
    （实际为合并 import，按文件现状删除 `getProjectStylePromptFromTemplate` 与 `appendProjectStylePrompt` 两个名；若 import 行还引入其它仍需名称则保留那些。）
  - 若 `loadEffectivePromptTemplate` 在 main.ts 其它非 project.style 用途仍被使用，保留其 import；否则一并清理未使用 import（以 build 为准）。

- [ ] **Step 3: electron/card-media-handlers.ts** — 
  - 删除 import `import { appendProjectStylePrompt } from '../src/lib/project-style-prompt';`
  - 两处 `prompt: appendProjectStylePrompt(args.prompt, ctx.projectStylePrompt),`（line ~90/201）改为 `prompt: args.prompt,`。
  - 删除 `ctx` 类型/构造里的 `projectStylePrompt` 字段及其赋值来源（若由 main.ts 传入，则 main.ts 对应传参也删；用 build 报错定位）。

- [ ] **Step 4: grep 归零 + 构建**

Run: `grep -n "project\.style\|getProjectStylePromptFromTemplate\|appendProjectStylePrompt" electron/main.ts electron/card-media-handlers.ts; grep -n "projectStylePrompt" electron/main.ts electron/card-media-handlers.ts | grep -v PresetId`
Expected: 无输出。

Run: `npm run build`
Expected: PASS（`project-style-prompt.ts` 仍存在，故 import 删除后无悬挂；TS 检查全绿）。

- [ ] **Step 5: 冒烟测试**

Run: `npx vitest run tests/ai-analysis.test.ts tests/card-style.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add electron/main.ts electron/card-media-handlers.ts
git commit -m "refactor(electron): 移除 project.style 装载与图生成 projectStylePrompt 追加"
```

---

## Task 4: 删除 project.style 提示词类型与助手

**Files:**
- Modify: `src/lib/prompts/types.ts`、`src/lib/prompts/defaults.ts`
- Delete: `src/lib/project-style-prompt.ts`、`src/lib/project-style-prompt.test.ts`
- Test: 现有套件

> 前置：Task 2/3 已移除所有消费者，此时 `project.style` kind 与 project-style-prompt 助手已无人使用。

- [ ] **Step 1: 确认无残留消费者**

Run: `grep -rn --include="*.ts" --include="*.tsx" -E "project-style-prompt|getProjectStylePromptFromTemplate|projectStylePromptValue|buildProjectStylePromptBlock|appendProjectStylePrompt" src electron | grep -v project-style-prompt.ts`
Expected: 无输出（除了将被删除的文件自身）。

Run: `grep -rn --include="*.ts" --include="*.tsx" "'project.style'" src electron`
记录所有点（应仅剩 types.ts 的 PROMPT_KINDS/PROMPT_KIND_META 与 defaults.ts 的 DEFAULT_PROMPT_YAML 条目）。若 `electron/prompts-io.ts` 或其它处有 `project.style` 字面量枚举，一并处理。

- [ ] **Step 2: 删除 kind 定义**
  - `src/lib/prompts/types.ts`：从 `PROMPT_KINDS` 数组删 `'project.style',`；从 `PROMPT_KIND_META` 删整个 `'project.style': { ... }` 条目。
  - `src/lib/prompts/defaults.ts`：删 `const PROJECT_STYLE = \`...\`;` 常量与 `DEFAULT_PROMPT_YAML` 里 `'project.style': PROJECT_STYLE,` 行。

- [ ] **Step 3: 删除助手文件**

```bash
git rm src/lib/project-style-prompt.ts src/lib/project-style-prompt.test.ts
```

- [ ] **Step 4: 修复 TS 兜底** — `Record<PromptKind, ...>`（如 DEFAULT_PROMPT_YAML、PROMPT_KIND_META）移除 project.style 后类型自洽；遍历 PROMPT_KINDS 处自动少一项。Run `npm run build`，按报错修任何遗漏的 `'project.style'` 引用（如 IPC 校验、prompts-io 枚举）。

- [ ] **Step 5: 全量测试 + 构建**

Run: `npx vitest run`
Expected: 仅既有无关 `tests/tts-config-tab.test.tsx` 失败（与本改动无关）；其余全绿。

Run: `npm run build`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(prompts): 删除 project.style 提示词类型与 project-style-prompt 助手"
```

---

## Task 5: PromptsConfigTab 的 project 分组改为风格选择器

**Files:**
- Modify: `src/components/settings/PromptsConfigTab.tsx`

> Task 4 后，`PROMPT_KIND_META` 不再含 `project.style`，提示词配置的 `project` 分组变空。本任务在该分组位置嵌入 `StyleLibraryPanel`，复用本组件已有的「全局 / 当前项目」scope 切换。

- [ ] **Step 1: 读组件** — 读 `src/components/settings/PromptsConfigTab.tsx`：理解 `groupedKinds`（按 group 分组的 kinds）、scope state（'global' | 'project'）、当前项目目录来源（projectDir）、右侧编辑区如何按选中 kind 渲染 CodeEditor。理解它如何拿到 AISettings（用于 defaultStylePresetId）与 store 的 `projectStylePresetId` / `setProjectStylePresetId`。

- [ ] **Step 2: 在 project 分组渲染选择器** — 实现方案：
  - 在 `PROMPT_GROUP_META`（或分组标题渲染处）确保即便 `project` 组的 kinds 为空，仍渲染一个「项目统一风格」入口（一个伪条目或固定区块）。点击它时右侧编辑区渲染风格选择器而非 CodeEditor。
  - 风格选择器区块（新增内联组件或 JSX）：
    ```tsx
    // scope: 'global' | 'project'（复用本组件现有 scope state）
    // 全局：value = resolveStylePresetId({ global: aiSettings.defaultStylePresetId })
    //       onChange(id) => saveAISettings({ ...current, defaultStylePresetId: id })（沿用本仓库 loadAISettings/saveAISettings 模式）
    // 项目：value = projectStylePresetId ?? ''；onChange(id) => setProjectStylePresetId(id)
    //       并提供「跟随全局默认」按钮 => setProjectStylePresetId(undefined)
    <StyleLibraryPanel
      value={scope === 'global'
        ? resolveStylePresetId({ global: aiSettings?.defaultStylePresetId })
        : (projectStylePresetId ?? '')}
      onChange={(id) => scope === 'global'
        ? void persistGlobalStyle(id)
        : void setProjectStylePresetId(id)}
      facetHint="motion"
    />
    ```
    `persistGlobalStyle` 复用 `StyleLibraryTab` 当前的「loadAISettings → saveAISettings({...current, defaultStylePresetId})」逻辑（把该逻辑搬进本组件，因为 Task 6 会删 StyleLibraryTab）。
    项目 scope 在无项目打开时禁用（沿用本组件 scope=project 的禁用条件）。
  - import：`StyleLibraryPanel`（`../StyleLibraryPanel`）、`resolveStylePresetId`（`../../lib/card-style`）、`useAIStore` 选择 `projectStylePresetId` / `setProjectStylePresetId`、`loadAISettings`/`saveAISettings`（`../../store/ai`）。
  - 复用现有设计 token 与版式；不引第二 accent。

- [ ] **Step 3: 构建 + 手动**

Run: `npm run build`
Expected: PASS。
手动（`npm run dev`）：设置 → 提示词配置 → 项目统一风格 → 显示风格网格；全局/项目切换分别写 defaultStylePresetId / projectStylePresetId；项目可「跟随全局默认」。

- [ ] **Step 4: 提交**

```bash
git add src/components/settings/PromptsConfigTab.tsx
git commit -m "feat(prompts-config): 项目统一风格改为风格模板选择器（全局/项目 scope）"
```

---

## Task 6: 删除独立风格库 Settings tab

**Files:**
- Modify: `src/pages/Settings.tsx`
- Delete: `src/components/settings/StyleLibraryTab.tsx`

> Task 5 已把全局风格选择搬进提示词配置（persistGlobalStyle）。本任务删冗余的独立 tab。

- [ ] **Step 1: 删除 tab 接线** — `src/pages/Settings.tsx`：
  - 从 `SettingsTab` 联合类型删 `| 'style-library'`。
  - 从 `TABS` 数组删 `{ id: 'style-library', ... }` 条目。
  - 删对应 `TabsContent value="style-library"` 块。
  - 删 `StyleLibraryTab` import 与不再使用的 `Palette` 图标 import（若 Palette 仅此处用）。

- [ ] **Step 2: 删组件**

```bash
git rm src/components/settings/StyleLibraryTab.tsx
```

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: PASS（无悬挂引用）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(settings): 删除独立风格库 tab（已并入提示词配置）"
```

---

## Task 7: 移除 AIPanel 项目风格 Dialog（撤回 Task 11b）

**Files:**
- Modify: `src/components/AIPanel.tsx`、`src/components/AIPanel.module.css`

> 项目级风格现由提示词配置承载，AIPanel 内的项目风格弹窗冗余，移除。

- [ ] **Step 1: 看现状**

Run: `grep -n "StyleLibraryPanel\|StylePreset\|projectStylePresetId\|styleRow\|styleDialog\|isStyleDialogOpen\|Dialog" src/components/AIPanel.tsx`
定位上轮 Task 11b 新增的：styleRow JSX、Dialog 块、`isStyleDialogOpen` state、`projectStylePresetId`/`setProjectStylePresetId`/`getStylePresetById` 读取、相关 imports。

- [ ] **Step 2: 移除** — 删除上述 Task 11b 新增内容：
  - 「卡片风格」row + 「更改」按钮 + Dialog（含 `StyleLibraryPanel` 用法）。
  - `isStyleDialogOpen` state 与 setter。
  - `projectStylePresetId` / `setProjectStylePresetId` / `getStylePresetById` 的 store 读取与 import（若 AIPanel 别处不再用）。
  - Dialog 子组件与 `StyleLibraryPanel` import（若别处不再用）。
  - `src/components/AIPanel.module.css`：删 `.styleRow` / `.styleRowValue` / `.styleRowName` / `.styleRowHint` / `.styleDialogContent` / `.styleDialogFollowGlobal` 等本功能新增类。
  保留 AIPanel 其余结构不动。

- [ ] **Step 3: 构建 + 手动**

Run: `npm run build`
Expected: PASS。
手动确认编辑器 AI 面板不再有项目风格入口，其余功能正常。

- [ ] **Step 4: 提交**

```bash
git add src/components/AIPanel.tsx src/components/AIPanel.module.css
git commit -m "refactor(editor): 移除 AIPanel 项目风格弹窗（已并入提示词配置）"
```

---

## Task 8: 全链路验证

- [ ] **Step 1: 全量测试**

Run: `npx vitest run`
Expected: 仅 `tests/tts-config-tab.test.tsx`（2 个，预先存在、与本功能无关）失败，其余全绿。确认无新增失败。

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: PASS。

- [ ] **Step 3: 残留 grep 终检**

Run: `grep -rn --include="*.ts" --include="*.tsx" -E "projectStylePrompt|project\.style|appendProjectStylePrompt|getProjectStylePromptFromTemplate|project-style-prompt|StyleLibraryTab" src electron | grep -v PresetId`
Expected: 无输出（projectStylePresetId 系列除外，已被 grep -v 过滤）。

- [ ] **Step 4: 手动验收**（`npm run dev`）逐条对照规格验收标准：
  1. 提示词配置「项目统一风格」= 风格选择器；全局/项目 scope 正确写入；项目可跟随全局。
  2. 独立风格库 tab、AIPanel 弹窗已删；Inspector 单卡覆盖仍在。
  3. 选风格后生成卡片提示词正确注入 facet；无 projectStylePrompt 文本。
  4. planning.segment / card.video 不再含 projectStylePrompt，仍含 globalPrompt。
  5. 旧项目打开不崩溃，缺省回退 editorial-eink。

- [ ] **Step 5: 收尾提交（如有手动修复）**

```bash
git add -A
git commit -m "chore(style): 风格库合并全链路验证收尾"
```

---

## Self-Review

- **Spec coverage**：§3.1 去 projectStylePrompt 占位符→T1；§3.2 删 kind/助手/main 装载→T2(ai-analysis)+T3(main/card-media)+T4(kind/helpers)；§3.3 行为变更（无代码，CHANGELOG 体现）；§4.1 提示词配置选择器→T5；§4.2 删 tab→T6、删 AIPanel 弹窗→T7；§5 持久化不变（无任务，沿用）；§7 验收→T8。
- **Type 一致性**：projectStylePrompt（删除目标）、projectStylePresetId/defaultStylePresetId/resolveStylePresetId/getStyleFacetBlock（保留）、StyleLibraryPanel/persistGlobalStyle 命名跨任务一致。
- **构建绿序**：T1（占位符）→T2（ai-analysis 参数）→T3（main/card-media）→T4（删 kind/helpers，此时无消费者）→T5（UI 选择器，project 组此时为空可填）→T6（删 tab）→T7（删弹窗）。每步 build 绿。
- **已知**：`tests/tts-config-tab.test.tsx` 2 个失败为预先存在、与本改动无关，T8 明确豁免。
- **实现期确认**：`buildSegmentPlanningPrompt` 形参顺序、main.ts 各 handler 的 project.style 装载块行号、card-media-handlers 的 ctx.projectStylePrompt 来源——以源码与 build 报错为准（各任务已标注）。

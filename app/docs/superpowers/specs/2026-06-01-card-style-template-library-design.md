# 设计规格：段落卡 / 图片卡「风格模板库」

- 日期：2026-06-01
- 状态：已通过 brainstorming 评审，待写实现计划
- 作者：yoqu + Claude Code

## 1. 背景与目标

灵机剪影当前的视觉生成链路里，风格是**写死的**：

- `cards.segment`（Motion Card 生成）锁死「电子杂志 × 电子墨水 · Bento Grid · 深色」一种视觉系统。
- `cover.regeneration` 锁死「短视频缩略图 / B站·YouTube thumbnail」一种风格。
- `card.image`（段落级图片卡生图提示词）同样只有单一风格倾向。

卡片数据模型 `AICard` 只携带 `style: { primaryColor, backgroundColor, fontSize }` 与 `template: "${type}-default"` 字符串，**没有任何风格 / 主题 / 模板预设的概念**。

目标：把段落信息卡的视觉风格与图片卡的生图提示词**封装成多个可选的系统预设风格**，用户可自由切换；每个风格附带一个**零 LLM、秒开的静态预览 demo**，让用户在选择前就看到成片观感。风格 DNA 来源于 nexu-io/html-anything 的 skill 库（74 个 skill，精选映射）。

### 非目标（首版不做）

- 不做用户自定义风格的编辑器 UI（架构预留扩展点，复用 `userPromptEntries` 模式）。
- 不引入静态模板渲染引擎（保持 LLM 生成 HTML 的现有架构）。
- 不改导出渲染管线的核心结构、不新增 IPC。

## 2. 关键决策（brainstorming 结论）

| 维度 | 结论 |
|---|---|
| 预设本质 | **提示词主题层**——每个预设是一段可替换的「视觉系统」提示词块，LLM 仍负责生成，但被预设的风格 DNA 约束 |
| 覆盖表面 | Motion 信息卡（`cards.segment`）、封面图（`cover.regeneration`）、图片信息卡（`card.image`）三者 |
| 风格结构 | **统一风格 + 多 Facet**：一个风格共享视觉 DNA，下挂 motion / cover / image 三个提示词 facet，可缺省 |
| 预览形式 | **内置静态样例**：预置 example.html + 封面示意图，库内直接渲染，零 LLM、秒开 |
| 生效层级 | **全局 → 项目 → 单卡** 三层覆盖，与现有 `promptBindings` 分层一致 |
| 数量 | 首版 **8–10 个精选**系统风格 |
| 自定义 | **仅系统预设**；架构预留 `userPromptEntries['card-style']` 扩展点 |

## 3. 数据模型

### 3.1 新增 `VisualStylePreset`（`src/types/ai.ts`）

```ts
export interface VisualStylePalette {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
}

export interface VisualStyleFonts {
  display: string;
  body: string;
  mono?: string;
}

/** 三个生成表面的「视觉系统」提示词块；缺省表示该表面回退默认风格 */
export interface VisualStyleFacets {
  motion?: string;   // 注入 cards.segment 的 {{styleSystemBlock}}
  cover?: string;    // 注入 cover.regeneration 的 {{styleSystemBlock}}
  image?: string;    // 注入 card.image 的 {{styleSystemBlock}}
}

export interface VisualStylePreview {
  /** 静态 Motion Card HTML 片段（含内联 <style> + 同步 <script>，遵守 motion-card 契约） */
  motionHtml?: string;
  /** 封面示意图资产引用（bundled，renderer 可解析） */
  coverImageAsset?: string;
}

export interface VisualStylePreset {
  id: string;            // 'editorial-eink'
  name: string;          // '电子杂志墨水'
  description: string;
  tags: string[];        // ['深色','社论','克制']
  source: string;        // 来源 html-anything skill，便于追溯
  palette: VisualStylePalette;
  fonts: VisualStyleFonts;
  facets: VisualStyleFacets;
  preview: VisualStylePreview;
}
```

### 3.2 现有类型扩展

- `AICard` 增加可选字段：`stylePresetId?: string;`
- `AICardOverlayData` 增加可选字段：`stylePresetId?: string;`（`buildAICardOverlayData` 透传）
- `AISettings` 增加可选字段：`defaultStylePresetId?: string;`

所有新字段均为可选，缺省语义见第 6 节迁移策略，保证旧数据零行为变化。

## 4. 内置风格清单（首版 10 个）

数据集中在新文件 `src/lib/prompts/card-style-defaults.ts`，镜像 `src/lib/prompts/script-template-defaults.ts` 的种子模式。

| id | 名称 | 来源 skill | 气质 | facet 覆盖 |
|---|---|---|---|---|
| `editorial-eink` | 电子杂志墨水（默认） | deck-guizang-editorial / web-proto-editorial | 深色克制社论·衬线标题·hairline·无渐变 | motion + cover + image |
| `swiss-grid` | 瑞士国际主义 | deck-swiss-international | 16栏网格·极致字号对比·克莱因蓝/柠檬黄·直角 | motion + cover |
| `nyt-data` | NYT 数据社论 | frame-data-chart-nyt | 暖白/纯黑·手写 SVG 图表·新闻红·单墨色+accent | motion + image |
| `cyber-glitch` | 赛博故障 | frame-glitch-title / deck-hermes-cyber | 近黑·等宽·青/品红色差·CRT扫描线 | motion + cover |
| `film-leak` | 胶片电影 | frame-light-leak-cinema | 信箱画幅·斜体衬线奶油色·暖漏光·颗粒 | motion + cover + image |
| `hand-sketch` | 手绘便签 | wireframe-sketch / frame-flowchart-sticky | 方格纸·Caveat/Kalam 手写·便利贴·手绘连线 | motion |
| `soft-apple` | 温柔苹果 | web-proto-soft | 银白奶油·squircle 圆角·环境网格光·弹性微动 | motion + cover + image |
| `dark-graph` | 暗色数据图谱 | deck-graphify-dark / deck-obsidian-claude | 深 navy·模糊光球·渐变标题·玻璃拟态 | motion + cover |
| `xhs-pastel` | 小红书柔彩 | deck-xhs-pastel / card-xiaohongshu | 奶油底·马卡龙圆角卡·斜体显示字·柔焦色块 | motion + cover + image |
| `mono-bold` | 极简大字 | deck-dir-key-nav / deck-simple | 单色满版·超大显示标题·accent 色条 | motion + cover |

每个风格须把对应 SKILL.md 的 DNA（色板 / 字体 / 构图 / 纹理 / 动效）**翻译成各 facet 形态**：

- **motion facet**：一段「视觉系统」提示词块，沿用 `cards.segment` 现有的写法粒度（Design DNA、颜色 token、版式约束、六类卡片适配指引），替换其美学锚点。须兼容现有 Motion Card 技术约束与字幕驱动动画契约（这些通用约束不属于 facet，保留在提示词主干）。
- **cover facet / image facet**：一段生图提示词的「视觉系统」块，沿用 `cover.regeneration` / `card.image` 的维度结构（主体→…→风格→美学→质量→文字排版），替换美学锚点、色彩 token、字体倾向。

`editorial-eink` 的三个 facet **原样搬入当前写死的内容**，作为默认与回退，确保向后兼容。

## 5. 提示词改造与风格解析

### 5.1 抽出占位符

`src/lib/prompts/defaults.ts` 中三个提示词里写死的「===== 视觉系统 =====」段替换为占位符 `{{styleSystemBlock}}`。其余通用约束（技术约束、动画契约、输出格式）保留在主干不动。

提示词 version 号相应 +1（`cards.segment` v8→v9 等），并注意全局 / 项目级 prompt override 的兼容：旧 override 若不含 `{{styleSystemBlock}}`，渲染层须在缺占位符时退回内联默认块，避免老覆盖丢失风格。

### 5.2 解析层级

新增解析函数（建议落在 `card-style-defaults.ts` 或新 `src/lib/card-style.ts`）：

```
resolveStylePreset(scope) =
  card.stylePresetId
  ?? project.stylePresetId
  ?? settings.defaultStylePresetId
  ?? 'editorial-eink'   // 内置默认
```

按 facet 取块：若所选风格缺该 facet，则回退 `editorial-eink` 的同 facet。

### 5.3 注入点

在组装各提示词变量处注入 `{{styleSystemBlock}}`：

- `cards.segment`：`src/lib/ai-analysis.ts` 分段卡片生成的变量组装处。
- `cover.regeneration` / `card.image`：各自变量组装处（封面重生成、图片卡生图）。

实现前须先确认生成链路运行在主进程还是渲染端，解析逻辑跟随变量组装位置放置；若需在两侧都可用，预设数据应放可被双方 import 的纯 TS 模块。

## 6. 生效层级与持久化（无新增 IPC）

| 层级 | 存储位置 | 通道 |
|---|---|---|
| 全局默认 | `AISettings.defaultStylePresetId` | 现有 AI 设置持久化 |
| 项目覆盖 | `ProjectData.stylePresetId`（`src/lib/project-persistence.ts`） | 现有 `save-project-section` |
| 单卡覆盖 | `AICard.stylePresetId`（存 `aiAnalysis.cards[]`） | 现有 ai 持久化 |

三层均复用现有持久化通道，**不新增 IPC 名称 / 参数 / 返回值**。

### 迁移策略

- 旧 `project.json` 无 `stylePresetId` → 解析时回退 `editorial-eink`，无需写迁移字段（读时默认）。
- 旧 `AICard` 无 `stylePresetId` → 同上。
- 未知 `stylePresetId`（预设被删 / 改名）→ 回退 `editorial-eink` 并告警日志，不崩溃。
- 净效果：现有项目视觉零变化。

## 7. 预览 Demo（零 LLM·秒开）

- 每个风格在 `preview.motionHtml` 内置一份静态 Motion Card HTML（改编自 html-anything 的 example.html，须遵守 motion-card 契约：内联 `<style>` + 同步 `<script>` + `window.__lingjiMotionTimelines`），以及 `preview.coverImageAsset` 一张封面示意图（bundled，经 Vite 打包供 renderer 解析）。
- 库内用**沙箱 iframe `srcdoc`** 渲染 `motionHtml`，注入 GSAP runtime + 自动播放引导脚本（遍历并播放 `window.__lingjiMotionTimelines`）。
- **复用编辑器现有 motion-card 预览 harness**（`WebCardPreview` / `AICardInspector` 预览路径），不在新模块自造 blinking cursor / typing indicator / breathing 等效果（遵守视觉反馈铁律）。
- cover facet 预览直接显示 `coverImageAsset` 示意图。

## 8. UI：风格库面板

新增 `StyleLibraryPanel` 组件，复用 `src/ui/components` / `src/ui/primitives` / `src/ui/patterns`，accent 使用系统蓝，不引第二套彩色。

- **卡片网格**：每卡显示名称、tags、motion 预览（iframe）、cover 示意图、来源标注、选中态。
- **三处入口**：
  1. Settings 页——设全局默认风格。
  2. 项目设置 / Editor AI 面板——设项目覆盖风格。
  3. `AICardInspector`——单卡覆盖，在现有 type pill 选择器旁新增风格选择器入口。
- 库内静态预览不接统一进度系统（无耗时）；若后续加「用本项目内容试生成」再接 `task-progress`。

## 9. 导出渲染影响

- **Motion 卡**：风格只在**生成时**通过提示词生效，生成出的 HTML 已烘焙进 `motionCard.html`，导出时原样使用——`src/hyperframes/composition.ts` 的 motion 渲染路径**无需改动**。
- **Legacy 卡回退**：`renderLegacyCardContent` 取 `card.style.primaryColor/backgroundColor`；可选增强为从所选风格 `palette` 取默认色，使未生成 motionCard 的回退卡也贴合风格。此为可选项，不影响主链路。
- 净效果：导出链路零结构性风险。

## 10. 改动文件清单

新增：

- `src/lib/prompts/card-style-defaults.ts`——10 个预设数据 + 解析函数
- 预览资产：motionHtml 字符串（随预设数据）+ 封面示意图目录（bundled）
- `src/components/StyleLibraryPanel.tsx`（+ 样式）
- 可选 `src/lib/card-style.ts`——若解析逻辑需独立模块

修改：

- `src/types/ai.ts`——`VisualStylePreset` 及相关接口、`AICard.stylePresetId`、`AICardOverlayData.stylePresetId`、`AISettings.defaultStylePresetId`、`buildAICardOverlayData` 透传
- `src/lib/prompts/defaults.ts`——三提示词抽 `{{styleSystemBlock}}` + version 递增
- `src/lib/prompts/render.ts`——`{{styleSystemBlock}}` 缺省回退逻辑
- `src/lib/ai-analysis.ts`（及 cover / image 变量组装处）——注入风格块
- `src/lib/project-persistence.ts`——项目级 `stylePresetId` + 读时默认
- Settings 页 + `AICardInspector.tsx`——集成风格库入口

测试：

- 风格解析层级（单卡 > 项目 > 全局 > 默认）与未知 id 回退
- facet 缺省回退 `editorial-eink`
- 提示词 `{{styleSystemBlock}}` 注入 + 旧 override（缺占位符）兼容
- 项目 / 卡片迁移（无字段 → 默认）
- `editorial-eink` 注入后输出与改造前提示词等价（向后兼容回归）

## 11. 验收标准

1. 用户能在 Settings 选全局默认风格，项目与单卡可层层覆盖，解析顺序正确。
2. 风格库每个风格展示静态 motion 预览（动画播放）+ 封面示意图，秒开、零 LLM。
3. 选定非默认风格后重生成 Motion 卡 / 封面 / 图片卡，输出明显贴合该风格 DNA。
4. 旧项目打开后视觉零变化（默认解析为 `editorial-eink`）。
5. 无新增 IPC；`npm test` 相关用例通过；`npm run build` 通过。

## 12. 未决 / 实现期需确认

- 卡片生成链路（`cards.segment` 调 LLM）运行在主进程还是渲染端——决定风格解析逻辑落点。
- 封面示意图来源：自制截图 vs 改编 html-anything example.html 截图——需确认版权 / 来源标注口径。
- `hand-sketch` 等不适合生图的风格，cover/image facet 缺省时 UI 如何提示「该风格仅支持 Motion」。

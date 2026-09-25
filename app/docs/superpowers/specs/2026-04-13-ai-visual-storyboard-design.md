# AI 视觉编排系统 V1 设计文档

> **日期**：2026-04-13
> **状态**：Approved
> **范围**：编辑器 AI 面板中的“动画”能力升级为“视觉编排”系统，统一处理内容卡片与动画建议，并支持建议模式与全自动模式。

---

## 1. 背景

当前编辑器已经具备三段独立能力：

1. **字幕分析 + 内容卡片生成**
   - 入口与状态位于 `src/components/AIPanel.tsx`、`src/lib/ai-analysis.ts`
   - 输出 `analysisResult.cards`
2. **Prompt 驱动的动画卡片生成**
   - 入口与状态位于 `src/components/MotionPanel.tsx`、`src/lib/motion-card-service.ts`
   - 输出 `motionCards`
3. **AI 视觉产物上轨**
   - 入口位于 `src/store/timeline.ts`
   - 通过 `addAICardsToTimeline()` 把 AI 产物转成 overlay

现状问题不是“动画质量不够”，而是**动画仍然停留在手工工具层**：

- 内容卡片是 `SRT -> 分段 -> 自动生成 -> 上轨`
- 动画是 `用户输入 prompt -> 生成 motion card -> 手工上轨`

这会直接导致：

- AI 助手无法像内容卡片一样，从字幕里自动识别值得动态呈现的片段
- 动画无法自然参与整体视频节奏设计
- 全自动模式无法统一编排“卡片 + 动画”
- 时间轴上缺少建议态与正式落轨态的区分

---

## 2. 目标与非目标

### 2.1 目标

构建 **AI 视觉编排系统 V1**，实现：

1. 基于字幕自动做语义分段与可视化价值判断
2. 自动识别适合做动态呈现的段落
3. 统一生成“内容卡片 + 动画建议”
4. 在 AI 面板中以“建议模式”展示结果，支持用户确认后应用
5. 支持“全自动模式”直接把建议落到时间轴
6. 在底部时间轴显示建议预演块，帮助用户判断节奏
7. 保持失败可降级，不因单个动画失败阻断整次编排

### 2.2 非目标

V1 明确不做：

- 完整导演系统
- 自动背景切换编排
- 独立转场轨系统
- 每段都支持自由生成复杂 Remotion 代码
- 多层复杂镜头语言编排
- 音频驱动镜头调度

---

## 3. 核心产品决策

### 3.1 模式决策

系统必须同时支持两种模式：

1. **建议模式（默认）**
   - AI 生成视觉建议
   - 用户可筛选、调整、确认
   - 用户点击“应用到时间轴”后正式落轨

2. **全自动模式**
   - AI 生成视觉建议后直接落轨
   - 面板中仍保留建议列表，供用户回看与修改

### 3.2 自动范围决策

“全自动模式”的默认范围是：

- **动画 + 内容卡片统一编排上轨**

不包含：

- 背景节奏自动编排
- 完整转场系统

### 3.3 生成策略决策

V1 采用：

- **模板优先**
- **自由生成兜底**

原则如下：

- 80% 高频场景由结构化模板动画承载
- 20% 模板覆盖不到的特殊场景，才进入 `motion-card-service`

---

## 4. 用户交互设计

### 4.1 AI 面板信息架构

当前 AI 面板的 `cards / cover / motion` 结构升级为：

```text
AI 分析
├── 内容
├── 视觉编排
└── 封面
```

其中：

- `内容`：保留现有内容卡片生成与编辑能力
- `视觉编排`：新增统一的视觉建议列表与自动模式开关
- `封面`：保留现有封面逻辑

### 4.2 “视觉编排”页核心元素

```text
视觉编排
├── 自动应用到时间轴 开关
├── 分析/重新分析 按钮
├── 建议列表
│   ├── 内容卡片建议
│   ├── 数据动画建议
│   ├── 解释动画建议
│   └── 章节/切场建议
└── 应用到时间轴 按钮（建议模式可见）
```

每条建议项展示：

- 时间范围
- 建议类型
- 标题
- 时长
- 模板
- 建议原因
- 是否允许自动应用

用户可执行：

- 启用/禁用
- 修改模板
- 修改时长
- 切换显示模式
- 重生成
- 降级成内容卡片
- 删除

### 4.3 时间轴预演交互

建议模式下，底部时间轴同步显示“建议预览层”：

- 未正式应用前，以半透明虚线块展示
- 用户点选建议项时，对应预览块高亮
- 时间轴自动滚动到对应位置
- 预览窗口可临时预演该段

---

## 5. 视觉建议类型

V1 建议支持 4 类建议：

1. **内容卡片**
   - 用于摘要、观点、金句、静态信息结构化表达
2. **数据动画**
   - 用于数据报告、对比、增长、排行
3. **解释型动画**
   - 用于流程、因果、复杂概念拆解
4. **章节/切场动画**
   - 用于话题切换、章节进入、节奏重置

### 5.1 首版模板集合

V1 固定支持以下模板：

- `kpi-countup`
- `bar-chart-reveal`
- `ranking-stack`
- `before-after-compare`
- `step-flow-explainer`
- `chapter-stinger`

这 6 个模板覆盖：

- 数据报告
- 难理解内容
- 切场画面

---

## 6. 数据模型设计

### 6.1 AISegmentAnalysis

在现有 `AISegment` 基础上增强，新增“值不值得可视化”的判断字段。

```ts
interface AISegmentAnalysis {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  summary: string;
  transcriptExcerpt?: string;

  semanticType:
    | 'data'
    | 'explanation'
    | 'chapter-transition'
    | 'quote'
    | 'narration';

  complexityLevel: 'low' | 'medium' | 'high';
  visualizationScore: number;
  pacingNeed: 'steady' | 'accent' | 'transition';
  keywords: string[];
  entities: string[];
}
```

### 6.2 AIVisualSuggestion

建议模式列表项的核心对象。

```ts
interface AIVisualSuggestion {
  id: string;
  segmentId: string;

  suggestionType:
    | 'content-card'
    | 'data-motion'
    | 'explainer-motion'
    | 'chapter-transition';

  priority: number;
  reason: string;
  enabled: boolean;

  startMs: number;
  endMs: number;
  displayDurationMs: number;
  displayMode: 'fullscreen' | 'pip';

  templateKey: string;
  visualBrief: string;
  autoApplyEligible: boolean;
}
```

### 6.3 AIStoryboardPlan

视觉编排的统一结果容器。

```ts
interface AIStoryboardPlan {
  segments: AISegmentAnalysis[];
  suggestions: AIVisualSuggestion[];
  summary: string;
  globalPrompt?: string;
  generatedAt: number;
}
```

### 6.4 Renderable Assets

`AICard` 与 `MotionCardPayload` 继续保留，但角色发生变化：

- `AICard`：一种可渲染的视觉产物
- `MotionCardPayload`：一种动画 payload

它们不再分别代表两条分裂主状态，而是作为 `AIStoryboardPlan` 的下游产物。

---

## 7. 处理流水线设计

V1 统一流水线如下：

```text
SRT
  → Step A. 字幕分析
  → Step B. 编排决策
  → Step C. 渲染产物生成
  → Step D. 时间轴落轨
```

### 7.1 Step A：字幕分析

输入：

- `SrtEntry[]`
- 全局创作提示词

输出：

- `AISegmentAnalysis[]`

职责：

- 语义分段
- 判断段落类型
- 评估复杂度
- 计算可视化价值分
- 判断是否存在章节切换信号

### 7.2 Step B：编排决策

输入：

- `AISegmentAnalysis[]`

输出：

- `AIVisualSuggestion[]`

职责：

- 决定某段是否值得出视觉
- 决定是卡片、动画还是跳过
- 选择模板
- 给出时长与显示模式建议
- 决定是否允许全自动直接应用

### 7.3 Step C：渲染产物生成

分流逻辑：

- `content-card` → 走现有内容卡片生成链
- `data-motion` / `explainer-motion` / `chapter-transition`
  - 先走模板动画生成
  - 模板失败时，按规则降级
  - 特殊场景才进入 `motion-card-service`

### 7.4 Step D：时间轴落轨

所有视觉产物最终统一转换为时间轴 draft，再进入 timeline store：

- 内容卡片 → `AICardTimelineDraft`
- 动画卡片 → `AICardTimelineDraft`
- 建议预览块 → 新的预览层 draft（仅 UI 层使用）

---

## 8. 时间轴设计

### 8.1 轨道结构

V1 推荐轨道结构：

```text
口播轨
字幕轨
AI 卡片轨
AI 动画轨
```

不新增独立转场轨。

原因：

- 双轨已足够支撑“内容卡片 + 动画统一编排”
- 首版复杂度可控
- 后续仍可扩展到三轨或导演模式

### 8.2 建议预览层

建议模式下，底部时间轴额外显示一层“AI 建议预览层”：

- 半透明
- 虚线边界
- 不产生正式 overlay
- 仅用于节奏预演

### 8.3 自动密度控制

全自动模式必须执行以下规则：

1. 同一时间仅允许 1 个 fullscreen 视觉块
2. 同一 segment 默认最多 1 个主视觉结果
3. 连续 20 秒内强视觉块数量受限
4. 章节切场动画仅允许出现在 segment 边界附近
5. 字幕高密度段优先降级为卡片，而不是强上复杂动画

系统目标是“节奏合理”，而不是“覆盖率最大化”。

---

## 9. Inspector 设计

V1 推荐新增统一的 **AIVisualInspector**，替代内容卡片与动画卡片完全分裂的检查入口。

### 9.1 通用编辑项

- 开始时间
- 时长
- 显示模式
- 是否启用
- 是否允许自动应用
- 所属 segment
- 建议原因

### 9.2 内容卡片扩展项

- 标题
- 文案
- 模板
- 主色

### 9.3 动画扩展项

- 模板
- 动画节奏
- 强调对象
- 降级为卡片
- 进入高级模式

“高级模式”才暴露现有 `motion-card` 自由编辑能力。

---

## 10. 状态与持久化设计

### 10.1 Store 状态调整

`src/store/ai.ts` 需要从当前的：

- `analysisResult`
- `motionCards`

升级为同时维护：

- `analysisResult`（兼容现有内容卡片链）
- `storyboardPlan`
- `visualSuggestions`
- `generatedVisualAssets`
- `autoApplyVisualSuggestions`

### 10.2 持久化

项目级 AI 状态持久化需要扩展，保存：

- `analysisResult`
- `coverCandidates`
- `storyboardPlan`
- `generatedVisualAssets`
- `motionCards`（作为兼容字段或高级模式结果）

旧数据可通过版本号迁移。

---

## 11. 失败兜底与降级策略

### 11.1 局部失败不阻断整体

失败原则：

- 字幕分析失败：整次视觉编排中止
- 单条建议生成失败：仅当前建议标错，不阻断其它建议
- 某类动画失败：允许自动降级为卡片

### 11.2 固定降级链路

```text
高级自由动画
  ↓ 失败
模板动画
  ↓ 失败
内容卡片
  ↓ 失败
跳过该段
```

### 11.3 自动模式下的体验要求

自动模式不允许因单个段落失败导致整次编排报废。

用户必须可以看到：

- 哪些段落成功应用
- 哪些段落被降级
- 哪些段落被跳过

---

## 12. 渐进落地计划

### Milestone 1：会想

交付：

- `AISegmentAnalysis`
- `AIVisualSuggestion`
- `AIStoryboardPlan`
- “视觉编排”页建议列表
- 自动应用开关

### Milestone 2：会演

交付：

- 6 个模板动画
- 双 AI 轨
- 时间轴建议预览层
- 正式应用到时间轴
- 统一 Inspector 基础编辑

### Milestone 3：会兜底

交付：

- 少量自由生成 motion-card fallback
- 单项重试 / 降级能力
- 稳定性与交互打磨

---

## 13. 验收标准

V1 完成后需满足：

1. 导入一份 SRT 后，AI 可生成统一的视觉建议列表
2. 建议列表中同时包含内容卡片与动画建议
3. 建议模式下，底部时间轴能看到建议预览块
4. 全自动模式下，系统可直接把建议落到时间轴
5. 内容卡片与动画分别落入独立 AI 轨
6. 时间轴不会因自动模式被视觉块塞满
7. 单条动画失败时，其它建议仍可正常应用
8. 用户可在 Inspector 中修改建议项并重新应用

---

## 14. 总结

本设计将当前“内容卡片自动化 + 动画手工工具”的割裂体验，升级为统一的
**AI 视觉编排系统 V1**。

其本质不是“多加几个动画模板”，而是新增一层 **Storyboard Planner**：

```text
字幕理解
  → 视觉决策
  → 产物生成
  → 时间轴编排
```

这样既能满足“像内容卡片一样自动生成动画”的核心诉求，也能在不引入完整导演系统复杂度的前提下，把“建议模式 + 全自动模式”稳定落地。

# AI 分析 Segment Pipeline 改造设计文档

**日期**：2026-04-13  
**范围**：AI 字幕分析、单卡重生成、AI 持久化与相关前端调用链

---

## 一、背景与问题

当前 AI 分析主流程位于 `src/lib/ai-analysis.ts`，核心路径是：

```text
完整字幕
  -> chunkSrtEntries() 按 token 估算做本地切块
  -> 每个 chunk 直接请求 LLM 产出 cards
  -> mergeAnalysisResults() 合并 cards
```

这个方案有三个根问题：

### 1.1 本地 token chunk 并不等于真实内容段落

- 代码当前根据 token 估算和条目重叠来切块
- 切块边界只对“模型输入长度”负责，不对“语义段落边界”负责
- 同一个主题可能被切成两块，两个主题也可能被硬塞进一块

结果是：

- 卡片起止时间容易漂
- 一个主题可能被重复生成
- 模型无法基于完整上下文判断这段内容在整期里的作用

### 1.2 首次生成与单卡重生成走了两套相似但不一致的 prompt

- 首次分析使用 `buildAnalysisPrompt()`
- 单卡重生成使用 `buildCardRegenerationPrompt()`

虽然两者都强调视觉基线、时间轴约束和 `webCard` 输出，但它们的输入上下文和文案要求逐渐分叉，维护成本高，也容易出现：

- 首轮生成效果和重生成效果不一致
- 改了一套 prompt 却漏改另一套
- UI 里点“重生成”后出现风格或理解偏差

### 1.3 单卡生成时上下文过窄

当前 `regenerateAICard()` 会先通过 `getCardContextEntries()` 从字幕中截取卡片附近的局部窗口，再让 AI 重生成卡片。这个策略的主要问题是：

- AI 只看到了局部，不知道整期的主线
- 无法准确判断当前段落在整篇里的信息密度与角色
- 容易把局部亮点做大，但偏离整期主题

---

## 二、改造目标

本次改造要把 AI 分析流程升级为：

```text
完整字幕
  -> AI 先理解整篇并做段落拆分
  -> 按 segment 逐段生成网页卡片
  -> 卡片列表展示与时间轴沿用现有 UI
  -> 单卡重生成复用“按 segment 生成卡片”同一条逻辑
```

### 2.1 目标

- 取消 `analyzeSrt()` 中本地基于 token 的业务切块逻辑
- 让 AI 决定真正的内容段落边界
- 单张卡片生成时同时拿到：
  - 整篇全文 context
  - 当前 segment 的结构化信息
  - 可选的当前卡片线索
- 首次生成与单卡重生成统一到同一套 segment card generation prompt
- 保持现有 AI 卡片列表 UI 基本不变
- 移除旧 AI 分析结构的兼容分支，避免继续积累垃圾代码

### 2.2 非目标

- 本轮不新增“段落列表”独立 UI
- 本轮不开放段落可视化编辑
- 本轮不改封面图生成链路的核心行为，只保证它仍能拿到节目级 summary / keywords / coverPrompts
- 本轮不把 AI 分析改成并发多 worker 调度系统

---

## 三、核心设计

### 3.1 新的工作流

新的分析流程分成两个明确阶段：

```text
┌──────────────────────────┐
│ 1. Segment Planning      │
│    AI 读取全文并拆分段落 │
└────────────┬─────────────┘
             │
             v
┌──────────────────────────┐
│ 2. Segment Card Generate │
│    按每个段落生成单张卡片 │
└────────────┬─────────────┘
             │
             v
┌──────────────────────────┐
│ 3. Assemble Result       │
│    汇总 cards/segments   │
└──────────────────────────┘
```

单卡重生成不再有独立的“卡片重生成模式”，而是：

```text
已存在卡片
  -> 前端根据 card.segmentId 找到对应 segment
  -> 用相同的单段生成逻辑重跑
  -> 可额外传入 cardPrompt / currentCard 作为风格延续参考
```

### 3.2 为什么要保留 segment 中间态

`segment` 是这次改造的关键中间层，它解决的是“卡片到底对应哪段语义”这个问题。

没有 `segment`，单卡重生成仍然只能通过 `startMs/endMs` 或附近字幕片段来猜它原本对应哪段内容。这样 prompt 再怎么改，也只是把问题换了个位置。

因此本次设计明确要求：

- `segment` 成为 `analysisResult` 的一部分并被持久化
- 每张卡片必须带 `segmentId`
- UI 主展示仍然是 `cards`，不额外引入独立段落面板

---

## 四、数据结构设计

### 4.1 新增 AISegment

在 `src/types/ai.ts` 中新增：

```ts
export interface AISegment {
  id: string;
  title: string;
  summary: string;
  startMs: number;
  endMs: number;
  transcriptExcerpt?: string;
}
```

字段职责：

- `id`：稳定标识，用于卡片与段落关联
- `title`：该段主题标题，供生成卡片时参考
- `summary`：该段的结构化摘要
- `startMs / endMs`：该段真实时间范围
- `transcriptExcerpt`：该段核心字幕摘录，减少 prompt 中再次截取字幕的复杂度

### 4.2 调整 AIAnalysisResult

```ts
export interface AIAnalysisResult {
  segments: AISegment[];
  cards: AICard[];
  coverPrompts: string[];
  summary: string;
  keywords: string[];
  globalPrompt?: string;
}
```

### 4.3 调整 AICard

```ts
export interface AICard {
  id: string;
  segmentId: string;
  ...
}
```

`segmentId` 是本次统一首次生成与重生成流程的锚点。

---

## 五、Prompt 设计

### 5.1 Prompt 分层

本次改造后，AI prompt 只保留两类主入口：

#### A. Segment Planning Prompt

职责：

- 读取完整字幕全文
- 输出节目级信息
- 输出结构化段落列表

输出只包含：

- `segments`
- `coverPrompts`
- `summary`
- `keywords`
- `globalPrompt`

它**不负责生成网页卡片 HTML**。

#### B. Segment Card Prompt

职责：

- 给定一个 segment
- 结合整篇全文 context
- 输出单张网页卡片对象

它同时用于：

- 首次生成
- 单卡重生成

### 5.2 单段卡片生成的输入结构

新的单段卡片生成 prompt 应包含三层输入：

#### 1. 全文 context

- 完整字幕全文
- 节目级 summary / keywords
- 全局创作提示词 `globalPrompt`

#### 2. 当前 segment

- `segment.id`
- `segment.title`
- `segment.summary`
- `segment.startMs / endMs`
- `segment.transcriptExcerpt`

#### 3. 当前卡片线索（仅重生成时可选）

- 当前卡片 `type/title/content/template/style/displayMode`
- 单卡 `cardPrompt`

这层只是“延续风格与结构线索”，而不是启用一套独立的重生成模式。

### 5.3 Prompt 统一原则

以下约束继续保留为公共段落，并抽成共享 helper：

- 统一视觉基线
- 时间轴约束
- `webCard.srcDoc` 必须为完整 HTML
- 输出必须为严格 JSON
- 内容忠于字幕，不编造，不输出“数据来源”

本次改造后：

- `buildAnalysisPrompt()` 退役
- `buildCardRegenerationPrompt()` 退役
- 新增：
  - `buildSegmentPlanningPrompt()`
  - `buildSegmentCardPrompt()`

---

## 六、运行时接口设计

### 6.1 analyzeSrt()

`analyzeSrt()` 不再直接生成 cards，而是 orchestration 函数：

```ts
async function analyzeSrt(entries, settings, options): Promise<AIAnalysisResult> {
  const planning = await planTranscriptSegments(entries, settings, options);
  const cards = [];

  for (const segment of planning.segments) {
    const card = await generateCardForSegment(entries, planning, segment, settings, {
      globalPrompt: options.globalPrompt,
    });
    cards.push(card);
  }

  return {
    segments: planning.segments,
    cards,
    coverPrompts: planning.coverPrompts,
    summary: planning.summary,
    keywords: planning.keywords,
    globalPrompt: planning.globalPrompt,
  };
}
```

### 6.2 regenerateAICard()

`regenerateAICard()` 保留“单卡重生成”这个能力，但接口升级为显式接收 `segment`：

1. 前端从 `analysisResult.segments` 中根据 `card.segmentId` 找到对应段落
2. 将 `card + segment + full transcript` 一起传给后端
3. 后端直接复用 `generateCardForSegment()`
4. 把 `currentCard` 和 `cardPrompt` 作为参考线索传入

这样能避免在后端再维护“通过旧卡片反推段落”的垃圾逻辑。

### 6.3 不再使用本地 chunk 作为业务切段

`chunkSrtEntries()` 将不再参与主业务流程。

可选处理策略：

- 若当前文件里还有测试或工具函数引用，可短期保留但不在主流程使用
- 若没有实际用途，直接删除

如果全文超出模型上下文窗口，本次设计不做静默 fallback，而是：

- 直接抛出明确错误
- 告知用户当前模型上下文不足，请切换支持更长上下文的模型

原因：

- 否则系统表面上改成了“AI 拆段”，底层仍偷偷按 token 硬切，和改造目标冲突

---

## 七、前端与 IPC 影响

### 7.1 IPC 层

对外 IPC 名称可暂时保持不变，降低前端改造成本：

- `analyze-srt`
- `regenerate-ai-card`
- `regenerate-cover-prompt`

内部实现切换为新 pipeline。

### 7.2 前端 UI

前端主要继续消费 `analysisResult.cards`：

- `AIPanel` 继续展示卡片列表
- `AICardInspector` 继续支持编辑与重生成
- 时间轴卡片仍然从 `cards` 派生

新增的 `analysisResult.segments` 只作为内部状态和重生成锚点，不在本轮暴露独立 UI。

---

## 八、持久化策略

### 8.1 新 schema 强约束

本次改造后，AI 分析结果采用新的强约束结构：

- `AIAnalysisResult.segments` 必填
- `AICard.segmentId` 必填
- 单卡重生成请求里的 `segment` 必填

这意味着旧的 AI 分析结果不再尝试兼容解析。

### 8.2 持久化版本

本次建议将 `PersistedAIState.version` 升级为 `2`。

处理原则：

- `version === 2`：按新结构严格解析
- 旧版结构：直接视为无效 AI 分析结果
- 用户如打开旧项目，需要重新执行一次 AI 分析

这样做的原因很直接：

- 避免为旧格式继续维护 fallback 与推断逻辑
- 避免 `segmentId` 缺失导致重生成路径继续分叉
- 保持实现简单、可预测、可测试

---

## 九、测试策略

### 9.1 单元测试

重点覆盖：

- `planTranscriptSegments()` 能正确解析 AI 返回的 `segments`
- `generateCardForSegment()` 输出卡片带 `segmentId`
- `analyzeSrt()` 不再依赖 `chunkSrtEntries()` 主流程
- `regenerateAICard()` 会复用单段卡片生成逻辑
- `regenerateAICard()` 缺少 `segment` 时会直接报错

### 9.2 持久化测试

重点覆盖：

- 新结构 `segments` 能正确保存和读取
- `version === 2` 的 AI 结果能正确保存和读取
- 旧结构 `analysisResult` 会被拒绝解析并回退为空状态

### 9.3 回归测试

重点验证：

- AI 面板“分析内容”仍能生成卡片列表
- AI 卡片检查器点“重生成”仍能返回可展示卡片
- timeline overlay 仍能使用卡片数据

---

## 十、风险与取舍

### 10.1 Token 压力上升

因为单段卡片生成也会带全文 context，请求体会更大。

这是有意识的取舍：

- 换取整期主题一致性
- 换取单卡重生成质量
- 换取 prompt 统一

### 10.2 请求次数增加

当前是一轮请求里直接拿到多张 cards；改造后是：

- 1 次 segment planning
- N 次 segment card generation

代价是调用次数更多，但收益是：

- 每段可独立失败与重试
- 单卡重生成天然复用
- 结果更稳定、更容易定位问题

### 10.3 模型上下文要求更高

如果用户选了上下文较小的模型，全文模式可能失败。

本次设计接受这个事实，不做静默降级，改为：

- 明确报错
- 明确提示切换更大上下文模型

---

## 十一、实施顺序建议

建议按下面顺序落地，能把风险压到最低：

1. 先扩展 `types` 和 `ai-persistence`
2. 再重构 `ai-analysis.ts` 的核心 pipeline
3. 然后切换 `regenerateAICard()` 到统一 segment 生成链路
4. 最后补 IPC、前端消费和测试

---

## 十二、最终结论

这次改造的本质，不是“把 prompt 改一改”，而是把 AI 分析体系从：

```text
按 token 切块 -> 直接生成 cards
```

升级为：

```text
全文理解 -> AI 拆 segment -> 单段统一生成卡片 -> 单卡重生成复用同一路径
```

这样才能真正解决三个核心问题：

- 本地 chunk 与真实段落错位
- 单卡生成上下文过窄
- 首次生成与重生成存在双轨 prompt 维护成本

这是一次值得做的结构性调整，而且改完后，后续无论是单段重跑、局部缓存、还是更细的 AI 编辑能力，都会比现在更顺手。

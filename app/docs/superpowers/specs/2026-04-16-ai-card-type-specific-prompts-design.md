# AI 内容卡片类型特化提示词设计

> 日期：2026-04-16
> 状态：已确认

## 目标

将现有的单一 `buildSegmentCardPrompt()` 拆分为 5 套类型独立提示词（Summary / Data / Insight / Chapter / Quote），每套提示词包含该类型专属的内容结构要求、视觉设计方向和动画行为规范。同时将字幕精确时间戳传入 prompt，使卡片内部动画能够跟随播报节奏精准编排。

## 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 渲染模式 | 统一 web-card | 最大创意自由度，不保留 legacy 兜底 |
| 动画库 | anime.js 3.2.2 (CDN) | 17KB 轻量，时间线 API 简洁，LLM 友好 |
| 图表库 | Chart.js 4.4.7 (CDN) | 配置驱动 API，LLM 生成准确率高 |
| 字幕同步 | 传入 segment 范围内 SRT 条目 | 动画以 cardStartMs 为 t=0 编排 |

## 改动范围

### 改动文件

- `src/lib/ai-analysis.ts` — 核心改动文件

### 不改动

- `src/remotion/AICardOverlay.tsx` — 渲染管线不变
- `src/remotion/WebCardOverlay.tsx` — iframe 渲染不变
- `src/types/ai.ts` — 类型定义不变
- `src/remotion/cards/*.tsx` — legacy 组件保留不增强
- `src/lib/overlay-motion.ts` — 动画在 srcDoc 内部完成

## 详细设计

### 1. 函数拆分

将 `buildSegmentCardPrompt()` 拆分为：

```
buildSegmentCardPrompt(params)          // 路由函数，按 segment 类型分派
├── buildSummaryCardPrompt(params)      // 摘要卡片
├── buildDataCardPrompt(params)         // 数据卡片
├── buildInsightCardPrompt(params)      // 观点卡片
├── buildChapterCardPrompt(params)      // 章节卡片
└── buildQuoteCardPrompt(params)        // 金句卡片
```

路由逻辑：根据 `segment.semanticType` 或 `currentCard.type` 决定使用哪个类型 prompt。映射关系：

| semanticType | 默认卡片类型 |
|-------------|------------|
| data | Data |
| explanation | Summary |
| chapter-transition | Chapter |
| quote | Quote |
| narration | Insight |

### 2. 参数扩展

`buildSegmentCardPrompt` 新增参数：

```typescript
srtEntries?: SrtEntry[]  // 完整 SRT 条目数组，函数内部按 segment 时间范围裁剪
```

### 3. 字幕时间段落

新增 `buildRelatedSubtitlesSection()`：

- 输入：`srtEntries: SrtEntry[]`、`segment: AISegment`
- 输出：格式化文本，包含 segment 时间范围内的精确 SRT 条目
- 格式：`[HH:MM:SS.mmm --> HH:MM:SS.mmm] 字幕文本`
- 追加说明：动画时间以卡片 startMs 为 t=0，每句字幕的相对偏移 = 字幕 startMs - segment.startMs

### 4. 统一视觉基线增强

在 `buildUnifiedVisualPromptSection()` 中追加：

- anime.js CDN 引用指令：`<script src="https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js"></script>`
- Chart.js CDN 引用指令（仅 Data 类型使用）：`<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>`
- 动画编排通用约束：
  - 所有动画基于 anime.js timeline API
  - 时间轴以卡片显示时刻为 t=0
  - 入场动画不超过卡片总时长的 15%
  - 退场动画不超过卡片总时长的 10%
  - 元素动画编排应跟随字幕播报节奏
  - 避免同时移动过多元素，保持视觉重心稳定

### 5. 五套类型特化 prompt

#### Summary（摘要）

**内容结构要求**：
- 核心论点标题（一句话提炼）
- 3-5 个分层要点（bullet points）
- 每个要点对应一段字幕内容

**视觉设计方向**：
- 信息卡片风格，层级清晰
- 磨砂半透明背景板
- 要点使用图标或序号标记
- 主色 #79c4ff

**动画行为**：
- 标题 fadeIn（0-0.5s）
- 要点按字幕播报时间逐条 slideInUp + fadeIn
- 当前播报要点轻微放大高亮
- 整体完成后轻微呼吸光效

#### Data（数据）

**内容结构要求**：
- 核心数据指标（1-3 个大数字）
- 图表（柱状/环形/折线，使用 Chart.js）
- 数据标注与对比说明

**视觉设计方向**：
- 数据仪表盘风格
- 图表占主体面积
- 大数字醒目展示
- 主色 #4ed38a

**动画行为**：
- 数字 countUp 跳动（在主播念到该数字时触发）
- 图表柱状/弧线渐进生长
- 高亮数据项弹跳强调
- 数据标注在对应字幕时间淡入

#### Insight（观点）

**内容结构要求**：
- 大引号装饰
- 核心观点正文
- 出处/说话人标注

**视觉设计方向**：
- 引用卡片风格，强调思辨感
- 正文字号较大，留白充足
- 主色 #ffb347

**动画行为**：
- 大引号从上方弹入
- 正文逐行随字幕节奏渐显
- 出处标注最后淡入
- 关键词轻微高亮脉冲

#### Chapter（章节）

**内容结构要求**：
- 章节编号
- 章节标题
- 时间范围
- 一句话概要（可选）

**视觉设计方向**：
- 电影幕间转场风格
- 视觉冲击力强，简洁大气
- 主色 #9eb7ff

**动画行为**：
- 遮罩/幕帘揭示效果（0-0.8s）
- 章节号缩放入场
- 标题从底部滑入
- 时间码淡入
- 退场：整体缩小消失

#### Quote（金句）

**内容结构要求**：
- 精炼一句话
- 可选说话人标注

**视觉设计方向**：
- 大字排印，文字即主角
- 强调文字力量感
- 主色 #ff8f7a

**动画行为**：
- 文字逐词显现（严格跟随字幕每个词的时间）
- 全句完成后亮起描边脉冲
- 持续 1-2s 后退场缩小消失

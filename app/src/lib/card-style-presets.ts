import type { VisualStylePreset } from '../types/ai';
import { DEFAULT_STYLE_PRESET_ID } from '../types/ai';
import { SWISS_GRID } from './card-style-presets/swiss-grid';
import { NYT_DATA } from './card-style-presets/nyt-data';
import { CYBER_GLITCH } from './card-style-presets/cyber-glitch';
import { FILM_LEAK } from './card-style-presets/film-leak';
import { HAND_SKETCH } from './card-style-presets/hand-sketch';
import { SOFT_APPLE } from './card-style-presets/soft-apple';
import { DARK_GRAPH } from './card-style-presets/dark-graph';
import { XHS_PASTEL } from './card-style-presets/xhs-pastel';
import { MONO_BOLD } from './card-style-presets/mono-bold';

// editorial-eink 的 motion / cover facet 是从 defaults.ts 逐字抽出的视觉系统块（Task 3）。
// 注入回 {{styleSystemBlock}} 后必须与重构前的提示词字节一致，请勿手改下面两段长文。
const EDITORIAL_EINK_MOTION = `===== 视觉系统：电子杂志 × 电子墨水（深色变体）=====
美学锚点：Monocle 杂志的版式 × 电子墨水的克制 × 深色科技纪录片的影调。整张卡是一页杂志，不是一个营销弹窗。

Design DNA（违反任何一条，杂志感都会垮）：
1. 克制优于炫技 —— 不用阴影、不用浮动卡片、不用 padding box，一切信息靠**大字号 + 字体对比 + 网格留白**承载。
2. 结构优于装饰 —— 不要"装饰性 emoji"、不要彩色图标墙、不要发光晕圈；装饰只允许 1px hairline 横线、单个序号、单个 SVG 数据图形。
3. 内容层级 = 字号 + 字体共同定义 —— 最大衬线 = 主标题；中衬线 = 副标；大无衬线 = lead；小无衬线 = body；等宽 = meta。
4. 节奏靠留白 —— 卡片四周内边距 ≥ H * 0.08，正文与标题间距 ≥ H * 0.04，hairline 上下间距 ≥ H * 0.03。

主题 tokens（深色变体，硬性锁定，禁止替换）：
- 画布底色 paper：#0E0E10
- 主文字 ink：#ECE7DA
- 弱化文字 ink-mute：#8A8478
- hairline 颜色：rgba(236,231,218,0.18)
- 单一 accent：#0A84FF（系统蓝；**整张卡只能出现在 1 个语义焦点**：1 个关键数字 / 1 条进度图填充色 / 1 段高亮单词 / 1 条 accent 短横线，四选一）
- 数据图填充：未达成区 = rgba(236,231,218,0.12)（轨道）、已达成区 = #0A84FF；对比第二色用 ink-mute #8A8478，**绝不要引入第二种霓虹**。
- 禁止：任何渐变 / box-shadow / filter:blur 用于氛围光 / border-radius > 4px / 第二种 accent 色 / 霓虹紫 / 强饱和橙 / 营销绿。

字体栈：
- serif：'Noto Serif SC','Source Han Serif SC','Songti SC','STSong',Georgia,'Times New Roman',serif
- sans：'PingFang SC','Hiragino Sans GB','Source Han Sans SC','Noto Sans SC','Helvetica Neue',Helvetica,Arial,sans-serif
- mono：'SF Mono','JetBrains Mono','Source Code Pro',Menlo,Consolas,monospace

排版阶梯（H = height）：
- hero serif：H * 0.13 ~ H * 0.18，fontWeight 500-600，letterSpacing -0.01em，lineHeight 1.05，中文 ≤ 8 字 / 行
- lead sans：H * 0.045 ~ H * 0.06，fontWeight 400，lineHeight 1.45
- body sans：H * 0.032 ~ H * 0.04，fontWeight 400，lineHeight 1.5，opacity 0.85
- meta mono：H * 0.022 ~ H * 0.028，fontWeight 500，letterSpacing 0.14em，textTransform 'uppercase'
- 数据大字（data 类型主数）：H * 0.28 ~ H * 0.4，fontWeight 600，serif，accent 色；单位用 sans 小字跟在右下角，opacity 0.7

===== Bento Grid 网格语法（六类 type 共享的版式基底）=====
整张卡是一个**便当网格 (Bento Grid)**：由 1 到 N 个 tile 组合而成，每个 tile 承载一个语义单元（标题、要点、数据、注释、出处…）。tile 数量与尺寸由内容驱动，不要硬塞模板。

网格基础规则：
- 顶层容器：display:'grid', width:'100%', height:'100%', boxSizing:'border-box', position:'relative', background:'#0E0E10', padding: \`\${H*0.08}px \${W*0.07}px\`, gap: \`\${H*0.035}px\`。
- 每个 tile 是一个 div，position:'relative'，**禁止 background / border / borderRadius / boxShadow / filter**；tile 内部如需排列子元素，用 flex column / flex row（仅限 tile 内部）。
- tile 之间的分隔仅允许两种方式：① 单纯 gap 留白；② 一条 1px hairline 横线或竖线（rgba(236,231,218,0.18)），用一个 height:1 或 width:1 的 div 实现，长度 ≤ 该方向 tile 的 80%，居中落在 gap 内。
- tile **内边距**：tilePaddingX ≈ W * 0.02 ~ W * 0.03，tilePaddingY ≈ H * 0.025 ~ H * 0.04；tile 内文字必须满足"行高之和 + 间距 ≤ tile 高度 - 2 * tilePaddingY"。

视觉层级：
- 最重要的语义单元放在**最大的 tile** 上；hero tile 至少占整卡面积的 35%。
- mono meta（kicker / 编号 / 时间码）放在最小的 tile 或角落，作为元数据带；任何卡都要至少有 1 个 mono meta tile。
- accent 焦点（关键数字 / 进度填充 / 高亮单词 / 短横线）整卡只能出现 1 次，且必须在 hero tile 内。

动画契约：
- **step = tile**。tile[0..N-1] 按视觉阅读顺序（主→次 / 上→下 / 左→右）逐块揭示；揭示动画作用于 tile 这一整层 div 的 transform + opacity。
- tile 内部子元素在该 tile 的揭示窗内 4-8 帧错峰入场即可；不要让 tile 内子元素跨越多个 subtitle step。
- tile 之间禁止同一帧同时入场（同帧入场只允许在退场窗）。

常见 grid 模板（按 type 推荐主版式时直接引用其中一种）：
- SINGLE-FOCUS：gridTemplateColumns: '1fr', gridTemplateRows: '1fr'（1 tile）
- HERO-FOOTER：gridTemplateColumns: '1fr', gridTemplateRows: '4fr 1fr'（2 tile：主体 + 元数据条）
- ASYMMETRIC-2COL：gridTemplateColumns: '2fr 1fr', gridTemplateRows: '1fr'（2 tile：左主 + 右副）
- HERO-3GRID：gridTemplateColumns: '1fr', gridTemplateRows: '1fr 2fr'，下行嵌套 gridTemplateColumns: 'repeat(3, 1fr)'（4 tile：顶 hero + 下 3 等宽）
- SPLIT-50：gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr'（2 tile）
- VS-TRIPLE：gridTemplateColumns: '1fr auto 1fr', gridTemplateRows: 'auto 1fr auto'（顶 kicker / 中三柱对比 / 底 explain）
- CHART-LEGEND：gridTemplateColumns: '2fr 1fr', gridTemplateRows: 'auto 1fr'（顶 kicker 通栏 / 下左 chart / 下右 数据列表）

===== 六类 type 的版式 + 动画规范（强制对应，按 type 实现）=====

• type="chapter"（章节扉页 · 仪式感、留白最大）
  主版式：SINGLE-FOCUS（1 tile）。tile 内部垂直流：顶部 mono meta（"VOL." + 章节号）→ 中部 serif hero（≤ 6 字标题）→ accent 短横线（W * 0.08，scaleX 揭示）→ 底部 mono（节目名 / 期号）。
  备选版式：HERO-FOOTER。hero tile 放 meta + hero + bar；footer tile 放节目名 / 期号；两 tile 之间 1px hairline 横线。
  分步：主版式只有 1 个 tile，回退到 tile 内部子元素按 beats 等分入场；备选版式 step = [hero-tile, footer-tile]。
  动画：accent-bar 用 transform: scaleX(0→1)、transformOrigin:'left'，在 hero tile 揭示窗末尾单次到位；不要循环。
  表达特点：留白最大、无打扰、像一本杂志的扉页。

• type="summary"（段落总结 · 主次明确、可读）
  主版式：ASYMMETRIC-2COL。左 tile（2/3 宽）= serif 主标题（≤ 14 字）+ 居左 hairline + sans lead 段落要点（≤ 60 字，1-2 句话，不要 ul / li）。右 tile（1/3 宽）= mono kicker（编号 + 标签）+ 一条竖向 accent 短线（width 2px，height H*0.06）+ mono 时间码。
  备选版式：HERO-3GRID。顶 hero tile = 主标题；下面 2-3 个等宽 tile 拆 lead 文案（按句号切句，每句一个 tile）。
  分步：主版式 step = [左 tile, 右 tile]；备选 step = [hero, sentence-1, sentence-2, sentence-3?]。
  动画：tile 入场用 translateY(H*0.025) + opacity；hairline 用 scaleX(0→1) 单调揭示，落在主标题与 lead 之间。
  表达特点：主标题压住版面，元数据靠边站，重心稳定。

• type="quote"（金句 · 戏剧性、呼吸感）
  主版式：HERO-FOOTER。hero tile = 居左 serif 大字引文（H * 0.11 起步）+ 起首超大引号 " 或「（字号 = 引文 * 1.6，accent 色，绝对定位在 hero tile 左上）。footer tile = mono meta "—— 出处 / 说话人 / 时间戳"。两 tile 之间 1px hairline 横线。
  备选版式：SINGLE-FOCUS。整张 tile 居中放引文 + 引号；attribution 放在 tile 底部用 mono 小字，留出 H * 0.06 间距。
  分步：主版式 step = [hero-tile, footer-tile]；hero tile 内部引号 → 引文按字幕逐句揭示（引文 ≥ 2 句时可在 hero tile 内部按 beats 错峰，不另起 step）。
  动画：引号用 opacity 0→1 + translateY(H*0.02)，绝不缩放；引文按 hero tile 揭示窗一次到位，禁止打字机逐字效果；attribution 揭示后保持。
  表达特点：引号是视觉锚点，引文压满 hero tile，下方 footer 像一句署名。

• type="insight"（观点 / 结论 · 结论先行、并列对照）
  主版式：HERO-3GRID（1+3）。顶 hero tile = serif 中标题（结论一句话，≤ 18 字）+ tile 底部一条 accent 短横线。下行 3 个等宽 tile = 每个 tile 一行要点（≤ 18 字），tile 顶部 mono 编号 01 / 02 / 03（accent 色）+ tile 下半部分 sans body 文字（ink 色）。tile 之间 1px hairline 竖线。
  备选版式：SPLIT-50 的扩展（2×2）。hero tile 占左上 1 格，3 个要点 tile 占剩余 3 格；若要点只有 2 条，回退到 ASYMMETRIC-2COL（左 hero / 右垂直 2 tile）。
  分步：step = [hero-tile, point-1, point-2, point-3]；要点数量 ≤ 3，宁可少也不要多。
  动画：要点 tile 内部 mono 编号比正文早 4-6 帧入场，但编号与正文都在该 tile 的揭示窗内完成，不跨 step。
  表达特点：结论在上、依据在下，3 个并列要点节奏一致。

• type="data"（数据 / 数字对比 / 表格 / 图表 · 信息密度最高）—— **本类是这次重构的重点**
  根据数据形态选 1 种主版式：
    (a) 单值（大数字 + 解释）：主版式 = HERO-FOOTER。hero tile = serif 大数（accent，H*0.32 起步） + sans 单位（右下角，opacity 0.7） + tile 底部 mono kicker。footer tile = body 一句解释（≤ 30 字）。备选 = SINGLE-FOCUS（kicker 在 tile 顶部，explain 在 tile 底部）。
    (b) 双值对比：主版式 = VS-TRIPLE。顶 mono kicker（跨 3 列）；中行三 tile：左 = 主数 (accent)，中 = mono 标签 "VS" 或差值，右 = 对照数 (ink-mute)；底 = body 解释（跨 3 列）。备选 = SPLIT-50（左右两数，attribution 放角落）。
    (c) 柱状图（bar）：主版式 = CHART-LEGEND。顶 kicker 通栏；下左 tile = 单个 <svg> 内 ≤ 5 根 <rect>（轨道色 rgba(236,231,218,0.12) + 已揭示 accent，每根上方 serif 小数字 / 下方 mono 标签）；下右 tile = 对应数据列表（mono 标签 + serif 数字，每行一个数据项）。备选 = SINGLE-FOCUS（只放 chart，数字直接标在柱顶）。
    (d) 进度环 / 饼图（donut）：主版式 = SINGLE-FOCUS，tile 居中放 SVG <circle>（stroke-dasharray 揭示一段角度，progress-ring 方式），中央 serif 大百分比；tile 顶部 mono kicker，底部 body 解释。禁止真正的多片 pie。
    (e) 折线图（line）：主版式 = HERO-FOOTER。hero tile = 单条 <polyline>（strokeDasharray + strokeDashoffset 从 100%→0% 揭示，accent 描边、不填充）+ 两端各一个 SVG <circle> 标点 + 两端 mono 数值标签；footer tile = mono kicker + body 解释（横向并列）。
    (f) 表格（table）：主版式 = SINGLE-FOCUS。tile 内 div + flex 网格（不要用 <table>），最多 4 行 × 3 列；首行 mono 表头（ink-mute、letterSpacing 0.14em），数据行 serif 数字 + sans 标签；行与行之间 1px hairline 分隔；揭示按行进行，每行可作为 tile 内部的子 step（不另开 grid tile）。
  技术栈硬约束：所有图表必须用**纯 HTML + SVG + GSAP**（原生 <svg> + <rect>/<circle>/<path>/<polyline>），禁止引入 recharts、d3、chart.js、任何第三方图表库；禁止 canvas / WebGL。
  分步单元 step：(a) 主 = [hero-tile, footer-tile]；(b) 主 = [kicker-tile, value-A-tile, vs-tile, value-B-tile, footer-tile]（VS 与 footer 可并入相邻 tile）；(c) 主 = [kicker-tile, chart-tile, legend-tile]，chart tile 内柱子按 beats 错峰；(d) (e) (f) 主 = [tile]，tile 内部子元素按 beats 错峰。
  数字增长动画（适用于 (a)(b)(c)(d) 主数字）：每个数字在所属 tile 的揭示窗内，从 0 / 起始值 interpolate 到目标值（Easing.out(Easing.cubic)、clamp 两端），用 Math.round 处理整数、用 toFixed(1) 处理一位小数；**绝对不要每帧 Math.random / noise**。
  图表入场动画：
    - bar：每根柱子的 height（或 width）从 0 长到目标值，在 chart tile 揭示窗内按 beats 错峰；柱子之间不重叠、不挡文字。
    - line：strokeDashoffset 从总长 → 0，单调一次性揭示。
    - donut：strokeDashoffset 从 circumference → circumference*(1-pct)，单调一次性揭示，中央数字与环同步增长。
    - table：每行 translateY(H*0.02) + opacity 揭示；揭示后保持。
  数据真实性：所有数字 / 比例必须直接来自 segmentTranscriptExcerpt / segmentSummary；如果原文没有具体数字，请用 type="insight" 而不是 type="data" 编造数据。
  表达特点：hero tile 是数据焦点，辅助 tile 给标签 / 解释 / 图例；信息密度最高、tile 数量最多。

• type="motion"（兜底 / 抽象概念 · 极简 statement）
  主版式：SINGLE-FOCUS。tile 内部居中：serif 中文短标题（≤ 10 字）→ hairline → 一句 sans 注解（≤ 24 字）→ 一个轻量 SVG 几何（直线 / 圆环 / 三角，stroke 1.5px，accent 描边，不填充）。
  备选版式：SPLIT-50。左 tile = 标题 + 注解；右 tile = SVG 几何居中；两 tile 之间 1px hairline 竖线。
  分步：主版式只 1 tile，内部子元素 [title, hairline, annotation, glyph] 按 beats 错峰；备选版式 step = [左 tile, 右 tile]。
  动画：几何描边用 strokeDasharray 一次性单调揭示，不要循环。
  表达特点：留白比章节扉页更彻底，是兜底版式，能不出现就不出现。

===== 强制视觉硬规则 =====
- 容器：position relative，背景 #0E0E10 满铺，**display:'grid'**；不要在外层加任何 borderRadius / boxShadow / border。
- tile 自身：**禁止 background / border / borderRadius / boxShadow / filter**；tile 区块感只能靠 gap 留白 + 1px hairline 分隔线实现。
- 不允许任何 div 出现 background 为渐变、半透明白色磨砂、彩色发光圈；半透明 ink 色块（≤ rgba(236,231,218,0.12)）只允许作为图表轨道使用，不得作为 tile 背景。
- 不允许使用 emoji / 装饰性 unicode（★ ✦ ◆ ⚡ 之类）；装饰只用纯几何 SVG、1px hairline 或 mono 数字编号。
- 整张卡的非黑非白彩色块面积之和 ≤ 8%（accent + 数据已揭示区合计配额）。
- 中文与西文混排时，西文（年份 / 缩写 / Vol. / 单位）用 mono；中文用 serif / sans。
- 每张卡必须包含至少 1 行 mono meta，强化"杂志一页"的元数据氛围；meta 必须落在一个独立 tile 或 hero tile 的角落，不要游离在 grid 外。
- 入场仅允许 translateY + opacity（作用于 tile 层）；禁止 scale / rotate / blur 入场；禁止全屏 zoom-in。
- tile 之间禁止同帧入场（同帧仅允许在退场窗）；同一 tile 内子元素错峰不得超过 12 帧。

===== 失败示例（生成完毕后必须自查）=====
- ✗ 用 emoji ✨ 或 🚀 当标题修饰
- ✗ 卡片中间一个彩色渐变发光圆球作为氛围背景
- ✗ 标题用纯无衬线 + 100% 蓝色 + box-shadow
- ✗ 把段落摘要原文 80+ 字塞进卡片
- ✗ 出现两种以上 accent 色（蓝 + 橙 / 蓝 + 黄）
- ✗ 数字卡的数字用无衬线（必须 serif）
- ✗ 出现 border-radius:16px 的圆角卡片浮层
- ✗ "Source: …" / "AI Generated" / 节目水印 等小字
- ✗ 某个文字行揭示后又消失再揭示
- ✗ 柱状图柱子之间或与轴标签发生重叠
- ✗ 用 Math.sin(frame/10) 驱动 opacity 制造闪烁
- ✗ 引入 recharts / chart.js / d3 / canvas
- ✗ 给 tile 加半透明白色 / 任意 rgba 背景营造卡片感
- ✗ 给 tile 加 1px solid 边框围出方块（应该用 gap 留白 + hairline 分隔线代替）
- ✗ tile 之间没有 hairline 也没有足够 gap（< H * 0.03），导致两块内容糊在一起
- ✗ 顶层容器仍用 display:'flex' + flexDirection:'column' 而不是 display:'grid'
- ✗ 两个 tile 在同一帧同时入场（除非是退场窗）
- ✗ 同一 tile 内子元素错峰 > 12 帧，导致 tile 看起来分裂成两个 step
- ✗ hairline 分隔线压在 tile 内的文字或图表上，而不是落在 gap 中央`;

const EDITORIAL_EINK_COVER = `===== 视觉系统：短视频缩略图 / Thumbnail 风（默认锁定，禁止替换）=====
美学锚点：B 站知识区头部 UP 主缩略图 × YouTube 解说类频道 thumbnail × 商业短视频封面。
整张封面必须是"真实场景照片 + 卡通插画元素 + 大字综艺标题"的混合体，靠夸张冲突制造点击欲。

Design DNA（违反任何一条，缩略图感都会垮）：
1. 强冲突主体 —— 一个真实人物 / 物件 + 一个夸张卡通元素（夸张表情吉祥物、卡通监控摄像头、巨大眼睛、卡通箭头、对话气泡、放大镜、警示标志等），两者之间存在视觉冲突或戏剧关系
2. 字必须大、必须狠 —— 主标题字号占画面高度 18%-28%，是整张图的视觉焦点，比脸还显眼
3. 真实 + 卡通混合 —— 不要纯插画、不要纯写实，必须是合成感（真实办公室照片 + 卡通摄像头叠加；真实人物背影 + 卡通对话气泡）
4. 单一霓虹 accent —— 只允许 cyan(#00E5FF) / lime(#A6FF00) / magenta(#FF2EC4) 三选一，全图围绕这一种 accent 配色，禁止双 accent
5. 暗色科技底 —— 背景统一偏暗（深蓝黑 #0A0E1A / 暗灰 #14161C / 黑紫 #0F0A1A），制造 accent 发光感

===== 颜色 token（硬性锁定）=====
- 背景色 bg：从 #0A0E1A / #14161C / #0F0A1A 中选 1
- accent（霓虹主色，全图配额 ≤ 25% 面积，整张图只允许这一种霓虹）：cyan #00E5FF / lime #A6FF00 / magenta #FF2EC4 三选一
- 主标题填色 = accent 本色或更浅一档高光色
- 主标题描边 = 纯黑 #000000，描边粗度占字高 8%-12%（厚到看不清字内细节为止）
- 高光边 = 纯白 #FFFFFF，1-2px 极细，沿描边外侧
- 3D 立体投影 = 黑色或 accent 深色，向右下偏移 4%-8% 字高，硬阴影不要 blur
- 副标题颜色 = 纯白 #FFFFFF + 纯黑描边；或 accent 反色 + 黑描边

【提示词结构规范】
单条提示词必须按以下 7 个维度、严格按序组织，用中文逗号"，"或分号"；"串联，整体长度 140-220 字：

1. 主体（自然语言）
   - 真实人物或真实物件，明确动作姿态、外貌、服装、视角（背对镜头 / 侧脸 / 半身 / 仰视等）
   - 示例：一位男性程序员背对镜头坐在办公桌前；一只手伸向手机屏幕的特写；一摞堆到天花板的文件
2. 卡通元素 / 戏剧冲突（自然语言，必填）
   - 在主体周围叠加 1 个夸张卡通元素，用于制造视觉冲突或戏剧关系
   - 可选：卡通监控摄像头带巨大眼睛盯着主体；夸张卡通箭头指向某处；漂浮的对话气泡 / 思考气泡；卡通警示标志；放大镜聚焦在细节上；爆炸符号；表情夸张的吉祥物
   - 必须明确卡通元素的位置（画面左上 / 右上 / 中部 / 围绕主体）与情绪（盯着、嘲讽、警告、惊讶等）
3. 环境（自然语言）
   - 真实场景 + 暗色科技氛围：开放式办公室 / 深夜书房 / 服务器机房 / 街头夜景 / 复古录音室
   - 必须暗色调，桌面 / 屏幕 / 墙面有 accent 色的微光反射，强化 accent 统一感
4. 画面风格（独立词组，严格照抄以下组合）
   - "真实摄影合成，卡通插画叠加，互联网短视频封面设计，B站知识区缩略图风，YouTube thumbnail style"
5. 美学词（独立词组，必须覆盖以下 4 类，每类至少 1 个）
   - 色彩：高饱和度，强对比，深色科技底，单色霓虹点缀（cyan / lime / magenta 三选一并明确写出色名）
   - 灯光：戏剧化布光，霓虹氛围光，硬光高对比，accent 色边缘光
   - 构图：中心冲击构图 / 三分构图 / 对角线动势，主体居中或偏左，标题占据视觉黄金区
   - 装饰：背景斜切几何分割线，accent 色发光边框，暗色径向渐变，accent 色装饰箭头条 / 锯齿条
6. 质量词（独立词组，2-3 个）
   - 4K 超清，锐利清晰，富有层次的合成质感，大师级缩略图设计
7. 画面文字（必须包含主标题，可选副标题，由以下两段组成）
   - 7.1 文本：先从整期字幕提炼 1 条 4-8 个汉字的主标题（要狠、要冲突、要带钩子，例如"公司合法监控""你被算法骗了""老板不会告诉你"），用中文引号""…""精确包裹；可再追加 1 条 ≤6 字副标题（""摸鱼的你！""""我不允许""），同样用引号包裹
   - 7.2 排版约束（独立词组串联，必填项不可省）：
     · 字体族（主标题）：粗体综艺封面字 / 阿里妈妈数黑体 / 站酷酷黑 / 字魂综艺粗黑 / 优设标题黑；禁止衬线、禁止花体、禁止手写
     · 字重：Black / Heavy（必须最重的一档）
     · 字号：主标题占画面高度 18%-28%（不能更小），副标题占画面高度 6%-10%
     · 主标题填色：accent 霓虹色（必须明确写出 cyan #00E5FF / lime #A6FF00 / magenta #FF2EC4 之一）
     · 描边：纯黑 #000000 厚描边，粗度约字高 10%
     · 高光：1-2px 纯白 #FFFFFF 高光边沿描边外侧
     · 立体投影：黑色硬阴影向右下偏移约字高 6%，无模糊
     · 副标题：白色填色 + 黑色描边，可倾斜 6°-10° 制造冲突感
     · 排版位置：主标题居中或居中偏下，覆盖画面下半部 1/3；副标题贴在主标题右上或左下角；都不得遮挡主体面部
     · 主副标题之间允许加 1 条 accent 色装饰短线 / 箭头 / 锯齿条作为视觉串联

【强制规则】
- 主体 / 卡通元素 / 环境 必须是可读的自然语言句子，清晰交代"谁、和什么卡通元素、在哪里"
- 画面风格 / 美学词 / 质量词 / 排版约束 必须是独立词组，用中文逗号串联，禁止展开成长句
- 越靠前权重越高，严格按 主体 → 卡通元素 → 环境 → 风格 → 美学 → 质量 → 文字与排版 的顺序排布
- 整体长度 140-220 字；必须包含 1 个夸张卡通元素 + 1 条主标题 + 至多 1 条副标题
- 使用中文逗号"，"或分号"；"分隔要素，禁止使用换行、斜杠 /、括号堆叠或其它特殊符号
- 必须使用简体中文；色值、字体族名、风格锚点英文（YouTube thumbnail / B站）可保留
- 文字标题必须用中文引号""…""精确包裹，保证 AI 生图的文字准确率
- 整张图只允许出现 1 条主标题 + 至多 1 条副标题，禁止期号、署名、水印、logo、日期、二维码、UI 控件
- 标题文本必须紧扣本期核心冲突 / 反差 / 钩子，禁止"美丽、震撼、惊艳、极致、终极"等空泛形容词
- accent 色全图只能出现 1 种霓虹（cyan / lime / magenta 三选一），禁止双霓虹混搭
- 面向 16:9 封面：主体不能被裁掉、标题不能贴边、卡通元素与主体必须有清晰的空间关系
- 禁止裸露、暴力、政治敏感、真人换脸、明星肖像、品牌侵权

【参考示例】（仅示范格式与颗粒度，不要照抄内容；该示例使用 cyan accent）
一位男性程序员背对镜头坐在开放式办公桌前面对三块显示器敲键盘，画面右上角悬浮着一只夸张的卡通监控摄像头，摄像头有一只巨大的卡通眼睛圆睁着死死盯着员工后脑，整体氛围紧张戏剧化，环境是深夜暗色调开放式办公室，桌面与屏幕透出青色微光打在墙面与天花板上，真实摄影合成，卡通插画叠加，互联网短视频封面设计，B站知识区缩略图风，YouTube thumbnail style，高饱和度，强对比，深色科技底 #0A0E1A，单色霓虹点缀 cyan #00E5FF，戏剧化布光，霓虹氛围光，硬光高对比，cyan 边缘光，中心冲击构图，主体居中偏左，背景斜切几何分割线，cyan 发光边框，暗色径向渐变，cyan 装饰箭头条，4K 超清，锐利清晰，大师级缩略图设计，画面下半部居中呈现主标题""公司合法监控""，字魂综艺粗黑，Black，字号约占画面高度 24%，主色 cyan #00E5FF 霓虹填充，纯黑 #000000 厚描边约字高 10%，1-2px 纯白 #FFFFFF 高光边，黑色硬阴影向右下偏移字高 6%，主标题右上方贴一条副标题""摸鱼的你！""为白色填色配纯黑描边并倾斜 8°，主副标题之间加一条 cyan 锯齿装饰条作为视觉串联，全部文字均不遮挡主体面部`;

const EDITORIAL_EINK: VisualStylePreset = {
  id: DEFAULT_STYLE_PRESET_ID,
  name: '电子杂志墨水',
  description: '深色克制社论风：衬线标题、hairline 分隔、无渐变无阴影、单一系统蓝 accent。',
  tags: ['深色', '社论', '克制'],
  source: 'deck-guizang-editorial / web-proto-editorial',
  palette: { bg: '#0E0E10', ink: '#ECE7DA', muted: '#8A8478', accent: '#0A84FF' },
  fonts: {
    display: "'Noto Serif SC', Georgia, serif",
    body: "'PingFang SC', 'Noto Sans SC', sans-serif",
    mono: "'SF Mono', 'JetBrains Mono', monospace",
  },
  facets: { motion: EDITORIAL_EINK_MOTION, cover: EDITORIAL_EINK_COVER, image: '' },
  preview: {},
};

export const VISUAL_STYLE_PRESETS: VisualStylePreset[] = [
  EDITORIAL_EINK,
  SWISS_GRID,
  NYT_DATA,
  CYBER_GLITCH,
  FILM_LEAK,
  HAND_SKETCH,
  SOFT_APPLE,
  DARK_GRAPH,
  XHS_PASTEL,
  MONO_BOLD,
];

export function listStylePresets(): VisualStylePreset[] {
  return VISUAL_STYLE_PRESETS;
}

import type { VisualStylePreset } from '../../types/ai';

const NYT_DATA_MOTION = `===== 视觉系统：NYT 数据社论 =====
美学锚点：纽约时报 The Upshot 的数据社论 × FT 手绘风折线图 × 衬线大标题的权威感。整张卡是一篇配图的社论，数据图是论点的证据，不是装饰。

Design DNA（违反任何一条，社论感都会垮）：
1. 衬线主导 —— insight / 大标题一律 serif，权威、克制；sans 只用于正文与图例，mono 只用于脚注与数值。
2. 数据即证据 —— 图表用纯 SVG + GSAP 的 strokeDashoffset「手写揭示」折线 / 柱，单墨色 + 新闻红 accent，绝不彩虹色系。
3. 单墨 + 新闻红 —— 全卡只用 ink 墨色 + 1 处新闻红 accent（最关键的那条线 / 那根柱 / 那个数）。
4. 报纸排版细节 —— 11px 大写 mono kicker、等宽脚注、hairline 分隔，留白克制而紧凑。

主题 tokens（硬性锁定，禁止替换）：
- 画布底色 bg：#F7F5EE（暖白）
- 主墨色 ink：#121212
- 弱化文字 muted：#6E6E6E
- 单一 accent：#A91D1D（新闻红；整卡只能 1 个语义焦点）
- hairline：rgba(18,18,18,0.2)，1px
- 数据图：底层轨道 / 对照线用 muted，焦点线 / 焦点柱用 accent；禁止第二种彩色、禁止渐变填充。

字体栈：
- display(serif)：'Noto Serif SC','Georgia',serif
- body(sans)：'PingFang SC','Noto Sans SC',sans-serif
- mono：'JetBrains Mono',monospace

排版阶梯（H = height）：
- insight serif hero：H * 0.12 ~ H * 0.17，fontWeight 600，lineHeight 1.1，letterSpacing -0.005em
- lead sans：H * 0.04 ~ H * 0.052，fontWeight 400，lineHeight 1.45
- kicker mono：H * 0.02（约 11px @ H=580），fontWeight 600，letterSpacing 0.16em，textTransform 'uppercase'，accent 或 ink
- 脚注 mono：H * 0.018 ~ H * 0.022，muted，letterSpacing 0.08em
- 数据大字（serif）：H * 0.26 ~ H * 0.36，fontWeight 600，accent 或 ink

===== 区块语法（step 单元 = 图表 / 文字区）=====
顶层容器 display:'grid'，按内容选 HERO-FOOTER / CHART-LEGEND / ASYMMETRIC-2COL，gap: H*0.035，padding: H*0.075 / W*0.065，background:'#F7F5EE'。
- **step 单元 = 一个区（图表区 或 文字区）**，与 trunk 的「step = tile」一一对应；区按阅读顺序（kicker→标题→图表→脚注）记作 step[0..N-1]。
- 区禁止 background / border / borderRadius / shadow；分隔只用 gap + 1px hairline。
- 图表区与文字区必须分属不同区，图表绝不压在文字上。

六类 type 版式提示（data 是本风格重点）：
- data：CHART-LEGEND。顶 mono kicker 通栏；图表区放纯 <svg>：折线用 <polyline>（strokeDasharray + strokeDashoffset 100%→0% 单调揭示，accent 焦点线 + muted 对照线）；柱用 ≤5 根 <rect>（height 0→目标，accent 焦点柱）；图例区 mono 标签 + serif 数值。数字从 0 interpolate 到目标（clamp，Math.round），禁止逐帧 random。
- insight：顶 serif 结论 hero + accent 短横线；下行 2-3 区各一条要点，mono 编号。
- summary：左 serif 标题 + sans lead；右 mono kicker + 时间码。
- quote：serif 大引文 + accent 起首引号；底 mono 出处。
- chapter：serif 章节标题 + mono VOL. 编号 + accent 短色条（scaleX 揭示）。
- motion：serif 短标题 + 一条手绘感 SVG 折线（strokeDashoffset 揭示），留白最大。

硬性视觉规则：
- 大标题必 serif；数字必 serif；kicker / 脚注 / 单位必 mono；正文 sans。
- 图表必用纯 HTML + SVG + GSAP（polyline / rect / circle / path），禁止 recharts / d3 / chart.js / canvas。
- 折线 strokeDashoffset、柱 height、数字增长都在所属区揭示窗内单调一次性到位；揭示后保持，禁止逐帧 Math.random / Math.sin。
- 入场仅 translateY + opacity；禁止 scale>1.04 / rotate / blur / 整卡 scale。

失败示例（生成后必自查）：
- ✗ 折线 / 柱用彩虹多色，或出现第二种 accent
- ✗ 大标题用无衬线（必 serif）
- ✗ 引入 recharts / chart.js / d3 / canvas 画图
- ✗ 数字用每帧 Math.random 跳动而非单调 interpolate
- ✗ 图表压在标题或脚注文字之上`;

const NYT_DATA_COVER = `===== 视觉系统：NYT 数据社论 封面 =====
美学锚点：纽约时报数据社论头图 × 手绘折线图 × 衬线权威标题。16:9 封面是一张「数据 + 社论标题」的暖白底图，靠一条手绘感折线 / 一组柱状图 + serif 大标题制造权威钩子。

按维度顺序组织（主体→构图→风格→美学→质量→文字排版），中文逗号串联，120-180 字：
1. 主体：一条手绘风格的折线图或一组简洁柱状图作为视觉主体，单墨色线条 + 1 条新闻红焦点线 / 焦点柱，暖白纸面，无人物、无卡通元素。
2. 构图：图表占据画面中部或左侧，serif 大标题压住上方或下方，留白克制，hairline 网格基线，绝对直角。
3. 风格：纽约时报数据社论风，The Upshot data journalism style，手绘折线图，编辑设计排版，报纸社论美学。
4. 美学：暖白底 #F7F5EE，纯墨 #121212，单点缀新闻红 #A91D1D，单墨色数据可视化，无渐变无发光，高对比克制。
5. 质量：4K 超清，锐利清晰，专业编辑设计，数据新闻级精度。
6. 文字排版：从字幕提炼 1 条 6-12 字 serif 主标题用中文引号""…""精确包裹，衬线粗体（思源宋体 / Georgia，Semibold），占版面高度 14%-22%，纯墨色填色；可选 1 条 11px mono 大写 kicker 用新闻红点缀。

强制规则：
- 主标题必用中文引号""…""精确包裹保证文字准确率；标题必衬线；整图只允许 1 主标题 + 至多 1 mono kicker，禁止水印 / logo / 日期。
- 新闻红全图只 1 处焦点点缀，禁止彩虹数据色、禁止第二种彩色、禁止渐变填充。
- 必暖白底 + 单墨数据图 + 直角；禁止圆角卡片、阴影、3D 立体图表、卡通贴纸。`;

const NYT_DATA_IMAGE = `===== 视觉系统：NYT 数据社论 段落配图 =====
美学锚点：社论内文配图 —— 一张单墨色 + 新闻红的手绘感数据示意图，图内不出现任何文字。

按维度顺序组织（主体→构图→风格→美学→质量），中文逗号串联，90-150 字：
1. 主体：紧扣本段语义的抽象数据示意 —— 一条手绘折线、一组简洁柱、一个标点圆点的趋势图，单墨色线条 + 1 条新闻红焦点，暖白纸面。
2. 构图：图形居中或偏置留白，hairline 基线，绝对直角，不留圆角。
3. 风格：纽约时报数据社论配图，手绘折线图，编辑插画，单墨色数据可视化。
4. 美学：暖白底 #F7F5EE，纯墨 #121212，单点缀新闻红 #A91D1D，无渐变无发光，克制高对比。
5. 质量：4K 超清，锐利清晰，专业编辑插画精度。

强制规则：
- 图内禁止出现任何文字 / 数字标签 / 水印 / logo（段落配图不承载标题）。
- 新闻红只 1 处焦点，禁止彩虹色、第二 accent、渐变；必暖白底 + 单墨数据图 + 直角。`;

export const NYT_DATA: VisualStylePreset = {
  id: 'nyt-data',
  name: 'NYT 数据社论',
  description: '暖白社论风：serif 大标题、手绘 SVG 折线/柱、单墨色 + 新闻红 accent、等宽脚注。',
  tags: ['暖白', '数据', '社论'],
  source: 'frame-data-chart-nyt',
  palette: { bg: '#F7F5EE', ink: '#121212', muted: '#6E6E6E', accent: '#A91D1D' },
  fonts: {
    display: "'Noto Serif SC','Georgia',serif",
    body: "'PingFang SC','Noto Sans SC',sans-serif",
    mono: "'JetBrains Mono',monospace",
  },
  facets: { motion: NYT_DATA_MOTION, cover: NYT_DATA_COVER, image: NYT_DATA_IMAGE },
  preview: {
    motionHtml: `<style>
  .sp-root{width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:4%;font-family:'Noto Serif SC','Georgia',serif;background:#F7F5EE;color:#121212;box-sizing:border-box;padding:7% 7%;}
  .sp-kicker{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#A91D1D;}
  .sp-chart{width:100%;height:38%;}
  .sp-line{fill:none;stroke:#A91D1D;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;}
  .sp-base{stroke:rgba(18,18,18,0.2);stroke-width:1;}
  .sp-title{font-size:clamp(22px,6vw,46px);font-weight:600;line-height:1.1;}
  .sp-sub{font-family:'PingFang SC','Noto Sans SC',sans-serif;font-size:clamp(11px,2.6vw,15px);color:#6E6E6E;line-height:1.45;}
</style>
<div class="sp-root">
  <div class="sp-kicker">THE UPSHOT — DATA</div>
  <svg class="sp-chart" viewBox="0 0 300 100" preserveAspectRatio="none">
    <line class="sp-base" x1="0" y1="92" x2="300" y2="92"></line>
    <polyline class="sp-line" points="6,80 70,58 130,66 200,28 294,12"></polyline>
  </svg>
  <div class="sp-title">示例标题</div>
  <div class="sp-sub">一句副标题或注解</div>
</div>
<script>
  (function(){
    var tl = gsap.timeline({ paused: true });
    var line = document.querySelector('.sp-line');
    var len = line && line.getTotalLength ? line.getTotalLength() : 400;
    if (line) { line.style.strokeDasharray = len; line.style.strokeDashoffset = len; }
    tl.from('.sp-kicker', { y: 14, opacity: 0, duration: 0.4, ease: 'power2.out' })
      .to('.sp-line', { strokeDashoffset: 0, duration: 0.9, ease: 'power2.out' }, '-=0.1')
      .from('.sp-title', { y: 22, opacity: 0, duration: 0.55, ease: 'power3.out' }, '-=0.4')
      .from('.sp-sub', { y: 14, opacity: 0, duration: 0.45, ease: 'power2.out' }, '-=0.2');
    window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
    window.__lingjiMotionTimelines.push(tl);
  })();
</script>`,
  },
};

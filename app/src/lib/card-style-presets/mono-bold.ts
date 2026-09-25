import type { VisualStylePreset } from '../../types/ai';

const MONO_BOLD_MOTION = `===== 视觉系统：极简大字 =====
美学锚点：极简导航 deck × 单色满版 × 超大 display 标题。整张卡极致克制：单色满铺底、占画面大比例的超大粗体标题、一条 4px accent 亮黄短色条、mono 列表带箭头前缀。几乎无装饰，靠字号与留白说话。

Design DNA（违反任何一条，大字感都会垮）：
1. 单色满铺底 —— bg 单一深底色 (#1B1B1F) 满铺，绝无渐变 / 光晕 / 纹理，纯净底面。
2. 超大 display 标题 —— hero 标题占画面高度大比例（H * 0.18 ~ H * 0.28），超大字重 (800-900)，是整卡绝对焦点，比一切都显眼。
3. accent 短色条 —— 唯一彩色装饰是一条 4px 高的亮黄 (#FFE600) 短色条，用 scaleX(0→1) 一次性揭示，作标题与列表的视觉锚点。
4. mono 列表带箭头前缀 —— 列表项用 mono 字体 + "→" 箭头前缀引导，克制排列，无项目符号墙、无图标。

主题 tokens（硬性锁定，禁止替换）：
- 画布底色 bg：#1B1B1F（单色深底）
- 主文字 ink：#F5F5F0（近白）
- 弱化文字 muted：#8A8A82（中灰）
- 单一 accent：#FFE600（亮黄；仅作 4px 短色条 / 1 处焦点高亮，整卡只能 1 个语义焦点）
- accent 色条：height 4px，background #FFE600，transformOrigin left，scaleX(0→1) 揭示
- 列表前缀：mono "→ "，ink 或 muted 色
- 禁止：渐变 / 光晕 / 阴影氛围 / borderRadius > 4px / 第二种彩色 accent / 任何装饰 emoji 或图标墙。

字体栈：
- display：'Inter Tight','Helvetica Neue',sans-serif（超大字重 800-900）
- body：'Inter','Noto Sans SC',sans-serif
- mono：'JetBrains Mono',monospace

排版阶梯（H = height）：
- hero display：H * 0.18 ~ H * 0.28，fontWeight 800-900，letterSpacing -0.02em，lineHeight 0.95，占画面大比例
- lead body：H * 0.04 ~ H * 0.052，fontWeight 400，lineHeight 1.45，muted
- mono 列表项：H * 0.032 ~ H * 0.042，fontWeight 500，letterSpacing 0.02em，带 "→" 前缀
- 数据大字（display）：H * 0.3 ~ H * 0.4，fontWeight 900，ink 或 accent 亮黄

===== 区块语法（step 单元 = 标题 → 色条 → 列表项）=====
顶层容器 position:'relative'，background:'#1B1B1F'，display:'grid'，按内容选 SINGLE-FOCUS / HERO-FOOTER，gap: H*0.035，padding: H*0.08 / W*0.07；无任何氛围层，底面纯净。
- **step 单元 = 标题 / 色条 / 单个列表项**，与 trunk 的「step = tile」一一对应；按阅读顺序记作 step[0..N-1]（典型顺序：标题 → 色条 → 列表项 1..N）。
- 文本块 / 标题禁止 background / border / borderRadius / shadow（accent 短色条本身是内容，不构成块背景）；分隔仅靠 gap 留白或 1px hairline rgba(245,245,240,0.14)。
- 无氛围层、无装饰层，极致克制。

六类 type 版式提示：
- chapter：超大 display 标题居中 / 居左 + mono 章节号 + 一条 accent 亮黄短色条（scaleX 揭示）。
- summary：超大标题 + accent 色条 + 一句 mono lead；右下 mono 时间码。
- quote：超大引文（display），起首 accent 亮黄引号；底 mono 出处。
- insight：超大结论标题 + accent 色条；下行 2-3 条 mono "→" 列表要点。
- data：单值超大数字（display，ink 或 accent 亮黄）+ mono 单位；多值用纯 SVG <rect> 柱（轨道 muted、焦点 accent 亮黄，height 0→目标揭示）。
- motion：超大短标题 + accent 色条 + 一条 mono 注解，留白最大。

硬性视觉规则：
- 入场仅 translateY(H*0.025) + opacity 0→1（作用于标题 / 列表项层）；可叠加 scale 从 0.97→1（scale **≤1.04**）；reveal-then-hold，一次性、不循环。
- accent 亮黄色条用 scaleX(0→1)、transformOrigin:'left' 一次性单调揭示；揭示后保持。
- 单色底面纯净写死，不进入任何 tween；无渐变 / 光晕 / 逐帧动效。
- 严禁 Math.sin / Math.cos / random / noise 调制 opacity / translate / scale；严禁 spring 无限物理；严禁整卡 scale / rotate；严禁 scale > 1.04 / 渐变 / 光晕。

失败示例（生成后必自查）：
- ✗ 标题不够大（应占画面高度 18%-28%、是绝对焦点）
- ✗ 底面加渐变 / 光晕 / 纹理破坏单色满版
- ✗ 出现第二种彩色 accent 或图标墙 / emoji 装饰
- ✗ 用 Math.sin / random 让标题或色条逐帧抖动
- ✗ scale 入场冲过 1.04 / 色条做无限往返`;

const MONO_BOLD_COVER = `===== 视觉系统：极简大字 封面 =====
美学锚点：极简导航 deck × 单色满版 × 超大粗体标题。16:9 封面极致克制：单色深底满铺 + 占画面大比例的超大粗体标题 + 一条 4px 亮黄短色条，靠大字冲击制造钩子。

按维度顺序组织（主体→构图→风格→美学→质量→文字排版），中文逗号串联，120-180 字：
1. 主体：画面主体就是超大粗体标题文字本身，占据画面大比例，无人物特写、无卡通元素、无多余图形。
2. 构图：单色深底满铺，超大标题居中或居左压满版面，一条 4px 亮黄短色条作视觉锚点，极致留白克制。
3. 风格：极简大字海报，单色满版，超大粗体 display 排版，瑞士极简，editorial bold typography，minimal poster。
4. 美学：单色深底 #1B1B1F，近白文字 #F5F5F0，单点缀亮黄 #FFE600 短色条，纯净无渐变无光晕无阴影，高对比克制。
5. 质量：4K 超清，锐利清晰，专业排版视觉，极简海报级精度。
6. 文字排版：从字幕提炼 1 条 4-10 字主标题用中文引号""…""精确包裹，超粗无衬线（Inter Tight / Helvetica Neue，Black 800-900），占版面高度 22%-32%（必须超大），近白填色，配 1 条 4px 亮黄短色条；可选 1 条 mono 小字 kicker。

强制规则：
- 主标题必用中文引号""…""精确包裹保证文字准确率；整图只允许 1 主标题 + 至多 1 kicker，禁止水印 / logo / 日期。
- 亮黄为唯一 accent 且仅作短色条 / 焦点，禁止第二种彩色、禁止渐变 / 光晕 / 阴影氛围。
- 必单色满版深底 + 超大粗体标题 + 4px 亮黄短色条；禁止浅底、纹理、卡通贴纸。`;

export const MONO_BOLD: VisualStylePreset = {
  id: 'mono-bold',
  name: '极简大字',
  description: '单色满版深底：占画面大比例的超大粗体标题、4px 亮黄短色条 scaleX 揭示、mono 箭头前缀列表，极致克制。',
  tags: ['高对比', '极简', '大字'],
  source: 'deck-dir-key-nav / deck-simple',
  palette: { bg: '#1B1B1F', ink: '#F5F5F0', muted: '#8A8A82', accent: '#FFE600' },
  fonts: {
    display: "'Inter Tight','Helvetica Neue',sans-serif",
    body: "'Inter','Noto Sans SC',sans-serif",
    mono: "'JetBrains Mono',monospace",
  },
  facets: { motion: MONO_BOLD_MOTION, cover: MONO_BOLD_COVER },
  preview: {
    motionHtml: `<style>
  .sp-root{position:relative;width:100%;height:100%;display:grid;align-content:center;gap:4%;font-family:'Inter Tight','Helvetica Neue',sans-serif;background:#1B1B1F;color:#F5F5F0;box-sizing:border-box;padding:8% 7%;overflow:hidden;}
  .sp-kicker{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#8A8A82;}
  .sp-title{font-size:clamp(34px,11vw,84px);font-weight:800;letter-spacing:-0.02em;line-height:0.95;}
  .sp-bar{width:16%;height:4px;background:#FFE600;transform-origin:left;}
  .sp-list{display:grid;gap:6px;font-family:'JetBrains Mono',monospace;font-size:clamp(11px,2.6vw,15px);color:#8A8A82;letter-spacing:0.02em;}
</style>
<div class="sp-root">
  <div class="sp-kicker">SECTION 01</div>
  <div class="sp-title">示例标题</div>
  <div class="sp-bar"></div>
  <div class="sp-list">
    <div class="sp-item">→ 第一条要点</div>
    <div class="sp-item">→ 第二条要点</div>
  </div>
</div>
<script>
  (function(){
    var tl = gsap.timeline({ paused: true });
    tl.from('.sp-kicker', { y: 12, opacity: 0, duration: 0.4, ease: 'power2.out' })
      .from('.sp-title', { y: 24, opacity: 0, duration: 0.6, ease: 'power3.out' }, '-=0.15')
      .from('.sp-bar', { scaleX: 0, duration: 0.5, ease: 'power3.out' }, '-=0.2')
      .from('.sp-item', { y: 14, opacity: 0, duration: 0.4, stagger: 0.1, ease: 'power2.out' }, '-=0.2');
    window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
    window.__lingjiMotionTimelines.push(tl);
  })();
</script>`,
  },
};

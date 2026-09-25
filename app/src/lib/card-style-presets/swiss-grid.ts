import type { VisualStylePreset } from '../../types/ai';

const SWISS_GRID_MOTION = `===== 视觉系统：瑞士国际主义网格 =====
美学锚点：Josef Müller-Brockmann 的栅格海报 × Helvetica 的中性 × 极致的字号对比。整张卡是一张严格对齐栅格的版面，靠留白与字号说话，绝不靠装饰。

Design DNA（违反任何一条，瑞士感都会垮）：
1. 栅格至上 —— 一切元素吸附到 16 栏隐形网格的列基线，左对齐、上对齐，绝不居中堆砌、绝不随意浮动。
2. 极致字号对比 —— 同卡内最大字号与最小字号之比 ≥ 6:1（超大 hero vs 极小 meta），中间层级越少越好。
3. 绝对直角 —— borderRadius 恒为 0；分隔只用 1px hairline，无阴影、无渐变、无 blur、无发光。
4. 单点缀克莱因蓝 —— accent 整卡只出现 1 次（1 个编号 / 1 条短色条 / 1 个高亮词），其余皆为纯黑墨。

主题 tokens（硬性锁定，禁止替换）：
- 画布底色 bg：#FAF8F2（暖白）
- 主墨色 ink：#111111
- 弱化文字 muted：#6B6B6B
- 单一 accent：#0033A0（克莱因蓝；整卡只能 1 个语义焦点）
- hairline：rgba(17,17,17,0.22)，固定 1px
- 禁止：任何渐变 / box-shadow / filter:blur / borderRadius > 0 / 第二种彩色 / 半透明色块背景。

字体栈：
- display：'Inter Tight','Helvetica Neue',Arial,sans-serif（标题用，紧排）
- body：'Inter','Noto Sans SC',sans-serif
- mono：'JetBrains Mono',monospace（编号 / kicker / 单位）

排版阶梯（H = height）：
- hero display：H * 0.16 ~ H * 0.24，fontWeight 700，letterSpacing -0.02em，lineHeight 0.98
- lead sans：H * 0.05 ~ H * 0.065，fontWeight 500，lineHeight 1.3
- body sans：H * 0.032 ~ H * 0.04，fontWeight 400，lineHeight 1.45
- meta mono：H * 0.02 ~ H * 0.026，fontWeight 500，letterSpacing 0.18em，textTransform 'uppercase'

===== 网格区块语法（step 单元 = 网格区块）=====
顶层容器 display:'grid'，gridTemplateColumns:'repeat(16, 1fr)'（16 栏），gridTemplateRows 按内容定 2-4 行，gap: H*0.03，padding: H*0.07 上下 / W*0.06 左右，background:'#FAF8F2'。
- **step 单元 = 一个网格区块（grid-area）**：每个区块用 gridColumn / gridRow 跨若干栏占位，承载一个语义单元（hero / lead / 编号 / meta / 数据）。区块按视觉阅读顺序（左上→右→下）记作 step[0..N-1]，与 trunk 的「step = tile」时序契约一一对应。
- 区块本身禁止 background / border / borderRadius / shadow；区块之间只用 gap 留白或 1px hairline（落在 gap 中央）分隔。
- 字号巨大的 hero 区块至少跨 9 栏；meta 区块只占角落 2-3 栏。

六类 type 版式提示：
- chapter：hero 跨满 16 栏顶部，左下角 mono 章节号 + 一条 accent 短色条（scaleX 揭示）。
- summary：左 hero 标题跨 10 栏，右侧 6 栏放 mono kicker + lead 要点；中间 1px hairline 竖线。
- quote：超大引文左对齐跨 12 栏，起首 accent 大引号绝对定位左上；底部 mono 出处跨 6 栏。
- insight：顶部结论 hero 跨满栏，下行 2-3 个等宽区块各放一条要点，区块顶 mono 编号 01/02/03（accent）。
- data：单值时大数字（display，accent，H*0.3 起）跨左 10 栏 + mono 单位；多值用纯 SVG <rect> 柱（轨道 muted、已揭示 accent，strokeWidth 0）跨下半区块。
- motion：hero 短标题跨 12 栏 + 一条 accent 短线，留白最大。

硬性视觉规则：
- 顶层必须 display:'grid' 的 16 栏体系，元素吸附列基线；禁止 flex 居中堆叠。
- 入场仅 translateY(H*0.025) + opacity；accent 色条 / hairline 用 scaleX(0→1)、transformOrigin:'left' 一次性揭示，揭示后保持。
- 禁止 scale>1.04 / rotate / blur 入场；禁止逐帧 random / Math.sin 调制；揭示后元素不得再消失。

失败示例（生成后必自查）：
- ✗ 标题居中且字号与正文相近，缺乏极致字号对比
- ✗ 出现圆角卡片 / 阴影 / 渐变背景
- ✗ 克莱因蓝出现 2 处以上，或混入第二种彩色
- ✗ 元素自由浮动、不对齐任何列基线
- ✗ 用 Math.sin 驱动色条做呼吸闪烁`;

const SWISS_GRID_COVER = `===== 视觉系统：瑞士国际主义网格 封面 =====
美学锚点：国际主义海报 × 严格栅格 × 巨字号留白。16:9 封面是一张对齐网格的极简海报，靠字号与留白制造张力，不靠人物特写或卡通元素。

按以下维度顺序组织提示词（主体→构图→风格→美学→质量→文字排版），中文逗号串联，整体 120-180 字：
1. 主体：一个极简的几何或排版主体（巨大无衬线标题占据左半版面，或单个对齐网格的抽象几何块），暖白底面，无人物特写、无卡通元素。
2. 构图：严格 16 栏网格对齐，左对齐上对齐，大面积负空间留白，主元素吸附列基线，绝对直角不留圆角。
3. 风格：瑞士国际主义平面设计，Helvetica/Inter Tight 排版海报，极简栅格设计，Josef Müller-Brockmann style。
4. 美学：暖白底 #FAF8F2，纯黑墨 #111111，单点缀克莱因蓝 #0033A0，1px hairline 分隔，无阴影无渐变无发光，高对比极简。
5. 质量：4K 超清，锐利清晰，专业平面设计排版，海报级精度。
6. 文字排版：从字幕提炼 1 条 4-10 字主标题用中文引号""…""精确包裹，超大无衬线粗体（Inter Tight / Helvetica，Bold/Black），左对齐占版面高度 18%-28%，纯黑墨填色，仅 1 个词或 1 条短色条用克莱因蓝点缀；可选 1 条 mono 大写小字 kicker。

强制规则：
- 主标题必用中文引号""…""精确包裹以保证文字准确率；整图只允许 1 条主标题 + 至多 1 条 kicker，禁止水印 / logo / 日期 / 二维码。
- 克莱因蓝全图只能 1 处点缀，禁止第二种彩色、禁止霓虹、禁止渐变。
- 必须暖白底 + 纯黑墨 + 直角栅格；禁止圆角卡片、阴影、人物大头照、卡通贴纸。`;

export const SWISS_GRID: VisualStylePreset = {
  id: 'swiss-grid',
  name: '瑞士国际主义',
  description: '暖白底 16 栏栅格、极致字号对比、绝对直角 1px hairline、单点缀克莱因蓝。',
  tags: ['浅色', '网格', '极简'],
  source: 'deck-swiss-international',
  palette: { bg: '#FAF8F2', ink: '#111111', muted: '#6B6B6B', accent: '#0033A0' },
  fonts: {
    display: "'Inter Tight','Helvetica Neue',Arial,sans-serif",
    body: "'Inter','Noto Sans SC',sans-serif",
    mono: "'JetBrains Mono',monospace",
  },
  facets: { motion: SWISS_GRID_MOTION, cover: SWISS_GRID_COVER },
  preview: {
    motionHtml: `<style>
  .sp-root{width:100%;height:100%;display:grid;grid-template-columns:repeat(16,1fr);grid-template-rows:1fr auto auto;gap:4%;font-family:'Inter Tight','Helvetica Neue',Arial,sans-serif;background:#FAF8F2;color:#111111;box-sizing:border-box;padding:7% 6%;align-content:end;}
  .sp-kicker{grid-column:1 / 7;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#6B6B6B;}
  .sp-title{grid-column:1 / 14;font-size:clamp(28px,9vw,72px);font-weight:700;letter-spacing:-0.02em;line-height:0.98;}
  .sp-bar{grid-column:1 / 5;height:6px;background:#0033A0;transform-origin:left;}
  .sp-sub{grid-column:1 / 12;font-size:clamp(11px,2.6vw,16px);font-weight:500;color:#6B6B6B;line-height:1.3;}
</style>
<div class="sp-root">
  <div class="sp-kicker">VOL. 01 — GRID SYSTEM</div>
  <div class="sp-title">示例标题</div>
  <div class="sp-bar"></div>
  <div class="sp-sub">一句副标题或注解</div>
</div>
<script>
  (function(){
    var tl = gsap.timeline({ paused: true });
    tl.from('.sp-kicker', { y: 16, opacity: 0, duration: 0.4, ease: 'power2.out' })
      .from('.sp-title', { y: 24, opacity: 0, duration: 0.6, ease: 'power3.out' }, '-=0.15')
      .from('.sp-bar', { scaleX: 0, duration: 0.5, ease: 'power3.out' }, '-=0.2')
      .from('.sp-sub', { y: 14, opacity: 0, duration: 0.45, ease: 'power2.out' }, '-=0.2');
    window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
    window.__lingjiMotionTimelines.push(tl);
  })();
</script>`,
  },
};

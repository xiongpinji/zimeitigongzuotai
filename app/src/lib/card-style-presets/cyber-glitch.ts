import type { VisualStylePreset } from '../../types/ai';

const CYBER_GLITCH_MOTION = `===== 视觉系统：赛博故障 =====
美学锚点：CRT 显示器的扫描线 × 等宽终端字体 × RGB 色差的故障美学。整张卡像一块通电的旧显示器，色差与扫描线是固定的静态质感，不是逐帧抖动。

Design DNA（违反任何一条，赛博感都会垮）：
1. 近黑底 + 等宽 —— 所有文字一律等宽字体，近黑底面，像终端输出。
2. 固定色差 —— 青 / 品红色差用一次性写死的 text-shadow（青向左偏、品红向右偏），DETERMINISTIC，绝不逐帧随机抖动、绝不动画化偏移量。
3. 静态扫描线 + grain —— CRT 扫描线用 CSS repeating-linear-gradient 静态铺一层（约 6% 不透明），是固定背景纹理，不闪烁。
4. 单 accent 青 —— accent 主色是青 #00D4FF；品红 #FF2EC4 只作色差的偏移色，不充当第二 accent 主色、不大面积使用。

主题 tokens（硬性锁定，禁止替换）：
- 画布底色 bg：#070708（近黑）
- 主文字 ink：#E8E8E8
- 弱化文字 muted：#7A7A8A
- 单一 accent：#00D4FF（青；整卡只能 1 个语义焦点）
- 色差偏移色：品红 #FF2EC4（仅用于 text-shadow 色差，不作主色块）
- 扫描线：repeating-linear-gradient(0deg, rgba(0,0,0,0) 0 2px, rgba(0,0,0,0.06) 2px 3px)，固定静态层
- 禁止：氛围发光 blur 圈 / 渐变光晕 / 第二种大面积彩色 / borderRadius > 4px / 逐帧动画化的色差或扫描。

字体栈：
- display：'Space Grotesk','JetBrains Mono',monospace
- body：'JetBrains Mono','Noto Sans SC',monospace
- mono：'JetBrains Mono',monospace

排版阶梯（H = height）：
- hero display：H * 0.14 ~ H * 0.2，fontWeight 600-700，letterSpacing 0.01em，lineHeight 1.05，固定青/品红 text-shadow 色差
- lead mono：H * 0.04 ~ H * 0.05，fontWeight 400，lineHeight 1.4
- body mono：H * 0.03 ~ H * 0.038，fontWeight 400，lineHeight 1.5，muted
- kicker mono：H * 0.02 ~ H * 0.026，fontWeight 500，letterSpacing 0.2em，textTransform 'uppercase'，accent

===== 区块语法（step 单元 = 文本块逐段揭示）=====
顶层容器 position:'relative'，background:'#070708'，display:'grid'，按内容选 HERO-FOOTER / ASYMMETRIC-2COL，gap: H*0.035，padding: H*0.075 / W*0.065；扫描线层用一个 position:'absolute' inset:0 的 div 铺 repeating-linear-gradient，pointerEvents:none，置于内容之下。
- **step 单元 = 一个文本块**（kicker / hero / 要点行 / footer 各为一块），与 trunk 的「step = tile」一一对应；文本块按阅读顺序记作 step[0..N-1]。
- 文本块禁止 background / border / borderRadius / shadow（color shadow 仅作色差例外，不构成块背景）；分隔用 gap 或 1px hairline rgba(232,232,232,0.16)。

六类 type 版式提示：
- chapter：hero 大标题（带色差）+ mono 章节号 kicker + 一条 accent 短线（scaleX 揭示）。
- summary：左 hero 标题（色差）+ mono lead；右 mono kicker + 时间码。
- quote：等宽大引文（色差），起首 accent 引号；底 mono 出处。
- insight：顶结论 hero（色差）+ accent 短线；下行 2-3 文本块各一条要点，mono 编号 accent。
- data：单值大数字（display，accent，带轻微色差）+ mono 单位；多值用纯 SVG <rect> 柱（轨道 muted、焦点 accent，height 0→目标揭示）。
- motion：hero 短标题（色差）+ 一个 accent 描边 SVG 几何（strokeDashoffset 揭示），留白最大。

硬性视觉规则：
- 色差 = 固定 text-shadow（例：text-shadow: -2px 0 #00D4FF, 2px 0 #FF2EC4），写死、不进入任何 tween / 不逐帧改变。
- 扫描线 / grain 是静态 CSS 层，不做闪烁动画。
- 入场仅 translateY + opacity（文本块层）；accent 线 / hairline 用 scaleX(0→1) 一次性揭示；揭示后保持。
- 严禁 Math.sin / Math.cos / random / noise 调制 opacity / translate / 色差偏移；严禁 spring 无限物理；严禁整卡 scale / rotate。

失败示例（生成后必自查）：
- ✗ 用 Math.random / Math.sin 每帧抖动文字位置或色差偏移制造「真故障」（违反 trunk 契约）
- ✗ 扫描线 / 文字做无限闪烁、呼吸
- ✗ 品红当成第二 accent 大面积铺色块
- ✗ 标题用衬线 / 非等宽字体
- ✗ 加发光 blur 氛围圈或彩色渐变光晕`;

const CYBER_GLITCH_COVER = `===== 视觉系统：赛博故障 封面 =====
美学锚点：CRT 故障屏 × 等宽终端字 × RGB 色差。16:9 封面是一块通电旧显示器，近黑底 + 扫描线纹理 + 青/品红色差大标题，制造赛博点击钩子。

按维度顺序组织（主体→构图→风格→美学→质量→文字排版），中文逗号串联，120-180 字：
1. 主体：一块近黑色的故障显示屏画面，中心是一句等宽大标题文字，文字带青色与品红色的固定 RGB 色差错位，无人物特写、无卡通元素。
2. 构图：标题居中或偏上压住版面，CRT 水平扫描线纹理满铺，细微噪点 grain，绝对克制的留白。
3. 风格：赛博故障美学，CRT 扫描线，RGB 色差错位，glitch art，等宽终端排版，cyberpunk terminal style。
4. 美学：近黑底 #070708，浅灰文字 #E8E8E8，单点缀青 #00D4FF，品红 #FF2EC4 仅作色差偏移，固定静态色差不要动态模糊，高对比暗调。
5. 质量：4K 超清，锐利清晰，赛博朋克视觉，故障艺术级精度。
6. 文字排版：从字幕提炼 1 条 4-10 字主标题用中文引号""…""精确包裹，等宽粗体（Space Grotesk / JetBrains Mono，Bold），占版面高度 16%-26%，浅灰填色 + 青/品红固定色差描边错位，accent 青点缀；可选 1 条 mono 大写 kicker。

强制规则：
- 主标题必用中文引号""…""精确包裹保证文字准确率；标题必等宽；整图只允许 1 主标题 + 至多 1 kicker，禁止水印 / logo / 日期。
- 青为唯一 accent，品红仅作色差偏移不大面积铺；禁止第三种彩色、禁止氛围发光圈、禁止渐变光晕。
- 色差为固定静态错位（不是运动模糊）；必近黑底 + CRT 扫描线 + 等宽字。`;

export const CYBER_GLITCH: VisualStylePreset = {
  id: 'cyber-glitch',
  name: '赛博故障',
  description: '近黑底等宽终端风：固定青/品红色差、静态 CRT 扫描线、单 accent 青、文本块逐段揭示。',
  tags: ['暗色', '赛博', '故障'],
  source: 'frame-glitch-title / deck-hermes-cyber',
  palette: { bg: '#070708', ink: '#E8E8E8', muted: '#7A7A8A', accent: '#00D4FF' },
  fonts: {
    display: "'Space Grotesk','JetBrains Mono',monospace",
    body: "'JetBrains Mono','Noto Sans SC',monospace",
    mono: "'JetBrains Mono',monospace",
  },
  facets: { motion: CYBER_GLITCH_MOTION, cover: CYBER_GLITCH_COVER },
  preview: {
    motionHtml: `<style>
  .sp-root{position:relative;width:100%;height:100%;display:grid;place-items:center;align-content:center;gap:4%;font-family:'Space Grotesk','JetBrains Mono',monospace;background:#070708;color:#E8E8E8;box-sizing:border-box;padding:7% 7%;overflow:hidden;}
  .sp-scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg, rgba(0,0,0,0) 0 2px, rgba(0,0,0,0.06) 2px 3px);}
  .sp-kicker{position:relative;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#00D4FF;}
  .sp-title{position:relative;font-size:clamp(28px,9vw,68px);font-weight:700;letter-spacing:0.01em;line-height:1.05;text-shadow:-2px 0 #00D4FF, 2px 0 #FF2EC4;}
  .sp-bar{position:relative;width:18%;height:5px;background:#00D4FF;transform-origin:left;}
  .sp-sub{position:relative;font-family:'JetBrains Mono',monospace;font-size:clamp(11px,2.6vw,15px);color:#7A7A8A;line-height:1.4;}
</style>
<div class="sp-root">
  <div class="sp-scan"></div>
  <div class="sp-kicker">SYS // SIGNAL</div>
  <div class="sp-title">示例标题</div>
  <div class="sp-bar"></div>
  <div class="sp-sub">一句副标题或注解</div>
</div>
<script>
  (function(){
    var tl = gsap.timeline({ paused: true });
    tl.from('.sp-kicker', { y: 14, opacity: 0, duration: 0.4, ease: 'power2.out' })
      .from('.sp-title', { y: 24, opacity: 0, duration: 0.6, ease: 'power3.out' }, '-=0.15')
      .from('.sp-bar', { scaleX: 0, duration: 0.5, ease: 'power3.out' }, '-=0.2')
      .from('.sp-sub', { y: 14, opacity: 0, duration: 0.45, ease: 'power2.out' }, '-=0.2');
    window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
    window.__lingjiMotionTimelines.push(tl);
  })();
</script>`,
  },
};

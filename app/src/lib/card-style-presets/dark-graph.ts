import type { VisualStylePreset } from '../../types/ai';

const DARK_GRAPH_MOTION = `===== 视觉系统：暗色数据图谱 =====
美学锚点：obsidian / claude 风的深空 navy 渐变底 × 玻璃拟态卡 × 力导向知识图谱。整张卡像一张暗色科技 deck：深蓝紫渐变背景、静态模糊光球氛围层、半透明玻璃卡、渐变标题文字、纯 SVG 节点连线图谱。光球与渐变是固定氛围层，绝不逐帧动。

Design DNA（违反任何一条，图谱感都会垮）：
1. 深空 navy 渐变底 —— bg 用近黑深蓝紫 (#0A0A12)，叠一层 linear/radial 深蓝紫渐变（静态写死，不动画），像深空界面。
2. 静态模糊光球 —— 1-2 个 radial-gradient + blur 的紫蓝光球点缀角落营造氛围，DETERMINISTIC 固定位置 / 固定不透明，绝不逐帧移动、缩放或闪烁。
3. 玻璃拟态卡 —— 关键内容放半透明玻璃卡：background rgba(255,255,255,0.04~0.06) + 1px rgba(255,255,255,0.10) 描边 + borderRadius ≈ 16px，像 backdrop 玻璃面，质感来自半透明而非阴影。
4. 渐变标题文字 + 力导向图谱 —— hero 标题用 紫→蓝→绿 (#A855F7→#60A5FA→#34D399) linear-gradient 文字（静态，background-clip:text）；图谱用纯 SVG <circle> 节点 + <line> 连线一次性揭示。

主题 tokens（硬性锁定，禁止替换）：
- 画布底色 bg：#0A0A12（深空 navy；可叠静态 linear-gradient 到 #12121F）
- 主文字 ink：#E6E8F0
- 弱化文字 muted：#7A7F99
- 单一 accent：#7C5CFF（紫蓝；整卡只能 1 个语义焦点）
- 渐变标题文字：linear-gradient 90deg #A855F7→#60A5FA→#34D399，background-clip:text，静态层（仅 hero 标题可用）
- 玻璃卡：background rgba(255,255,255,0.05)，border 1px rgba(255,255,255,0.10)，borderRadius ≈ 16px
- 模糊光球：radial-gradient(circle, rgba(124,92,255,0.25), transparent 60%) + filter:blur(40px)，固定静态层
- 图谱节点 / 连线：节点 accent #7C5CFF 或 ink，连线 rgba(124,92,255,0.4)，纯 SVG
- 禁止：逐帧动画化的光球 / 渐变 / 第二种大面积彩色 accent 色块 / borderRadius > 20px / 霓虹外发光圈做呼吸动画。

字体栈：
- display：'Inter','Noto Sans SC',sans-serif
- body：'Inter','Noto Sans SC',sans-serif
- mono：'JetBrains Mono',monospace

排版阶梯（H = height）：
- hero display：H * 0.13 ~ H * 0.18，fontWeight 600-700，letterSpacing -0.01em，lineHeight 1.1，可用渐变文字
- lead body：H * 0.04 ~ H * 0.052，fontWeight 400，lineHeight 1.45，muted
- 标签 mono / body：H * 0.022 ~ H * 0.028，fontWeight 500，letterSpacing 0.06em，accent
- 数据大字（display）：H * 0.26 ~ H * 0.34，fontWeight 700，accent 紫蓝或渐变文字

===== 区块语法（step 单元 = 卡片 / 图节点区）=====
顶层容器 position:'relative'，background:'#0A0A12'（叠静态深蓝紫渐变），display:'grid'，按内容选 SINGLE-FOCUS / HERO-FOOTER / ASYMMETRIC-2COL，gap: H*0.035，padding: H*0.07 / W*0.06；模糊光球层与渐变底用 position:'absolute' inset:0、pointerEvents:none 的 div 铺，置于内容之下。
- **step 单元 = 一张玻璃卡或一个图节点区**，与 trunk 的「step = tile」一一对应；按阅读顺序记作 step[0..N-1]。
- 玻璃卡允许半透明白背景 + 1px 描边 + borderRadius ≈ 16px —— 这是本风格对 trunk「tile 禁止 background / radius」的明确改写，玻璃拟态质感本质就在半透明面；图节点区用纯 SVG，不加额外背景块。
- 模糊光球层与渐变底是固定氛围层，不计入 step、不参与逐块揭示、不逐帧动。

六类 type 版式提示：
- chapter：居中玻璃卡内放渐变 hero 标题 + mono 编号 + 一条 accent 紫蓝短线（scaleX 揭示）。
- summary：左 hero 渐变标题卡 + 右 lead 玻璃要点卡。
- quote：玻璃卡内居中大引文，起首 accent 紫引号；底 mono 出处。
- insight：顶结论玻璃卡 + 下行 2-3 张玻璃卡各一条要点，accent 紫编号。
- data：单值大数字（display，渐变 / accent 紫）放 hero 玻璃卡 + 单位；多值用纯 SVG <rect> 圆头柱（轨道 rgba(255,255,255,0.08)、焦点 accent，height 0→目标揭示）。
- motion：玻璃卡内短标题 + 一组纯 SVG 力导向图谱（<circle> 节点 + <line> 连线，strokeDashoffset / opacity 一次性揭示），留白最大。

硬性视觉规则：
- 入场用 translateY(H*0.025) + opacity 0→1（作用于玻璃卡 / 节点区层）；可叠加 scale 从 0.97→1（scale **≤1.04**）；reveal-then-hold，一次性、不循环。
- 渐变底、模糊光球、玻璃描边写死为静态 CSS，**不进入任何无限 tween、不逐帧改变位置 / 不透明 / 缩放**。
- accent 紫线 / 图谱连线用 scaleX(0→1) 或 strokeDashoffset 一次性单调揭示；揭示后保持。
- 严禁 Math.sin / Math.cos / random / noise 调制 opacity / translate / scale / 光球位置；严禁 spring 无限物理；严禁光球或渐变逐帧脉动；严禁 scale > 1.04。

失败示例（生成后必自查）：
- ✗ 用 Math.sin / random 让光球或渐变每帧脉动、漂移
- ✗ 给玻璃卡加无限外发光呼吸动画
- ✗ 渐变标题文字做逐帧色相循环
- ✗ scale 入场冲过 1.04
- ✗ 图谱节点用粒子物理 / 无限抖动而非一次性揭示`;

const DARK_GRAPH_COVER = `===== 视觉系统：暗色数据图谱 封面 =====
美学锚点：暗色科技 deck × 深空 navy 渐变 × 玻璃拟态 + 力导向图谱。16:9 封面是一帧深空科技界面：深蓝紫渐变底 + 静态模糊光球 + 玻璃卡 + 渐变大标题 + SVG 节点图谱意象，制造科技点击钩子。

按维度顺序组织（主体→构图→风格→美学→质量→文字排版），中文逗号串联，120-180 字：
1. 主体：一个发光的力导向数据图谱或半透明玻璃信息卡作为视觉主体，节点与连线交织成网络，深空科技感，无人物特写、无卡通元素。
2. 构图：深空 navy 渐变底，角落静态紫蓝模糊光球点缀氛围，玻璃卡 / 图谱居中悬浮，大标题压住版面，克制留白。
3. 风格：暗色科技 deck，obsidian / claude 暗色界面风，玻璃拟态 glassmorphism，力导向知识图谱，深空数据可视化。
4. 美学：深空 navy 底 #0A0A12，浅文字 #E6E8F0，单点缀紫蓝 #7C5CFF，标题可用紫→蓝→绿渐变 #A855F7→#60A5FA→#34D399，静态光球氛围，无杂乱霓虹。
5. 质量：4K 超清，锐利清晰，专业科技视觉，数据可视化大师级精度。
6. 文字排版：从字幕提炼 1 条 4-10 字主标题用中文引号""…""精确包裹，无衬线粗体（Inter，Bold），占版面高度 16%-26%，紫→蓝→绿渐变填色或浅色填色，accent 紫蓝点缀；可选 1 条 mono 小字 kicker。

强制规则：
- 主标题必用中文引号""…""精确包裹保证文字准确率；整图只允许 1 主标题 + 至多 1 kicker，禁止水印 / logo / 日期。
- 紫蓝为唯一 accent 体系，渐变文字仅用于主标题，禁止混入暖橙 / 高饱和绿大色块。
- 必深空 navy 渐变底 + 静态模糊光球 + 玻璃卡 / 图谱意象；禁止浅底、卡通贴纸。`;

export const DARK_GRAPH: VisualStylePreset = {
  id: 'dark-graph',
  name: '暗色数据图谱',
  description: '深空 navy 渐变底：静态模糊光球、玻璃拟态卡、紫→蓝→绿渐变标题、纯 SVG 力导向图谱一次性揭示，单点缀紫蓝。',
  tags: ['暗色', '数据', '科技'],
  source: 'deck-graphify-dark / deck-obsidian-claude',
  palette: { bg: '#0A0A12', ink: '#E6E8F0', muted: '#7A7F99', accent: '#7C5CFF' },
  fonts: {
    display: "'Inter','Noto Sans SC',sans-serif",
    body: "'Inter','Noto Sans SC',sans-serif",
    mono: "'JetBrains Mono',monospace",
  },
  facets: { motion: DARK_GRAPH_MOTION, cover: DARK_GRAPH_COVER },
  preview: {
    motionHtml: `<style>
  .sp-root{position:relative;width:100%;height:100%;display:grid;place-content:center;gap:5%;font-family:'Inter','Noto Sans SC',sans-serif;background:linear-gradient(135deg,#0A0A12,#12121F);color:#E6E8F0;box-sizing:border-box;padding:7% 6%;overflow:hidden;}
  .sp-orb{position:absolute;width:42%;height:42%;border-radius:50%;pointer-events:none;filter:blur(46px);}
  .sp-orb-a{top:-8%;left:-6%;background:radial-gradient(circle, rgba(124,92,255,0.28), transparent 62%);}
  .sp-orb-b{bottom:-10%;right:-8%;background:radial-gradient(circle, rgba(52,211,153,0.18), transparent 62%);}
  .sp-card{position:relative;justify-self:center;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);border-radius:16px;padding:7% 8%;display:grid;gap:14px;text-align:center;}
  .sp-kicker{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#7C5CFF;text-transform:uppercase;}
  .sp-title{font-size:clamp(24px,7vw,52px);font-weight:700;letter-spacing:-0.01em;line-height:1.1;background:linear-gradient(90deg,#A855F7,#60A5FA,#34D399);-webkit-background-clip:text;background-clip:text;color:transparent;}
  .sp-graph{display:block;margin:0 auto;}
  .sp-sub{font-size:clamp(11px,2.6vw,15px);color:#7A7F99;line-height:1.45;}
</style>
<div class="sp-root">
  <div class="sp-orb sp-orb-a"></div>
  <div class="sp-orb sp-orb-b"></div>
  <div class="sp-card">
    <div class="sp-kicker">GRAPH</div>
    <div class="sp-title">示例标题</div>
    <svg class="sp-graph" width="120" height="48" viewBox="0 0 120 48">
      <line class="sp-edge" x1="20" y1="34" x2="60" y2="14" stroke="rgba(124,92,255,0.45)" stroke-width="1.5"/>
      <line class="sp-edge" x1="60" y1="14" x2="100" y2="34" stroke="rgba(124,92,255,0.45)" stroke-width="1.5"/>
      <circle class="sp-node" cx="20" cy="34" r="5" fill="#7C5CFF"/>
      <circle class="sp-node" cx="60" cy="14" r="6" fill="#60A5FA"/>
      <circle class="sp-node" cx="100" cy="34" r="5" fill="#34D399"/>
    </svg>
    <div class="sp-sub">一句副标题或注解</div>
  </div>
</div>
<script>
  (function(){
    var tl = gsap.timeline({ paused: true });
    tl.from('.sp-card', { y: 26, opacity: 0, scale: 0.97, duration: 0.6, ease: 'power3.out' })
      .from('.sp-kicker', { y: 10, opacity: 0, duration: 0.4, ease: 'power2.out' }, '-=0.25')
      .from('.sp-title', { y: 14, opacity: 0, duration: 0.5, ease: 'power3.out' }, '-=0.25')
      .from('.sp-edge', { opacity: 0, duration: 0.4, ease: 'power2.out' }, '-=0.15')
      .from('.sp-node', { scale: 0, opacity: 0, transformOrigin: 'center', duration: 0.4, stagger: 0.08, ease: 'power2.out' }, '-=0.2')
      .from('.sp-sub', { y: 12, opacity: 0, duration: 0.45, ease: 'power2.out' }, '-=0.2');
    window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
    window.__lingjiMotionTimelines.push(tl);
  })();
</script>`,
  },
};

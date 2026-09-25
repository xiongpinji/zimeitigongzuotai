import type { VisualStylePreset } from '../../types/ai';

const HAND_SKETCH_MOTION = `===== 视觉系统：手绘便签 =====
美学锚点：手账方格纸 × 便利贴 × 手写体白板草图。整张卡是一页方格笔记本：手写体文字、轻微旋转的便利贴卡、手绘虚线连接。

适用范围说明：本风格**仅用于 Motion Card（信息卡动画）**；其 cover / image facet 故意留空，封面与段落配图会回退到默认风格——手绘便签不适合作为 AI 生图风格。

Design DNA（违反任何一条，手绘感都会垮）：
1. 方格纸底 —— 卡底用 CSS repeating-linear-gradient 铺浅色方格网（横竖两组细线），像笔记本内页，固定静态、不参与动画。
2. 手写体 —— 标题与正文一律手写体（Caveat / Kalam），亲切、随性，绝不出现规整无衬线大字。
3. 便利贴卡 —— 关键内容放在便利贴黄 (#FFD84D) 的小卡上，每张轻微旋转 ±2°（≤3°），配柔和阴影，像真贴在纸上。
4. 手绘虚线连接 —— 便利贴 / 要点之间用 dashed border 或 SVG dashed <path> 连接，像随手画的箭头线。

主题 tokens（硬性锁定，禁止替换）：
- 画布底色 bg：#F4EDE1（米黄纸）
- 主墨色 ink：#2B2B2B（铅笔灰黑）
- 弱化文字 muted：#7A6E5A（暖灰）
- 单一 accent：#FFD84D（便利贴黄；整卡只能 1 个语义焦点）
- 方格网：repeating-linear-gradient 浅色细线 rgba(43,43,43,0.08)，约 5% 卡宽一格，固定静态层
- 便利贴阴影：柔和 box-shadow（如 0 4px 10px rgba(43,43,43,0.12)），仅便利贴卡可有，幅度克制
- 虚线：dashed，颜色 muted 或 ink，1.5px，像手绘
- 禁止：霓虹 / 渐变光晕 / 第二种彩色 / 规整无衬线标题 / 逐帧抖动的网格或阴影。

字体栈：
- display：'Caveat','Kalam','Noto Sans SC',cursive（手写标题）
- body：'Kalam','Noto Sans SC',sans-serif（手写正文）
- mono：'JetBrains Mono',monospace（编号 / 角落标注）

排版阶梯（H = height）：
- hero 手写 display：H * 0.12 ~ H * 0.18，fontWeight 600-700，lineHeight 1.1
- 便利贴正文：H * 0.04 ~ H * 0.055，fontWeight 400，lineHeight 1.4
- 注解 / 标签：H * 0.03 ~ H * 0.038，muted
- 编号 mono：H * 0.02 ~ H * 0.026，letterSpacing 0.12em，ink 或 muted

===== 区块语法（step 单元 = 便利贴 / 文本块）=====
顶层容器 position:'relative'，background:'#F4EDE1'，display:'grid'，按内容选 HERO-FOOTER / HERO-3GRID，gap: H*0.04，padding: H*0.07 / W*0.06；方格网层用一个 position:'absolute' inset:0、pointerEvents:none 的 div 铺，置于内容之下。
- **step 单元 = 一张便利贴或一个文本块**，与 trunk 的「step = tile」一一对应；按阅读顺序记作 step[0..N-1]。
- 便利贴卡允许便利贴黄背景 + 柔和阴影 + 轻微旋转（±2°，≤3°）——这是本风格对 trunk「tile 禁止 background / shadow」的明确改写，便利贴质感的本质就在于此；非便利贴的纯文本块仍不加背景。
- 方格网层是固定背景，不计入 step、不参与逐块揭示。

六类 type 版式提示：
- chapter：居中手写大标题 hero + 角落 mono 编号 + 一条 accent 便利贴黄手绘短线（scaleX 揭示）。
- summary：左手写标题 + 右一张便利贴黄要点卡（轻微旋转）。
- quote：手写大引文，起首 accent 黄手绘引号；底 mono 出处。
- insight：顶手写结论 + 下行 2-3 张便利贴卡各一条要点，便利贴之间手绘 dashed 连接线。
- data：单值大手写数字（accent 黄高亮底）+ 单位；多值用纯 SVG <rect> 柱（轨道 muted、焦点 accent 黄，height 0→目标揭示）。
- motion：手写短标题 + 一条 accent 黄手绘 SVG 几何（dashed <path>，strokeDashoffset 揭示），留白最大。

硬性视觉规则：
- 便签依次"贴上"入场：每张便利贴 / 文本块在其揭示窗内用 translateY(H*0.025) + opacity 0→1 + 轻微 rotate（终态 ±2°，幅度 ≤3°），可叠加 scale 从 0.97→1（scale **≤1.04**），像被随手贴到纸上；reveal-then-hold，揭示后保持终态、不再消失、不循环。
- 方格网、便利贴阴影写死为静态 CSS，不进入任何无限 tween。
- accent 黄手绘线 / dashed <path> 用 scaleX(0→1) 或 strokeDashoffset 一次性单调揭示；揭示后保持。
- 严禁 Math.sin / Math.cos / random / noise 调制 opacity / translate / rotate；严禁 spring 无限物理；严禁旋转幅度 > 3° 或 scale > 1.04；严禁逐帧抖动便利贴。

失败示例（生成后必自查）：
- ✗ 便利贴旋转 > 3° 或 scale > 1.04 入场（幅度必须小、克制）
- ✗ 用 Math.random / Math.sin 让便利贴每帧抖动、晃动
- ✗ 标题用规整无衬线大字而非手写体
- ✗ 出现霓虹 / 第二种彩色 / 渐变光晕
- ✗ 便利贴揭示后又消失再贴一次`;

export const HAND_SKETCH: VisualStylePreset = {
  id: 'hand-sketch',
  name: '手绘便签',
  description: '米黄方格纸底：手写体、便利贴黄轻微旋转卡、手绘虚线连接，便签依次贴上入场（仅 Motion 适用）。',
  tags: ['浅色', '手绘', '轻松'],
  source: 'wireframe-sketch / frame-flowchart-sticky',
  palette: { bg: '#F4EDE1', ink: '#2B2B2B', muted: '#7A6E5A', accent: '#FFD84D' },
  fonts: {
    display: "'Caveat','Kalam','Noto Sans SC',cursive",
    body: "'Kalam','Noto Sans SC',sans-serif",
    mono: "'JetBrains Mono',monospace",
  },
  facets: { motion: HAND_SKETCH_MOTION },
  preview: {
    motionHtml: `<style>
  .sp-root{position:relative;width:100%;height:100%;display:grid;align-content:center;gap:5%;font-family:'Caveat','Kalam','Noto Sans SC',cursive;background:#F4EDE1;color:#2B2B2B;box-sizing:border-box;padding:7% 6%;overflow:hidden;}
  .sp-grid{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg, rgba(43,43,43,0.08) 0 1px, transparent 1px 26px), repeating-linear-gradient(90deg, rgba(43,43,43,0.08) 0 1px, transparent 1px 26px);}
  .sp-code{position:relative;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;color:#7A6E5A;}
  .sp-title{position:relative;font-size:clamp(30px,10vw,72px);font-weight:700;line-height:1.05;}
  .sp-note{position:relative;justify-self:start;background:#FFD84D;color:#2B2B2B;padding:10px 16px;font-size:clamp(13px,3vw,20px);box-shadow:0 4px 10px rgba(43,43,43,0.12);transform:rotate(-2deg);}
</style>
<div class="sp-root">
  <div class="sp-grid"></div>
  <div class="sp-code">NOTE 01</div>
  <div class="sp-title">示例标题</div>
  <div class="sp-note">一条便利贴要点</div>
</div>
<script>
  (function(){
    var tl = gsap.timeline({ paused: true });
    tl.from('.sp-code', { y: 14, opacity: 0, duration: 0.4, ease: 'power2.out' })
      .from('.sp-title', { y: 22, opacity: 0, duration: 0.55, ease: 'power3.out' }, '-=0.15')
      .from('.sp-note', { y: 16, opacity: 0, scale: 0.97, rotation: 0, duration: 0.5, ease: 'power2.out' }, '-=0.1');
    window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
    window.__lingjiMotionTimelines.push(tl);
  })();
</script>`,
  },
};

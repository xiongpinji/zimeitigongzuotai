import type { VisualStylePreset } from '../../types/ai';

const FILM_LEAK_MOTION = `===== 视觉系统：胶片电影 =====
美学锚点：35mm 胶片电影定格 × 信箱画幅 × 暖橙漏光。整张卡是一帧被投影的电影画面：上下黑边、奶油色斜体衬线大字、暖橙径向漏光，亮度像放映机点亮一样一次性入场。漏光与颗粒是固定的静态质感，不是逐帧抖动。

Design DNA（违反任何一条，电影感都会垮）：
1. 信箱画幅至上 —— 整卡上下各压一条纯黑信箱边（letterbox），中间内容区呈 2.39:1 宽银幕比例，黑边固定、不参与动画。
2. 暖橙漏光 —— 用 CSS radial-gradient 在一角铺暖橙漏光（accent #FF8A3D），是静态光晕或仅做一次性亮度入场，绝不逐帧脉动闪烁。
3. 奶油斜体衬线 —— hero 标题一律衬线、奶油色 (#F3EAD6)、italic 倾向，像电影片名字卡。
4. 时间码 mono —— 角落放 mono 时间码 / 卷号字幕（如 "00:01:24:08"），强化胶片放映氛围。

主题 tokens（硬性锁定，禁止替换）：
- 画布底色 bg：#1A0F0A（暗暖棕黑）
- 主文字 ink：#F3EAD6（奶油）
- 弱化文字 muted：#B89B7A（暖灰）
- 单一 accent：#FF8A3D（暖橙漏光；整卡只能 1 个语义焦点）
- 信箱黑边：纯黑 #000000，上下各占卡高约 12%
- 颗粒 grain：约 14% 不透明的 CSS 静态噪点层（repeating 或细网点），固定铺底、不闪烁
- 漏光：radial-gradient(circle at 一角, rgba(255,138,61,0.35), transparent 60%)，静态或一次性亮度入场
- 禁止：任何冷色 / 霓虹 / 蓝绿光 / 第二种 accent / borderRadius 圆角卡片 / 逐帧脉动的漏光或颗粒。

字体栈：
- display：'Noto Serif SC','Georgia',serif（italic 倾向，电影片名感）
- body：'PingFang SC','Noto Sans SC',sans-serif
- mono：'JetBrains Mono',monospace（时间码 / 卷号）

排版阶梯（H = height）：
- hero serif（italic）：H * 0.13 ~ H * 0.2，fontWeight 600，fontStyle italic，letterSpacing 0.01em，lineHeight 1.1，奶油色
- lead sans：H * 0.04 ~ H * 0.052，fontWeight 400，lineHeight 1.45，muted
- 时间码 mono：H * 0.02 ~ H * 0.026，fontWeight 500，letterSpacing 0.16em，accent 或 muted
- 数据大字（serif italic）：H * 0.26 ~ H * 0.34，fontWeight 600，accent 或奶油

===== 区块语法（step 单元 = 文本/字幕区）=====
顶层容器 position:'relative'，background:'#1A0F0A'，display:'grid'，按内容选 HERO-FOOTER / SINGLE-FOCUS，内容区被上下两条 letterbox 黑边夹住，gap: H*0.035，padding: H*0.04 / W*0.07；漏光层与颗粒层各用一个 position:'absolute' inset:0、pointerEvents:none 的 div 铺，置于内容之下。
- **step 单元 = 一个文本/字幕区**（hero 片名区 / 字幕区 / 时间码区各为一块），与 trunk 的「step = tile」一一对应；按阅读顺序记作 step[0..N-1]。
- 文本区禁止 background / border / borderRadius / shadow；分隔用 gap 或 1px hairline rgba(243,234,214,0.18)。
- letterbox 黑边、漏光层、颗粒层是固定背景层，不计入 step、不参与逐块揭示。

六类 type 版式提示：
- chapter：居中奶油斜体片名 hero + 角落 mono 卷号时间码 + 一条 accent 暖橙短线（scaleX 揭示）。
- summary：左 hero 斜体标题 + sans lead 字幕句；右 mono 时间码。
- quote：奶油斜体大引文（字幕条形式压在画幅下缘），起首 accent 暖橙引号；底 mono 出处。
- insight：顶结论 hero（斜体）+ accent 暖橙短线；下行 2-3 文本区各一条要点，mono 编号。
- data：单值大数字（serif italic，accent 暖橙）+ mono 单位；多值用纯 SVG <rect> 柱（轨道 muted、焦点 accent 暖橙，height 0→目标揭示）。
- motion：奶油斜体短标题（电影片名感）+ 一条 accent 暖橙描边 SVG 几何（strokeDashoffset 揭示），留白最大。

硬性视觉规则：
- 整卡亮度一次性入场：用 gsap.from 对内容根层做 opacity 0→1 + filter brightness(0.3)→brightness(1)，像放映机点亮，**只做一次、不循环、不逐帧调制**；不要逐帧改变漏光位置或颗粒。
- 漏光 radial-gradient 与颗粒层写死为静态 CSS，不进入任何无限 tween。
- 入场仅 translateY + opacity（文本区层）+ 上述一次性整卡亮度；accent 线 / hairline 用 scaleX(0→1) 一次性揭示；揭示后保持。
- 严禁 Math.sin / Math.cos / random / noise 调制 opacity / translate / 漏光 / 颗粒；严禁 spring 无限物理；严禁整卡 scale / rotate；严禁冷色 / 霓虹。

失败示例（生成后必自查）：
- ✗ 用 Math.sin / random 让漏光或颗粒每帧脉动、闪烁
- ✗ 出现蓝 / 青 / 绿 / 霓虹等冷色（必暖橙）
- ✗ 缺失上下信箱黑边，画幅不是宽银幕
- ✗ 标题用无衬线或非斜体（必奶油斜体衬线）
- ✗ 亮度入场做成无限明暗呼吸而非一次性点亮`;

const FILM_LEAK_COVER = `===== 视觉系统：胶片电影 封面 =====
美学锚点：35mm 电影定格 × 信箱画幅 × 暖橙漏光片名字卡。16:9 封面是一帧被投影的电影画面：上下黑边、暖橙漏光、奶油斜体衬线大标题，制造电影质感钩子。

按维度顺序组织（主体→构图→风格→美学→质量→文字排版），中文逗号串联，120-180 字：
1. 主体：一帧电影感的暖色画面，可有真实人物剪影或一个被暖光照亮的物件，画面带暖橙漏光与细腻胶片颗粒，无卡通元素。
2. 构图：上下信箱黑边形成 2.39:1 宽银幕画幅，暖橙漏光从一角溢入，主体居中或偏置留白，奶油斜体大标题压住画幅下缘。
3. 风格：35mm 胶片电影定格，cinematic film still，暖色调电影摄影，信箱宽银幕画幅，光晕漏光 film light leak，颗粒质感。
4. 美学：暗暖棕黑底 #1A0F0A，奶油色文字 #F3EAD6，单点缀暖橙漏光 #FF8A3D，14% 胶片颗粒，无冷色无霓虹，暖调高质感。
5. 质量：4K 超清，锐利清晰，电影级调色，胶片质感大师级摄影。
6. 文字排版：从字幕提炼 1 条 4-10 字主标题用中文引号""…""精确包裹，奶油色衬线斜体粗体（思源宋体 / Georgia，Semibold italic），占版面高度 16%-26%，暖橙漏光点缀；可选 1 条 mono 时间码风 kicker。

强制规则：
- 主标题必用中文引号""…""精确包裹保证文字准确率；标题必衬线斜体；整图只允许 1 主标题 + 至多 1 kicker，禁止水印 / logo / 日期。
- 暖橙为唯一 accent，禁止冷色 / 霓虹 / 第二种彩色 / 渐变光晕乱铺。
- 必上下信箱黑边 + 暖橙漏光 + 胶片颗粒；禁止圆角卡片、卡通贴纸、冷色调。`;

const FILM_LEAK_IMAGE = `===== 视觉系统：胶片电影 段落配图 =====
美学锚点：电影内文配图 —— 一帧暖橙漏光、胶片颗粒的宽银幕画面，图内不出现任何文字。

按维度顺序组织（主体→构图→风格→美学→质量），中文逗号串联，90-150 字：
1. 主体：紧扣本段语义的电影感画面 —— 暖光照亮的剪影、被漏光笼罩的物件或场景，暖橙漏光 + 胶片颗粒，无卡通元素。
2. 构图：上下信箱黑边形成宽银幕画幅，暖橙漏光从一角溢入，主体居中或偏置留白。
3. 风格：35mm 胶片电影定格，cinematic film still，暖色调电影摄影，信箱宽银幕，光晕漏光 film light leak。
4. 美学：暗暖棕黑底 #1A0F0A，奶油暖调 #F3EAD6，单点缀暖橙漏光 #FF8A3D，14% 胶片颗粒，无冷色无霓虹。
5. 质量：4K 超清，锐利清晰，电影级调色，胶片质感大师级摄影。

强制规则：
- 图内禁止出现任何文字 / 数字标签 / 水印 / logo（段落配图不承载标题）。
- 暖橙为唯一 accent，禁止冷色 / 霓虹 / 第二 accent；必上下信箱黑边 + 暖橙漏光 + 胶片颗粒。`;

export const FILM_LEAK: VisualStylePreset = {
  id: 'film-leak',
  name: '胶片电影',
  description: '暗暖信箱画幅：奶油斜体衬线大字、暖橙径向漏光、14% 胶片颗粒、mono 时间码，亮度一次性点亮入场。',
  tags: ['暗暖', '电影', '胶片'],
  source: 'frame-light-leak-cinema',
  palette: { bg: '#1A0F0A', ink: '#F3EAD6', muted: '#B89B7A', accent: '#FF8A3D' },
  fonts: {
    display: "'Noto Serif SC','Georgia',serif",
    body: "'PingFang SC','Noto Sans SC',sans-serif",
    mono: "'JetBrains Mono',monospace",
  },
  facets: { motion: FILM_LEAK_MOTION, cover: FILM_LEAK_COVER, image: FILM_LEAK_IMAGE },
  preview: {
    motionHtml: `<style>
  .sp-root{position:relative;width:100%;height:100%;display:grid;align-content:end;gap:3%;font-family:'Noto Serif SC','Georgia',serif;background:#1A0F0A;color:#F3EAD6;box-sizing:border-box;padding:12% 7%;overflow:hidden;}
  .sp-bar-top,.sp-bar-bottom{position:absolute;left:0;right:0;height:12%;background:#000000;pointer-events:none;z-index:2;}
  .sp-bar-top{top:0;}
  .sp-bar-bottom{bottom:0;}
  .sp-leak{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 88% 18%, rgba(255,138,61,0.4), transparent 58%);}
  .sp-grain{position:absolute;inset:0;pointer-events:none;opacity:0.14;background:repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0 1px, rgba(0,0,0,0) 1px 2px);}
  .sp-code{position:relative;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#FF8A3D;}
  .sp-title{position:relative;font-style:italic;font-size:clamp(26px,8.5vw,62px);font-weight:600;letter-spacing:0.01em;line-height:1.1;}
  .sp-sub{position:relative;font-family:'PingFang SC','Noto Sans SC',sans-serif;font-size:clamp(11px,2.6vw,15px);color:#B89B7A;line-height:1.45;}
</style>
<div class="sp-root" id="sp-root">
  <div class="sp-leak"></div>
  <div class="sp-grain"></div>
  <div class="sp-bar-top"></div>
  <div class="sp-bar-bottom"></div>
  <div class="sp-code">REEL 01 — 00:01:24:08</div>
  <div class="sp-title">示例标题</div>
  <div class="sp-sub">一句副标题或注解</div>
</div>
<script>
  (function(){
    var tl = gsap.timeline({ paused: true });
    tl.from('#sp-root', { opacity: 0, filter: 'brightness(0.3)', duration: 0.7, ease: 'power2.out' })
      .from('.sp-code', { y: 14, opacity: 0, duration: 0.4, ease: 'power2.out' }, '-=0.2')
      .from('.sp-title', { y: 22, opacity: 0, duration: 0.6, ease: 'power3.out' }, '-=0.2')
      .from('.sp-sub', { y: 14, opacity: 0, duration: 0.45, ease: 'power2.out' }, '-=0.2');
    window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
    window.__lingjiMotionTimelines.push(tl);
  })();
</script>`,
  },
};

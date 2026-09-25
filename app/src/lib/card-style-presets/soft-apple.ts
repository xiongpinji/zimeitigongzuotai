import type { VisualStylePreset } from '../../types/ai';

const SOFT_APPLE_MOTION = `===== 视觉系统：温柔苹果 =====
美学锚点：Apple Human Interface × 银白奶油底 × squircle 圆角卡。整张卡像一帧 macOS / visionOS 的产品界面：银白底 + 环境柔光、大圆角 squircle 卡、嵌套半径双描边、柔和阴影，弹性微动克制而高级。

Design DNA（违反任何一条，苹果感都会垮）：
1. 银白奶油底 + 环境柔光 —— bg 银白 (#F0F1F4)，叠一层极淡的 radial 环境柔光（subtle，不刺眼），像产品发布会背景。
2. squircle 大圆角 —— 卡片用大圆角 squircle，borderRadius ≈ 24px（关键），绝不直角硬边。
3. 嵌套半径双描边 —— 卡内嵌套子卡时，内圆角 = 外圆角 − 内边距（concentric），双层细描边（hairline）勾边。
4. 柔和阴影 + 系统蓝 —— 卡有柔和大范围阴影制造悬浮感；accent 系统蓝 (#0A84FF) 只点缀 1 处焦点。

主题 tokens（硬性锁定，禁止替换）：
- 画布底色 bg：#F0F1F4（银白奶油）
- 主文字 ink：#1D1D1F（近黑）
- 弱化文字 muted：#6E6E73（系统灰）
- 单一 accent：#0A84FF（系统蓝；整卡只能 1 个语义焦点）
- 卡圆角：borderRadius ≈ 24px（squircle 倾向），嵌套子卡内圆角按 concentric 收敛
- 卡描边：双层 hairline，外 rgba(29,29,31,0.08)、内 rgba(255,255,255,0.7)，1px
- 柔和阴影：0 12px 32px rgba(29,29,31,0.10)，大范围低不透明，绝不硬阴影
- 环境柔光：radial-gradient 极淡（rgba(255,255,255,0.6) 中心 → transparent），静态层
- 禁止：霓虹 / 高饱和渐变 / 直角硬边 / 第二种彩色 accent / 逐帧脉动柔光。

字体栈：
- display：'SF Pro Display','PingFang SC',-apple-system,sans-serif
- body：'SF Pro Text','PingFang SC',-apple-system,sans-serif
- mono：'SF Mono',monospace

排版阶梯（H = height）：
- hero display：H * 0.12 ~ H * 0.17，fontWeight 600，letterSpacing -0.01em，lineHeight 1.1
- lead body：H * 0.04 ~ H * 0.052，fontWeight 400,lineHeight 1.45，muted
- 标签 mono / body：H * 0.022 ~ H * 0.028，fontWeight 500，letterSpacing 0.04em
- 数据大字（display）：H * 0.26 ~ H * 0.34，fontWeight 600，accent 系统蓝或 ink

===== 区块语法（step 单元 = 卡片区块）=====
顶层容器 position:'relative'，background:'#F0F1F4'，display:'grid'，按内容选 SINGLE-FOCUS / HERO-FOOTER / ASYMMETRIC-2COL，gap: H*0.035，padding: H*0.07 / W*0.06；环境柔光层用一个 position:'absolute' inset:0、pointerEvents:none 的 div 铺，置于卡片之下。
- **step 单元 = 一个卡片区块（squircle 卡）**，与 trunk 的「step = tile」一一对应；按阅读顺序记作 step[0..N-1]。
- 卡片区块允许银白 / 半透明白背景 + squircle 大圆角 + 双 hairline 描边 + 柔和阴影——这是本风格对 trunk「tile 禁止 background / radius / shadow」的明确改写，苹果质感的本质就在 squircle 浮起卡；嵌套子卡按 concentric 收敛内圆角。
- 环境柔光层是固定背景，不计入 step、不参与逐块揭示。

六类 type 版式提示：
- chapter：居中 squircle 卡内放 hero 标题 + mono 编号 + 一条 accent 系统蓝短线（scaleX 揭示）。
- summary：左 hero 标题卡 + 右 lead 要点卡，两卡 squircle、柔和阴影。
- quote：大圆角卡内居中大引文，起首 accent 蓝引号；底 mono 出处。
- insight：顶结论卡 + 下行 2-3 张嵌套 squircle 卡各一条要点，accent 蓝编号。
- data：单值大数字（display，accent 蓝）放 hero squircle 卡 + 单位；多值用纯 SVG <rect> 圆头柱（轨道 muted、焦点 accent 蓝，height 0→目标揭示）。
- motion：squircle 卡内短标题 + 一条 accent 蓝描边 SVG 几何（strokeDashoffset 揭示），留白最大。

硬性视觉规则：
- 弹性微动克制：卡片入场用 translateY(H*0.025) + opacity 0→1，缓动用**有限时长**的 'back.out(1.3)' 或 'power2.out'，像 SwiftUI 的弹性出现；可叠加 scale 从 0.97→1（scale **≤1.04**，back.out 的回弹也须落在 1.04 以内）；reveal-then-hold，**一次性、不循环、不做无限 spring 物理**。
- 环境柔光、阴影写死为静态 CSS，不进入任何无限 tween。
- accent 蓝线 / hairline 用 scaleX(0→1) 一次性揭示；揭示后保持。
- 严禁 Math.sin / Math.cos / random / noise 调制 opacity / translate / scale；严禁 spring 无限物理动画（用有限时长 back.out 缓动即可）；严禁霓虹 / 高饱和渐变 / 直角硬边 / scale > 1.04。

失败示例（生成后必自查）：
- ✗ 用 spring / 无限物理回弹做持续晃动（必须有限时长 back.out 一次性）
- ✗ back.out 回弹幅度让 scale 冲过 1.04
- ✗ 出现直角硬边卡片而非 squircle 大圆角
- ✗ 用 Math.sin / random 让柔光或卡片每帧脉动
- ✗ 出现霓虹 / 第二种彩色 accent / 高饱和渐变背景`;

const SOFT_APPLE_COVER = `===== 视觉系统：温柔苹果 封面 =====
美学锚点：Apple 产品发布视觉 × 银白奶油底 × squircle 大圆角卡。16:9 封面是一帧高级产品界面：银白底 + 环境柔光、squircle 圆角卡、柔和阴影、系统蓝点缀大标题，制造高级感钩子。

按维度顺序组织（主体→构图→风格→美学→质量→文字排版），中文逗号串联，120-180 字：
1. 主体：一个银白质感的 squircle 大圆角卡片或简洁产品界面元素作为视觉主体，柔和悬浮，无人物特写、无卡通元素。
2. 构图：银白奶油底 + 环境柔光，主体卡片居中悬浮带柔和大范围阴影，squircle 大圆角，留白克制高级，大标题压住版面。
3. 风格：Apple Human Interface 风，苹果产品发布会视觉，squircle 圆角，玻璃柔光质感，minimal premium UI，soft web prototype。
4. 美学：银白奶油底 #F0F1F4，近黑文字 #1D1D1F，单点缀系统蓝 #0A84FF，环境柔光，柔和阴影，无霓虹无硬阴影，高级克制。
5. 质量：4K 超清，锐利清晰，专业产品视觉，苹果发布会级精度。
6. 文字排版：从字幕提炼 1 条 4-10 字主标题用中文引号""…""精确包裹，无衬线粗体（SF Pro Display / 苹方，Semibold），占版面高度 16%-26%，近黑填色，仅 1 处系统蓝点缀；可选 1 条 mono 小字 kicker。

强制规则：
- 主标题必用中文引号""…""精确包裹保证文字准确率；整图只允许 1 主标题 + 至多 1 kicker，禁止水印 / logo / 日期。
- 系统蓝为唯一 accent，禁止霓虹 / 高饱和渐变 / 第二种彩色。
- 必银白奶油底 + squircle 大圆角 + 柔和阴影；禁止直角硬边、卡通贴纸、暗黑底。`;

const SOFT_APPLE_IMAGE = `===== 视觉系统：温柔苹果 段落配图 =====
美学锚点：苹果界面内文配图 —— 一帧银白柔光、squircle 圆角的抽象产品质感画面，图内不出现任何文字。

按维度顺序组织（主体→构图→风格→美学→质量），中文逗号串联，90-150 字：
1. 主体：紧扣本段语义的抽象产品质感画面 —— 一个 squircle 大圆角卡、一组柔和悬浮的界面元素或玻璃质感几何，银白柔光，无卡通元素。
2. 构图：银白奶油底 + 环境柔光，主体居中悬浮带柔和阴影，squircle 大圆角，留白克制。
3. 风格：Apple Human Interface 风，苹果产品视觉，squircle 圆角，玻璃柔光质感，minimal premium UI。
4. 美学：银白奶油底 #F0F1F4，近黑 #1D1D1F，单点缀系统蓝 #0A84FF，环境柔光，柔和阴影，无霓虹无硬阴影。
5. 质量：4K 超清，锐利清晰，专业产品视觉，苹果发布会级精度。

强制规则：
- 图内禁止出现任何文字 / 数字标签 / 水印 / logo（段落配图不承载标题）。
- 系统蓝为唯一 accent，禁止霓虹 / 高饱和渐变 / 第二 accent；必银白奶油底 + squircle 大圆角 + 柔和阴影。`;

export const SOFT_APPLE: VisualStylePreset = {
  id: 'soft-apple',
  name: '温柔苹果',
  description: '银白奶油底 + 环境柔光：squircle 大圆角卡、嵌套半径双描边、柔和阴影、克制弹性微动，单点缀系统蓝。',
  tags: ['浅色', '柔和', '高级'],
  source: 'web-proto-soft',
  palette: { bg: '#F0F1F4', ink: '#1D1D1F', muted: '#6E6E73', accent: '#0A84FF' },
  fonts: {
    display: "'SF Pro Display','PingFang SC',-apple-system,sans-serif",
    body: "'SF Pro Text','PingFang SC',-apple-system,sans-serif",
    mono: "'SF Mono',monospace",
  },
  facets: { motion: SOFT_APPLE_MOTION, cover: SOFT_APPLE_COVER, image: SOFT_APPLE_IMAGE },
  preview: {
    motionHtml: `<style>
  .sp-root{position:relative;width:100%;height:100%;display:grid;place-content:center;gap:5%;font-family:'SF Pro Display','PingFang SC',-apple-system,sans-serif;background:#F0F1F4;color:#1D1D1F;box-sizing:border-box;padding:7% 6%;overflow:hidden;}
  .sp-glow{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 28%, rgba(255,255,255,0.65), transparent 60%);}
  .sp-card{position:relative;justify-self:center;background:#FBFBFD;border-radius:24px;padding:7% 8%;box-shadow:0 12px 32px rgba(29,29,31,0.1);border:1px solid rgba(29,29,31,0.08);display:grid;gap:14px;text-align:center;}
  .sp-kicker{font-family:'SF Mono',monospace;font-size:11px;letter-spacing:0.06em;color:#0A84FF;text-transform:uppercase;}
  .sp-title{font-size:clamp(24px,7vw,52px);font-weight:600;letter-spacing:-0.01em;line-height:1.1;}
  .sp-sub{font-size:clamp(11px,2.6vw,15px);color:#6E6E73;line-height:1.45;}
</style>
<div class="sp-root">
  <div class="sp-glow"></div>
  <div class="sp-card">
    <div class="sp-kicker">Overview</div>
    <div class="sp-title">示例标题</div>
    <div class="sp-sub">一句副标题或注解</div>
  </div>
</div>
<script>
  (function(){
    var tl = gsap.timeline({ paused: true });
    tl.from('.sp-card', { y: 26, opacity: 0, scale: 0.97, duration: 0.6, ease: 'back.out(1.3)' })
      .from('.sp-kicker', { y: 10, opacity: 0, duration: 0.4, ease: 'power2.out' }, '-=0.25')
      .from('.sp-title', { y: 14, opacity: 0, duration: 0.5, ease: 'power3.out' }, '-=0.25')
      .from('.sp-sub', { y: 12, opacity: 0, duration: 0.45, ease: 'power2.out' }, '-=0.25');
    window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
    window.__lingjiMotionTimelines.push(tl);
  })();
</script>`,
  },
};

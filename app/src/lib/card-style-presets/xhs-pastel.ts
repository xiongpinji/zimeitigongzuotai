import type { VisualStylePreset } from '../../types/ai';

const XHS_PASTEL_MOTION = `===== 视觉系统：小红书柔彩 =====
美学锚点：小红书图文卡 × 马卡龙柔彩 × Playfair 斜体显示字。整张卡像一张奶油底的精致生活笔记：柔焦马卡龙色块、大圆角柔和卡、斜体衬线标题、01-04 编号序列。色块是固定柔焦氛围层，绝不逐帧动。

Design DNA（违反任何一条，柔彩感都会垮）：
1. 奶油底 + 3 柔焦色块 —— bg 奶油白 (#FEF8F1)，角落点 2-3 个马卡龙柔焦色块（粉 / 薄荷 / 天蓝），用 radial-gradient 静态写死、固定位置、绝不动画。
2. 马卡龙圆角卡 —— 关键内容放大圆角柔和卡，borderRadius ≈ 28px（关键，比一般圆角更圆更软），淡色卡面或半透明白，阴影极轻或无。
3. Playfair 斜体显示字 —— hero 标题用 Playfair Display italic 衬线，优雅斜体，营造杂志生活感；正文用 PingFang 无衬线。
4. 01-04 编号序列 —— 要点 / 卡片用 01 / 02 / 03 mono 编号引导，accent 粉色，像清单笔记。

主题 tokens（硬性锁定，禁止替换）：
- 画布底色 bg：#FEF8F1（奶油白）
- 主文字 ink：#3A3A3A（柔黑）
- 弱化文字 muted：#9A8E84（暖灰）
- 单一 accent：#FF9EB5（马卡龙粉；整卡只能 1 个语义焦点）
- 辅助色块（仅柔焦氛围 / 浅色卡面，不抢 accent）：薄荷 #9EE6C8 / 天蓝 #A9D7F5
- 卡圆角：borderRadius ≈ 28px（马卡龙柔和大圆角）
- 柔焦色块：radial-gradient(circle, rgba(255,158,181,0.30), transparent 62%) 等，固定静态层
- 编号 mono：accent 粉 #FF9EB5，01 / 02 / 03 序列
- 禁止：高饱和霓虹 / 暗黑底 / 直角硬边 / 第二种彩色当语义 accent / 逐帧脉动的色块。

字体栈：
- display：'Playfair Display','Noto Serif SC',serif（italic 倾向）
- body：'PingFang SC','Noto Sans SC',sans-serif
- mono：'JetBrains Mono',monospace

排版阶梯（H = height）：
- hero display（Playfair italic）：H * 0.12 ~ H * 0.17，fontWeight 600，fontStyle italic，lineHeight 1.15
- lead body：H * 0.04 ~ H * 0.052，fontWeight 400，lineHeight 1.5，muted
- 编号 mono：H * 0.03 ~ H * 0.04，fontWeight 600，accent 粉
- 数据大字（display italic）：H * 0.24 ~ H * 0.32，fontWeight 600，accent 粉

===== 区块语法（step 单元 = 圆角卡 / 编号项）=====
顶层容器 position:'relative'，background:'#FEF8F1'，display:'grid'，按内容选 SINGLE-FOCUS / HERO-FOOTER / HERO-3GRID，gap: H*0.04，padding: H*0.07 / W*0.06；柔焦色块层用 position:'absolute' inset:0、pointerEvents:none 的 div 铺，置于内容之下。
- **step 单元 = 一张马卡龙圆角卡或一个编号项**，与 trunk 的「step = tile」一一对应；按阅读顺序记作 step[0..N-1]。
- 圆角卡允许浅色 / 半透明白背景 + 大圆角 (≈28px) + 极轻阴影 —— 这是本风格对 trunk「tile 禁止 background / radius / shadow」的明确改写，小红书柔卡质感本质就在大圆角柔面；纯文本编号项可不加卡面，仅靠 mono 编号 + gap 区分。
- 柔焦色块层是固定氛围层，不计入 step、不参与逐块揭示、不逐帧动。

六类 type 版式提示：
- chapter：居中圆角卡内放 Playfair 斜体 hero 标题 + 01 编号 + 一条 accent 粉短线（scaleX 揭示）。
- summary：左 Playfair 斜体标题卡 + 右 lead 圆角要点卡。
- quote：圆角卡内居中斜体大引文，起首 accent 粉引号；底 mono 出处。
- insight：顶斜体结论卡 + 下行 2-3 张圆角卡各一条要点，01 / 02 / 03 编号 accent 粉。
- data：单值大数字（display italic，accent 粉）放 hero 圆角卡 + 单位；多值用纯 SVG <rect> 圆头柱（轨道浅暖灰、焦点 accent 粉，height 0→目标揭示）。
- motion：圆角卡内斜体短标题 + 一条 accent 粉描边 SVG 几何（strokeDashoffset 揭示），留白最大。

硬性视觉规则：
- 圆角卡 / 编号项依次揭示：在各自揭示窗内用 translateY(H*0.025) + opacity 0→1，可叠加 scale 从 0.97→1（scale **≤1.04**）；reveal-then-hold，一次性、不循环。
- 奶油底、柔焦色块写死为静态 CSS，**不进入任何无限 tween、不逐帧改变位置 / 不透明 / 缩放**。
- accent 粉线用 scaleX(0→1) 一次性单调揭示；揭示后保持。
- 严禁 Math.sin / Math.cos / random / noise 调制 opacity / translate / scale / 色块位置；严禁 spring 无限物理；严禁色块逐帧脉动；严禁 scale > 1.04 / 暗黑底 / 高饱和霓虹。

失败示例（生成后必自查）：
- ✗ 用 Math.random / Math.sin 让柔焦色块每帧脉动、漂移
- ✗ 标题用规整无衬线大字而非 Playfair 斜体
- ✗ 出现直角硬边卡片而非 ≈28px 大圆角
- ✗ 出现暗黑底 / 霓虹 / 第二种彩色当语义 accent
- ✗ scale 入场冲过 1.04`;

const XHS_PASTEL_COVER = `===== 视觉系统：小红书柔彩 封面 =====
美学锚点：小红书图文封面 × 马卡龙柔彩 × Playfair 斜体大字。16:9 封面是一张奶油底精致生活卡：柔焦马卡龙色块 + 大圆角柔卡 + 斜体衬线大标题，制造柔和点击钩子。

按维度顺序组织（主体→构图→风格→美学→质量→文字排版），中文逗号串联，120-180 字：
1. 主体：一张奶油底的精致马卡龙大圆角柔卡或柔和生活质感画面作为视觉主体，柔和悬浮，无人物特写、无卡通元素。
2. 构图：奶油白底，角落 2-3 个柔焦马卡龙色块（粉 / 薄荷 / 天蓝）点缀氛围，主体卡片居中柔和大圆角，斜体大标题压住版面，柔和留白。
3. 风格：小红书图文卡风，马卡龙柔彩，pastel aesthetic，柔焦色块，大圆角柔和卡，精致生活笔记感。
4. 美学：奶油白底 #FEF8F1，柔黑文字 #3A3A3A，单点缀马卡龙粉 #FF9EB5，辅以薄荷 #9EE6C8 / 天蓝 #A9D7F5 柔焦色块，柔和无霓虹无暗调。
5. 质量：4K 超清，锐利清晰，柔和精致质感，小红书爆款封面级精度。
6. 文字排版：从字幕提炼 1 条 4-10 字主标题用中文引号""…""精确包裹，衬线斜体（Playfair Display Italic / 思源宋体，Semibold），占版面高度 16%-26%，柔黑或马卡龙粉填色，accent 粉点缀；可选 1 条 mono 小字 01 编号 kicker。

强制规则：
- 主标题必用中文引号""…""精确包裹保证文字准确率；整图只允许 1 主标题 + 至多 1 kicker，禁止水印 / logo / 日期。
- 马卡龙粉为唯一语义 accent，薄荷 / 天蓝仅作柔焦色块不抢焦点，禁止高饱和霓虹 / 暗黑底。
- 必奶油白底 + 柔焦马卡龙色块 + 大圆角柔卡；禁止直角硬边、卡通贴纸、暗黑底。`;

const XHS_PASTEL_IMAGE = `===== 视觉系统：小红书柔彩 段落配图 =====
美学锚点：小红书图文内文配图 —— 一帧奶油底、柔焦马卡龙色块、大圆角柔和的生活质感画面，图内不出现任何文字。

按维度顺序组织（主体→构图→风格→美学→质量），中文逗号串联，90-150 字：
1. 主体：紧扣本段语义的柔和生活质感画面 —— 一组柔焦马卡龙色块、柔和悬浮的圆角元素或精致静物，奶油柔光，无卡通元素。
2. 构图：奶油白底，角落 2-3 个柔焦马卡龙色块（粉 / 薄荷 / 天蓝）点缀，主体居中柔和大圆角，柔和留白。
3. 风格：小红书图文配图风，马卡龙柔彩，pastel aesthetic，柔焦色块，大圆角柔和质感。
4. 美学：奶油白底 #FEF8F1，柔黑 #3A3A3A，单点缀马卡龙粉 #FF9EB5，薄荷 #9EE6C8 / 天蓝 #A9D7F5 柔焦色块，柔和无霓虹无暗调。
5. 质量：4K 超清，锐利清晰，柔和精致质感，小红书图文级精度。

强制规则：
- 图内禁止出现任何文字 / 数字标签 / 水印 / logo（段落配图不承载标题）。
- 马卡龙粉为唯一语义 accent，薄荷 / 天蓝仅作柔焦色块；必奶油白底 + 柔焦色块 + 大圆角柔和，禁止暗黑底 / 霓虹。`;

export const XHS_PASTEL: VisualStylePreset = {
  id: 'xhs-pastel',
  name: '小红书柔彩',
  description: '奶油底马卡龙柔彩：3 柔焦色块、≈28px 大圆角卡、Playfair 斜体显示字、01-04 编号序列依次揭示，单点缀马卡龙粉。',
  tags: ['浅色', '柔彩', '生活'],
  source: 'deck-xhs-pastel / card-xiaohongshu',
  palette: { bg: '#FEF8F1', ink: '#3A3A3A', muted: '#9A8E84', accent: '#FF9EB5' },
  fonts: {
    display: "'Playfair Display','Noto Serif SC',serif",
    body: "'PingFang SC','Noto Sans SC',sans-serif",
    mono: "'JetBrains Mono',monospace",
  },
  facets: { motion: XHS_PASTEL_MOTION, cover: XHS_PASTEL_COVER, image: XHS_PASTEL_IMAGE },
  preview: {
    motionHtml: `<style>
  .sp-root{position:relative;width:100%;height:100%;display:grid;place-content:center;gap:5%;font-family:'Playfair Display','Noto Serif SC',serif;background:#FEF8F1;color:#3A3A3A;box-sizing:border-box;padding:7% 6%;overflow:hidden;}
  .sp-blob{position:absolute;width:38%;height:38%;border-radius:50%;pointer-events:none;filter:blur(40px);}
  .sp-blob-a{top:-6%;left:-4%;background:radial-gradient(circle, rgba(255,158,181,0.34), transparent 62%);}
  .sp-blob-b{bottom:-8%;right:-6%;background:radial-gradient(circle, rgba(158,230,200,0.30), transparent 62%);}
  .sp-blob-c{top:30%;right:4%;background:radial-gradient(circle, rgba(169,215,245,0.28), transparent 62%);width:26%;height:26%;}
  .sp-card{position:relative;justify-self:center;background:rgba(255,255,255,0.72);border-radius:28px;padding:8% 9%;box-shadow:0 6px 20px rgba(154,142,132,0.12);display:grid;gap:14px;text-align:center;}
  .sp-num{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600;color:#FF9EB5;letter-spacing:0.08em;}
  .sp-title{font-size:clamp(26px,7.5vw,54px);font-weight:600;font-style:italic;line-height:1.15;}
  .sp-sub{font-family:'PingFang SC','Noto Sans SC',sans-serif;font-size:clamp(11px,2.6vw,15px);color:#9A8E84;line-height:1.5;}
</style>
<div class="sp-root">
  <div class="sp-blob sp-blob-a"></div>
  <div class="sp-blob sp-blob-b"></div>
  <div class="sp-blob sp-blob-c"></div>
  <div class="sp-card">
    <div class="sp-num">01</div>
    <div class="sp-title">示例标题</div>
    <div class="sp-sub">一句副标题或注解</div>
  </div>
</div>
<script>
  (function(){
    var tl = gsap.timeline({ paused: true });
    tl.from('.sp-card', { y: 26, opacity: 0, scale: 0.97, duration: 0.6, ease: 'power3.out' })
      .from('.sp-num', { y: 10, opacity: 0, duration: 0.4, ease: 'power2.out' }, '-=0.25')
      .from('.sp-title', { y: 14, opacity: 0, duration: 0.5, ease: 'power3.out' }, '-=0.25')
      .from('.sp-sub', { y: 12, opacity: 0, duration: 0.45, ease: 'power2.out' }, '-=0.25');
    window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
    window.__lingjiMotionTimelines.push(tl);
  })();
</script>`,
  },
};

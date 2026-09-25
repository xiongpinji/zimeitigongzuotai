/**
 * 灵机采风 共享视觉 token。
 *
 * 数值逐字取自用户原型（`Sonar 声呐.dc.html` / `Sonar 插件适配.dc.html`），
 * 用于让四个产品表面 1:1 还原原型的深色磨砂视觉语言。
 * accent 默认系统蓝；数字/时长/统计使用 JetBrains Mono（缺字体时回退系统等宽）。
 */
export const ACCENT = '#0a84ff';

export function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const S = {
  accent: ACCENT,
  accentTint: hexToRgba(ACCENT, 0.16),
  accent14: hexToRgba(ACCENT, 0.14),
  accent10: hexToRgba(ACCENT, 0.1),
  accentLine: hexToRgba(ACCENT, 0.4),

  // 背景层
  desktop: 'radial-gradient(120% 120% at 70% 0%, #241f38 0%, #14121e 45%, #0a0a10 100%)',
  shell: '#1c1c1e',
  feedList: '#1f1f21',
  card: '#232325',
  card2: '#252527',
  aiCard: '#222224',
  transcript: '#1e1e20',
  modal: '#262628',
  inputBg: '#1c1c1e',
  btn2: '#2c2c2e',
  btn2Hover: '#3a3a3c',
  titleBar: 'rgba(40,40,43,.7)',
  sidebar: 'rgba(34,34,37,.55)',

  // 文字
  white: '#f5f5f7',
  f0: '#f0f0f2',
  e8: '#e8e8ea',
  e2: '#e2e2e6',
  cf: '#cfcfd2',
  c8: '#c8c8cc',
  c4: '#c4c4c8',
  b4: '#b4b4b8',
  dim: '#9a9a9f',
  dim2: '#9a9aa0',
  mute: '#8a8a8f',
  faint: '#7c7c81',
  faint2: '#6e6e73',
  faint3: '#5e5e63',
  faint4: '#5a5a5f',

  // 状态色
  green: '#30d158',
  graydot: '#6e6e73',
  yellow: '#ffd60a',
  yellowTint: 'rgba(255,214,10,.12)',
  yellowTint14: 'rgba(255,214,10,.14)',
  yellowLine: 'rgba(255,214,10,.4)',
  red: '#ff453a',
  orange: '#ff9f0a',

  // 交通灯
  tlRed: '#ff5f57',
  tlYellow: '#febc2e',
  tlGreen: '#28c840',

  font: '-apple-system,"SF Pro Display","SF Pro Text",system-ui,"PingFang SC","Helvetica Neue",sans-serif',
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};

/** 视频类型（stance / category）色板，逐字取自原型 TYPES。 */
export const STANCE: Record<string, { c: string; bg: string }> = {
  深度分析: { c: '#0a84ff', bg: 'rgba(10,132,255,.14)' },
  数据解读: { c: '#5ac8fa', bg: 'rgba(90,200,250,.14)' },
  观点评论: { c: '#bf5af2', bg: 'rgba(191,90,242,.14)' },
  科普讲解: { c: '#30d158', bg: 'rgba(48,209,88,.14)' },
  资讯快讯: { c: '#ff9f0a', bg: 'rgba(255,159,10,.14)' },
  复盘总结: { c: '#8e8e93', bg: 'rgba(255,255,255,.10)' },
};
export const STANCE_FALLBACK = { c: '#98989d', bg: 'rgba(255,255,255,.08)' };

export function stanceStyle(category?: string): { c: string; bg: string } {
  return (category && STANCE[category]) || STANCE_FALLBACK;
}

/** 头像渐变调色板（无 avatarUrl 时按 id 派生）。 */
const AVATAR_GRADIENTS = [
  'linear-gradient(150deg,#0a84ff,#0a4fb0)',
  'linear-gradient(150deg,#bf5af2,#7d2fb0)',
  'linear-gradient(150deg,#30d158,#1a8f3c)',
  'linear-gradient(150deg,#ff9f0a,#c46a00)',
  'linear-gradient(150deg,#5ac8fa,#2a8fc0)',
  'linear-gradient(150deg,#ff453a,#c4302a)',
];
export function avatarGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

/** 封面渐变（无 coverUrl 时按 id 派生），呼应原型的深色对角渐变。 */
const COVER_PAIRS: Array<[string, string]> = [
  ['#1a3a5c', '#0e1f33'],
  ['#3a1a5c', '#1f0e33'],
  ['#1a5c3a', '#0e331f'],
  ['#5c3a1a', '#33200e'],
  ['#1a4a5c', '#0e2933'],
  ['#5c4a1a', '#33290e'],
  ['#3a3a1a', '#20200e'],
  ['#1a5c4a', '#0e3329'],
];
export function coverGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  const [a, b] = COVER_PAIRS[h % COVER_PAIRS.length];
  return `linear-gradient(140deg,${a},${b})`;
}

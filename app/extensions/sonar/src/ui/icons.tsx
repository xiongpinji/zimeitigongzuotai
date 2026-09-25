/** 原型中的全部 SVG 图标，逐条还原（同心圆灵机采风 logo、导航、齿轮、搜索、星火、info）。 */
import type { CSSProperties } from 'react';

/** 灵机采风同心圆 logo（雷达波）。outer=false 时省略最外环（注入按钮用）。 */
export function SonarMark({ size = 18, outer = true }: { size?: number; outer?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="1.6" fill="#fff" />
      <circle cx="9" cy="9" r="4.2" stroke="#fff" strokeOpacity="0.8" strokeWidth="1.3" />
      {outer && <circle cx="9" cy="9" r="7" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.1" />}
    </svg>
  );
}

/** 渐变方块 + logo 容器。 */
export function SonarBadge({
  box = 30,
  radius = 9,
  icon = 18,
  shadow,
}: {
  box?: number;
  radius?: number;
  icon?: number;
  shadow?: string;
}) {
  return (
    <div
      style={{
        width: box,
        height: box,
        borderRadius: radius,
        background: 'linear-gradient(160deg,#0a84ff,#0a5fd0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        boxShadow: shadow,
      }}
    >
      <SonarMark size={icon} />
    </div>
  );
}

export function FeedIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 17 17" fill="none">
      <path
        d="M2 8.5h2.2L6 4l3 9 2-5 1.2 0.5H15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LibraryIcon({ size = 16 }: { size?: number }) {
  const r = (x: number, y: number) => (
    <rect x={x} y={y} width="5" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      {r(2, 2)}
      {r(9, 2)}
      {r(2, 9)}
      {r(9, 9)}
    </svg>
  );
}

export function BloggersIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 17 17" fill="none">
      <circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2.5 13c0-2 1.6-3.3 3.5-3.3S9.5 11 9.5 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <g opacity="0.6">
        <circle cx="11.5" cy="5.2" r="2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M10.5 9.2c2 .1 4 1.2 4 3.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export function WorkflowIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2.5" width="3.4" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="6.3" y="2.5" width="3.4" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10.6" y="2.5" width="3.4" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function GearIcon({ size = 16, color = '#a1a1a6' }: { size?: number; color?: string }) {
  // 带齿的齿轮（cog），区别于「圆 + 放射状短线」那种会被误读成太阳的样式。
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

export function SearchIcon({ size = 13, color = '#8a8a8f' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke={color} strokeWidth="1.4" />
      <path d="M8.7 8.7L11.5 11.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function SparkIcon({ size = 15, color = '#0a84ff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M7 1.5c.3 2.6 1.4 3.7 4 4-2.6.3-3.7 1.4-4 4-.3-2.6-1.4-3.7-4-4 2.6-.3 3.7-1.4 4-4Z"
        fill={color}
      />
      <circle cx="12" cy="11.5" r="1.3" fill={color} fillOpacity="0.6" />
    </svg>
  );
}

export function InfoIcon({ size = 15, color = '#0a84ff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="6.2" stroke={color} strokeWidth="1.2" />
      <path d="M7.5 4.3v4M7.5 10.4v.1" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** 居中播放三角（用三角形 border 技法，和原型一致）。 */
export function PlayTriangle({ w = 7, color = '#fff' }: { w?: number; color?: string }) {
  const h = Math.round(w * 0.72);
  return (
    <span
      style={{
        width: 0,
        height: 0,
        borderLeft: `${w}px solid ${color}`,
        borderTop: `${h}px solid transparent`,
        borderBottom: `${h}px solid transparent`,
        marginLeft: Math.max(2, Math.round(w * 0.3)),
        display: 'block',
      }}
    />
  );
}

/** 视频缩略图上的居中圆形播放按钮。 */
export function PlayButton({ size = 22, tri = 7, blur }: { size?: number; tri?: number; blur?: number }) {
  const style: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%,-50%)',
    width: size,
    height: size,
    borderRadius: '50%',
    background: 'rgba(0,0,0,.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: size >= 30 ? '1px solid rgba(255,255,255,.25)' : undefined,
    backdropFilter: blur ? `blur(${blur}px)` : undefined,
    WebkitBackdropFilter: blur ? `blur(${blur}px)` : undefined,
  };
  return (
    <div style={style}>
      <PlayTriangle w={tri} />
    </div>
  );
}

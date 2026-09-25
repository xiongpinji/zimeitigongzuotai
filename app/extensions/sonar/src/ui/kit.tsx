/** 四个表面共享的小组件与 hook：全局样式、hover、Toast、头像、stance 徽章、缩略图。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { S, avatarGradient, coverGradient, stanceStyle } from './theme';
import { PlayButton } from './icons';

/** 注入一次全局样式：keyframes（spin/pulse/pop）、滚动条、reduced-motion。 */
export function GlobalStyles() {
  return (
    <style>{`
      *{box-sizing:border-box}
      ::-webkit-scrollbar{width:9px;height:9px}
      ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:6px;border:2px solid transparent;background-clip:padding-box}
      ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.24);background-clip:padding-box}
      ::-webkit-scrollbar-track{background:transparent}
      @keyframes sonar-spin{to{transform:rotate(360deg)}}
      @keyframes sonar-pulse{0%,100%{opacity:1}50%{opacity:.45}}
      @keyframes sonar-pop{0%{transform:translate(-50%,12px);opacity:0}100%{transform:translate(-50%,0);opacity:1}}
      @media (prefers-reduced-motion: reduce){
        *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
      }
    `}</style>
  );
}

/** hover 状态 hook：返回 [hovered, bind]。 */
export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [h, setH] = useState(false);
  return [h, { onMouseEnter: () => setH(true), onMouseLeave: () => setH(false) }];
}

/** hover 时叠加样式的容器，避免到处写 useHover。 */
export function Hover({
  base,
  hover,
  children,
  onClick,
  title,
  ...rest
}: {
  base: CSSProperties;
  hover: CSSProperties;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  as?: never;
}) {
  const [h, bind] = useHover();
  return (
    <div style={{ ...base, ...(h ? hover : null) }} onClick={onClick} title={title} {...bind} {...rest}>
      {children}
    </div>
  );
}

// —— Toast ——
export interface ToastApi {
  toast: string | null;
  show: (text: string) => void;
}
export function useToast(): ToastApi {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string) => {
    setToast(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return { toast, show };
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 26,
        transform: 'translateX(-50%)',
        background: 'rgba(44,44,46,.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '.5px solid rgba(255,255,255,.14)',
        borderRadius: 11,
        padding: '11px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 14px 40px rgba(0,0,0,.5)',
        zIndex: 30,
        animation: 'sonar-pop .25s ease',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: S.accent,
          boxShadow: `0 0 8px ${S.accent}`,
        }}
      />
      <span style={{ fontSize: 13, color: S.f0, fontWeight: 500 }}>{text}</span>
    </div>
  );
}

// —— 头像 ——
export function Avatar({
  seed,
  initial,
  url,
  size = 30,
  radius = 9,
  fontSize = 13,
}: {
  seed: string;
  initial: string;
  url?: string;
  size?: number;
  radius?: number;
  fontSize?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: url ? `center/cover no-repeat url(${url})` : avatarGradient(seed),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 600,
        color: '#fff',
        flex: 'none',
        overflow: 'hidden',
      }}
    >
      {!url && initial}
    </div>
  );
}

// —— stance 徽章 ——
export function StanceBadge({ category, style }: { category?: string; style?: CSSProperties }) {
  const ss = stanceStyle(category);
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: ss.c,
        background: ss.bg,
        padding: '1px 6px',
        borderRadius: 5,
        fontFamily: S.font,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {category || '未分类'}
    </span>
  );
}

// —— 缩略图（封面 + 斜纹 + 播放钮 + 时长） ——
export function Thumb({
  seed,
  url,
  duration,
  width,
  height,
  radius = 7,
  stripe = 6,
  play = 22,
  tri = 7,
  children,
}: {
  seed: string;
  url?: string;
  duration?: string;
  width?: number | string;
  height?: number | string;
  radius?: number;
  stripe?: number;
  play?: number;
  tri?: number;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: width ?? '100%',
        height,
        aspectRatio: height ? undefined : '16/9',
        borderRadius: radius,
        overflow: 'hidden',
        flex: 'none',
        background: url ? `center/cover no-repeat url(${url})` : coverGradient(seed),
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `repeating-linear-gradient(125deg,rgba(255,255,255,.04) 0 ${stripe}px,transparent ${stripe}px ${stripe * 2}px)`,
        }}
      />
      {play > 0 && <PlayButton size={play} tri={tri} />}
      {duration && (
        <span
          style={{
            position: 'absolute',
            right: play >= 34 ? 8 : 3,
            bottom: play >= 34 ? 7 : 2,
            fontSize: play >= 34 ? 10 : 9,
            fontFamily: S.mono,
            color: '#fff',
            background: 'rgba(0,0,0,.55)',
            padding: '1px 3px',
            borderRadius: 3,
          }}
        >
          {duration}
        </span>
      )}
      {children}
    </div>
  );
}

export function NewBadge({ style }: { style?: CSSProperties }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '.5px',
        color: S.accent,
        background: S.accentTint,
        padding: '1px 5px',
        borderRadius: 4,
        flex: 'none',
        ...style,
      }}
    >
      NEW
    </span>
  );
}

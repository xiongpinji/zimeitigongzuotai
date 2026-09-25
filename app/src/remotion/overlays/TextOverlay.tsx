import { interpolate, useCurrentFrame } from 'remotion';
import type { OverlayItem } from '../../types';

export function TextOverlay({
  overlay,
  zIndex,
  durationFrames,
}: {
  overlay: OverlayItem;
  zIndex: number;
  durationFrames: number;
}) {
  const t = overlay.textData;
  const frame = useCurrentFrame();
  if (!t) return null;
  const fadeIn = Math.min(13, Math.max(5, Math.round(durationFrames * 0.18)));
  const opacity = interpolate(frame, [0, fadeIn], [0, t.opacity ?? 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: overlay.position.x,
        top: overlay.position.y,
        width: overlay.position.width,
        height: overlay.position.height,
        zIndex,
        display: 'flex',
        alignItems: 'center',
        justifyContent:
          t.textAlign === 'center' ? 'center' : t.textAlign === 'right' ? 'flex-end' : 'flex-start',
        fontFamily: t.fontFamily,
        fontSize: t.fontSize,
        color: t.fontColor,
        fontWeight: t.bold ? 700 : 400,
        fontStyle: t.italic ? 'italic' : 'normal',
        textDecoration: t.underline ? 'underline' : 'none',
        textAlign: t.textAlign,
        backgroundColor: t.backgroundColor,
        WebkitTextStroke: t.strokeWidth > 0 ? `${t.strokeWidth}px ${t.strokeColor}` : undefined,
        textShadow:
          t.shadowBlur > 0 || t.shadowOffsetX !== 0 || t.shadowOffsetY !== 0
            ? `${t.shadowOffsetX}px ${t.shadowOffsetY}px ${t.shadowBlur}px ${t.shadowColor}`
            : undefined,
        letterSpacing: t.letterSpacing,
        lineHeight: t.lineHeight,
        opacity,
        transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined,
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
      }}
    >
      {t.content}
    </div>
  );
}

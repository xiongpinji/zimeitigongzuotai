import type { CSSProperties } from 'react';
import type { SubtitleHighlight, SubtitleStyle } from '../../types';
import type { RenderableSubtitle } from '../timeline-to-sequences';
import { filterValidSubtitleHighlights } from '../../lib/subtitle-highlights';

export function SubtitleLayer({
  cue,
  style,
  highlights,
}: {
  cue: RenderableSubtitle;
  style: SubtitleStyle;
  highlights: SubtitleHighlight[];
}) {
  const pos: CSSProperties =
    style.position === 'top'
      ? { top: 60 }
      : style.position === 'center'
        ? { top: '50%', transform: 'translateY(-50%)' }
        : { bottom: 64 };

  const valid = filterValidSubtitleHighlights(
    [{ index: cue.index, startMs: 0, endMs: 0, text: cue.text }],
    highlights,
  )[0];

  const content =
    valid && style.highlightEnabled ? (
      <>
        {cue.text.slice(0, valid.start)}
        <span
          style={{
            padding: `${style.highlightPaddingY}px ${style.highlightPaddingX}px`,
            borderRadius: style.highlightRadius,
            background: style.highlightBackgroundColor,
            color: style.highlightTextColor,
            boxShadow: '0 10px 24px rgba(0,0,0,.28)',
          }}
        >
          {cue.text.slice(valid.start, valid.end)}
        </span>
        {cue.text.slice(valid.end)}
      </>
    ) : (
      cue.text
    );

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        zIndex: 1000,
        textAlign: 'center',
        padding: '0 80px',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        ...pos,
      }}
    >
      <span
        style={{
          fontSize: style.fontSize,
          color: style.color,
          fontWeight: 700,
          lineHeight: 1.42,
          textShadow: '0 2px 10px rgba(0,0,0,.72), 0 0 24px rgba(0,0,0,.55)',
          whiteSpace: 'pre-line',
          display: 'inline-block',
          maxWidth: '100%',
        }}
      >
        {content}
      </span>
    </div>
  );
}

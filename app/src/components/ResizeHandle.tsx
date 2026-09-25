import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import styles from './ResizeHandle.module.css';

export interface ResizeHandleProps {
  axis: 'x' | 'y';
  direction?: 'grow' | 'shrink';
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  className?: string;
  ariaLabel?: string;
  thickness?: number;
}

export function ResizeHandle({
  axis,
  direction = 'grow',
  value,
  min,
  max,
  onChange,
  className,
  ariaLabel,
  thickness = 6,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ start: number; startValue: number } | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragStateRef.current = {
        start: axis === 'x' ? event.clientX : event.clientY,
        startValue: value,
      };
      setDragging(true);
    },
    [axis, value],
  );

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const handleMove = (event: globalThis.MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) {
        return;
      }
      const sign = direction === 'grow' ? 1 : -1;
      const coord = axis === 'x' ? event.clientX : event.clientY;
      const next = state.startValue + sign * (coord - state.start);
      const clamped = Math.max(min, Math.min(max, Math.round(next)));
      onChangeRef.current(clamped);
    };

    const handleUp = () => {
      dragStateRef.current = null;
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [axis, direction, dragging, max, min]);

  const composedClassName = [
    styles.handle,
    axis === 'x' ? styles.axisX : styles.axisY,
    dragging ? styles.active : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const sizeStyle = axis === 'x' ? { width: thickness } : { height: thickness };

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className={composedClassName}
      style={sizeStyle}
      onMouseDown={handleMouseDown}
      data-editor-region="resize-handle"
    >
      <div className={styles.thumb} />
    </div>
  );
}

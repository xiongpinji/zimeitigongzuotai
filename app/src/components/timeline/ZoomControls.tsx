import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import {
  clampTimelineZoom,
  zoomIn,
  zoomOut,
  zoomToFit,
  zoomToPercent,
} from '../../lib/timeline-view';
import styles from './TimelineToolbar.module.css';

export interface ZoomControlsProps {
  zoomLevel: number;
  onZoomChange: (zoom: number) => void;
  timelineDurationMs: number;
  viewportWidth: number;
}

const PRESETS = [25, 50, 100, 200, 400];

export function ZoomControls({
  zoomLevel,
  onZoomChange,
  timelineDurationMs,
  viewportWidth,
}: ZoomControlsProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const percent = Math.round(zoomLevel * 100);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleDocClick = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (target && wrapRef.current && !wrapRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocClick);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
    };
  }, [open]);

  return (
    <div className={styles.zoomControls}>
      <button
        type="button"
        className={styles.btn}
        title="缩小"
        aria-label="缩小"
        onClick={() => onZoomChange(zoomOut(zoomLevel))}
      >
        <Minus size={14} />
      </button>
      <div className={styles.zoomPercentWrap} ref={wrapRef}>
        <button
          type="button"
          className={styles.btn}
          title="缩放百分比"
          aria-label="缩放百分比"
          onClick={() => setOpen((prev) => !prev)}
        >
          {percent}%
        </button>
        {open && (
          <div className={styles.zoomMenu} role="menu">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={styles.zoomMenuItem}
                role="menuitem"
                onClick={() => {
                  onZoomChange(zoomToPercent(p));
                  setOpen(false);
                }}
              >
                {p}%
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className={styles.btn}
        title="放大"
        aria-label="放大"
        onClick={() => onZoomChange(zoomIn(zoomLevel))}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        className={styles.btn}
        title="适应窗口"
        aria-label="适应窗口"
        onClick={() =>
          onZoomChange(zoomToFit(timelineDurationMs, viewportWidth))
        }
      >
        <Maximize2 size={14} />
      </button>
      <button
        type="button"
        className={styles.btn}
        title="恢复 100%"
        aria-label="恢复 100%"
        onClick={() => onZoomChange(clampTimelineZoom(1))}
      >
        <span className={styles.zoomResetLabel}>1:1</span>
      </button>
    </div>
  );
}

import { useCallback, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import type { OverlayItem, OverlayPosition } from '../types';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import styles from './CanvasInteractionLayer.module.css';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];

interface StageRectSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CanvasInteractionLayerProps {
  overlays: OverlayItem[];
  selectedOverlayId: string | null;
  currentTimeMs: number;
  canvasWidth: number;
  canvasHeight: number;
  getStageRect: () => StageRectSnapshot | null;
  onSelect: (overlayId: string | null) => void;
  onUpdatePosition: (overlayId: string, position: OverlayPosition) => void;
}

function overlayToPercent(pos: OverlayPosition, cw: number, ch: number) {
  return {
    left: `${(pos.x / cw) * 100}%`,
    top: `${(pos.y / ch) * 100}%`,
    width: `${(pos.width / cw) * 100}%`,
    height: `${(pos.height / ch) * 100}%`,
  };
}

export function CanvasInteractionLayer({
  overlays,
  selectedOverlayId,
  currentTimeMs,
  canvasWidth,
  canvasHeight,
  getStageRect,
  onSelect,
  onUpdatePosition,
}: CanvasInteractionLayerProps) {
  // 只显示当前播放时间范围内的文字 overlay
  const textOverlays = overlays.filter(
    (o) =>
      o.type === 'text' &&
      currentTimeMs >= o.startMs &&
      currentTimeMs < o.startMs + o.durationMs,
  );
  const selectedOverlay = textOverlays.find((o) => o.id === selectedOverlayId);

  const {
    state,
    hoveredId,
    setHoveredId,
    startDrag,
    startResize,
    onMouseMove,
    endInteraction,
  } = useCanvasInteraction({ canvasWidth, canvasHeight, getStageRect, onUpdatePosition });

  // 避免 lint 报 unused（selectedOverlay 未来可用于扩展）
  void selectedOverlay;

  useEffect(() => {
    if (state === 'idle') return;

    const handleMove = (e: globalThis.MouseEvent) => onMouseMove(e.clientX, e.clientY);
    const handleUp = () => endInteraction();

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [state, onMouseMove, endInteraction]);

  const handleBackgroundClick = useCallback(
    (e: ReactMouseEvent) => {
      if (e.target === e.currentTarget) {
        onSelect(null);
      }
    },
    [onSelect],
  );

  const handleOverlayMouseDown = useCallback(
    (overlay: OverlayItem, e: ReactMouseEvent) => {
      e.stopPropagation();
      onSelect(overlay.id);
      startDrag(overlay.id, overlay.position, e.clientX, e.clientY);
    },
    [onSelect, startDrag],
  );

  const handleHandleMouseDown = useCallback(
    (overlay: OverlayItem, handle: ResizeHandle, e: ReactMouseEvent) => {
      e.stopPropagation();
      startResize(overlay.id, overlay.position, handle, e.clientX, e.clientY);
    },
    [startResize],
  );

  return (
    <div
      className={styles.root}
      onMouseDown={handleBackgroundClick}
    >
      {textOverlays.map((overlay) => {
        const isSelected = overlay.id === selectedOverlayId;
        const isHovered = overlay.id === hoveredId;
        const pct = overlayToPercent(overlay.position, canvasWidth, canvasHeight);

        return (
          <div
            key={overlay.id}
            className={[
              styles.overlayBox,
              isSelected ? styles.selected : '',
              isHovered && !isSelected ? styles.hovered : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={pct}
            onMouseDown={(e) => handleOverlayMouseDown(overlay, e)}
            onMouseEnter={() => setHoveredId(overlay.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {isSelected &&
              HANDLES.map((handle) => (
                <div
                  key={handle}
                  className={[styles.handle, styles[`handle_${handle}`]].join(' ')}
                  onMouseDown={(e) => handleHandleMouseDown(overlay, handle, e)}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

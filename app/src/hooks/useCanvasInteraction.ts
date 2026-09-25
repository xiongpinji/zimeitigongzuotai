import { useCallback, useRef, useState } from 'react';
import type { OverlayPosition } from '../types';
import { clamp } from '../lib/utils';

type InteractionState = 'idle' | 'dragging' | 'resizing';
type ResizeHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

interface DragState {
  startMouseX: number;
  startMouseY: number;
  startPosition: OverlayPosition;
  handle?: ResizeHandle;
}

interface StageRectSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface UseCanvasInteractionParams {
  canvasWidth: number;
  canvasHeight: number;
  getStageRect: () => StageRectSnapshot | null;
  onUpdatePosition: (overlayId: string, position: OverlayPosition) => void;
}

function screenToCanvas(
  mouseX: number,
  mouseY: number,
  stageRect: StageRectSnapshot,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: ((mouseX - stageRect.left) / stageRect.width) * canvasWidth,
    y: ((mouseY - stageRect.top) / stageRect.height) * canvasHeight,
  };
}

function isStageRectUsable(rect: StageRectSnapshot | null): rect is StageRectSnapshot {
  return !!rect && rect.width > 0 && rect.height > 0;
}

const MIN_SIZE_RATIO = 0.05;

function constrainPosition(
  pos: OverlayPosition,
  canvasWidth: number,
  canvasHeight: number,
): OverlayPosition {
  const minW = canvasWidth * MIN_SIZE_RATIO;
  const minH = canvasHeight * MIN_SIZE_RATIO;
  const w = Math.max(minW, pos.width);
  const h = Math.max(minH, pos.height);
  const minVisible = 0.1;
  const x = clamp(pos.x, -(w * (1 - minVisible)), canvasWidth - w * minVisible);
  const y = clamp(pos.y, -(h * (1 - minVisible)), canvasHeight - h * minVisible);
  return { x, y, width: w, height: h };
}

export function useCanvasInteraction({
  canvasWidth,
  canvasHeight,
  getStageRect,
  onUpdatePosition,
}: UseCanvasInteractionParams) {
  const [state, setState] = useState<InteractionState>('idle');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const activeOverlayRef = useRef<string | null>(null);

  const startDrag = useCallback(
    (overlayId: string, position: OverlayPosition, mouseX: number, mouseY: number) => {
      activeOverlayRef.current = overlayId;
      dragRef.current = { startMouseX: mouseX, startMouseY: mouseY, startPosition: { ...position } };
      setState('dragging');
    },
    [],
  );

  const startResize = useCallback(
    (
      overlayId: string,
      position: OverlayPosition,
      handle: ResizeHandle,
      mouseX: number,
      mouseY: number,
    ) => {
      activeOverlayRef.current = overlayId;
      dragRef.current = {
        startMouseX: mouseX,
        startMouseY: mouseY,
        startPosition: { ...position },
        handle,
      };
      setState('resizing');
    },
    [],
  );

  const onMouseMove = useCallback(
    (mouseX: number, mouseY: number) => {
      if (!dragRef.current || !activeOverlayRef.current) return;
      const stageRect = getStageRect();
      if (!isStageRectUsable(stageRect)) return;

      const drag = dragRef.current;
      const current = screenToCanvas(mouseX, mouseY, stageRect, canvasWidth, canvasHeight);
      const start = screenToCanvas(drag.startMouseX, drag.startMouseY, stageRect, canvasWidth, canvasHeight);
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      const sp = drag.startPosition;

      let next: OverlayPosition;

      if (state === 'dragging') {
        next = { x: sp.x + dx, y: sp.y + dy, width: sp.width, height: sp.height };
      } else {
        const handle = drag.handle!;
        let { x, y, width, height } = sp;

        if (handle.includes('w')) { x = sp.x + dx; width = sp.width - dx; }
        if (handle.includes('e')) { width = sp.width + dx; }
        if (handle.includes('n')) { y = sp.y + dy; height = sp.height - dy; }
        if (handle.includes('s')) { height = sp.height + dy; }

        next = { x, y, width, height };
      }

      onUpdatePosition(activeOverlayRef.current, constrainPosition(next, canvasWidth, canvasHeight));
    },
    [canvasWidth, canvasHeight, getStageRect, state, onUpdatePosition],
  );

  const endInteraction = useCallback(() => {
    dragRef.current = null;
    setState('idle');
  }, []);

  return {
    state,
    hoveredId,
    setHoveredId,
    startDrag,
    startResize,
    onMouseMove,
    endInteraction,
  };
}

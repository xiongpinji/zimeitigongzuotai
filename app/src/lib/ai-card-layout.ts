import type { OverlayPosition } from '../types';
import type { AICardDisplayMode } from '../types/ai';

const PIP_WIDTH_RATIO = 0.34;
const PIP_MARGIN_RATIO = 0.04;
const PIP_ASPECT_RATIO = 16 / 9;

export function getAICardOverlayPosition(
  displayMode: AICardDisplayMode,
  stageWidth: number,
  stageHeight: number,
): OverlayPosition {
  if (displayMode === 'fullscreen') {
    return {
      x: 0,
      y: 0,
      width: stageWidth,
      height: stageHeight,
    };
  }

  const margin = Math.round(Math.min(stageWidth, stageHeight) * PIP_MARGIN_RATIO);
  let width = Math.round(Math.min(stageWidth - margin * 2, stageWidth * PIP_WIDTH_RATIO));
  let height = Math.round(width / PIP_ASPECT_RATIO);
  const maxHeight = Math.max(1, stageHeight - margin * 2);

  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * PIP_ASPECT_RATIO);
  }

  return {
    x: Math.max(margin, stageWidth - width - margin),
    y: Math.max(margin, stageHeight - height - margin),
    width,
    height,
  };
}

export function isFullscreenAICardPosition(
  position: OverlayPosition,
  stageWidth: number,
  stageHeight: number,
): boolean {
  return (
    position.x === 0 &&
    position.y === 0 &&
    position.width === stageWidth &&
    position.height === stageHeight
  );
}

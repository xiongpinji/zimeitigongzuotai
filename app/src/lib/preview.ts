const DEFAULT_MAX_PREVIEW_WIDTH = 960;

export function getPreviewCompositionSize(
  width: number,
  height: number,
  maxWidth = DEFAULT_MAX_PREVIEW_WIDTH,
): {
  width: number;
  height: number;
  scale: number;
} {
  if (width <= maxWidth) {
    return {
      width,
      height,
      scale: 1,
    };
  }

  const scale = maxWidth / width;

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale,
  };
}

export function fitPreviewStage(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
): {
  width: number;
  height: number;
} {
  if (containerWidth <= 0 || containerHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
    return {
      width: 0,
      height: 0,
    };
  }

  const contentRatio = contentWidth / contentHeight;
  const containerRatio = containerWidth / containerHeight;

  if (containerRatio > contentRatio) {
    const height = Math.round(containerHeight);
    return {
      width: Math.round(height * contentRatio),
      height,
    };
  }

  const width = Math.round(containerWidth);
  return {
    width,
    height: Math.round(width / contentRatio),
  };
}

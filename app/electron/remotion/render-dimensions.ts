/** Remotion 的 scale 必须让两条边都成为偶数整数，否则 H.264 拼帧会失败。 */
export interface RemotionRenderDimensionPlan {
  scale: number;
  rasterWidth: number;
  rasterHeight: number;
  outputWidth: number;
  outputHeight: number;
  needsFinalScale: boolean;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * 先以等比例、偶数整数尺寸截帧；目标尺寸不能直接由 Remotion scale 得到时，
 * 在同一次 FFmpeg 拼帧编码中缩至精确的目标尺寸。
 */
export function planRemotionRenderDimensions(
  timelineWidth: number,
  timelineHeight: number,
  outputWidth: number,
  outputHeight: number,
): RemotionRenderDimensionPlan {
  if (
    ![timelineWidth, timelineHeight, outputWidth, outputHeight].every(
      (value) => Number.isInteger(value) && value > 0,
    ) ||
    outputWidth % 2 !== 0 || outputHeight % 2 !== 0
  ) {
    throw new Error('Remotion export dimensions must be positive integers with even output edges');
  }

  const divisor = gcd(timelineWidth, timelineHeight);
  const unitWidth = timelineWidth / divisor;
  const unitHeight = timelineHeight / divisor;
  const maxMultiple = Math.floor(divisor / 2) * 2;
  const requiredMultiple = Math.ceil(
    Math.max(outputWidth / unitWidth, outputHeight / unitHeight) / 2,
  ) * 2;

  for (let multiple = requiredMultiple; multiple <= maxMultiple; multiple += 2) {
    const scale = multiple / divisor;
    const rasterWidth = unitWidth * multiple;
    const rasterHeight = unitHeight * multiple;
    if (timelineWidth * scale === rasterWidth && timelineHeight * scale === rasterHeight) {
      return {
        scale,
        rasterWidth,
        rasterHeight,
        outputWidth,
        outputHeight,
        needsFinalScale: rasterWidth !== outputWidth || rasterHeight !== outputHeight,
      };
    }
  }
  throw new Error('Cannot produce an even integer Remotion raster for this timeline');
}

export function insertOutputScaleFilter(
  args: string[],
  plan: RemotionRenderDimensionPlan,
): string[] {
  if (!plan.needsFinalScale) return args;
  if (args.length === 0 || args.includes('-vf') || args.includes('-filter:v')) {
    throw new Error('Cannot insert the final video scale filter into FFmpeg arguments');
  }
  return [
    ...args.slice(0, -1),
    '-vf',
    `scale=${plan.outputWidth}:${plan.outputHeight}:flags=lanczos`,
    args[args.length - 1],
  ];
}

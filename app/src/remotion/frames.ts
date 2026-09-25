export function msToFrames(ms: number, fps: number): number {
  return Math.round((Math.max(0, ms) / 1000) * fps);
}

export function framesToMs(frames: number, fps: number): number {
  return Math.round((Math.max(0, frames) / fps) * 1000);
}

/** Sequence durationInFrames 必须 >= 1，避免 Remotion 报错。 */
export function durationFrames(ms: number, fps: number): number {
  return Math.max(1, msToFrames(ms, fps));
}

import type { OverlayItem, OverlayMotion, TextAnimation } from '../types';

export function createDefaultOverlayMotion(): OverlayMotion {
  return {
    enter: 'none',
    enterDurationMs: 400,
    exit: 'none',
    exitDurationMs: 400,
    loop: 'none',
  };
}

function isValidTextAnimation(value: unknown): value is TextAnimation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const animation = value as Partial<TextAnimation>;
  return (
    typeof animation.enter === 'string' &&
    typeof animation.enterDurationMs === 'number' &&
    typeof animation.exit === 'string' &&
    typeof animation.exitDurationMs === 'number' &&
    typeof animation.loop === 'string'
  );
}

export function resolveOverlayMotion(overlay: OverlayItem): OverlayMotion {
  // 文字图层的动画配置由 TextInspector 直接写入 textData.animation，
  // 因此在渲染时必须以 textData.animation 为准。
  // 否则 timeline 归一化（timeline-tracks.ts）提前物化的 overlay.motion
  // 会成为陈旧副本，导致 TextInspector 修改入场/出场/循环后预览不刷新。
  if (overlay.type === 'text' && isValidTextAnimation(overlay.textData?.animation)) {
    const { enter, enterDurationMs, exit, exitDurationMs, loop } = overlay.textData.animation;
    return {
      enter,
      enterDurationMs,
      exit,
      exitDurationMs,
      loop: loop === 'typewriter' ? 'none' : loop,
    };
  }

  if (overlay.motion) {
    return overlay.motion;
  }

  if (isValidTextAnimation(overlay.textData?.animation)) {
    const { enter, enterDurationMs, exit, exitDurationMs, loop } = overlay.textData.animation;
    return {
      enter,
      enterDurationMs,
      exit,
      exitDurationMs,
      loop: loop === 'typewriter' ? 'none' : loop,
    };
  }

  return createDefaultOverlayMotion();
}

interface OverlayMotionParams {
  frame: number;
  fps: number;
  durationFrames: number;
  motion: OverlayMotion;
}

interface OverlayMotionResult {
  opacity?: number;
  transform?: string;
}

function msToFrames(ms: number, fps: number): number {
  return Math.ceil((ms / 1000) * fps);
}

function interpolate(
  input: number,
  inputRange: [number, number],
  outputRange: [number, number],
): number {
  const [inMin, inMax] = inputRange;
  const [outMin, outMax] = outputRange;
  if (inMax === inMin) return outMax;
  const t = Math.max(0, Math.min(1, (input - inMin) / (inMax - inMin)));
  return outMin + (outMax - outMin) * t;
}

function getEnterStyle(
  enter: OverlayMotion['enter'],
  progress: number,
): Required<Pick<OverlayMotionResult, 'opacity'>> & Pick<OverlayMotionResult, 'transform'> {
  if (enter === 'none') {
    return { opacity: 1 };
  }

  const opacity = interpolate(progress, [0, 1], [0, 1]);
  switch (enter) {
    case 'fadeIn':
      return { opacity };
    case 'slideInLeft':
      return { opacity, transform: `translateX(${interpolate(progress, [0, 1], [-100, 0])}%)` };
    case 'slideInRight':
      return { opacity, transform: `translateX(${interpolate(progress, [0, 1], [100, 0])}%)` };
    case 'slideInUp':
      return { opacity, transform: `translateY(${interpolate(progress, [0, 1], [100, 0])}%)` };
    case 'slideInDown':
      return { opacity, transform: `translateY(${interpolate(progress, [0, 1], [-100, 0])}%)` };
    case 'scaleIn':
    case 'bounceIn':
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [0, 1])})` };
    default:
      return { opacity: 1 };
  }
}

function getExitStyle(
  exit: OverlayMotion['exit'],
  progress: number,
): Required<Pick<OverlayMotionResult, 'opacity'>> & Pick<OverlayMotionResult, 'transform'> {
  if (exit === 'none') {
    return { opacity: 1 };
  }

  const opacity = interpolate(progress, [0, 1], [1, 0]);
  switch (exit) {
    case 'fadeOut':
      return { opacity };
    case 'slideOutLeft':
      return { opacity, transform: `translateX(${interpolate(progress, [0, 1], [0, -100])}%)` };
    case 'slideOutRight':
      return { opacity, transform: `translateX(${interpolate(progress, [0, 1], [0, 100])}%)` };
    case 'slideOutUp':
      return { opacity, transform: `translateY(${interpolate(progress, [0, 1], [0, -100])}%)` };
    case 'slideOutDown':
      return { opacity, transform: `translateY(${interpolate(progress, [0, 1], [0, 100])}%)` };
    case 'scaleOut':
    case 'bounceOut':
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [1, 0])})` };
    default:
      return { opacity: 1 };
  }
}

function getLoopStyle(loop: OverlayMotion['loop'], frame: number, fps: number): OverlayMotionResult {
  if (loop === 'none') {
    return {};
  }

  const time = frame / fps;
  switch (loop) {
    case 'pulse':
      return { opacity: 0.8 + 0.2 * Math.sin(time * Math.PI * 2) };
    case 'float':
      return { transform: `translateY(${8 * Math.sin(time * Math.PI * 2 * 0.5)}px)` };
    case 'flicker':
      return { opacity: 0.65 + 0.35 * Math.sin(time * Math.PI * 2 * 4) };
    default:
      return {};
  }
}

export function getOverlayMotionStyle({
  frame,
  fps,
  durationFrames,
  motion,
}: OverlayMotionParams): OverlayMotionResult {
  const totalDurationMs = (durationFrames / fps) * 1000;
  const enterMs = Math.min(motion.enterDurationMs, totalDurationMs * 0.5);
  const exitMs = Math.min(motion.exitDurationMs, totalDurationMs - enterMs);
  const enterFrames = msToFrames(enterMs, fps);
  const exitFrames = msToFrames(exitMs, fps);
  const exitStart = durationFrames - exitFrames;

  if (frame < enterFrames && motion.enter !== 'none') {
    const progress = enterFrames > 0 ? frame / enterFrames : 1;
    return getEnterStyle(motion.enter, progress);
  }

  if (frame >= exitStart && motion.exit !== 'none') {
    const progress = exitFrames > 0 ? (frame - exitStart) / exitFrames : 1;
    return getExitStyle(motion.exit, progress);
  }

  return getLoopStyle(motion.loop, frame - enterFrames, fps);
}

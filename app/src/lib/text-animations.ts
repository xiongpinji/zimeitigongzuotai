import type { TextAnimation } from '../types';

interface AnimationParams {
  frame: number;
  fps: number;
  durationFrames: number;
  animation: TextAnimation;
  content?: string;
}

interface AnimationResult {
  style: {
    opacity?: number;
    transform?: string;
  };
  visibleText?: string;
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
  enter: TextAnimation['enter'],
  progress: number,
): { opacity: number; transform?: string } {
  if (enter === 'none') return { opacity: 1 };
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
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [0, 1])})` };
    case 'bounceIn':
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [0, 1])})` };
    default:
      return { opacity: 1 };
  }
}

function getExitStyle(
  exit: TextAnimation['exit'],
  progress: number,
): { opacity: number; transform?: string } {
  if (exit === 'none') return { opacity: 1 };
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
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [1, 0])})` };
    case 'bounceOut':
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [1, 0])})` };
    default:
      return { opacity: 1 };
  }
}

function getLoopStyle(
  loop: TextAnimation['loop'],
  frame: number,
  fps: number,
  content?: string,
): { opacity?: number; transform?: string; visibleText?: string } {
  if (loop === 'none') return {};
  const time = frame / fps;
  switch (loop) {
    case 'pulse': {
      const value = 0.8 + 0.2 * Math.sin(time * Math.PI * 2);
      return { opacity: value };
    }
    case 'float': {
      const offset = 8 * Math.sin(time * Math.PI * 2 * 0.5);
      return { transform: `translateY(${offset}px)` };
    }
    case 'flicker': {
      const value = 0.65 + 0.35 * Math.sin(time * Math.PI * 2 * 4);
      return { opacity: value };
    }
    case 'typewriter': {
      if (!content) return {};
      const charsPerSecond = 10;
      const totalChars = content.length;
      const cycleDuration = totalChars / charsPerSecond;
      const cycleTime = time % cycleDuration;
      const visibleChars = Math.min(totalChars, Math.floor(cycleTime * charsPerSecond) + 1);
      return { visibleText: content.slice(0, visibleChars) };
    }
    default:
      return {};
  }
}

export function getTextAnimationStyle(params: AnimationParams): AnimationResult {
  const { frame, fps, durationFrames, animation, content } = params;

  // 将动画时长限制在总时长之内
  const totalDurationMs = (durationFrames / fps) * 1000;
  const enterMs = Math.min(animation.enterDurationMs, totalDurationMs * 0.5);
  const exitMs = Math.min(animation.exitDurationMs, totalDurationMs - enterMs);
  const enterFrames = msToFrames(enterMs, fps);
  const exitFrames = msToFrames(exitMs, fps);
  const exitStart = durationFrames - exitFrames;

  // 进入阶段
  if (frame < enterFrames && animation.enter !== 'none') {
    const progress = enterFrames > 0 ? frame / enterFrames : 1;
    const enterStyle = getEnterStyle(animation.enter, progress);
    return { style: enterStyle };
  }

  // 退出阶段
  if (frame >= exitStart && animation.exit !== 'none') {
    const progress = exitFrames > 0 ? (frame - exitStart) / exitFrames : 1;
    const exitStyle = getExitStyle(animation.exit, progress);
    return { style: exitStyle };
  }

  // 循环阶段 / 静态阶段
  const loopResult = getLoopStyle(animation.loop, frame - enterFrames, fps, content);
  return {
    style: {
      opacity: loopResult.opacity ?? 1,
      transform: loopResult.transform,
    },
    visibleText: loopResult.visibleText,
  };
}

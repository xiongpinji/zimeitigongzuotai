import type { TimelineData } from '../types';

export interface EditError {
  field: string;
  message: string;
}

/**
 * OverlayEnterAnimation 合法值集合
 * 来源：src/types.ts TextEnterAnimation（OverlayEnterAnimation = Exclude<TextEnterAnimation, never>）
 */
const VALID_ENTER = new Set<string>([
  'none',
  'fadeIn',
  'slideInLeft',
  'slideInRight',
  'slideInUp',
  'slideInDown',
  'scaleIn',
  'bounceIn',
]);

/**
 * OverlayExitAnimation 合法值集合
 * 来源：src/types.ts TextExitAnimation（OverlayExitAnimation = Exclude<TextExitAnimation, never>）
 */
const VALID_EXIT = new Set<string>([
  'none',
  'fadeOut',
  'slideOutLeft',
  'slideOutRight',
  'slideOutUp',
  'slideOutDown',
  'scaleOut',
  'bounceOut',
]);

/**
 * 校验外部 AI 编辑后的 timeline 基本约束。
 * 不抛异常，收集所有违规后返回 EditError[]。
 * 保守策略：仅对"明确确定非法"的数据报错，避免误伤合法数据。
 */
export function validateTimeline(timeline: TimelineData): EditError[] {
  const errors: EditError[] = [];

  const overlays = (timeline as unknown as { overlays?: unknown[] }).overlays ?? [];

  overlays.forEach((raw, i) => {
    const ov = raw as Record<string, unknown>;
    const at = `overlays[${i}]`;

    // 时间约束
    if (typeof ov.startMs === 'number' && ov.startMs < 0) {
      errors.push({ field: `${at}.startMs`, message: 'startMs 不能为负' });
    }
    if (typeof ov.durationMs === 'number' && ov.durationMs <= 0) {
      errors.push({ field: `${at}.durationMs`, message: 'durationMs 必须为正' });
    }

    // 动画枚举约束（仅在字段为非空字符串时校验）
    const motion = ov.motion as Record<string, unknown> | undefined;
    if (motion != null) {
      if (typeof motion.enter === 'string' && motion.enter.length > 0 && !VALID_ENTER.has(motion.enter)) {
        errors.push({
          field: `${at}.motion.enter`,
          message: `非法 enter 动画: ${motion.enter}`,
        });
      }
      if (typeof motion.exit === 'string' && motion.exit.length > 0 && !VALID_EXIT.has(motion.exit)) {
        errors.push({
          field: `${at}.motion.exit`,
          message: `非法 exit 动画: ${motion.exit}`,
        });
      }
    }
  });

  return errors;
}

import type { TimelineData } from '../types';

export interface MotionCardSource {
  overlayId: string;
  tsx: string;
}

/** 收集时间线内所有 motion-card 且带有有效 tsx 的卡片，供编译。 */
export function collectMotionCards(timeline: TimelineData): MotionCardSource[] {
  const out: MotionCardSource[] = [];
  for (const overlay of timeline.overlays) {
    const card = overlay.aiCardData;
    if (!card || card.renderMode !== 'motion-card') continue;
    const tsx = card.motionCard?.tsx?.trim();
    if (tsx) out.push({ overlayId: overlay.id, tsx });
  }
  return out;
}

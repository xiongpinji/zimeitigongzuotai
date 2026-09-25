import type { TimelineData } from '../types';
import type { MotionCardPayload } from '../types/motion';

export function motionCardTsxPath(overlayId: string): string {
  return `ai-cards/${overlayId}/motionCard.tsx`;
}

interface OverlayLike {
  id: string;
  aiCardData?: { renderMode?: string; motionCard?: MotionCardPayload };
}

function eachMotionCard(
  timeline: TimelineData,
): Array<{ overlayId: string; card: MotionCardPayload }> {
  const out: Array<{ overlayId: string; card: MotionCardPayload }> = [];
  for (const overlay of (timeline.overlays ?? []) as unknown as OverlayLike[]) {
    const card = overlay.aiCardData?.motionCard;
    if (overlay.aiCardData?.renderMode === 'motion-card' && card) {
      out.push({ overlayId: overlay.id, card });
    }
  }
  return out;
}

/** 深拷贝 timeline（结构化克隆，避免改到 store 内存对象）。 */
function clone(timeline: TimelineData): TimelineData {
  return JSON.parse(JSON.stringify(timeline)) as TimelineData;
}

/** 落盘前：把每张卡的 tsx 写独立文件，JSON 内替换为 tsxPath。 */
export async function dehydrateTimelineCards(
  timeline: TimelineData,
  io: { writeFile: (relPath: string, content: string) => Promise<void> },
): Promise<TimelineData> {
  const next = clone(timeline);
  for (const { overlayId, card } of eachMotionCard(next)) {
    const src = card.tsx?.trim();
    if (!src) continue;
    const rel = motionCardTsxPath(overlayId);
    await io.writeFile(rel, card.tsx as string);
    card.tsxPath = rel;
    delete card.tsx;
  }
  return next;
}

/** 加载后：据 tsxPath 读回 tsx；迁移内嵌 tsx 的旧数据回填 tsxPath。 */
export async function hydrateTimelineCards(
  timeline: TimelineData,
  io: { readFile: (relPath: string) => Promise<string | null> },
): Promise<TimelineData> {
  const next = clone(timeline);
  for (const { overlayId, card } of eachMotionCard(next)) {
    if (card.tsxPath) {
      const src = await io.readFile(card.tsxPath);
      if (src != null) card.tsx = src;
      continue;
    }
    if (card.tsx?.trim()) {
      // 旧数据迁移：尚未外置，回填 tsxPath，保留内存 tsx（落盘时由 dehydrate 写出）。
      card.tsxPath = motionCardTsxPath(overlayId);
    }
  }
  return next;
}

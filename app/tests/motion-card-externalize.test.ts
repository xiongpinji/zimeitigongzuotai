import { describe, it, expect, vi } from 'vitest';
import {
  dehydrateTimelineCards,
  hydrateTimelineCards,
  motionCardTsxPath,
} from '../src/lib/motion-card-externalize';
import type { TimelineData } from '../src/types';

function timelineWithCard(motionCard: Record<string, unknown> | undefined): TimelineData {
  return {
    overlays: [
      {
        id: 'ov1',
        type: 'image',
        startMs: 0,
        durationMs: 1000,
        aiCardData: { renderMode: 'motion-card', motionCard } as never,
      } as never,
    ],
  } as never;
}

describe('motionCardTsxPath', () => {
  it('按 overlayId 生成相对路径', () => {
    expect(motionCardTsxPath('ov1')).toBe('ai-cards/ov1/motionCard.tsx');
  });
});

describe('dehydrateTimelineCards', () => {
  it('把内嵌 tsx 写到文件并替换为 tsxPath', async () => {
    const writes: Record<string, string> = {};
    const timeline = timelineWithCard({ tsx: 'export default ()=>null', compiledAt: 1, prompt: 'p', retryCount: 0 });
    const out = await dehydrateTimelineCards(timeline, {
      writeFile: async (rel, content) => { writes[rel] = content; },
    });
    const card = (out.overlays[0] as never as { aiCardData: { motionCard: Record<string, unknown> } }).aiCardData.motionCard;
    expect(card.tsx).toBeUndefined();
    expect(card.tsxPath).toBe('ai-cards/ov1/motionCard.tsx');
    expect(writes['ai-cards/ov1/motionCard.tsx']).toBe('export default ()=>null');
  });

  it('没有 tsx 的卡片不写文件、不加 tsxPath', async () => {
    const writeFile = vi.fn();
    const timeline = timelineWithCard({ compiledAt: 1, prompt: 'p', retryCount: 0 });
    const out = await dehydrateTimelineCards(timeline, { writeFile });
    expect(writeFile).not.toHaveBeenCalled();
    const card = (out.overlays[0] as never as { aiCardData: { motionCard: Record<string, unknown> } }).aiCardData.motionCard;
    expect(card.tsxPath).toBeUndefined();
  });
});

describe('hydrateTimelineCards', () => {
  it('据 tsxPath 读回 tsx', async () => {
    const timeline = timelineWithCard({ tsxPath: 'ai-cards/ov1/motionCard.tsx', compiledAt: 1, prompt: 'p', retryCount: 0 });
    const out = await hydrateTimelineCards(timeline, {
      readFile: async (rel) => (rel === 'ai-cards/ov1/motionCard.tsx' ? 'SRC' : null),
    });
    const card = (out.overlays[0] as never as { aiCardData: { motionCard: Record<string, unknown> } }).aiCardData.motionCard;
    expect(card.tsx).toBe('SRC');
  });

  it('迁移：内嵌 tsx 无 tsxPath 时回填 tsxPath（保持 tsx 供内存使用）', async () => {
    const timeline = timelineWithCard({ tsx: 'INLINE', compiledAt: 1, prompt: 'p', retryCount: 0 });
    const out = await hydrateTimelineCards(timeline, { readFile: async () => null });
    const card = (out.overlays[0] as never as { aiCardData: { motionCard: Record<string, unknown> } }).aiCardData.motionCard;
    expect(card.tsx).toBe('INLINE');
    expect(card.tsxPath).toBe('ai-cards/ov1/motionCard.tsx');
  });
});

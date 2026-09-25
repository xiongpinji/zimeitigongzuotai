import { describe, expect, it } from 'vitest';
import {
  planMotionConversion,
  mergeMotionConversionResult,
} from '../src/lib/ai-card-conversion';
import type { AIAnalysisResult, AICard, MediaCardContent } from '../src/types/ai';

function imageCard(overrides: Partial<AICard> = {}): AICard {
  const content: MediaCardContent = {
    mediaType: 'image',
    assetPath: 'ai-cards/c/image.png',
    aspectRatio: '16:9',
    prompt: '一只猫',
    providerId: null,
    model: null,
    generationStatus: 'ready',
  };
  return {
    id: 'card-1',
    segmentId: 'seg-1',
    type: 'image',
    title: '原标题',
    content,
    startMs: 1000,
    endMs: 4000,
    displayDurationMs: 3000,
    displayMode: 'fullscreen',
    template: 'image',
    enabled: true,
    style: {} as AICard['style'],
    renderMode: 'legacy',
    ...overrides,
  };
}

function analysis(): AIAnalysisResult {
  return {
    segments: [{ id: 'seg-1', title: 't', summary: 's', startMs: 1000, endMs: 4000 }],
    cards: [],
    coverPrompts: [],
    summary: '',
    keywords: [],
  };
}

describe('planMotionConversion', () => {
  it('已是 motion 家族 → noop', () => {
    expect(planMotionConversion(imageCard({ type: 'motion' }), analysis())).toEqual({
      kind: 'noop',
    });
  });

  it('命中背景段 → segment 路径', () => {
    const plan = planMotionConversion(imageCard(), analysis());
    expect(plan.kind).toBe('segment');
    if (plan.kind === 'segment') expect(plan.segment.id).toBe('seg-1');
  });

  it('无背景段（手动卡）→ subtitles 路径，draft 用 prompt/时间兜底', () => {
    const card = imageCard({ segmentId: 'manual:x', startMs: 0, endMs: 0, displayDurationMs: 5000 });
    const plan = planMotionConversion(card, analysis());
    expect(plan.kind).toBe('subtitles');
    if (plan.kind === 'subtitles') {
      expect(plan.draft.type).toBe('motion');
      expect(plan.draft.text).toBe('一只猫');
      expect(plan.draft.startMs).toBe(0);
      expect(plan.draft.endMs).toBe(5000); // start>=end → start + displayDurationMs
      expect(plan.draft.displayDurationMs).toBe(5000);
    }
  });
});

describe('mergeMotionConversionResult', () => {
  it('保留原 id/segmentId/时间/displayMode/enabled/title，接管 motion 字段', () => {
    const original = imageCard();
    const generated = imageCard({
      id: 'NEW',
      segmentId: 'manual-999',
      title: '生成标题',
      type: 'motion',
      content: '逐字稿文本',
      renderMode: 'motion-card',
      startMs: 0,
      endMs: 5000,
      displayDurationMs: 5000,
      motionCard: { tsx: 'export default () => null', compiledAt: 0, prompt: '', retryCount: 0 },
    });
    const merged = mergeMotionConversionResult(original, generated);
    expect(merged.id).toBe('card-1');
    expect(merged.segmentId).toBe('seg-1');
    expect(merged.title).toBe('原标题');
    expect(merged.startMs).toBe(1000);
    expect(merged.endMs).toBe(4000);
    expect(merged.displayMode).toBe('fullscreen');
    expect(merged.enabled).toBe(true);
    expect(merged.displayDurationMs).toBe(3000); // 原有效值优先
    expect(merged.type).toBe('motion');
    expect(merged.renderMode).toBe('motion-card');
    expect(merged.content).toBe('逐字稿文本');
    expect(merged.motionCard?.tsx).toContain('export default');
  });
});

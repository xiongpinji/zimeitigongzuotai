import { describe, expect, it } from 'vitest';
import { resolveAICardRenderPlan } from '../src/remotion/ai-card-render-plan';
import type { AICardOverlayData, MediaCardContent } from '../src/types/ai';

function mediaContent(overrides: Partial<MediaCardContent> = {}): MediaCardContent {
  return {
    mediaType: 'image',
    assetPath: 'ai-cards/card-1/image.png',
    aspectRatio: '16:9',
    prompt: 'p',
    providerId: null,
    model: null,
    generationStatus: 'ready',
    ...overrides,
  };
}

function card(overrides: Partial<AICardOverlayData> = {}): AICardOverlayData {
  return {
    cardType: 'image',
    title: '示例卡',
    content: mediaContent(),
    template: 'image-default',
    displayMode: 'fullscreen',
    style: { primaryColor: '#fff', backgroundColor: '#000', fontSize: 48 },
    renderMode: 'legacy',
    ...overrides,
  };
}

describe('resolveAICardRenderPlan', () => {
  it('renders an image media card from its assetPath instead of the card host', () => {
    const plan = resolveAICardRenderPlan(card(), undefined);
    expect(plan).toEqual({ kind: 'media', mediaType: 'image', assetPath: 'ai-cards/card-1/image.png' });
  });

  it('renders a video media card from its assetPath', () => {
    const plan = resolveAICardRenderPlan(
      card({ cardType: 'video', content: mediaContent({ mediaType: 'video', assetPath: 'ai-cards/c/v.mp4' }) }),
      undefined,
    );
    expect(plan).toEqual({ kind: 'media', mediaType: 'video', assetPath: 'ai-cards/c/v.mp4' });
  });

  it('falls back to a placeholder when the media asset has not been generated yet', () => {
    const plan = resolveAICardRenderPlan(
      card({ content: mediaContent({ assetPath: null, generationStatus: 'pending' }) }),
      undefined,
    );
    expect(plan.kind).toBe('placeholder');
  });

  it('renders a motion card via the card host when compiled JSX is available', () => {
    const plan = resolveAICardRenderPlan(
      card({
        cardType: 'motion',
        renderMode: 'motion-card',
        content: '',
        motionCard: { tsx: 'export default () => <AbsoluteFill>hi</AbsoluteFill>;' } as never,
      }),
      'compiled-js',
    );
    expect(plan).toEqual({ kind: 'card-host' });
  });

  it('renders a motion card with compiled output even when only tsxPath is present', () => {
    const plan = resolveAICardRenderPlan(
      card({
        cardType: 'motion',
        renderMode: 'motion-card',
        content: '',
        motionCard: { tsxPath: 'ai-cards/card-1/motionCard.tsx' } as never,
      }),
      'compiled-js',
    );
    expect(plan).toEqual({ kind: 'card-host' });
  });

  it('falls back to a placeholder for a motion card that is missing its compiled output', () => {
    const plan = resolveAICardRenderPlan(
      card({
        cardType: 'motion',
        renderMode: 'motion-card',
        content: '',
        motionCard: { tsx: 'export default () => <AbsoluteFill>hi</AbsoluteFill>;' } as never,
      }),
      undefined,
    );
    expect(plan.kind).toBe('placeholder');
  });

  it('falls back to a placeholder for legacy non-media cards', () => {
    const plan = resolveAICardRenderPlan(card({ cardType: 'summary', content: 'legacy text' }), undefined);
    expect(plan.kind).toBe('placeholder');
  });
});

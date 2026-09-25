import { describe, expect, it } from 'vitest';
import { parsePersistedAIState } from '../src/lib/ai-persistence';

function legacyMotionCard() {
  return {
    id: 'card-1',
    segmentId: 'seg-1',
    type: 'summary',
    title: '旧卡片',
    content: '内容',
    startMs: 0,
    endMs: 3000,
    displayDurationMs: 3000,
    displayMode: 'fullscreen',
    template: 'summary-default',
    enabled: true,
    renderMode: 'motion-card',
    motionCard: {
      html: '<div class="motion-card"><script>gsap.timeline()</script></div>',
      compiledAt: 1,
      prompt: 'p',
      retryCount: 0,
    },
    style: { primaryColor: '#fff', backgroundColor: '#000', fontSize: 48 },
  };
}

describe('legacy motion card migration', () => {
  it('marks old HTML+GSAP cards as needsRegeneration and preserves legacyHtml', () => {
    const persisted = {
      version: 3,
      analysisResult: {
        segments: [],
        cards: [legacyMotionCard()],
        coverPrompts: [],
        summary: '',
        keywords: [],
      },
      coverCandidates: [],
    };

    const parsed = parsePersistedAIState(persisted);
    expect(parsed).not.toBeNull();
    const card = parsed!.analysisResult!.cards[0];
    expect(card.motionCard?.needsRegeneration).toBe(true);
    expect(card.motionCard?.legacyHtml).toContain('gsap.timeline');
    expect(card.motionCard?.tsx).toBeFalsy();
  });

  it('leaves new TSX cards untouched', () => {
    const card = legacyMotionCard();
    (card.motionCard as Record<string, unknown>).tsx = 'export default () => null';
    delete (card.motionCard as Record<string, unknown>).html;
    const parsed = parsePersistedAIState({
      version: 3,
      analysisResult: { segments: [], cards: [card], coverPrompts: [], summary: '', keywords: [] },
      coverCandidates: [],
    });
    expect(parsed!.analysisResult!.cards[0].motionCard?.needsRegeneration).toBeFalsy();
  });
});

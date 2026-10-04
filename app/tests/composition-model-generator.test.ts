import { describe, expect, it, vi } from 'vitest';
import type { AISettings } from '../src/types/ai';
import { configuredCompositionModel } from '../electron/composition/model-generator';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/llm/model', () => ({
  createChatModelFromProvider: () => ({ invoke }),
}));

const settings = { defaultProviderId: 'local', defaultModel: 'synthetic-model',
  llmProviders: [{ id: 'local', name: 'Local', defaultModel: 'synthetic-model',
    models: ['synthetic-model'] }] } as unknown as AISettings;
const brief = { aspectRatio: '9:16' as const,
  highlights: [{ id: 'highlight-1', startMs: 1000, endMs: 3000,
    anonymousTopic: '匿名讲解', approvedTranscriptExcerpt: null }],
  assets: [{ id: 'asset-1', mediaType: 'video' as const, durationMs: 2000,
    anonymousDescription: '匿名产品画面' }] };

describe('R4 constrained model adapter', () => {
  it('sends only the explicitly approved brief and accepts strict JSON plans', async () => {
    invoke.mockResolvedValueOnce({ content: '{"plans":[{"narrativeSummary":"one"}]}' });
    const selected = configuredCompositionModel(settings);
    expect(selected.model).toBe('synthetic-model');
    expect(await selected.generate(brief)).toEqual([{ narrativeSummary: 'one' }]);
    const sent = JSON.stringify(invoke.mock.calls[0][0]);
    expect(sent).toContain('匿名讲解');
    expect(sent).toContain('asset-1');
    expect(sent).not.toContain('sourceRef');
    expect(sent).not.toContain('sha256');
    expect(sent).not.toContain('cookie');
  });

  it('returns invalid output for non-JSON responses and rejects missing configured models', async () => {
    invoke.mockResolvedValueOnce({ content: 'The result is a narrative.' });
    expect(await configuredCompositionModel(settings).generate(brief)).toBeNull();
    expect(() => configuredCompositionModel({ ...settings, defaultProviderId: 'missing' }))
      .toThrow('model_unavailable');
  });
});

import { describe, expect, it } from 'vitest';
import { getAgentPresentation, listAgentPresentations } from '../src/lib/agent-presentation';

describe('agent-presentation', () => {
  describe('listAgentPresentations', () => {
    it('pi presentation has non-empty models list', () => {
      const all = listAgentPresentations();
      const pi = all.find((p) => p.id === 'pi')!;
      expect(pi).toBeDefined();
      expect(pi.models).toBeDefined();
      expect(pi.models!.length).toBeGreaterThan(0);
    });

    it('only pi agent is listed', () => {
      const all = listAgentPresentations();
      expect(all.length).toBe(1);
      expect(all[0].id).toBe('pi');
    });
  });

  describe('getAgentPresentation', () => {
    it('pi presentation exposes models from runtime def', () => {
      const p = getAgentPresentation('pi');
      expect(p.models).toBeDefined();
      expect(p.models!.length).toBeGreaterThan(0);
      for (const m of p.models!) {
        expect(typeof m.id).toBe('string');
        expect(m.id.length).toBeGreaterThan(0);
        expect(typeof m.label).toBe('string');
        expect(m.label.length).toBeGreaterThan(0);
      }
    });

    it('pi presentation exposes defaultModel', () => {
      const p = getAgentPresentation('pi');
      expect(p.defaultModel).toBeDefined();
      const ids = p.models!.map((m) => m.id);
      expect(ids).toContain(p.defaultModel);
    });

    it('pi presentation exposes reasoningOptions + defaultReasoning', () => {
      const p = getAgentPresentation('pi');
      expect(p.reasoningOptions).toBeDefined();
      expect(p.reasoningOptions!.length).toBeGreaterThan(0);
      expect(p.defaultReasoning).toBe('default');
      for (const o of p.reasoningOptions!) {
        expect(typeof o.id).toBe('string');
        expect(typeof o.label).toBe('string');
      }
    });

    it('unknown id falls back to pi (the only agent)', () => {
      const p = getAgentPresentation('nonexistent-agent');
      expect(p.id).toBe('pi');
    });

    it('null/undefined id falls back to pi', () => {
      expect(getAgentPresentation(null).id).toBe('pi');
      expect(getAgentPresentation(undefined).id).toBe('pi');
    });
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_MIMO_STYLE, resolveMimoStyleInstruction } from '../src/lib/tts/mimo-style';
import type { UserPromptEntry } from '../src/lib/prompts/types';

const tpl = (ttsStyle?: string): UserPromptEntry => ({
  id: 'x', category: 'script-template', name: 'X', description: '', system: '', user: '{{rawText}}', isBuiltin: false, ttsStyle,
});

describe('resolveMimoStyleInstruction', () => {
  it('模板 ttsStyle 优先', () => {
    expect(resolveMimoStyleInstruction(tpl('沉稳清晰'))).toBe('沉稳清晰');
  });
  it('模板为空或缺失 → 默认人设', () => {
    expect(resolveMimoStyleInstruction(tpl('   '))).toBe(DEFAULT_MIMO_STYLE);
    expect(resolveMimoStyleInstruction(undefined)).toBe(DEFAULT_MIMO_STYLE);
  });
});

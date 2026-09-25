import { describe, expect, it } from 'vitest';
import {
  SCRIPT_TEMPLATE_SEEDS,
  getScriptTemplateSeedById,
} from '../src/lib/prompts/script-template-defaults';

describe('SCRIPT_TEMPLATE_SEEDS ttsStyle', () => {
  it('每个内置 seed 都带非空 ttsStyle 且 user 含 {{rawText}}', () => {
    expect(SCRIPT_TEMPLATE_SEEDS).toHaveLength(4);
    for (const seed of SCRIPT_TEMPLATE_SEEDS) {
      expect(typeof seed.ttsStyle).toBe('string');
      expect((seed.ttsStyle ?? '').trim().length).toBeGreaterThan(10);
      expect(seed.user).toContain('{{rawText}}');
      expect(seed.category).toBe('script-template');
    }
  });

  it('内置二创转述模板 rewrite-remix 存在且 system 强调二创/洗稿', () => {
    const seed = getScriptTemplateSeedById('rewrite-remix');
    expect(seed).toBeDefined();
    expect(seed?.name).toBe('二创转述');
    // 明确要求不照抄、洗稿去冗
    expect(seed?.system).toMatch(/二创|搬运|照抄|洗稿/);
  });
});

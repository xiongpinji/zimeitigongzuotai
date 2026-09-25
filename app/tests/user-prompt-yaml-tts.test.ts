import { describe, expect, it } from 'vitest';
import { parseUserPromptYaml, serializeUserPromptYaml } from '../src/lib/prompts/render';

describe('user-prompt YAML 保留 TTS 字段', () => {
  it('serialize → parse 往返保留 ttsStyle / ttsAnnotateHint', () => {
    const yaml = serializeUserPromptYaml({
      name: '一叶知秋', description: 'd', system: 's', user: '{{rawText}}',
      ttsStyle: '沉稳清晰有温度', ttsAnnotateHint: '多停顿',
    });
    const entry = parseUserPromptYaml(yaml, { id: 'yzq', category: 'script-template' });
    expect(entry.ttsStyle).toBe('沉稳清晰有温度');
    expect(entry.ttsAnnotateHint).toBe('多停顿');
  });

  it('旧 YAML 无 TTS 字段时不报错且为 undefined', () => {
    const entry = parseUserPromptYaml('name: A\nuser: "{{rawText}}"\n', { id: 'a', category: 'script-template' });
    expect(entry.ttsStyle).toBeUndefined();
    expect(entry.ttsAnnotateHint).toBeUndefined();
  });
});

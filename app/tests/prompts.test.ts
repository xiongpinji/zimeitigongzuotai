import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPT_YAML,
  PROMPT_KINDS,
  PROMPT_KIND_META,
  getBuiltinPromptTemplate,
  parsePromptYaml,
  renderTemplate,
  renderUserPromptWithLock,
  serializePromptYaml,
} from '../src/lib/prompts';

describe('renderTemplate', () => {
  it('replaces {{var}} placeholders', () => {
    expect(renderTemplate('hello {{name}}', { name: 'world' })).toBe('hello world');
  });

  it('replaces missing vars with empty string', () => {
    expect(renderTemplate('a={{a}}, b={{b}}', { a: 'x' })).toBe('a=x, b=');
  });

  it('handles whitespace inside braces', () => {
    expect(renderTemplate('x={{ x }}', { x: '1' })).toBe('x=1');
  });

  it('coerces non-string values', () => {
    expect(renderTemplate('count={{n}}', { n: 42 })).toBe('count=42');
  });

  it('leaves no placeholders when value contains other braces', () => {
    expect(renderTemplate('{{a}}', { a: '{{b}}' })).toBe('{{b}}');
  });
});

describe('parsePromptYaml', () => {
  it('parses a minimal valid YAML', () => {
    const { template } = parsePromptYaml(
      'name: x\nuser: |-\n  hi {{name}}\n',
      'planning.segment',
    );
    expect(template.name).toBe('x');
    expect(template.user).toBe('hi {{name}}');
  });

  it('throws when user field is missing or empty', () => {
    expect(() => parsePromptYaml('name: x\nuser: ""\n', 'planning.segment')).toThrow();
  });

  it('throws on invalid YAML', () => {
    expect(() => parsePromptYaml('::: not yaml', 'planning.segment')).toThrow();
  });
});

describe('serializePromptYaml round-trip', () => {
  it('serializes and re-parses to equivalent template', () => {
    const original = parsePromptYaml(DEFAULT_PROMPT_YAML['planning.segment'], 'planning.segment').template;
    const yamlText = serializePromptYaml(original);
    const reparsed = parsePromptYaml(yamlText, 'planning.segment').template;
    expect(reparsed.name).toBe(original.name);
    expect(reparsed.user).toBe(original.user);
  });
});

describe('PROMPT_KINDS and metadata', () => {
  it('every kind has metadata and a default YAML', () => {
    for (const kind of PROMPT_KINDS) {
      expect(PROMPT_KIND_META[kind]).toBeDefined();
      expect(DEFAULT_PROMPT_YAML[kind]).toBeTruthy();
    }
  });

  it('every default YAML parses cleanly', () => {
    for (const kind of PROMPT_KINDS) {
      const tpl = getBuiltinPromptTemplate(kind);
      expect(tpl.user).toBeTruthy();
    }
  });
});

describe('cards.animation default template', () => {
  it('has a builtin template mentioning 逐拍 and segmentCues', () => {
    const tpl = getBuiltinPromptTemplate('cards.animation');
    expect(tpl.user).toContain('{{segmentCues}}');
    expect(tpl.user).toContain('逐拍');
  });
  it('cards.segment template exposes an animationDirection injection point', () => {
    const seg = getBuiltinPromptTemplate('cards.segment');
    expect(seg.user).toContain('{{animationDirection}}');
  });
});

describe('renderUserPromptWithLock', () => {
  it('appends lockedContract.content to user-tail when declared', () => {
    const tpl = getBuiltinPromptTemplate('script.review');
    const rendered = renderUserPromptWithLock('script.review', tpl, {
      scriptText: '这是一段测试稿件。',
    });
    expect(rendered).toContain('这是一段测试稿件。');
    expect(rendered).toContain('【系统契约 · 不可修改】');
    expect(rendered).toContain('annotations');
    expect(rendered).toContain('severity');
  });

  it('locked content is kind-specific', () => {
    const planning = renderUserPromptWithLock(
      'planning.segment',
      getBuiltinPromptTemplate('planning.segment'),
      { globalPromptLine: '' },
    );
    expect(planning).toContain('segments');
    expect(planning).toContain('semanticType');
    expect(planning).not.toContain('webCard');

    const cards = renderUserPromptWithLock(
      'cards.segment',
      getBuiltinPromptTemplate('cards.segment'),
      {
        globalPrompt: '无',
        programSummary: '无',
        keywords: '无',
        segmentId: 's1',
        segmentTitle: '标题',
        segmentSummary: '摘要',
        segmentStartMs: 0,
        segmentEndMs: 1000,
        segmentTranscriptExcerpt: '原文',
        cardPrompt: '无',
        currentCardSection: '当前卡片线索：无',
        programContext: '节目级浓缩上下文',
        sandboxReference: '沙箱 API 示例',
      },
    );
    // 卡片生成链路已收敛到 Motion Card（TSX-only 输出）：契约段必须要求 tsx 代码块 + export default
    expect(cards).toContain('tsx');
    expect(cards).toContain('export default');
    expect(cards).toContain('useCurrentFrame');
    expect(cards).not.toContain('webCard');
  });
});

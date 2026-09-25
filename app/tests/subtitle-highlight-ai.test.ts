import { describe, expect, it } from 'vitest';
import type { SrtEntry } from '../src/types';
import {
  buildSubtitleHighlightSystemPrompt,
  buildSubtitleHighlightUserMessage,
} from '../src/lib/subtitle-highlight-ai';

function createEntry(index: number, text: string): SrtEntry {
  return {
    index,
    startMs: (index - 1) * 2_000,
    endMs: index * 2_000,
    text,
  };
}

describe('subtitle highlight ai prompt builders', () => {
  it('builds a system prompt with strict highlight constraints', () => {
    const prompt = buildSubtitleHighlightSystemPrompt();

    expect(prompt).toContain('严格 JSON');
    expect(prompt).toContain('每条字幕最多高亮 1 段');
    expect(prompt).toContain('end 为 exclusive');
    expect(prompt).toContain('不负责颜色、字号、位置、动效');
    expect(prompt).toContain('没有明确重点时返回 shouldHighlight=false');
  });

  it('builds a user message with subtitle context and no style instructions', () => {
    const message = buildSubtitleHighlightUserMessage([
      createEntry(1, '中国品牌完成第一次突破'),
      createEntry(2, '今天最关键的词是世界冠军'),
      createEntry(3, '这个结果改写了行业判断'),
    ]);

    expect(message).toContain('entryIndex');
    expect(message).toContain('中国品牌完成第一次突破');
    expect(message).toContain('今天最关键的词是世界冠军');
    expect(message).toContain('这个结果改写了行业判断');
    expect(message).not.toContain('高亮底色');
    expect(message).not.toContain('字号');
  });
});

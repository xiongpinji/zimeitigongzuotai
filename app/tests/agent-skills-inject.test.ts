import { describe, it, expect } from 'vitest';
import { parseSkillTokens, buildInjectionText } from '../electron/agent-skills/inject';

describe('parseSkillTokens', () => {
  it('提取 $id 并去重保序', () => {
    expect(parseSkillTokens('用 $lingji-video-workflow 再 $lingji-video-workflow 一次'))
      .toEqual(['lingji-video-workflow']);
  });
  it('多个不同 token 保序', () => {
    expect(parseSkillTokens('$a-b then $c')).toEqual(['a-b', 'c']);
  });
  it('无 token 返回空数组', () => {
    expect(parseSkillTokens('普通消息没有美元符号')).toEqual([]);
  });
});

describe('buildInjectionText', () => {
  it('把 SKILL.md 拼到用户消息之前', () => {
    const out = buildInjectionText(
      [{ id: 'lingji-video-workflow', markdown: 'SKILL BODY' }],
      '帮我把稿件做成视频',
    );
    expect(out).toContain('The user explicitly invoked these skills:');
    expect(out).toContain('$lingji-video-workflow');
    expect(out).toContain('--- skill: lingji-video-workflow ---');
    expect(out).toContain('SKILL BODY');
    expect(out).toContain('--- end skill ---');
    expect(out.indexOf('SKILL BODY')).toBeLessThan(out.indexOf('帮我把稿件做成视频'));
    expect(out).toContain('User message:\n帮我把稿件做成视频');
  });
});

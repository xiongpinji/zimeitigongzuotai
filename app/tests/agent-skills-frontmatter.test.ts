import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../electron/agent-skills/frontmatter';

describe('parseFrontmatter', () => {
  it('解析 name 与多行 description', () => {
    const raw = [
      '---',
      'name: lingji-video-workflow',
      'description: >-',
      '  line one',
      '  line two',
      '---',
      '',
      '# Body',
    ].join('\n');
    const fm = parseFrontmatter(raw);
    expect(fm).not.toBeNull();
    expect(fm?.name).toBe('lingji-video-workflow');
    expect(fm?.description).toContain('line one');
    expect(fm?.description).toContain('line two');
  });

  it('解析 version（数字或字符串归一为字符串）', () => {
    expect(parseFrontmatter('---\nname: s\nversion: 2\n---\n')?.version).toBe('2');
    expect(parseFrontmatter('---\nname: s\nversion: "1.3.0"\n---\n')?.version).toBe('1.3.0');
  });

  it('无 version 时为 undefined', () => {
    expect(parseFrontmatter('---\nname: s\n---\n')?.version).toBeUndefined();
  });

  it('无 frontmatter 返回 null', () => {
    expect(parseFrontmatter('# just a title\n')).toBeNull();
  });

  it('frontmatter 不可解析返回 null', () => {
    expect(parseFrontmatter('---\n: : bad yaml :\n---\n')).toBeNull();
  });
});

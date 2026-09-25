import { describe, expect, it } from 'vitest';
import { isInsideDir } from '../../src/lib/publish/resolve-video-file';

describe('isInsideDir', () => {
  it('成片在项目目录内 → true', () => {
    expect(isInsideDir('/projects/a/export.mp4', '/projects/a')).toBe(true);
    expect(isInsideDir('/projects/a/sub/export.mp4', '/projects/a')).toBe(true);
    expect(isInsideDir('/projects/a/', '/projects/a')).toBe(true);
  });

  it('上一个项目的成片不被当前项目串用 → false', () => {
    expect(isInsideDir('/projects/a/export.mp4', '/projects/b')).toBe(false);
    // 前缀相近但非子目录（a-old vs a）不得误判
    expect(isInsideDir('/projects/a-old/export.mp4', '/projects/a')).toBe(false);
  });

  it('兼容 Windows 反斜杠分隔符', () => {
    expect(isInsideDir('C:\\projects\\a\\export.mp4', 'C:\\projects\\a')).toBe(true);
    expect(isInsideDir('C:\\projects\\b\\export.mp4', 'C:\\projects\\a')).toBe(false);
  });

  it('空值安全', () => {
    expect(isInsideDir('', '/projects/a')).toBe(false);
    expect(isInsideDir('/projects/a/x.mp4', '')).toBe(false);
  });
});

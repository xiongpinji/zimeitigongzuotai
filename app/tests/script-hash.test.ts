import { describe, expect, it } from 'vitest';
import { hashScriptForPodcast } from '../src/lib/script-hash';

describe('hashScriptForPodcast', () => {
  it('相同文稿内容产生相同哈希', () => {
    const text = '大家好\n这是一段口播稿\n结束';
    expect(hashScriptForPodcast(text)).toBe(hashScriptForPodcast(text));
  });

  it('不同文稿内容产生不同哈希', () => {
    const a = '大家好，今天讲 A 主题';
    const b = '大家好，今天讲 B 主题';
    expect(hashScriptForPodcast(a)).not.toBe(hashScriptForPodcast(b));
  });

  it('换行符差异（\\r\\n 与 \\n）不影响哈希', () => {
    const unix = 'line 1\nline 2\nline 3';
    const windows = 'line 1\r\nline 2\r\nline 3';
    expect(hashScriptForPodcast(unix)).toBe(hashScriptForPodcast(windows));
  });

  it('首尾空白与行尾空白被归一化忽略', () => {
    const a = '段落一\n段落二';
    const b = '  段落一   \n段落二   \n\n';
    expect(hashScriptForPodcast(a)).toBe(hashScriptForPodcast(b));
  });

  it('连续多空行折叠为双空行，不影响哈希判等', () => {
    const a = '段落一\n\n段落二';
    const b = '段落一\n\n\n\n段落二';
    expect(hashScriptForPodcast(a)).toBe(hashScriptForPodcast(b));
  });

  it('null / undefined / 空串哈希一致', () => {
    expect(hashScriptForPodcast(null)).toBe(hashScriptForPodcast(''));
    expect(hashScriptForPodcast(undefined)).toBe(hashScriptForPodcast(''));
  });

  it('内容中一个字符差异会改变哈希', () => {
    const a = '这是一段足够长的口播文稿内容示例';
    const b = '这是一段足够长的口播文稿内容实例';
    expect(hashScriptForPodcast(a)).not.toBe(hashScriptForPodcast(b));
  });

  it('输出格式形如 "长度:十六进制"', () => {
    const hash = hashScriptForPodcast('abc');
    expect(hash).toMatch(/^\d+:[0-9a-f]+$/);
  });
});

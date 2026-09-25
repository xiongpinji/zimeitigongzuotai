import { describe, it, expect } from 'vitest';
import { buildSubtitlesFromWordTimestamps } from '../src/lib/subtitle-builder';
import type { WordTimestamp } from '../src/types';

describe('buildSubtitlesFromWordTimestamps', () => {
  it('空输入返回空数组', () => {
    const result = buildSubtitlesFromWordTimestamps([], 0);
    expect(result).toEqual([]);
  });

  it('按中文标点切分 - "你好，世界" 应得 2 条字幕', () => {
    const timestamps: WordTimestamp[] = [
      { text: '你', startMs: 0, endMs: 50 },
      { text: '好', startMs: 50, endMs: 150 },
      { text: '，', startMs: 150, endMs: 250 },
      { text: '世', startMs: 250, endMs: 350 },
      { text: '界', startMs: 350, endMs: 450 },
    ];
    const result = buildSubtitlesFromWordTimestamps(timestamps, 0);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('你好，');
    expect(result[0].startMs).toBe(0);
    expect(result[0].endMs).toBe(250);
    expect(result[1].text).toBe('世界');
    expect(result[1].startMs).toBe(250);
    expect(result[1].endMs).toBe(450);
  });

  it('支持多种中英文标点切分', () => {
    const punctuations = ['，', '。', '？', '！', ',', '.', '?', '!', '；', ';', '：', ':'];
    for (const p of punctuations) {
      const timestamps: WordTimestamp[] = [
        { text: 'a', startMs: 0, endMs: 100 },
        { text: p, startMs: 100, endMs: 200 },
        { text: 'b', startMs: 200, endMs: 300 },
      ];
      const result = buildSubtitlesFromWordTimestamps(timestamps, 0);
      expect(result, `punctuation: ${p}`).toHaveLength(2);
      expect(result[0].text).toBe(`a${p}`);
      expect(result[1].text).toBe('b');
    }
  });

  it('offsetMs 被加到所有时间戳上', () => {
    const timestamps: WordTimestamp[] = [
      { text: '你', startMs: 0, endMs: 50 },
      { text: '好', startMs: 50, endMs: 150 },
      { text: '，', startMs: 150, endMs: 250 },
      { text: '世', startMs: 250, endMs: 350 },
      { text: '界', startMs: 350, endMs: 450 },
    ];
    const offset = 1000;
    const result = buildSubtitlesFromWordTimestamps(timestamps, offset);
    expect(result).toHaveLength(2);
    expect(result[0].startMs).toBe(0 + offset);
    expect(result[0].endMs).toBe(250 + offset);
    expect(result[1].startMs).toBe(250 + offset);
    expect(result[1].endMs).toBe(450 + offset);
  });

  it('无标点时字数 ≥20 强制切分', () => {
    const timestamps: WordTimestamp[] = [];
    // 25 个无标点字符，每个间隔 50ms（远小于 3000ms 阈值）
    for (let i = 0; i < 25; i++) {
      timestamps.push({ text: 'x', startMs: i * 50, endMs: (i + 1) * 50 });
    }
    const result = buildSubtitlesFromWordTimestamps(timestamps, 0);
    // 第 20 个字符触发 flush，剩余 5 个字符再一条
    expect(result).toHaveLength(2);
    expect(result[0].text.length).toBe(20);
    expect(result[1].text.length).toBe(5);
  });

  it('无标点时 bucket 时长 ≥3000ms 强制切分', () => {
    const timestamps: WordTimestamp[] = [
      { text: 'a', startMs: 0, endMs: 1000 },
      { text: 'b', startMs: 1000, endMs: 2000 },
      { text: 'c', startMs: 2000, endMs: 3500 }, // bucket 时长 3500ms 触发
      { text: 'd', startMs: 3500, endMs: 4000 },
    ];
    const result = buildSubtitlesFromWordTimestamps(timestamps, 0);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('abc');
    expect(result[0].startMs).toBe(0);
    expect(result[0].endMs).toBe(3500);
    expect(result[1].text).toBe('d');
  });

  it('返回的每个 SrtEntry.index 是 number 类型', () => {
    const timestamps: WordTimestamp[] = [
      { text: '你', startMs: 0, endMs: 50 },
      { text: '好', startMs: 50, endMs: 150 },
      { text: '，', startMs: 150, endMs: 250 },
      { text: '世', startMs: 250, endMs: 350 },
      { text: '界', startMs: 350, endMs: 450 },
    ];
    const result = buildSubtitlesFromWordTimestamps(timestamps, 0);
    for (const entry of result) {
      expect(typeof entry.index).toBe('number');
    }
  });
});

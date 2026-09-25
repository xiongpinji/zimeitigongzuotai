import { describe, expect, it } from 'vitest';
import { splitIntoSentences } from '../src/lib/tts/sentence-split';

describe('splitIntoSentences', () => {
  it('按中文句末标点切分并保留标点', () => {
    expect(splitIntoSentences('你好。今天聊存储！为什么呢？')).toEqual([
      '你好。',
      '今天聊存储！',
      '为什么呢？',
    ]);
  });

  it('把换行/空行归一为不产生空句', () => {
    expect(splitIntoSentences('第一段。\n\n第二段。')).toEqual(['第一段。', '第二段。']);
  });

  it('处理中英混排与省略号', () => {
    const out = splitIntoSentences('这是 SSD……很快。It is fast.');
    expect(out).toEqual(['这是 SSD……很快。', 'It is fast.']);
  });

  it('无句末标点时整体作为一句', () => {
    expect(splitIntoSentences('没有标点的一段话')).toEqual(['没有标点的一段话']);
  });

  it('空白输入返回空数组', () => {
    expect(splitIntoSentences('   \n\n ')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { markSelfWrite, consumeSelfWrite } from '../electron/ai-edit/self-write-guard';

describe('self-write-guard', () => {
  it('相同内容判为自写并一次性消费', () => {
    markSelfWrite('/p/project.json', 'X');
    expect(consumeSelfWrite('/p/project.json', 'X')).toBe(true);
    // 已消费，第二次不再命中
    expect(consumeSelfWrite('/p/project.json', 'X')).toBe(false);
  });
  it('不同内容不判为自写（真实外部编辑放行）', () => {
    markSelfWrite('/p/project.json', 'X');
    expect(consumeSelfWrite('/p/project.json', 'Y')).toBe(false);
  });
  it('未记录的路径不判为自写', () => {
    expect(consumeSelfWrite('/p/other.json', 'Z')).toBe(false);
  });

  it('同一路径连续多次自写都能被各自消费（防单槽击穿回环）', () => {
    // timeline 段 + aiAnalysis 段会先后回写同一个 project.json，
    // 若只保留最后一次记录，前一次的 chokidar 回声会被误判为外部编辑并触发 watch⇄autosave 死循环。
    markSelfWrite('/p/multi.json', 'A');
    markSelfWrite('/p/multi.json', 'B');
    expect(consumeSelfWrite('/p/multi.json', 'A')).toBe(true);
    expect(consumeSelfWrite('/p/multi.json', 'B')).toBe(true);
    // 都已消费，不再命中
    expect(consumeSelfWrite('/p/multi.json', 'A')).toBe(false);
    expect(consumeSelfWrite('/p/multi.json', 'B')).toBe(false);
  });

  it('同内容写两次可被消费两次（chokidar 未合并的重复回声）', () => {
    markSelfWrite('/p/dup.json', 'X');
    markSelfWrite('/p/dup.json', 'X');
    expect(consumeSelfWrite('/p/dup.json', 'X')).toBe(true);
    expect(consumeSelfWrite('/p/dup.json', 'X')).toBe(true);
    expect(consumeSelfWrite('/p/dup.json', 'X')).toBe(false);
  });
});

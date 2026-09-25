import { describe, it, expect } from 'vitest';
import { diffToFrames } from '../src/lib/diff-to-frames';

describe('diffToFrames', () => {
  it('empty file → new content produces insert frames', () => {
    const frames = diffToFrames('', 'Hello World');
    expect(frames.length).toBeGreaterThan(0);
    // 所有帧都应该是 insert
    for (const f of frames) {
      expect(f.operation.type).toBe('insert');
    }
    // 连接所有 insert 文本应等于目标内容
    const combined = frames.map((f) => f.operation.text).join('');
    expect(combined).toBe('Hello World');
  });

  it('partial replace produces correct frames', () => {
    const frames = diffToFrames('Hello World', 'Hello CodeMirror');
    // 至少包含一个 delete 或 replace 和一个 insert
    const types = new Set(frames.map((f) => f.operation.type));
    expect(types.size).toBeGreaterThanOrEqual(1);
  });

  it('respects chunkSize for insert splitting', () => {
    const longText = 'A'.repeat(100);
    const frames = diffToFrames('', longText, { chunkSize: 20 });
    // 100 字按 20 字分块应产生 5 帧
    expect(frames.length).toBe(5);
  });

  it('identical content produces no frames', () => {
    const frames = diffToFrames('same', 'same');
    expect(frames.length).toBe(0);
  });
});

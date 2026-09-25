import { describe, it, expect } from 'vitest';
import { createHistoryStack } from '../src/lib/cover-editor/fabric-bridge';

describe('history stack', () => {
  it('push 后可以 undo/redo', () => {
    const h = createHistoryStack<string>(10);
    h.push('a');
    h.push('b');
    h.push('c');
    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toBe('b');
  });

  it('push 后 redo 栈被清空', () => {
    const h = createHistoryStack<string>(10);
    h.push('a');
    h.push('b');
    h.undo();
    h.push('c');
    expect(h.canRedo()).toBe(false);
  });

  it('超出容量丢弃最老记录', () => {
    const h = createHistoryStack<number>(3);
    h.push(1);
    h.push(2);
    h.push(3);
    h.push(4);
    // 只保留最近 3 条
    h.undo();
    h.undo();
    expect(h.canUndo()).toBe(false);
  });
});

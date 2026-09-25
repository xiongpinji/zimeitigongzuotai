// tests/virtual-cursor.test.ts
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  virtualCursorField,
  setVirtualCursor,
  clearVirtualCursor,
} from '../src/lib/virtual-cursor';

describe('VirtualCursor', () => {
  function createState(doc = 'Hello World') {
    return EditorState.create({ doc, extensions: [virtualCursorField] });
  }

  it('initially has no virtual cursor', () => {
    const state = createState();
    expect(state.field(virtualCursorField)).toBe(null);
  });

  it('setVirtualCursor places cursor at position', () => {
    const state = createState();
    const next = state.update({ effects: setVirtualCursor.of(5) }).state;
    expect(next.field(virtualCursorField)).toBe(5);
  });

  it('clearVirtualCursor removes cursor', () => {
    const state = createState();
    const withCursor = state.update({ effects: setVirtualCursor.of(5) }).state;
    const cleared = withCursor.update({ effects: clearVirtualCursor.of(null) }).state;
    expect(cleared.field(virtualCursorField)).toBe(null);
  });

  it('maps cursor position when document changes', () => {
    const state = createState('Hello World');
    // 光标设在位置 5（'H' 后的空格之前）
    const withCursor = state.update({ effects: setVirtualCursor.of(5) }).state;
    // 在位置 0 插入 "Hi "（3 个字符），光标应从 5 -> 8
    const edited = withCursor.update({
      changes: { from: 0, insert: 'Hi ' },
    }).state;
    expect(edited.field(virtualCursorField)).toBe(8);
  });

  it('does not change cursor when document changes if cursor is null', () => {
    const state = createState('Hello World');
    const edited = state.update({
      changes: { from: 0, insert: 'Hi ' },
    }).state;
    expect(edited.field(virtualCursorField)).toBe(null);
  });
});

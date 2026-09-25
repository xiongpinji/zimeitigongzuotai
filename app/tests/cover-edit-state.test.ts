import { describe, it, expect } from 'vitest';
import {
  createEmptyEditState,
  mergeTextOverlay,
  normalizeEditState,
} from '../src/lib/cover-editor/cover-edit-state';

describe('cover-edit-state', () => {
  it('createEmptyEditState 返回 version 1', () => {
    expect(createEmptyEditState().version).toBe(1);
  });

  it('mergeTextOverlay 新增图层', () => {
    const base = createEmptyEditState();
    const next = mergeTextOverlay(base, {
      id: 't1',
      text: 'Hello',
      x: 10,
      y: 20,
      fontSize: 48,
      fontFamily: 'Arial',
      color: '#fff',
    });
    expect(next.textOverlays).toHaveLength(1);
    expect(next.textOverlays?.[0].text).toBe('Hello');
  });

  it('mergeTextOverlay 更新既有图层', () => {
    const base = mergeTextOverlay(createEmptyEditState(), {
      id: 't1', text: 'a', x: 0, y: 0, fontSize: 24, fontFamily: 'Arial', color: '#000',
    });
    const next = mergeTextOverlay(base, {
      id: 't1', text: 'b', x: 0, y: 0, fontSize: 24, fontFamily: 'Arial', color: '#000',
    });
    expect(next.textOverlays).toHaveLength(1);
    expect(next.textOverlays?.[0].text).toBe('b');
  });

  it('normalizeEditState 兜住缺失字段', () => {
    const normalized = normalizeEditState({ version: 1 });
    expect(normalized.textOverlays).toEqual([]);
    expect(normalized.filters?.preset).toBe('none');
  });
});

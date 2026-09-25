import { describe, expect, it, vi } from 'vitest';
import { replaceEditorContent } from '../src/lib/editor-document';

vi.mock('../src/lib/virtual-cursor', () => ({
  setVirtualCursor: { of: (value: number) => ({ type: 'setVirtualCursor', value }) },
  clearVirtualCursor: { of: (_value: null) => ({ type: 'clearVirtualCursor' }) },
}));

function makeMockView(initialDoc = '') {
  let doc = initialDoc;
  const view = {
    state: {
      doc: {
        get length() {
          return doc.length;
        },
        toString: () => doc,
      },
    },
    dispatch: vi.fn((spec: any) => {
      if (spec.changes) {
        const { from, to, insert } = spec.changes;
        doc = doc.slice(0, from) + (insert ?? '') + doc.slice(to ?? from);
      }
    }),
  };
  return view;
}

describe('replaceEditorContent', () => {
  it('replaces the whole editor document with empty content for fresh streaming', () => {
    const view = makeMockView('旧的脚本文稿');

    replaceEditorContent(view as any, '', { cursorPos: 0 });

    expect(view.state.doc.toString()).toBe('');
    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { from: 0, to: '旧的脚本文稿'.length, insert: '' },
        scrollIntoView: true,
      }),
    );
  });

  it('can replace the whole editor document with new content', () => {
    const view = makeMockView('before');

    replaceEditorContent(view as any, 'after');

    expect(view.state.doc.toString()).toBe('after');
  });
});

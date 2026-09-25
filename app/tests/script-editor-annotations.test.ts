import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  annotationField,
  setAnnotationsEffect,
  findAnnotationAtPos,
} from '../src/ui/components/script-editor-annotations';
import type { Annotation } from '../src/store/script';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    startOffset: 6,
    endOffset: 11,
    originalText: 'world',
    issue: '建议修改',
    suggestion: '世界',
    severity: 'warning',
    status: 'pending',
    ...overrides,
  };
}

describe('findAnnotationAtPos', () => {
  it('returns annotation when pos is within range', () => {
    const ann = makeAnnotation();
    expect(findAnnotationAtPos([ann], 8)).toBe(ann);
  });

  it('returns annotation at boundary positions (half-open range)', () => {
    const ann = makeAnnotation({ startOffset: 6, endOffset: 11 });
    expect(findAnnotationAtPos([ann], 6)).toBe(ann);    // start is inclusive
    expect(findAnnotationAtPos([ann], 10)).toBe(ann);   // last char is inclusive
    expect(findAnnotationAtPos([ann], 11)).toBeNull();   // endOffset is exclusive
  });

  it('returns null when pos is outside all annotations', () => {
    const ann = makeAnnotation();
    expect(findAnnotationAtPos([ann], 12)).toBeNull();
  });

  it('skips non-pending annotations', () => {
    const ann = makeAnnotation({ status: 'accepted' });
    expect(findAnnotationAtPos([ann], 8)).toBeNull();
  });

  it('returns first matching annotation when multiple overlap', () => {
    const ann1 = makeAnnotation({ id: 'a1', startOffset: 0, endOffset: 10 });
    const ann2 = makeAnnotation({ id: 'a2', startOffset: 5, endOffset: 15 });
    const result = findAnnotationAtPos([ann1, ann2], 7);
    expect(result?.id).toBe('a1');
  });
});

describe('annotationField', () => {
  it('starts with empty state', () => {
    const state = EditorState.create({
      doc: 'hello world test',
      extensions: [annotationField],
    });
    const field = state.field(annotationField);
    expect(field.annotations).toEqual([]);
    expect(field.decorations.size).toBe(0);
  });

  it('builds decorations from setAnnotationsEffect', () => {
    const state = EditorState.create({
      doc: 'hello world test',
      extensions: [annotationField],
    });
    const ann = makeAnnotation({ startOffset: 6, endOffset: 11 });
    const tr = state.update({ effects: setAnnotationsEffect.of([ann]) });
    const field = tr.state.field(annotationField);

    expect(field.annotations).toHaveLength(1);
    expect(field.decorations.size).toBe(1);
  });

  it('skips annotations beyond document length', () => {
    const state = EditorState.create({
      doc: 'short',
      extensions: [annotationField],
    });
    const ann = makeAnnotation({ startOffset: 100, endOffset: 110 });
    const tr = state.update({ effects: setAnnotationsEffect.of([ann]) });

    expect(tr.state.field(annotationField).decorations.size).toBe(0);
  });

  it('skips accepted/dismissed annotations', () => {
    const state = EditorState.create({
      doc: 'hello world test',
      extensions: [annotationField],
    });
    const ann = makeAnnotation({ status: 'dismissed' });
    const tr = state.update({ effects: setAnnotationsEffect.of([ann]) });

    expect(tr.state.field(annotationField).decorations.size).toBe(0);
  });

  it('remaps decoration positions on document change (user typing)', () => {
    let state = EditorState.create({
      doc: 'hello world test',
      extensions: [annotationField],
    });
    const ann = makeAnnotation({ startOffset: 6, endOffset: 11 });
    state = state.update({ effects: setAnnotationsEffect.of([ann]) }).state;

    // Insert text before annotation — decorations should remap via map()
    const tr = state.update({ changes: { from: 0, to: 0, insert: 'XX' } });
    expect(tr.state.field(annotationField).decorations.size).toBe(1);
  });
});

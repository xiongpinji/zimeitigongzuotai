import { StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
} from '@codemirror/view';
import type { Annotation, AnnotationSeverity } from '../../store/script';

// --- StateEffect: push annotations from React into CM6 ---

export const setAnnotationsEffect = StateEffect.define<Annotation[]>();

// --- Decoration builders ---

const SEVERITY_CLASS: Record<AnnotationSeverity, string> = {
  error: 'cm-annotation-error',
  warning: 'cm-annotation-warning',
  info: 'cm-annotation-info',
};

function buildDecorations(
  annotations: Annotation[],
  docLength: number,
): DecorationSet {
  const ranges = annotations
    .filter(
      (a) =>
        a.status === 'pending' &&
        a.startOffset < a.endOffset &&
        a.startOffset < docLength &&
        a.endOffset <= docLength,
    )
    .sort((a, b) => a.startOffset - b.startOffset)
    .map((a) =>
      Decoration.mark({
        class: SEVERITY_CLASS[a.severity],
        attributes: { 'data-annotation-id': a.id },
      }).range(a.startOffset, a.endOffset),
    );

  return Decoration.set(ranges);
}

// --- StateField: annotations + decorations ---

interface AnnotationState {
  annotations: Annotation[];
  decorations: DecorationSet;
}

export const annotationField = StateField.define<AnnotationState>({
  create() {
    return { annotations: [], decorations: Decoration.none };
  },
  update(state, tr) {
    // 1. Effect update: full rebuild from new annotations
    for (const effect of tr.effects) {
      if (effect.is(setAnnotationsEffect)) {
        return {
          annotations: effect.value,
          decorations: buildDecorations(effect.value, tr.state.doc.length),
        };
      }
    }

    // 2. Doc change (user typing): remap existing decorations via map()
    if (tr.docChanged) {
      return {
        annotations: state.annotations,
        decorations: state.decorations.map(tr.changes),
      };
    }

    return state;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

// --- Position lookup ---

export function findAnnotationAtPos(
  annotations: Annotation[],
  pos: number,
): Annotation | null {
  return (
    annotations.find(
      (a) =>
        a.status === 'pending' &&
        pos >= a.startOffset &&
        pos < a.endOffset,
    ) ?? null
  );
}

// --- Hover tooltip ---

export const annotationHoverTooltip = hoverTooltip((view, pos) => {
  const { annotations } = view.state.field(annotationField);
  const ann = findAnnotationAtPos(annotations, pos);
  if (!ann) return null;

  return {
    pos: ann.startOffset,
    end: ann.endOffset,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-annotation-tooltip';
      dom.textContent = ann.issue;
      return { dom };
    },
  };
});

// --- Click handler ---

export interface AnnotationClickInfo {
  id: string;
  annotation: Annotation;
  x: number;
  y: number;
}

export function createAnnotationClickHandler(
  onAnnotationClick: (info: AnnotationClickInfo | null) => void,
) {
  return EditorView.domEventHandlers({
    click(event: MouseEvent, view: EditorView) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) {
        onAnnotationClick(null);
        return false;
      }

      const { annotations } = view.state.field(annotationField);
      const ann = findAnnotationAtPos(annotations, pos);

      if (ann) {
        const coords = view.coordsAtPos(ann.startOffset);
        onAnnotationClick({
          id: ann.id,
          annotation: ann,
          x: coords?.left ?? event.clientX,
          y: coords?.bottom ?? event.clientY,
        });
        return true;
      }

      onAnnotationClick(null);
      return false;
    },
  });
}

// src/components/script/AnnotationHighlight.tsx
import type { Annotation } from '../../store/script';

const SEVERITY_COLORS: Record<string, { bg: string; border: string }> = {
  error: { bg: '#FF453A30', border: '#FF453A60' },
  warning: { bg: '#FF9F0A30', border: '#FF9F0A60' },
  info: { bg: '#0A84FF30', border: '#0A84FF60' },
};

export function applyAnnotationHighlights(
  text: string,
  annotations: Annotation[],
): string {
  const pending = annotations
    .filter((a) => a.status === 'pending')
    .sort((a, b) => b.startOffset - a.startOffset);

  let result = text;
  for (const ann of pending) {
    const before = result.slice(0, ann.startOffset);
    const match = result.slice(ann.startOffset, ann.endOffset);
    const after = result.slice(ann.endOffset);
    const colors = SEVERITY_COLORS[ann.severity] ?? SEVERITY_COLORS.info;
    result = `${before}<mark style="background:${colors.bg};border:1px solid ${colors.border};border-radius:4px;padding:1px 4px" data-annotation-id="${ann.id}">${match}</mark>${after}`;
  }

  return result;
}

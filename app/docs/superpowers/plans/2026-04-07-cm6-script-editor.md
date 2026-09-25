# CM6 ScriptEditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@uiw/react-md-editor` with CodeMirror 6，实现编辑器内联式 AI 审查标注，支持 hover 预览 + click Popover 操作（采纳/忽略）。

**Architecture:** 薄 React wrapper 包裹 CM6 EditorView。自定义 `StateField` 管理标注 `Decoration.mark()`。`hoverTooltip` 显示问题描述；click 触发 React 渲染的 `AnnotationPopover`。Zustand store 保持唯一数据源，CM6 是纯视图层。

**Tech Stack:** CodeMirror 6, React 19, Zustand 5, TypeScript, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/ui/components/script-editor.tsx` | Create | React wrapper + AnnotationPopover + CM6 lifecycle |
| `src/ui/components/script-editor-theme.ts` | Create | CM6 dark theme + markdown 语法高亮 |
| `src/ui/components/script-editor-annotations.ts` | Create | StateField + Decoration + hoverTooltip + click handler |
| `src/pages/ScriptWorkbench.tsx` | Modify | 替换 MdEditor 为 ScriptEditor，传递 annotations 和回调 |
| `src/ui/components/index.ts` | Modify | 导出 ScriptEditor |
| `tests/script-editor-annotations.test.ts` | Create | 标注纯逻辑单元测试 |
| `tests/script-editor-theme.test.ts` | Create | 主题扩展烟雾测试 |
| `tests/script-workbench.test.tsx` | Modify | 适配新编辑器组件 |
| `package.json` | Modify | 添加 CM6 依赖 |

---

### Task 1: Install CM6 Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install @codemirror/view @codemirror/state @codemirror/lang-markdown @codemirror/language @codemirror/language-data @codemirror/commands @lezer/highlight
```

- [ ] **Step 2: Verify TypeScript can resolve the new packages**

Run: `npx tsc --noEmit 2>&1 | head -5`

Expected: Only existing `baseUrl` deprecation warning, no new errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 添加 CodeMirror 6 依赖"
```

---

### Task 2: Create CM6 Dark Theme

**Files:**
- Create: `src/ui/components/script-editor-theme.ts`
- Test: `tests/script-editor-theme.test.ts`

- [ ] **Step 1: Write test**

```typescript
// tests/script-editor-theme.test.ts
import { describe, expect, it } from 'vitest';
import { scriptEditorTheme } from '../src/ui/components/script-editor-theme';

describe('scriptEditorTheme', () => {
  it('exports a non-empty array of extensions', () => {
    expect(Array.isArray(scriptEditorTheme)).toBe(true);
    expect(scriptEditorTheme.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/script-editor-theme.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement theme**

```typescript
// src/ui/components/script-editor-theme.ts
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const theme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#1C1C1E',
      color: '#E5E5E7',
      height: '100%',
    },
    '.cm-content': {
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize: '13px',
      lineHeight: '1.6',
      padding: '12px 16px',
      caretColor: '#0A84FF',
    },
    '.cm-cursor': { borderLeftColor: '#0A84FF' },
    '.cm-gutters': {
      backgroundColor: '#1C1C1E',
      color: '#48484A',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: '#2C2C2E50' },
    '.cm-selectionBackground': { backgroundColor: '#0A84FF30 !important' },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: '#0A84FF40 !important',
    },
    '.cm-placeholder': { color: '#48484A' },
    // annotation decoration styles
    '.cm-annotation-error': {
      backgroundColor: '#FF453A15',
      borderBottom: '2px wavy #FF453A',
      borderRadius: '2px',
      cursor: 'pointer',
    },
    '.cm-annotation-warning': {
      backgroundColor: '#FF9F0A15',
      borderBottom: '2px wavy #FF9F0A',
      borderRadius: '2px',
      cursor: 'pointer',
    },
    '.cm-annotation-info': {
      backgroundColor: '#0A84FF15',
      borderBottom: '2px wavy #0A84FF',
      borderRadius: '2px',
      cursor: 'pointer',
    },
    // hover tooltip
    '.cm-annotation-tooltip': {
      backgroundColor: '#2C2C2E',
      border: '1px solid #48484A',
      borderRadius: '8px',
      padding: '8px 12px',
      fontSize: '12px',
      color: '#EBEBF599',
      maxWidth: '300px',
      lineHeight: '1.4',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    },
  },
  { dark: true },
);

const highlighting = HighlightStyle.define([
  { tag: tags.heading1, color: '#E5E5E7', fontWeight: 'bold', fontSize: '1.4em' },
  { tag: tags.heading2, color: '#E5E5E7', fontWeight: 'bold', fontSize: '1.2em' },
  { tag: tags.heading3, color: '#E5E5E7', fontWeight: 'bold', fontSize: '1.1em' },
  { tag: tags.emphasis, color: '#FF9F0A', fontStyle: 'italic' },
  { tag: tags.strong, color: '#FF9F0A', fontWeight: 'bold' },
  { tag: tags.link, color: '#0A84FF', textDecoration: 'underline' },
  { tag: tags.url, color: '#0A84FF80' },
  { tag: tags.monospace, color: '#32D74B' },
  { tag: tags.quote, color: '#EBEBF580', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: '#48484A' },
]);

export const scriptEditorTheme = [theme, syntaxHighlighting(highlighting)];
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/script-editor-theme.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/script-editor-theme.ts tests/script-editor-theme.test.ts
git commit -m "feat(script-editor): CM6 深色主题 + markdown 语法高亮样式"
```

---

### Task 3: Create Annotation Extensions

**Files:**
- Create: `src/ui/components/script-editor-annotations.ts`
- Test: `tests/script-editor-annotations.test.ts`

- [ ] **Step 1: Write tests for annotation pure logic**

```typescript
// tests/script-editor-annotations.test.ts
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

  it('returns annotation at boundary positions', () => {
    const ann = makeAnnotation({ startOffset: 6, endOffset: 11 });
    expect(findAnnotationAtPos([ann], 6)).toBe(ann);
    expect(findAnnotationAtPos([ann], 11)).toBe(ann);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/script-editor-annotations.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement annotation extensions**

```typescript
// src/ui/components/script-editor-annotations.ts
import { StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
} from '@codemirror/view';
import type { Annotation } from '../../store/script';

// --- StateEffect: push annotations from React into CM6 ---

export const setAnnotationsEffect = StateEffect.define<Annotation[]>();

// --- Decoration builders ---

const SEVERITY_CLASS: Record<string, string> = {
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
        a.startOffset < docLength &&
        a.endOffset <= docLength,
    )
    .sort((a, b) => a.startOffset - b.startOffset)
    .map((a) =>
      Decoration.mark({
        class: SEVERITY_CLASS[a.severity] ?? SEVERITY_CLASS.info,
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
    // 1. Effect 更新：用新 annotations 全量重建装饰
    for (const effect of tr.effects) {
      if (effect.is(setAnnotationsEffect)) {
        return {
          annotations: effect.value,
          decorations: buildDecorations(effect.value, tr.state.doc.length),
        };
      }
    }

    // 2. 文档变化（用户输入）：通过 map 重映射现有装饰位置
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
        pos <= a.endOffset,
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
        if (coords) {
          onAnnotationClick({
            id: ann.id,
            annotation: ann,
            x: coords.left,
            y: coords.bottom,
          });
          return true;
        }
      }

      onAnnotationClick(null);
      return false;
    },
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/script-editor-annotations.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/script-editor-annotations.ts tests/script-editor-annotations.test.ts
git commit -m "feat(script-editor): 标注装饰 StateField + hover tooltip + click handler"
```

---

### Task 4: Create ScriptEditor Component

**Files:**
- Create: `src/ui/components/script-editor.tsx`
- Modify: `src/ui/components/index.ts`

- [ ] **Step 1: Implement ScriptEditor component**

```typescript
// src/ui/components/script-editor.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import type { Annotation, AnnotationSeverity } from '../../store/script';
import { scriptEditorTheme } from './script-editor-theme';
import {
  annotationField,
  annotationHoverTooltip,
  createAnnotationClickHandler,
  setAnnotationsEffect,
  type AnnotationClickInfo,
} from './script-editor-annotations';

// --- Severity display config ---

const SEVERITY_LABEL: Record<AnnotationSeverity, { color: string; text: string }> = {
  error: { color: '#FF453A', text: '错误' },
  warning: { color: '#FF9F0A', text: '警告' },
  info: { color: '#0A84FF', text: '建议' },
};

// --- AnnotationPopover ---

function AnnotationPopover({
  info,
  onAccept,
  onDismiss,
  onClose,
}: {
  info: AnnotationClickInfo;
  onAccept: () => void;
  onDismiss: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { annotation } = info;
  const severity = SEVERITY_LABEL[annotation.severity];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: info.y + 6,
        left: info.x,
        zIndex: 9999,
        width: 320,
        padding: 14,
        borderRadius: 10,
        backgroundColor: '#2C2C2E',
        border: `1px solid ${severity.color}40`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontSize: 12,
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: severity.color,
          }}
        />
        <span style={{ color: severity.color, fontWeight: 600 }}>
          {severity.text}
        </span>
      </div>

      {/* issue */}
      <div style={{ color: '#EBEBF599', lineHeight: 1.5 }}>
        {annotation.issue}
      </div>

      {/* suggestion diff */}
      {annotation.suggestion !== annotation.originalText && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            backgroundColor: `${severity.color}08`,
            border: `1px solid ${severity.color}20`,
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: '#EBEBF54D', marginBottom: 4 }}>
            <span style={{ textDecoration: 'line-through' }}>
              {annotation.originalText}
            </span>
          </div>
          <div style={{ color: '#EBEBF5CC' }}>{annotation.suggestion}</div>
        </div>
      )}

      {/* actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid #48484A',
            background: 'transparent',
            color: '#EBEBF599',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          忽略
        </button>
        <button
          type="button"
          onClick={onAccept}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            background: severity.color,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          采纳修改
        </button>
      </div>
    </div>,
    document.body,
  );
}

// --- ScriptEditor ---

interface ScriptEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  annotations?: Annotation[];
  onAcceptAnnotation?: (id: string) => void;
  onDismissAnnotation?: (id: string) => void;
}

export function ScriptEditor({
  value,
  onChange,
  placeholder,
  annotations = [],
  onAcceptAnnotation,
  onDismissAnnotation,
}: ScriptEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [clickInfo, setClickInfo] = useState<AnnotationClickInfo | null>(null);

  // Initialize CM6 EditorView
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          scriptEditorTheme,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          cmPlaceholder(placeholder ?? ''),
          annotationField,
          annotationHoverTooltip,
          createAnnotationClickHandler(setClickInfo),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.lineWrapping,
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React → CM6: sync external value changes (e.g. after "accept annotation")
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  // React → CM6: sync annotations
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setAnnotationsEffect.of(annotations) });
  }, [annotations]);

  // Close popover when the active annotation is no longer pending
  useEffect(() => {
    if (!clickInfo) return;
    const ann = annotations.find((a) => a.id === clickInfo.id);
    if (!ann || ann.status !== 'pending') {
      setClickInfo(null);
    }
  }, [annotations, clickInfo]);

  const handleClosePopover = useCallback(() => setClickInfo(null), []);

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        overflow: 'hidden',
        borderRadius: 6,
        border: '1px solid var(--color-mac-separator, #38383A)',
      }}
    >
      {clickInfo && (
        <AnnotationPopover
          info={clickInfo}
          onAccept={() => onAcceptAnnotation?.(clickInfo.id)}
          onDismiss={() => onDismissAnnotation?.(clickInfo.id)}
          onClose={handleClosePopover}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Export ScriptEditor from index.ts**

Add to `src/ui/components/index.ts`:

```typescript
export { ScriptEditor } from "./script-editor";
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit 2>&1 | head -10`

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/script-editor.tsx src/ui/components/index.ts
git commit -m "feat(script-editor): CM6 编辑器组件 + 内联标注 Popover"
```

---

### Task 5: Integrate into ScriptWorkbench

**Files:**
- Modify: `src/pages/ScriptWorkbench.tsx`

The key changes:
1. Replace `MdEditor` import with `ScriptEditor`
2. Pass `annotations`, `onAcceptAnnotation`, `onDismissAnnotation` props
3. Remove old `@uiw/react-md-editor` CSS imports (handled by CM6 theme)

- [ ] **Step 1: Update ScriptWorkbench imports and editor usage**

In `src/pages/ScriptWorkbench.tsx`, replace the MdEditor import and usage:

**Replace imports:**
```typescript
// REMOVE:
import { MdEditor } from '../ui/components/md-editor';

// ADD:
import { ScriptEditor } from '../ui/components/script-editor';
```

**Add store selectors** — extend the existing `useScriptStore` destructuring:
```typescript
const {
  currentStep,
  originalText,
  scriptText,
  projectDir,
  annotations,            // ADD
  setOriginalText,
  setScriptText,
  restoreState,
  acceptAnnotation,       // ADD
  dismissAnnotation,      // ADD
} = useScriptStore();
```

**Replace the `<MdEditor>` JSX** with:
```tsx
<ScriptEditor
  value={editorValue}
  onChange={handleEditorChange}
  placeholder={isEditingOriginal ? '报告原文内容...' : '口播稿内容...'}
  annotations={isEditingOriginal ? undefined : annotations}
  onAcceptAnnotation={isEditingOriginal ? undefined : acceptAnnotation}
  onDismissAnnotation={isEditingOriginal ? undefined : dismissAnnotation}
/>
```

Note: Annotations only apply in Steps 3-5 (口播稿 editing), not Steps 1-2 (原稿 editing).

- [ ] **Step 2: Remove the debouncedSaveFile import if no longer needed**

Check that `debouncedSaveFile` is still imported (it is — used in `handleEditorChange`). No change needed.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit 2>&1 | head -10`

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ScriptWorkbench.tsx
git commit -m "feat(script-workbench): 集成 CM6 编辑器，支持内联标注"
```

---

### Task 6: Update Tests

**Files:**
- Modify: `tests/script-workbench.test.tsx`

- [ ] **Step 1: Update ScriptWorkbench test**

The existing test uses `renderToStaticMarkup` which won't render the CM6 imperative EditorView. Update the test to verify the component mounts without crashing, but without asserting on editor internals.

```typescript
// tests/script-workbench.test.tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverlayProvider } from '../src/ui';
import { ScriptWorkbench } from '../src/pages/ScriptWorkbench';
import { useScriptStore } from '../src/store/script';

describe('ScriptWorkbench', () => {
  beforeEach(() => {
    useScriptStore.getState().reset();
  });

  afterEach(() => {
    useScriptStore.getState().reset();
  });

  it('renders step 1 placeholder when no file is loaded', () => {
    useScriptStore.setState({ currentStep: 1, originalText: '' });

    const html = renderToStaticMarkup(
      <OverlayProvider>
        <ScriptWorkbench onBack={() => undefined} />
      </OverlayProvider>,
    );

    expect(html).toContain('在右侧面板上传报告文件并选择工作目录');
  });

  it('renders the editor container when originalText is set', () => {
    useScriptStore.setState({
      currentStep: 2,
      originalText: '# 测试报告\n\n正文内容。',
    });

    // CM6 uses imperative DOM — renderToStaticMarkup produces the container div
    // but not the editor content. Verify no crash.
    expect(() =>
      renderToStaticMarkup(
        <OverlayProvider>
          <ScriptWorkbench onBack={() => undefined} />
        </OverlayProvider>,
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`

Expected: All tests pass. The `markdown-preview-config.test.tsx` still passes since the old `MdEditor` component and `buildSafeMarkdownPreviewOptions` are not removed.

- [ ] **Step 3: Commit**

```bash
git add tests/script-workbench.test.tsx
git commit -m "test: 适配 CM6 编辑器更新 ScriptWorkbench 测试"
```

---

### Task 7: Cleanup & Final Verification

**Files:**
- No new files

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit`

Expected: No new errors.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 4: Final commit (if any pending changes)**

```bash
git status
# If there are remaining changes:
git add -A
git commit -m "chore: CM6 编辑器迁移收尾"
```

---

## Notes

### Not in scope (future work)
- **Remove old `@uiw/react-md-editor` dependency**: The old `MdEditor` component is still exported from `src/ui/components/index.ts` and tested in `tests/markdown-preview-config.test.tsx`. Remove once confirmed no other usage.
- **Image upload toolbar**: The old editor had a custom image upload button. Can be re-added as a floating toolbar or CM6 panel in a follow-up.
- **Keyboard shortcuts**: CM6 includes `defaultKeymap` + `historyKeymap`. Markdown-specific shortcuts (bold, italic, heading) can be added later.
- **`AnnotationHighlight.tsx` cleanup**: The existing `src/components/script/AnnotationHighlight.tsx` is unused (never imported). Can be deleted after confirming CM6 annotations work correctly.

### Key technical decisions
- **Zustand is the single source of truth**: CM6 is a view layer. All text mutations and annotation state changes flow through the store.
- **`onChangeRef` pattern**: Avoids re-creating the CM6 EditorView when the `onChange` callback identity changes.
- **Annotation popover uses React portal**: Positioned at CM6 `coordsAtPos()` coordinates, rendered via `createPortal(document.body)` for correct z-index stacking.
- **`hoverTooltip` uses CM6 native DOM**: Lightweight, no React overhead for a simple text display.

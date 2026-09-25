import { useEffect, useMemo, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { yaml } from '@codemirror/lang-yaml';
import { tags as t } from '@lezer/highlight';

const codeEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-panel-bg)',
      color: 'var(--color-text-primary)',
      height: '100%',
      borderRadius: 'var(--radius-md)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'SF Mono, Menlo, Consolas, monospace',
      fontSize: 'var(--font-size-sm)',
      lineHeight: '1.55',
    },
    '.cm-content': {
      padding: '10px 0',
      caretColor: 'var(--color-system-blue)',
    },
    '.cm-cursor': { borderLeftColor: 'var(--color-system-blue)' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-panel-bg)',
      color: 'var(--color-text-tertiary, var(--color-text-secondary))',
      border: 'none',
      borderRight: '1px solid var(--color-separator)',
      paddingRight: '4px',
    },
    '.cm-activeLine': {
      backgroundColor:
        'color-mix(in srgb, var(--color-panel-elevated) 35%, transparent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--color-text-secondary)',
    },
    '.cm-selectionBackground': {
      backgroundColor:
        'color-mix(in srgb, var(--color-system-blue) 22%, transparent) !important',
    },
    '.cm-placeholder': { color: 'var(--color-text-tertiary, var(--color-text-secondary))' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-panel-elevated)',
      border: '1px solid var(--color-separator)',
      color: 'var(--color-text-secondary)',
      padding: '0 4px',
      borderRadius: 'var(--radius-sm)',
    },
    // prompt 变量高亮
    '.cm-prompt-var': {
      backgroundColor: 'color-mix(in srgb, var(--color-success) 18%, transparent)',
      color: 'var(--color-success)',
      borderRadius: '3px',
      padding: '0 2px',
      fontWeight: '500',
    },
    '.cm-prompt-var-unknown': {
      backgroundColor: 'color-mix(in srgb, var(--color-warning) 20%, transparent)',
      color: 'var(--color-warning)',
      borderRadius: '3px',
      padding: '0 2px',
      textDecoration: 'underline dotted',
      textUnderlineOffset: '2px',
    },
    // autocomplete 浮层
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--color-panel-elevated)',
      border: '1px solid var(--color-separator)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-dropdown, 0 8px 24px rgba(0,0,0,0.35))',
      padding: '4px',
      fontFamily: 'SF Pro Text, -apple-system, sans-serif',
    },
    '.cm-tooltip-autocomplete > ul': {
      fontFamily: 'SF Mono, Menlo, monospace',
      fontSize: 'var(--font-size-sm)',
      maxHeight: '240px',
    },
    '.cm-tooltip-autocomplete > ul > li': {
      padding: '4px 8px',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--color-text-primary)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--color-system-blue)',
      color: '#ffffff',
    },
    '.cm-completionLabel': { color: 'inherit' },
    '.cm-completionDetail': {
      fontStyle: 'normal',
      color: 'var(--color-text-secondary)',
      marginLeft: '8px',
      fontFamily: 'SF Pro Text, -apple-system, sans-serif',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': {
      color: 'rgba(255,255,255,0.85)',
    },
    '.cm-completionIcon': {
      width: '1em',
      marginRight: '6px',
      opacity: 0.7,
    },
    '.cm-completionIcon-variable::before': { content: '"{}"', fontWeight: 600 },
  },
  { dark: true },
);

const codeEditorHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--color-system-blue)' },
  { tag: t.string, color: '#ffb37c' },
  { tag: t.atom, color: '#9eb7ff' },
  { tag: t.number, color: '#79c4ff' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--color-text-tertiary, var(--color-text-secondary))', fontStyle: 'italic' },
  { tag: t.propertyName, color: '#9eb7ff' },
  { tag: [t.bool, t.null], color: '#ff8f7a' },
  { tag: t.meta, color: 'var(--color-text-secondary)' },
]);

// ─── 变量高亮（{{name}}）────────────────────────

const knownMark = Decoration.mark({ class: 'cm-prompt-var' });
const unknownMark = Decoration.mark({ class: 'cm-prompt-var-unknown' });

function createVariableHighlight(knownNames: Set<string>) {
  const matcher = new MatchDecorator({
    regexp: /\{\{\s*([\w.]+)\s*\}\}/g,
    decoration: (match) => (knownNames.has(match[1]) ? knownMark : unknownMark),
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = matcher.updateDeco(u, this.decorations);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ─── 变量自动补全（{{...}}）────────────────────

function createVariableCompletionSource(
  vars: ReadonlyArray<{ name: string; description?: string }>,
) {
  return (ctx: CompletionContext): CompletionResult | null => {
    // 触发：输入了 {{（可能有空格）+ 可选名称片段
    const before = ctx.matchBefore(/\{\{\s*[\w.]*/);
    if (!before) return null;
    if (before.from === before.to && !ctx.explicit) return null;

    const m = before.text.match(/\{\{\s*([\w.]*)$/);
    if (!m) return null;

    // 补全起点 = 名称片段的起点
    const from = before.from + (before.text.length - m[1].length);

    return {
      from,
      to: ctx.pos,
      options: vars.map((v) => ({
        label: v.name,
        detail: v.description,
        type: 'variable',
        apply: v.name,
      })),
      validFor: /^[\w.]*$/,
    };
  };
}

export type CodeEditorLanguage = 'yaml' | 'text';

export interface CodeEditorVariable {
  name: string;
  description?: string;
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: CodeEditorLanguage;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number | string;
  maxHeight?: number | string;
  className?: string;
  ariaLabel?: string;
  /** 已知模板变量：提供时 `{{name}}` 会被高亮，输入 `{{` 时弹出补全 */
  variables?: ReadonlyArray<CodeEditorVariable>;
}

function languageExtension(language: CodeEditorLanguage) {
  switch (language) {
    case 'text':
      return [];
    case 'yaml':
    default:
      return yaml();
  }
}

export function CodeEditor({
  value,
  onChange,
  language = 'yaml',
  readOnly = false,
  placeholder,
  minHeight = 320,
  maxHeight,
  className,
  ariaLabel,
  variables,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const readOnlyCompartment = useRef(new Compartment());
  const placeholderCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());
  const variablesCompartment = useRef(new Compartment());

  const varNames = useMemo(
    () => new Set((variables ?? []).map((v) => v.name)),
    [variables],
  );
  const varList = useMemo(() => variables ?? [], [variables]);

  const buildVariablesExtension = (
    names: Set<string>,
    list: ReadonlyArray<CodeEditorVariable>,
  ) => {
    if (list.length === 0) return [];
    return [
      createVariableHighlight(names),
      autocompletion({
        override: [createVariableCompletionSource(list)],
        activateOnTyping: true,
      }),
    ];
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          indentOnInput(),
          bracketMatching(),
          foldGutter(),
          highlightSelectionMatches(),
          codeEditorTheme,
          syntaxHighlighting(codeEditorHighlight),
          languageCompartment.current.of(languageExtension(language)),
          placeholderCompartment.current.of(cmPlaceholder(placeholder ?? '')),
          readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
          variablesCompartment.current.of(buildVariablesExtension(varNames, varList)),
          keymap.of([
            indentWithTab,
            ...completionKeymap,
            ...searchKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 同步外部 value
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // 同步 readOnly
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  // 同步 placeholder
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: placeholderCompartment.current.reconfigure(
        cmPlaceholder(placeholder ?? ''),
      ),
    });
  }, [placeholder]);

  // 同步 language
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.current.reconfigure(languageExtension(language)),
    });
  }, [language]);

  // 同步变量集（切换 prompt kind 时）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: variablesCompartment.current.reconfigure(
        buildVariablesExtension(varNames, varList),
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varNames, varList]);

  const heightStyle: React.CSSProperties = {
    minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
  };
  if (maxHeight !== undefined) {
    heightStyle.maxHeight = typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;
  }

  return (
    <div
      ref={containerRef}
      className={className}
      aria-label={ariaLabel}
      style={{
        ...heightStyle,
        width: '100%',
        border: '1px solid var(--color-separator)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: 'var(--color-panel-bg)',
      }}
    />
  );
}

import type { EditorView } from '@codemirror/view';
import { clearVirtualCursor, setVirtualCursor } from './virtual-cursor';

export interface ReplaceEditorContentOptions {
  cursorPos?: number | null;
}

/**
 * 直接替换 CodeMirror 当前文档内容。
 * 适合在流式写稿前做“强制清屏”，避免旧内容残留导致打字机效果不可见。
 */
export function replaceEditorContent(
  view: EditorView,
  content: string,
  options: ReplaceEditorContentOptions = {},
): void {
  const effects =
    options.cursorPos == null
      ? clearVirtualCursor.of(null)
      : setVirtualCursor.of(options.cursorPos);

  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: content,
    },
    effects,
    scrollIntoView: true,
  });
}

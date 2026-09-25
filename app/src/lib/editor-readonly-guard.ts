// src/lib/editor-readonly-guard.ts
import { Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * 通过 Compartment 动态切换编辑器只读状态。
 * 使用方式：
 *   extensions 中加入 readOnlyGuard.extension
 *   切换只读：view.dispatch({ effects: readOnlyGuard.reconfigure(true) })
 */
export function createReadOnlyGuard() {
  const compartment = new Compartment();

  return {
    extension: compartment.of(EditorView.editable.of(true)),

    reconfigure(readOnly: boolean) {
      return compartment.reconfigure(EditorView.editable.of(!readOnly));
    },
  };
}

import type { CoverEditState, FilterPreset } from './contracts';

/** 历史栈（泛型，供 Fabric JSON 快照使用） */
export interface HistoryStack<T> {
  push(snapshot: T): void;
  undo(): T | null;
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  peek(): T | null;
  clear(): void;
}

export function createHistoryStack<T>(capacity = 50): HistoryStack<T> {
  const stack: T[] = [];
  let cursor = -1; // 当前指向最新应用的快照

  return {
    push(snapshot) {
      // 清空 redo 区段
      stack.splice(cursor + 1);
      stack.push(snapshot);
      if (stack.length > capacity) {
        stack.shift();
      } else {
        cursor = stack.length - 1;
        return;
      }
      cursor = stack.length - 1;
    },
    undo() {
      if (cursor <= 0) return null;
      cursor -= 1;
      return stack[cursor];
    },
    redo() {
      if (cursor >= stack.length - 1) return null;
      cursor += 1;
      return stack[cursor];
    },
    canUndo() {
      return cursor > 0;
    },
    canRedo() {
      return cursor < stack.length - 1;
    },
    peek() {
      return cursor >= 0 ? stack[cursor] : null;
    },
    clear() {
      stack.length = 0;
      cursor = -1;
    },
  };
}

/** 命令式 API，由 CoverEditorCanvas 通过 ref 暴露给父组件 */
export interface CoverEditorCanvasHandle {
  setAspectRatio(ratio: number | null): void;
  addText(options: { text: string; fontFamily: string; color: string }): void;
  updateSelectedText(patch: {
    text?: string;
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    strokeColor?: string;
    strokeWidth?: number;
    align?: 'left' | 'center' | 'right';
  }): void;
  removeSelected(): void;
  flipHorizontal(): void;
  flipVertical(): void;
  rotate(degrees: number): void;
  setFilterPreset(preset: FilterPreset): void;
  setFilterAdjustment(
    key: 'brightness' | 'contrast' | 'saturation' | 'temperature',
    value: number,
  ): void;
  /** 进入自由裁剪模式：显示可拖拽/缩放的裁剪矩形 */
  enterCropMode(): void;
  /** 退出裁剪模式，不提交裁剪；自动恢复之前的 clipPath */
  exitCropMode(): void;
  /** 应用当前裁剪矩形为最终 clipPath */
  commitCrop(): void;
  /** 在裁剪模式下锁定裁剪矩形的宽高比；传 null 表示自由裁剪 */
  setCropAspectRatio(ratio: number | null): void;
  undo(): void;
  redo(): void;
  exportDataUrl(): string;
  getEditState(): CoverEditState;
  loadEditState(state: CoverEditState): void;
}

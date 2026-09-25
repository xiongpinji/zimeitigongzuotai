import DiffMatchPatch from 'diff-match-patch';

// 类型定义（后续由 streaming-editor 重新导出）
export interface StreamingEditOperation {
  type: 'insert' | 'delete' | 'replace';
  offset: number;
  length?: number;
  text?: string;
}

export interface AnimationFrame {
  cursorPosition: number;
  operation: StreamingEditOperation;
  delayMs: number;
}

export interface DiffToFramesOptions {
  chunkSize?: number; // insert 文本分块大小，默认 15
  baseDelayMs?: number; // 每帧基础延迟，默认 30
}

const DEFAULT_OPTIONS: Required<DiffToFramesOptions> = {
  chunkSize: 15,
  baseDelayMs: 30,
};

export function diffToFrames(
  before: string,
  after: string,
  options?: DiffToFramesOptions,
): AnimationFrame[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(before, after);
  dmp.diff_cleanupSemantic(diffs);

  const frames: AnimationFrame[] = [];
  let cursorPos = 0;

  for (const [op, text] of diffs) {
    if (op === 0) {
      // EQUAL — 光标前进，无操作
      cursorPos += text.length;
    } else if (op === -1) {
      // DELETE
      frames.push({
        cursorPosition: cursorPos,
        operation: { type: 'delete', offset: cursorPos, length: text.length },
        delayMs: opts.baseDelayMs,
      });
      // cursorPos 不变，删除后后续内容前移
    } else if (op === 1) {
      // INSERT — 按 chunkSize 分块
      for (let i = 0; i < text.length; i += opts.chunkSize) {
        const chunk = text.slice(i, i + opts.chunkSize);
        frames.push({
          cursorPosition: cursorPos + chunk.length,
          operation: { type: 'insert', offset: cursorPos, text: chunk },
          delayMs: opts.baseDelayMs,
        });
        cursorPos += chunk.length;
      }
    }
  }

  return frames;
}

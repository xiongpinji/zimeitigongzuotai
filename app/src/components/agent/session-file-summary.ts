/**
 * 会话级文件改动聚合（渲染时派生，无持久化）。
 *
 * 扫描某会话所有 turn 的 block：
 *  - type === 'file_changed' 的块直接计入；
 *  - type === 'tool_call' 的块经 fileChangeFromToolCall 转换（与 AssistantMessage 渲染口径一致）。
 * 按绝对/原始路径去重，跨多次操作累加 +/- 行数并归并操作终态。
 */
import type { ConversationBlock, ConversationTurn } from '../../types/conversation';
import { fileChangeFromToolCall } from './tool-call-descriptor';
import { changedLineCount, type FileChangedBlockData } from './FileChangedBlock';

export type FileKind = 'image' | 'video' | 'audio' | 'markdown' | 'document' | 'code' | 'other';

export interface SummaryFile {
  path: string;
  name: string;
  /** 大写、无点的扩展名，如 'PNG'；无扩展名时为空串。 */
  ext: string;
  kind: FileKind;
  operation: 'create' | 'edit' | 'delete';
  added: number;
  removed: number;
}

export interface SessionFileSummary {
  files: SummaryFile[];
  totalAdded: number;
  totalRemoved: number;
}

const EXT_KIND: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', heic: 'image', avif: 'image',
  mp4: 'video', mov: 'video', mkv: 'video', webm: 'video', avi: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', aac: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio',
  md: 'markdown', mdx: 'markdown',
  txt: 'document', json: 'document', csv: 'document', srt: 'document', pdf: 'document', yaml: 'document', yml: 'document',
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', css: 'code', html: 'code', py: 'code', sh: 'code',
};

export function classifyFileKind(path: string): { name: string; ext: string; kind: FileKind } {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf('.');
  const rawExt = dot > 0 ? name.slice(dot + 1) : '';
  const ext = rawExt.toUpperCase();
  const kind = EXT_KIND[rawExt.toLowerCase()] ?? 'other';
  return { name, ext, kind };
}

type Operation = SummaryFile['operation'];

function mergeOperation(prev: Operation, next: Operation): Operation {
  if (next === 'delete') return 'delete';        // 任意态后 delete → delete
  if (prev === 'create') return 'create';        // 先 create 后 edit → create
  if (next === 'create') return 'create';
  return prev;                                    // edit/edit → edit
}

/** 显式 operation 优先；缺省时按 before/after 推断（before===null → create，after==='' → delete）。 */
function deriveOperation(change: FileChangedBlockData): Operation {
  if (change.operation) return change.operation;
  if (change.before === null) return 'create';
  if (change.after === '') return 'delete';
  return 'edit';
}

/** 把任意 ConversationBlock 归一化为文件变更描述（与 AssistantMessage 渲染口径一致）。 */
function toFileChange(block: ConversationBlock): FileChangedBlockData | null {
  if (block.type === 'file_changed') {
    return {
      type: 'file_changed',
      path: block.path,
      before: block.before,
      after: block.after,
      diff: block.diff,
      operation: block.operation,
    };
  }
  if (block.type === 'tool_call') {
    const change = fileChangeFromToolCall({
      type: 'tool_call',
      title: block.title,
      kind: block.kind,
      status: block.status,
      rawInput: block.rawInput,
      rawOutput: block.rawOutput,
    });
    if (!change) return null;
    return { type: 'file_changed', ...change };
  }
  return null;
}

export function summarizeSessionFiles(turns: ConversationTurn[]): SessionFileSummary {
  const map = new Map<string, SummaryFile>();

  for (const turn of turns) {
    for (const block of turn.blocks) {
      const change = toFileChange(block);
      if (!change) continue;
      const { added, removed } = changedLineCount(change);
      const op = deriveOperation(change);
      const existing = map.get(change.path);
      if (existing) {
        existing.added += added;
        existing.removed += removed;
        existing.operation = mergeOperation(existing.operation, op);
      } else {
        const { name, ext, kind } = classifyFileKind(change.path);
        map.set(change.path, { path: change.path, name, ext, kind, operation: op, added, removed });
      }
    }
  }

  const files = Array.from(map.values());
  const totalAdded = files.reduce((acc, f) => acc + f.added, 0);
  const totalRemoved = files.reduce((acc, f) => acc + f.removed, 0);
  return { files, totalAdded, totalRemoved };
}

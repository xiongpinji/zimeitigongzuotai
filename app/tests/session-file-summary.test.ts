import { describe, it, expect } from 'vitest';
import { summarizeSessionFiles, classifyFileKind } from '../src/components/agent/session-file-summary';
import type { ConversationTurn } from '../src/types/conversation';

function assistantTurn(id: number, blocks: ConversationTurn['blocks']): ConversationTurn {
  return { id, conversationId: 1, role: 'assistant', blocks, createdAt: '2026-06-19T00:00:00Z' };
}

describe('classifyFileKind', () => {
  it('maps by extension', () => {
    expect(classifyFileKind('a.png').kind).toBe('image');
    expect(classifyFileKind('a.mp4').kind).toBe('video');
    expect(classifyFileKind('a.mp3').kind).toBe('audio');
    expect(classifyFileKind('a.md').kind).toBe('markdown');
    expect(classifyFileKind('a.txt').kind).toBe('document');
    expect(classifyFileKind('a.ts').kind).toBe('code');
    expect(classifyFileKind('a.bin').kind).toBe('other');
  });
  it('uppercases ext and extracts name', () => {
    const c = classifyFileKind('/root/dir/cover-3x4.PNG');
    expect(c.ext).toBe('PNG');
    expect(c.name).toBe('cover-3x4.PNG');
  });
});

describe('summarizeSessionFiles', () => {
  it('returns empty summary for no file changes', () => {
    const s = summarizeSessionFiles([assistantTurn(1, [{ type: 'text', text: 'hi' }])]);
    expect(s.files).toEqual([]);
    expect(s.totalAdded).toBe(0);
    expect(s.totalRemoved).toBe(0);
  });

  it('aggregates a created file from a file_changed block', () => {
    const s = summarizeSessionFiles([
      assistantTurn(1, [
        { type: 'file_changed', path: '/p/cover.md', before: null, after: 'line1\nline2' },
      ]),
    ]);
    expect(s.files).toHaveLength(1);
    expect(s.files[0]).toMatchObject({ path: '/p/cover.md', name: 'cover.md', ext: 'MD', kind: 'markdown', operation: 'create', added: 2, removed: 0 });
    expect(s.totalAdded).toBe(2);
  });

  it('dedupes by path and merges line counts across turns', () => {
    // 用带尾换行的真实文件内容，避免 jsdiff 对无尾换行文本把 'x'/'x\n' 视作不同行。
    const s = summarizeSessionFiles([
      assistantTurn(1, [{ type: 'file_changed', path: '/p/a.txt', before: null, after: 'x\n' }]),
      assistantTurn(2, [{ type: 'file_changed', path: '/p/a.txt', before: 'x\n', after: 'x\ny\n', operation: 'edit' }]),
    ]);
    expect(s.files).toHaveLength(1);
    expect(s.files[0].path).toBe('/p/a.txt');
    expect(s.files[0].added).toBe(2); // 1 (create) + 1 (edit adds one line)
  });

  it('create-then-edit stays create; anything-then-delete becomes delete', () => {
    const created = summarizeSessionFiles([
      assistantTurn(1, [{ type: 'file_changed', path: '/p/a.txt', before: null, after: 'x', operation: 'create' }]),
      assistantTurn(2, [{ type: 'file_changed', path: '/p/a.txt', before: 'x', after: 'x\ny', operation: 'edit' }]),
    ]);
    expect(created.files[0].operation).toBe('create');

    const deleted = summarizeSessionFiles([
      assistantTurn(1, [{ type: 'file_changed', path: '/p/a.txt', before: null, after: 'x', operation: 'create' }]),
      assistantTurn(2, [{ type: 'file_changed', path: '/p/a.txt', before: 'x', after: '', operation: 'delete' }]),
    ]);
    expect(deleted.files[0].operation).toBe('delete');
  });

  it('extracts file changes from tool_call blocks via fileChangeFromToolCall', () => {
    const s = summarizeSessionFiles([
      assistantTurn(1, [
        {
          type: 'tool_call',
          toolCallId: 't1',
          title: 'Write',
          kind: 'write',
          status: 'completed',
          rawInput: JSON.stringify({ path: '/p/new.md', content: 'hello\nworld' }),
        },
      ]),
    ]);
    expect(s.files).toHaveLength(1);
    expect(s.files[0]).toMatchObject({ path: '/p/new.md', operation: 'create' });
  });
});

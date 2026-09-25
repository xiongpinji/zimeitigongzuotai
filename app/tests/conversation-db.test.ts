import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConversationDb, resolveConversationDbPath } from '../electron/conversations/db';

function listTables(db: { prepare: (sql: string) => { all: () => Array<{ name: string }> } }): string[] {
  const rows = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type='table'
      ORDER BY name ASC
    `)
    .all();
  return rows.map((row) => row.name);
}

describe('conversation db migrations', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('creates conversation tables with required columns', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'conversation-db-'));
    tempDirs.push(tempDir);
    const db = createConversationDb(tempDir);

    const tables = listTables(db);
    expect(tables).toContain('project_workspace');
    expect(tables).toContain('conversation');
    expect(tables).toContain('conversation_turn');
    expect(tables).toContain('project_opened_conversation');

    const columns = db
      .prepare('PRAGMA table_info(conversation);')
      .all() as Array<{ name: string; notnull: number }>;
    const columnNames = columns.map((column) => column.name);
    expect(columnNames).toEqual(
      expect.arrayContaining([
        'id',
        'project_id',
        'title',
        'agent_type',
        'status',
        'external_id',
        'parent_id',
        'message_count',
        'session_stats_json',
        'created_at',
        'updated_at',
      ]),
    );
    expect(columns.find((column) => column.name === 'project_id')?.notnull).toBe(1);
    expect(columns.find((column) => column.name === 'agent_type')?.notnull).toBe(1);
    expect(columns.find((column) => column.name === 'message_count')?.notnull).toBe(1);

    const turnColumns = db
      .prepare('PRAGMA table_info(conversation_turn);')
      .all() as Array<{ name: string }>;
    const turnColumnNames = turnColumns.map((column) => column.name);
    expect(turnColumnNames).toEqual(
      expect.arrayContaining(['id', 'conversation_id', 'role', 'content', 'created_at', 'agent_id', 'agent_name']),
    );

    const dbPath = resolveConversationDbPath(tempDir);
    expect(dbPath).toBe(path.join(tempDir, '.acp', 'conversation.sqlite3'));

    db.close();
  });
});

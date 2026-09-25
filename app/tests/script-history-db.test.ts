import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  createScriptHistoryDb,
  resolveScriptHistoryDbPath,
  SCRIPT_HISTORY_DB_FILENAME,
} from '../electron/script-history/db';

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

describe('script-history db migrations', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('resolves db path under .acp directory', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'script-history-db-'));
    tempDirs.push(tempDir);

    const dbPath = resolveScriptHistoryDbPath(tempDir);
    expect(dbPath).toBe(path.join(tempDir, '.acp', SCRIPT_HISTORY_DB_FILENAME));
    expect(dbPath).toContain('script-history.sqlite3');
  });

  it('creates script_version table with required columns', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'script-history-db-'));
    tempDirs.push(tempDir);
    const db = createScriptHistoryDb(tempDir);

    const tables = listTables(db);
    expect(tables).toContain('script_version');

    const columns = db
      .prepare('PRAGMA table_info(script_version);')
      .all() as Array<{ name: string; notnull: number }>;
    const columnNames = columns.map((column) => column.name);
    expect(columnNames).toEqual(
      expect.arrayContaining([
        'id',
        'project_id',
        'file_name',
        'content',
        'source',
        'provider_id',
        'provider_name',
        'model_name',
        'label',
        'byte_size',
        'created_at',
      ]),
    );

    expect(columns.find((col) => col.name === 'project_id')?.notnull).toBe(1);
    expect(columns.find((col) => col.name === 'content')?.notnull).toBe(1);
    expect(columns.find((col) => col.name === 'source')?.notnull).toBe(1);
    expect(columns.find((col) => col.name === 'byte_size')?.notnull).toBe(1);

    db.close();
  });

  it('migration is idempotent — running twice does not throw', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'script-history-db-'));
    tempDirs.push(tempDir);

    expect(() => {
      const db1 = createScriptHistoryDb(tempDir);
      db1.close();
      const db2 = createScriptHistoryDb(tempDir);
      db2.close();
    }).not.toThrow();
  });
});

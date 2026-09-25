import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runScriptHistoryMigrations } from './migrations';

export const SCRIPT_HISTORY_DB_FILENAME = 'script-history.sqlite3';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => ScriptHistoryDatabase;
};

export interface ScriptHistoryDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
  close(): void;
}

export function resolveScriptHistoryDbPath(baseDir: string): string {
  const targetDir = path.join(baseDir, '.acp');
  mkdirSync(targetDir, { recursive: true });
  return path.join(targetDir, SCRIPT_HISTORY_DB_FILENAME);
}

export function createScriptHistoryDb(baseDir: string): ScriptHistoryDatabase {
  const dbPath = resolveScriptHistoryDbPath(baseDir);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  runScriptHistoryMigrations(db);
  return db;
}

export function withTransaction<T>(db: ScriptHistoryDatabase, action: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = action();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

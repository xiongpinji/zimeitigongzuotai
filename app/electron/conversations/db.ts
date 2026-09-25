import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runConversationMigrations } from './migrations';

export const CONVERSATION_DB_FILENAME = 'conversation.sqlite3';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => ConversationDatabase;
};

export interface ConversationDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
  close(): void;
}

export function resolveConversationDbPath(baseDir: string): string {
  const targetDir = path.join(baseDir, '.acp');
  mkdirSync(targetDir, { recursive: true });
  return path.join(targetDir, CONVERSATION_DB_FILENAME);
}

export function createConversationDb(baseDir: string): ConversationDatabase {
  const dbPath = resolveConversationDbPath(baseDir);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  runConversationMigrations(db);
  return db;
}

export function withTransaction<T>(db: ConversationDatabase, action: () => T): T {
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

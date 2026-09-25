import type { ScriptHistoryDatabase } from './db';

const CURRENT_SCHEMA_VERSION = 1;

export function runScriptHistoryMigrations(db: ScriptHistoryDatabase): void {
  const schemaVersion = db.prepare('PRAGMA user_version;').get() as { user_version?: number };
  const userVersion = schemaVersion.user_version ?? 0;
  if (userVersion >= CURRENT_SCHEMA_VERSION) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS script_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT 'script.md',
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      provider_id TEXT,
      provider_name TEXT,
      model_name TEXT,
      label TEXT,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_version_project_file
      ON script_version(project_id, file_name, created_at DESC);
  `);

  db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
}

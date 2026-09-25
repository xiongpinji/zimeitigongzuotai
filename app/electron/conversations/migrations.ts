import type { ConversationDatabase } from './db';

const CURRENT_SCHEMA_VERSION = 2;

export function runConversationMigrations(db: ConversationDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY);');

  const schemaVersion = db.prepare('PRAGMA user_version;').get() as { user_version?: number };
  const userVersion = schemaVersion.user_version ?? 0;

  if (userVersion >= CURRENT_SCHEMA_VERSION) {
    return;
  }

  if (userVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_workspace (
        project_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        status TEXT NOT NULL,
        external_id TEXT,
        parent_id INTEGER,
        message_count INTEGER NOT NULL DEFAULT 0,
        session_stats_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(parent_id) REFERENCES conversation(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_project_updated
        ON conversation(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversation_parent_id
        ON conversation(parent_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_external_id
        ON conversation(external_id);

      CREATE TABLE IF NOT EXISTS conversation_turn (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_turn_conversation_id
        ON conversation_turn(conversation_id, id ASC);

      CREATE TABLE IF NOT EXISTS project_opened_conversation (
        project_id TEXT PRIMARY KEY,
        conversation_id INTEGER,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES conversation(id) ON DELETE SET NULL
      );
    `);
  }

  if (userVersion < 2) {
    // Add agentId and agentName columns to conversation_turn for per-turn agent attribution.
    // Both are nullable to preserve backward compatibility with existing turns.
    db.exec(`
      ALTER TABLE conversation_turn ADD COLUMN agent_id TEXT;
      ALTER TABLE conversation_turn ADD COLUMN agent_name TEXT;
    `);
  }

  db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
}

import type { ConversationDatabase } from './db';
import { withTransaction } from './db';
import type {
  AppendConversationTurnInput,
  AppendConversationTurnResult,
  ConversationDetailEntity,
  ConversationEntity,
  ConversationTurnBlock,
  ConversationTurnEntity,
  CreateConversationInput,
  ForkConversationInput,
  OpenedConversationEntity,
  UpdateConversationInput,
} from './types';

interface ConversationRow {
  id: number;
  project_id: string;
  title: string;
  agent_type: string;
  status: string;
  external_id: string | null;
  parent_id: number | null;
  message_count: number;
  session_stats_json: string | null;
  created_at: string;
  updated_at: string;
}

interface OpenedConversationRow {
  project_id: string;
  conversation_id: number | null;
  updated_at: string;
}

interface ConversationTurnRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  created_at: string;
  agent_id: string | null;
  agent_name: string | null;
}

function mapConversationRow(row: ConversationRow): ConversationEntity {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    agentType: row.agent_type,
    status: row.status as ConversationEntity['status'],
    externalId: row.external_id,
    parentId: row.parent_id,
    messageCount: row.message_count,
    sessionStatsJson: row.session_stats_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOpenedConversationRow(row: OpenedConversationRow): OpenedConversationEntity {
  return {
    projectId: row.project_id,
    conversationId: row.conversation_id,
    updatedAt: row.updated_at,
  };
}

function mapConversationTurnRow(row: ConversationTurnRow): ConversationTurnEntity {
  let blocks: ConversationTurnBlock[];
  try {
    blocks = JSON.parse(row.content) as ConversationTurnBlock[];
  } catch {
    blocks = [{ type: 'text', text: row.content }];
  }

  const entity: ConversationTurnEntity = {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    blocks,
    createdAt: row.created_at,
  };

  if (row.agent_id != null) {
    entity.agentId = row.agent_id;
  }
  if (row.agent_name != null) {
    entity.agentName = row.agent_name;
  }

  return entity;
}

function createMonotonicUpdatedAt(previousUpdatedAt: string, now = new Date()): string {
  const nowMs = now.getTime();
  const previousMs = Date.parse(previousUpdatedAt);
  if (Number.isNaN(previousMs) || nowMs > previousMs) {
    return now.toISOString();
  }
  return new Date(previousMs + 1).toISOString();
}

export class ConversationRepository {
  constructor(private readonly db: ConversationDatabase) {}

  createConversation(input: CreateConversationInput): ConversationEntity {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO conversation (
          project_id, title, agent_type, status, external_id, parent_id,
          message_count, session_stats_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.projectId,
        input.title,
        input.agentType,
        input.status,
        input.externalId ?? null,
        input.parentId ?? null,
        input.messageCount ?? 0,
        input.sessionStatsJson ?? null,
        now,
        now,
      );

    const created = this.db
      .prepare('SELECT * FROM conversation WHERE id = last_insert_rowid()')
      .get() as ConversationRow | undefined;
    if (!created) {
      throw new Error('Failed to create conversation');
    }
    return mapConversationRow(created);
  }

  listConversations(projectId: string): ConversationEntity[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM conversation
        WHERE project_id = ?
        ORDER BY datetime(updated_at) DESC, id DESC
        `,
      )
      .all(projectId) as ConversationRow[];
    return rows.map(mapConversationRow);
  }

  getConversationById(conversationId: number): ConversationEntity | null {
    const row = this.db
      .prepare('SELECT * FROM conversation WHERE id = ?')
      .get(conversationId) as ConversationRow | undefined;
    return row ? mapConversationRow(row) : null;
  }

  getConversationDetail(conversationId: number): ConversationDetailEntity | null {
    const conversation = this.getConversationById(conversationId);
    if (!conversation) {
      return null;
    }

    const turns = this.db
      .prepare(
        `
        SELECT *
        FROM conversation_turn
        WHERE conversation_id = ?
        ORDER BY id ASC
        `,
      )
      .all(conversationId) as ConversationTurnRow[];

    return {
      ...conversation,
      turns: turns.map(mapConversationTurnRow),
    };
  }

  setOpenedConversation(projectId: string, conversationId: number | null): OpenedConversationEntity {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO project_opened_conversation (project_id, conversation_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id)
        DO UPDATE SET conversation_id = excluded.conversation_id, updated_at = excluded.updated_at
        `,
      )
      .run(projectId, conversationId, now);

    const row = this.db
      .prepare('SELECT * FROM project_opened_conversation WHERE project_id = ?')
      .get(projectId) as OpenedConversationRow | undefined;
    if (!row) {
      throw new Error('Failed to persist opened conversation');
    }
    return mapOpenedConversationRow(row);
  }

  getOpenedConversation(projectId: string): OpenedConversationEntity | null {
    const row = this.db
      .prepare('SELECT * FROM project_opened_conversation WHERE project_id = ?')
      .get(projectId) as OpenedConversationRow | undefined;
    return row ? mapOpenedConversationRow(row) : null;
  }

  forkConversation(input: ForkConversationInput): ConversationEntity {
    return withTransaction(this.db, () => {
      const source = this.getConversationById(input.sourceConversationId);
      if (!source) {
        throw new Error(`Conversation ${input.sourceConversationId} not found`);
      }

      const now = new Date().toISOString();
      this.db
        .prepare(
          `
          INSERT INTO conversation (
            project_id, title, agent_type, status, external_id, parent_id,
            message_count, session_stats_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          source.projectId,
          input.title,
          source.agentType,
          'draft_local',
          null,
          source.id,
          source.messageCount,
          null,
          now,
          now,
        );

      const created = this.db
        .prepare('SELECT * FROM conversation WHERE id = last_insert_rowid()')
        .get() as ConversationRow | undefined;
      if (!created) {
        throw new Error('Failed to fork conversation');
      }
      return mapConversationRow(created);
    });
  }

  updateConversation(conversationId: number, patch: UpdateConversationInput): ConversationEntity {
    const current = this.getConversationById(conversationId);
    if (!current) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const updatedAt = createMonotonicUpdatedAt(current.updatedAt);
    this.db
      .prepare(
        `
        UPDATE conversation
        SET
          title = ?,
          status = ?,
          external_id = ?,
          message_count = ?,
          session_stats_json = ?,
          updated_at = ?
        WHERE id = ?
        `,
      )
      .run(
        patch.title ?? current.title,
        patch.status ?? current.status,
        patch.externalId !== undefined ? patch.externalId : current.externalId,
        patch.messageCount ?? current.messageCount,
        patch.sessionStatsJson !== undefined ? patch.sessionStatsJson : current.sessionStatsJson,
        updatedAt,
        conversationId,
      );

    const updated = this.getConversationById(conversationId);
    if (!updated) {
      throw new Error(`Conversation ${conversationId} disappeared after update`);
    }
    return updated;
  }

  appendConversationTurn(
    conversationId: number,
    input: AppendConversationTurnInput,
  ): AppendConversationTurnResult {
    return withTransaction(this.db, () => {
      const current = this.getConversationById(conversationId);
      if (!current) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      const now = new Date().toISOString();
      const updatedAt = createMonotonicUpdatedAt(current.updatedAt);
      this.db
        .prepare(
          `
          INSERT INTO conversation_turn (
            conversation_id, role, content, created_at, agent_id, agent_name
          ) VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          conversationId,
          input.role,
          JSON.stringify(input.blocks),
          now,
          input.agentId ?? null,
          input.agentName ?? null,
        );

      this.db
        .prepare(
          `
          UPDATE conversation
          SET
            status = ?,
            message_count = ?,
            session_stats_json = ?,
            updated_at = ?
          WHERE id = ?
          `,
        )
        .run(
          'active',
          current.messageCount + 1,
          input.sessionStatsJson !== undefined ? input.sessionStatsJson : current.sessionStatsJson,
          updatedAt,
          conversationId,
        );

      const row = this.db
        .prepare('SELECT * FROM conversation_turn WHERE id = last_insert_rowid()')
        .get() as ConversationTurnRow | undefined;
      if (!row) {
        throw new Error('Failed to append conversation turn');
      }

      const updatedConversation = this.getConversationById(conversationId);
      if (!updatedConversation) {
        throw new Error(`Conversation ${conversationId} disappeared after appending turn`);
      }

      return {
        conversation: updatedConversation,
        turn: mapConversationTurnRow(row),
      };
    });
  }

  deleteConversation(conversationId: number): void {
    this.db.prepare('DELETE FROM conversation WHERE id = ?').run(conversationId);
  }
}

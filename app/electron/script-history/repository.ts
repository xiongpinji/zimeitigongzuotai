import type { ScriptHistoryDatabase } from './db';
import type {
  CreateVersionInput,
  ListVersionsOptions,
  ScriptVersionEntity,
  ScriptVersionSummary,
  VersionSource,
} from './types';

interface ScriptVersionRow {
  id: number;
  project_id: string;
  file_name: string;
  content: string;
  source: string;
  provider_id: string | null;
  provider_name: string | null;
  model_name: string | null;
  label: string | null;
  byte_size: number;
  created_at: string;
}

function mapRowToEntity(row: ScriptVersionRow): ScriptVersionEntity {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    content: row.content,
    source: row.source as VersionSource,
    providerId: row.provider_id,
    providerName: row.provider_name,
    modelName: row.model_name,
    label: row.label,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

function mapRowToSummary(row: ScriptVersionRow): ScriptVersionSummary {
  return {
    id: row.id,
    fileName: row.file_name,
    source: row.source as VersionSource,
    providerName: row.provider_name,
    modelName: row.model_name,
    label: row.label,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

export class ScriptHistoryRepository {
  constructor(private readonly db: ScriptHistoryDatabase) {}

  insert(input: CreateVersionInput): ScriptVersionSummary {
    const now = new Date().toISOString();
    const byteSize = Buffer.byteLength(input.content, 'utf8');

    this.db
      .prepare(
        `
        INSERT INTO script_version (
          project_id, file_name, content, source,
          provider_id, provider_name, model_name, label,
          byte_size, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.projectId,
        input.fileName,
        input.content,
        input.source,
        input.providerId ?? null,
        input.providerName ?? null,
        input.modelName ?? null,
        null,
        byteSize,
        now,
      );

    const row = this.db
      .prepare('SELECT * FROM script_version WHERE id = last_insert_rowid()')
      .get() as ScriptVersionRow | undefined;
    if (!row) {
      throw new Error('Failed to insert script version');
    }
    return mapRowToSummary(row);
  }

  getById(versionId: number): ScriptVersionEntity | null {
    const row = this.db
      .prepare('SELECT * FROM script_version WHERE id = ?')
      .get(versionId) as ScriptVersionRow | undefined;
    return row ? mapRowToEntity(row) : null;
  }

  list(projectId: string, fileName: string, opts?: ListVersionsOptions): ScriptVersionSummary[] {
    const { sourceFilter, limit = 50, offset = 0 } = opts ?? {};

    let sql = `
      SELECT id, project_id, file_name, source, provider_id, provider_name,
             model_name, label, byte_size, created_at, '' AS content
      FROM script_version
      WHERE project_id = ? AND file_name = ?
    `;
    const params: unknown[] = [projectId, fileName];

    if (sourceFilter && sourceFilter.length > 0) {
      const placeholders = sourceFilter.map(() => '?').join(', ');
      sql += ` AND source IN (${placeholders})`;
      params.push(...sourceFilter);
    }

    sql += ' ORDER BY created_at DESC, id DESC';
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as ScriptVersionRow[];
    return rows.map(mapRowToSummary);
  }

  getLatestContent(projectId: string, fileName: string): string | null {
    const row = this.db
      .prepare(
        `
        SELECT content
        FROM script_version
        WHERE project_id = ? AND file_name = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        `,
      )
      .get(projectId, fileName) as { content: string } | undefined;
    return row ? row.content : null;
  }

  countAll(projectId: string, fileName: string): number {
    const row = this.db
      .prepare(
        `
        SELECT COUNT(*) AS cnt
        FROM script_version
        WHERE project_id = ? AND file_name = ?
        `,
      )
      .get(projectId, fileName) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  getOldestManualIds(projectId: string, fileName: string, limit: number): number[] {
    const rows = this.db
      .prepare(
        `
        SELECT id
        FROM script_version
        WHERE project_id = ? AND file_name = ? AND source IN ('manual', 'external')
        ORDER BY created_at ASC, id ASC
        LIMIT ?
        `,
      )
      .all(projectId, fileName, limit) as Array<{ id: number }>;
    return rows.map((row) => row.id);
  }

  deleteByIds(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(`DELETE FROM script_version WHERE id IN (${placeholders})`)
      .run(...ids);
  }

  updateLabel(versionId: number, label: string | null): void {
    this.db
      .prepare('UPDATE script_version SET label = ? WHERE id = ?')
      .run(label, versionId);
  }

  deleteById(versionId: number): void {
    this.db.prepare('DELETE FROM script_version WHERE id = ?').run(versionId);
  }
}

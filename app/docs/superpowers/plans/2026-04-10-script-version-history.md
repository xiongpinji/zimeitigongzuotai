# 稿件版本历史 + 多 Provider 模型切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 写稿工作台增加稿件版本历史（SQLite 快照 + 浏览/回滚 UI）和全局多 Provider 模型切换能力。

**Architecture:** 版本历史使用 `node:sqlite`（复用 `electron/conversations/` 的 db → repository → service → ipc 四层模式），存储在 `{projectDir}/.acp/script-history.sqlite3`。Provider 配置扩展现有 `AISettings`（全局 `settings.json`），写稿页面通过下拉选择 Provider/模型。UI 层新增 VersionDropdown（内嵌下拉 + 只读预览）和 ModelSelector（按 Provider 分组）。

**Tech Stack:** Node.js `node:sqlite` DatabaseSync / Zustand / React / Electron IPC / LangChain ChatOpenAI

**Spec:** `docs/superpowers/specs/2026-04-10-script-version-history-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `electron/script-history/types.ts` | 版本历史类型定义（VersionSource, Entity, Summary, Input） |
| `electron/script-history/db.ts` | SQLite 数据库创建/获取 |
| `electron/script-history/migrations.ts` | Schema 迁移 |
| `electron/script-history/repository.ts` | SQL 读写操作 |
| `electron/script-history/service.ts` | 业务逻辑（创建、淘汰、回滚） |
| `electron/script-history/ipc.ts` | IPC 通道注册 |
| `tests/script-history-db.test.ts` | DB + migrations 测试 |
| `tests/script-history-service.test.ts` | Service 逻辑测试 |
| `src/components/script/VersionDropdown.tsx` | 版本下拉组件 |
| `src/components/script/VersionPreviewBar.tsx` | 预览模式横幅 |
| `src/components/script/ModelSelector.tsx` | Provider/模型选择器 |
| `src/components/settings/ProviderListSection.tsx` | 设置页 Provider 列表 + 增删改 |
| `tests/provider-migration.test.ts` | AISettings Provider 迁移测试 |

### Modified Files

| File | Changes |
|------|---------|
| `src/types/ai.ts` | 新增 `LLMProvider` 接口，扩展 `AISettings` |
| `src/lib/llm/model.ts` | `createChatModel` 签名改为 `(provider, model, options?)` |
| `src/lib/llm/index.ts` | `generateText` / `streamText` / `generateStructuredData` 适配新签名 |
| `src/lib/script-utils.ts` | 生成/审稿函数接入 Provider 参数 |
| `src/lib/script-persistence.ts` | `saveAllDirtyFiles` 内触发版本创建 |
| `src/store/script.ts` | 新增 `historyPreview` + `selectedProviderId` / `selectedModel` |
| `src/store/ai.ts` | `loadAISettings` 加 Provider 迁移逻辑 |
| `src/lib/electron-api.ts` | 新增 `scriptHistory` API 类型 |
| `electron/preload.ts` | 暴露 `scriptHistoryAPI` |
| `electron/main.ts` | 注册 `registerScriptHistoryIpc` |
| `src/components/settings/AIConfigTab.tsx` | 替换为 Provider 列表管理 |
| `src/components/script/QuickActionBar.tsx` | 嵌入 ModelSelector |
| `src/components/script/FileTabs.tsx` | 嵌入 VersionDropdown 按钮 |
| `src/pages/ScriptWorkbench.tsx` | 集成版本创建触发 + 预览模式 |
| `src/hooks/useAIVideoWorkflow.ts` | 适配新 `createChatModel` 签名 |
| `src/hooks/useAICardInspector.ts` | 适配新 `createChatModel` 签名 |

---

## Task 1: 版本历史类型定义

**Files:**
- Create: `electron/script-history/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// electron/script-history/types.ts

export type VersionSource = 'ai_generate' | 'ai_review' | 'ai_rewrite' | 'manual';

export interface ScriptVersionEntity {
  id: number;
  projectId: string;
  fileName: string;
  content: string;
  source: VersionSource;
  providerId: string | null;
  providerName: string | null;
  modelName: string | null;
  label: string | null;
  byteSize: number;
  createdAt: string;
}

/** 列表查询用（不含 content，减少 IPC 传输量） */
export interface ScriptVersionSummary {
  id: number;
  fileName: string;
  source: VersionSource;
  providerName: string | null;
  modelName: string | null;
  label: string | null;
  byteSize: number;
  createdAt: string;
}

export interface CreateVersionInput {
  projectId: string;
  fileName: string;
  content: string;
  source: VersionSource;
  providerId?: string | null;
  providerName?: string | null;
  modelName?: string | null;
}

export interface ListVersionsOptions {
  sourceFilter?: VersionSource[];
  limit?: number;
  offset?: number;
}

export interface RollbackResult {
  rollbackContent: string;
  savedCurrentVersionId: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/script-history/types.ts
git commit -m "feat(script-history): 版本历史类型定义"
```

---

## Task 2: SQLite 数据库 + 迁移

**Files:**
- Create: `electron/script-history/db.ts`
- Create: `electron/script-history/migrations.ts`
- Create: `tests/script-history-db.test.ts`

- [ ] **Step 1: 编写 DB 测试**

```typescript
// tests/script-history-db.test.ts
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
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC")
    .all()
    .map((row) => row.name);
}

function getColumns(
  db: { prepare: (sql: string) => { all: () => Array<{ name: string; notnull: number }> } },
  table: string,
): Array<{ name: string; notnull: number }> {
  return db.prepare(`PRAGMA table_info(${table});`).all();
}

describe('script-history db migrations', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves db path under .acp/', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sh-db-'));
    tempDirs.push(tempDir);
    const dbPath = resolveScriptHistoryDbPath(tempDir);
    expect(dbPath).toBe(path.join(tempDir, '.acp', SCRIPT_HISTORY_DB_FILENAME));
  });

  it('creates script_version table with required columns', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sh-db-'));
    tempDirs.push(tempDir);
    const db = createScriptHistoryDb(tempDir);

    const tables = listTables(db);
    expect(tables).toContain('script_version');

    const columns = getColumns(db, 'script_version');
    const names = columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id', 'project_id', 'file_name', 'content', 'source',
        'provider_id', 'provider_name', 'model_name', 'label',
        'byte_size', 'created_at',
      ]),
    );
    expect(columns.find((c) => c.name === 'project_id')?.notnull).toBe(1);
    expect(columns.find((c) => c.name === 'content')?.notnull).toBe(1);
    expect(columns.find((c) => c.name === 'source')?.notnull).toBe(1);

    db.close();
  });

  it('is idempotent — running migrations twice does not error', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sh-db-'));
    tempDirs.push(tempDir);
    const db1 = createScriptHistoryDb(tempDir);
    db1.close();
    const db2 = createScriptHistoryDb(tempDir);
    const tables = listTables(db2);
    expect(tables).toContain('script_version');
    db2.close();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/script-history-db.test.ts
```

Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 db.ts**

```typescript
// electron/script-history/db.ts
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
```

- [ ] **Step 4: 实现 migrations.ts**

```typescript
// electron/script-history/migrations.ts
import type { ScriptHistoryDatabase } from './db';

const CURRENT_SCHEMA_VERSION = 1;

export function runScriptHistoryMigrations(db: ScriptHistoryDatabase): void {
  const schemaVersion = db.prepare('PRAGMA user_version;').get() as { user_version?: number };
  const userVersion = schemaVersion.user_version ?? 0;
  if (userVersion >= CURRENT_SCHEMA_VERSION) return;

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
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
npx vitest run tests/script-history-db.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add electron/script-history/db.ts electron/script-history/migrations.ts tests/script-history-db.test.ts
git commit -m "feat(script-history): SQLite 数据库创建与 schema 迁移"
```

---

## Task 3: Repository 层

**Files:**
- Create: `electron/script-history/repository.ts`

- [ ] **Step 1: 实现 repository**

```typescript
// electron/script-history/repository.ts
import type { ScriptHistoryDatabase } from './db';
import type {
  CreateVersionInput,
  ListVersionsOptions,
  ScriptVersionEntity,
  ScriptVersionSummary,
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
    source: row.source as ScriptVersionEntity['source'],
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
    source: row.source as ScriptVersionSummary['source'],
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
    const byteSize = Buffer.byteLength(input.content, 'utf-8');
    this.db
      .prepare(
        `INSERT INTO script_version
          (project_id, file_name, content, source, provider_id, provider_name, model_name, label, byte_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        input.projectId,
        input.fileName,
        input.content,
        input.source,
        input.providerId ?? null,
        input.providerName ?? null,
        input.modelName ?? null,
        byteSize,
        now,
      );

    const row = this.db
      .prepare('SELECT * FROM script_version WHERE id = last_insert_rowid()')
      .get() as ScriptVersionRow;
    return mapRowToSummary(row);
  }

  getById(versionId: number): ScriptVersionEntity | null {
    const row = this.db
      .prepare('SELECT * FROM script_version WHERE id = ?')
      .get(versionId) as ScriptVersionRow | undefined;
    return row ? mapRowToEntity(row) : null;
  }

  list(projectId: string, fileName: string, opts?: ListVersionsOptions): ScriptVersionSummary[] {
    const conditions = ['project_id = ?', 'file_name = ?'];
    const params: unknown[] = [projectId, fileName];

    if (opts?.sourceFilter && opts.sourceFilter.length > 0) {
      const placeholders = opts.sourceFilter.map(() => '?').join(', ');
      conditions.push(`source IN (${placeholders})`);
      params.push(...opts.sourceFilter);
    }

    const limit = opts?.limit ?? 200;
    const offset = opts?.offset ?? 0;

    const sql = `
      SELECT id, project_id, file_name, '' AS content, source,
             provider_id, provider_name, model_name, label, byte_size, created_at
      FROM script_version
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as ScriptVersionRow[];
    return rows.map(mapRowToSummary);
  }

  /** 获取最新一条版本的 content（用于去重比对） */
  getLatestContent(projectId: string, fileName: string): string | null {
    const row = this.db
      .prepare(
        `SELECT content FROM script_version
         WHERE project_id = ? AND file_name = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(projectId, fileName) as { content: string } | undefined;
    return row?.content ?? null;
  }

  countAll(projectId: string, fileName: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM script_version WHERE project_id = ? AND file_name = ?')
      .get(projectId, fileName) as { cnt: number };
    return row.cnt;
  }

  /** 获取最旧的 manual 版本 ID 列表（用于淘汰） */
  getOldestManualIds(projectId: string, fileName: string, limit: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM script_version
         WHERE project_id = ? AND file_name = ? AND source = 'manual'
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
      )
      .all(projectId, fileName, limit) as Array<{ id: number }>;
    return rows.map((r) => r.id);
  }

  deleteByIds(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.db.prepare(`DELETE FROM script_version WHERE id IN (${placeholders})`).run(...ids);
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
```

- [ ] **Step 2: Commit**

```bash
git add electron/script-history/repository.ts
git commit -m "feat(script-history): Repository 层 SQL 读写"
```

---

## Task 4: Service 层（含淘汰 + 回滚逻辑）

**Files:**
- Create: `electron/script-history/service.ts`
- Create: `tests/script-history-service.test.ts`

- [ ] **Step 1: 编写 Service 测试**

```typescript
// tests/script-history-service.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createScriptHistoryDb } from '../electron/script-history/db';
import { ScriptHistoryRepository } from '../electron/script-history/repository';
import { ScriptHistoryService } from '../electron/script-history/service';

function createTestService() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sh-svc-'));
  const db = createScriptHistoryDb(tempDir);
  const repo = new ScriptHistoryRepository(db);
  const svc = new ScriptHistoryService(repo);
  return { tempDir, db, svc };
}

describe('ScriptHistoryService', () => {
  const cleanup: Array<{ tempDir: string; db: { close: () => void } }> = [];

  afterEach(() => {
    while (cleanup.length > 0) {
      const item = cleanup.pop();
      if (item) {
        item.db.close();
        rmSync(item.tempDir, { recursive: true, force: true });
      }
    }
  });

  it('creates a version and returns summary', () => {
    const { tempDir, db, svc } = createTestService();
    cleanup.push({ tempDir, db });

    const summary = svc.createVersion({
      projectId: '/test/project',
      fileName: 'script.md',
      content: '# Hello',
      source: 'manual',
    });

    expect(summary).toMatchObject({
      fileName: 'script.md',
      source: 'manual',
      providerName: null,
    });
    expect(summary.id).toBeGreaterThan(0);
    expect(summary.byteSize).toBe(Buffer.byteLength('# Hello', 'utf-8'));
  });

  it('skips duplicate content', () => {
    const { tempDir, db, svc } = createTestService();
    cleanup.push({ tempDir, db });

    const v1 = svc.createVersion({
      projectId: '/p',
      fileName: 'script.md',
      content: 'same',
      source: 'manual',
    });
    const v2 = svc.createVersion({
      projectId: '/p',
      fileName: 'script.md',
      content: 'same',
      source: 'manual',
    });

    expect(v2.id).toBe(v1.id); // 去重，返回已有版本
  });

  it('evicts oldest manual versions when exceeding max', () => {
    const { tempDir, db, svc } = createTestService();
    cleanup.push({ tempDir, db });

    // 用小上限测试
    (svc as unknown as { maxVersions: number }).maxVersions = 5;

    // 创建 3 个 AI + 4 个 manual = 7 个版本（超过 5）
    for (let i = 0; i < 3; i++) {
      svc.createVersion({
        projectId: '/p',
        fileName: 'script.md',
        content: `ai-${i}`,
        source: 'ai_generate',
        providerName: 'test',
        modelName: 'gpt-4o',
      });
    }
    for (let i = 0; i < 4; i++) {
      svc.createVersion({
        projectId: '/p',
        fileName: 'script.md',
        content: `manual-${i}`,
        source: 'manual',
      });
    }

    const versions = svc.listVersions('/p', 'script.md');
    // 应保留 3 个 AI + 2 个最新 manual = 5
    expect(versions.length).toBe(5);
    const aiCount = versions.filter((v) => v.source === 'ai_generate').length;
    expect(aiCount).toBe(3); // AI 版本不被淘汰
  });

  it('prepareRollback saves current content and returns target', () => {
    const { tempDir, db, svc } = createTestService();
    cleanup.push({ tempDir, db });

    const v1 = svc.createVersion({
      projectId: '/p',
      fileName: 'script.md',
      content: 'version-1',
      source: 'ai_generate',
    });

    svc.createVersion({
      projectId: '/p',
      fileName: 'script.md',
      content: 'version-2-current',
      source: 'manual',
    });

    const result = svc.prepareRollback(v1.id, 'version-2-current', '/p', 'script.md');
    expect(result.rollbackContent).toBe('version-1');
    expect(result.savedCurrentVersionId).toBeGreaterThan(0);

    // 验证回滚前自动保存了当前内容
    const saved = svc.getVersion(result.savedCurrentVersionId);
    expect(saved?.content).toBe('version-2-current');
    expect(saved?.label).toBe('回滚前自动保存');
  });

  it('listVersions with sourceFilter', () => {
    const { tempDir, db, svc } = createTestService();
    cleanup.push({ tempDir, db });

    svc.createVersion({ projectId: '/p', fileName: 'script.md', content: 'a', source: 'ai_generate' });
    svc.createVersion({ projectId: '/p', fileName: 'script.md', content: 'b', source: 'manual' });
    svc.createVersion({ projectId: '/p', fileName: 'script.md', content: 'c', source: 'ai_review' });

    const aiOnly = svc.listVersions('/p', 'script.md', {
      sourceFilter: ['ai_generate', 'ai_review', 'ai_rewrite'],
    });
    expect(aiOnly.length).toBe(2);
    expect(aiOnly.every((v) => v.source !== 'manual')).toBe(true);
  });

  it('updateLabel and deleteVersion', () => {
    const { tempDir, db, svc } = createTestService();
    cleanup.push({ tempDir, db });

    const v = svc.createVersion({ projectId: '/p', fileName: 'script.md', content: 'x', source: 'manual' });
    svc.updateLabel(v.id, '好版本');
    const updated = svc.getVersion(v.id);
    expect(updated?.label).toBe('好版本');

    svc.deleteVersion(v.id);
    expect(svc.getVersion(v.id)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/script-history-service.test.ts
```

Expected: FAIL — `ScriptHistoryService` 不存在

- [ ] **Step 3: 实现 service.ts**

```typescript
// electron/script-history/service.ts
import { withTransaction } from './db';
import type { ScriptHistoryDatabase } from './db';
import { ScriptHistoryRepository } from './repository';
import type {
  CreateVersionInput,
  ListVersionsOptions,
  RollbackResult,
  ScriptVersionEntity,
  ScriptVersionSummary,
} from './types';

export class ScriptHistoryService {
  private maxVersions = 100;

  constructor(private readonly repository: ScriptHistoryRepository) {}

  createVersion(input: CreateVersionInput): ScriptVersionSummary {
    // 去重：与最新版本比对内容
    const latestContent = this.repository.getLatestContent(input.projectId, input.fileName);
    if (latestContent !== null && latestContent === input.content) {
      // 内容相同，返回最新版本的 summary
      const existing = this.repository.list(input.projectId, input.fileName, { limit: 1 });
      if (existing.length > 0) return existing[0];
    }

    const summary = this.repository.insert(input);
    this.evict(input.projectId, input.fileName);
    return summary;
  }

  listVersions(
    projectId: string,
    fileName: string,
    opts?: ListVersionsOptions,
  ): ScriptVersionSummary[] {
    return this.repository.list(projectId, fileName, opts);
  }

  getVersion(versionId: number): ScriptVersionEntity | null {
    return this.repository.getById(versionId);
  }

  prepareRollback(
    versionId: number,
    currentContent: string,
    projectId: string,
    fileName: string,
  ): RollbackResult {
    const target = this.repository.getById(versionId);
    if (!target) {
      throw new Error(`Version ${versionId} not found`);
    }

    // 先为当前内容建一个安全快照
    const saved = this.repository.insert({
      projectId,
      fileName,
      content: currentContent,
      source: 'manual',
    });

    // 给安全快照加标签
    this.repository.updateLabel(saved.id, '回滚前自动保存');

    return {
      rollbackContent: target.content,
      savedCurrentVersionId: saved.id,
    };
  }

  updateLabel(versionId: number, label: string | null): void {
    this.repository.updateLabel(versionId, label);
  }

  deleteVersion(versionId: number): void {
    this.repository.deleteById(versionId);
  }

  private evict(projectId: string, fileName: string): void {
    const total = this.repository.countAll(projectId, fileName);
    if (total <= this.maxVersions) return;

    const excess = total - this.maxVersions;
    const idsToDelete = this.repository.getOldestManualIds(projectId, fileName, excess);
    if (idsToDelete.length > 0) {
      this.repository.deleteByIds(idsToDelete);
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run tests/script-history-service.test.ts
```

Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add electron/script-history/service.ts tests/script-history-service.test.ts
git commit -m "feat(script-history): Service 层（创建/去重/淘汰/回滚）"
```

---

## Task 5: IPC 通道注册 + Preload + Renderer API

**Files:**
- Create: `electron/script-history/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts:1043-1045`
- Modify: `src/lib/electron-api.ts:84-181`

- [ ] **Step 1: 实现 ipc.ts**

```typescript
// electron/script-history/ipc.ts
import { ipcMain } from 'electron';
import { createScriptHistoryDb, type ScriptHistoryDatabase } from './db';
import { ScriptHistoryRepository } from './repository';
import { ScriptHistoryService } from './service';
import type { CreateVersionInput, ListVersionsOptions } from './types';

interface ScriptHistoryRuntime {
  db: ScriptHistoryDatabase;
  service: ScriptHistoryService;
}

const runtimes = new Map<string, ScriptHistoryRuntime>();

function getRuntime(projectId: string): ScriptHistoryRuntime {
  const existing = runtimes.get(projectId);
  if (existing) return existing;

  const db = createScriptHistoryDb(projectId);
  const repository = new ScriptHistoryRepository(db);
  const service = new ScriptHistoryService(repository);
  const runtime = { db, service };
  runtimes.set(projectId, runtime);
  return runtime;
}

export function registerScriptHistoryIpc(): void {
  ipcMain.handle(
    'script-history:create',
    async (_event, input: CreateVersionInput) => {
      const runtime = getRuntime(input.projectId);
      return runtime.service.createVersion(input);
    },
  );

  ipcMain.handle(
    'script-history:list',
    async (_event, projectId: string, fileName: string, opts?: ListVersionsOptions) => {
      const runtime = getRuntime(projectId);
      return runtime.service.listVersions(projectId, fileName, opts);
    },
  );

  ipcMain.handle(
    'script-history:get',
    async (_event, projectId: string, versionId: number) => {
      const runtime = getRuntime(projectId);
      return runtime.service.getVersion(versionId);
    },
  );

  ipcMain.handle(
    'script-history:rollback',
    async (
      _event,
      versionId: number,
      currentContent: string,
      projectId: string,
      fileName: string,
    ) => {
      const runtime = getRuntime(projectId);
      return runtime.service.prepareRollback(versionId, currentContent, projectId, fileName);
    },
  );

  ipcMain.handle(
    'script-history:update-label',
    async (_event, projectId: string, versionId: number, label: string | null) => {
      const runtime = getRuntime(projectId);
      runtime.service.updateLabel(versionId, label);
    },
  );

  ipcMain.handle(
    'script-history:delete',
    async (_event, projectId: string, versionId: number) => {
      const runtime = getRuntime(projectId);
      runtime.service.deleteVersion(versionId);
    },
  );
}
```

- [ ] **Step 2: 在 main.ts 注册 IPC**

在 `electron/main.ts` 的 import 区域添加：

```typescript
import { registerScriptHistoryIpc } from './script-history/ipc';
```

在现有注册行（约行 1043-1045 `registerAgentIpc / registerConversationIpc / registerMcpIpc`）后追加：

```typescript
registerScriptHistoryIpc();
```

- [ ] **Step 3: 在 preload.ts 暴露 scriptHistoryAPI**

在 `electron/preload.ts` 末尾（现有 `contextBridge.exposeInMainWorld` 块之后）添加：

```typescript
contextBridge.exposeInMainWorld('scriptHistoryAPI', {
  create: (input: {
    projectId: string;
    fileName: string;
    content: string;
    source: string;
    providerId?: string | null;
    providerName?: string | null;
    modelName?: string | null;
  }) => ipcRenderer.invoke('script-history:create', input),
  list: (projectId: string, fileName: string, opts?: {
    sourceFilter?: string[];
    limit?: number;
    offset?: number;
  }) => ipcRenderer.invoke('script-history:list', projectId, fileName, opts),
  get: (projectId: string, versionId: number) =>
    ipcRenderer.invoke('script-history:get', projectId, versionId),
  rollback: (versionId: number, currentContent: string, projectId: string, fileName: string) =>
    ipcRenderer.invoke('script-history:rollback', versionId, currentContent, projectId, fileName),
  updateLabel: (projectId: string, versionId: number, label: string | null) =>
    ipcRenderer.invoke('script-history:update-label', projectId, versionId, label),
  delete: (projectId: string, versionId: number) =>
    ipcRenderer.invoke('script-history:delete', projectId, versionId),
});
```

- [ ] **Step 4: 在 electron-api.ts 添加类型**

在 `src/lib/electron-api.ts` 中，在 `ElectronAPI` 接口之后、`declare global` 之前添加：

```typescript
export interface ScriptHistoryAPI {
  create(input: {
    projectId: string;
    fileName: string;
    content: string;
    source: string;
    providerId?: string | null;
    providerName?: string | null;
    modelName?: string | null;
  }): Promise<{
    id: number;
    fileName: string;
    source: string;
    providerName: string | null;
    modelName: string | null;
    label: string | null;
    byteSize: number;
    createdAt: string;
  }>;
  list(projectId: string, fileName: string, opts?: {
    sourceFilter?: string[];
    limit?: number;
    offset?: number;
  }): Promise<Array<{
    id: number;
    fileName: string;
    source: string;
    providerName: string | null;
    modelName: string | null;
    label: string | null;
    byteSize: number;
    createdAt: string;
  }>>;
  get(projectId: string, versionId: number): Promise<{
    id: number;
    projectId: string;
    fileName: string;
    content: string;
    source: string;
    providerId: string | null;
    providerName: string | null;
    modelName: string | null;
    label: string | null;
    byteSize: number;
    createdAt: string;
  } | null>;
  rollback(versionId: number, currentContent: string, projectId: string, fileName: string): Promise<{
    rollbackContent: string;
    savedCurrentVersionId: number;
  }>;
  updateLabel(projectId: string, versionId: number, label: string | null): Promise<void>;
  delete(projectId: string, versionId: number): Promise<void>;
}
```

在 `declare global` 块中的 `Window` 接口添加：

```typescript
scriptHistoryAPI: ScriptHistoryAPI;
```

- [ ] **Step 5: Commit**

```bash
git add electron/script-history/ipc.ts electron/main.ts electron/preload.ts src/lib/electron-api.ts
git commit -m "feat(script-history): IPC 通道 + preload 暴露 + Renderer 类型"
```

---

## Task 6: LLMProvider 类型 + AISettings 扩展

**Files:**
- Modify: `src/types/ai.ts:60-79`
- Create: `tests/provider-migration.test.ts`
- Modify: `src/store/ai.ts:98-150`

- [ ] **Step 1: 编写 Provider 迁移测试**

```typescript
// tests/provider-migration.test.ts
import { describe, expect, it } from 'vitest';
import { migrateToProviders, resolveProvider } from '../src/lib/llm/provider-utils';
import type { AISettings, LLMProvider } from '../src/types/ai';

describe('migrateToProviders', () => {
  it('creates a default provider from legacy fields', () => {
    const legacy: Partial<AISettings> = {
      llmBaseUrl: 'https://api.deepseek.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'deepseek-chat',
      llmProviders: [],
      defaultProviderId: null,
      defaultModel: null,
    };

    const result = migrateToProviders(legacy as AISettings);
    expect(result.llmProviders).toHaveLength(1);
    expect(result.llmProviders[0].baseUrl).toBe('https://api.deepseek.com/v1');
    expect(result.llmProviders[0].apiKey).toBe('sk-test');
    expect(result.llmProviders[0].models).toContain('deepseek-chat');
    expect(result.defaultProviderId).toBe(result.llmProviders[0].id);
    expect(result.defaultModel).toBe('deepseek-chat');
  });

  it('does nothing if providers already exist', () => {
    const existing: Partial<AISettings> = {
      llmBaseUrl: '',
      llmApiKey: '',
      llmModel: '',
      llmProviders: [{ id: 'p1', name: 'Test', type: 'openai_compatible', baseUrl: 'http://x', apiKey: 'k', models: ['m1'] }],
      defaultProviderId: 'p1',
      defaultModel: 'm1',
    };

    const result = migrateToProviders(existing as AISettings);
    expect(result.llmProviders).toHaveLength(1);
    expect(result.llmProviders[0].id).toBe('p1');
  });

  it('infers provider name from baseUrl', () => {
    const legacy: Partial<AISettings> = {
      llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'gpt-4o',
      llmProviders: [],
      defaultProviderId: null,
      defaultModel: null,
    };

    const result = migrateToProviders(legacy as AISettings);
    expect(result.llmProviders[0].name).toBe('OpenAI');
  });
});

describe('resolveProvider', () => {
  const providers: LLMProvider[] = [
    { id: 'p1', name: 'DeepSeek', type: 'openai_compatible', baseUrl: 'http://a', apiKey: 'k1', models: ['ds-chat'] },
    { id: 'p2', name: 'OpenAI', type: 'openai_compatible', baseUrl: 'http://b', apiKey: 'k2', models: ['gpt-4o'] },
  ];

  it('resolves by id', () => {
    const result = resolveProvider(providers, 'p2', null);
    expect(result?.id).toBe('p2');
  });

  it('returns null for unknown id', () => {
    expect(resolveProvider(providers, 'unknown', null)).toBeNull();
  });

  it('falls back to defaultProviderId', () => {
    const result = resolveProvider(providers, null, 'p1');
    expect(result?.id).toBe('p1');
  });

  it('returns first provider when no id or default', () => {
    const result = resolveProvider(providers, null, null);
    expect(result?.id).toBe('p1');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/provider-migration.test.ts
```

Expected: FAIL — 模块不存在

- [ ] **Step 3: 在 ai.ts 中添加 LLMProvider 和扩展 AISettings**

在 `src/types/ai.ts` 的 `AISettings` 接口之前添加：

```typescript
/** 单个 LLM Provider 配置 */
export interface LLMProvider {
  id: string;
  name: string;
  type: 'openai_compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  models: string[];
}
```

在 `AISettings` 接口中，在 `llmBaseUrl` 之前添加：

```typescript
  // 多 Provider
  llmProviders: LLMProvider[];
  defaultProviderId: string | null;
  defaultModel: string | null;
```

- [ ] **Step 4: 创建 provider-utils.ts**

```typescript
// src/lib/llm/provider-utils.ts
import type { AISettings, LLMProvider } from '../../types/ai';

/** 从 baseUrl 推断 Provider 名称 */
function inferProviderName(baseUrl: string): string {
  const lower = baseUrl.toLowerCase();
  if (lower.includes('deepseek')) return 'DeepSeek';
  if (lower.includes('openai')) return 'OpenAI';
  if (lower.includes('anthropic')) return 'Anthropic';
  if (lower.includes('moonshot') || lower.includes('kimi')) return 'Moonshot';
  if (lower.includes('dashscope') || lower.includes('qwen')) return 'Qwen';
  if (lower.includes('zhipu') || lower.includes('bigmodel')) return 'ZhipuAI';
  try {
    const host = new URL(baseUrl).hostname;
    return host.split('.').slice(-2, -1)[0] ?? 'Custom';
  } catch {
    return 'Custom';
  }
}

function generateId(): string {
  // 简易 uuid，不引入额外依赖
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 如果 llmProviders 为空但旧字段有值，自动迁移为一个默认 Provider。
 * 返回更新后的 settings 片段。
 */
export function migrateToProviders(settings: AISettings): AISettings {
  if (settings.llmProviders && settings.llmProviders.length > 0) {
    return settings;
  }

  if (!settings.llmBaseUrl) {
    return { ...settings, llmProviders: [], defaultProviderId: null, defaultModel: null };
  }

  const provider: LLMProvider = {
    id: generateId(),
    name: inferProviderName(settings.llmBaseUrl),
    type: 'openai_compatible',
    baseUrl: settings.llmBaseUrl,
    apiKey: settings.llmApiKey,
    models: settings.llmModel ? [settings.llmModel] : [],
  };

  return {
    ...settings,
    llmProviders: [provider],
    defaultProviderId: provider.id,
    defaultModel: settings.llmModel || null,
  };
}

/** 根据 providerId 或 defaultProviderId 解析 Provider */
export function resolveProvider(
  providers: LLMProvider[],
  providerId: string | null,
  defaultProviderId: string | null,
): LLMProvider | null {
  if (providers.length === 0) return null;

  if (providerId) {
    return providers.find((p) => p.id === providerId) ?? null;
  }

  if (defaultProviderId) {
    return providers.find((p) => p.id === defaultProviderId) ?? null;
  }

  return providers[0];
}
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
npx vitest run tests/provider-migration.test.ts
```

Expected: 6 tests PASS

- [ ] **Step 6: 在 loadAISettings 中集成迁移**

修改 `src/store/ai.ts` 中的 `loadAISettings` 函数。在成功读取 settings 后（约行 104-115），加入迁移调用：

在文件顶部添加 import：

```typescript
import { migrateToProviders } from '../lib/llm/provider-utils';
```

在 `loadAISettings` 函数的 `return` 之前（约行 104 后），添加迁移逻辑：

```typescript
// 在构建 settings 对象后，执行 Provider 迁移
let settings: AISettings = {
  ...file.aiSettings,
  enableThinking: file.aiSettings.enableThinking ?? true,
  llmProviders: file.aiSettings.llmProviders ?? [],
  defaultProviderId: file.aiSettings.defaultProviderId ?? null,
  defaultModel: file.aiSettings.defaultModel ?? null,
  minimaxApiKey: file.aiSettings.minimaxApiKey ?? '',
  minimaxVoiceId: file.aiSettings.minimaxVoiceId ?? 'male-qn-qingse',
  minimaxSpeed: file.aiSettings.minimaxSpeed ?? 1.0,
  minimaxVol: file.aiSettings.minimaxVol ?? 1.0,
  minimaxPitch: file.aiSettings.minimaxPitch ?? 0,
  minimaxEmotion: file.aiSettings.minimaxEmotion ?? '',
  minimaxModel: file.aiSettings.minimaxModel ?? 'speech-2.8-hd',
};

// Provider 自动迁移
const migrated = migrateToProviders(settings);
if (migrated.llmProviders.length > 0 && settings.llmProviders.length === 0) {
  settings = migrated;
  // 持久化迁移结果
  void saveAISettings(settings);
}

return settings;
```

- [ ] **Step 7: Commit**

```bash
git add src/types/ai.ts src/lib/llm/provider-utils.ts src/store/ai.ts tests/provider-migration.test.ts
git commit -m "feat(ai-settings): LLMProvider 类型 + 旧字段自动迁移"
```

---

## Task 7: createChatModel 重构 + 消费方适配

**Files:**
- Modify: `src/lib/llm/model.ts`
- Modify: `src/lib/llm/index.ts`
- Modify: `src/lib/script-utils.ts`
- Modify: `src/hooks/useAIVideoWorkflow.ts`（查找 `createChatModel` 调用）
- Modify: `src/hooks/useAICardInspector.ts`（查找 `createChatModel` 调用）

- [ ] **Step 1: 重构 createChatModel 签名**

将 `src/lib/llm/model.ts` 改为：

```typescript
import { ChatOpenAI } from '@langchain/openai';
import type { AISettings, LLMProvider } from '../../types/ai';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * 从 Provider + 模型名创建 ChatOpenAI 实例。
 * 新的首选入口。
 */
export function createChatModelFromProvider(
  provider: LLMProvider,
  model: string,
  options?: { enableThinking?: boolean },
): ChatOpenAI {
  const modelKwargs =
    options?.enableThinking === false
      ? { extra_body: { enable_thinking: false } }
      : undefined;

  return new ChatOpenAI({
    apiKey: provider.apiKey,
    model,
    temperature: 0.3,
    configuration: {
      apiKey: provider.apiKey,
      baseURL: normalizeBaseUrl(provider.baseUrl),
    },
    ...(modelKwargs ? { modelKwargs } : {}),
  });
}

/**
 * 兼容入口：从 AISettings 的 legacy 字段创建模型。
 * 供尚未迁移到 Provider 模式的调用方使用。
 */
export function createChatModel(settings: AISettings): ChatOpenAI {
  const modelKwargs =
    settings.enableThinking === false
      ? { extra_body: { enable_thinking: false } }
      : undefined;

  return new ChatOpenAI({
    apiKey: settings.llmApiKey,
    model: settings.llmModel,
    temperature: 0.3,
    configuration: {
      apiKey: settings.llmApiKey,
      baseURL: normalizeBaseUrl(settings.llmBaseUrl),
    },
    ...(modelKwargs ? { modelKwargs } : {}),
  });
}
```

- [ ] **Step 2: 在 llm/index.ts 中增加 Provider 版本的函数**

在 `src/lib/llm/index.ts` 中，添加 import 和新函数：

在文件顶部 import 区追加：

```typescript
import { createChatModelFromProvider } from './model';
import type { LLMProvider } from '../../types/ai';
```

在文件末尾追加：

```typescript
export async function streamTextWithProvider(
  provider: LLMProvider,
  model: string,
  systemPrompt: string,
  userMessage: string,
  onChunk: (chunk: string) => void,
  options?: { enableThinking?: boolean } & StreamCallbacks,
): Promise<string> {
  const chatModel = createChatModelFromProvider(provider, model, {
    enableThinking: options?.enableThinking,
  });
  const stream = await chatModel.stream(buildPromptMessages(systemPrompt, userMessage));
  let fullText = '';

  for await (const chunk of stream) {
    const reasoningChunk = extractReasoningContent(chunk);
    if (reasoningChunk) {
      options?.onReasoningChunk?.(reasoningChunk);
    }

    const textChunk = extractTextContent(chunk.content);
    if (!textChunk) continue;

    fullText += textChunk;
    onChunk(textChunk);
  }

  return assertNonEmptyContent(fullText, 'LLM 流式返回空内容');
}
```

- [ ] **Step 3: 适配 script-utils.ts**

修改 `src/lib/script-utils.ts` 中的 `generateScriptDraftStream` 函数，增加可选的 Provider 参数：

在文件顶部 import 区追加：

```typescript
import { streamTextWithProvider } from './llm';
import type { LLMProvider } from '../types/ai';
import { resolveProvider } from './llm/provider-utils';
```

修改 `generateScriptDraftStream` 签名和实现（保持向后兼容）：

```typescript
export async function generateScriptDraftStream(
  originalText: string,
  templateId: string,
  roleId: string | undefined,
  onChunk: (chunk: string) => void,
  options?: {
    onReasoningChunk?: (chunk: string) => void;
    provider?: LLMProvider;
    model?: string;
  },
): Promise<string> {
  const template = getAnyTemplateById(templateId);
  if (!template) {
    throw new Error('未找到选中的写稿模板');
  }

  const settings = await loadAISettings();
  if (!settings) {
    throw new Error('请先在 AI 设置中配置 LLM');
  }

  let systemPrompt = template.systemPrompt;
  if (roleId && roleId !== 'none') {
    const role = getRoleById(roleId);
    if (role?.rolePrompt) {
      systemPrompt = `【角色设定】\n${role.rolePrompt}\n\n【写作要求】\n${systemPrompt}`;
    }
  }

  // 优先使用传入的 Provider，否则走 legacy 路径
  if (options?.provider && options.model) {
    return streamTextWithProvider(
      options.provider,
      options.model,
      systemPrompt,
      originalText,
      onChunk,
      { enableThinking: settings.enableThinking, onReasoningChunk: options?.onReasoningChunk },
    );
  }

  // Legacy 路径
  if (!settings.llmApiKey) {
    throw new Error('请先在 AI 设置中配置 LLM API Key');
  }
  return streamText(settings, systemPrompt, originalText, onChunk, options);
}
```

同理修改 `runScriptReviewStream`，增加可选 Provider 参数：

```typescript
export async function runScriptReviewStream(
  scriptText: string,
  onChunk: (chunk: string) => void,
  options?: {
    onReasoningChunk?: (chunk: string) => void;
    provider?: LLMProvider;
    model?: string;
  },
): Promise<Annotation[]> {
  const settings = await loadAISettings();
  if (!settings) {
    throw new Error('请先在 AI 设置中配置 LLM');
  }

  const userCriteria = loadReviewCriteria();
  const systemPrompt = userCriteria.trim()
    ? `${REVIEW_SYSTEM_PROMPT}\n\n用户补充的审查要求：\n${userCriteria}`
    : REVIEW_SYSTEM_PROMPT;

  let fullText: string;
  if (options?.provider && options.model) {
    fullText = await streamTextWithProvider(
      options.provider,
      options.model,
      systemPrompt,
      scriptText,
      onChunk,
      { enableThinking: settings.enableThinking, onReasoningChunk: options?.onReasoningChunk },
    );
  } else {
    if (!settings.llmApiKey) {
      throw new Error('请先在 AI 设置中配置 LLM API Key');
    }
    fullText = await streamText(settings, systemPrompt, scriptText, onChunk, options);
  }

  const payload = parseLLMJsonResponse(fullText);
  return parseAnnotations(payload, scriptText);
}
```

- [ ] **Step 4: 确认编译通过**

```bash
npx tsc --noEmit
```

Expected: 无类型错误（`useAIVideoWorkflow` 和 `useAICardInspector` 仍使用旧的 `createChatModel(settings)` 路径，保持兼容）

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/model.ts src/lib/llm/index.ts src/lib/script-utils.ts
git commit -m "refactor(llm): createChatModelFromProvider + 写稿函数适配 Provider 参数"
```

---

## Task 8: Script Store 扩展

**Files:**
- Modify: `src/store/script.ts`

- [ ] **Step 1: 添加新状态和 actions**

在 `src/store/script.ts` 的 `ScriptState` 接口（约行 76-117）中追加：

```typescript
  /** 版本历史预览状态 */
  historyPreview: {
    active: boolean;
    versionId: number | null;
    content: string | null;
    versionMeta: {
      id: number;
      fileName: string;
      source: string;
      providerName: string | null;
      modelName: string | null;
      label: string | null;
      byteSize: number;
      createdAt: string;
    } | null;
  };
  /** 当前选中的 Provider ID（项目级） */
  selectedProviderId: string | null;
  /** 当前选中的模型名（项目级） */
  selectedModel: string | null;
```

在 `ScriptActions` 接口（约行 119-179）中追加：

```typescript
  enterHistoryPreview: (versionId: number, content: string, meta: ScriptState['historyPreview']['versionMeta']) => void;
  exitHistoryPreview: () => void;
  setSelectedProvider: (providerId: string | null, model: string | null) => void;
```

在 `initialState`（约行 182-239）中追加：

```typescript
  historyPreview: {
    active: false,
    versionId: null,
    content: null,
    versionMeta: null,
  },
  selectedProviderId: null,
  selectedModel: null,
```

在 store create 函数中追加 actions：

```typescript
  enterHistoryPreview: (versionId, content, meta) =>
    set({
      historyPreview: { active: true, versionId, content, versionMeta: meta },
      editorAgent: { readOnly: true, virtualCursorPos: null, streamingActive: false },
    }),

  exitHistoryPreview: () =>
    set({
      historyPreview: { active: false, versionId: null, content: null, versionMeta: null },
      editorAgent: { readOnly: false, virtualCursorPos: null, streamingActive: false },
    }),

  setSelectedProvider: (providerId, model) =>
    set({ selectedProviderId: providerId, selectedModel: model }),
```

- [ ] **Step 2: 在 auto-save 订阅中持久化 selectedProviderId/Model**

在文件末尾的 `useScriptStore.subscribe` 中（约行 502-521），在 `scriptSection` 对象中追加两个字段：

```typescript
  const scriptSection = {
    templateId: state.selectedTemplate,
    annotations: state.annotations,
    reviewState: state.reviewState,
    lastReviewedDocVersion: state.scriptDocVersion,
    selectedProviderId: state.selectedProviderId,
    selectedModel: state.selectedModel,
  };
```

并在 `changed` 检测中追加：

```typescript
    state.selectedProviderId !== prevState.selectedProviderId ||
    state.selectedModel !== prevState.selectedModel;
```

- [ ] **Step 3: Commit**

```bash
git add src/store/script.ts
git commit -m "feat(script-store): 版本预览状态 + Provider/Model 选择持久化"
```

---

## Task 9: 手动保存时触发版本创建

**Files:**
- Modify: `src/lib/script-persistence.ts:121-138`

- [ ] **Step 1: 在 saveAllDirtyFiles 中插入版本创建**

修改 `src/lib/script-persistence.ts` 中的 `saveAllDirtyFiles` 函数，在文件保存后触发版本快照：

```typescript
export async function saveAllDirtyFiles(
  projectDir: string,
  fileDirtyMap: Record<string, boolean>,
  getText: (file: string) => string,
): Promise<void> {
  const dirtyFiles = Object.entries(fileDirtyMap)
    .filter(([, dirty]) => dirty)
    .map(([file]) => file);

  for (const file of dirtyFiles) {
    const content = getText(file);
    savingFiles.add(file);
    try {
      await window.electronAPI.saveScriptFile(projectDir, file, content);
    } finally {
      setTimeout(() => savingFiles.delete(file), 500);
    }

    // 为 script.md 创建版本快照
    if (file === 'script.md' && typeof window !== 'undefined' && window.scriptHistoryAPI) {
      void window.scriptHistoryAPI.create({
        projectId: projectDir,
        fileName: file,
        content,
        source: 'manual',
      });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/script-persistence.ts
git commit -m "feat(script-persistence): 手动保存时自动创建版本快照"
```

---

## Task 10: ModelSelector 组件

**Files:**
- Create: `src/components/script/ModelSelector.tsx`

- [ ] **Step 1: 实现 ModelSelector**

```tsx
// src/components/script/ModelSelector.tsx
import { useState, useEffect, useRef } from 'react';
import { loadAISettings } from '../../store/ai';
import { useScriptStore } from '../../store/script';
import type { LLMProvider } from '../../types/ai';

export function ModelSelector() {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedProviderId = useScriptStore((s) => s.selectedProviderId);
  const selectedModel = useScriptStore((s) => s.selectedModel);
  const setSelectedProvider = useScriptStore((s) => s.setSelectedProvider);

  useEffect(() => {
    void loadAISettings().then((settings) => {
      if (!settings) return;
      const list = settings.llmProviders ?? [];
      setProviders(list);

      // 如果没有选中的 provider，使用默认
      if (!selectedProviderId && list.length > 0) {
        const defaultP = list.find((p) => p.id === settings.defaultProviderId) ?? list[0];
        const defaultM = settings.defaultModel ?? defaultP.models[0] ?? null;
        setSelectedProvider(defaultP.id, defaultM);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentProvider = providers.find((p) => p.id === selectedProviderId);
  const displayLabel = currentProvider
    ? `${currentProvider.name} / ${selectedModel ?? '未选择'}`
    : '选择模型';

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'transparent',
          color: '#ebebf5cc',
          fontSize: 12,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 13 }}>🤖</span>
        {displayLabel}
        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 220,
            background: '#1c1c1e',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            zIndex: 100,
            padding: '6px 0',
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          {providers.map((provider) => (
            <div key={provider.id}>
              <div
                style={{
                  padding: '6px 12px 2px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#ebebf580',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {provider.name}
              </div>
              {provider.models.map((model) => {
                const isActive = selectedProviderId === provider.id && selectedModel === model;
                return (
                  <button
                    key={model}
                    type="button"
                    onClick={() => {
                      setSelectedProvider(provider.id, model);
                      setOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '6px 12px 6px 20px',
                      border: 'none',
                      background: isActive ? 'rgba(10,132,255,0.15)' : 'transparent',
                      color: isActive ? '#0A84FF' : '#ebebf5cc',
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 14, fontSize: 12 }}>{isActive ? '●' : '○'}</span>
                    {model}
                  </button>
                );
              })}
            </div>
          ))}

          {providers.length === 0 && (
            <div style={{ padding: '12px', fontSize: 12, color: '#ebebf560', textAlign: 'center' }}>
              尚未配置 Provider，请前往系统设置添加
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 在 QuickActionBar 中嵌入**

在 `src/components/script/QuickActionBar.tsx` 顶部添加 import：

```typescript
import { ModelSelector } from './ModelSelector';
```

在"有原稿无口播稿"场景的"AI 生成"按钮旁插入 `<ModelSelector />`（根据现有代码约在角色选择器同一行）。同理在"有口播稿"的"重新生成"按钮旁也加入。

具体位置需参考现有 JSX 结构，在角色选择器 `<select>` 之后、生成按钮之前插入：

```tsx
<ModelSelector />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/script/ModelSelector.tsx src/components/script/QuickActionBar.tsx
git commit -m "feat(ui): ModelSelector 组件 + QuickActionBar 集成"
```

---

## Task 11: VersionDropdown + VersionPreviewBar 组件

**Files:**
- Create: `src/components/script/VersionDropdown.tsx`
- Create: `src/components/script/VersionPreviewBar.tsx`

- [ ] **Step 1: 实现 VersionDropdown**

```tsx
// src/components/script/VersionDropdown.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useScriptStore } from '../../store/script';

type VersionSummary = {
  id: number;
  fileName: string;
  source: string;
  providerName: string | null;
  modelName: string | null;
  label: string | null;
  byteSize: number;
  createdAt: string;
};

type SourceFilter = 'all' | 'ai' | 'manual';

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'ai_generate': return 'AI 生成';
    case 'ai_review': return 'AI 审稿';
    case 'ai_rewrite': return 'AI 重写';
    default: return '手动保存';
  }
}

function isAISource(source: string): boolean {
  return source.startsWith('ai_');
}

export function VersionDropdown() {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const ref = useRef<HTMLDivElement>(null);

  const projectDir = useScriptStore((s) => s.projectDir);
  const openedFile = useScriptStore((s) => s.openedFile);
  const scriptText = useScriptStore((s) => s.scriptText);
  const enterPreview = useScriptStore((s) => s.enterHistoryPreview);

  const loadVersions = useCallback(async () => {
    if (!projectDir || !window.scriptHistoryAPI) return;
    const sourceFilter =
      filter === 'ai' ? ['ai_generate', 'ai_review', 'ai_rewrite'] :
      filter === 'manual' ? ['manual'] :
      undefined;
    const list = await window.scriptHistoryAPI.list(projectDir, 'script.md', { sourceFilter });
    setVersions(list);
  }, [projectDir, filter]);

  useEffect(() => {
    if (open) void loadVersions();
  }, [open, loadVersions]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 仅 script.md 打开时显示
  if (openedFile !== 'script.md') return null;

  const handleSelect = async (v: VersionSummary) => {
    if (!projectDir) return;
    const full = await window.scriptHistoryAPI.get(projectDir, v.id);
    if (!full) return;
    enterPreview(v.id, full.content, v);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          color: '#0A84FF',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        🕐 历史版本
        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            width: 320,
            background: '#1c1c1e',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            zIndex: 200,
            maxHeight: 400,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* 筛选器 */}
          <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {(['all', 'ai', 'manual'] as SourceFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: 'none',
                  background: filter === f ? 'rgba(10,132,255,0.2)' : 'transparent',
                  color: filter === f ? '#0A84FF' : '#ebebf580',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {f === 'all' ? '全部' : f === 'ai' ? '仅 AI' : '仅手动'}
              </button>
            ))}
          </div>

          {/* 版本列表 */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {versions.length === 0 && (
              <div style={{ padding: 16, fontSize: 12, color: '#ebebf560', textAlign: 'center' }}>
                暂无历史版本
              </div>
            )}
            {versions.map((v, i) => (
              <button
                key={v.id}
                type="button"
                onClick={() => void handleSelect(v)}
                style={{
                  display: 'flex',
                  width: '100%',
                  padding: '8px 10px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                {/* 左侧竖线 */}
                <div style={{
                  width: 3,
                  minHeight: 32,
                  borderRadius: 2,
                  background: isAISource(v.source) ? '#a78bfa' : '#8e8e93',
                  flexShrink: 0,
                }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12 }}>{isAISource(v.source) ? '🤖' : '✏️'}</span>
                    <span style={{ fontSize: 12, color: '#ebebf5cc' }}>{formatTime(v.createdAt)}</span>
                    {i === 0 && (
                      <span style={{ fontSize: 10, color: '#ebebf560', marginLeft: 'auto' }}>(当前版本)</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#ebebf580', marginTop: 2 }}>
                    {sourceLabel(v.source)}
                    {v.providerName && v.modelName ? ` · ${v.providerName} / ${v.modelName}` : ''}
                  </div>
                  {v.label && (
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      <span style={{ color: '#ffd60a' }}>⭐</span>
                      <span style={{ color: '#ebebf5cc', marginLeft: 4 }}>{v.label}</span>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 实现 VersionPreviewBar**

```tsx
// src/components/script/VersionPreviewBar.tsx
import { useState } from 'react';
import { useScriptStore } from '../../store/script';

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'ai_generate': return 'AI 生成';
    case 'ai_review': return 'AI 审稿';
    case 'ai_rewrite': return 'AI 重写';
    default: return '手动保存';
  }
}

export function VersionPreviewBar() {
  const preview = useScriptStore((s) => s.historyPreview);
  const projectDir = useScriptStore((s) => s.projectDir);
  const scriptText = useScriptStore((s) => s.scriptText);
  const setScriptText = useScriptStore((s) => s.setScriptText);
  const exitPreview = useScriptStore((s) => s.exitHistoryPreview);
  const markReviewStale = useScriptStore((s) => s.markReviewStale);
  const setFileDirty = useScriptStore((s) => s.setFileDirty);

  const [labelInput, setLabelInput] = useState('');
  const [editingLabel, setEditingLabel] = useState(false);

  if (!preview.active || !preview.versionMeta) return null;

  const meta = preview.versionMeta;

  const handleRollback = async () => {
    if (!projectDir || preview.versionId === null) return;

    const result = await window.scriptHistoryAPI.rollback(
      preview.versionId,
      scriptText,
      projectDir,
      'script.md',
    );

    setScriptText(result.rollbackContent);
    setFileDirty('script.md', true);
    markReviewStale();
    exitPreview();

    // 保存到磁盘
    await window.electronAPI.saveScriptFile(projectDir, 'script.md', result.rollbackContent);
  };

  const handleSaveLabel = async () => {
    if (!projectDir || preview.versionId === null) return;
    await window.scriptHistoryAPI.updateLabel(projectDir, preview.versionId, labelInput || null);
    setEditingLabel(false);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: '#332b00',
        borderBottom: '1px solid rgba(255,214,10,0.2)',
        fontSize: 13,
        color: '#ebebf5cc',
        flexShrink: 0,
      }}
    >
      <span style={{ color: '#ffd60a' }}>⚠️</span>
      <span>正在预览历史版本 — {formatTime(meta.createdAt)}</span>
      <span style={{ fontSize: 11, color: '#ebebf580' }}>
        {sourceLabel(meta.source)}
        {meta.providerName && meta.modelName ? ` · ${meta.providerName} / ${meta.modelName}` : ''}
      </span>

      {meta.label && (
        <span style={{ fontSize: 11 }}>
          <span style={{ color: '#ffd60a' }}>⭐</span> {meta.label}
        </span>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        {editingLabel ? (
          <>
            <input
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="输入标签"
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.05)',
                color: '#fff',
                fontSize: 12,
                width: 100,
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveLabel();
                if (e.key === 'Escape') setEditingLabel(false);
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => void handleSaveLabel()}
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                border: 'none',
                background: '#0A84FF',
                color: '#fff',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              保存
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setLabelInput(meta.label ?? '');
              setEditingLabel(true);
            }}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent',
              color: '#ebebf5cc',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            添加标签
          </button>
        )}

        <button
          type="button"
          onClick={() => void handleRollback()}
          style={{
            padding: '4px 12px',
            borderRadius: 6,
            border: 'none',
            background: '#0071e3',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          恢复此版本
        </button>

        <button
          type="button"
          onClick={exitPreview}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent',
            color: '#0A84FF',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          返回当前
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/script/VersionDropdown.tsx src/components/script/VersionPreviewBar.tsx
git commit -m "feat(ui): VersionDropdown 历史下拉 + VersionPreviewBar 预览横幅"
```

---

## Task 12: 设置页 Provider 管理 UI

**Files:**
- Create: `src/components/settings/ProviderListSection.tsx`
- Modify: `src/components/settings/AIConfigTab.tsx`

- [ ] **Step 1: 实现 ProviderListSection**

```tsx
// src/components/settings/ProviderListSection.tsx
import { useState } from 'react';
import { Field, Input, Switch } from '../../ui';
import type { LLMProvider } from '../../types/ai';

interface Props {
  providers: LLMProvider[];
  defaultProviderId: string | null;
  onChange: (providers: LLMProvider[], defaultId: string | null) => void;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface ProviderFormData {
  name: string;
  type: 'openai_compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  models: string[];
  isDefault: boolean;
}

function ProviderDialog({
  initial,
  isDefault,
  onSave,
  onCancel,
}: {
  initial?: LLMProvider;
  isDefault: boolean;
  onSave: (data: ProviderFormData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ProviderFormData>({
    name: initial?.name ?? '',
    type: initial?.type ?? 'openai_compatible',
    baseUrl: initial?.baseUrl ?? '',
    apiKey: initial?.apiKey ?? '',
    models: initial?.models ?? [''],
    isDefault,
  });

  const [newModel, setNewModel] = useState('');

  const addModel = () => {
    if (newModel.trim()) {
      setForm((f) => ({ ...f, models: [...f.models, newModel.trim()] }));
      setNewModel('');
    }
  };

  const removeModel = (idx: number) => {
    setForm((f) => ({ ...f, models: f.models.filter((_, i) => i !== idx) }));
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: '#2c2c2e',
          borderRadius: 12,
          padding: 24,
          width: 420,
          maxHeight: '80vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#fff' }}>
          {initial ? '编辑 Provider' : '添加 AI Provider'}
        </h3>

        <Field label="名称">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="DeepSeek" />
        </Field>

        <Field label="类型">
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ProviderFormData['type'] }))}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: '#1c1c1e',
              color: '#fff',
              fontSize: 13,
            }}
          >
            <option value="openai_compatible">OpenAI 兼容</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </Field>

        <Field label="API 地址">
          <Input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.deepseek.com/v1" />
        </Field>

        <Field label="API Key">
          <Input type="password" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder="sk-..." />
        </Field>

        <div>
          <div style={{ fontSize: 13, color: '#ebebf5cc', marginBottom: 6 }}>模型列表</div>
          {form.models.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <span style={{ flex: 1, fontSize: 13, color: '#fff', padding: '4px 0' }}>{m}</span>
              <button
                type="button"
                onClick={() => removeModel(i)}
                style={{ border: 'none', background: 'none', color: '#ff453a', cursor: 'pointer', fontSize: 14 }}
              >
                ×
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <Input
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder="输入模型名称"
              onKeyDown={(e) => { if (e.key === 'Enter') addModel(); }}
            />
            <button
              type="button"
              onClick={addModel}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'transparent',
                color: '#0A84FF',
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              + 添加
            </button>
          </div>
        </div>

        <Field label="设为默认 Provider">
          <Switch checked={form.isDefault} onChange={(v) => setForm((f) => ({ ...f, isDefault: v }))} />
        </Field>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#ebebf5cc', fontSize: 13, cursor: 'pointer' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(form)}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#0A84FF', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProviderListSection({ providers, defaultProviderId, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const handleSave = (data: ProviderFormData, existingId?: string) => {
    const id = existingId ?? generateId();
    const updated: LLMProvider = {
      id,
      name: data.name,
      type: data.type,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
      models: data.models.filter(Boolean),
    };

    let newProviders: LLMProvider[];
    if (existingId) {
      newProviders = providers.map((p) => (p.id === existingId ? updated : p));
    } else {
      newProviders = [...providers, updated];
    }

    const newDefault = data.isDefault ? id : (defaultProviderId === existingId && !data.isDefault ? null : defaultProviderId);
    onChange(newProviders, newDefault);
    setEditingId(null);
    setAdding(false);
  };

  const handleDelete = (id: string) => {
    const next = providers.filter((p) => p.id !== id);
    const nextDefault = defaultProviderId === id ? (next[0]?.id ?? null) : defaultProviderId;
    onChange(next, nextDefault);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {providers.map((p) => (
        <div
          key={p.id}
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, color: defaultProviderId === p.id ? '#0A84FF' : '#ebebf580' }}>
              {defaultProviderId === p.id ? '●' : '○'}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{p.name}</span>
            {defaultProviderId === p.id && (
              <span style={{ fontSize: 10, color: '#0A84FF', marginLeft: 4 }}>⭐ 默认</span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setEditingId(p.id)}
                style={{ border: 'none', background: 'none', color: '#0A84FF', fontSize: 12, cursor: 'pointer' }}
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => handleDelete(p.id)}
                style={{ border: 'none', background: 'none', color: '#ff453a', fontSize: 12, cursor: 'pointer' }}
              >
                删除
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#ebebf560', paddingLeft: 22 }}>
            {p.baseUrl}
          </div>
          <div style={{ fontSize: 11, color: '#ebebf580', paddingLeft: 22 }}>
            模型: {p.models.join(', ') || '未配置'}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setAdding(true)}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 16px',
          borderRadius: 6,
          border: '1px dashed rgba(255,255,255,0.15)',
          background: 'transparent',
          color: '#0A84FF',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        + 添加 Provider
      </button>

      {adding && (
        <ProviderDialog
          isDefault={providers.length === 0}
          onSave={(data) => handleSave(data)}
          onCancel={() => setAdding(false)}
        />
      )}

      {editingId && (() => {
        const p = providers.find((x) => x.id === editingId);
        if (!p) return null;
        return (
          <ProviderDialog
            initial={p}
            isDefault={defaultProviderId === p.id}
            onSave={(data) => handleSave(data, p.id)}
            onCancel={() => setEditingId(null)}
          />
        );
      })()}
    </div>
  );
}
```

- [ ] **Step 2: 重构 AIConfigTab 集成 ProviderListSection**

将 `src/components/settings/AIConfigTab.tsx` 中原有的 LLM 三字段（baseUrl / apiKey / model）替换为 `ProviderListSection`。保留即梦、思考模式等字段不变。

在 import 区添加：

```typescript
import { ProviderListSection } from './ProviderListSection';
import type { LLMProvider } from '../../types/ai';
```

添加新的 state：

```typescript
const [providers, setProviders] = useState<LLMProvider[]>([]);
const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
const [defaultModel, setDefaultModel] = useState<string | null>(null);
```

在 `useEffect` 的 `loadAISettings` 回调中加载 Provider 数据：

```typescript
setProviders(settings?.llmProviders ?? []);
setDefaultProviderId(settings?.defaultProviderId ?? null);
setDefaultModel(settings?.defaultModel ?? null);
```

在 `handleSave` 中包含 Provider 数据：

```typescript
const handleSave = () => {
  void loadAISettings().then((current) => {
    void saveAISettings({
      ...(current ?? { minimaxApiKey: '', minimaxVoiceId: 'male-qn-qingse', minimaxSpeed: 1.0 }),
      llmProviders: providers,
      defaultProviderId,
      defaultModel,
      llmBaseUrl: current?.llmBaseUrl ?? '',
      llmApiKey: current?.llmApiKey ?? '',
      llmModel: current?.llmModel ?? '',
      enableThinking,
      jimengApiUrl,
      jimengSessionId,
      jimengModel,
    }).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  });
};
```

在 JSX 中，将原有三个 LLM 字段替换为：

```tsx
<ProviderListSection
  providers={providers}
  defaultProviderId={defaultProviderId}
  onChange={(p, defaultId) => {
    setProviders(p);
    setDefaultProviderId(defaultId);
  }}
/>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/ProviderListSection.tsx src/components/settings/AIConfigTab.tsx
git commit -m "feat(settings): Provider 列表管理 UI + AIConfigTab 重构"
```

---

## Task 13: ScriptWorkbench 集成

**Files:**
- Modify: `src/pages/ScriptWorkbench.tsx`
- Modify: `src/components/script/FileTabs.tsx`

- [ ] **Step 1: 在 FileTabs 中插入 VersionDropdown**

在 `src/components/script/FileTabs.tsx` 顶部添加 import：

```typescript
import { VersionDropdown } from './VersionDropdown';
```

在组件返回的 JSX 中，标签页列表之后、容器闭合之前，插入：

```tsx
<div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
  <VersionDropdown />
</div>
```

- [ ] **Step 2: 在 ScriptWorkbench 中集成 VersionPreviewBar + AI 版本创建**

在 `src/pages/ScriptWorkbench.tsx` 顶部添加 import：

```typescript
import { VersionPreviewBar } from '../components/script/VersionPreviewBar';
import { resolveProvider } from '../lib/llm/provider-utils';
import { loadAISettings } from '../store/ai';
```

在编辑器区域顶部（约在 `<FileTabs>` 之后）插入：

```tsx
<VersionPreviewBar />
```

在编辑器渲染逻辑中，当 `historyPreview.active` 时，传入 `historyPreview.content` 而非 `scriptText` 作为编辑器内容。具体位置取决于现有的编辑器 value prop 传递方式 — 在 ScriptEditor 的 value 或 doc 属性处做条件判断：

```typescript
const editorContent = historyPreview.active ? (historyPreview.content ?? '') : scriptText;
```

在 `runInternalGenerateScript` 完成后（`finally` 块前），添加版本创建调用：

```typescript
// AI 生成完成后创建版本
if (projectDir && result && window.scriptHistoryAPI) {
  const settings = await loadAISettings();
  const provider = settings
    ? resolveProvider(settings.llmProviders, selectedProviderId, settings.defaultProviderId)
    : null;
  void window.scriptHistoryAPI.create({
    projectId: projectDir,
    fileName: 'script.md',
    content: result,
    source: 'ai_generate',
    providerId: provider?.id ?? null,
    providerName: provider?.name ?? null,
    modelName: selectedModel ?? settings?.defaultModel ?? null,
  });
}
```

在生成调用中传入 Provider 参数（`generateScriptDraftStream` 调用处）：

```typescript
const settings = await loadAISettings();
const provider = settings
  ? resolveProvider(settings.llmProviders, selectedProviderId, settings.defaultProviderId)
  : null;

const result = await generateScriptDraftStream(
  originalText,
  selectedTemplate,
  selectedRole,
  onChunk,
  {
    onReasoningChunk,
    provider: provider ?? undefined,
    model: selectedModel ?? undefined,
  },
);
```

- [ ] **Step 3: 确认编译通过**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/ScriptWorkbench.tsx src/components/script/FileTabs.tsx
git commit -m "feat(workbench): 集成版本预览 + AI 生成版本记录 + Provider 传参"
```

---

## Task 14: 全量测试验证 + 最终提交

**Files:** (验证，不新增)

- [ ] **Step 1: 运行所有新增测试**

```bash
npx vitest run tests/script-history-db.test.ts tests/script-history-service.test.ts tests/provider-migration.test.ts
```

Expected: 全部 PASS

- [ ] **Step 2: 运行全量测试套件**

```bash
npm test
```

Expected: 无新增失败。如有既有测试因 `AISettings` 类型变化失败，需在 mock 中补上 `llmProviders: []`、`defaultProviderId: null`、`defaultModel: null` 字段。

- [ ] **Step 3: 修复可能的类型错误**

```bash
npx tsc --noEmit
```

逐一修复 `AISettings` 缺少新字段的类型错误 — 在所有构造 `AISettings` 对象的地方（主要是测试 mock）补充默认值。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(tests): 适配版本历史 + 多 Provider 类型变更的测试修复"
```

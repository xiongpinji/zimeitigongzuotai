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
  const cleanups: Array<{ db: { close(): void }; tempDir: string }> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const item = cleanups.pop();
      if (item) {
        item.db.close();
        rmSync(item.tempDir, { recursive: true, force: true });
      }
    }
  });

  it('creates a version and returns summary', () => {
    const { tempDir, db, svc } = createTestService();
    cleanups.push({ db, tempDir });

    const summary = svc.createVersion({
      projectId: 'proj-1',
      fileName: 'script.md',
      content: 'Hello world',
      source: 'manual',
    });

    expect(summary.id).toBeGreaterThan(0);
    expect(summary.source).toBe('manual');
    expect(summary.byteSize).toBe(Buffer.byteLength('Hello world', 'utf8'));
    expect(summary.label).toBeNull();
  });

  it('skips duplicate content and returns the existing version id', () => {
    const { tempDir, db, svc } = createTestService();
    cleanups.push({ db, tempDir });

    const first = svc.createVersion({
      projectId: 'proj-1',
      fileName: 'script.md',
      content: '内容相同',
      source: 'manual',
    });

    const second = svc.createVersion({
      projectId: 'proj-1',
      fileName: 'script.md',
      content: '内容相同',
      source: 'manual',
    });

    expect(second.id).toBe(first.id);
  });

  it('evicts oldest manual versions when exceeding max', () => {
    const { tempDir, db, svc } = createTestService();
    cleanups.push({ db, tempDir });

    // 设置 maxVersions = 5
    (svc as unknown as { maxVersions: number }).maxVersions = 5;

    // 插入 3 条 AI 版本
    for (let i = 0; i < 3; i++) {
      svc.createVersion({
        projectId: 'proj-evict',
        fileName: 'script.md',
        content: `ai content ${i}`,
        source: 'ai_generate',
      });
    }

    // 插入 4 条 manual 版本（合计 7 条，超过 maxVersions=5，需淘汰 2 条 manual）
    for (let i = 0; i < 4; i++) {
      svc.createVersion({
        projectId: 'proj-evict',
        fileName: 'script.md',
        content: `manual content ${i}`,
        source: 'manual',
      });
    }

    const remaining = svc.listVersions('proj-evict', 'script.md');
    expect(remaining).toHaveLength(5);

    // 所有 3 条 AI 版本必须保留
    const aiVersions = remaining.filter((v) => v.source === 'ai_generate');
    expect(aiVersions).toHaveLength(3);
  });

  it('evicts oldest external versions alongside manual when exceeding max', () => {
    const { tempDir, db, svc } = createTestService();
    cleanups.push({ db, tempDir });

    // 设置 maxVersions = 5
    (svc as unknown as { maxVersions: number }).maxVersions = 5;

    // 插入 2 条 AI 版本（不应被淘汰）
    for (let i = 0; i < 2; i++) {
      svc.createVersion({
        projectId: 'proj-evict-ext',
        fileName: 'script.md',
        content: `ai content ${i}`,
        source: 'ai_generate',
      });
    }

    // 插入 2 条 external 版本（最旧，应优先被淘汰）
    for (let i = 0; i < 2; i++) {
      svc.createVersion({
        projectId: 'proj-evict-ext',
        fileName: 'script.md',
        content: `external content ${i}`,
        source: 'external',
      });
    }

    // 插入 3 条 manual 版本（合计 7 条，超过 maxVersions=5，需淘汰 2 条）
    for (let i = 0; i < 3; i++) {
      svc.createVersion({
        projectId: 'proj-evict-ext',
        fileName: 'script.md',
        content: `manual content ${i}`,
        source: 'manual',
      });
    }

    const remaining = svc.listVersions('proj-evict-ext', 'script.md');
    expect(remaining).toHaveLength(5);

    // 所有 2 条 AI 版本必须保留
    const aiVersions = remaining.filter((v) => v.source === 'ai_generate');
    expect(aiVersions).toHaveLength(2);

    // external 版本（最旧）应已被淘汰（共 2 条，恰好是淘汰数量）
    const externalVersions = remaining.filter((v) => v.source === 'external');
    expect(externalVersions).toHaveLength(0);
  });

  it('prepareRollback saves current content and returns rollback target', () => {
    const { tempDir, db, svc } = createTestService();
    cleanups.push({ db, tempDir });

    const v1 = svc.createVersion({
      projectId: 'proj-rb',
      fileName: 'script.md',
      content: 'version 1 content',
      source: 'ai_generate',
    });

    svc.createVersion({
      projectId: 'proj-rb',
      fileName: 'script.md',
      content: 'version 2 content',
      source: 'manual',
    });

    const result = svc.prepareRollback(v1.id, 'current working content', 'proj-rb', 'script.md');

    expect(result.rollbackContent).toBe('version 1 content');
    expect(result.savedCurrentVersionId).toBeGreaterThan(0);

    // 安全快照应带有 "回滚前自动保存" 标签
    const saved = svc.getVersion(result.savedCurrentVersionId);
    expect(saved).not.toBeNull();
    expect(saved!.label).toBe('回滚前自动保存');
    expect(saved!.content).toBe('current working content');
  });

  it('listVersions with sourceFilter returns only matching sources', () => {
    const { tempDir, db, svc } = createTestService();
    cleanups.push({ db, tempDir });

    svc.createVersion({ projectId: 'proj-filter', fileName: 'a.md', content: 'ai gen', source: 'ai_generate' });
    svc.createVersion({ projectId: 'proj-filter', fileName: 'a.md', content: 'manual', source: 'manual' });
    svc.createVersion({ projectId: 'proj-filter', fileName: 'a.md', content: 'ai rev', source: 'ai_review' });

    const aiOnly = svc.listVersions('proj-filter', 'a.md', {
      sourceFilter: ['ai_generate', 'ai_review'],
    });

    expect(aiOnly).toHaveLength(2);
    for (const v of aiOnly) {
      expect(['ai_generate', 'ai_review']).toContain(v.source);
    }
  });

  it('updateLabel and deleteVersion work correctly', () => {
    const { tempDir, db, svc } = createTestService();
    cleanups.push({ db, tempDir });

    const v = svc.createVersion({
      projectId: 'proj-label',
      fileName: 'b.md',
      content: 'some content',
      source: 'manual',
    });

    // 更新 label
    svc.updateLabel(v.id, '重要版本');
    const updated = svc.getVersion(v.id);
    expect(updated!.label).toBe('重要版本');

    // 删除版本
    svc.deleteVersion(v.id);
    const deleted = svc.getVersion(v.id);
    expect(deleted).toBeNull();
  });
});

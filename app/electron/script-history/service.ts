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
    // 去重：与最新版本内容相同则直接返回
    const latestContent = this.repository.getLatestContent(input.projectId, input.fileName);
    if (latestContent !== null && latestContent === input.content) {
      const existing = this.repository.list(input.projectId, input.fileName, { limit: 1 });
      if (existing.length > 0) return existing[0];
    }

    const summary = this.repository.insert(input);
    this.evict(input.projectId, input.fileName);
    return summary;
  }

  listVersions(projectId: string, fileName: string, opts?: ListVersionsOptions): ScriptVersionSummary[] {
    return this.repository.list(projectId, fileName, opts);
  }

  getVersion(versionId: number): ScriptVersionEntity | null {
    return this.repository.getById(versionId);
  }

  prepareRollback(versionId: number, currentContent: string, projectId: string, fileName: string): RollbackResult {
    const target = this.repository.getById(versionId);
    if (!target) throw new Error(`Version ${versionId} not found`);

    // 保存当前内容作为安全快照
    const saved = this.repository.insert({
      projectId,
      fileName,
      content: currentContent,
      source: 'manual',
    });
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

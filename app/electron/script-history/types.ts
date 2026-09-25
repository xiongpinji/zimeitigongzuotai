// electron/script-history/types.ts

export type VersionSource = 'ai_generate' | 'ai_review' | 'ai_rewrite' | 'manual' | 'external';

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

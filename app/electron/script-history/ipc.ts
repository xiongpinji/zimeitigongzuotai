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
  ipcMain.handle('script-history:create', async (_event, input: CreateVersionInput) => {
    return getRuntime(input.projectId).service.createVersion(input);
  });

  ipcMain.handle('script-history:list', async (_event, projectId: string, fileName: string, opts?: ListVersionsOptions) => {
    return getRuntime(projectId).service.listVersions(projectId, fileName, opts);
  });

  ipcMain.handle('script-history:get', async (_event, projectId: string, versionId: number) => {
    return getRuntime(projectId).service.getVersion(versionId);
  });

  ipcMain.handle('script-history:rollback', async (_event, versionId: number, currentContent: string, projectId: string, fileName: string) => {
    return getRuntime(projectId).service.prepareRollback(versionId, currentContent, projectId, fileName);
  });

  ipcMain.handle('script-history:update-label', async (_event, projectId: string, versionId: number, label: string | null) => {
    getRuntime(projectId).service.updateLabel(versionId, label);
  });

  ipcMain.handle('script-history:delete', async (_event, projectId: string, versionId: number) => {
    getRuntime(projectId).service.deleteVersion(versionId);
  });
}

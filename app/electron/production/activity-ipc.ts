import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { ProductionActivityStore } from './activity-store';

/** The renderer supplies only a duration. Project identity and confirmation stay in main. */
export function registerProductionActivityIpc(deps: {
  ipc: Pick<IpcMain, 'handle'>;
  store: ProductionActivityStore;
  activeProjectDir: () => string | null;
  allowedSender: (event: IpcMainInvokeEvent) => boolean;
  confirmIssue: () => Promise<boolean>;
  confirmAnalysis: () => Promise<boolean>;
  confirmRecordingImport: () => Promise<boolean>;
  confirmHighlightDetection: () => Promise<boolean>;
  confirmCompositionBuild: () => Promise<boolean>;
  onActivityChanged?: (projectDir: string) => void;
}): void {
  function project(event: IpcMainInvokeEvent): string | null {
    return deps.allowedSender(event) ? deps.activeProjectDir() : null;
  }
  function changed(dir: string): void {
    try { deps.onActivityChanged?.(dir); } catch { /* Authorization read during callback fails closed in the job timer. */ }
  }
  deps.ipc.handle('production-activity:status', (event) => {
    const dir = project(event);
    if (!dir) return { ok: false, code: 'project_unavailable' };
    try { return { ok: true, status: deps.store.status(dir) }; }
    catch { return { ok: false, code: 'activity_store_unavailable' }; }
  });
  deps.ipc.handle('production-activity:issue-quality-check', async (event, durationMinutes: unknown) => {
    const dir = project(event);
    if (!dir) return { ok: false, code: 'project_unavailable' };
    if (durationMinutes !== 30) return { ok: false, code: 'duration_invalid' };
    if (!await deps.confirmIssue()) return { ok: false, code: 'cancelled' };
    // Recheck the window and current project after the native confirmation dialog.
    if (project(event) !== dir) return { ok: false, code: 'project_changed' };
    try { const status = deps.store.issueQualityCheck(dir, 30); changed(dir); return { ok: true, status }; }
    catch { return { ok: false, code: 'activity_store_unavailable' }; }
  });
  deps.ipc.handle('production-activity:issue-analysis', async (event, durationMinutes: unknown) => {
    const dir = project(event);
    if (!dir) return { ok: false, code: 'project_unavailable' };
    if (durationMinutes !== 30) return { ok: false, code: 'duration_invalid' };
    if (!await deps.confirmAnalysis()) return { ok: false, code: 'cancelled' };
    if (project(event) !== dir) return { ok: false, code: 'project_changed' };
    try { const status = deps.store.issueAnalysis(dir, 30); changed(dir); return { ok: true, status }; }
    catch { return { ok: false, code: 'activity_store_unavailable' }; }
  });
  deps.ipc.handle('production-activity:issue-recording-import', async (event, durationMinutes: unknown) => {
    const dir = project(event);
    if (!dir) return { ok: false, code: 'project_unavailable' };
    if (durationMinutes !== 30) return { ok: false, code: 'duration_invalid' };
    if (!await deps.confirmRecordingImport()) return { ok: false, code: 'cancelled' };
    if (project(event) !== dir) return { ok: false, code: 'project_changed' };
    try { const status = deps.store.issueRecordingImport(dir, 30); changed(dir); return { ok: true, status }; }
    catch { return { ok: false, code: 'activity_store_unavailable' }; }
  });
  deps.ipc.handle('production-activity:issue-highlight-detection', async (event, durationMinutes: unknown) => {
    const dir = project(event);
    if (!dir) return { ok: false, code: 'project_unavailable' };
    if (durationMinutes !== 30) return { ok: false, code: 'duration_invalid' };
    if (!await deps.confirmHighlightDetection()) return { ok: false, code: 'cancelled' };
    if (project(event) !== dir) return { ok: false, code: 'project_changed' };
    try { const status = deps.store.issueHighlightDetection(dir, 30); changed(dir); return { ok: true, status }; }
    catch { return { ok: false, code: 'activity_store_unavailable' }; }
  });
  deps.ipc.handle('production-activity:issue-composition-build', async (event, durationMinutes: unknown) => {
    const dir = project(event);
    if (!dir) return { ok: false, code: 'project_unavailable' };
    if (durationMinutes !== 30) return { ok: false, code: 'duration_invalid' };
    if (!await deps.confirmCompositionBuild()) return { ok: false, code: 'cancelled' };
    if (project(event) !== dir) return { ok: false, code: 'project_changed' };
    try { const status = deps.store.issueCompositionBuild(dir, 30); changed(dir); return { ok: true, status }; }
    catch { return { ok: false, code: 'activity_store_unavailable' }; }
  });
  deps.ipc.handle('production-activity:revoke', (event) => {
    const dir = project(event);
    if (!dir) return { ok: false, code: 'project_unavailable' };
    try { const status = deps.store.revoke(dir); changed(dir); return { ok: true, status }; }
    catch { return { ok: false, code: 'activity_store_unavailable' }; }
  });
}

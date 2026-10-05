import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { ProductionActivityStore } from './activity-store';

/** The renderer supplies only a duration. Project identity and confirmation stay in main. */
export function registerProductionActivityIpc(deps: {
  ipc: Pick<IpcMain, 'handle'>;
  store: ProductionActivityStore;
  activeProjectDir: () => string | null;
  allowedSender: (event: IpcMainInvokeEvent) => boolean;
  confirmIssue: () => Promise<boolean>;
}): void {
  function project(event: IpcMainInvokeEvent): string | null {
    return deps.allowedSender(event) ? deps.activeProjectDir() : null;
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
    try { return { ok: true, status: deps.store.issueQualityCheck(dir, 30) }; }
    catch { return { ok: false, code: 'activity_store_unavailable' }; }
  });
  deps.ipc.handle('production-activity:revoke', (event) => {
    const dir = project(event);
    if (!dir) return { ok: false, code: 'project_unavailable' };
    try { return { ok: true, status: deps.store.revoke(dir) }; }
    catch { return { ok: false, code: 'activity_store_unavailable' }; }
  });
}

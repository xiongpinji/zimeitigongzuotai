import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductionActivityStore } from '../electron/production/activity-store';
import { registerProductionActivityIpc } from '../electron/production/activity-ipc';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('生产活动 IPC 主进程边界', () => {
  it('拒绝外来 frame，确认取消不发行，确认后工程变更不发行，可撤销', async () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-ipc-')); roots.push(root);
    const store = new ProductionActivityStore(join(root, 'state'), () => 1000);
    const owner = {};
    const other = {};
    let active = join(root, 'project-a');
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const confirm = vi.fn(async () => false);
    registerProductionActivityIpc({
      ipc: { handle: (channel: string, callback: (event: unknown, input?: unknown) => unknown) => {
        handlers.set(channel, callback);
      } } as never,
      store,
      activeProjectDir: () => active,
      allowedSender: (event) => event === owner,
      confirmIssue: confirm,
      confirmAnalysis: confirm,
      confirmRecordingImport: confirm,
    });
    const call = async (channel: string, event: unknown, input?: unknown) =>
      handlers.get(channel)!(event, input);
    expect(await call('production-activity:issue-quality-check', other, 30))
      .toEqual({ ok: false, code: 'project_unavailable' });
    expect(confirm).not.toHaveBeenCalled();
    expect(await call('production-activity:issue-quality-check', owner, 60))
      .toEqual({ ok: false, code: 'duration_invalid' });
    expect(await call('production-activity:issue-quality-check', owner, 30))
      .toEqual({ ok: false, code: 'cancelled' });
    expect(store.status(active).active).toBe(false);
    confirm.mockImplementationOnce(async () => { active = join(root, 'project-b'); return true; });
    expect(await call('production-activity:issue-quality-check', owner, 30))
      .toEqual({ ok: false, code: 'project_changed' });
    expect(store.status(active).active).toBe(false);
    confirm.mockResolvedValue(true);
    expect(await call('production-activity:issue-quality-check', owner, 30))
      .toMatchObject({ ok: true, status: { active: true } });
    expect(await call('production-activity:issue-analysis', other, 30))
      .toEqual({ ok: false, code: 'project_unavailable' });
    expect(await call('production-activity:issue-analysis', owner, 60))
      .toEqual({ ok: false, code: 'duration_invalid' });
    expect(await call('production-activity:issue-analysis', owner, 30))
      .toMatchObject({ ok: true, status: { allowedActions: ['quality_check', 'search_authorized_assets'] } });
    expect(await call('production-activity:issue-recording-import', other, 30))
      .toEqual({ ok: false, code: 'project_unavailable' });
    expect(await call('production-activity:issue-recording-import', owner, 30))
      .toMatchObject({ ok: true, status: { allowedActions: [
        'quality_check', 'search_authorized_assets', 'import_recordings',
      ] } });
    expect(await call('production-activity:revoke', other))
      .toEqual({ ok: false, code: 'project_unavailable' });
    expect(await call('production-activity:revoke', owner))
      .toEqual({ ok: true, status: { active: false } });
  });
});

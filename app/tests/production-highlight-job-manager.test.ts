import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductionActivityStore } from '../electron/production/activity-store';
import { ProductionHighlightJobManager } from '../electron/production/highlight-job-manager';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('智能体高光后台作业', () => {
  it('仅启动当前工程绑定任务，撤销立即取消该任务且不碰其他工程', async () => {
    const root = mkdtempSync(join(tmpdir(), 'highlight-job-manager-')); roots.push(root);
    const projectA = join(root, 'a');
    const projectB = join(root, 'b');
    let active = projectA;
    const own = `hbatch_${'a'.repeat(64)}`;
    const other = `hbatch_${'b'.repeat(64)}`;
    const store = new ProductionActivityStore(join(root, 'state'), () => 1000);
    const task = (id: string, sourceSha256: string) => ({ id, state: 'queued',
      recording: { sourceSha256, sourceRef: `PRIVATE-${id}` } });
    const tasks = [task(own, 'c'.repeat(64)), task(other, 'd'.repeat(64))];
    const cancel = vi.fn((id: string) => ({ ...tasks.find((item) => item.id === id)!, state: 'cancelled' }));
    const controller = { list: () => tasks, cancel };
    let finish!: (value: unknown) => void;
    const completion = new Promise((resolve) => { finish = resolve; });
    const bridge = { runSelectedForAgent: vi.fn(() => completion), clearPreparedAgentRun: vi.fn() };
    const manager = new ProductionHighlightJobManager({ store, controller: controller as never,
      bridge: bridge as never, activeProjectDir: () => active });
    expect(await manager.start([own])).toEqual({ ok: false, code: 'grant_missing' });
    expect(bridge.runSelectedForAgent).not.toHaveBeenCalled();
    store.issueHighlightDetection(projectA, 30);
    store.issueHighlightDetection(projectB, 30);
    store.bindImportedRecordings(projectA, [{ id: own, sourceSha256: 'c'.repeat(64) }]);
    store.bindImportedRecordings(projectB, [{ id: other, sourceSha256: 'd'.repeat(64) }]);
    expect(await manager.start([other])).toEqual({ ok: false, code: 'task_not_bound' });
    expect(await manager.start([own])).toEqual({ ok: true, startedIds: [own] });
    expect(await manager.start([own])).toEqual({ ok: false, code: 'busy' });
    store.revoke(projectA);
    manager.onActivityChanged(projectA);
    expect(cancel).toHaveBeenCalledWith(own);
    expect(cancel).not.toHaveBeenCalledWith(other);
    expect(bridge.clearPreparedAgentRun).toHaveBeenCalled();
    finish([]);
    await Promise.resolve();
    active = projectB;
    expect(await manager.start([own])).toEqual({ ok: false, code: 'task_not_bound' });
    manager.stop();
  });
});

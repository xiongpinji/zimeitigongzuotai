import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductionActivityStore } from '../electron/production/activity-store';
import { selectAuthorizedHighlightTasks } from '../electron/production/highlight-selection';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('智能体高光任务工程绑定', () => {
  it('只允许当前工程绑定且源哈希匹配的待处理任务', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-highlight-selection-')); roots.push(root);
    let now = 1000;
    const store = new ProductionActivityStore(join(root, 'state'), () => now);
    const projectA = join(root, 'a');
    const projectB = join(root, 'b');
    const own = `hbatch_${'a'.repeat(64)}`;
    const other = `hbatch_${'b'.repeat(64)}`;
    const ownSha = 'c'.repeat(64);
    const otherSha = 'd'.repeat(64);
    store.issueHighlightDetection(projectA, 30);
    store.issueHighlightDetection(projectB, 30);
    store.bindImportedRecordings(projectA, [{ id: own, sourceSha256: ownSha }]);
    store.bindImportedRecordings(projectB, [{ id: other, sourceSha256: otherSha }]);
    const tasks = [
      { id: own, state: 'queued', recording: { sourceSha256: ownSha, sourceRef: 'PRIVATE-A' } },
      { id: other, state: 'queued', recording: { sourceSha256: otherSha, sourceRef: 'PRIVATE-B' } },
    ];
    expect(selectAuthorizedHighlightTasks(projectA, [own], store, tasks))
      .toEqual({ ok: true, taskIds: [own] });
    expect(selectAuthorizedHighlightTasks(projectA, [other], store, tasks))
      .toEqual({ ok: false, code: 'task_not_bound' });
    expect(selectAuthorizedHighlightTasks(projectA, [own, own], store, tasks))
      .toEqual({ ok: false, code: 'invalid_request' });
    expect(selectAuthorizedHighlightTasks(projectA, [own], store,
      [{ ...tasks[0], recording: { ...tasks[0].recording, sourceSha256: otherSha } }]))
      .toEqual({ ok: false, code: 'source_hash_mismatch' });
    expect(selectAuthorizedHighlightTasks(projectA, [own], store,
      [{ ...tasks[0], state: 'completed' }]))
      .toEqual({ ok: false, code: 'task_not_queued' });
    now += 30 * 60_000;
    expect(selectAuthorizedHighlightTasks(projectA, [own], store, tasks))
      .toEqual({ ok: false, code: 'grant_expired' });
    expect(JSON.stringify(selectAuthorizedHighlightTasks(projectA, [own], store, tasks)))
      .not.toContain('PRIVATE-A');
  });
});

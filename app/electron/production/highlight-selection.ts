/** Main-process preflight for project-bound Agent highlight execution. No media paths leave this module. */
import type { ProductionActivityStore } from './activity-store';

const TASK_ID = /^hbatch_[a-f0-9]{64}$/;

type TaskProjection = { id: string; state: string; recording: { sourceSha256: string } };
type SelectionResult = { ok: true; taskIds: string[] } | { ok: false; code: string };

export function selectAuthorizedHighlightTasks(projectDir: string, rawIds: unknown,
  store: Pick<ProductionActivityStore, 'authorizeHighlightDetection' | 'boundRecordings'>,
  tasks: readonly TaskProjection[]): SelectionResult {
  const ids: string[] = [];
  try {
    if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 12) {
      return { ok: false, code: 'invalid_request' };
    }
    for (let index = 0; index < rawIds.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(rawIds, String(index));
      if (!descriptor || !('value' in descriptor) ||
          typeof descriptor.value !== 'string' || !TASK_ID.test(descriptor.value)) {
        return { ok: false, code: 'invalid_request' };
      }
      ids.push(descriptor.value);
    }
    if (new Set(ids).size !== ids.length) return { ok: false, code: 'invalid_request' };
    const decision = store.authorizeHighlightDetection(projectDir);
    if (!decision.allowed) return { ok: false, code: decision.reason };
    const bound = new Map(store.boundRecordings(projectDir)
      .map((entry) => [entry.id, entry.sourceSha256]));
    const queued = new Map(tasks.map((task) => [task.id, task]));
    for (const id of ids) {
      const sourceSha = bound.get(id);
      if (!sourceSha) return { ok: false, code: 'task_not_bound' };
      const task = queued.get(id);
      if (!task || task.state !== 'queued') return { ok: false, code: 'task_not_queued' };
      if (task.recording.sourceSha256 !== sourceSha) {
        return { ok: false, code: 'source_hash_mismatch' };
      }
    }
    return { ok: true, taskIds: ids };
  } catch { return { ok: false, code: 'activity_store_unavailable' }; }
}

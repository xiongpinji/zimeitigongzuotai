/** Owner-main orchestration for one project-bound Agent highlight run at a time. */
import { resolve } from 'node:path';
import type { ProductHighlightController } from '../highlights/product-highlight-controller';
import type { PreparedRecordingImportBridge } from '../highlights/product-highlight-ipc';
import type { ProductionHighlightDetection } from '../mcp/production-tools';
import type { ProductionActivityStore } from './activity-store';
import { selectAuthorizedHighlightTasks } from './highlight-selection';

type Controller = Pick<ProductHighlightController, 'list' | 'cancel'>;
type Bridge = Pick<PreparedRecordingImportBridge, 'runSelectedForAgent' | 'clearPreparedAgentRun'>;
type ActiveRun = { projectDir: string; taskIds: string[]; timer: NodeJS.Timeout; cancelled: boolean };

function sameProject(left: string | null, right: string): boolean {
  if (!left) return false;
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function safeCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && [
    'selection_required', 'project_changed', 'authorization_expired',
    'root_mismatch', 'invalid_request', 'busy', 'stopped',
  ].includes(code) ? code : 'internal_error';
}

export class ProductionHighlightJobManager {
  private active: ActiveRun | null = null;

  constructor(private readonly deps: {
    store: ProductionActivityStore;
    controller: Controller;
    bridge: Bridge;
    activeProjectDir: () => string | null;
  }) {}

  start: ProductionHighlightDetection = async (rawIds) => {
    if (this.active) return { ok: false, code: 'busy' };
    const projectDir = this.deps.activeProjectDir();
    if (!projectDir) return { ok: false, code: 'project_unavailable' };
    const selected = selectAuthorizedHighlightTasks(projectDir, rawIds,
      this.deps.store, this.deps.controller.list());
    if (!selected.ok) return selected;
    try {
      const completion = this.deps.bridge.runSelectedForAgent(projectDir, selected.taskIds,
        () => this.deps.store.authorizeHighlightDetection(projectDir).allowed &&
          sameProject(this.deps.activeProjectDir(), projectDir));
      const active: ActiveRun = { projectDir, taskIds: selected.taskIds,
        timer: setInterval(() => this.checkActive(), 1_000), cancelled: false };
      active.timer.unref?.();
      this.active = active;
      void completion.then(() => this.finish(active), () => this.finish(active));
      return { ok: true, startedIds: selected.taskIds };
    } catch (error) { return { ok: false, code: safeCode(error) }; }
  };

  onActivityChanged(_projectDir: string): void {
    this.checkActive();
    const projectDir = this.deps.activeProjectDir();
    if (!projectDir) { this.deps.bridge.clearPreparedAgentRun(); return; }
    try {
      if (!this.deps.store.status(projectDir).allowedActions?.includes('detect_highlights')) {
        this.deps.bridge.clearPreparedAgentRun();
      }
    } catch { this.deps.bridge.clearPreparedAgentRun(); }
  }

  /** Shutdown leaves durable running tasks for existing startup reconciliation. */
  stop(): void {
    if (this.active) clearInterval(this.active.timer);
    this.active = null;
    this.deps.bridge.clearPreparedAgentRun();
  }

  private finish(run: ActiveRun): void {
    clearInterval(run.timer);
    if (this.active === run) this.active = null;
  }

  private checkActive(): void {
    const run = this.active;
    if (!run || run.cancelled) return;
    let allowed = false;
    try {
      const status = this.deps.store.status(run.projectDir);
      allowed = sameProject(this.deps.activeProjectDir(), run.projectDir) && status.active &&
        !!status.allowedActions?.includes('detect_highlights');
    } catch { /* Failed authorization read closes the run. */ }
    if (allowed) return;
    run.cancelled = true;
    try {
      const current = new Map(this.deps.controller.list().map((task) => [task.id, task]));
      for (const id of run.taskIds) {
        const state = current.get(id)?.state;
        if (state === 'queued' || state === 'running') {
          try { this.deps.controller.cancel(id); } catch { /* Continue cancelling other selected tasks. */ }
        }
      }
    } catch { /* No task metadata leaves main on failure. */ }
    this.deps.bridge.clearPreparedAgentRun();
  }
}

import {
  isTerminalStatus,
  PIPELINE_TASK_LOG_LIMIT,
  type PipelineTask,
  type PipelineTaskKind,
  type PipelineTaskStatus,
  type PipelineTaskError,
  type PipelineTaskProgress,
} from './types';

const TERMINAL_TTL_MS = 24 * 3600 * 1000;

export class TaskRegistry {
  private tasks = new Map<string, PipelineTask>();

  register(task: PipelineTask): void {
    this.tasks.set(task.taskId, task);
  }

  get(taskId: string): PipelineTask | undefined {
    return this.tasks.get(taskId);
  }

  list(projectPath?: string): PipelineTask[] {
    const out: PipelineTask[] = [];
    for (const t of this.tasks.values()) {
      if (!projectPath || t.projectPath === projectPath) out.push(t);
    }
    return out;
  }

  hasActiveOfKind(projectPath: string, kind: PipelineTaskKind): boolean {
    for (const t of this.tasks.values()) {
      if (
        t.projectPath === projectPath &&
        t.kind === kind &&
        !isTerminalStatus(t.status)
      ) {
        return true;
      }
    }
    return false;
  }

  setStatus(
    taskId: string,
    status: PipelineTaskStatus,
    extra?: { result?: unknown; error?: PipelineTaskError },
  ): PipelineTask | undefined {
    const t = this.tasks.get(taskId);
    if (!t) return undefined;
    t.status = status;
    if (isTerminalStatus(status)) t.finishedAt = Date.now();
    if (extra?.result !== undefined) t.result = extra.result;
    if (extra?.error !== undefined) t.error = extra.error;
    return t;
  }

  patchProgress(taskId: string, progress: Partial<PipelineTaskProgress>): PipelineTask | undefined {
    const t = this.tasks.get(taskId);
    if (!t) return undefined;
    t.progress = { ...t.progress, ...progress };
    return t;
  }

  appendLog(taskId: string, line: string): void {
    const t = this.tasks.get(taskId);
    if (!t) return;
    t.logs.push(line);
    if (t.logs.length > PIPELINE_TASK_LOG_LIMIT) {
      t.logs.splice(0, t.logs.length - PIPELINE_TASK_LOG_LIMIT);
    }
  }

  gc(): void {
    const now = Date.now();
    for (const [id, t] of this.tasks) {
      if (
        isTerminalStatus(t.status) &&
        t.finishedAt !== undefined &&
        now - t.finishedAt > TERMINAL_TTL_MS
      ) {
        this.tasks.delete(id);
      }
    }
  }
}

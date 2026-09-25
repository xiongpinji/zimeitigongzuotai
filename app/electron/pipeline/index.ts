import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { TaskRegistry } from './task-registry';
import { resolveProject } from './context';
import {
  CANCELABLE_KINDS,
  PIPELINE_ERROR_CODES,
  isTerminalStatus,
  type PipelineTask,
  type PipelineTaskKind,
  type PipelineTaskProgress,
} from './types';
import { createTaskProgressBridge, type BridgeSender } from './task-progress-bridge';

export interface TaskHandle {
  taskId: string;
  signal: AbortSignal;
  update(progress: Partial<PipelineTaskProgress>): void;
  log(line: string): void;
}

export type PipelineRunFn<T> = (handle: TaskHandle) => Promise<T>;

class PipelineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

interface RunningEntry {
  controller: AbortController;
  settle: Promise<void>;
}

export class PipelineService {
  private registry = new TaskRegistry();
  private running = new Map<string, RunningEntry>();
  private listeners = new Set<(t: PipelineTask) => void>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  startGcTimer(intervalMs = 60_000): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => this.registry.gc(), intervalMs);
    if (typeof this.gcTimer.unref === 'function') this.gcTimer.unref();
  }

  stopGcTimer(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = null;
  }

  onTaskUpdate(fn: (t: PipelineTask) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(task: PipelineTask): void {
    for (const fn of this.listeners) {
      try {
        fn(task);
      } catch {
        // 忽略监听器异常
      }
    }
  }

  async createTask<T>(
    kind: PipelineTaskKind,
    projectPath: string,
    run: PipelineRunFn<T>,
  ): Promise<{ taskId: string }> {
    await resolveProject(projectPath);

    if (this.registry.hasActiveOfKind(projectPath, kind)) {
      throw new PipelineError(
        PIPELINE_ERROR_CODES.TASK_CONFLICT,
        `项目已有运行中的同类任务: ${kind}`,
      );
    }

    const taskId = randomUUID();
    const task: PipelineTask = {
      taskId,
      kind,
      projectPath,
      status: 'running',
      progress: { phase: 'pending', percent: 0 },
      startedAt: Date.now(),
      logs: [],
    };
    this.registry.register(task);
    this.emit(task);

    const controller = new AbortController();
    const handle: TaskHandle = {
      taskId,
      signal: controller.signal,
      update: (p) => {
        const t = this.registry.patchProgress(taskId, p);
        if (t) this.emit(t);
      },
      log: (line) => {
        this.registry.appendLog(taskId, line);
      },
    };

    const settle = (async () => {
      try {
        const result = await run(handle);
        if (controller.signal.aborted) {
          this.registry.setStatus(taskId, 'canceled');
        } else {
          this.registry.setStatus(taskId, 'succeeded', { result });
        }
      } catch (err) {
        const e = err as { name?: string; message?: string; code?: string; retryable?: boolean };
        if (controller.signal.aborted || e?.name === 'AbortError') {
          this.registry.setStatus(taskId, 'canceled');
        } else {
          this.registry.setStatus(taskId, 'failed', {
            error: {
              code: e?.code ?? PIPELINE_ERROR_CODES.INTERNAL,
              message: e?.message ?? String(err),
              retryable: e?.retryable ?? true,
            },
          });
        }
      } finally {
        const final = this.registry.get(taskId);
        if (final) this.emit(final);
        this.running.delete(taskId);
      }
    })();

    this.running.set(taskId, { controller, settle });
    return { taskId };
  }

  async cancelTask(taskId: string): Promise<void> {
    const t = this.registry.get(taskId);
    if (!t) {
      throw new PipelineError(
        PIPELINE_ERROR_CODES.UNKNOWN_TASK,
        `未知任务: ${taskId}`,
      );
    }
    if (isTerminalStatus(t.status)) return;
    if (!CANCELABLE_KINDS.has(t.kind)) {
      throw new PipelineError(
        PIPELINE_ERROR_CODES.NOT_CANCELABLE,
        `该任务类型不支持取消: ${t.kind}`,
      );
    }
    const entry = this.running.get(taskId);
    entry?.controller.abort();
    await this.waitForSettle(taskId);
  }

  async waitForSettle(taskId: string): Promise<void> {
    const entry = this.running.get(taskId);
    if (entry) await entry.settle;
  }

  getTask(taskId: string): PipelineTask | undefined {
    return this.registry.get(taskId);
  }

  listTasks(projectPath?: string): PipelineTask[] {
    return this.registry.list(projectPath);
  }
}

let _instance: PipelineService | null = null;
export function getPipelineService(): PipelineService {
  if (!_instance) {
    _instance = new PipelineService();
    _instance.startGcTimer();
  }
  return _instance;
}

export { PIPELINE_ERROR_CODES } from './types';

export function attachTaskProgressBridge(
  svc: PipelineService,
  getMainWindow: () => BrowserWindow | null,
): () => void {
  const sender: BridgeSender = (channel, payload) => {
    const win = getMainWindow();
    win?.webContents.send(channel, payload);
  };
  const bridge = createTaskProgressBridge({ send: sender });
  return svc.onTaskUpdate((task) => bridge.notify(task));
}

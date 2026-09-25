// cli/src/commands/task.ts
import type { ToolCaller } from '../client';
import { CliError } from '../errors';

const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

function requireId(positionals: string[]): string {
  const id = positionals[0];
  if (!id) throw new CliError('用法: lingji task <status|cancel|wait> <taskId>', 'bad_args', 2);
  return id;
}

export interface WaitOptions {
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onUpdate?: (task: unknown) => void;
}

/** 轮询任务状态直到终态 */
export async function waitForTask(
  taskId: string,
  client: ToolCaller,
  opts: WaitOptions = {},
): Promise<unknown> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const interval = opts.intervalMs ?? 1000;
  for (;;) {
    const task = (await client.call('lingji_get_task_status', { taskId })) as { status?: string };
    opts.onUpdate?.(task);
    if (task && typeof task.status === 'string' && TERMINAL.has(task.status)) {
      return task;
    }
    await sleep(interval);
  }
}

export async function runTaskCommand(
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean>,
  client: ToolCaller,
): Promise<unknown> {
  switch (action) {
    case 'status':
      return client.call('lingji_get_task_status', { taskId: requireId(positionals) });
    case 'list': {
      const projectPath = typeof flags.project === 'string' ? flags.project : undefined;
      return client.call('lingji_list_tasks', projectPath ? { projectPath } : {});
    }
    case 'cancel':
      return client.call('lingji_cancel_task', { taskId: requireId(positionals) });
    case 'wait':
      return waitForTask(requireId(positionals), client, {
        onUpdate: (t) => {
          const task = t as { status?: string; progress?: { percent?: number; phase?: string } };
          const pct = task.progress?.percent ?? 0;
          process.stderr.write(`[task] ${task.status} ${pct}% ${task.progress?.phase ?? ''}\n`);
        },
      });
    default:
      throw new CliError(
        `未知 task 子命令: ${action ?? '(空)'}（支持 status/list/cancel/wait）`,
        'bad_args',
        2,
      );
  }
}

// cli/src/commands/generation.ts
import type { ToolCaller } from '../client';
import { resolveProjectPath } from '../project-resolve';
import { waitForTask } from './task';

export interface GenerationCommandOptions {
  toolName: string;
  flags: Record<string, string | boolean>;
  client: ToolCaller;
  extraArgs?: Record<string, unknown>;
  sleep?: (ms: number) => Promise<void>;
}

/** 解析项目 → 启动生成任务 → 返回 taskId；--wait 时轮询至终态 */
export async function runGenerationCommand(opts: GenerationCommandOptions): Promise<unknown> {
  const projectPath = await resolveProjectPath(opts.flags, opts.client);
  const started = (await opts.client.call(opts.toolName, {
    projectPath,
    ...(opts.extraArgs ?? {}),
  })) as { taskId?: string };
  if (!started?.taskId) return started;
  if (opts.flags.wait === true) {
    return waitForTask(started.taskId, opts.client, {
      sleep: opts.sleep,
      onUpdate: (t) => {
        const task = t as { status?: string; progress?: { percent?: number; phase?: string } };
        process.stderr.write(
          `[task] ${task.status} ${task.progress?.percent ?? 0}% ${task.progress?.phase ?? ''}\n`,
        );
      },
    });
  }
  return started;
}

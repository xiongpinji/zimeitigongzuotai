// cli/src/project-resolve.ts
import type { ToolCaller } from './client';
import { CliError } from './errors';

/** 解析目标项目：--project 优先，否则取应用当前活动项目 */
export async function resolveProjectPath(
  flags: Record<string, string | boolean>,
  client: ToolCaller,
): Promise<string> {
  if (typeof flags.project === 'string' && flags.project) return flags.project;
  const active = (await client.call('lingji_get_active_project')) as { projectPath?: string | null };
  if (active?.projectPath) return active.projectPath;
  throw new CliError(
    '未指定项目，且应用当前没有打开的项目。请用 --project <path> 指定。',
    'no_project',
    2,
  );
}

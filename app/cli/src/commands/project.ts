// cli/src/commands/project.ts
import type { ToolCaller } from '../client';
import { CliError } from '../errors';

export async function runProjectCommand(
  action: string | undefined,
  positionals: string[],
  client: ToolCaller,
): Promise<unknown> {
  switch (action) {
    case 'current':
      return client.call('lingji_get_active_project', {});
    case 'list':
      return client.call('lingji_list_recent_projects', {});
    case 'open': {
      const path = positionals[0];
      if (!path) throw new CliError('用法: lingji project open <path>', 'bad_args', 2);
      return client.call('lingji_open_project', { path });
    }
    default:
      throw new CliError(
        `未知 project 子命令: ${action ?? '(空)'}（支持 current/list/open）`,
        'bad_args',
        2,
      );
  }
}

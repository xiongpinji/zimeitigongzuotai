// cli/src/commands/subtitle.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
import { CliError } from '../errors';
export async function runSubtitleCommand(action: string | undefined, flags: Record<string, string | boolean>, client: ToolCaller): Promise<unknown> {
  if (action !== 'analyze') throw new CliError(`未知 subtitle 子命令: ${action ?? '(空)'}（支持 analyze）`, 'bad_args', 2);
  return runGenerationCommand({ toolName: 'lingji_analyze_subtitles', flags, client });
}

// cli/src/commands/audio.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
import { CliError } from '../errors';

export async function runAudioCommand(
  action: string | undefined,
  flags: Record<string, string | boolean>,
  client: ToolCaller,
): Promise<unknown> {
  if (action !== 'gen') {
    throw new CliError(`未知 audio 子命令: ${action ?? '(空)'}（支持 gen）`, 'bad_args', 2);
  }
  return runGenerationCommand({ toolName: 'lingji_generate_audio', flags, client });
}

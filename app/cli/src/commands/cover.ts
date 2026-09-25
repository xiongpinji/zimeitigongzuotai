// cli/src/commands/cover.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
import { CliError } from '../errors';
const MAP: Record<string, string> = {
  prompt: 'lingji_generate_cover_prompts',
  image: 'lingji_generate_cover_images',
  gen: 'lingji_generate_covers',
};
export async function runCoverCommand(action: string | undefined, flags: Record<string, string | boolean>, client: ToolCaller): Promise<unknown> {
  const tool = action ? MAP[action] : undefined;
  if (!tool) throw new CliError(`未知 cover 子命令: ${action ?? '(空)'}（支持 prompt/image/gen）`, 'bad_args', 2);
  return runGenerationCommand({ toolName: tool, flags, client });
}

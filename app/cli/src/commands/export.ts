// cli/src/commands/export.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
export async function runExportCommand(flags: Record<string, string | boolean>, client: ToolCaller): Promise<unknown> {
  const extraArgs = typeof flags.out === 'string' ? { out: flags.out } : undefined;
  return runGenerationCommand({ toolName: 'lingji_export_video', flags, client, extraArgs });
}

// tests/cli-subtitle-command.test.ts
import { describe, it, expect } from 'vitest';
import { runSubtitleCommand } from '../cli/src/commands/subtitle';
import type { ToolCaller } from '../cli/src/client';
function fake() { const calls: any[] = []; return { calls, client: { async call(n: string, a?: unknown) { calls.push({ name: n, args: a }); return n === 'lingji_get_active_project' ? { projectPath: '/p' } : { taskId: 't' }; }, async close() {} } as ToolCaller }; }
describe('runSubtitleCommand', () => {
  it('analyze → lingji_analyze_subtitles', async () => { const { client, calls } = fake(); await runSubtitleCommand('analyze', {}, client); expect(calls.some((c) => c.name === 'lingji_analyze_subtitles')).toBe(true); });
  it('unknown → bad_args', async () => { const { client } = fake(); await expect(runSubtitleCommand('x', {}, client)).rejects.toMatchObject({ code: 'bad_args' }); });
});

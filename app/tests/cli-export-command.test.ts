// tests/cli-export-command.test.ts
import { describe, it, expect } from 'vitest';
import { runExportCommand } from '../cli/src/commands/export';
import type { ToolCaller } from '../cli/src/client';
function fake() { const calls: any[] = []; return { calls, client: { async call(n: string, a?: unknown) { calls.push({ name: n, args: a }); return n === 'lingji_get_active_project' ? { projectPath: '/p' } : { taskId: 't' }; }, async close() {} } as ToolCaller }; }
describe('runExportCommand', () => {
  it('passes --out as extra arg to lingji_export_video', async () => {
    const { client, calls } = fake();
    await runExportCommand({ out: 'final.mp4' }, client);
    const call = calls.find((c) => c.name === 'lingji_export_video');
    expect(call.args).toMatchObject({ projectPath: '/p', out: 'final.mp4' });
  });
});

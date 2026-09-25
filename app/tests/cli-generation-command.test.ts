// tests/cli-generation-command.test.ts
import { describe, it, expect } from 'vitest';
import { runGenerationCommand } from '../cli/src/commands/generation';
import type { ToolCaller } from '../cli/src/client';

function fake(responder: (name: string, args?: unknown) => unknown) {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const client: ToolCaller = {
    async call(name, args) { calls.push({ name, args }); return responder(name, args); },
    async close() {},
  };
  return { client, calls };
}

describe('runGenerationCommand', () => {
  it('resolves project then starts the tool, returns taskId without --wait', async () => {
    const { client, calls } = fake((name) =>
      name === 'lingji_get_active_project' ? { projectPath: '/active' } : { taskId: 'tk1' },
    );
    const res = await runGenerationCommand({ toolName: 'lingji_generate_audio', flags: {}, client });
    expect(res).toEqual({ taskId: 'tk1' });
    expect(calls[0].name).toBe('lingji_get_active_project');
    expect(calls[1]).toEqual({ name: 'lingji_generate_audio', args: { projectPath: '/active' } });
  });

  it('with --wait polls until terminal', async () => {
    const statuses = ['running', 'succeeded'];
    let i = 0;
    const { client } = fake((name) => {
      if (name === 'lingji_generate_audio') return { taskId: 'tk2' };
      if (name === 'lingji_get_task_status') return { status: statuses[i++], progress: {} };
      return {};
    });
    const res: any = await runGenerationCommand({
      toolName: 'lingji_generate_audio',
      flags: { project: '/p', wait: true },
      client,
      sleep: async () => {},
    });
    expect(res.status).toBe('succeeded');
  });
});

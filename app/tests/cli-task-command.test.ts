// tests/cli-task-command.test.ts
import { describe, it, expect } from 'vitest';
import { runTaskCommand, waitForTask } from '../cli/src/commands/task';
import type { ToolCaller } from '../cli/src/client';

function recorder(responder?: (name: string, args?: unknown) => unknown) {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const client: ToolCaller = {
    async call(name, args) {
      calls.push({ name, args });
      return responder ? responder(name, args) : { ok: true };
    },
    async close() {},
  };
  return { client, calls };
}

describe('runTaskCommand', () => {
  it('status <id> → lingji_get_task_status', async () => {
    const { client, calls } = recorder();
    await runTaskCommand('status', ['t1'], {}, client);
    expect(calls[0]).toEqual({ name: 'lingji_get_task_status', args: { taskId: 't1' } });
  });

  it('list with --project filters', async () => {
    const { client, calls } = recorder();
    await runTaskCommand('list', [], { project: '/p' }, client);
    expect(calls[0]).toEqual({ name: 'lingji_list_tasks', args: { projectPath: '/p' } });
  });

  it('list without --project sends empty args', async () => {
    const { client, calls } = recorder();
    await runTaskCommand('list', [], {}, client);
    expect(calls[0]).toEqual({ name: 'lingji_list_tasks', args: {} });
  });

  it('cancel <id> → lingji_cancel_task', async () => {
    const { client, calls } = recorder();
    await runTaskCommand('cancel', ['t9'], {}, client);
    expect(calls[0]).toEqual({ name: 'lingji_cancel_task', args: { taskId: 't9' } });
  });

  it('status without id throws bad_args', async () => {
    const { client } = recorder();
    await expect(runTaskCommand('status', [], {}, client)).rejects.toMatchObject({ code: 'bad_args' });
  });
});

describe('waitForTask', () => {
  it('polls until terminal status', async () => {
    const statuses = ['running', 'running', 'succeeded'];
    let i = 0;
    const { client } = recorder(() => ({ taskId: 't', status: statuses[i++], progress: { percent: i * 30 } }));
    const updates: string[] = [];
    const result: any = await waitForTask('t', client, {
      sleep: async () => {},
      onUpdate: (t: any) => updates.push(t.status),
    });
    expect(result.status).toBe('succeeded');
    expect(updates).toEqual(['running', 'running', 'succeeded']);
  });
});

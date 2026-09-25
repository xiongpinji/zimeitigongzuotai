// tests/cli-audio-command.test.ts
import { describe, it, expect } from 'vitest';
import { runAudioCommand } from '../cli/src/commands/audio';
import type { ToolCaller } from '../cli/src/client';

function fake() {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const client: ToolCaller = {
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'lingji_get_active_project') return { projectPath: '/active' };
      return { taskId: 'tk' };
    },
    async close() {},
  };
  return { client, calls };
}

describe('runAudioCommand', () => {
  it('gen → lingji_generate_audio with resolved project', async () => {
    const { client, calls } = fake();
    await runAudioCommand('gen', {}, client);
    expect(calls.some((c) => c.name === 'lingji_generate_audio' && (c.args as any).projectPath === '/active')).toBe(true);
  });

  it('unknown action throws bad_args', async () => {
    const { client } = fake();
    await expect(runAudioCommand('frob', {}, client)).rejects.toMatchObject({ code: 'bad_args' });
  });
});

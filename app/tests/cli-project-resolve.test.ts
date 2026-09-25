// tests/cli-project-resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveProjectPath } from '../cli/src/project-resolve';
import type { ToolCaller } from '../cli/src/client';

function fake(active: string | null): ToolCaller & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(name) { calls.push(name); return { projectPath: active }; },
    async close() {},
  };
}

describe('resolveProjectPath', () => {
  it('uses --project flag without calling the server', async () => {
    const c = fake('/active');
    const p = await resolveProjectPath({ project: '/explicit' }, c);
    expect(p).toBe('/explicit');
    expect(c.calls).toEqual([]);
  });

  it('falls back to active project', async () => {
    const c = fake('/active');
    const p = await resolveProjectPath({}, c);
    expect(p).toBe('/active');
    expect(c.calls).toEqual(['lingji_get_active_project']);
  });

  it('throws no_project when no flag and no active project', async () => {
    const c = fake(null);
    await expect(resolveProjectPath({}, c)).rejects.toMatchObject({ code: 'no_project' });
  });
});

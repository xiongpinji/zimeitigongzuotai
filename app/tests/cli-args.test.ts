// tests/cli-args.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../cli/src/args';

describe('parseArgs', () => {
  it('parses group/action/positionals', () => {
    const r = parseArgs(['task', 'status', 'abc123']);
    expect(r.group).toBe('task');
    expect(r.action).toBe('status');
    expect(r.positionals).toEqual(['abc123']);
  });

  it('parses boolean flags', () => {
    const r = parseArgs(['task', 'wait', 'id', '--json', '--wait']);
    expect(r.flags.json).toBe(true);
    expect(r.flags.wait).toBe(true);
    expect(r.positionals).toEqual(['id']);
  });

  it('parses value flags both --k v and --k=v', () => {
    expect(parseArgs(['task', 'list', '--project', '/p']).flags.project).toBe('/p');
    expect(parseArgs(['task', 'list', '--project=/p']).flags.project).toBe('/p');
  });

  it('treats trailing value flag without value as boolean true', () => {
    expect(parseArgs(['project', 'open', '--server']).flags.server).toBe(true);
  });
});

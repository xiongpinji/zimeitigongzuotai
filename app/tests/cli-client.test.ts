// tests/cli-client.test.ts
import { describe, it, expect } from 'vitest';
import { parseToolResult } from '../cli/src/result';

describe('parseToolResult', () => {
  it('parses JSON text content', () => {
    const r = { content: [{ type: 'text', text: JSON.stringify({ projectPath: '/p' }) }] };
    expect(parseToolResult(r)).toEqual({ projectPath: '/p' });
  });

  it('throws with code when isError', () => {
    const r = {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: '无效项目', code: 'invalid_project' }) }],
    };
    try {
      parseToolResult(r);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toBe('无效项目');
      expect(e.code).toBe('invalid_project');
    }
  });

  it('returns null for empty content', () => {
    expect(parseToolResult({ content: [] })).toBeNull();
  });
});

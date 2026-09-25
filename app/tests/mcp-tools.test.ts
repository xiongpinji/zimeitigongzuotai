import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mcp video import tools', () => {
  it('registers video import tools near the script workflow tools', () => {
    const source = readFileSync(
      new URL('../electron/mcp/tools.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('lingji_import_video_source');
    expect(source).toContain('lingji_get_video_import_status');
  });
});

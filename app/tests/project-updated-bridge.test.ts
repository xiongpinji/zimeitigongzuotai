// tests/project-updated-bridge.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('pipeline:project-updated bridge', () => {
  it('preload exposes onProjectUpdated for the channel', () => {
    const src = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    expect(src).toContain('onProjectUpdated');
    expect(src).toContain('pipeline:project-updated');
  });
  it('electron-api declares onProjectUpdated type', () => {
    const src = readFileSync(new URL('../src/lib/electron-api.ts', import.meta.url), 'utf8');
    expect(src).toContain('onProjectUpdated');
  });
});

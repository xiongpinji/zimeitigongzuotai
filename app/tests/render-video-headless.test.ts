import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('render-video extraction', () => {
  it('renderVideoHeadless module exists and exports the function', () => {
    const src = readFileSync(new URL('../electron/remotion/render-video-headless.ts', import.meta.url), 'utf8');
    expect(src).toContain('export async function renderVideoHeadless');
    expect(src).toContain('onProgress');
  });
  it('main.ts render-video handler delegates to renderVideoHeadless', () => {
    const src = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    expect(src).toContain('renderVideoHeadless');
  });
});

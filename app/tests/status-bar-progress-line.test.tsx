import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('StatusBarProgressLine', () => {
  it('is rendered by AppStatusBar as the unified top progress marker', () => {
    const statusBarSource = readFileSync(
      new URL('../src/components/AppStatusBar.tsx', import.meta.url),
      'utf8',
    );

    expect(statusBarSource).toContain("import { StatusBarProgressLine } from './StatusBarProgressLine';");
    expect(statusBarSource).toContain('<StatusBarProgressLine />');
  });

  it('maps the active primary task to a 2px determinate or animated progress line', () => {
    const progressLineSource = readFileSync(
      new URL('../src/components/StatusBarProgressLine.tsx', import.meta.url),
      'utf8',
    );

    expect(progressLineSource).toContain("data-mode={primaryTask.mode}");
    expect(progressLineSource).toContain('`${primaryTask.progress}%`');
    expect(progressLineSource).toContain("'export': '#0A84FF'");
  });
});

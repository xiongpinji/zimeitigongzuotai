import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('script regenerate flow', () => {
  it('uses a workbench callback for content-area regenerate instead of submitting an agent prompt', () => {
    const source = readFileSync(
      new URL('../src/components/script/QuickActionBar.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(/workbenchCallbacks\.regenerateScript/);
    expect(source).toMatch(/disabled=\{!regenerateScript(?:\s*\|\|\s*isOperating)?\}/);
    expect(source).not.toMatch(/submitAgentPrompt\(buildRegeneratePrompt\(\)\)/);
  });

  it('registers a regenerate callback from ScriptWorkbench so the content area can trigger internal generation directly', () => {
    const source = readFileSync(
      new URL('../src/pages/ScriptWorkbench.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(/registerWorkbenchCallbacks\(\{[\s\S]*regenerateScript:/);
  });
});

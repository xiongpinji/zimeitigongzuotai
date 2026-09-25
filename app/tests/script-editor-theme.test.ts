import { describe, expect, it } from 'vitest';
import { scriptEditorTheme } from '../src/ui/components/script-editor-theme';

describe('scriptEditorTheme', () => {
  it('exports a non-empty array of extensions', () => {
    expect(Array.isArray(scriptEditorTheme)).toBe(true);
    expect(scriptEditorTheme.length).toBeGreaterThan(0);
  });
});

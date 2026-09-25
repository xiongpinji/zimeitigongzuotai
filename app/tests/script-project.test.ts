import { describe, expect, it } from 'vitest';
import { createBlankScriptProjectState } from '../src/lib/script-project';

describe('createBlankScriptProjectState', () => {
  it('creates a fresh script-workbench state for a newly selected directory', () => {
    expect(createBlankScriptProjectState('/tmp/new-project')).toEqual({
      projectDir: '/tmp/new-project',
      originalText: '',
      scriptText: '',
      selectedTemplate: 'news-broadcast',
      annotations: [],
      workspaceFiles: {
        hasOriginalFile: false,
        hasScriptFile: false,
      },
      reviewState: 'idle',
      scriptDocVersion: 0,
      manualStageOverride: null,
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  deriveAutoWorkbenchStage,
  deriveEffectiveWorkbenchStage,
  getFileReadiness,
  type WorkbenchStageContext,
} from '../src/lib/script-workbench-stage';

function makeContext(
  overrides: Partial<WorkbenchStageContext> = {},
): WorkbenchStageContext {
  return {
    workspaceFiles: {
      hasOriginalFile: false,
      hasScriptFile: false,
    },
    originalText: '',
    scriptText: '',
    reviewState: 'idle',
    annotations: [],
    manualStageOverride: null,
    ...overrides,
  };
}

describe('script workbench stage helpers', () => {
  it('treats a ready script as script-ready even when original and script files coexist', () => {
    const stage = deriveAutoWorkbenchStage(
      makeContext({
        workspaceFiles: {
          hasOriginalFile: true,
          hasScriptFile: true,
        },
        originalText: '原稿内容',
        scriptText: '口播稿内容',
      }),
    );

    expect(stage).toBe('script_ready');
  });

  it('falls back to original-ready when the script file exists but is still empty', () => {
    const stage = deriveAutoWorkbenchStage(
      makeContext({
        workspaceFiles: {
          hasOriginalFile: true,
          hasScriptFile: true,
        },
        originalText: '原稿内容',
        scriptText: '   ',
      }),
    );

    expect(stage).toBe('original_ready');
  });

  it('keeps an explicitly created but empty original file in the original-ready stage', () => {
    const stage = deriveAutoWorkbenchStage(
      makeContext({
        workspaceFiles: {
          hasOriginalFile: true,
          hasScriptFile: false,
        },
        originalText: '',
      }),
    );

    expect(stage).toBe('original_ready');
  });

  it('marks pending review issues ahead of the plain script-ready stage', () => {
    const stage = deriveAutoWorkbenchStage(
      makeContext({
        workspaceFiles: {
          hasOriginalFile: true,
          hasScriptFile: true,
        },
        originalText: '原稿内容',
        scriptText: '口播稿内容',
        reviewState: 'issues',
        annotations: [
          {
            status: 'pending',
          },
        ],
      }),
    );

    expect(stage).toBe('review_issues');
  });

  it('prefers the manual override stage when the user intervenes', () => {
    const stage = deriveEffectiveWorkbenchStage(
      makeContext({
        workspaceFiles: {
          hasOriginalFile: true,
          hasScriptFile: false,
        },
        originalText: '原稿内容',
        manualStageOverride: 'review_clean',
      }),
    );

    expect(stage).toBe('review_clean');
  });

  it('prefers real content over delayed file flags when reporting readiness', () => {
    expect(getFileReadiness(false, '内容')).toBe('ready');
    expect(getFileReadiness(false, '   ')).toBe('missing');
    expect(getFileReadiness(true, '   ')).toBe('empty');
    expect(getFileReadiness(true, '内容')).toBe('ready');
  });

  it('treats loaded content as original-ready even before the file tree catches up', () => {
    const stage = deriveAutoWorkbenchStage(
      makeContext({
        workspaceFiles: {
          hasOriginalFile: false,
          hasScriptFile: false,
        },
        originalText: '已经从磁盘恢复的原稿内容',
      }),
    );

    expect(stage).toBe('original_ready');
  });
});

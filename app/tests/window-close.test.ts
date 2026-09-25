import { describe, expect, it } from 'vitest';
import { resolveWindowCloseAction } from '../electron/window-close';

describe('resolveWindowCloseAction', () => {
  it('closes the current project instead of closing the window when a project is open', () => {
    expect(resolveWindowCloseAction({
      hasProject: true,
      isAppQuitting: false,
    })).toBe('close-project');
  });

  it('allows the native window close when no project is open', () => {
    expect(resolveWindowCloseAction({
      hasProject: false,
      isAppQuitting: false,
    })).toBe('allow-window-close');
  });

  it('allows app quit to proceed even if a project is open', () => {
    expect(resolveWindowCloseAction({
      hasProject: true,
      isAppQuitting: true,
    })).toBe('allow-window-close');
  });
});

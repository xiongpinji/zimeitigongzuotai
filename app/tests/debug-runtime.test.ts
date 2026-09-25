import { describe, expect, it } from 'vitest';
import {
  resolveDebugRuntimeState,
  shouldAutoOpenDevTools,
} from '../electron/debug-runtime';

describe('debug runtime state', () => {
  it('开发环境始终视为可打开 DevTools', () => {
    expect(
      resolveDebugRuntimeState({
        isPackaged: false,
        debugMode: false,
      }),
    ).toEqual({
      isDevelopment: true,
      allowDevTools: true,
    });
  });

  it('线上包仅在开启调试模式时允许 DevTools', () => {
    expect(
      resolveDebugRuntimeState({
        isPackaged: true,
        debugMode: false,
      }),
    ).toEqual({
      isDevelopment: false,
      allowDevTools: false,
    });

    expect(
      resolveDebugRuntimeState({
        isPackaged: true,
        debugMode: true,
      }),
    ).toEqual({
      isDevelopment: true,
      allowDevTools: true,
    });
  });

  it('仅在线上包 + 调试模式下自动弹出分离式控制台', () => {
    expect(
      shouldAutoOpenDevTools({
        isPackaged: false,
        debugMode: true,
      }),
    ).toBe(false);

    expect(
      shouldAutoOpenDevTools({
        isPackaged: true,
        debugMode: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoOpenDevTools({
        isPackaged: true,
        debugMode: true,
      }),
    ).toBe(true);
  });
});

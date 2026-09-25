import { describe, expect, it } from 'vitest';
import { toRendererConsoleLog } from '../electron/console-message';

describe('toRendererConsoleLog', () => {
  it('reads console details from the Electron event object payload', () => {
    const result = toRendererConsoleLog({
      level: 'warning',
      message: '渲染器警告',
      lineNumber: 42,
      sourceId: 'http://localhost:5173/src/main.tsx',
    });

    expect(result).toEqual({
      level: 'warn',
      scope: 'renderer-console',
      message: '渲染器警告',
      details: 'http://localhost:5173/src/main.tsx:42',
    });
  });

  it('falls back to info and omits details when sourceId is empty', () => {
    const result = toRendererConsoleLog({
      level: 'debug',
      message: '调试信息',
      lineNumber: 0,
      sourceId: '',
    });

    expect(result).toEqual({
      level: 'info',
      scope: 'renderer-console',
      message: '调试信息',
      details: undefined,
    });
  });
});

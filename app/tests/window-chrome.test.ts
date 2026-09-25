import { describe, expect, it } from 'vitest';
import { getWindowChromeOptions } from '../electron/window-chrome';

describe('getWindowChromeOptions', () => {
  it('keeps the native menu bar visible on Windows', () => {
    expect(getWindowChromeOptions('win32')).toEqual({
      autoHideMenuBar: false,
    });
  });

  it('keeps the native menu bar visible on Linux', () => {
    expect(getWindowChromeOptions('linux')).toEqual({
      autoHideMenuBar: false,
    });
  });

  it('uses the custom inset title bar on macOS', () => {
    expect(getWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
    });
  });
});

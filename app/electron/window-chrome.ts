import type { BrowserWindowConstructorOptions } from 'electron';

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  'autoHideMenuBar' | 'titleBarStyle' | 'titleBarOverlay'
>;

export function getWindowChromeOptions(platform: NodeJS.Platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
    };
  }

  return {
    autoHideMenuBar: false,
  };
}

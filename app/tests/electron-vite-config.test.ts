import { describe, expect, it } from 'vitest';
import config from '../electron.vite.config';

describe('electron-vite build config', () => {
  it('keeps dist-electron artifacts when rebuilding main and preload', () => {
    expect(config.main?.build?.outDir).toBe('dist-electron');
    expect(config.preload?.build?.outDir).toBe('dist-electron');
    expect(config.main?.build?.emptyOutDir).toBe(false);
    expect(config.preload?.build?.emptyOutDir).toBe(false);
  });
});

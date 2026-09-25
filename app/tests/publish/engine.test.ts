import { describe, it, expect, vi } from 'vitest';
import { withContext } from '../../electron/publish/engine';

it('withContext 用 storageState 建 context 并在结束后关闭', async () => {
  const newContext = vi.fn().mockResolvedValue({
    addInitScript: vi.fn(),
    close: vi.fn(),
  });
  const browser = { newContext, close: vi.fn() };
  const launch = vi.fn().mockResolvedValue(browser);
  const fakePlaywright = { chromium: { launch } };

  const ran = vi.fn().mockResolvedValue('ok');
  const result = await withContext(
    { storageStatePath: '/tmp/s.json', headless: true },
    ran,
    fakePlaywright as any,
  );

  expect(result).toBe('ok');
  expect(launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
  expect(newContext).toHaveBeenCalledWith(expect.objectContaining({ storageState: '/tmp/s.json' }));
  expect(ran).toHaveBeenCalled();
  expect(browser.close).toHaveBeenCalled();
});

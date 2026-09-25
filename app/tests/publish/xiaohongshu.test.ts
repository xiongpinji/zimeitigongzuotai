import { it, expect, vi } from 'vitest';
import { uploadXiaohongshuVideo } from '../../electron/publish/platforms/xiaohongshu';

/**
 * Mock page for uploadXiaohongshuVideo.
 *
 * Key mock values chosen to make all loops terminate immediately:
 *   count()       → 1        locators "exist", so previewNew is found in upload-wait loop
 *   innerText()   → '上传成功'  upload-wait loop breaks on first keyword match
 *   isVisible()   → false    login-box markers absent (no login screen)
 *   isChecked()   → true     original-declaration checkbox already checked (skip check())
 *   waitForURL()  → resolves publish loop breaks on first iteration
 *   waitFor()     → resolves upload-input waitFor doesn't throw
 *   frames()      → [page]   mirrors tencent test structure (unused in xhs but harmless)
 */
function makeMockPage() {
  const sharedLocator: any = {
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(1),
    isVisible: vi.fn().mockResolvedValue(false),
    isChecked: vi.fn().mockResolvedValue(true),
    // '上传成功' is in UPLOAD_SUCCESS_KEYWORDS → upload-wait loop breaks immediately
    innerText: vi.fn().mockResolvedValue('上传成功'),
    getAttribute: vi.fn().mockResolvedValue(''),
    check: vi.fn().mockResolvedValue(undefined),
    all: vi.fn().mockResolvedValue([]),
  };
  sharedLocator.first = () => sharedLocator;
  sharedLocator.nth = () => sharedLocator;
  sharedLocator.locator = vi.fn().mockReturnValue(sharedLocator);
  sharedLocator.getByText = vi.fn().mockReturnValue(sharedLocator);
  sharedLocator.filter = vi.fn().mockReturnValue(sharedLocator);

  const page: any = {
    goto: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(sharedLocator),
    getByText: vi.fn().mockReturnValue(sharedLocator),
    getByRole: vi.fn().mockReturnValue(sharedLocator),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(sharedLocator),
    evaluate: vi.fn().mockResolvedValue(undefined),
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    // URL is a non-login page so _isXhsLoginCompleted-style checks pass
    url: vi.fn().mockReturnValue('https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video'),
    _sharedLocator: sharedLocator,
  };
  page.frames = vi.fn().mockReturnValue([page]);

  return page;
}

it('uploadXiaohongshuVideo 把视频文件设置到 upload-input 上', async () => {
  const page = makeMockPage();

  await uploadXiaohongshuVideo(page as any, {
    storageStatePath: '/c.json',
    filePath: '/tmp/v.mp4',
    title: '标题',
    desc: '描述',
    tags: ['a', 'b'],
    headless: true,
  });

  // The file-upload step calls:
  //   page.locator("div[class^='upload-content'] input[class='upload-input']").setInputFiles('/tmp/v.mp4')
  // page.locator(...) → sharedLocator, sharedLocator.setInputFiles must have been called with '/tmp/v.mp4'
  const { _sharedLocator: loc } = page;
  expect(loc.setInputFiles).toHaveBeenCalledWith('/tmp/v.mp4');
});

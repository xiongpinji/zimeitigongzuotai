import { it, expect, vi } from 'vitest';
import { uploadKuaishouVideo } from '../../electron/publish/platforms/kuaishou';

/**
 * Mock page where every page.locator() / getByText() / getByRole() returns the same
 * sharedLocator so we can verify the upload flow in isolation.
 *
 * Key mock values chosen to make all upload-flow loops terminate immediately:
 *   count()           → 0   ("上传中" absent → upload-wait loop breaks; publish count=0 but
 *                             waitForURL resolves so publish loop breaks)
 *   isVisible()       → false (guide overlay / know-button absent)
 *   waitFor()         → resolves (upload button found, modal waits succeed)
 *   waitForURL()      → resolves (publish loop breaks on first iteration)
 *   waitForEvent()    → resolves with mockFileChooser (file chooser obtained)
 *   mockFileChooser.setFiles → spy (the assertion target)
 */
function makeMockPage() {
  const mockFileChooser = {
    setFiles: vi.fn().mockResolvedValue(undefined),
  };

  const sharedLocator: any = {
    click: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    isVisible: vi.fn().mockResolvedValue(false),
    getAttribute: vi.fn().mockResolvedValue(''),
    getByText: vi.fn(),
    getByRole: vi.fn(),
    locator: vi.fn(),
    filter: vi.fn(),
    nth: vi.fn(),
  };
  // Self-referential so chaining always returns sharedLocator
  sharedLocator.first = () => sharedLocator;
  sharedLocator.getByText = vi.fn().mockReturnValue(sharedLocator);
  sharedLocator.getByRole = vi.fn().mockReturnValue(sharedLocator);
  sharedLocator.locator = vi.fn().mockReturnValue(sharedLocator);
  sharedLocator.filter = vi.fn().mockReturnValue(sharedLocator);
  sharedLocator.nth = vi.fn().mockReturnValue(sharedLocator);

  const page: any = {
    goto: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(sharedLocator),
    getByText: vi.fn().mockReturnValue(sharedLocator),
    getByRole: vi.fn().mockReturnValue(sharedLocator),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    // waitForEvent('filechooser') → resolves with mockFileChooser
    waitForEvent: vi.fn().mockResolvedValue(mockFileChooser),
    evaluate: vi.fn().mockResolvedValue(true),
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    url: vi.fn().mockReturnValue('https://cp.kuaishou.com/article/manage/video'),
    frames: vi.fn().mockReturnValue([]),
    // Expose mockFileChooser so the assertion can reach it
    _mockFileChooser: mockFileChooser,
  };

  return page;
}

it(
  'uploadKuaishouVideo 把视频文件设置到文件选择器上',
  async () => {
    const page = makeMockPage();

    await uploadKuaishouVideo(page as any, {
      storageStatePath: '/c.json',
      filePath: '/tmp/v.mp4',
      title: '标题',
      desc: '描述',
      tags: [], // empty → no per-tag sleep
      headless: true,
    });

    // uploadKuaishouVideo uses page.waitForEvent('filechooser') → fileChooser.setFiles(filePath)
    // (port of: async with page.expect_file_chooser() / file_chooser.set_files(self.file_path))
    expect(page._mockFileChooser.setFiles).toHaveBeenCalledWith('/tmp/v.mp4');
  },
  10_000, // 10s timeout: real sleep(2000) + sleep(1000) in publish loop
);

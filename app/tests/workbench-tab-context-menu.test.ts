import { describe, expect, it, vi } from 'vitest';
import { createWorkbenchTabContextMenuTemplate } from '../electron/workbench-tab-context-menu';

describe('createWorkbenchTabContextMenuTemplate', () => {
  it('includes VSCode-style close actions and file operations', () => {
    const template = createWorkbenchTabContextMenuTemplate({
      file: 'script.md',
      tabIndex: 1,
      tabCount: 3,
      hasResolvedPath: true,
      platform: 'darwin',
      onMenuAction: vi.fn(),
      onCopyPath: vi.fn(),
      onRevealInFileManager: vi.fn(),
    });

    expect(template).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '关闭' }),
        expect.objectContaining({ label: '关闭其他' }),
        expect.objectContaining({ label: '关闭右侧' }),
        expect.objectContaining({ label: '复制路径' }),
        expect.objectContaining({ label: '在 Finder 中显示' }),
      ]),
    );
  });

  it('disables actions that are not currently available', () => {
    const template = createWorkbenchTabContextMenuTemplate({
      file: 'original.md',
      tabIndex: 0,
      tabCount: 1,
      hasResolvedPath: false,
      platform: 'win32',
      onMenuAction: vi.fn(),
      onCopyPath: vi.fn(),
      onRevealInFileManager: vi.fn(),
    });

    const closeOthers = template.find((item) => 'label' in item && item.label === '关闭其他');
    const closeRight = template.find((item) => 'label' in item && item.label === '关闭右侧');
    const copyPath = template.find((item) => 'label' in item && item.label === '复制路径');
    const reveal = template.find((item) => 'label' in item && item.label === '在资源管理器中显示');

    expect(closeOthers).toMatchObject({ enabled: false });
    expect(closeRight).toMatchObject({ enabled: false });
    expect(copyPath).toMatchObject({ enabled: false });
    expect(reveal).toMatchObject({ enabled: false });
  });
});

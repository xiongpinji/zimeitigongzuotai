import type { MenuItemConstructorOptions } from 'electron';
import type { WorkbenchTabCloseAction } from '../src/lib/script-tab-actions';

interface CreateWorkbenchTabContextMenuTemplateOptions {
  file: string;
  tabIndex: number;
  tabCount: number;
  hasResolvedPath: boolean;
  platform?: NodeJS.Platform | string;
  onMenuAction: (action: WorkbenchTabCloseAction, file: string) => void;
  onCopyPath: () => void;
  onRevealInFileManager: () => void;
}

export function createWorkbenchTabContextMenuTemplate({
  file,
  tabIndex,
  tabCount,
  hasResolvedPath,
  platform = process.platform,
  onMenuAction,
  onCopyPath,
  onRevealInFileManager,
}: CreateWorkbenchTabContextMenuTemplateOptions): MenuItemConstructorOptions[] {
  const canCloseOthers = tabCount > 1;
  const canCloseRight = tabIndex >= 0 && tabIndex < tabCount - 1;
  const revealLabel = platform === 'darwin' ? '在 Finder 中显示' : '在资源管理器中显示';

  return [
    {
      label: '关闭',
      click: () => onMenuAction('close-current', file),
    },
    {
      label: '关闭其他',
      enabled: canCloseOthers,
      click: () => onMenuAction('close-others', file),
    },
    {
      label: '关闭右侧',
      enabled: canCloseRight,
      click: () => onMenuAction('close-right', file),
    },
    { type: 'separator' },
    {
      label: '复制路径',
      enabled: hasResolvedPath,
      click: onCopyPath,
    },
    {
      label: revealLabel,
      enabled: hasResolvedPath,
      click: onRevealInFileManager,
    },
  ];
}

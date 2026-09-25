import type { AppIconName } from '../components/AppIcon';

export type TimelineContextMenuTarget = 'overlay' | 'track';
export type TimelineContextMenuActionKey =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'insert-image-card'
  | 'insert-video-card'
  | 'convert-to-motion';

export interface TimelineContextMenuItem {
  key: TimelineContextMenuActionKey;
  label: string;
  icon: AppIconName;
  shortcut: string;
  disabled: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
}

interface TimelineContextMenuOptions {
  target: TimelineContextMenuTarget;
  canPaste: boolean;
  /** 仅 overlay 目标：源卡为 image/video 时为 true，决定「转为动画卡」是否启用。 */
  convertibleToMotion?: boolean;
}

export function getTimelineContextMenuItems(
  options: TimelineContextMenuOptions,
): TimelineContextMenuItem[] {
  const disableSourceActions = options.target === 'track';
  const isTrack = options.target === 'track';

  const items: TimelineContextMenuItem[] = [
    {
      key: 'copy',
      label: '复制',
      icon: 'copy',
      shortcut: '⌘C',
      disabled: disableSourceActions,
    },
    {
      key: 'cut',
      label: '剪切',
      icon: 'scissors',
      shortcut: '⌘X',
      disabled: disableSourceActions,
    },
    {
      key: 'paste',
      label: '粘贴',
      icon: 'clipboard',
      shortcut: '⌘V',
      disabled: !options.canPaste,
    },
    {
      key: 'delete',
      label: '删除',
      icon: 'trash-2',
      shortcut: '⌫',
      destructive: true,
      separatorBefore: true,
      disabled: disableSourceActions,
    },
    {
      key: 'insert-image-card',
      label: '在此插入图片卡',
      icon: 'image',
      shortcut: '',
      separatorBefore: true,
      disabled: !isTrack,
    },
    {
      key: 'insert-video-card',
      label: '在此插入视频卡',
      icon: 'film',
      shortcut: '',
      disabled: !isTrack,
    },
  ];

  if (options.target === 'overlay') {
    items.push({
      key: 'convert-to-motion',
      label: '转为动画卡',
      icon: 'sparkles',
      shortcut: '',
      separatorBefore: true,
      disabled: !options.convertibleToMotion,
    });
  }

  return items;
}

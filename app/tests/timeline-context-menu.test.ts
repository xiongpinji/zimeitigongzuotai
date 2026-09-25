import { describe, expect, it } from 'vitest';
import { getTimelineContextMenuItems } from '../src/lib/timeline-context-menu';

describe('getTimelineContextMenuItems', () => {
  it('returns the overlay menu in design order and enables source actions', () => {
    expect(
      getTimelineContextMenuItems({
        target: 'overlay',
        canPaste: true,
      }),
    ).toEqual([
      {
        key: 'copy',
        label: '复制',
        icon: 'copy',
        shortcut: '⌘C',
        disabled: false,
      },
      {
        key: 'cut',
        label: '剪切',
        icon: 'scissors',
        shortcut: '⌘X',
        disabled: false,
      },
      {
        key: 'paste',
        label: '粘贴',
        icon: 'clipboard',
        shortcut: '⌘V',
        disabled: false,
      },
      {
        key: 'delete',
        label: '删除',
        icon: 'trash-2',
        shortcut: '⌫',
        destructive: true,
        separatorBefore: true,
        disabled: false,
      },
      {
        key: 'insert-image-card',
        label: '在此插入图片卡',
        icon: 'image',
        shortcut: '',
        separatorBefore: true,
        disabled: true,
      },
      {
        key: 'insert-video-card',
        label: '在此插入视频卡',
        icon: 'film',
        shortcut: '',
        disabled: true,
      },
      {
        key: 'convert-to-motion',
        label: '转为动画卡',
        icon: 'sparkles',
        shortcut: '',
        separatorBefore: true,
        disabled: true,
      },
    ]);
  });

  it('disables source-only actions on empty track lanes when there is nothing selected', () => {
    expect(
      getTimelineContextMenuItems({
        target: 'track',
        canPaste: false,
      }),
    ).toEqual([
      {
        key: 'copy',
        label: '复制',
        icon: 'copy',
        shortcut: '⌘C',
        disabled: true,
      },
      {
        key: 'cut',
        label: '剪切',
        icon: 'scissors',
        shortcut: '⌘X',
        disabled: true,
      },
      {
        key: 'paste',
        label: '粘贴',
        icon: 'clipboard',
        shortcut: '⌘V',
        disabled: true,
      },
      {
        key: 'delete',
        label: '删除',
        icon: 'trash-2',
        shortcut: '⌫',
        destructive: true,
        separatorBefore: true,
        disabled: true,
      },
      {
        key: 'insert-image-card',
        label: '在此插入图片卡',
        icon: 'image',
        shortcut: '',
        separatorBefore: true,
        disabled: false,
      },
      {
        key: 'insert-video-card',
        label: '在此插入视频卡',
        icon: 'film',
        shortcut: '',
        disabled: false,
      },
    ]);
  });
});

describe('timeline-context-menu — insert media card', () => {
  it('track target 包含 insert-image-card / insert-video-card 且可用', () => {
    const items = getTimelineContextMenuItems({ target: 'track', canPaste: false });
    const keys = items.map((i) => i.key);
    expect(keys).toContain('insert-image-card');
    expect(keys).toContain('insert-video-card');
    const insertImage = items.find((i) => i.key === 'insert-image-card');
    const insertVideo = items.find((i) => i.key === 'insert-video-card');
    expect(insertImage?.disabled).toBe(false);
    expect(insertVideo?.disabled).toBe(false);
  });

  it('overlay target 不显示 insert-image-card / insert-video-card（disabled）', () => {
    const items = getTimelineContextMenuItems({ target: 'overlay', canPaste: false });
    const insertItem = items.find((i) => i.key === 'insert-image-card');
    expect(insertItem?.disabled).toBe(true);
    const insertVideo = items.find((i) => i.key === 'insert-video-card');
    expect(insertVideo?.disabled).toBe(true);
  });

  it('overlay 且可转换 motion 时，追加启用的「转为动画卡」项', () => {
    const items = getTimelineContextMenuItems({
      target: 'overlay',
      canPaste: false,
      convertibleToMotion: true,
    });
    const convert = items.find((i) => i.key === 'convert-to-motion');
    expect(convert).toEqual({
      key: 'convert-to-motion',
      label: '转为动画卡',
      icon: 'sparkles',
      shortcut: '',
      separatorBefore: true,
      disabled: false,
    });
  });

  it('overlay 不可转换时，「转为动画卡」存在但禁用', () => {
    const items = getTimelineContextMenuItems({
      target: 'overlay',
      canPaste: false,
      convertibleToMotion: false,
    });
    expect(items.find((i) => i.key === 'convert-to-motion')?.disabled).toBe(true);
  });

  it('track 目标不含「转为动画卡」', () => {
    const items = getTimelineContextMenuItems({ target: 'track', canPaste: true });
    expect(items.some((i) => i.key === 'convert-to-motion')).toBe(false);
  });
});

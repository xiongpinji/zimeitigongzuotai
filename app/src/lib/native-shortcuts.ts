import type { MenuAction } from './electron-api';

interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
  readOnly?: boolean;
  disabled?: boolean;
}

interface KeyboardShortcutLike {
  hasProject?: boolean;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const element = target as EditableTargetLike;
  if (element.isContentEditable) {
    return true;
  }

  const tagName = element.tagName?.toUpperCase();
  if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
    return !element.readOnly && !element.disabled;
  }

  if (typeof element.closest === 'function') {
    return Boolean(element.closest('[contenteditable="true"]'));
  }

  return false;
}

export function getAppShortcutCommand(
  event: KeyboardShortcutLike,
): Extract<MenuAction, 'undo' | 'redo' | 'close-project'> | null {
  const hasPrimaryModifier = event.metaKey || event.ctrlKey;
  if (!hasPrimaryModifier || event.altKey) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === 'z') {
    return event.shiftKey ? 'redo' : 'undo';
  }

  if (key === 'y' && event.ctrlKey) {
    return 'redo';
  }

  if (key === 'w' && event.hasProject) {
    return 'close-project';
  }

  return null;
}

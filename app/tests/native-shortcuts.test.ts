import { describe, expect, it } from 'vitest';
import { getAppShortcutCommand, isTextEditingTarget } from '../src/lib/native-shortcuts';

describe('native shortcuts helpers', () => {
  it('detects editable targets so native input shortcuts are preserved', () => {
    expect(isTextEditingTarget({ tagName: 'input' } as EventTarget)).toBe(true);
    expect(isTextEditingTarget({ tagName: 'textarea', readOnly: true } as EventTarget)).toBe(false);
    expect(isTextEditingTarget({ isContentEditable: true } as EventTarget)).toBe(true);
    expect(
      isTextEditingTarget({
        tagName: 'div',
        closest: (selector: string) => (selector === '[contenteditable="true"]' ? {} : null),
      } as EventTarget),
    ).toBe(true);
    expect(isTextEditingTarget({ tagName: 'div' } as EventTarget)).toBe(false);
  });

  it('maps app-level undo and redo shortcuts outside text inputs', () => {
    expect(
      getAppShortcutCommand({
        hasProject: false,
        key: 'z',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('undo');
    expect(
      getAppShortcutCommand({
        hasProject: false,
        key: 'Z',
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe('redo');
    expect(
      getAppShortcutCommand({
        hasProject: false,
        key: 'y',
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('redo');
    expect(
      getAppShortcutCommand({
        hasProject: true,
        key: 'w',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('close-project');
    expect(
      getAppShortcutCommand({
        hasProject: false,
        key: 'w',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      getAppShortcutCommand({
        hasProject: false,
        key: 'a',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });
});

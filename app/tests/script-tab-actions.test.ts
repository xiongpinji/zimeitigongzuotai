import { describe, expect, it } from 'vitest';
import {
  getNextOpenedWorkbenchTab,
  getWorkbenchTabCloseTargets,
} from '../src/lib/script-tab-actions';

describe('script tab actions', () => {
  const tabs = ['original.md', 'notes.md', 'script.md', 'outline.md'];

  it('returns the clicked file for close-current', () => {
    expect(getWorkbenchTabCloseTargets(tabs, 'notes.md', 'close-current')).toEqual(['notes.md']);
  });

  it('returns every other file for close-others', () => {
    expect(getWorkbenchTabCloseTargets(tabs, 'script.md', 'close-others')).toEqual([
      'original.md',
      'notes.md',
      'outline.md',
    ]);
  });

  it('returns only the tabs to the right for close-right', () => {
    expect(getWorkbenchTabCloseTargets(tabs, 'notes.md', 'close-right')).toEqual([
      'script.md',
      'outline.md',
    ]);
    expect(getWorkbenchTabCloseTargets(tabs, 'outline.md', 'close-right')).toEqual([]);
  });

  it('prefers the left neighbor when the active tab is closed', () => {
    expect(getNextOpenedWorkbenchTab(tabs, 'script.md', ['script.md'])).toBe('notes.md');
  });

  it('falls back to the right neighbor when there is no left tab left', () => {
    expect(
      getNextOpenedWorkbenchTab(['original.md', 'script.md'], 'original.md', ['original.md']),
    ).toBe('script.md');
  });

  it('keeps the active tab when it is not being closed', () => {
    expect(getNextOpenedWorkbenchTab(tabs, 'notes.md', ['outline.md'])).toBe('notes.md');
  });
});

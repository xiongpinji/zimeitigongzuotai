import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCurrentProject,
  getCurrentProjectDir,
  setProjectDir,
} from '../src/store/timeline';

function createStorageMock() {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };
}

describe('project workspace helpers', () => {
  beforeEach(() => {
    const localStorage = createStorageMock();
    vi.stubGlobal('window', {
      localStorage,
    });
    localStorage.clear();
  });

  it('stores current project dir without persisting legacy recent projects', () => {
    setProjectDir('/tmp/project-a');

    expect(getCurrentProjectDir()).toBe('/tmp/project-a');
    expect(window.localStorage.getItem('podcast-editor-recent-projects')).toBeNull();
  });

  it('clears the active project dir', () => {
    setProjectDir('/tmp/project-a');

    clearCurrentProject();

    expect(getCurrentProjectDir()).toBe('');
  });
});

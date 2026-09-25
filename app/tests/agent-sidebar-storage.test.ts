import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('agent sidebar storage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createStorageMock());
  });

  it('defaults to expanded when nothing has been stored', async () => {
    const { loadAgentSessionListCollapsed } = await import(
      '../src/lib/agent-sidebar-storage'
    );

    expect(loadAgentSessionListCollapsed()).toBe(false);
  });

  it('persists and restores the collapsed flag', async () => {
    const {
      loadAgentSessionListCollapsed,
      saveAgentSessionListCollapsed,
    } = await import('../src/lib/agent-sidebar-storage');

    saveAgentSessionListCollapsed(true);
    expect(loadAgentSessionListCollapsed()).toBe(true);

    saveAgentSessionListCollapsed(false);
    expect(loadAgentSessionListCollapsed()).toBe(false);
  });

  it('falls back to expanded when storage is unavailable', async () => {
    vi.unstubAllGlobals();
    const { loadAgentSessionListCollapsed, saveAgentSessionListCollapsed } = await import(
      '../src/lib/agent-sidebar-storage'
    );

    expect(loadAgentSessionListCollapsed()).toBe(false);
    expect(() => saveAgentSessionListCollapsed(true)).not.toThrow();
  });
});

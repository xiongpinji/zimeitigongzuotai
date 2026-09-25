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

describe('settings-storage global settings bridge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reads sync settings from the initial global settings snapshot', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        getInitialGlobalSettings: () =>
          JSON.stringify({
            customTemplates: [
              {
                id: 'custom-1',
                name: '自定义模板',
                description: '说明',
                systemPrompt: 'prompt',
                createdAt: '2026-04-12T00:00:00.000Z',
                updatedAt: '2026-04-12T00:00:00.000Z',
              },
            ],
            selectedRole: 'deep-insight-podcast',
          }),
      },
    });

    const settingsStorage = await import('../src/lib/settings-storage');

    expect(settingsStorage.loadCustomTemplates()).toHaveLength(1);
    expect(settingsStorage.loadSelectedRole()).toBe('deep-insight-podcast');
  });

  it('migrates legacy localStorage settings into global-settings and clears legacy keys', async () => {
    const localStorage = createStorageMock();
    localStorage.setItem(
      'podcast-editor-custom-templates',
      JSON.stringify([
        {
          id: 'legacy-template',
          name: '旧模板',
          description: '旧描述',
          systemPrompt: 'legacy prompt',
          createdAt: '2026-04-12T00:00:00.000Z',
          updatedAt: '2026-04-12T00:00:00.000Z',
        },
      ]),
    );
    localStorage.setItem('podcast-editor-selected-role', 'news-broadcast');

    const loadGlobalSettings = vi.fn().mockResolvedValue(null);
    const saveGlobalSettings = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('window', {
      localStorage,
      electronAPI: {
        getInitialGlobalSettings: () => null,
        loadGlobalSettings,
        saveGlobalSettings,
      },
    });

    const settingsStorage = await import('../src/lib/settings-storage');
    await settingsStorage.hydrateSettingsStorage();

    expect(loadGlobalSettings.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(saveGlobalSettings).toHaveBeenCalledTimes(1);

    const savedPayload = JSON.parse(saveGlobalSettings.mock.calls[0][0] as string);
    expect(savedPayload.customTemplates).toHaveLength(1);
    expect(savedPayload.selectedRole).toBe('news-broadcast');

    expect(localStorage.getItem('podcast-editor-custom-templates')).toBeNull();
    expect(localStorage.getItem('podcast-editor-selected-role')).toBeNull();
  });
});

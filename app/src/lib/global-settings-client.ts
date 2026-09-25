import type { GlobalSettingsFile } from '../types/global-settings';

function parseGlobalSettings(raw: string | null): GlobalSettingsFile | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as GlobalSettingsFile;
  } catch {
    return null;
  }
}

export function getInitialGlobalSettings(): GlobalSettingsFile | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return parseGlobalSettings(window.electronAPI?.getInitialGlobalSettings?.() ?? null);
}

export async function loadGlobalSettingsFile(): Promise<GlobalSettingsFile | null> {
  if (typeof window === 'undefined' || !window.electronAPI?.loadGlobalSettings) {
    return null;
  }

  return parseGlobalSettings(await window.electronAPI.loadGlobalSettings());
}

export async function saveGlobalSettingsFile(settings: GlobalSettingsFile): Promise<void> {
  if (typeof window === 'undefined' || !window.electronAPI?.saveGlobalSettings) {
    return;
  }

  await window.electronAPI.saveGlobalSettings(JSON.stringify(settings));
}

export async function updateGlobalSettingsFile(
  updater: (current: GlobalSettingsFile) => GlobalSettingsFile,
): Promise<GlobalSettingsFile> {
  const current = (await loadGlobalSettingsFile()) ?? {};
  const next = updater(current);
  await saveGlobalSettingsFile(next);
  return next;
}

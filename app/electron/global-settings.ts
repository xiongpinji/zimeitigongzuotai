import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  normalizeGlobalSettingsFile,
  type GlobalSettingsFile,
} from '../src/types/global-settings';

export type { GlobalSettingsFile } from '../src/types/global-settings';

const SETTINGS_FILE = 'settings.json';

export async function loadGlobalSettings(
  userDataPath: string,
): Promise<GlobalSettingsFile | null> {
  try {
    const raw = await fs.readFile(
      path.join(userDataPath, SETTINGS_FILE),
      'utf-8',
    );
    return normalizeGlobalSettingsFile(JSON.parse(raw) as GlobalSettingsFile);
  } catch {
    return null;
  }
}

export function loadGlobalSettingsSync(userDataPath: string): GlobalSettingsFile | null {
  try {
    const raw = fsSync.readFileSync(path.join(userDataPath, SETTINGS_FILE), 'utf-8');
    return normalizeGlobalSettingsFile(JSON.parse(raw) as GlobalSettingsFile);
  } catch {
    return null;
  }
}

export async function saveGlobalSettings(
  userDataPath: string,
  settings: GlobalSettingsFile,
): Promise<void> {
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(
    path.join(userDataPath, SETTINGS_FILE),
    JSON.stringify(settings, null, 2),
    'utf-8',
  );
}

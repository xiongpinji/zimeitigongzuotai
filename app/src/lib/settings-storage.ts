import {
  DEFAULT_SELECTED_ROLE,
  normalizeGlobalSettingsFile,
  type CustomRole,
  type CustomScriptTemplate,
} from '../types/global-settings';
import {
  getInitialGlobalSettings,
  loadGlobalSettingsFile,
  updateGlobalSettingsFile,
} from './global-settings-client';

const CUSTOM_TEMPLATES_KEY = 'podcast-editor-custom-templates';
const SELECTED_ROLE_KEY = 'podcast-editor-selected-role';
const CUSTOM_ROLES_KEY = 'podcast-editor-custom-roles';

export type { CustomRole, CustomScriptTemplate } from '../types/global-settings';

interface SettingsCache {
  customTemplates: CustomScriptTemplate[];
  customRoles: CustomRole[];
  selectedRole: string;
}

function getStorage(): Storage | null {
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

function readLegacyJson<T>(key: string, fallback: T): T {
  const storage = getStorage();
  if (!storage) {
    return fallback;
  }

  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readLegacyText(key: string, fallback: string): string {
  const storage = getStorage();
  if (!storage) {
    return fallback;
  }

  try {
    return storage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function clearLegacyKeys(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(CUSTOM_TEMPLATES_KEY);
  storage.removeItem(SELECTED_ROLE_KEY);
  storage.removeItem(CUSTOM_ROLES_KEY);
}

function buildCacheFromSettings(): SettingsCache {
  const normalized = normalizeGlobalSettingsFile(getInitialGlobalSettings());

  const legacyTemplates = readLegacyJson<CustomScriptTemplate[]>(CUSTOM_TEMPLATES_KEY, []);
  const legacyCustomRoles = readLegacyJson<CustomRole[]>(CUSTOM_ROLES_KEY, []);
  const legacySelectedRole = readLegacyText(SELECTED_ROLE_KEY, DEFAULT_SELECTED_ROLE);

  return {
    customTemplates:
      normalized.customTemplates && normalized.customTemplates.length > 0
        ? normalized.customTemplates
        : legacyTemplates,
    customRoles:
      normalized.customRoles && normalized.customRoles.length > 0
        ? normalized.customRoles
        : legacyCustomRoles,
    selectedRole:
      normalized.selectedRole && normalized.selectedRole !== DEFAULT_SELECTED_ROLE
        ? normalized.selectedRole
        : legacySelectedRole,
  };
}

let cache: SettingsCache | null = null;
let hydrationPromise: Promise<void> | null = null;

function ensureCache(): SettingsCache {
  if (!cache) {
    cache = buildCacheFromSettings();
  }
  return cache;
}

function hasLegacySettings(): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  return [
    CUSTOM_TEMPLATES_KEY,
    SELECTED_ROLE_KEY,
    CUSTOM_ROLES_KEY,
  ].some((key) => storage.getItem(key) !== null);
}

async function persistPatch(
  patch: Partial<{
    customTemplates: CustomScriptTemplate[];
    customRoles: CustomRole[];
    selectedRole: string;
  }>,
): Promise<void> {
  const next = await updateGlobalSettingsFile((current) => ({
    ...current,
    ...patch,
  }));
  cache = {
    customTemplates: next.customTemplates ?? [],
    customRoles: next.customRoles ?? [],
    selectedRole: next.selectedRole ?? DEFAULT_SELECTED_ROLE,
  };
  clearLegacyKeys();
}

export async function hydrateSettingsStorage(): Promise<void> {
  if (hydrationPromise) {
    return hydrationPromise;
  }

  hydrationPromise = (async () => {
    const globalSettings = normalizeGlobalSettingsFile(await loadGlobalSettingsFile());
    const currentCache = ensureCache();

    cache = {
      customTemplates:
        globalSettings.customTemplates && globalSettings.customTemplates.length > 0
          ? globalSettings.customTemplates
          : currentCache.customTemplates,
      customRoles:
        globalSettings.customRoles && globalSettings.customRoles.length > 0
          ? globalSettings.customRoles
          : currentCache.customRoles,
      selectedRole:
        globalSettings.selectedRole && globalSettings.selectedRole !== DEFAULT_SELECTED_ROLE
          ? globalSettings.selectedRole
          : currentCache.selectedRole,
    };

    if (!hasLegacySettings()) {
      return;
    }

    const patch: Partial<{
      customTemplates: CustomScriptTemplate[];
      customRoles: CustomRole[];
      selectedRole: string;
    }> = {};

    if (
      (!globalSettings.customTemplates || globalSettings.customTemplates.length === 0) &&
      cache.customTemplates.length > 0
    ) {
      patch.customTemplates = cache.customTemplates;
    }
    if (
      (!globalSettings.customRoles || globalSettings.customRoles.length === 0) &&
      cache.customRoles.length > 0
    ) {
      patch.customRoles = cache.customRoles;
    }
    if (
      (!globalSettings.selectedRole ||
        globalSettings.selectedRole === DEFAULT_SELECTED_ROLE) &&
      cache.selectedRole
    ) {
      patch.selectedRole = cache.selectedRole;
    }

    if (Object.keys(patch).length > 0) {
      await persistPatch(patch);
      return;
    }

    clearLegacyKeys();
  })().finally(() => {
    hydrationPromise = null;
  });

  return hydrationPromise;
}

export function loadCustomTemplates(): CustomScriptTemplate[] {
  return ensureCache().customTemplates;
}

export async function saveCustomTemplates(templates: CustomScriptTemplate[]): Promise<void> {
  cache = { ...ensureCache(), customTemplates: templates };
  await persistPatch({ customTemplates: templates });
}

export async function addCustomTemplate(
  template: Omit<CustomScriptTemplate, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<CustomScriptTemplate> {
  const templates = loadCustomTemplates();
  const now = new Date().toISOString();
  const newTemplate: CustomScriptTemplate = {
    ...template,
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  await saveCustomTemplates([...templates, newTemplate]);
  return newTemplate;
}

export async function updateCustomTemplate(
  id: string,
  updates: Partial<Omit<CustomScriptTemplate, 'id' | 'createdAt'>>,
): Promise<void> {
  const templates = loadCustomTemplates();
  const index = templates.findIndex((template) => template.id === id);
  if (index === -1) {
    return;
  }

  const next = [...templates];
  next[index] = {
    ...next[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  await saveCustomTemplates(next);
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  await saveCustomTemplates(loadCustomTemplates().filter((template) => template.id !== id));
}

export interface ScriptRole {
  id: string;
  name: string;
  description: string;
  rolePrompt: string;
  isBuiltin: boolean;
}

export const NONE_ROLE: ScriptRole = {
  id: 'none',
  name: '不指定角色',
  description: '不附加角色设定，完全由模板决定风格',
  rolePrompt: '',
  isBuiltin: true,
};

export function loadCustomRoles(): CustomRole[] {
  return ensureCache().customRoles;
}

export async function saveCustomRoles(roles: CustomRole[]): Promise<void> {
  cache = { ...ensureCache(), customRoles: roles };
  await persistPatch({ customRoles: roles });
}

export function loadSelectedRole(): string {
  return ensureCache().selectedRole;
}

export function saveSelectedRole(roleId: string): void {
  cache = { ...ensureCache(), selectedRole: roleId };
  void persistPatch({ selectedRole: roleId });
}

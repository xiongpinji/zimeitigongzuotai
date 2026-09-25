/**
 * chrome.storage.local 持久化的 SettingsStore（设计文档 4.6）。
 *
 * 明文配置（含 API Key）只写入 chrome.storage.local，不进 Chrome Sync、不写导出/日志。
 * 读时经 migrateAiSettings 兼容历史结构；视图遮罩由 toAiSettingsView 负责（见 settings-store.ts）。
 */
import type { UpdateAiSettingsInput } from '@/domain/api-types';
import {
  applyAiSettingsUpdate,
  migrateAiSettings,
  type AiSettingsInternal,
  type SettingsStore,
} from './settings-store';

const STORAGE_KEY = 'sonar:ai-settings';

export function createChromeSettingsStore(): SettingsStore {
  return {
    async getAiSettings(): Promise<AiSettingsInternal> {
      const got = await chrome.storage.local.get(STORAGE_KEY);
      return migrateAiSettings(got[STORAGE_KEY]);
    },
    async updateAiSettings(input: UpdateAiSettingsInput): Promise<void> {
      const current = await this.getAiSettings();
      await chrome.storage.local.set({ [STORAGE_KEY]: applyAiSettingsUpdate(current, input) });
    },
  };
}

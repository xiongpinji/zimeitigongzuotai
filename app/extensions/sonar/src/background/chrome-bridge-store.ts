/**
 * chrome.storage.local 持久化的桥设置与 pending 队列（设计文档第 7 节）。
 *
 * 桥 token 是本机 loopback 共享密钥；只写 chrome.storage.local，不进 Chrome Sync、不写导出/日志。
 * pending 队列暂存桌面端不可达时未送达的负载，下次 alarm/启动补推。
 */
import {
  applyBridgeSettingsUpdate,
  migrateBridgeSettings,
  type BridgeSettings,
  type BridgeSettingsStore,
  type UpdateBridgeSettingsInput,
} from '@/bridge/bridge-settings';
import type { BridgePayload, BridgePendingStore } from '@/bridge/bridge-client';

const SETTINGS_KEY = 'sonar:bridge-settings';
const PENDING_KEY = 'sonar:bridge-pending';

export function createChromeBridgeSettingsStore(): BridgeSettingsStore {
  return {
    async get(): Promise<BridgeSettings> {
      const got = await chrome.storage.local.get(SETTINGS_KEY);
      return migrateBridgeSettings(got[SETTINGS_KEY]);
    },
    async update(input: UpdateBridgeSettingsInput): Promise<void> {
      const current = await this.get();
      await chrome.storage.local.set({ [SETTINGS_KEY]: applyBridgeSettingsUpdate(current, input) });
    },
  };
}

export function createChromeBridgePendingStore(): BridgePendingStore {
  return {
    async read(): Promise<BridgePayload[]> {
      const got = await chrome.storage.local.get(PENDING_KEY);
      const items = got[PENDING_KEY];
      return Array.isArray(items) ? (items as BridgePayload[]) : [];
    },
    async write(items: BridgePayload[]): Promise<void> {
      await chrome.storage.local.set({ [PENDING_KEY]: items });
    },
  };
}

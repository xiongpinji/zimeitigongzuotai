// src/types/config-backup.ts
import type { GlobalSettingsFile } from './global-settings';
import type { AgentConfigData } from '../../electron/acp/types';

/** 导出文件 schema 版本，递增时必须考虑迁移 */
export const CONFIG_BACKUP_SCHEMA_VERSION = '1.0' as const;

export interface ConfigBackup {
  schemaVersion: typeof CONFIG_BACKUP_SCHEMA_VERSION;
  /** ISO 8601 时间戳 */
  exportedAt: string;
  /** 应用版本（来自 package.json） */
  appVersion: string;
  /** 导出平台：'darwin' | 'win32' | 'linux' */
  platform: string;

  /** settings.json 全部内容 */
  globalSettings: GlobalSettingsFile;

  agent: {
    config: AgentConfigData;
    /** agentId -> 明文 API Key（由 safeStorage 解密后导出） */
    apiKeys: Record<string, string>;
  };
}

/** preview 返回的元信息（不含敏感字段） */
export interface ConfigBackupPreview {
  filePath: string;
  schemaVersion: string;
  exportedAt: string;
  appVersion: string;
  platform: string;
}

/** import 返回的结果 */
export interface ConfigBackupImportResult {
  appliedFrom: string;
  settingsBackupPath: string;
  agentBackupPath?: string;
}

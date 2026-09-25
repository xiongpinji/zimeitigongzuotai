// electron/config-backup.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import {
  normalizeGlobalSettingsFile,
  type GlobalSettingsFile,
} from '../src/types/global-settings';
import {
  CONFIG_BACKUP_SCHEMA_VERSION,
  type ConfigBackup,
} from '../src/types/config-backup';
import { loadGlobalSettings, saveGlobalSettings } from './global-settings';
import { AgentConfig } from './acp/config';
import type { AgentConfigData } from './acp/types';

const BACKUPS_DIR = 'backups';

/** 以系统时区生成可读时间戳，如 20260417-173015 */
function makeTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function readAgentConfigRaw(agentConfigPath: string): Promise<AgentConfigData> {
  const config = new AgentConfig(agentConfigPath);
  return config.load();
}

async function extractAgentApiKeys(
  agentConfigPath: string,
  data: AgentConfigData,
): Promise<Record<string, string>> {
  const config = new AgentConfig(agentConfigPath);
  const keys: Record<string, string> = {};
  for (const agentId of Object.keys(data.agents)) {
    try {
      const key = await config.getApiKey(agentId);
      if (key) {
        keys[agentId] = key;
      }
    } catch (err) {
      console.warn(`[config-backup] 解密 Agent Key 失败: ${agentId}`, err);
    }
  }
  return keys;
}

export async function collectBackup(
  userDataPath: string,
  agentConfigPath: string,
  appVersion: string,
): Promise<ConfigBackup> {
  const rawSettings = await loadGlobalSettings(userDataPath);
  const globalSettings: GlobalSettingsFile = normalizeGlobalSettingsFile(rawSettings);
  const agentConfig = await readAgentConfigRaw(agentConfigPath);
  const apiKeys = await extractAgentApiKeys(agentConfigPath, agentConfig);

  return {
    schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    platform: process.platform,
    globalSettings,
    agent: {
      config: agentConfig,
      apiKeys,
    },
  };
}

export class ConfigBackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigBackupValidationError';
  }
}

export function validateBackup(raw: unknown): ConfigBackup {
  if (!raw || typeof raw !== 'object') {
    throw new ConfigBackupValidationError('备份文件不是合法的 JSON 对象');
  }
  const obj = raw as Partial<ConfigBackup>;
  if (obj.schemaVersion !== CONFIG_BACKUP_SCHEMA_VERSION) {
    throw new ConfigBackupValidationError(
      `不支持的备份文件版本：${String(obj.schemaVersion)}`,
    );
  }
  if (!obj.globalSettings || typeof obj.globalSettings !== 'object') {
    throw new ConfigBackupValidationError('备份文件缺少 globalSettings 字段');
  }
  if (!obj.agent || typeof obj.agent !== 'object') {
    throw new ConfigBackupValidationError('备份文件缺少 agent 字段');
  }
  const agent = obj.agent as { config?: unknown; apiKeys?: unknown };
  if (!agent.config || typeof agent.config !== 'object') {
    throw new ConfigBackupValidationError('备份文件缺少 agent.config 字段');
  }
  if (!agent.apiKeys || typeof agent.apiKeys !== 'object') {
    throw new ConfigBackupValidationError('备份文件缺少 agent.apiKeys 字段');
  }
  return obj as ConfigBackup;
}

export async function backupCurrent(
  userDataPath: string,
  agentConfigPath: string,
): Promise<{ settingsBackupPath: string; agentBackupPath?: string }> {
  const ts = makeTimestamp();
  const backupsDir = path.join(userDataPath, BACKUPS_DIR);
  await fs.mkdir(backupsDir, { recursive: true });

  const settingsBackupPath = path.join(backupsDir, `settings-${ts}.json`);
  const currentSettings = await loadGlobalSettings(userDataPath);
  await fs.writeFile(
    settingsBackupPath,
    JSON.stringify(currentSettings ?? {}, null, 2),
    'utf-8',
  );

  let agentBackupPath: string | undefined;
  try {
    const raw = await fs.readFile(agentConfigPath, 'utf-8');
    agentBackupPath = path.join(backupsDir, `agent-config-${ts}.json`);
    await fs.writeFile(agentBackupPath, raw, 'utf-8');
  } catch {
    // agent-config.json 不存在（首次使用）：跳过
  }

  return { settingsBackupPath, agentBackupPath };
}

export async function applyBackup(
  backup: ConfigBackup,
  userDataPath: string,
  agentConfigPath: string,
): Promise<void> {
  const normalized = normalizeGlobalSettingsFile(backup.globalSettings);
  await saveGlobalSettings(userDataPath, normalized);

  const agentDir = path.dirname(agentConfigPath);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(
    agentConfigPath,
    JSON.stringify(backup.agent.config, null, 2),
    'utf-8',
  );

  const config = new AgentConfig(agentConfigPath);
  for (const [agentId, key] of Object.entries(backup.agent.apiKeys)) {
    if (!key) continue;
    try {
      await config.setApiKey(agentId, key);
    } catch (err) {
      console.warn(`[config-backup] 写入 Agent Key 失败: ${agentId}`, err);
    }
  }
}

export function defaultExportFileName(d = new Date()): string {
  return `lingji-backup-${makeTimestamp(d)}.lingji-backup.json`;
}

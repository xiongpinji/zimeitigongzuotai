// tests/config-backup.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ConfigBackupValidationError,
  applyBackup,
  backupCurrent,
  collectBackup,
  defaultExportFileName,
  validateBackup,
} from '../electron/config-backup';
import { saveGlobalSettings } from '../electron/global-settings';
import { AgentConfig } from '../electron/acp/config';
import { CONFIG_BACKUP_SCHEMA_VERSION } from '../src/types/config-backup';

let tmpRoot: string;
let userDataPath: string;
let agentConfigPath: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'config-backup-'));
  userDataPath = path.join(tmpRoot, 'userData');
  agentConfigPath = path.join(tmpRoot, 'agent', 'agent-config.json');
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.mkdir(path.dirname(agentConfigPath), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('collectBackup', () => {
  it('空配置（首次使用）也返回合法结构', async () => {
    const backup = await collectBackup(userDataPath, agentConfigPath, '1.0.0');
    expect(backup.schemaVersion).toBe(CONFIG_BACKUP_SCHEMA_VERSION);
    expect(backup.appVersion).toBe('1.0.0');
    expect(backup.platform).toBe(process.platform);
    expect(backup.globalSettings).toBeDefined();
    // 首次使用时 load() 只注入默认的 pi 条目（codex/claude def 已移除）
    expect(backup.agent.config.agents.pi).toBeDefined();
    expect(backup.agent.config.agents.claude).toBeUndefined();
    expect(backup.agent.config.agents.codex).toBeUndefined();
    expect(backup.agent.apiKeys).toEqual({});
  });

  it('包含 globalSettings 与 agent config', async () => {
    await saveGlobalSettings(userDataPath, {
      selectedRole: 'deep-insight-podcast',
    });
    const config = new AgentConfig(agentConfigPath);
    await config.save({
      permissionPolicy: 'tiered',
      agents: {
        claude: {
          enabled: true,
          authMode: 'custom_api',
          apiKey: '',
          apiBaseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-20250514',
          envText: '',
          configJson: '{}',
          version: '0.25.0',
          sortOrder: 0,
        },
      },
    });

    const backup = await collectBackup(userDataPath, agentConfigPath, '1.0.0');
    expect(backup.globalSettings.selectedRole).toBe('deep-insight-podcast');
    expect(backup.agent.config.agents.claude).toBeDefined();
  });
});

describe('validateBackup', () => {
  function validStub() {
    return {
      schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      platform: 'darwin',
      globalSettings: {},
      agent: { config: { agents: {}, permissionPolicy: 'tiered' }, apiKeys: {} },
    };
  }

  it('接受合法结构', () => {
    expect(() => validateBackup(validStub())).not.toThrow();
  });

  it('拒绝非对象', () => {
    expect(() => validateBackup(null)).toThrow(ConfigBackupValidationError);
    expect(() => validateBackup('str')).toThrow(ConfigBackupValidationError);
  });

  it('拒绝未知 schema 版本', () => {
    const bad = { ...validStub(), schemaVersion: '9.9' };
    expect(() => validateBackup(bad)).toThrow(/不支持的备份文件版本/);
  });

  it('拒绝缺字段', () => {
    const bad = validStub() as Record<string, unknown>;
    delete bad.globalSettings;
    expect(() => validateBackup(bad)).toThrow(/globalSettings/);

    const bad2 = validStub() as Record<string, unknown>;
    delete bad2.agent;
    expect(() => validateBackup(bad2)).toThrow(/agent/);
  });
});

describe('backupCurrent', () => {
  it('生成带时间戳的备份文件', async () => {
    await saveGlobalSettings(userDataPath, { selectedRole: 'a' });
    const result = await backupCurrent(userDataPath, agentConfigPath);
    expect(result.settingsBackupPath).toMatch(/settings-\d{8}-\d{6}\.json$/);
    const content = JSON.parse(
      await fs.readFile(result.settingsBackupPath, 'utf-8'),
    );
    expect(content.selectedRole).toBe('a');
    // agent-config.json 不存在 → agentBackupPath 为 undefined
    expect(result.agentBackupPath).toBeUndefined();
  });

  it('若 agent-config.json 存在则一并备份', async () => {
    const config = new AgentConfig(agentConfigPath);
    await config.save({ agents: {}, permissionPolicy: 'tiered' });
    const result = await backupCurrent(userDataPath, agentConfigPath);
    expect(result.agentBackupPath).toBeDefined();
    const content = JSON.parse(
      await fs.readFile(result.agentBackupPath as string, 'utf-8'),
    );
    expect(content.permissionPolicy).toBe('tiered');
  });
});

describe('applyBackup', () => {
  it('完整覆盖 globalSettings 与 agent.config', async () => {
    await saveGlobalSettings(userDataPath, { selectedRole: '旧' });

    await applyBackup(
      {
        schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: '1.0.0',
        platform: 'darwin',
        globalSettings: { selectedRole: '新' },
        agent: {
          config: {
            agents: {
              foo: {
                enabled: true,
                authMode: 'custom_api',
                apiKey: '',
                apiBaseUrl: 'https://x',
                model: 'm',
                envText: '',
                configJson: '{}',
                version: '0.0.1',
                sortOrder: 0,
              },
            },
            permissionPolicy: 'auto_approve',
          },
          apiKeys: {},
        },
      },
      userDataPath,
      agentConfigPath,
    );

    const settings = JSON.parse(
      await fs.readFile(path.join(userDataPath, 'settings.json'), 'utf-8'),
    );
    expect(settings.selectedRole).toBe('新');

    const agent = JSON.parse(await fs.readFile(agentConfigPath, 'utf-8'));
    expect(agent.permissionPolicy).toBe('auto_approve');
    expect(agent.agents.foo).toBeDefined();
  });
});

describe('defaultExportFileName', () => {
  it('格式符合 lingji-backup-<ts>.lingji-backup.json', () => {
    const name = defaultExportFileName(new Date('2026-04-17T10:30:15'));
    expect(name).toMatch(/^lingji-backup-20260417-\d{6}\.lingji-backup\.json$/);
  });
});

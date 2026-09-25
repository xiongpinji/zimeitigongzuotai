import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`enc:${text}`),
    decryptString: (buffer: Buffer) => buffer.toString().replace('enc:', ''),
  },
}));

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('AgentConfig', () => {
  it('returns default config when file does not exist', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    const data = await config.load();
    expect(data.permissionPolicy).toBe('tiered');
    // 缺失文件时只保证默认 pi 条目（codex/claude def 已移除，不再强制创建）
    expect(data.agents.pi).toBeDefined();
    expect(data.agents.claude).toBeUndefined();
    expect(data.agents.codex).toBeUndefined();
  });

  it('saves and loads agent config', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    await config.save({
      permissionPolicy: 'always_ask',
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

    const loaded = await config.load();
    expect(loaded.permissionPolicy).toBe('always_ask');
    expect(loaded.agents.claude.model).toBe('claude-sonnet-4-20250514');
  });

  it('defaults activeAgentId to pi when missing on disk', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    // 缺失文件 → 默认激活 pi
    const fresh = await config.load();
    expect(fresh.activeAgentId).toBe('pi');

    // 旧数据（无 activeAgentId 字段）→ 回退默认，不报错
    const configPath = path.join(tmpDir, 'legacy.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ permissionPolicy: 'tiered', agents: {} }),
      'utf-8',
    );
    const legacy = new AgentConfig(configPath);
    const loaded = await legacy.load();
    expect(loaded.activeAgentId).toBe('pi');
  });

  it('persists and reloads activeAgentId (global single active)', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    await config.save({
      permissionPolicy: 'tiered',
      activeAgentId: 'pi',
      agents: {},
    });
    const loaded = await config.load();
    expect(loaded.activeAgentId).toBe('pi');
  });

  it('normalizes legacy activeAgentId on load (claude-acp → pi)', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const configPath = path.join(tmpDir, 'legacy-active.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ permissionPolicy: 'tiered', agents: {}, activeAgentId: 'claude-acp' }),
      'utf-8',
    );
    const config = new AgentConfig(configPath);
    const loaded = await config.load();
    expect(loaded.activeAgentId).toBe('pi');
  });

  it('encrypts and decrypts API key', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    await config.setApiKey('pi', 'sk-pi-test-key-123');
    const key = await config.getApiKey('pi');
    expect(key).toBe('sk-pi-test-key-123');
  });

  it('getApiKey 接受旧键 pi-acp 并归一化到 pi', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    await config.setApiKey('pi', 'sk-new-key');
    // 用旧键查询，应归一化后读到同一个 key 文件
    const key = await config.getApiKey('pi-acp');
    expect(key).toBe('sk-new-key');
  });
});

describe('normalizeAgentId', () => {
  it('收敛旧 ACP 键与已移除 runtime id 到 pi，未知值透传', async () => {
    const { normalizeAgentId } = await import('../electron/acp/config');
    // 旧 ACP 键 → pi
    expect(normalizeAgentId('claude-acp')).toBe('pi');
    expect(normalizeAgentId('pi-acp')).toBe('pi');
    // 已移除的 runtime id（def 已删）→ pi
    expect(normalizeAgentId('codex')).toBe('pi');
    expect(normalizeAgentId('claude')).toBe('pi');
    // 空值 → 默认 pi
    expect(normalizeAgentId(undefined)).toBe('pi');
    // 未知值原样透传
    expect(normalizeAgentId('unknown-xyz')).toBe('unknown-xyz');
  });
});

describe('ensureDefaultAgents', () => {
  it('只保证 pi 默认条目，不再强制创建 claude/codex', async () => {
    const { ensureDefaultAgents } = await import('../electron/acp/config');
    const result = ensureDefaultAgents({});
    expect(result.pi).toBeDefined();
    expect(result.pi.enabled).toBe(false);
    expect(result.pi.sortOrder).toBe(0);
    // codex/claude def 已移除，不再强制注入默认条目
    expect(result.claude).toBeUndefined();
    expect(result.codex).toBeUndefined();
  });

  it('does not overwrite existing pi user config', async () => {
    const { ensureDefaultAgents } = await import('../electron/acp/config');
    const userPi = {
      enabled: true,
      authMode: 'custom_api' as const,
      apiKey: 'user-key',
      apiBaseUrl: 'https://pi.example.com',
      model: 'pi-model',
      envText: 'FOO=bar',
      configJson: '{"x":1}',
      version: '1.0.0',
      sortOrder: 5,
    };
    const result = ensureDefaultAgents({ pi: userPi });
    // backfill adds skills, so use toMatchObject to check user fields are preserved
    expect(result.pi).toMatchObject(userPi);
  });

  it('does not overwrite existing claude user config', async () => {
    const { ensureDefaultAgents } = await import('../electron/acp/config');
    const userClaude = {
      enabled: true,
      authMode: 'custom_api' as const,
      apiKey: '',
      apiBaseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514',
      envText: '',
      configJson: '{}',
      version: '0.25.0',
      sortOrder: 0,
    };
    const result = ensureDefaultAgents({ claude: userClaude });
    // backfill adds skills, so use toMatchObject to check user fields are preserved
    expect(result.claude).toMatchObject(userClaude);
  });

  it('migrates legacy ACP keys (pi-acp / claude-acp) to pi and drops legacy keys', async () => {
    const { ensureDefaultAgents } = await import('../electron/acp/config');
    // 单个旧 ACP 键各自迁移到 pi
    const legacyPi = {
      enabled: true,
      authMode: 'subscription' as const,
      apiKey: '',
      apiBaseUrl: '',
      model: 'pi-legacy',
      envText: '',
      configJson: '',
      version: '',
      sortOrder: 7,
    };
    const fromPiAcp = ensureDefaultAgents({ 'pi-acp': legacyPi });
    expect(fromPiAcp.pi).toMatchObject(legacyPi);
    expect(fromPiAcp['pi-acp']).toBeUndefined();

    const legacyClaude = {
      enabled: true,
      authMode: 'custom_api' as const,
      apiKey: 'legacy-claude-key',
      apiBaseUrl: 'https://legacy.anthropic.com',
      model: 'claude-legacy',
      envText: 'X=1',
      configJson: '',
      version: '0.20.0',
      sortOrder: 9,
    };
    const fromClaudeAcp = ensureDefaultAgents({ 'claude-acp': legacyClaude });
    // claude-acp（claude def 已移除）的 ACP 配置同样收敛到 pi
    expect(fromClaudeAcp.pi).toMatchObject(legacyClaude);
    expect(fromClaudeAcp['claude-acp']).toBeUndefined();
    // 不再强制创建 codex 条目
    expect(fromClaudeAcp.codex).toBeUndefined();
  });

  it('does not overwrite pi when both legacy ACP key and pi exist', async () => {
    const { ensureDefaultAgents } = await import('../electron/acp/config');
    const legacyPi = { ...EMPTY_ENTRY, model: 'from-legacy', sortOrder: 0 };
    const newPi = { ...EMPTY_ENTRY, model: 'from-new', sortOrder: 0 };
    const result = ensureDefaultAgents({
      'pi-acp': legacyPi,
      pi: newPi,
    });
    expect(result.pi.model).toBe('from-new');
    expect(result['pi-acp']).toBeUndefined();
  });

  it('preserves user claude/codex entries without forcing them as defaults', async () => {
    const { ensureDefaultAgents } = await import('../electron/acp/config');
    // 用户旧持久化的 claude/codex 条目不在 LEGACY_ID_MAP 中，原样保留、不被删除
    const userClaude = { ...EMPTY_ENTRY, model: 'kept-claude', sortOrder: 3 };
    const userCodex = { ...EMPTY_ENTRY, model: 'kept-codex', sortOrder: 4 };
    const result = ensureDefaultAgents({ claude: userClaude, codex: userCodex });
    expect(result.claude).toMatchObject(userClaude);
    expect(result.codex).toMatchObject(userCodex);
    // pi 默认仍补入
    expect(result.pi).toBeDefined();
  });

  it('load() returns pi with enabled=false and sortOrder=0 for new config', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    const data = await config.load();
    expect(data.agents.pi.enabled).toBe(false);
    expect(data.agents.pi.sortOrder).toBe(0);
  });

  it('load() preserves user-modified claude after save/load roundtrip', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    const customClaude = {
      enabled: true,
      authMode: 'custom_api' as const,
      apiKey: '',
      apiBaseUrl: 'https://custom.anthropic.com',
      model: 'claude-opus-4',
      envText: '',
      configJson: '',
      version: '0.26.0',
      sortOrder: 0,
    };
    await config.save({
      permissionPolicy: 'tiered',
      agents: { claude: customClaude },
    });
    const loaded = await config.load();
    // 用户修改的 claude 必须完整保留，不被默认值覆盖（backfill 会补 skills，用 toMatchObject 验证核心字段）
    expect(loaded.agents.claude).toMatchObject(customClaude);
  });

  it('load() migrates legacy on-disk ACP config to pi', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const configPath = path.join(tmpDir, 'agent-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        permissionPolicy: 'tiered',
        agents: { 'claude-acp': { ...EMPTY_ENTRY, model: 'legacy-on-disk' } },
      }),
      'utf-8',
    );
    const config = new AgentConfig(configPath);
    const loaded = await config.load();
    expect(loaded.agents.pi.model).toBe('legacy-on-disk');
    expect(loaded.agents['claude-acp']).toBeUndefined();
  });
});

const EMPTY_ENTRY = {
  enabled: false,
  authMode: 'subscription' as const,
  apiKey: '',
  apiBaseUrl: '',
  model: '',
  envText: '',
  configJson: '',
  version: '',
  sortOrder: 0,
};

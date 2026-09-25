import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentConfigData, AgentEntry } from './types';
import { BUILTIN_SKILL_ID } from '../agent-skills/constants';

/** 全局默认 agent id；无 activeAgentId 时回退到此。 */
export const DEFAULT_AGENT_ID = 'pi';

const DEFAULT_CONFIG: AgentConfigData = {
  agents: {},
  permissionPolicy: 'tiered',
  activeAgentId: DEFAULT_AGENT_ID,
};

/**
 * 旧 ACP 键 → 现 runtime id 的迁移映射。
 * 当前 runtime 仅保留 pi（codex/claude 的 def 已删），旧 ACP 键统一收敛到 pi。
 * - 'pi-acp'     → 'pi'
 * - 'claude-acp' → 'pi'
 *
 * 注意：这里只放「需要在 ensureDefaultAgents 中真正搬迁条目」的旧键。
 * 已移除的 runtime id（codex/claude）不放进来，避免迁移循环删除用户已持久化的
 * claude/codex 条目；它们仅在 normalizeAgentId 里被归一化到 pi（见 REMOVED_AGENT_IDS）。
 */
const LEGACY_ID_MAP: Record<string, string> = {
  'pi-acp': 'pi',
  'claude-acp': 'pi',
};

/**
 * 已从 runtime 移除的 agent id（def 不再存在）。归一化时收敛到 pi，
 * 但不参与 ensureDefaultAgents 的条目搬迁，故不会删除用户旧条目。
 */
const REMOVED_AGENT_IDS = new Set(['codex', 'claude']);

/**
 * 归一化 agent id：旧 ACP 键 / 已移除 id 统一收敛到现存 runtime id（pi）。
 * 未知值原样透传；空值回退默认（pi）。
 */
export function normalizeAgentId(id: string | undefined | null): string {
  if (!id) return DEFAULT_AGENT_ID;
  const mapped = LEGACY_ID_MAP[id];
  if (mapped) return mapped;
  if (REMOVED_AGENT_IDS.has(id)) return DEFAULT_AGENT_ID;
  return id;
}

/** 反查：给定新 id，返回对应的旧 ACP id（无则 null）。用于迁移期读旧凭证文件。 */
function legacyIdFor(newId: string): string | null {
  for (const [legacyId, mapped] of Object.entries(LEGACY_ID_MAP)) {
    if (mapped === newId) return legacyId;
  }
  return null;
}

function makeDefaultEntry(sortOrder: number): AgentEntry {
  // pi SDK 化后只保留运行期真正需要的字段（启用态、版本、排序、skill 开关）；
  // 凭证 / 模型不再逐 agent 配置（走 AISettings.llmProviders 投影）。
  return {
    enabled: false,
    version: '',
    sortOrder,
    skills: [{ id: BUILTIN_SKILL_ID, enabled: true }],
  };
}

const PI_DEFAULT_ENTRY: AgentEntry = makeDefaultEntry(0);

/**
 * 确保 agents 记录中包含必需的默认条目（仅 pi）。
 *
 * 兼容旧数据：若存在旧 ACP 键 'pi-acp' / 'claude-acp'，迁移其用户配置到 'pi'，
 * 避免丢失用户已填的 apiKey/envText/model 等；'pi' 已存在则不覆盖。迁移后移除旧键。
 *
 * 用户旧的 claude/codex 条目（runtime def 已删）原样保留在结果中，不强制创建、
 * 也不删除——它们只是不再被使用。
 *
 * 只在 pi 缺失时补入默认条目，不覆盖用户已有配置。
 */
export function ensureDefaultAgents(agents: Record<string, AgentEntry>): Record<string, AgentEntry> {
  const next: Record<string, AgentEntry> = { ...agents };

  // 旧键迁移：把旧条目搬到新键（仅当新键尚不存在，避免覆盖用户已迁移的新配置）
  for (const [legacyId, newId] of Object.entries(LEGACY_ID_MAP)) {
    if (next[legacyId]) {
      if (!next[newId]) {
        next[newId] = next[legacyId];
      }
      delete next[legacyId];
    }
  }

  // 为已存在但缺 skills 字段的条目补默认（旧数据迁移；不覆盖已配置）
  for (const id of Object.keys(next)) {
    const entry = next[id];
    if (entry && entry.skills === undefined) {
      next[id] = { ...entry, skills: [{ id: BUILTIN_SKILL_ID, enabled: true }] };
    }
  }

  return {
    pi: PI_DEFAULT_ENTRY,
    ...next,
  };
}

export class AgentConfig {
  constructor(private configPath: string) {}

  async load(): Promise<AgentConfigData> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AgentConfigData>;
      return {
        permissionPolicy: parsed.permissionPolicy ?? DEFAULT_CONFIG.permissionPolicy,
        agents: ensureDefaultAgents(parsed.agents ?? {}),
        // 旧数据无 activeAgentId → 归一化后回退默认（不报错）
        activeAgentId: normalizeAgentId(parsed.activeAgentId ?? DEFAULT_AGENT_ID),
      };
    } catch {
      return {
        ...DEFAULT_CONFIG,
        agents: ensureDefaultAgents({}),
      };
    }
  }

  async save(data: AgentConfigData): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getApiKey(agentId: string): Promise<string> {
    const id = normalizeAgentId(agentId);
    // 先尝试新 id 的 key 文件；缺失时回退到旧 id（迁移期兼容）
    const direct = await this.readApiKeyFile(this.encryptedKeyPath(id));
    if (direct) return direct;
    const legacyId = legacyIdFor(id);
    if (legacyId) {
      const legacy = await this.readApiKeyFile(this.encryptedKeyPath(legacyId));
      if (legacy) return legacy;
    }
    return '';
  }

  private async readApiKeyFile(keyPath: string): Promise<string> {
    try {
      const buffer = await fs.readFile(keyPath);
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(buffer);
      }
      return buffer.toString('utf-8');
    } catch {
      return '';
    }
  }

  async setApiKey(agentId: string, key: string): Promise<void> {
    const keyPath = this.encryptedKeyPath(normalizeAgentId(agentId));
    await fs.mkdir(path.dirname(keyPath), { recursive: true });
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key);
      await fs.writeFile(keyPath, encrypted);
    } else {
      await fs.writeFile(keyPath, key, 'utf-8');
    }
  }

  private encryptedKeyPath(agentId: string): string {
    return path.join(path.dirname(this.configPath), `${agentId}.key`);
  }
}

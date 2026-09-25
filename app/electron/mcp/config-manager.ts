import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义 ───────────────────────────────────────────

export type McpAppType = 'claude_code' | 'codex' | 'gemini';

export interface LocalMcpServer {
  id: string;
  spec: Record<string, unknown>;
  apps: McpAppType[];
}

/** 常量：本应用注册时使用的 MCP 服务器 ID */
const MCP_SERVER_ID = 'lingji-editor';

// ─── 各 AI 工具的配置描述 ─────────────────────────────────

interface AppDescriptor {
  /** 配置文件绝对路径 */
  configPath: () => string;
  /** 文件格式 */
  format: 'json' | 'toml';
  /** MCP 配置在文件中的顶层键名 */
  mcpKey: string;
}

const APP_DESCRIPTORS: Record<McpAppType, AppDescriptor> = {
  claude_code: {
    configPath: () => path.join(os.homedir(), '.claude.json'),
    format: 'json',
    mcpKey: 'mcpServers',
  },
  codex: {
    configPath: () => {
      const codexHome = process.env.CODEX_HOME
        ? expandTilde(process.env.CODEX_HOME)
        : path.join(os.homedir(), '.codex');
      return path.join(codexHome, 'config.toml');
    },
    format: 'toml',
    mcpKey: 'mcp_servers',
  },
  gemini: {
    configPath: () => path.join(os.homedir(), '.gemini', 'settings.json'),
    format: 'json',
    mcpKey: 'mcpServers',
  },
};

// ─── 工具函数 ───────────────────────────────────────────

/** 将路径中的 ~ 展开为用户主目录 */
function expandTilde(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** 安全读取文件，不存在或出错时返回 null */
async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** 确保父目录存在后写入文件 */
async function safeWriteFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

// ─── JSON 格式读写 ──────────────────────────────────────

/** 安全解析 JSON 配置，失败返回空对象 */
function parseJsonConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 从 JSON 配置中提取 mcpServers 部分 */
function extractJsonServers(
  config: Record<string, unknown>,
  mcpKey: string,
): Record<string, Record<string, unknown>> {
  const section = config[mcpKey];
  if (section && typeof section === 'object' && !Array.isArray(section)) {
    return section as Record<string, Record<string, unknown>>;
  }
  return {};
}

// ─── TOML 简易读写（仅处理 mcp_servers 部分） ──────────────

/**
 * 从 TOML 文本中解析 MCP 服务器配置。
 * 支持 [mcp_servers] 段和旧版 [mcp.servers] 段。
 *
 * 期望的格式：
 * ```toml
 * [mcp_servers]
 * server-id = { type = "http", url = "http://..." }
 * ```
 */
function parseTomlMcpServers(
  raw: string,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  // 匹配 [mcp_servers] 或旧版 [mcp.servers]
  const sectionRegex = /^\[(mcp_servers|mcp\.servers)\]\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(raw)) !== null) {
    const sectionStart = match.index + match[0].length;
    // 找到下一个 section 起始或文件末尾
    const nextSectionMatch = /^\[(?!\[)/m.exec(raw.slice(sectionStart));
    const sectionEnd = nextSectionMatch
      ? sectionStart + nextSectionMatch.index
      : raw.length;
    const sectionBody = raw.slice(sectionStart, sectionEnd);

    // 逐行解析 key = { ... } 形式的条目
    const entryRegex = /^([\w-]+)\s*=\s*\{([^}]*)\}\s*$/gm;
    let entryMatch: RegExpExecArray | null;
    while ((entryMatch = entryRegex.exec(sectionBody)) !== null) {
      const id = entryMatch[1];
      const innerStr = entryMatch[2];
      result[id] = parseTomlInlineTable(innerStr);
    }
  }

  return result;
}

/**
 * 解析 TOML 内联表（简化版）。
 * 支持字符串值和简单嵌套内联表。
 */
function parseTomlInlineTable(inner: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  // 按逗号分隔，但要跳过嵌套 {} 内的逗号
  const pairs = splitTomlPairs(inner);
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    const val = pair.slice(eqIndex + 1).trim();
    obj[key] = parseTomlValue(val);
  }
  return obj;
}

/** 按顶层逗号分隔 TOML 内联表的键值对 */
function splitTomlPairs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** 解析单个 TOML 值（字符串 / 内联表 / 原始字面量） */
function parseTomlValue(val: string): unknown {
  const trimmed = val.trim();
  // 字符串
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  // 内联表
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return parseTomlInlineTable(trimmed.slice(1, -1));
  }
  // 布尔
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  // 数字
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') return num;
  // 其他当作字符串
  return trimmed;
}

/**
 * 将单个 MCP 服务器条目序列化为 TOML 内联表格式。
 * 例如：`lingji-editor = { type = "http", url = "http://localhost:3000/mcp" }`
 */
function toTomlInlineEntry(
  id: string,
  spec: Record<string, unknown>,
): string {
  const parts = Object.entries(spec).map(
    ([k, v]) => `${k} = ${toTomlValue(v)}`,
  );
  return `${id} = { ${parts.join(', ')} }`;
}

/** 将 JS 值序列化为 TOML 值字面量 */
function toTomlValue(val: unknown): string {
  if (typeof val === 'string') return `"${val}"`;
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const inner = Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k} = ${toTomlValue(v)}`)
      .join(', ');
    return `{ ${inner} }`;
  }
  return `"${String(val)}"`;
}

/**
 * 在 TOML 文本中插入或替换 [mcp_servers] 段中的条目。
 * - 若段存在且条目存在，替换该行
 * - 若段存在但条目不存在，追加到段末
 * - 若段不存在，追加新段
 */
function upsertTomlMcpEntry(
  raw: string,
  id: string,
  spec: Record<string, unknown>,
): string {
  const entryLine = toTomlInlineEntry(id, spec);
  const sectionHeader = '[mcp_servers]';

  // 查找 [mcp_servers] 段
  const sectionIndex = raw.indexOf(sectionHeader);
  if (sectionIndex === -1) {
    // 段不存在，追加
    const separator = raw.length > 0 && !raw.endsWith('\n') ? '\n\n' : '\n';
    return raw + separator + sectionHeader + '\n' + entryLine + '\n';
  }

  // 段存在，查找段体范围
  const bodyStart = sectionIndex + sectionHeader.length;
  const nextSectionMatch = /^\[(?!\[)/m.exec(raw.slice(bodyStart + 1));
  const bodyEnd = nextSectionMatch
    ? bodyStart + 1 + nextSectionMatch.index
    : raw.length;
  const body = raw.slice(bodyStart, bodyEnd);

  // 查找已有条目行
  const entryRegex = new RegExp(`^${escapeRegExp(id)}\\s*=\\s*\\{[^}]*\\}\\s*$`, 'm');
  const existingMatch = entryRegex.exec(body);

  if (existingMatch) {
    // 替换已有行
    const absStart = bodyStart + existingMatch.index;
    const absEnd = absStart + existingMatch[0].length;
    return raw.slice(0, absStart) + entryLine + raw.slice(absEnd);
  }

  // 追加到段末（在下一段之前）
  const insertPos = bodyEnd;
  const needsNewline = !raw.slice(bodyStart, insertPos).endsWith('\n');
  const insertion = (needsNewline ? '\n' : '') + entryLine + '\n';
  return raw.slice(0, insertPos) + insertion + raw.slice(insertPos);
}

/**
 * 从 TOML 文本的 [mcp_servers] 段（或旧版 [mcp.servers]）中删除指定条目。
 * 返回 [修改后文本, 是否找到并删除]。
 */
function removeTomlMcpEntry(raw: string, id: string): [string, boolean] {
  const entryRegex = new RegExp(
    `^${escapeRegExp(id)}\\s*=\\s*\\{[^}]*\\}\\s*\\n?`,
    'gm',
  );
  let found = false;
  const result = raw.replace(entryRegex, () => {
    found = true;
    return '';
  });
  return [result, found];
}

/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── 主类 ────────────────────────────────────────────────

export class McpConfigManager {
  /**
   * 扫描所有支持的 AI 工具配置文件，合并返回统一的 MCP 服务器列表。
   * 同一个 server ID 在多个工具中注册时，会合并到同一个 LocalMcpServer。
   */
  async scanLocal(): Promise<LocalMcpServer[]> {
    const serverMap = new Map<string, LocalMcpServer>();

    const apps = Object.keys(APP_DESCRIPTORS) as McpAppType[];
    const results = await Promise.allSettled(
      apps.map((app) => this.readAppServers(app)),
    );

    for (let i = 0; i < apps.length; i++) {
      const result = results[i];
      if (result.status !== 'fulfilled') continue;

      const app = apps[i];
      const servers = result.value;

      for (const [id, spec] of Object.entries(servers)) {
        const existing = serverMap.get(id);
        if (existing) {
          existing.apps.push(app);
          // 使用第一个发现的 spec，后续不覆盖
        } else {
          serverMap.set(id, { id, spec, apps: [app] });
        }
      }
    }

    return Array.from(serverMap.values());
  }

  /**
   * 将 lingji-editor MCP 服务器注册到指定 AI 工具的配置文件。
   * 幂等：重复调用会覆盖已有配置。
   */
  async registerToApp(app: McpAppType, port: number): Promise<void> {
    const spec: Record<string, unknown> = {
      type: 'http',
      url: `http://localhost:${port}/mcp`,
    };

    const descriptor = APP_DESCRIPTORS[app];
    const configPath = descriptor.configPath();

    if (descriptor.format === 'json') {
      await this.writeJsonEntry(configPath, descriptor.mcpKey, MCP_SERVER_ID, spec);
    } else {
      await this.writeTomlEntry(configPath, MCP_SERVER_ID, spec);
    }
  }

  /**
   * 从指定 AI 工具的配置文件中移除 lingji-editor。
   * 返回 true 表示找到并移除，false 表示未找到。
   */
  async removeFromApp(app: McpAppType): Promise<boolean> {
    const descriptor = APP_DESCRIPTORS[app];
    const configPath = descriptor.configPath();

    if (descriptor.format === 'json') {
      return this.removeJsonEntry(configPath, descriptor.mcpKey, MCP_SERVER_ID);
    }
    return this.removeTomlEntry(configPath, MCP_SERVER_ID);
  }

  /**
   * 检查 lingji-editor 是否已注册到指定 AI 工具。
   */
  async isRegistered(app: McpAppType): Promise<boolean> {
    try {
      const servers = await this.readAppServers(app);
      return MCP_SERVER_ID in servers;
    } catch {
      return false;
    }
  }

  // ─── 内部方法 ──────────────────────────────────────────

  /**
   * 读取指定 AI 工具配置文件中的所有 MCP 服务器。
   * 容错：文件不存在或解析出错均返回空对象。
   */
  private async readAppServers(
    app: McpAppType,
  ): Promise<Record<string, Record<string, unknown>>> {
    const descriptor = APP_DESCRIPTORS[app];
    const configPath = descriptor.configPath();
    const raw = await safeReadFile(configPath);

    if (descriptor.format === 'json') {
      const config = parseJsonConfig(raw);
      return extractJsonServers(config, descriptor.mcpKey);
    }

    // TOML 格式（Codex）
    if (!raw) return {};
    try {
      return parseTomlMcpServers(raw);
    } catch {
      return {};
    }
  }

  /**
   * 向 JSON 配置文件的 mcpServers 段写入一个条目。
   * 保留文件中的所有其他字段。
   */
  private async writeJsonEntry(
    configPath: string,
    mcpKey: string,
    id: string,
    spec: Record<string, unknown>,
  ): Promise<void> {
    const raw = await safeReadFile(configPath);
    const config = parseJsonConfig(raw);

    // 确保 mcpServers 段存在
    if (!config[mcpKey] || typeof config[mcpKey] !== 'object') {
      config[mcpKey] = {};
    }
    (config[mcpKey] as Record<string, unknown>)[id] = spec;

    await safeWriteFile(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  /**
   * 从 JSON 配置文件的 mcpServers 段删除一个条目。
   */
  private async removeJsonEntry(
    configPath: string,
    mcpKey: string,
    id: string,
  ): Promise<boolean> {
    const raw = await safeReadFile(configPath);
    if (!raw) return false;

    const config = parseJsonConfig(raw);
    const servers = config[mcpKey];
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      return false;
    }

    const serversObj = servers as Record<string, unknown>;
    if (!(id in serversObj)) return false;

    delete serversObj[id];
    await safeWriteFile(configPath, JSON.stringify(config, null, 2) + '\n');
    return true;
  }

  /**
   * 向 TOML 配置文件的 [mcp_servers] 段写入一个条目。
   */
  private async writeTomlEntry(
    configPath: string,
    id: string,
    spec: Record<string, unknown>,
  ): Promise<void> {
    const raw = (await safeReadFile(configPath)) ?? '';
    const updated = upsertTomlMcpEntry(raw, id, spec);
    await safeWriteFile(configPath, updated);
  }

  /**
   * 从 TOML 配置文件中删除指定 MCP 条目。
   */
  private async removeTomlEntry(
    configPath: string,
    id: string,
  ): Promise<boolean> {
    const raw = await safeReadFile(configPath);
    if (!raw) return false;

    const [updated, found] = removeTomlMcpEntry(raw, id);
    if (found) {
      await safeWriteFile(configPath, updated);
    }
    return found;
  }
}

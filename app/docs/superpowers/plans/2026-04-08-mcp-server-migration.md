# MCP Server 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 助手与编辑器的交互从 ACP runtime handler 迁移到标准 MCP Server，内置对话和外部 AI 工具共用统一的编辑器工具接口。

**Architecture:** Electron Main Process 启动 MCP HTTP Server（localhost:19820），暴露 lingji_* 工具集。ACP spawn Claude Code 时自动注入 MCP 配置，使内置 Agent 也通过 MCP 工具操作编辑器。MCP Config Manager 负责将服务注册到各 AI 工具的配置文件。

**Tech Stack:** `@modelcontextprotocol/sdk`（MCP SDK）、Electron IPC、Zustand、CodeMirror 6

**Spec:** `docs/superpowers/specs/2026-04-08-mcp-server-migration-design.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `electron/mcp/server.ts` | MCP HTTP Server 启停管理 |
| `electron/mcp/tools.ts` | MCP 工具定义 + handler 实现 |
| `electron/mcp/config-manager.ts` | 读写各 AI 工具 MCP 配置文件 |
| `electron/mcp/ipc.ts` | MCP 相关 Electron IPC handlers |
| `src/components/settings/McpSettingsTab.tsx` | MCP 服务设置面板 |
| `src/components/settings/McpSettingsTab.module.css` | 设置面板样式 |
| `src/lib/mcp-api.ts` | Renderer 侧 MCP API 接口定义 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | 添加 `@modelcontextprotocol/sdk` 依赖 |
| `electron/main.ts` | 启动 MCP Server、注册 MCP IPC |
| `electron/preload.ts` | 添加 `window.mcpAPI` 桥接 |
| `electron/acp/ipc.ts` | spawn 前注入 MCP 配置、移除 fs/terminal/permission handler |
| `electron/acp/session.ts` | 移除 fs-runtime/terminal-runtime/permission 注册 |
| `src/store/script.ts` | 添加 MCP 事件处理 actions |
| `src/ui/components/script-editor.tsx` | 添加变更行高亮 |
| `src/pages/ScriptWorkbench.tsx` | 注册 MCP 事件监听 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `electron/acp/fs-runtime.ts` | 文件操作改走 MCP |
| `electron/acp/operation-interceptor.ts` | 写入改为即时模式 |
| `electron/acp/terminal-runtime.ts` | Claude Code 自带终端 |
| `electron/acp/permission.ts` | Claude Code 自带权限 |

---

## 并行分组

```
Group A (独立):  Task 1 (MCP Server) ─────────────┐
Group B (独立):  Task 2 (Config Manager) ──────────┤
                                                    ├─→ Task 5 (ACP 集成+清理) ─→ Task 7 (集成测试)
Group C (独立):  Task 3 (Preload + IPC 桥接) ──────┤
Group D (依赖C): Task 4 (前端 MCP handlers) ───────┤
                 Task 6 (MCP 设置面板) ────────────┘
```

可并行: Task 1, 2, 3 完全独立。Task 4 和 6 依赖 Task 3 的接口定义但可以先开始。Task 5 依赖 Task 1 和 2。Task 7 依赖全部。

---

## Task 1: MCP Server 核心 + 工具实现

**Files:**
- Create: `electron/mcp/server.ts`
- Create: `electron/mcp/tools.ts`
- Modify: `package.json`
- Modify: `electron/main.ts`

- [ ] **Step 1: 安装 MCP SDK 依赖**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: 创建 MCP Server 管理模块**

创建 `electron/mcp/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http from 'node:http';
import type { BrowserWindow } from 'electron';
import { registerTools } from './tools';

let mcpServer: McpServer | null = null;
let httpServer: http.Server | null = null;
let currentPort = 19820;

export function getMcpServerStatus(): { running: boolean; port: number; url: string } {
  const running = httpServer !== null && httpServer.listening;
  return { running, port: currentPort, url: `http://localhost:${currentPort}/mcp` };
}

export async function startMcpServer(
  port: number,
  getMainWindow: () => BrowserWindow | null,
): Promise<{ port: number; url: string }> {
  if (httpServer?.listening) {
    return { port: currentPort, url: `http://localhost:${currentPort}/mcp` };
  }

  currentPort = port;
  mcpServer = new McpServer({
    name: 'lingji-editor',
    version: '1.0.0',
  });

  registerTools(mcpServer, getMainWindow);

  httpServer = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // MCP endpoint
    const url = new URL(req.url ?? '/', `http://localhost:${currentPort}`);
    if (url.pathname === '/mcp') {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcpServer!.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    // 健康检查
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', name: 'lingji-editor' }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  return new Promise((resolve, reject) => {
    httpServer!.listen(currentPort, '127.0.0.1', () => {
      console.log(`[MCP] lingji-editor MCP server listening on http://127.0.0.1:${currentPort}/mcp`);
      resolve({ port: currentPort, url: `http://localhost:${currentPort}/mcp` });
    });
    httpServer!.on('error', reject);
  });
}

export async function stopMcpServer(): Promise<void> {
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = null;
  }
  if (mcpServer) {
    await mcpServer.close();
    mcpServer = null;
  }
  console.log('[MCP] Server stopped');
}
```

- [ ] **Step 3: 创建 MCP 工具定义模块**

创建 `electron/mcp/tools.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';

// IPC 请求-响应辅助：向 Renderer 发请求并等待结果
function ipcRequest<T>(
  win: BrowserWindow,
  channel: string,
  payload: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const replyChannel = `${channel}:reply:${Date.now()}`;
    const timer = setTimeout(() => {
      ipcMain.removeHandler(replyChannel);
      reject(new Error(`IPC request timeout: ${channel}`));
    }, timeoutMs);

    ipcMain.handleOnce(replyChannel, (_event, result: T) => {
      clearTimeout(timer);
      return result;
    });

    win.webContents.send(channel, { ...((payload as object) ?? {}), _replyChannel: replyChannel });
  });
}

export function registerTools(
  server: McpServer,
  getMainWindow: () => BrowserWindow | null,
): void {
  // ─── lingji_get_editor_state ────────────────────────────
  server.tool(
    'lingji_get_editor_state',
    '获取灵几编辑器当前状态：项目目录、打开的文件、当前活动文件、光标位置',
    {},
    async () => {
      const win = getMainWindow();
      if (!win) return { content: [{ type: 'text', text: JSON.stringify({ error: '编辑器窗口未打开' }) }] };

      const state = await ipcRequest<Record<string, unknown>>(win, 'mcp:get-editor-state', {});
      return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
    },
  );

  // ─── lingji_read_script ─────────────────────────────────
  server.tool(
    'lingji_read_script',
    '读取指定脚本文件的内容。不传 filePath 时读取当前编辑器中打开的文件。',
    { filePath: z.string().optional().describe('文件路径，缺省为当前打开的文件') },
    async ({ filePath }) => {
      const win = getMainWindow();
      if (!win) return { content: [{ type: 'text', text: JSON.stringify({ error: '编辑器窗口未打开' }) }] };

      const result = await ipcRequest<{ filePath: string; content: string; lineCount: number }>(
        win,
        'mcp:read-script',
        { filePath },
      );
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── lingji_write_script ────────────────────────────────
  server.tool(
    'lingji_write_script',
    '根据原始文本素材和口播模板风格，生成口播稿脚本文件。MCP Server 内部调用内置 AI 完成生成。',
    {
      templateCode: z.string().describe('口播模板风格 code，如 news-broadcast、tech-review、knowledge-popular、deep-insight-podcast'),
      rawText: z.string().describe('需要转换为口播稿的原始文本素材'),
    },
    async ({ templateCode, rawText }) => {
      const win = getMainWindow();
      if (!win) return { content: [{ type: 'text', text: JSON.stringify({ error: '编辑器窗口未打开' }) }] };

      // 发送生成请求到 Renderer，由 Renderer 调用已有的生成逻辑
      const result = await ipcRequest<{
        success: boolean;
        filePath: string;
        summary: string;
        linesGenerated: number;
        error?: string;
      }>(win, 'mcp:generate-script', { templateCode, rawText }, 300_000); // 5 分钟超时

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── lingji_update_script ───────────────────────────────
  server.tool(
    'lingji_update_script',
    '直接写入或更新脚本文件内容。编辑器会即时显示更新内容并高亮变更行。',
    {
      filePath: z.string().optional().describe('文件路径，缺省为当前打开的文件'),
      content: z.string().describe('完整的脚本内容'),
      description: z.string().optional().describe('本次修改的简要说明'),
    },
    async ({ filePath, content, description }) => {
      const win = getMainWindow();
      if (!win) return { content: [{ type: 'text', text: JSON.stringify({ error: '编辑器窗口未打开' }) }] };

      const result = await ipcRequest<{
        success: boolean;
        filePath: string;
        linesChanged: number;
      }>(win, 'mcp:update-script', { filePath, content, description });

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── lingji_review_script ──────────────────────────────
  server.tool(
    'lingji_review_script',
    '对脚本进行审阅，提交逐行批注。编辑器会在对应行旁显示批注卡片。',
    {
      filePath: z.string().optional().describe('审阅的文件路径，缺省为当前打开的文件'),
      summary: z.string().optional().describe('审阅总结评价'),
      score: z.number().optional().describe('评分（0-100）'),
      annotations: z.array(z.object({
        line: z.number().describe('行号（从 1 开始）'),
        endLine: z.number().optional().describe('结束行号'),
        text: z.string().describe('批注内容'),
        severity: z.enum(['info', 'suggestion', 'warning', 'error']).optional().describe('严重程度，默认 info'),
      })).describe('逐行批注列表'),
    },
    async ({ filePath, summary, score, annotations }) => {
      const win = getMainWindow();
      if (!win) return { content: [{ type: 'text', text: JSON.stringify({ error: '编辑器窗口未打开' }) }] };

      const result = await ipcRequest<{
        success: boolean;
        filePath: string;
        annotationCount: number;
      }>(win, 'mcp:submit-review', { filePath, summary, score, annotations });

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── lingji_list_project_files ─────────────────────────
  server.tool(
    'lingji_list_project_files',
    '列出当前项目的文件列表',
    { directory: z.string().optional().describe('子目录路径，缺省为项目根目录') },
    async ({ directory }) => {
      const win = getMainWindow();
      if (!win) return { content: [{ type: 'text', text: JSON.stringify({ error: '编辑器窗口未打开' }) }] };

      const result = await ipcRequest<{
        projectDir: string;
        files: Array<{ path: string; name: string; isDirectory: boolean }>;
      }>(win, 'mcp:list-project-files', { directory });

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── lingji_get_project_context ────────────────────────
  server.tool(
    'lingji_get_project_context',
    '获取当前项目的上下文信息：项目名称、可用模板列表、项目配置',
    {},
    async () => {
      const win = getMainWindow();
      if (!win) return { content: [{ type: 'text', text: JSON.stringify({ error: '编辑器窗口未打开' }) }] };

      const result = await ipcRequest<Record<string, unknown>>(win, 'mcp:get-project-context', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
```

- [ ] **Step 4: 在 main.ts 中启动 MCP Server**

在 `electron/main.ts` 的 `app.whenReady()` 回调中，在窗口创建后启动 MCP Server：

```typescript
// 在 import 区域添加
import { startMcpServer, stopMcpServer } from './mcp/server';
import { registerMcpIpc } from './mcp/ipc';

// 在 createWindow() 后添加
registerMcpIpc(() => mainWindow);
startMcpServer(19820, () => mainWindow).catch((err) => {
  console.error('[MCP] Failed to start server:', err);
});

// 在 app quit 处添加
app.on('before-quit', async () => {
  await stopMcpServer();
});
```

- [ ] **Step 5: 验证 MCP Server 启动**

```bash
npm run build:electron
# 启动应用后，在另一个终端验证
curl http://localhost:19820/health
# 期望: {"status":"ok","name":"lingji-editor"}
```

- [ ] **Step 6: 提交**

```bash
git add electron/mcp/server.ts electron/mcp/tools.ts package.json package-lock.json electron/main.ts
git commit -m "feat(mcp): 实现 MCP HTTP Server 核心 + 工具定义"
```

---

## Task 2: MCP Config Manager

**Files:**
- Create: `electron/mcp/config-manager.ts`

- [ ] **Step 1: 创建 Config Manager 模块**

创建 `electron/mcp/config-manager.ts`：

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export type McpAppType = 'claude_code' | 'codex' | 'gemini';

export interface LocalMcpServer {
  id: string;
  spec: Record<string, unknown>;
  apps: McpAppType[];
}

const MCP_SERVER_ID = 'lingji-editor';

// ─── 路径解析 ──────────────────────────────────────────────

function homedir(): string {
  return os.homedir();
}

function claudeConfigPath(): string {
  return path.join(homedir(), '.claude.json');
}

function codexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  if (codexHome) {
    const resolved = codexHome === '~'
      ? homedir()
      : codexHome.startsWith('~/')
        ? path.join(homedir(), codexHome.slice(2))
        : codexHome;
    return path.join(resolved, 'config.toml');
  }
  return path.join(homedir(), '.codex', 'config.toml');
}

function geminiConfigPath(): string {
  return path.join(homedir(), '.gemini', 'settings.json');
}

// ─── JSON 读写 ─────────────────────────────────────────────

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeJsonFile(filePath: string, data: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ─── TOML 简易读写（仅处理 mcp_servers 段）──────────────────

async function readTomlFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function parseTomlMcpServers(content: string): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};
  // 匹配 [mcp_servers] 段中的内联表条目
  const sectionMatch = content.match(/\[mcp_servers\]\s*\n([\s\S]*?)(?=\n\[|$)/);
  if (!sectionMatch) return servers;

  const lines = sectionMatch[1].split('\n');
  for (const line of lines) {
    const m = line.match(/^(\S+)\s*=\s*\{(.+)\}\s*$/);
    if (!m) continue;
    const id = m[1];
    // 简单解析内联表的 key = "value" 对
    const entries: Record<string, unknown> = {};
    const pairs = m[2].matchAll(/(\w+)\s*=\s*"([^"]*)"/g);
    for (const p of pairs) {
      entries[p[1]] = p[2];
    }
    servers[id] = entries;
  }
  return servers;
}

function upsertTomlMcpServer(
  content: string,
  serverId: string,
  spec: Record<string, unknown>,
): string {
  const entry = `${serverId} = { type = "${spec.type}", url = "${spec.url}" }`;

  if (content.includes('[mcp_servers]')) {
    // 检查是否已有此 server
    const regex = new RegExp(`^${serverId}\\s*=\\s*\\{.*\\}\\s*$`, 'm');
    if (regex.test(content)) {
      return content.replace(regex, entry);
    }
    return content.replace('[mcp_servers]', `[mcp_servers]\n${entry}`);
  }

  return content + `\n[mcp_servers]\n${entry}\n`;
}

function removeTomlMcpServer(content: string, serverId: string): string {
  const regex = new RegExp(`^${serverId}\\s*=\\s*\\{.*\\}\\s*\\n?`, 'm');
  return content.replace(regex, '');
}

// ─── Claude Code ───────────────────────────────────────────

async function readClaudeServers(): Promise<Record<string, Record<string, unknown>>> {
  const data = await readJsonFile(claudeConfigPath());
  const servers = data.mcpServers;
  if (typeof servers === 'object' && servers !== null) {
    return servers as Record<string, Record<string, unknown>>;
  }
  return {};
}

async function upsertClaudeServer(id: string, spec: Record<string, unknown>): Promise<void> {
  const filePath = claudeConfigPath();
  const data = await readJsonFile(filePath);
  if (!data.mcpServers || typeof data.mcpServers !== 'object') {
    data.mcpServers = {};
  }
  (data.mcpServers as Record<string, unknown>)[id] = spec;
  await writeJsonFile(filePath, data);
}

async function removeClaudeServer(id: string): Promise<boolean> {
  const filePath = claudeConfigPath();
  const data = await readJsonFile(filePath);
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  if (!servers || !(id in servers)) return false;
  delete servers[id];
  await writeJsonFile(filePath, data);
  return true;
}

// ─── Codex ─────────────────────────────────────────────────

async function readCodexServers(): Promise<Record<string, Record<string, unknown>>> {
  const content = await readTomlFile(codexConfigPath());
  return parseTomlMcpServers(content);
}

async function upsertCodexServer(id: string, spec: Record<string, unknown>): Promise<void> {
  const filePath = codexConfigPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  let content = await readTomlFile(filePath);
  content = upsertTomlMcpServer(content, id, spec);
  await fs.writeFile(filePath, content, 'utf-8');
}

async function removeCodexServer(id: string): Promise<boolean> {
  const filePath = codexConfigPath();
  let content = await readTomlFile(filePath);
  if (!content.includes(id)) return false;
  content = removeTomlMcpServer(content, id);
  await fs.writeFile(filePath, content, 'utf-8');
  return true;
}

// ─── Gemini CLI ────────────────────────────────────────────

async function readGeminiServers(): Promise<Record<string, Record<string, unknown>>> {
  const data = await readJsonFile(geminiConfigPath());
  const servers = data.mcpServers;
  if (typeof servers === 'object' && servers !== null) {
    return servers as Record<string, Record<string, unknown>>;
  }
  return {};
}

async function upsertGeminiServer(id: string, spec: Record<string, unknown>): Promise<void> {
  const filePath = geminiConfigPath();
  const data = await readJsonFile(filePath);
  if (!data.mcpServers || typeof data.mcpServers !== 'object') {
    data.mcpServers = {};
  }
  (data.mcpServers as Record<string, unknown>)[id] = spec;
  await writeJsonFile(filePath, data);
}

async function removeGeminiServer(id: string): Promise<boolean> {
  const filePath = geminiConfigPath();
  const data = await readJsonFile(filePath);
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  if (!servers || !(id in servers)) return false;
  delete servers[id];
  await writeJsonFile(filePath, data);
  return true;
}

// ─── 公共接口 ──────────────────────────────────────────────

function buildLingiSpec(port: number): Record<string, unknown> {
  return { type: 'http', url: `http://localhost:${port}/mcp` };
}

export class McpConfigManager {
  async scanLocal(): Promise<LocalMcpServer[]> {
    const merged = new Map<string, { spec: Record<string, unknown>; apps: Set<McpAppType> }>();

    const addServers = (servers: Record<string, Record<string, unknown>>, app: McpAppType) => {
      for (const [id, spec] of Object.entries(servers)) {
        const existing = merged.get(id);
        if (existing) {
          existing.apps.add(app);
        } else {
          merged.set(id, { spec, apps: new Set([app]) });
        }
      }
    };

    const [claude, codex, gemini] = await Promise.all([
      readClaudeServers(),
      readCodexServers(),
      readGeminiServers(),
    ]);

    addServers(claude, 'claude_code');
    addServers(codex, 'codex');
    addServers(gemini, 'gemini');

    return Array.from(merged.entries()).map(([id, { spec, apps }]) => ({
      id,
      spec,
      apps: Array.from(apps),
    }));
  }

  async registerToApp(app: McpAppType, port: number): Promise<void> {
    const spec = buildLingiSpec(port);
    switch (app) {
      case 'claude_code':
        await upsertClaudeServer(MCP_SERVER_ID, spec);
        break;
      case 'codex':
        await upsertCodexServer(MCP_SERVER_ID, spec);
        break;
      case 'gemini':
        await upsertGeminiServer(MCP_SERVER_ID, spec);
        break;
    }
  }

  async removeFromApp(app: McpAppType): Promise<boolean> {
    switch (app) {
      case 'claude_code':
        return removeClaudeServer(MCP_SERVER_ID);
      case 'codex':
        return removeCodexServer(MCP_SERVER_ID);
      case 'gemini':
        return removeGeminiServer(MCP_SERVER_ID);
    }
  }

  async isRegistered(app: McpAppType): Promise<boolean> {
    switch (app) {
      case 'claude_code': {
        const servers = await readClaudeServers();
        return MCP_SERVER_ID in servers;
      }
      case 'codex': {
        const servers = await readCodexServers();
        return MCP_SERVER_ID in servers;
      }
      case 'gemini': {
        const servers = await readGeminiServers();
        return MCP_SERVER_ID in servers;
      }
    }
  }
}
```

- [ ] **Step 2: 验证配置读写**

```bash
# 在 Node REPL 或 test 中验证
node -e "
const { McpConfigManager } = require('./electron/mcp/config-manager');
const mgr = new McpConfigManager();
mgr.scanLocal().then(s => console.log(JSON.stringify(s, null, 2)));
"
```

- [ ] **Step 3: 提交**

```bash
git add electron/mcp/config-manager.ts
git commit -m "feat(mcp): 实现 MCP Config Manager，支持 Claude Code/Codex/Gemini CLI 配置读写"
```

---

## Task 3: Preload 桥接 + MCP IPC

**Files:**
- Create: `electron/mcp/ipc.ts`
- Create: `src/lib/mcp-api.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: 创建 MCP IPC 注册模块**

创建 `electron/mcp/ipc.ts`：

```typescript
import { ipcMain, type BrowserWindow } from 'electron';
import { McpConfigManager, type McpAppType } from './config-manager';
import { startMcpServer, stopMcpServer, getMcpServerStatus } from './server';

const configManager = new McpConfigManager();

export function registerMcpIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('mcp:get-status', () => {
    return getMcpServerStatus();
  });

  ipcMain.handle('mcp:start', async (_event, port: number) => {
    return startMcpServer(port, getMainWindow);
  });

  ipcMain.handle('mcp:stop', async () => {
    await stopMcpServer();
  });

  ipcMain.handle('mcp:scan-local', async () => {
    return configManager.scanLocal();
  });

  ipcMain.handle('mcp:register-to-app', async (_event, app: McpAppType) => {
    const { port } = getMcpServerStatus();
    await configManager.registerToApp(app, port);
  });

  ipcMain.handle('mcp:remove-from-app', async (_event, app: McpAppType) => {
    return configManager.removeFromApp(app);
  });

  ipcMain.handle('mcp:is-registered', async (_event, app: McpAppType) => {
    return configManager.isRegistered(app);
  });
}
```

- [ ] **Step 2: 在 preload.ts 中添加 mcpAPI 桥接**

在 `electron/preload.ts` 的 `contextBridge.exposeInMainWorld` 区域添加：

```typescript
mcpAPI: {
  // 服务管理
  getStatus: (): Promise<{ running: boolean; port: number; url: string }> =>
    ipcRenderer.invoke('mcp:get-status'),
  start: (port: number): Promise<{ port: number; url: string }> =>
    ipcRenderer.invoke('mcp:start', port),
  stop: (): Promise<void> => ipcRenderer.invoke('mcp:stop'),

  // 配置管理
  scanLocal: (): Promise<Array<{ id: string; spec: Record<string, unknown>; apps: string[] }>> =>
    ipcRenderer.invoke('mcp:scan-local'),
  registerToApp: (app: string): Promise<void> =>
    ipcRenderer.invoke('mcp:register-to-app', app),
  removeFromApp: (app: string): Promise<boolean> =>
    ipcRenderer.invoke('mcp:remove-from-app', app),
  isRegistered: (app: string): Promise<boolean> =>
    ipcRenderer.invoke('mcp:is-registered', app),

  // MCP Tool → Renderer 事件监听
  onGetEditorState: (handler: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on('mcp:get-editor-state', listener);
    return () => ipcRenderer.removeListener('mcp:get-editor-state', listener);
  },
  onReadScript: (handler: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on('mcp:read-script', listener);
    return () => ipcRenderer.removeListener('mcp:read-script', listener);
  },
  onGenerateScript: (handler: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on('mcp:generate-script', listener);
    return () => ipcRenderer.removeListener('mcp:generate-script', listener);
  },
  onUpdateScript: (handler: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on('mcp:update-script', listener);
    return () => ipcRenderer.removeListener('mcp:update-script', listener);
  },
  onSubmitReview: (handler: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on('mcp:submit-review', listener);
    return () => ipcRenderer.removeListener('mcp:submit-review', listener);
  },
  onListProjectFiles: (handler: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on('mcp:list-project-files', listener);
    return () => ipcRenderer.removeListener('mcp:list-project-files', listener);
  },
  onGetProjectContext: (handler: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on('mcp:get-project-context', listener);
    return () => ipcRenderer.removeListener('mcp:get-project-context', listener);
  },

  // 回复 MCP 请求
  reply: (replyChannel: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke(replyChannel, data),
},
```

- [ ] **Step 3: 创建 Renderer 侧 MCP API 类型定义**

创建 `src/lib/mcp-api.ts`：

```typescript
export interface McpAPI {
  getStatus(): Promise<{ running: boolean; port: number; url: string }>;
  start(port: number): Promise<{ port: number; url: string }>;
  stop(): Promise<void>;

  scanLocal(): Promise<Array<{ id: string; spec: Record<string, unknown>; apps: string[] }>>;
  registerToApp(app: string): Promise<void>;
  removeFromApp(app: string): Promise<boolean>;
  isRegistered(app: string): Promise<boolean>;

  onGetEditorState(handler: (payload: unknown) => void): () => void;
  onReadScript(handler: (payload: unknown) => void): () => void;
  onGenerateScript(handler: (payload: unknown) => void): () => void;
  onUpdateScript(handler: (payload: unknown) => void): () => void;
  onSubmitReview(handler: (payload: unknown) => void): () => void;
  onListProjectFiles(handler: (payload: unknown) => void): () => void;
  onGetProjectContext(handler: (payload: unknown) => void): () => void;

  reply(replyChannel: string, data: unknown): Promise<void>;
}

declare global {
  interface Window {
    mcpAPI?: McpAPI;
  }
}
```

- [ ] **Step 4: 提交**

```bash
git add electron/mcp/ipc.ts electron/preload.ts src/lib/mcp-api.ts
git commit -m "feat(mcp): 实现 MCP IPC 桥接 + Preload mcpAPI + 类型定义"
```

---

## Task 4: 前端 MCP 事件处理

**Files:**
- Modify: `src/store/script.ts`
- Modify: `src/pages/ScriptWorkbench.tsx`
- Modify: `src/ui/components/script-editor.tsx`

- [ ] **Step 1: ScriptStore 添加 MCP 相关 actions**

在 `src/store/script.ts` 的 state 中添加：

```typescript
// 新增 state 字段
mcpChangeHighlightLines: number[];  // MCP 写入后高亮的行号

// 新增 actions
setMcpChangeHighlightLines: (lines: number[]) => void;
clearMcpChangeHighlight: () => void;
```

actions 实现：

```typescript
setMcpChangeHighlightLines: (lines) => set({ mcpChangeHighlightLines: lines }),
clearMcpChangeHighlight: () => set({ mcpChangeHighlightLines: [] }),
```

- [ ] **Step 2: ScriptWorkbench 注册 MCP 事件监听**

在 `src/pages/ScriptWorkbench.tsx` 中添加 MCP 事件监听 useEffect：

```typescript
// MCP Tool 事件监听
useEffect(() => {
  if (!window.mcpAPI) return;

  const unsubs: Array<() => void> = [];

  // mcp:get-editor-state
  unsubs.push(window.mcpAPI.onGetEditorState(async (payload: any) => {
    const state = useScriptStore.getState();
    await window.mcpAPI!.reply(payload._replyChannel, {
      projectDir: state.projectDir,
      openFiles: state.fileEntries.map((f) => f.path),
      activeFile: state.openedFile,
      cursorPosition: null,
    });
  }));

  // mcp:read-script
  unsubs.push(window.mcpAPI.onReadScript(async (payload: any) => {
    const state = useScriptStore.getState();
    const filePath = payload.filePath || state.openedFile || 'script.md';
    let content = '';
    if (filePath === 'script.md') {
      content = state.scriptText;
    } else if (filePath === 'original.md') {
      content = state.originalText;
    } else {
      content = state.extraFileContents[filePath] ?? '';
    }
    await window.mcpAPI!.reply(payload._replyChannel, {
      filePath,
      content,
      lineCount: content.split('\n').length,
    });
  }));

  // mcp:generate-script（写稿）
  unsubs.push(window.mcpAPI.onGenerateScript(async (payload: any) => {
    const state = useScriptStore.getState();
    try {
      state.setOriginalText(payload.rawText);
      state.setSelectedTemplate(payload.templateCode);
      // 调用已有的生成逻辑
      const { generateScriptDraft } = await import('../lib/script-utils');
      const result = await generateScriptDraft(payload.rawText, payload.templateCode);
      state.setScriptText(result);
      // 保存到磁盘
      if (state.projectDir && window.electronAPI) {
        await window.electronAPI.saveScriptFile(state.projectDir, 'original.md', payload.rawText);
        await window.electronAPI.saveScriptFile(state.projectDir, 'script.md', result);
      }
      await window.mcpAPI!.reply(payload._replyChannel, {
        success: true,
        filePath: 'script.md',
        summary: `使用 ${payload.templateCode} 模板生成了口播稿`,
        linesGenerated: result.split('\n').length,
      });
    } catch (err: any) {
      await window.mcpAPI!.reply(payload._replyChannel, {
        success: false,
        filePath: 'script.md',
        summary: '',
        linesGenerated: 0,
        error: err.message ?? 'Generation failed',
      });
    }
  }));

  // mcp:update-script（直接更新）
  unsubs.push(window.mcpAPI.onUpdateScript(async (payload: any) => {
    const state = useScriptStore.getState();
    const filePath = payload.filePath || state.openedFile || 'script.md';
    const oldContent = filePath === 'script.md'
      ? state.scriptText
      : filePath === 'original.md'
        ? state.originalText
        : state.extraFileContents[filePath] ?? '';

    // 更新 store
    if (filePath === 'script.md') {
      state.setScriptText(payload.content);
    } else if (filePath === 'original.md') {
      state.setOriginalText(payload.content);
    } else {
      state.setExtraFileContent(filePath, payload.content);
    }

    // 计算变更行
    const oldLines = oldContent.split('\n');
    const newLines = (payload.content as string).split('\n');
    const changedLines: number[] = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (oldLines[i] !== newLines[i]) changedLines.push(i + 1);
    }
    state.setMcpChangeHighlightLines(changedLines);

    // 3 秒后清除高亮
    setTimeout(() => state.clearMcpChangeHighlight(), 3000);

    // 保存到磁盘
    if (state.projectDir && window.electronAPI) {
      await window.electronAPI.saveScriptFile(state.projectDir, filePath, payload.content);
    }

    await window.mcpAPI!.reply(payload._replyChannel, {
      success: true,
      filePath,
      linesChanged: changedLines.length,
    });
  }));

  // mcp:submit-review（审稿）
  unsubs.push(window.mcpAPI.onSubmitReview(async (payload: any) => {
    const state = useScriptStore.getState();
    const scriptContent = state.scriptText;
    const lines = scriptContent.split('\n');

    // 将行号批注转换为 byte offset 批注
    const annotations = (payload.annotations as Array<{
      line: number;
      endLine?: number;
      text: string;
      severity?: string;
    }>).map((a, i) => {
      const lineIdx = Math.max(0, a.line - 1);
      const endLineIdx = a.endLine ? Math.max(0, a.endLine - 1) : lineIdx;
      // 计算 byte offset
      let startOffset = 0;
      for (let j = 0; j < lineIdx && j < lines.length; j++) {
        startOffset += lines[j].length + 1; // +1 for \n
      }
      let endOffset = startOffset;
      for (let j = lineIdx; j <= endLineIdx && j < lines.length; j++) {
        endOffset += lines[j].length + 1;
      }
      endOffset = Math.max(startOffset + 1, endOffset - 1); // 去掉末尾 \n

      const originalText = lines.slice(lineIdx, endLineIdx + 1).join('\n');

      return {
        id: `mcp-review-${Date.now()}-${i}`,
        startOffset,
        endOffset,
        originalText,
        quotedText: originalText.slice(0, 60),
        docVersion: state.scriptDocVersion,
        issue: a.text,
        suggestion: '',
        severity: (a.severity ?? 'info') as 'error' | 'warning' | 'info',
        status: 'pending' as const,
      };
    });

    state.setAnnotations(annotations);
    state.setReviewState('issues');

    await window.mcpAPI!.reply(payload._replyChannel, {
      success: true,
      filePath: payload.filePath || 'script.md',
      annotationCount: annotations.length,
    });
  }));

  // mcp:list-project-files
  unsubs.push(window.mcpAPI.onListProjectFiles(async (payload: any) => {
    const state = useScriptStore.getState();
    await window.mcpAPI!.reply(payload._replyChannel, {
      projectDir: state.projectDir,
      files: state.fileEntries.map((f) => ({
        path: f.path,
        name: f.name,
        isDirectory: f.isDirectory,
      })),
    });
  }));

  // mcp:get-project-context
  unsubs.push(window.mcpAPI.onGetProjectContext(async (payload: any) => {
    const state = useScriptStore.getState();
    const { getAllTemplates } = await import('../lib/script-templates');
    const templates = getAllTemplates();
    await window.mcpAPI!.reply(payload._replyChannel, {
      projectName: state.projectDir ? state.projectDir.split('/').pop() : null,
      projectDir: state.projectDir,
      selectedTemplate: state.selectedTemplate,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
      })),
    });
  }));

  return () => unsubs.forEach((fn) => fn());
}, []);
```

- [ ] **Step 3: ScriptEditor 添加变更行高亮**

在 `src/ui/components/script-editor.tsx` 中：

1. 添加 CodeMirror StateEffect 和 StateField：

```typescript
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';

const setHighlightLinesEffect = StateEffect.define<number[]>();

const highlightLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlightLinesEffect)) {
        const lines = effect.value;
        const decorations: Range<Decoration>[] = [];
        for (const lineNum of lines) {
          if (lineNum >= 1 && lineNum <= tr.state.doc.lines) {
            const line = tr.state.doc.line(lineNum);
            decorations.push(
              Decoration.line({ class: 'cm-mcp-change-highlight' }).range(line.from),
            );
          }
        }
        return Decoration.set(decorations, true);
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
```

2. 通过 props 接收 `mcpChangeHighlightLines` 并 dispatch effect：

```typescript
// 在组件中：
useEffect(() => {
  if (editorView && mcpChangeHighlightLines) {
    editorView.dispatch({
      effects: setHighlightLinesEffect.of(mcpChangeHighlightLines),
    });
  }
}, [editorView, mcpChangeHighlightLines]);
```

3. 在 editor theme 中添加高亮样式：

```typescript
'.cm-mcp-change-highlight': {
  backgroundColor: 'rgba(50, 215, 75, 0.15)',  // 绿色半透明
  transition: 'background-color 0.5s ease-out',
},
```

- [ ] **Step 4: 提交**

```bash
git add src/store/script.ts src/pages/ScriptWorkbench.tsx src/ui/components/script-editor.tsx
git commit -m "feat(mcp): 前端 MCP 事件处理 + 编辑器变更行高亮"
```

---

## Task 5: ACP 集成 + 旧模块清理

**Files:**
- Modify: `electron/acp/ipc.ts`
- Modify: `electron/acp/session.ts`
- Delete: `electron/acp/fs-runtime.ts`
- Delete: `electron/acp/operation-interceptor.ts`
- Delete: `electron/acp/terminal-runtime.ts`
- Delete: `electron/acp/permission.ts`

- [ ] **Step 1: 修改 ipc.ts — spawn 前注入 MCP 配置**

在 `electron/acp/ipc.ts` 的 `agent:connect` handler 中，spawn Claude Code 前添加：

```typescript
// 在 import 区域添加
import { McpConfigManager } from '../mcp/config-manager';
import { getMcpServerStatus } from '../mcp/server';

// 在 agent:connect handler 中，await sessionManager.connect(...) 之前添加：
const mcpConfigMgr = new McpConfigManager();
const mcpStatus = getMcpServerStatus();
if (mcpStatus.running) {
  await mcpConfigMgr.registerToApp('claude_code', mcpStatus.port);
}
```

- [ ] **Step 2: 移除 ipc.ts 中的旧 handler**

移除以下 IPC handler：
- `agent:commit-write-stream`（写入流 ACK）
- `agent:respond-permission`（权限响应 — 注意：如果 Claude Code 仍需要通过 ACP 接收权限决策，保留此项；但由于移除了自定义 permission handler，Claude Code 会使用自己的权限系统）

移除 import 和实例化：
- `AgentOperationInterceptor` import 和 `interceptor` 实例
- `TerminalRuntime` import 和 `terminalRuntime` 实例

- [ ] **Step 3: 修改 session.ts — 移除 runtime handler 注册**

在 `session.ts` 的 `connect()` 方法中，移除：
- `FileSystemRuntime` 注册（`this.client.onRequest('fs/readFile', ...)` 等）
- `TerminalRuntime` 注册
- `setInterceptor()` 调用和相关逻辑
- 自定义 permission handler（`onRequest('session/permission', ...)`）

保留：
- `session/elicitation` handler（可保留为 dismiss）
- `handleSessionUpdate()` 中的所有事件处理

- [ ] **Step 4: 删除废弃文件**

```bash
rm electron/acp/fs-runtime.ts
rm electron/acp/operation-interceptor.ts
rm electron/acp/terminal-runtime.ts
rm electron/acp/permission.ts
```

- [ ] **Step 5: 清理 preload.ts 中的旧 agentAPI 接口**

移除 `agentAPI` 中的：
- `onWriteStreamStart` / `onWriteStreamComplete` / `commitWriteStream`（写入流相关）

- [ ] **Step 6: 清理前端旧代码**

在 `src/components/agent/AgentSidebar.tsx` 中：
- 移除 `agent:write-stream-start` / `agent:write-stream-complete` 事件监听
- 移除 operation-interceptor 相关的 import 和逻辑

在 `src/store/script.ts` 中：
- 移除 `activeStream` 状态和相关 actions（`setActiveStream`, `clearActiveStream`）
- 简化 `stopAgentOperation` 中的 stream 重置逻辑

- [ ] **Step 7: 验证构建通过**

```bash
npm run build
npm run typecheck
```

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "refactor(acp): 集成 MCP 配置注入 + 清理废弃的 runtime handler"
```

---

## Task 6: MCP 设置面板 UI

**Files:**
- Create: `src/components/settings/McpSettingsTab.tsx`
- Create: `src/components/settings/McpSettingsTab.module.css`

- [ ] **Step 1: 创建 MCP 设置面板组件**

创建 `src/components/settings/McpSettingsTab.tsx`：

```tsx
import { useEffect, useState, useCallback } from 'react';
import { Server, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import styles from './McpSettingsTab.module.css';

interface McpStatus {
  running: boolean;
  port: number;
  url: string;
}

interface AppRegistration {
  app: string;
  label: string;
  registered: boolean;
}

const SUPPORTED_APPS: Array<{ app: string; label: string }> = [
  { app: 'claude_code', label: 'Claude Code' },
  { app: 'codex', label: 'Codex' },
  { app: 'gemini', label: 'Gemini CLI' },
];

export function McpSettingsTab() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [registrations, setRegistrations] = useState<AppRegistration[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.mcpAPI) return;
    setLoading(true);
    try {
      const s = await window.mcpAPI.getStatus();
      setStatus(s);

      const regs = await Promise.all(
        SUPPORTED_APPS.map(async ({ app, label }) => ({
          app,
          label,
          registered: await window.mcpAPI!.isRegistered(app),
        })),
      );
      setRegistrations(regs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleToggleRegistration = async (app: string, registered: boolean) => {
    if (!window.mcpAPI) return;
    if (registered) {
      await window.mcpAPI.removeFromApp(app);
    } else {
      await window.mcpAPI.registerToApp(app);
    }
    refresh();
  };

  if (!window.mcpAPI) {
    return <div className={styles.container}>MCP 服务仅在桌面端可用</div>;
  }

  return (
    <div className={styles.container}>
      {/* 服务状态 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>
          <Server size={16} />
          MCP 服务状态
        </h3>
        <div className={styles.statusRow}>
          <span className={styles.statusIndicator} data-running={status?.running}>
            {status?.running ? <CheckCircle size={14} /> : <XCircle size={14} />}
            {status?.running ? '运行中' : '已停止'}
          </span>
          {status?.running && (
            <span className={styles.statusUrl}>{status.url}</span>
          )}
          <button className={styles.refreshBtn} onClick={refresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? styles.spinning : ''} />
          </button>
        </div>
      </div>

      {/* AI 工具注册 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>注册到 AI 工具</h3>
        <p className={styles.sectionDesc}>
          将灵几编辑器的 MCP 服务注册到 AI 工具中，使其能通过 MCP 协议与编辑器交互。
        </p>
        <div className={styles.appList}>
          {registrations.map((reg) => (
            <div key={reg.app} className={styles.appRow}>
              <span className={styles.appLabel}>{reg.label}</span>
              <span className={styles.appStatus} data-registered={reg.registered}>
                {reg.registered ? '已注册' : '未注册'}
              </span>
              <button
                className={styles.appToggle}
                data-registered={reg.registered}
                onClick={() => handleToggleRegistration(reg.app, reg.registered)}
              >
                {reg.registered ? '移除' : '注册'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建样式文件**

创建 `src/components/settings/McpSettingsTab.module.css`：

```css
.container {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sectionTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #e5e5e7);
  margin: 0;
}

.sectionDesc {
  font-size: 12px;
  color: var(--text-secondary, #8e8e93);
  margin: 0;
  line-height: 1.4;
}

.statusRow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary, #2c2c2e);
  border-radius: 8px;
}

.statusIndicator {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
}

.statusIndicator[data-running='true'] {
  color: #32d74b;
}

.statusIndicator[data-running='false'] {
  color: #ff453a;
}

.statusUrl {
  font-size: 12px;
  color: var(--text-secondary, #8e8e93);
  font-family: 'SF Mono', Menlo, monospace;
}

.refreshBtn {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-secondary, #8e8e93);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.refreshBtn:hover {
  background: var(--bg-tertiary, #3a3a3c);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.appList {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.appRow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary, #2c2c2e);
  border-radius: 8px;
}

.appLabel {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #e5e5e7);
  min-width: 100px;
}

.appStatus {
  font-size: 12px;
}

.appStatus[data-registered='true'] {
  color: #32d74b;
}

.appStatus[data-registered='false'] {
  color: var(--text-secondary, #8e8e93);
}

.appToggle {
  margin-left: auto;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--border, #3a3a3c);
  background: var(--bg-tertiary, #3a3a3c);
  color: var(--text-primary, #e5e5e7);
  cursor: pointer;
}

.appToggle:hover {
  background: var(--bg-hover, #48484a);
}

.appToggle[data-registered='true'] {
  border-color: #ff453a40;
  color: #ff453a;
}

.appToggle[data-registered='true']:hover {
  background: #ff453a20;
}
```

- [ ] **Step 3: 在设置面板中集成 MCP Tab**

找到设置面板的 tab 组件（可能在 `src/components/settings/` 或 `src/pages/` 中），添加 MCP Tab：

```tsx
import { McpSettingsTab } from './McpSettingsTab';
// 在 tabs 配置中添加
{ id: 'mcp', label: 'MCP 服务', component: McpSettingsTab }
```

- [ ] **Step 4: 提交**

```bash
git add src/components/settings/McpSettingsTab.tsx src/components/settings/McpSettingsTab.module.css
git commit -m "feat(mcp): MCP 服务设置面板 UI"
```

---

## Task 7: 集成测试与验证

**Files:**
- Modify: 视需要

- [ ] **Step 1: 构建验证**

```bash
npm run build
npm run typecheck
```

修复所有编译和类型错误。

- [ ] **Step 2: MCP Server 端到端测试**

```bash
# 启动应用
npm run dev

# 终端 1：验证 MCP Server
curl http://localhost:19820/health
# 期望: {"status":"ok","name":"lingji-editor"}

# 终端 2：使用 MCP Inspector 或 curl 测试工具调用
curl -X POST http://localhost:19820/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# 期望: 返回 7 个工具定义
```

- [ ] **Step 3: 验证 Config Manager**

```bash
# 在 Node 中测试注册/移除
node -e "
const { McpConfigManager } = require('./electron/mcp/config-manager');
const mgr = new McpConfigManager();
(async () => {
  await mgr.registerToApp('claude_code', 19820);
  console.log('Registered:', await mgr.isRegistered('claude_code'));
  const servers = await mgr.scanLocal();
  console.log('Servers:', JSON.stringify(servers, null, 2));
})();
"
```

- [ ] **Step 4: 验证 ACP + MCP 联动**

1. 启动应用，打开 AI 助手侧边栏
2. 确认 Claude Code 连接成功
3. 在对话中让 Claude Code 调用 `lingji_get_editor_state`
4. 确认编辑器状态正确返回
5. 让 Claude Code 调用 `lingji_read_script` 读取当前脚本
6. 让 Claude Code 调用 `lingji_update_script` 更新脚本内容
7. 确认编辑器内容即时更新并显示变更高亮

- [ ] **Step 5: 验证外部 AI 工具集成**

1. 在设置面板 → MCP 服务 Tab 中，注册到 Claude Code
2. 打开终端，运行 `claude` 命令
3. 在 Claude Code 中使用 `lingji_*` 工具
4. 确认编辑器响应正确

- [ ] **Step 6: 最终提交**

```bash
git add -A
git commit -m "test(mcp): 集成验证通过"
```

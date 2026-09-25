# 灵几编辑器 MCP Server 迁移设计

## 概述

将 AI 助手与编辑器之间的交互从 ACP 内部 runtime handler 迁移到标准 MCP Server，实现：
1. 内置对话和外部 AI 工具共用同一套编辑器工具接口
2. ACP 层仅负责对话/流式输出，编辑器操作全部走 MCP
3. 支持一键注册到 Claude Code / Codex / Gemini CLI 等 AI 工具

## 架构

```
灵几 App (Electron)
└─ Main Process
    ├─ MCP HTTP Server (localhost:19820/mcp)
    │   ├─ lingji_get_editor_state
    │   ├─ lingji_read_script
    │   ├─ lingji_write_script       写稿（模板+素材→内置AI生成）
    │   ├─ lingji_update_script      更新脚本内容（直接写入）
    │   ├─ lingji_review_script      审稿
    │   ├─ lingji_list_project_files
    │   └─ lingji_get_project_context
    │
    ├─ ACP Agent（保留，内置对话 UI）
    │   ├─ spawn Claude Code 时自动注入 MCP 配置
    │   ├─ 对话/流式/thinking 走 ACP
    │   └─ Claude Code 调用 lingji_* → 走 MCP → 编辑器更新
    │
    ├─ MCP Config Manager
    │   ├─ 扫描各 AI 工具已安装的 MCP 配置
    │   ├─ 一键注册 lingji-editor 到目标 AI 工具
    │   └─ 支持 Claude Code / Codex / Gemini CLI
    │
    └─ 编辑器状态桥接（MCP Tool Handler ↔ Renderer IPC）

└─ Renderer
    ├─ AgentSidebar（保留完整对话 UI）
    ├─ ScriptEditor（MCP 写入时即时更新 + 变更行高亮）
    └─ 设置面板 → MCP 服务 Tab
```

### 数据流

```
内置对话：用户 → AgentSidebar → ACP → Claude Code → lingji_* MCP Tool → IPC → 编辑器
外部工具：用户 → Claude Code 终端 → lingji_* MCP Tool → IPC → 编辑器
                                      ↑ 同一套工具，同一个 MCP Server
```

## MCP Server 实现

### 技术选型

- SDK: `@modelcontextprotocol/sdk` (官方 TypeScript MCP SDK)
- Transport: `StreamableHTTPServerTransport` (HTTP/SSE)
- 端口: 默认 `19820`，可在设置中修改
- 生命周期: App 启动时自动启动，App 退出时关闭

### 文件结构

```
electron/mcp/
  ├─ server.ts          MCP HTTP Server 启停管理
  ├─ tools.ts           工具定义 + handler 实现
  ├─ config-manager.ts  读写各 AI 工具的 MCP 配置文件
  └─ ipc.ts             MCP 相关 Electron IPC handlers
```

### server.ts — MCP Server 管理

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http from 'node:http';

export class LingjiMcpServer {
  private server: McpServer;
  private httpServer: http.Server | null = null;
  private port: number;

  constructor(port: number = 19820) {
    this.port = port;
    this.server = new McpServer({
      name: 'lingji-editor',
      version: '1.0.0',
    });
  }

  // 注册工具、启动 HTTP Server
  async start(getMainWindow: () => BrowserWindow | null): Promise<void>;
  // 停止 HTTP Server
  async stop(): Promise<void>;
  // 获取运行状态
  getStatus(): { running: boolean; port: number; url: string };
}
```

### tools.ts — MCP 工具定义

#### lingji_get_editor_state

获取当前编辑器状态。

```typescript
{
  name: "lingji_get_editor_state",
  description: "获取灵几编辑器当前状态：项目目录、打开的文件列表、当前活动文件、光标位置",
  inputSchema: {
    type: "object",
    properties: {},
  }
}
// 返回: { projectDir, openFiles, activeFile, cursorPosition }
```

handler 通过 IPC 向 Renderer 请求 ScriptStore 状态。

#### lingji_read_script

读取脚本文件内容。

```typescript
{
  name: "lingji_read_script",
  description: "读取指定脚本文件的内容。不传 filePath 时读取当前编辑器中打开的文件。",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "文件路径（相对于项目根目录或绝对路径），缺省为当前打开的文件"
      }
    }
  }
}
// 返回: { filePath, content, language, lineCount }
```

#### lingji_write_script

根据原始文本素材和口播模板风格，调用内置 AI 生成口播稿文件。

```typescript
{
  name: "lingji_write_script",
  description: "根据原始文本素材和口播模板风格，生成口播稿脚本文件。MCP Server 内部调用内置 AI 完成生成，调用方无需传入成品内容。",
  inputSchema: {
    type: "object",
    properties: {
      templateCode: {
        type: "string",
        description: "口播模板风格 code（来自系统设置中的模板列表，如 'formal'、'casual'、'news' 等）"
      },
      rawText: {
        type: "string",
        description: "需要转换为口播稿的原始文本素材"
      }
    },
    required: ["templateCode", "rawText"]
  }
}
// 返回: { success, filePath, summary, linesGenerated }
```

handler 流程：
1. 根据 `templateCode` 从系统设置中获取对应模板的 prompt 和风格参数
2. 将 `rawText` + 模板 prompt 组装为 AI 请求
3. 调用内置 AI（通过 ACP Agent 或直接调 Anthropic API）生成口播稿内容
4. 将生成结果写入脚本文件（磁盘 + 通过 IPC 更新编辑器）
5. 编辑器即时显示生成的内容 + 变更行高亮
6. 返回 `{ success, filePath, summary, linesGenerated }` 给 MCP 调用方

#### lingji_update_script

直接更新脚本文件内容（用于局部修改、手动编辑等场景）。

```typescript
{
  name: "lingji_update_script",
  description: "直接写入或更新脚本文件内容。编辑器会即时显示更新内容并高亮变更行。不传 filePath 时更新当前打开的文件。",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "文件路径，缺省为当前打开的文件"
      },
      content: {
        type: "string",
        description: "完整的脚本内容"
      },
      description: {
        type: "string",
        description: "本次修改的简要说明"
      }
    },
    required: ["content"]
  }
}
// 返回: { success, filePath, linesChanged }
```

handler 流程：
1. 通过 IPC 发送 `mcp:write-script` 到 Renderer
2. Renderer 的 ScriptStore 更新编辑器内容
3. 编辑器对变更行添加高亮（3 秒后淡出）
4. 同时写入磁盘文件
5. 返回结果给 MCP 调用方

#### lingji_review_script

对脚本进行审阅，提交逐行批注。

```typescript
{
  name: "lingji_review_script",
  description: "对脚本进行审阅，提交逐行批注。编辑器会在对应行旁显示批注卡片。不传 filePath 时审阅当前打开的文件。",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "审阅的文件路径，缺省为当前打开的文件"
      },
      summary: {
        type: "string",
        description: "审阅总结评价"
      },
      score: {
        type: "number",
        description: "评分（0-100）"
      },
      annotations: {
        type: "array",
        description: "逐行批注列表",
        items: {
          type: "object",
          properties: {
            line: { type: "number", description: "行号（从 1 开始）" },
            endLine: { type: "number", description: "结束行号（多行批注时使用）" },
            text: { type: "string", description: "批注内容" },
            severity: {
              type: "string",
              enum: ["info", "suggestion", "warning", "error"],
              description: "严重程度，默认 info"
            }
          },
          required: ["line", "text"]
        }
      }
    },
    required: ["annotations"]
  }
}
// 返回: { success, filePath, annotationCount }
```

handler 流程：
1. 通过 IPC 发送 `mcp:submit-review` 到 Renderer
2. Renderer 的 ScriptStore 接收批注数据
3. 编辑器在对应行渲染批注卡片（复用现有 AnnotationCard 组件）
4. 返回结果

#### lingji_list_project_files

列出项目文件。

```typescript
{
  name: "lingji_list_project_files",
  description: "列出当前项目的文件列表",
  inputSchema: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description: "子目录路径，缺省为项目根目录"
      }
    }
  }
}
// 返回: { projectDir, files: [{ path, name, isDirectory, size }] }
```

#### lingji_get_project_context

获取项目上下文信息。

```typescript
{
  name: "lingji_get_project_context",
  description: "获取当前项目的上下文信息：项目名称、可用模板、项目配置等",
  inputSchema: {
    type: "object",
    properties: {}
  }
}
// 返回: { projectName, projectDir, templates, recentFiles }
```

## MCP Config Manager

借鉴 codeg 项目的 MCP 配置管理模式，实现对各 AI 工具配置文件的读写。

### 支持的 AI 工具

| 工具 | 配置文件路径 | 格式 | MCP Key | Header 字段名 |
|------|-------------|------|---------|--------------|
| Claude Code | `~/.claude.json` | JSON | `mcpServers` | `headers` |
| Codex | `$CODEX_HOME/config.toml`（默认 `~/.codex/config.toml`） | TOML | `mcp_servers` | `http_headers` |
| Gemini CLI | `~/.gemini/settings.json` | JSON | `mcpServers` | `headers` |

### config-manager.ts 核心接口

```typescript
export type McpAppType = 'claude_code' | 'codex' | 'gemini';

export interface LocalMcpServer {
  id: string;
  spec: Record<string, unknown>;
  apps: McpAppType[];
}

export class McpConfigManager {
  // 扫描所有 AI 工具中已安装的 MCP Server
  async scanLocal(): Promise<LocalMcpServer[]>;

  // 将 lingji-editor 注册到指定 AI 工具
  async registerToApp(app: McpAppType, port: number): Promise<void>;

  // 从指定 AI 工具移除 lingji-editor
  async removeFromApp(app: McpAppType): Promise<void>;

  // 检查 lingji-editor 是否已注册到指定 AI 工具
  async isRegistered(app: McpAppType): Promise<boolean>;
}
```

### 注册时写入的配置

#### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "lingji-editor": {
      "type": "http",
      "url": "http://localhost:19820/mcp"
    }
  }
}
```

读写规则：
- 文件不存在时创建，初始化为 `{}`
- 读取时 `mcpServers` 不存在则视为空
- 写入时保留文件中其他字段不变
- JSON pretty-print 2 空格缩进 + 尾部换行

#### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers]
lingji-editor = { type = "http", url = "http://localhost:19820/mcp" }
```

读写规则：
- 文件不存在时创建空 table
- 写入到 `mcp_servers` section（新格式）
- 如有 legacy `[mcp.servers]` 中的同名条目，同时清除
- TOML pretty-print + 尾部换行
- 支持 `$CODEX_HOME` 环境变量覆盖目录（含 `~` 展开）

#### Gemini CLI (`~/.gemini/settings.json`)

```json
{
  "mcpServers": {
    "lingji-editor": {
      "type": "http",
      "url": "http://localhost:19820/mcp"
    }
  }
}
```

读写规则同 Claude Code。

### 通用规则

- 父目录不存在时自动创建
- 读取失败（文件不存在）返回空集合而非报错
- 写入时只操作 MCP 相关字段，保留配置文件中其他内容
- 注册/移除操作是幂等的

## ACP 集成变更

### spawn Claude Code 时注入 MCP

在 `electron/acp/ipc.ts` 的 `agent:connect` handler 中，spawn Claude Code 前自动确保 MCP 配置已写入：

```typescript
// agent:connect handler 中，spawn 前
const mcpConfigManager = new McpConfigManager();
const mcpServer = getLingjiMcpServer();

// 确保 MCP Server 已启动
if (!mcpServer.getStatus().running) {
  await mcpServer.start(getMainWindow);
}

// 确保 Claude Code 的配置中有 lingji-editor
const port = mcpServer.getStatus().port;
await mcpConfigManager.registerToApp('claude_code', port);
```

这样内置 Claude Code 启动后会自动发现并连接 lingji-editor MCP Server。

### ACP 层清理

以下模块可以删除（其功能由 MCP 工具替代）：

| 模块 | 原功能 | MCP 替代 |
|------|--------|---------|
| `fs-runtime.ts` | 文件读写 handler | `lingji_read_script` / `lingji_write_script` |
| `operation-interceptor.ts` | 写入流拦截/动画 | `lingji_write_script` 即时写入 |
| `terminal-runtime.ts` | 终端 PTY handler | Claude Code 自带终端 |
| `permission.ts` | 权限模型 | Claude Code 自带权限系统 |

保留的模块：
- `client.ts` — JSON-RPC 通信（对话通道）
- `session.ts` — 会话管理（对话/流式，含 bug fix）
- `config.ts` — Agent 配置管理（API Key 等）
- `binary-manager.ts` — Agent binary 安装管理
- `preflight.ts` — 环境预检
- `ipc.ts` — ACP IPC handlers（简化，移除 fs/terminal/permission 相关）

### ipc.ts 清理

移除以下 IPC handler：
- `agent:commit-write-stream` — 写入流 ACK（不再需要）
- `agent:respond-permission` — 权限响应（Claude Code 自行处理）

保留：
- `agent:connect` / `agent:disconnect`
- `agent:send-prompt` / `agent:cancel-turn`
- `agent:set-mode` / `agent:set-config-option`
- 配置管理相关 handlers

## 前端变更

### 新增 MCP IPC 通道

Renderer → Main:
- `mcp:get-status` — 获取 MCP Server 状态
- `mcp:set-port` — 设置端口
- `mcp:register-to-app` — 注册到 AI 工具
- `mcp:remove-from-app` — 从 AI 工具移除
- `mcp:scan-local` — 扫描已注册的 AI 工具

Main → Renderer（MCP Tool handler 调用时）:
- `mcp:get-editor-state` — 请求编辑器状态
- `mcp:read-script` — 请求脚本内容
- `mcp:write-script` — 写入脚本内容
- `mcp:submit-review` — 提交审阅批注
- `mcp:list-project-files` — 请求文件列表
- `mcp:get-project-context` — 请求项目上下文

### Preload 桥接

在 `electron/preload.ts` 中新增 `window.mcpAPI`：

```typescript
mcpAPI: {
  getStatus: () => ipcRenderer.invoke('mcp:get-status'),
  setPort: (port: number) => ipcRenderer.invoke('mcp:set-port', port),
  registerToApp: (app: string) => ipcRenderer.invoke('mcp:register-to-app', app),
  removeFromApp: (app: string) => ipcRenderer.invoke('mcp:remove-from-app', app),
  scanLocal: () => ipcRenderer.invoke('mcp:scan-local'),

  // MCP Tool → Renderer 的请求响应
  onGetEditorState: (handler) => ipcRenderer.on('mcp:get-editor-state', handler),
  onReadScript: (handler) => ipcRenderer.on('mcp:read-script', handler),
  onWriteScript: (handler) => ipcRenderer.on('mcp:write-script', handler),
  onSubmitReview: (handler) => ipcRenderer.on('mcp:submit-review', handler),
}
```

### 设置面板 — MCP 服务 Tab

新增 `src/components/settings/McpSettingsTab.tsx`：

- MCP Server 状态指示（运行中/已停止）
- 端口配置输入框
- "注册到 AI 工具"区域：
  - Claude Code — 状态 + 注册/移除按钮
  - Codex — 状态 + 注册/移除按钮
  - Gemini CLI — 状态 + 注册/移除按钮
- 各工具的注册状态自动检测

### ScriptEditor 变更高亮

当 MCP `lingji_write_script` 工具被调用时：

1. ScriptStore 接收 `mcp:write-script` 事件
2. 对比旧内容和新内容，计算变更行
3. 更新编辑器内容
4. 对变更行添加 CSS 高亮类（背景色 + 淡入动画）
5. 3 秒后淡出高亮

### AgentSidebar 适配

现有 tool_call 展示逻辑已能显示 Claude Code 的工具调用。当 Claude Code 调用 `lingji_*` MCP 工具时，ACP 通道会收到 `tool_call` / `tool_call_update` 事件，AgentSidebar 自然展示。

可选增强：识别 `mcp__lingji-editor__*` 前缀的工具调用，用更友好的方式展示（如显示"正在写稿..."而非原始工具名）。

## Bug Fix（前置）

### sendPrompt 超时问题

`AcpClient.requestTimeout` 默认 30 秒，但 `session/prompt` 可能需要数分钟。

修复：
1. `client.ts`: `sendRequest()` 支持 `timeout` 参数，传 `0` 表示不设超时
2. `session.ts`: `sendPrompt()` 调用 `sendRequest` 时传 `timeout=0`，并用 `try/finally` 确保 `turn_complete` 事件始终被发出

此修复已完成。

## 不做的事

- 不实现 MCP Marketplace 浏览/安装（只管理 lingji-editor 自身的注册）
- 不在 MCP Server 中实现终端执行（AI 工具自带）
- 不在 MCP Server 中实现权限模型（AI 工具自带）
- 不修改 AgentSidebar 对话 UI 的核心逻辑
- 不支持 stdio transport（HTTP/SSE 更适合 Electron 长驻进程场景）

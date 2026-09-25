# AI Agent ACP 集成设计

> 在灵机剪影中集成 Claude Code Agent 能力，通过 ACP 协议实现完整的 AI 对话交互，第一期聚焦文稿撰写场景。

## 1. 背景与目标

### 背景

灵机剪影已有基于 OpenAI 兼容 API 的 AI 分析能力（字幕分析、文稿生成），但交互模式为单次请求-响应。需要升级为完整的对话式 Agent，能理解项目上下文、执行多步操作、动态撰写和修改文稿。

参考项目 codeg（Tauri 框架）已实现 ACP（Agent Client Protocol）集成，通过官方适配器 `@agentclientprotocol/claude-agent-acp` 与 Claude Code 通信。本设计将该能力迁移到灵机剪影的 Electron 架构中。

### 目标

- 在 Electron 主进程中实现纯 Node.js ACP 客户端
- 提供完整 Agent 能力：文件系统读写 + 终端执行 + 权限审批
- 右侧抽屉式对话 UI，支持 Markdown + shiki 高亮 + diff 可视化 + 工具调用详情
- Settings 中集成 Agent SDK 管理界面（对齐 codeg 双面板设计）
- 项目绑定单会话模型

### 不做（第二期）

- 多 Agent 支持
- 多会话 / 会话历史持久化
- 附件 / 图片上传
- 视频剪辑集成

## 2. 整体架构

```
┌──────────────────────────────────────────────────────┐
│                    Renderer Process                    │
│                                                        │
│  ┌─────────────┐  ┌──────────────────────────────┐   │
│  │ 现有页面     │  │  AgentSidebar (抽屉)          │   │
│  │ Editor /     │  │  ┌─────────────────────────┐ │   │
│  │ ScriptWork-  │  │  │ MessageList             │ │   │
│  │ bench /      │  │  │  - Markdown + shiki     │ │   │
│  │ Settings     │  │  │  - Diff 可视化           │ │   │
│  │              │  │  │  - ToolCall 折叠卡片     │ │   │
│  │              │  │  │  - Thinking 折叠         │ │   │
│  │              │  │  │  - Permission 审批卡片   │ │   │
│  │              │  │  ├─────────────────────────┤ │   │
│  │              │  │  │ InputBar (提示输入)      │ │   │
│  │              │  │  ├─────────────────────────┤ │   │
│  │              │  │  │ StatusBar (连接/模式)    │ │   │
│  │              │  │  └─────────────────────────┘ │   │
│  └─────────────┘  └──────────────────────────────────┘   │
│                                                        │
│  Zustand Store: useAgentStore                          │
└────────────────────┬─────────────────────────────────┘
                     │ Electron IPC (preload bridge)
┌────────────────────┴─────────────────────────────────┐
│                    Main Process                        │
│                                                        │
│  ┌─────────────────────────────────────────────────┐ │
│  │              AcpClient (核心)                     │ │
│  │  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │ │
│  │  │ JsonRpc  │ │ Session  │ │ EventEmitter    │ │ │
│  │  │ Transport│ │ Manager  │ │ → IPC bridge    │ │ │
│  │  └──────────┘ └──────────┘ └─────────────────┘ │ │
│  │  ┌──────────────────┐ ┌──────────────────────┐ │ │
│  │  │ FileSystem       │ │ Terminal             │ │ │
│  │  │ Runtime          │ │ Runtime              │ │ │
│  │  │ (read/write)     │ │ (node-pty)           │ │ │
│  │  └──────────────────┘ └──────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────┐  │ │
│  │  │ Permission Handler                        │  │ │
│  │  │ (policy engine → auto/prompt/deny)        │  │ │
│  │  └──────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────┘ │
│                        │                               │
│              child_process.spawn                       │
│              stdin/stdout JSON-RPC                     │
│                        │                               │
│           ┌────────────┴────────────┐                 │
│           │ claude-agent-acp (npx)  │                 │
│           │ SACP 协议适配器          │                 │
│           └─────────────────────────┘                 │
└───────────────────────────────────────────────────────┘
```

### 模块划分

| 模块 | 位置 | 职责 |
|------|------|------|
| `AcpClient` | `electron/acp/client.ts` | JSON-RPC 传输层、消息路由、请求/响应匹配 |
| `SessionManager` | `electron/acp/session.ts` | 会话生命周期（new/load/disconnect）、项目绑定 |
| `FileSystemRuntime` | `electron/acp/fs-runtime.ts` | 响应 Agent 的文件读写请求 |
| `TerminalRuntime` | `electron/acp/terminal-runtime.ts` | 响应 Agent 的终端创建/执行请求（node-pty） |
| `PermissionHandler` | `electron/acp/permission.ts` | 权限策略引擎 + IPC 审批流 |
| `AgentIpc` | `electron/acp/ipc.ts` | Main-Renderer IPC 通道注册 |
| `AgentConfig` | `electron/acp/config.ts` | 全局配置读写、API Key 加密 |
| `BinaryManager` | `electron/acp/binary-manager.ts` | Agent 二进制安装/升级/缓存管理 |
| `Preflight` | `electron/acp/preflight.ts` | 环境预检系统 |
| `useAgentStore` | `src/store/agent.ts` | 前端状态管理 |
| `AgentSidebar` | `src/components/agent/` | 对话 UI 组件树 |
| `AgentSettings` | `src/components/settings/` | Agent SDK 管理界面 |

### 新增依赖

| 包 | 用途 |
|---|------|
| `node-pty` | 终端 PTY（Electron 原生模块） |
| `shiki` | 代码语法高亮 |
| `rehype-shiki` | Markdown 管线集成 shiki |
| `diff` | 生成 unified diff 用于文件变更可视化 |

## 3. ACP Client 协议层

### JSON-RPC Transport

协议核心是 JSON-RPC 2.0 over stdin/stdout，每条 JSON 消息以换行符 `\n` 分隔（NDJSON）。

```
Client→Agent: {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
Agent→Client: {"jsonrpc":"2.0","id":1,"result":{...}}
通知:         {"jsonrpc":"2.0","method":"session/event","params":{...}}
```

### 核心类设计

```typescript
// electron/acp/client.ts
class AcpClient extends EventEmitter {
  private process: ChildProcess
  private pendingRequests: Map<number, { resolve, reject, timeout }>
  private requestHandlers: Map<string, (params) => Promise<any>>
  private nextId: number

  // 生命周期
  spawn(agentCommand: string, args: string[], cwd: string): Promise<void>
  disconnect(): void

  // Client→Agent 请求
  sendRequest(method: string, params: object): Promise<any>
  sendNotification(method: string, params: object): void

  // 注册 Agent→Client 请求处理器（runtime handlers）
  onRequest(method: string, handler: (params) => Promise<any>): void
}
```

### 连接流程

```
1. spawn claude-agent-acp 子进程 (npx 或缓存路径)
   env: { PATH, HOME, ANTHROPIC_API_KEY, ... }

2. Client → Agent: initialize
   capabilities: {
     terminal: true,
     fs: { read_text_file: true, write_text_file: true }
   }

3. Agent → Client: initialize result
   返回 prompt capabilities, modes, config options

4. Client → Agent: session/new { cwd: projectDir }
   或 session/load { sessionId } 恢复已有会话

5. 进入对话循环:
   ├─ Client → Agent: prompt { blocks: [{ type:"text", text:"..." }] }
   ├─ Agent → Client: 流式通知 (content_delta, thinking, tool_call...)
   ├─ Agent → Client: 请求 (read_text_file, write_text_file, create_terminal...)
   │   └─ Client 处理后返回结果
   ├─ Agent → Client: permission_request
   │   └─ Client 按策略自动/提示用户 → 返回 permission_response
   └─ Agent → Client: turn_complete
```

### 进程管理

**二进制查找策略**（参考 codeg `binary_cache.rs`）：
1. 先检查全局缓存 `~/.lingji/acp-binaries/claude-acp/`
2. 缓存未命中 → `npx @agentclientprotocol/claude-agent-acp`
3. spawn 时注入环境变量（API Key、代理等来自 Settings）

**超时与重连**：
- `initialize` 超时 30s，失败则 kill 子进程并报错
- 子进程异常退出时 emit `disconnected` 事件，前端显示重连按钮
- 不自动重连（避免无限循环），由用户触发

**消息缓冲**：连接建立前的 prompt 命令进入缓冲队列，连接就绪后按序发送。

### 双向通信

**Client → Agent（命令）**：
- `prompt { blocks }` — 发送用户输入
- `setMode / setConfigOption` — 切换模式/配置
- `cancel` — 取消当前任务
- `respondPermission` — 回应权限请求

**Agent → Client（请求回调）**：
- `RequestPermissionRequest` — 请求用户批准
- `ReadTextFileRequest / WriteTextFileRequest` — 文件读写
- `CreateTerminalRequest / TerminalOutputRequest / KillTerminalRequest` — 终端操作

## 4. Runtime Handlers

### FileSystem Runtime

```typescript
// electron/acp/fs-runtime.ts

onRequest('read_text_file', async ({ path }) => {
  // 1. 安全校验：path resolve 后必须以 projectDir 开头
  // 2. 读取文件内容
  // 3. 返回 { content: string }
})

onRequest('write_text_file', async ({ path, content }) => {
  // 1. 安全校验
  // 2. 权限检查 → PermissionHandler.check('fs.write', path)
  // 3. 保存 before 快照（用于 diff）
  // 4. 写入文件
  // 5. 返回 { success: true }
})
```

**安全边界**：
- 所有路径 `path.resolve()` 后必须以 `projectDir` 开头（防路径穿越）
- 禁止操作 `.git/` 内部文件
- 写入操作经过 PermissionHandler 策略检查
- `read_text_file` 单文件上限 1MB，超出返回截断 + 警告
- `write_text_file` 单文件上限 5MB

### Terminal Runtime

```typescript
// electron/acp/terminal-runtime.ts

class TerminalRuntime {
  private terminals: Map<string, IPty>

  onRequest('create_terminal', async ({ cwd }) => {
    // 1. 权限检查
    // 2. node-pty.spawn(shell, [], { cwd, env })
    // 3. 注册 onData 回调 → 缓冲输出
    // 4. 返回 { terminalId }
  })

  onRequest('terminal_execute', async ({ terminalId, command }) => {
    // 1. 权限检查
    // 2. pty.write(command + '\n')
    // 3. 等待输出稳定 / 命令完成
    // 4. 返回 { output }
  })

  onRequest('kill_terminal', async ({ terminalId }) => {
    // pty.kill() + 从 map 移除
  })
}
```

**终端生命周期**：
- 会话断开时自动 kill 所有关联终端
- 单会话最多 5 个并发终端
- 终端输出缓冲区上限 1MB，超出截断旧内容
- 单命令 120s 超时

### Permission Handler

```typescript
// electron/acp/permission.ts

type PermissionPolicy = 'auto_approve' | 'tiered' | 'always_ask'

class PermissionHandler {
  async check(action: PermissionAction): Promise<'allow' | 'deny'> {
    if (policy === 'auto_approve') return 'allow'
    if (policy === 'tiered') {
      if (action.type === 'fs.read') return 'allow'
      return this.promptUser(action)  // 写文件/终端 → 提示用户
    }
    return this.promptUser(action)    // always_ask
  }
}
```

默认策略：`tiered`（分级信任）。通过 IPC 发送到 Renderer，在 AgentSidebar 中展示审批卡片。

## 5. Agent SDK 管理界面

对齐 codeg 双面板设计，在 Settings 中新增 "Agent" Tab。

### 布局

**左面板（240px）— Agent 列表**：
- 拖拽手柄（GripVertical，预留多 Agent 排序）
- Agent 品牌图标 + 名称
- 启用指示灯（绿点）
- 状态徽章（PASS / FAIL / WARN / CHECKING），色彩编码
- 刷新按钮，重新执行预检

**右面板（1fr）— 配置详情**：

Header 区：
- Agent 图标 + 名称 + 分发类型徽章（`npx`）+ 启用/禁用开关

预检状态区：
- 逐项检查结果（安装状态、Node 版本、API Key）
- 每项显示状态图标 + 描述 + 修复按钮（Install / Upgrade / 清除缓存）

认证配置区：
- 认证方式选择器：`官方订阅 (Max/Pro)` | `自定义 API`
- 自定义 API 模式：API Key 输入（带 Show/Hide）+ API Base URL + Model 下拉

高级配置区：
- 环境变量 textarea（KEY=VALUE 格式）
- JSON 配置 textarea

操作区：
- "保存配置" 按钮（带 saving 状态）
- "卸载" / "安装" / "升级" 按钮（根据安装状态切换）
- 卸载前弹出 AlertDialog 确认

### 预检系统

```typescript
// electron/acp/preflight.ts

async function runPreflight(): Promise<PreflightCheck[]> {
  return [
    await checkNodeInstalled(),
    await checkNpxAvailable(),
    await checkAgentInstalled(),
    await checkAgentVersion(),
    await checkApiKeyConfigured(),
  ]
}
```

### 安装/生命周期管理

```typescript
// electron/acp/binary-manager.ts

class BinaryManager {
  cachePath: string  // ~/.lingji/acp-binaries/claude-acp/{version}/

  async install(version: string): Promise<void>
  async upgrade(toVersion: string): Promise<void>
  async uninstall(): Promise<void>
  async getInstalledVersion(): Promise<string | null>
  async getLatestVersion(): Promise<string>  // npm view
}
```

### 配置持久化

```typescript
// 全局配置 ~/.lingji/agent-config.json
{
  "agents": {
    "claude-acp": {
      "enabled": true,
      "authMode": "custom_api",
      "apiKey": "<encrypted>",          // Electron safeStorage
      "apiBaseUrl": "https://api.anthropic.com",
      "model": "claude-sonnet-4-20250514",
      "envText": "",
      "configJson": "{}",
      "version": "0.25.0",
      "sortOrder": 0
    }
  },
  "permissionPolicy": "tiered"
}

// 项目级 {projectDir}/agent-session.json
{
  "sessionId": "sess_abc123",
  "lastConnected": "2026-04-07T10:30:00Z"
}
```

API Key 使用 `electron.safeStorage.encryptString()` 加密，利用操作系统原生密钥链。

## 6. 前端 UI

### Zustand Store

```typescript
// src/store/agent.ts

interface AgentState {
  status: 'disconnected' | 'connecting' | 'connected' | 'prompting'
  sessionId: string | null
  messages: AgentMessage[]
  modes: AgentMode[]
  currentMode: string
  configOptions: ConfigOption[]
  pendingPermission: PermissionRequest | null
  permissionPolicy: 'auto_approve' | 'tiered' | 'always_ask'

  connect(projectDir: string): Promise<void>
  disconnect(): void
  sendPrompt(text: string): void
  cancelTurn(): void
  setMode(modeId: string): void
  respondPermission(requestId: string, allow: boolean): void
}

type AgentMessage =
  | { role: 'user', content: string }
  | { role: 'assistant', blocks: ContentBlock[] }

type ContentBlock =
  | { type: 'text', text: string }
  | { type: 'thinking', text: string, collapsed: boolean }
  | { type: 'tool_call', tool: string, input: any, output: any, status: 'running' | 'done' }
  | { type: 'permission', request: PermissionRequest, response?: 'allow' | 'deny' }
```

### 组件树

```
AgentSidebar (右侧抽屉，420px 默认宽度，可拖拽 320-600px)
├── AgentHeader
│   ├── 连接状态指示灯
│   ├── 模式选择器 (code / ask / architect)
│   ├── Model 选择器
│   └── 关闭按钮
├── MessageList (虚拟滚动)
│   ├── UserMessage
│   └── AssistantMessage
│       ├── TextBlock — Markdown (remark + rehype + shiki)
│       ├── ThinkingBlock — 折叠面板，灰色斜体
│       ├── ToolCallBlock — 可展开卡片
│       └── PermissionBlock — 审批卡片 (Allow / Deny)
├── InputBar
│   ├── 多行文本框 (Shift+Enter 换行, Enter 发送)
│   ├── 发送/Cancel 按钮
│   └── 附件按钮 (预留)
└── StatusBar
    ├── 连接状态文本
    └── 重连按钮
```

**交互**：
- Toolbar 新增 Agent 图标按钮
- Framer Motion 滑入/滑出动画
- 快捷键 `Cmd+Shift+A` 切换

### IPC 通道

```typescript
// preload.ts 新增 agentAPI
agentAPI: {
  connect(projectDir: string): Promise<void>
  disconnect(): void
  sendPrompt(text: string): void
  cancelTurn(): void
  setMode(modeId: string): void
  setConfigOption(configId: string, valueId: string): void
  respondPermission(requestId: string, optionId: string): void
  getPermissionPolicy(): Promise<string>
  setPermissionPolicy(policy: string): Promise<void>

  // Main → Renderer 事件
  onStatusChanged(cb): () => void
  onMessage(cb): () => void
  onPermissionRequest(cb): () => void
  onCapabilities(cb): () => void
}
```

## 7. 消息渲染系统

### Markdown 渲染管线

```
Markdown → remark-parse → remark-gfm → rehype → rehype-shiki → React
```

代码块：语言标签 + 行号 + 一键复制 + shiki 主题跟随应用主题。

### ToolCallBlock 渲染

按工具类型分发：

| 工具 | Input 展示 | Output 展示 |
|------|-----------|-------------|
| `read_text_file` | 文件路径 | 文件内容 + 行号 + shiki 高亮 |
| `write_text_file` | 文件路径 | Unified diff（绿增红删 + 行号双列） |
| `create_terminal` | cwd | 终端 ID |
| `terminal_execute` | 命令（代码块样式） | 终端输出（等宽深色背景） |
| `kill_terminal` | 终端 ID | 状态 |

### Diff 渲染

使用 `diff` 库生成 unified diff，自定义 React 组件渲染：
- 文件路径标题栏
- 行号双列（旧 | 新）
- 删除行红色背景，新增行绿色背景
- hunk header 蓝色

FileSystemRuntime 在写入前自动保存 before 快照，写入后将 `{ before, after, path }` 传给 Renderer。

### ThinkingBlock

- 默认折叠，仅显示 "Thinking..." + 时长
- 流式输出时自动展开，turn_complete 后自动折叠
- 灰色斜体，与正式输出视觉区分

### 流式渲染策略

- content_delta 增量追加到当前 TextBlock
- Markdown 渲染 debounce 50ms
- 代码块在闭合后一次性触发 shiki 高亮
- MessageList 自动滚动到底部，用户手动上滚时暂停

## 8. 错误处理与边界情况

### 错误分类

| 场景 | 处理 | 用户感知 |
|------|------|---------|
| npx/node 未安装 | 预检 FAIL | 红色徽章 + 修复指引 |
| claude-agent-acp 未安装 | 预检 FAIL | 一键安装按钮 |
| API Key 无效 | Agent 返回认证错误 | 消息流错误卡片 + "检查设置" |
| Agent 子进程崩溃 | emit disconnected | StatusBar 变灰 + 重连按钮 |
| JSON-RPC 超时 | 30s reject | ToolCallBlock 显示超时 |
| 路径穿越 | fs-runtime 拦截 | "路径越界，已拒绝" |
| 终端命令挂起 | 120s 超时 kill | 超时警告 |

### 边界情况

- **并发安全**：同时只允许一个活跃 prompt
- **会话恢复**：打开项目尝试 `session/load`，失败则静默新建
- **消息不持久化**：刷新清空，第二期实现持久化

## 9. 测试策略

### 单元测试（Vitest）

| 模块 | 重点 |
|------|------|
| `AcpClient` | JSON-RPC 编解码、请求/响应匹配、超时 |
| `FileSystemRuntime` | 路径安全校验、读写正常流程 |
| `PermissionHandler` | 三种策略判定逻辑 |
| `AgentConfig` | 配置读写、加密 round-trip |
| `BinaryManager` | 版本检测、缓存路径 |
| `useAgentStore` | 状态流转、消息累积 |

### 集成测试

使用 Mock 子进程模拟 SACP 协议响应，验证完整流程：connect → initialize → prompt → stream events → turn_complete。

### 不做

- 不测 shiki/remark 渲染（第三方库自有测试）
- 不做 E2E（第一期手动验收）

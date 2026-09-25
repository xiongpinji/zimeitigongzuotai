# AI Agent ACP 集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在灵机剪影 Electron 应用中集成 Claude Code Agent，通过纯 Node.js ACP 客户端与 `@agentclientprotocol/claude-agent-acp` 通信，提供完整的对话式 AI 交互能力。

**Architecture:** Electron main process 中实现 JSON-RPC over stdin/stdout 的 ACP 客户端，spawn claude-agent-acp 子进程并注册文件系统/终端/权限 runtime handlers。前端通过 Zustand store + IPC bridge 驱动右侧抽屉对话 UI，渲染 Markdown + shiki 高亮 + diff 可视化。

**Tech Stack:** Electron 41, React 19, Zustand, TypeScript, node-pty, shiki, diff, remark/rehype

---

## File Structure

### 新增文件

```
electron/acp/
├── types.ts              — ACP 协议类型定义（JSON-RPC、消息格式、事件）
├── client.ts             — JSON-RPC 传输层，消息路由，请求/响应匹配
├── session.ts            — 会话生命周期（initialize, new, load, disconnect）
├── fs-runtime.ts         — 文件系统 runtime handler（读写 + 安全校验）
├── terminal-runtime.ts   — 终端 runtime handler（node-pty）
├── permission.ts         — 权限策略引擎（auto/tiered/always_ask）
├── config.ts             — 全局配置读写 + API Key 加密（safeStorage）
├── binary-manager.ts     — Agent 二进制安装/升级/缓存
├── preflight.ts          — 环境预检（node、npx、agent、api key）
└── ipc.ts                — Main→Renderer IPC 通道注册

src/
├── lib/agent-api.ts      — AgentAPI 类型定义（window.agentAPI）
├── store/agent.ts        — Zustand store（连接、消息、权限、配置）
└── components/
    ├── agent/
    │   ├── AgentSidebar.tsx           — 抽屉容器（Framer Motion 滑入/滑出）
    │   ├── AgentSidebar.module.css    — 抽屉样式
    │   ├── AgentHeader.tsx            — 连接状态 + 模式/模型选择器
    │   ├── MessageList.tsx            — 消息列表（自动滚动）
    │   ├── UserMessage.tsx            — 用户消息气泡
    │   ├── AssistantMessage.tsx       — 助手消息（分发 block 类型）
    │   ├── TextBlock.tsx              — Markdown 渲染（remark + shiki）
    │   ├── ThinkingBlock.tsx          — Thinking 折叠面板
    │   ├── ToolCallBlock.tsx          — 工具调用卡片（可展开）
    │   ├── PermissionBlock.tsx        — 权限审批卡片
    │   ├── DiffView.tsx              — Unified diff 渲染
    │   ├── ErrorBlock.tsx            — 错误提示卡片
    │   ├── InputBar.tsx              — 提示输入框
    │   └── StatusBar.tsx             — 连接状态栏
    └── settings/
        └── AgentSettingsTab.tsx       — Agent SDK 管理双面板

tests/
├── acp-client.test.ts         — AcpClient JSON-RPC 编解码、超时
├── acp-fs-runtime.test.ts     — 路径安全校验、读写流程
├── acp-permission.test.ts     — 三种策略判定逻辑
├── acp-config.test.ts         — 配置读写
├── acp-preflight.test.ts      — 预检逻辑
├── agent-store.test.ts        — 状态流转、消息累积
```

### 修改文件

```
package.json                    — 新增依赖 node-pty, shiki, @shikijs/rehype, diff
electron/preload.ts             — 新增 agentAPI 暴露
electron/main.ts                — 引入 acp/ipc.ts 注册 handlers
src/lib/electron-api.ts         — 新增 AgentAPI 接口 + window 声明
src/App.tsx                     — 集成 AgentSidebar 抽屉
src/components/Toolbar.tsx      — 新增 Agent 按钮
src/pages/Settings.tsx          — 新增 Agent Tab
src/pages/Settings.module.css   — （样式可能微调，content 区 max-width 适配双面板）
```

---

## Task 1: 安装依赖 & ACP 协议类型

**Files:**
- Modify: `package.json`
- Create: `electron/acp/types.ts`
- Test: `tests/acp-types.test.ts`

- [ ] **Step 1: 安装新依赖**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npm install node-pty shiki @shikijs/rehype diff
npm install -D @types/diff
```

> 注意：`node-pty` 是 Electron 原生模块，可能需要 `electron-rebuild`。如果安装失败，尝试：
> ```bash
> npx electron-rebuild -f -w node-pty
> ```

- [ ] **Step 2: 创建 ACP 协议类型文件**

```typescript
// electron/acp/types.ts

// ─── JSON-RPC 2.0 基础 ───────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ─── ACP 协议消息 ────────────────────────────────────────────

// Client → Agent

export interface InitializeParams {
  protocolVersion: string;
  clientCapabilities: {
    terminal: boolean;
    fs: {
      readTextFile: boolean;
      writeTextFile: boolean;
    };
  };
}

export interface InitializeResult {
  protocolVersion: string;
  serverCapabilities: {
    prompting?: {
      modes?: AgentMode[];
      configOptions?: ConfigOption[];
    };
    fork?: boolean;
  };
}

export interface AgentMode {
  modeId: string;
  name: string;
  description?: string;
}

export interface ConfigOption {
  configId: string;
  name: string;
  description?: string;
  values: ConfigOptionValue[];
}

export interface ConfigOptionValue {
  valueId: string;
  name: string;
}

export interface NewSessionParams {
  cwd: string;
}

export interface NewSessionResult {
  sessionId: string;
  configOptions?: ConfigOption[];
}

export interface LoadSessionParams {
  sessionId: string;
  cwd: string;
}

export interface PromptParams {
  sessionId: string;
  contents: PromptInputBlock[];
}

export interface SetSessionModeParams {
  sessionId: string;
  modeId: string;
}

export interface SetSessionConfigOptionParams {
  sessionId: string;
  configId: string;
  valueId: string;
}

// Agent → Client (请求)

export interface RequestPermissionParams {
  toolCall: unknown;
  options: PermissionOption[];
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export interface ReadTextFileParams {
  path: string;
}

export interface WriteTextFileParams {
  path: string;
  content: string;
}

export interface CreateTerminalParams {
  cwd?: string;
}

export interface TerminalExecuteParams {
  terminalId: string;
  command: string;
}

export interface KillTerminalParams {
  terminalId: string;
}

// ─── 流式事件（Agent → Client 通知）──────────────────────────

export type AcpEvent =
  | ContentDeltaEvent
  | ThinkingEvent
  | ToolCallEvent
  | ToolCallUpdateEvent
  | TurnCompleteEvent
  | PermissionRequestEvent;

export interface ContentDeltaEvent {
  type: 'content_delta';
  text: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  text: string;
}

export interface ToolCallEvent {
  type: 'tool_call';
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  content?: string;
  rawInput?: string;
  rawOutput?: string;
}

export interface ToolCallUpdateEvent {
  type: 'tool_call_update';
  toolCallId: string;
  title?: string;
  status?: string;
  content?: string;
  rawInput?: string;
  rawOutput?: string;
  rawOutputAppend?: boolean;
}

export interface TurnCompleteEvent {
  type: 'turn_complete';
  sessionId: string;
  stopReason: string;
  agentType: string;
}

export interface PermissionRequestEvent {
  type: 'permission_request';
  requestId: string;
  toolCall: unknown;
  options: PermissionOption[];
}

// ─── Prompt 输入 ─────────────────────────────────────────────

export type PromptInputBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; uri?: string }
  | { type: 'resource'; uri: string; mimeType?: string; text?: string; blob?: string };

// ─── 连接状态 ────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'prompting';

// ─── 配置 ────────────────────────────────────────────────────

export type PermissionPolicy = 'auto_approve' | 'tiered' | 'always_ask';
export type AuthMode = 'subscription' | 'custom_api';

export interface AgentConfigData {
  agents: Record<string, AgentEntry>;
  permissionPolicy: PermissionPolicy;
}

export interface AgentEntry {
  enabled: boolean;
  authMode: AuthMode;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  envText: string;
  configJson: string;
  version: string;
  sortOrder: number;
}

// ─── 预检 ────────────────────────────────────────────────────

export type PreflightStatus = 'pass' | 'fail' | 'warn' | 'checking';
export type PreflightFixAction = 'install' | 'upgrade' | 'uninstall' | 'clear_cache';

export interface PreflightCheck {
  label: string;
  status: PreflightStatus;
  message: string;
  fixAction?: PreflightFixAction;
}

// ─── 工具函数 ────────────────────────────────────────────────

export function isJsonRpcResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && ('result' in msg || 'error' in msg) && !('method' in msg);
}

export function isJsonRpcRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'id' in msg && 'method' in msg && !('result' in msg) && !('error' in msg);
}

export function isJsonRpcNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}
```

- [ ] **Step 3: 写类型判别测试**

```typescript
// tests/acp-types.test.ts
import { describe, expect, it } from 'vitest';
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcNotification,
  type JsonRpcMessage,
} from '../electron/acp/types';

describe('JSON-RPC message type guards', () => {
  it('identifies a request', () => {
    const msg: JsonRpcMessage = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    expect(isJsonRpcRequest(msg)).toBe(true);
    expect(isJsonRpcResponse(msg)).toBe(false);
    expect(isJsonRpcNotification(msg)).toBe(false);
  });

  it('identifies a response with result', () => {
    const msg: JsonRpcMessage = { jsonrpc: '2.0', id: 1, result: { ok: true } };
    expect(isJsonRpcResponse(msg)).toBe(true);
    expect(isJsonRpcRequest(msg)).toBe(false);
  });

  it('identifies a response with error', () => {
    const msg: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid Request' },
    };
    expect(isJsonRpcResponse(msg)).toBe(true);
  });

  it('identifies a notification', () => {
    const msg: JsonRpcMessage = { jsonrpc: '2.0', method: 'session/event', params: {} };
    expect(isJsonRpcNotification(msg)).toBe(true);
    expect(isJsonRpcRequest(msg)).toBe(false);
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/acp-types.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/acp/types.ts tests/acp-types.test.ts package.json package-lock.json
git commit -m "feat(agent): ACP 协议类型定义与新增依赖"
```

---

## Task 2: AgentConfig — 配置持久化与加密

**Files:**
- Create: `electron/acp/config.ts`
- Test: `tests/acp-config.test.ts`

- [ ] **Step 1: 写 AgentConfig 测试**

```typescript
// tests/acp-config.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Mock electron safeStorage — 测试环境中用 base64 替代真实加密
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
    expect(data.agents).toEqual({});
  });

  it('saves and loads agent config', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    await config.save({
      permissionPolicy: 'always_ask',
      agents: {
        'claude-acp': {
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
    expect(loaded.agents['claude-acp'].model).toBe('claude-sonnet-4-20250514');
  });

  it('encrypts and decrypts API key', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    await config.setApiKey('claude-acp', 'sk-ant-test-key-123');
    const key = await config.getApiKey('claude-acp');
    expect(key).toBe('sk-ant-test-key-123');
  });

  it('saves project session', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });

    await config.saveSession(projectDir, {
      sessionId: 'sess_abc',
      lastConnected: new Date().toISOString(),
    });

    const session = await config.loadSession(projectDir);
    expect(session?.sessionId).toBe('sess_abc');
  });

  it('returns null session for non-existent project', async () => {
    const { AgentConfig } = await import('../electron/acp/config');
    const config = new AgentConfig(path.join(tmpDir, 'agent-config.json'));
    const session = await config.loadSession('/non/existent');
    expect(session).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/acp-config.test.ts
```

Expected: FAIL — `../electron/acp/config` 不存在

- [ ] **Step 3: 实现 AgentConfig**

```typescript
// electron/acp/config.ts
import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentConfigData, AgentEntry, PermissionPolicy } from './types';

const DEFAULT_CONFIG: AgentConfigData = {
  agents: {},
  permissionPolicy: 'tiered',
};

export interface SessionData {
  sessionId: string;
  lastConnected: string;
}

export class AgentConfig {
  constructor(private configPath: string) {}

  async load(): Promise<AgentConfigData> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AgentConfigData>;
      return {
        permissionPolicy: parsed.permissionPolicy ?? DEFAULT_CONFIG.permissionPolicy,
        agents: parsed.agents ?? {},
      };
    } catch {
      return { ...DEFAULT_CONFIG, agents: {} };
    }
  }

  async save(data: AgentConfigData): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getApiKey(agentId: string): Promise<string> {
    try {
      const keyPath = this.encryptedKeyPath(agentId);
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
    const keyPath = this.encryptedKeyPath(agentId);
    await fs.mkdir(path.dirname(keyPath), { recursive: true });
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key);
      await fs.writeFile(keyPath, encrypted);
    } else {
      await fs.writeFile(keyPath, key, 'utf-8');
    }
  }

  async loadSession(projectDir: string): Promise<SessionData | null> {
    try {
      const raw = await fs.readFile(path.join(projectDir, 'agent-session.json'), 'utf-8');
      return JSON.parse(raw) as SessionData;
    } catch {
      return null;
    }
  }

  async saveSession(projectDir: string, data: SessionData): Promise<void> {
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'agent-session.json'),
      JSON.stringify(data, null, 2),
      'utf-8',
    );
  }

  private encryptedKeyPath(agentId: string): string {
    return path.join(path.dirname(this.configPath), `${agentId}.key`);
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/acp-config.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/acp/config.ts tests/acp-config.test.ts
git commit -m "feat(agent): AgentConfig 配置持久化与 API Key 加密"
```

---

## Task 3: AcpClient — JSON-RPC 传输核心

**Files:**
- Create: `electron/acp/client.ts`
- Test: `tests/acp-client.test.ts`

- [ ] **Step 1: 写 AcpClient 测试**

```typescript
// tests/acp-client.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ChildProcess, fork } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { AcpClient } from '../electron/acp/client';

// 创建一个 mock agent 脚本用于测试
let mockScriptPath: string;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-client-test-'));
  mockScriptPath = path.join(tmpDir, 'mock-agent.cjs');
  // Mock agent: 读 stdin NDJSON，回 JSON-RPC 响应
  await fs.writeFile(
    mockScriptPath,
    `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: 'latest',
          serverCapabilities: {
            prompting: { modes: [{ modeId: 'code', name: 'Code' }], configOptions: [] },
          },
        },
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    } else if (msg.method === 'session/new') {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'test-session' } }) + '\\n',
      );
    } else if (msg.method === 'prompt') {
      // 发送流式事件通知
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'session/event', params: { type: 'content_delta', text: 'Hello' } }) + '\\n',
      );
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'session/event', params: { type: 'turn_complete', sessionId: 'test-session', stopReason: 'end', agentType: 'claude' } }) + '\\n',
      );
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }) + '\\n',
      );
    } else if (msg.method === 'echo_request') {
      // Agent→Client 请求模拟：发一个 JSON-RPC request 到 client
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: 9999, method: 'read_text_file', params: { path: '/test.txt' } }) + '\\n',
      );
    } else {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\\n',
      );
    }
  } catch {}
});
`,
    'utf-8',
  );
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('AcpClient', () => {
  it('sends a request and receives a response', async () => {
    const client = new AcpClient();
    await client.spawn('node', [mockScriptPath], tmpDir);

    const result = await client.sendRequest('initialize', {
      protocolVersion: 'latest',
      clientCapabilities: { terminal: true, fs: { readTextFile: true, writeTextFile: true } },
    });

    expect(result).toHaveProperty('protocolVersion', 'latest');
    expect(result).toHaveProperty('serverCapabilities');
    client.disconnect();
  });

  it('receives notifications as events', async () => {
    const client = new AcpClient();
    await client.spawn('node', [mockScriptPath], tmpDir);

    // 先 initialize
    await client.sendRequest('initialize', {
      protocolVersion: 'latest',
      clientCapabilities: { terminal: true, fs: { readTextFile: true, writeTextFile: true } },
    });

    const events: unknown[] = [];
    client.on('notification', (method: string, params: unknown) => {
      events.push({ method, params });
    });

    // prompt 触发 mock agent 发送 content_delta + turn_complete 通知
    await client.sendRequest('prompt', {
      sessionId: 'test-session',
      contents: [{ type: 'text', text: 'hi' }],
    });

    // 给一点时间让通知到达
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toHaveProperty('method', 'session/event');
    client.disconnect();
  });

  it('handles request handlers (Agent→Client)', async () => {
    const client = new AcpClient();
    await client.spawn('node', [mockScriptPath], tmpDir);

    // 注册一个 read_text_file handler
    client.onRequest('read_text_file', async (params: { path: string }) => {
      return { content: `content of ${params.path}` };
    });

    // 触发 mock agent 发送 read_text_file 请求
    await client.sendRequest('echo_request', {});
    await new Promise((resolve) => setTimeout(resolve, 100));

    client.disconnect();
    // 如果没有抛异常，说明 handler 正确处理了请求
  });

  it('rejects on timeout', async () => {
    const client = new AcpClient({ requestTimeout: 100 });
    // 创建一个不响应的 mock
    const silentScript = path.join(tmpDir, 'silent.cjs');
    await fs.writeFile(silentScript, 'process.stdin.resume();', 'utf-8');
    await client.spawn('node', [silentScript], tmpDir);

    await expect(client.sendRequest('initialize', {})).rejects.toThrow(/timeout/i);
    client.disconnect();
  });

  it('emits disconnected on process exit', async () => {
    const client = new AcpClient();
    // 创建一个立即退出的 mock
    const exitScript = path.join(tmpDir, 'exit.cjs');
    await fs.writeFile(exitScript, 'process.exit(1);', 'utf-8');

    let disconnected = false;
    client.on('disconnected', () => { disconnected = true; });

    await client.spawn('node', [exitScript], tmpDir);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(disconnected).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/acp-client.test.ts
```

Expected: FAIL — `../electron/acp/client` 不存在

- [ ] **Step 3: 实现 AcpClient**

```typescript
// electron/acp/client.ts
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { JsonRpcMessage, JsonRpcRequest, JsonRpcResponse } from './types';
import { isJsonRpcNotification, isJsonRpcRequest, isJsonRpcResponse } from './types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface AcpClientOptions {
  requestTimeout?: number;
}

export class AcpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private requestHandlers = new Map<string, (params: unknown) => Promise<unknown>>();
  private nextId = 1;
  private requestTimeout: number;

  constructor(options: AcpClientOptions = {}) {
    super();
    this.requestTimeout = options.requestTimeout ?? 30_000;
  }

  async spawn(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process = child;

      child.on('error', (err) => {
        this.emit('disconnected', err);
        reject(err);
      });

      child.on('exit', (code, signal) => {
        this.rejectAllPending(new Error(`Agent process exited (code=${code}, signal=${signal})`));
        this.emit('disconnected', { code, signal });
      });

      if (!child.stdout || !child.stdin) {
        reject(new Error('Failed to create stdio pipes'));
        return;
      }

      this.readline = createInterface({ input: child.stdout });
      this.readline.on('line', (line) => this.handleLine(line));

      child.stderr?.on('data', (data: Buffer) => {
        this.emit('stderr', data.toString());
      });

      // spawn 成功即 resolve，不等 initialize
      // 给子进程一点启动时间
      const onSpawn = () => {
        child.removeListener('error', onError);
        resolve();
      };
      const onError = (err: Error) => {
        child.removeListener('spawn', onSpawn);
        reject(err);
      };

      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    this.rejectAllPending(new Error('Client disconnected'));
  }

  async sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('Not connected'));
        return;
      }

      const id = this.nextId++;
      const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method} (id=${id})`));
      }, this.requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify(message) + '\n');
    });
  }

  sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin?.writable) return;
    const message = { jsonrpc: '2.0', method, params };
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  onRequest(method: string, handler: (params: unknown) => Promise<unknown>): void {
    this.requestHandlers.set(method, handler);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emit('parse_error', line);
      return;
    }

    if (isJsonRpcResponse(msg)) {
      this.handleResponse(msg);
    } else if (isJsonRpcRequest(msg)) {
      void this.handleIncomingRequest(msg);
    } else if (isJsonRpcNotification(msg)) {
      this.emit('notification', msg.method, msg.params);
    }
  }

  private handleResponse(msg: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    this.pendingRequests.delete(msg.id);
    clearTimeout(pending.timer);

    if (msg.error) {
      pending.reject(new Error(`JSON-RPC error: ${msg.error.message} (code=${msg.error.code})`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private async handleIncomingRequest(msg: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(msg.method);

    if (!handler) {
      this.sendResponse(msg.id, undefined, {
        code: -32601,
        message: `Method not found: ${msg.method}`,
      });
      return;
    }

    try {
      const result = await handler(msg.params);
      this.sendResponse(msg.id, result);
    } catch (err) {
      this.sendResponse(msg.id, undefined, {
        code: -32603,
        message: err instanceof Error ? err.message : 'Internal error',
      });
    }
  }

  private sendResponse(id: number, result?: unknown, error?: { code: number; message: string }): void {
    if (!this.process?.stdin?.writable) return;
    const response: JsonRpcResponse = { jsonrpc: '2.0', id, ...(error ? { error } : { result }) };
    this.process.stdin.write(JSON.stringify(response) + '\n');
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/acp-client.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/acp/client.ts tests/acp-client.test.ts
git commit -m "feat(agent): AcpClient JSON-RPC 传输核心"
```

---

## Task 4: FileSystemRuntime — 文件读写 + 安全校验

**Files:**
- Create: `electron/acp/fs-runtime.ts`
- Test: `tests/acp-fs-runtime.test.ts`

- [ ] **Step 1: 写 FileSystemRuntime 测试**

```typescript
// tests/acp-fs-runtime.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileSystemRuntime } from '../electron/acp/fs-runtime';

let tmpDir: string;
let runtime: FileSystemRuntime;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-runtime-test-'));
  runtime = new FileSystemRuntime(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('FileSystemRuntime', () => {
  describe('readTextFile', () => {
    it('reads a file within project dir', async () => {
      await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello world', 'utf-8');
      const result = await runtime.readTextFile({ path: path.join(tmpDir, 'test.txt') });
      expect(result.content).toBe('hello world');
    });

    it('rejects paths outside project dir', async () => {
      await expect(runtime.readTextFile({ path: '/etc/passwd' })).rejects.toThrow(/outside project/i);
    });

    it('rejects paths with traversal', async () => {
      await expect(
        runtime.readTextFile({ path: path.join(tmpDir, '..', '..', 'etc', 'passwd') }),
      ).rejects.toThrow(/outside project/i);
    });

    it('rejects .git internal files', async () => {
      await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, '.git', 'config'), 'secret', 'utf-8');
      await expect(
        runtime.readTextFile({ path: path.join(tmpDir, '.git', 'config') }),
      ).rejects.toThrow(/\.git/);
    });
  });

  describe('writeTextFile', () => {
    it('writes a file within project dir', async () => {
      const result = await runtime.writeTextFile({
        path: path.join(tmpDir, 'output.txt'),
        content: 'new content',
      });
      expect(result.success).toBe(true);

      const written = await fs.readFile(path.join(tmpDir, 'output.txt'), 'utf-8');
      expect(written).toBe('new content');
    });

    it('captures before snapshot for diff', async () => {
      await fs.writeFile(path.join(tmpDir, 'existing.txt'), 'old content', 'utf-8');
      const result = await runtime.writeTextFile({
        path: path.join(tmpDir, 'existing.txt'),
        content: 'new content',
      });
      expect(result.success).toBe(true);
      expect(result.before).toBe('old content');
      expect(result.after).toBe('new content');
    });

    it('returns null before for new files', async () => {
      const result = await runtime.writeTextFile({
        path: path.join(tmpDir, 'brand-new.txt'),
        content: 'fresh',
      });
      expect(result.before).toBeNull();
    });

    it('rejects paths outside project dir', async () => {
      await expect(
        runtime.writeTextFile({ path: '/tmp/evil.txt', content: 'hack' }),
      ).rejects.toThrow(/outside project/i);
    });

    it('creates parent directories', async () => {
      const filePath = path.join(tmpDir, 'sub', 'dir', 'file.txt');
      await runtime.writeTextFile({ path: filePath, content: 'nested' });
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('nested');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/acp-fs-runtime.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 FileSystemRuntime**

```typescript
// electron/acp/fs-runtime.ts
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_READ_SIZE = 1024 * 1024; // 1MB
const MAX_WRITE_SIZE = 5 * 1024 * 1024; // 5MB

export interface WriteResult {
  success: boolean;
  before: string | null;
  after: string;
  filePath: string;
}

export class FileSystemRuntime {
  constructor(private projectDir: string) {}

  async readTextFile(params: { path: string }): Promise<{ content: string }> {
    const resolved = this.validatePath(params.path);
    const stat = await fs.stat(resolved);

    if (stat.size > MAX_READ_SIZE) {
      const content = await this.readPartial(resolved, MAX_READ_SIZE);
      return { content: content + '\n\n[文件已截断，超出 1MB 上限]' };
    }

    const content = await fs.readFile(resolved, 'utf-8');
    return { content };
  }

  async writeTextFile(params: { path: string; content: string }): Promise<WriteResult> {
    const resolved = this.validatePath(params.path);

    if (Buffer.byteLength(params.content, 'utf-8') > MAX_WRITE_SIZE) {
      throw new Error('Write content exceeds 5MB limit');
    }

    // 保存 before 快照
    let before: string | null = null;
    try {
      before = await fs.readFile(resolved, 'utf-8');
    } catch {
      // 文件不存在，before 为 null
    }

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, params.content, 'utf-8');

    return {
      success: true,
      before,
      after: params.content,
      filePath: resolved,
    };
  }

  private validatePath(filePath: string): string {
    const resolved = path.resolve(this.projectDir, filePath);

    // 检查路径穿越
    if (!resolved.startsWith(this.projectDir + path.sep) && resolved !== this.projectDir) {
      throw new Error(`Path outside project directory: ${filePath}`);
    }

    // 禁止访问 .git 内部
    const relative = path.relative(this.projectDir, resolved);
    const segments = relative.split(path.sep);
    if (segments[0] === '.git') {
      throw new Error('Access to .git directory is forbidden');
    }

    return resolved;
  }

  private async readPartial(filePath: string, maxBytes: number): Promise<string> {
    const fh = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await fh.close();
    }
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/acp-fs-runtime.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/acp/fs-runtime.ts tests/acp-fs-runtime.test.ts
git commit -m "feat(agent): FileSystemRuntime 文件读写与安全校验"
```

---

## Task 5: PermissionHandler — 权限策略引擎

**Files:**
- Create: `electron/acp/permission.ts`
- Test: `tests/acp-permission.test.ts`

- [ ] **Step 1: 写 PermissionHandler 测试**

```typescript
// tests/acp-permission.test.ts
import { describe, expect, it } from 'vitest';
import { PermissionHandler, type PermissionAction } from '../electron/acp/permission';

describe('PermissionHandler', () => {
  describe('auto_approve policy', () => {
    it('approves everything', async () => {
      const handler = new PermissionHandler('auto_approve');
      expect(await handler.check({ type: 'fs.read', path: '/a' })).toBe('allow');
      expect(await handler.check({ type: 'fs.write', path: '/a' })).toBe('allow');
      expect(await handler.check({ type: 'terminal.execute', command: 'rm -rf /' })).toBe('allow');
    });
  });

  describe('tiered policy', () => {
    it('auto-approves reads', async () => {
      const handler = new PermissionHandler('tiered');
      expect(await handler.check({ type: 'fs.read', path: '/a' })).toBe('allow');
    });

    it('prompts for writes', async () => {
      const handler = new PermissionHandler('tiered');
      // 没有设置 promptUser 回调时默认 deny
      expect(await handler.check({ type: 'fs.write', path: '/a' })).toBe('deny');
    });

    it('prompts for terminal', async () => {
      const handler = new PermissionHandler('tiered');
      expect(await handler.check({ type: 'terminal.execute', command: 'ls' })).toBe('deny');
    });

    it('uses promptUser callback when set', async () => {
      const handler = new PermissionHandler('tiered');
      handler.setPromptCallback(async () => 'allow');
      expect(await handler.check({ type: 'fs.write', path: '/a' })).toBe('allow');
    });
  });

  describe('always_ask policy', () => {
    it('prompts for everything including reads', async () => {
      const handler = new PermissionHandler('always_ask');
      expect(await handler.check({ type: 'fs.read', path: '/a' })).toBe('deny');
    });

    it('uses callback when set', async () => {
      const handler = new PermissionHandler('always_ask');
      handler.setPromptCallback(async () => 'allow');
      expect(await handler.check({ type: 'fs.read', path: '/a' })).toBe('allow');
    });
  });

  it('updates policy dynamically', async () => {
    const handler = new PermissionHandler('always_ask');
    expect(await handler.check({ type: 'fs.read', path: '/a' })).toBe('deny');
    handler.setPolicy('auto_approve');
    expect(await handler.check({ type: 'fs.read', path: '/a' })).toBe('allow');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/acp-permission.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 PermissionHandler**

```typescript
// electron/acp/permission.ts
import type { PermissionPolicy } from './types';

export type PermissionAction =
  | { type: 'fs.read'; path: string }
  | { type: 'fs.write'; path: string }
  | { type: 'terminal.execute'; command: string }
  | { type: 'terminal.create'; cwd?: string };

export type PermissionResult = 'allow' | 'deny';

type PromptCallback = (action: PermissionAction) => Promise<PermissionResult>;

export class PermissionHandler {
  private policy: PermissionPolicy;
  private promptCallback: PromptCallback | null = null;

  constructor(policy: PermissionPolicy) {
    this.policy = policy;
  }

  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy;
  }

  getPolicy(): PermissionPolicy {
    return this.policy;
  }

  setPromptCallback(cb: PromptCallback): void {
    this.promptCallback = cb;
  }

  async check(action: PermissionAction): Promise<PermissionResult> {
    if (this.policy === 'auto_approve') {
      return 'allow';
    }

    if (this.policy === 'tiered') {
      if (action.type === 'fs.read') {
        return 'allow';
      }
      return this.promptUser(action);
    }

    // always_ask
    return this.promptUser(action);
  }

  private async promptUser(action: PermissionAction): Promise<PermissionResult> {
    if (!this.promptCallback) {
      return 'deny';
    }
    return this.promptCallback(action);
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/acp-permission.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/acp/permission.ts tests/acp-permission.test.ts
git commit -m "feat(agent): PermissionHandler 三级权限策略引擎"
```

---

## Task 6: TerminalRuntime — PTY 终端管理

**Files:**
- Create: `electron/acp/terminal-runtime.ts`
- Test: `tests/acp-terminal-runtime.test.ts`

- [ ] **Step 1: 写 TerminalRuntime 测试**

```typescript
// tests/acp-terminal-runtime.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TerminalRuntime } from '../electron/acp/terminal-runtime';

let tmpDir: string;
let runtime: TerminalRuntime;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-runtime-test-'));
  runtime = new TerminalRuntime(5, 1024 * 1024);
});

afterEach(async () => {
  runtime.killAll();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('TerminalRuntime', () => {
  it('creates a terminal and returns an id', async () => {
    const result = await runtime.createTerminal({ cwd: tmpDir });
    expect(result.terminalId).toBeTruthy();
    expect(typeof result.terminalId).toBe('string');
  });

  it('enforces max terminal limit', async () => {
    for (let i = 0; i < 5; i++) {
      await runtime.createTerminal({ cwd: tmpDir });
    }
    await expect(runtime.createTerminal({ cwd: tmpDir })).rejects.toThrow(/limit/i);
  });

  it('kills a terminal', async () => {
    const { terminalId } = await runtime.createTerminal({ cwd: tmpDir });
    runtime.killTerminal({ terminalId });
    // 再次 kill 不应抛异常
    runtime.killTerminal({ terminalId });
  });

  it('kills all terminals', async () => {
    await runtime.createTerminal({ cwd: tmpDir });
    await runtime.createTerminal({ cwd: tmpDir });
    runtime.killAll();
    // 之后应能重新创建
    const { terminalId } = await runtime.createTerminal({ cwd: tmpDir });
    expect(terminalId).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/acp-terminal-runtime.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 TerminalRuntime**

```typescript
// electron/acp/terminal-runtime.ts
import * as pty from 'node-pty';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

interface ManagedTerminal {
  pty: pty.IPty;
  outputBuffer: string;
  bufferSize: number;
}

export class TerminalRuntime {
  private terminals = new Map<string, ManagedTerminal>();
  private maxTerminals: number;
  private maxBufferSize: number;

  constructor(maxTerminals = 5, maxBufferSize = 1024 * 1024) {
    this.maxTerminals = maxTerminals;
    this.maxBufferSize = maxBufferSize;
  }

  async createTerminal(params: { cwd?: string }): Promise<{ terminalId: string }> {
    if (this.terminals.size >= this.maxTerminals) {
      throw new Error(`Terminal limit reached (max ${this.maxTerminals})`);
    }

    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';
    const terminalId = randomUUID();

    const terminal = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: params.cwd || process.cwd(),
      env: process.env as Record<string, string>,
    });

    const managed: ManagedTerminal = {
      pty: terminal,
      outputBuffer: '',
      bufferSize: 0,
    };

    terminal.onData((data) => {
      managed.outputBuffer += data;
      managed.bufferSize += data.length;

      // 超出缓冲限制时截断前半
      if (managed.bufferSize > this.maxBufferSize) {
        const half = Math.floor(this.maxBufferSize / 2);
        managed.outputBuffer = managed.outputBuffer.slice(-half);
        managed.bufferSize = managed.outputBuffer.length;
      }
    });

    terminal.onExit(() => {
      this.terminals.delete(terminalId);
    });

    this.terminals.set(terminalId, managed);
    return { terminalId };
  }

  async executeCommand(params: {
    terminalId: string;
    command: string;
    timeout?: number;
  }): Promise<{ output: string }> {
    const managed = this.terminals.get(params.terminalId);
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    // 记录当前缓冲区位置
    const startLen = managed.outputBuffer.length;

    // 写入命令
    managed.pty.write(params.command + '\n');

    // 等待输出稳定（简单策略：等到 500ms 无新输出，或达到超时）
    const timeout = params.timeout ?? 120_000;
    const output = await this.waitForOutput(managed, startLen, timeout);

    return { output };
  }

  getOutput(params: { terminalId: string }): { output: string } {
    const managed = this.terminals.get(params.terminalId);
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }
    return { output: managed.outputBuffer };
  }

  killTerminal(params: { terminalId: string }): void {
    const managed = this.terminals.get(params.terminalId);
    if (!managed) return;

    try {
      managed.pty.kill();
    } catch {
      // 已经退出
    }
    this.terminals.delete(params.terminalId);
  }

  killAll(): void {
    for (const [id] of this.terminals) {
      this.killTerminal({ terminalId: id });
    }
  }

  private waitForOutput(
    managed: ManagedTerminal,
    startLen: number,
    timeout: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeout;
      let lastLen = startLen;
      let stableCount = 0;

      const check = () => {
        if (Date.now() > deadline) {
          resolve(managed.outputBuffer.slice(startLen) + '\n[命令超时]');
          return;
        }

        const currentLen = managed.outputBuffer.length;
        if (currentLen > lastLen) {
          lastLen = currentLen;
          stableCount = 0;
        } else {
          stableCount++;
        }

        // 500ms 无新输出认为稳定（检测间隔 100ms × 5 次）
        if (stableCount >= 5 && currentLen > startLen) {
          resolve(managed.outputBuffer.slice(startLen));
          return;
        }

        setTimeout(check, 100);
      };

      setTimeout(check, 100);
    });
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/acp-terminal-runtime.test.ts
```

Expected: PASS（注意：`node-pty` 需要原生编译，测试环境可能需要 `electron-rebuild` 或在 Electron 环境中运行）

> 如果 `node-pty` 在纯 Node.js vitest 中无法加载，可以在测试中 mock `node-pty`。此时测试专注于逻辑（限制、kill、buffer），真实 PTY 行为靠手动验收。

- [ ] **Step 5: 提交**

```bash
git add electron/acp/terminal-runtime.ts tests/acp-terminal-runtime.test.ts
git commit -m "feat(agent): TerminalRuntime PTY 终端管理"
```

---

## Task 7: BinaryManager + Preflight — 安装与预检

**Files:**
- Create: `electron/acp/binary-manager.ts`
- Create: `electron/acp/preflight.ts`
- Test: `tests/acp-preflight.test.ts`

- [ ] **Step 1: 实现 BinaryManager**

```typescript
// electron/acp/binary-manager.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

const AGENT_NPM_PACKAGE = '@agentclientprotocol/claude-agent-acp';
const AGENT_COMMAND = 'claude-agent-acp';

export class BinaryManager {
  private cachePath: string;

  constructor(cacheBase?: string) {
    this.cachePath = cacheBase ?? path.join(os.homedir(), '.lingji', 'acp-binaries', 'claude-acp');
  }

  async findNpxPath(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('which', ['npx']);
      return stdout.trim() || null;
    } catch {
      // Windows fallback
      try {
        const { stdout } = await execFileAsync('where', ['npx']);
        return stdout.trim().split('\n')[0] || null;
      } catch {
        return null;
      }
    }
  }

  async findNodePath(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('which', ['node']);
      return stdout.trim() || null;
    } catch {
      try {
        const { stdout } = await execFileAsync('where', ['node']);
        return stdout.trim().split('\n')[0] || null;
      } catch {
        return null;
      }
    }
  }

  async getNodeVersion(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('node', ['--version']);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async getInstalledVersion(): Promise<string | null> {
    try {
      // 检查全局缓存
      const versionFile = path.join(this.cachePath, 'version.txt');
      return (await fs.readFile(versionFile, 'utf-8')).trim();
    } catch {
      return null;
    }
  }

  async getLatestVersion(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('npm', ['view', AGENT_NPM_PACKAGE, 'version']);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async install(version: string): Promise<void> {
    await fs.mkdir(this.cachePath, { recursive: true });

    // 使用 npx 安装到缓存
    await execFileAsync('npx', ['--yes', `${AGENT_NPM_PACKAGE}@${version}`, '--version'], {
      timeout: 120_000,
    });

    await fs.writeFile(path.join(this.cachePath, 'version.txt'), version, 'utf-8');
  }

  async uninstall(): Promise<void> {
    try {
      await fs.rm(this.cachePath, { recursive: true, force: true });
    } catch {
      // 目录不存在
    }
  }

  getSpawnCommand(version: string): { command: string; args: string[] } {
    return {
      command: 'npx',
      args: ['--yes', `${AGENT_NPM_PACKAGE}@${version}`],
    };
  }
}
```

- [ ] **Step 2: 实现 Preflight**

```typescript
// electron/acp/preflight.ts
import type { PreflightCheck } from './types';
import { BinaryManager } from './binary-manager';
import type { AgentConfig } from './config';

export async function runPreflight(
  binaryManager: BinaryManager,
  config: AgentConfig,
  agentId: string,
): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];

  // 1. Node.js
  const nodeVersion = await binaryManager.getNodeVersion();
  if (nodeVersion) {
    checks.push({ label: 'Node.js', status: 'pass', message: nodeVersion });
  } else {
    checks.push({
      label: 'Node.js',
      status: 'fail',
      message: '未安装 Node.js',
      fixAction: 'install',
    });
  }

  // 2. npx
  const npxPath = await binaryManager.findNpxPath();
  if (npxPath) {
    checks.push({ label: 'npx', status: 'pass', message: npxPath });
  } else {
    checks.push({
      label: 'npx',
      status: 'fail',
      message: '未找到 npx',
      fixAction: 'install',
    });
  }

  // 3. Agent 安装状态
  const installedVersion = await binaryManager.getInstalledVersion();
  const latestVersion = await binaryManager.getLatestVersion();

  if (installedVersion) {
    if (latestVersion && installedVersion !== latestVersion) {
      checks.push({
        label: 'claude-agent-acp',
        status: 'warn',
        message: `已安装 ${installedVersion}，最新 ${latestVersion}`,
        fixAction: 'upgrade',
      });
    } else {
      checks.push({
        label: 'claude-agent-acp',
        status: 'pass',
        message: `v${installedVersion}`,
      });
    }
  } else {
    checks.push({
      label: 'claude-agent-acp',
      status: 'fail',
      message: '未安装',
      fixAction: 'install',
    });
  }

  // 4. API Key
  const configData = await config.load();
  const agentEntry = configData.agents[agentId];
  if (agentEntry?.authMode === 'subscription') {
    checks.push({ label: 'API Key', status: 'pass', message: '使用官方订阅' });
  } else {
    const apiKey = await config.getApiKey(agentId);
    if (apiKey) {
      checks.push({ label: 'API Key', status: 'pass', message: '已配置' });
    } else {
      checks.push({
        label: 'API Key',
        status: 'warn',
        message: '未设置 API Key',
      });
    }
  }

  return checks;
}
```

- [ ] **Step 3: 写 Preflight 测试**

```typescript
// tests/acp-preflight.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runPreflight } from '../electron/acp/preflight';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`enc:${text}`),
    decryptString: (buffer: Buffer) => buffer.toString().replace('enc:', ''),
  },
}));

describe('Preflight', () => {
  it('returns checks array with expected labels', async () => {
    // 使用真实的 BinaryManager（会检测本机 node/npx）
    const { BinaryManager } = await import('../electron/acp/binary-manager');
    const { AgentConfig } = await import('../electron/acp/config');
    const bm = new BinaryManager('/tmp/test-cache');
    const config = new AgentConfig('/tmp/test-agent-config.json');

    const checks = await runPreflight(bm, config, 'claude-acp');

    const labels = checks.map((c) => c.label);
    expect(labels).toContain('Node.js');
    expect(labels).toContain('npx');
    expect(labels).toContain('claude-agent-acp');
    expect(labels).toContain('API Key');

    // 本机应该有 node 和 npx
    const nodeCheck = checks.find((c) => c.label === 'Node.js');
    expect(nodeCheck?.status).toBe('pass');
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/acp-preflight.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/acp/binary-manager.ts electron/acp/preflight.ts tests/acp-preflight.test.ts
git commit -m "feat(agent): BinaryManager 安装管理与 Preflight 环境预检"
```

---

## Task 8: SessionManager — 会话生命周期

**Files:**
- Create: `electron/acp/session.ts`

- [ ] **Step 1: 实现 SessionManager**

```typescript
// electron/acp/session.ts
import { EventEmitter } from 'node:events';
import type { AcpClient } from './client';
import type { AgentConfig, SessionData } from './config';
import type { FileSystemRuntime } from './fs-runtime';
import type { TerminalRuntime } from './terminal-runtime';
import { PermissionHandler } from './permission';
import type {
  AcpEvent,
  ConnectionStatus,
  InitializeResult,
  NewSessionResult,
  PermissionOption,
  PermissionPolicy,
  PromptInputBlock,
} from './types';

export class SessionManager extends EventEmitter {
  private client: AcpClient;
  private config: AgentConfig;
  private fsRuntime: FileSystemRuntime | null = null;
  private terminalRuntime: TerminalRuntime;
  private permissionHandler: PermissionHandler;

  private status: ConnectionStatus = 'disconnected';
  private sessionId: string | null = null;
  private projectDir: string | null = null;
  private initializeResult: InitializeResult | null = null;

  constructor(
    client: AcpClient,
    config: AgentConfig,
    terminalRuntime: TerminalRuntime,
    permissionPolicy: PermissionPolicy,
  ) {
    super();
    this.client = client;
    this.config = config;
    this.terminalRuntime = terminalRuntime;
    this.permissionHandler = new PermissionHandler(permissionPolicy);

    // 监听 client 事件
    this.client.on('notification', (method: string, params: unknown) => {
      if (method === 'session/event') {
        this.handleEvent(params as AcpEvent);
      }
    });

    this.client.on('disconnected', () => {
      this.setStatus('disconnected');
      this.terminalRuntime.killAll();
    });
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getCapabilities(): InitializeResult | null {
    return this.initializeResult;
  }

  setPermissionPolicy(policy: PermissionPolicy): void {
    this.permissionHandler.setPolicy(policy);
  }

  setPermissionPromptCallback(cb: (action: { type: string; path?: string; command?: string }) => Promise<'allow' | 'deny'>): void {
    this.permissionHandler.setPromptCallback(cb);
  }

  async connect(projectDir: string, spawnCommand: string, spawnArgs: string[], env?: Record<string, string>): Promise<void> {
    this.projectDir = projectDir;
    this.setStatus('connecting');

    const { FileSystemRuntime } = await import('./fs-runtime');
    this.fsRuntime = new FileSystemRuntime(projectDir);

    // 注册 runtime handlers
    this.registerRuntimeHandlers();

    // spawn agent 进程
    await this.client.spawn(spawnCommand, spawnArgs, projectDir, env);

    // initialize
    this.initializeResult = (await this.client.sendRequest('initialize', {
      protocolVersion: 'latest',
      clientCapabilities: {
        terminal: true,
        fs: { readTextFile: true, writeTextFile: true },
      },
    })) as InitializeResult;

    // 尝试恢复会话
    const savedSession = await this.config.loadSession(projectDir);
    if (savedSession?.sessionId) {
      try {
        const result = (await this.client.sendRequest('session/load', {
          sessionId: savedSession.sessionId,
          cwd: projectDir,
        })) as NewSessionResult;
        this.sessionId = result.sessionId;
      } catch {
        // 恢复失败，创建新会话
        const result = (await this.client.sendRequest('session/new', {
          cwd: projectDir,
        })) as NewSessionResult;
        this.sessionId = result.sessionId;
      }
    } else {
      const result = (await this.client.sendRequest('session/new', {
        cwd: projectDir,
      })) as NewSessionResult;
      this.sessionId = result.sessionId;
    }

    // 保存会话 ID
    if (this.sessionId) {
      await this.config.saveSession(projectDir, {
        sessionId: this.sessionId,
        lastConnected: new Date().toISOString(),
      });
    }

    this.setStatus('connected');
    this.emit('capabilities', this.initializeResult);
  }

  async sendPrompt(text: string): Promise<void> {
    if (!this.sessionId) throw new Error('No active session');
    this.setStatus('prompting');

    const contents: PromptInputBlock[] = [{ type: 'text', text }];
    await this.client.sendRequest('prompt', { sessionId: this.sessionId, contents });
  }

  async cancelTurn(): Promise<void> {
    this.client.sendNotification('cancel', {});
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.sessionId) return;
    await this.client.sendRequest('session/setMode', {
      sessionId: this.sessionId,
      modeId,
    });
  }

  async setConfigOption(configId: string, valueId: string): Promise<void> {
    if (!this.sessionId) return;
    await this.client.sendRequest('session/setConfigOption', {
      sessionId: this.sessionId,
      configId,
      valueId,
    });
  }

  async respondPermission(requestId: string, optionId: string): Promise<void> {
    await this.client.sendRequest('permission/respond', {
      requestId,
      optionId,
    });
  }

  disconnect(): void {
    this.client.disconnect();
    this.terminalRuntime.killAll();
    this.sessionId = null;
    this.fsRuntime = null;
    this.setStatus('disconnected');
  }

  private registerRuntimeHandlers(): void {
    this.client.onRequest('read_text_file', async (params) => {
      const { path: filePath } = params as { path: string };
      const allowed = await this.permissionHandler.check({ type: 'fs.read', path: filePath });
      if (allowed === 'deny') throw new Error('Permission denied: read_text_file');
      return this.fsRuntime!.readTextFile({ path: filePath });
    });

    this.client.onRequest('write_text_file', async (params) => {
      const { path: filePath, content } = params as { path: string; content: string };
      const allowed = await this.permissionHandler.check({ type: 'fs.write', path: filePath });
      if (allowed === 'deny') throw new Error('Permission denied: write_text_file');
      const result = await this.fsRuntime!.writeTextFile({ path: filePath, content });
      // 通知前端文件变更（用于 diff 展示）
      this.emit('file_changed', { path: filePath, before: result.before, after: result.after });
      return { success: true };
    });

    this.client.onRequest('create_terminal', async (params) => {
      const { cwd } = params as { cwd?: string };
      const allowed = await this.permissionHandler.check({ type: 'terminal.create', cwd });
      if (allowed === 'deny') throw new Error('Permission denied: create_terminal');
      return this.terminalRuntime.createTerminal({ cwd: cwd || this.projectDir || undefined });
    });

    this.client.onRequest('terminal_execute', async (params) => {
      const { terminalId, command } = params as { terminalId: string; command: string };
      const allowed = await this.permissionHandler.check({ type: 'terminal.execute', command });
      if (allowed === 'deny') throw new Error('Permission denied: terminal_execute');
      return this.terminalRuntime.executeCommand({ terminalId, command });
    });

    this.client.onRequest('terminal_output', async (params) => {
      const { terminalId } = params as { terminalId: string };
      return this.terminalRuntime.getOutput({ terminalId });
    });

    this.client.onRequest('kill_terminal', async (params) => {
      const { terminalId } = params as { terminalId: string };
      this.terminalRuntime.killTerminal({ terminalId });
      return {};
    });
  }

  private handleEvent(event: AcpEvent): void {
    if (event.type === 'turn_complete') {
      this.setStatus('connected');
    }
    this.emit('event', event);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit('status', status);
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add electron/acp/session.ts
git commit -m "feat(agent): SessionManager 会话生命周期管理"
```

---

## Task 9: IPC Bridge — Electron 主进程 ↔ 渲染进程

**Files:**
- Create: `electron/acp/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Create: `src/lib/agent-api.ts`
- Modify: `src/lib/electron-api.ts`

- [ ] **Step 1: 创建 AgentAPI 类型定义**

```typescript
// src/lib/agent-api.ts
import type {
  AgentConfigData,
  AgentMode,
  ConfigOption,
  ConnectionStatus,
  PermissionOption,
  PermissionPolicy,
  PreflightCheck,
} from '../../electron/acp/types';

// ─── 前端使用的消息类型 ────────────────────────────────────

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool_call';
      toolCallId: string;
      title: string;
      kind: string;
      status: string;
      rawInput?: string;
      rawOutput?: string;
    }
  | {
      type: 'tool_call_update';
      toolCallId: string;
      title?: string;
      status?: string;
      rawInput?: string;
      rawOutput?: string;
      rawOutputAppend?: boolean;
    }
  | {
      type: 'turn_complete';
      stopReason: string;
    }
  | {
      type: 'permission_request';
      requestId: string;
      toolCall: unknown;
      options: PermissionOption[];
    }
  | {
      type: 'file_changed';
      path: string;
      before: string | null;
      after: string;
    }
  | {
      type: 'error';
      message: string;
    };

export interface AgentCapabilities {
  modes: AgentMode[];
  configOptions: ConfigOption[];
  forkSupported: boolean;
}

// ─── AgentAPI 接口（window.agentAPI）────────────────────────

export interface AgentAPI {
  // 连接管理
  connect(projectDir: string): Promise<void>;
  disconnect(): Promise<void>;

  // 对话
  sendPrompt(text: string): Promise<void>;
  cancelTurn(): Promise<void>;

  // 模式与配置
  setMode(modeId: string): Promise<void>;
  setConfigOption(configId: string, valueId: string): Promise<void>;

  // 权限
  respondPermission(requestId: string, optionId: string): Promise<void>;

  // 设置
  getConfig(): Promise<AgentConfigData>;
  saveConfig(data: AgentConfigData): Promise<void>;
  getApiKey(agentId: string): Promise<string>;
  setApiKey(agentId: string, key: string): Promise<void>;
  getPermissionPolicy(): Promise<PermissionPolicy>;
  setPermissionPolicy(policy: PermissionPolicy): Promise<void>;

  // 预检与安装
  runPreflight(): Promise<PreflightCheck[]>;
  installAgent(version: string): Promise<void>;
  uninstallAgent(): Promise<void>;
  getLatestVersion(): Promise<string | null>;

  // 事件监听（Main → Renderer）
  onStatusChanged(callback: (status: ConnectionStatus) => void): () => void;
  onEvent(callback: (block: ContentBlock) => void): () => void;
  onCapabilities(callback: (caps: AgentCapabilities) => void): () => void;
}

declare global {
  interface Window {
    agentAPI: AgentAPI;
  }
}
```

- [ ] **Step 2: 实现 IPC 注册模块**

```typescript
// electron/acp/ipc.ts
import { ipcMain, type BrowserWindow } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { AcpClient } from './client';
import { AgentConfig } from './config';
import { BinaryManager } from './binary-manager';
import { TerminalRuntime } from './terminal-runtime';
import { SessionManager } from './session';
import { runPreflight } from './preflight';
import type { PermissionPolicy } from './types';

const CONFIG_PATH = path.join(os.homedir(), '.lingji', 'agent-config.json');

let sessionManager: SessionManager | null = null;
const config = new AgentConfig(CONFIG_PATH);
const binaryManager = new BinaryManager();
const terminalRuntime = new TerminalRuntime();

export function registerAgentIpc(getMainWindow: () => BrowserWindow | null): void {
  const sendToRenderer = (channel: string, ...args: unknown[]) => {
    getMainWindow()?.webContents.send(channel, ...args);
  };

  ipcMain.handle('agent:connect', async (_event, projectDir: string) => {
    const configData = await config.load();
    const agentEntry = configData.agents['claude-acp'];
    const policy = configData.permissionPolicy ?? 'tiered';

    const client = new AcpClient();
    sessionManager = new SessionManager(client, config, terminalRuntime, policy);

    // 设置权限提示回调 → 转发到 Renderer
    sessionManager.setPermissionPromptCallback(async (action) => {
      sendToRenderer('agent:permission-prompt', action);
      return new Promise((resolve) => {
        const handler = (_e: unknown, result: 'allow' | 'deny') => {
          ipcMain.removeHandler('agent:permission-prompt-response');
          resolve(result);
        };
        ipcMain.handleOnce('agent:permission-prompt-response', handler);
      });
    });

    // 转发事件到 Renderer
    sessionManager.on('status', (status) => sendToRenderer('agent:status', status));
    sessionManager.on('event', (event) => sendToRenderer('agent:event', event));
    sessionManager.on('capabilities', (caps) => sendToRenderer('agent:capabilities', caps));
    sessionManager.on('file_changed', (change) =>
      sendToRenderer('agent:event', { type: 'file_changed', ...change }),
    );

    // 构建 env
    const env: Record<string, string> = {};
    if (agentEntry?.authMode === 'custom_api') {
      const apiKey = await config.getApiKey('claude-acp');
      if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
      if (agentEntry.apiBaseUrl) env.ANTHROPIC_BASE_URL = agentEntry.apiBaseUrl;
    }
    // 解析 envText
    if (agentEntry?.envText) {
      for (const line of agentEntry.envText.split('\n')) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
        }
      }
    }

    const version = agentEntry?.version || '0.25.0';
    const { command, args } = binaryManager.getSpawnCommand(version);

    await sessionManager.connect(projectDir, command, args, env);
  });

  ipcMain.handle('agent:disconnect', async () => {
    sessionManager?.disconnect();
    sessionManager = null;
  });

  ipcMain.handle('agent:send-prompt', async (_event, text: string) => {
    await sessionManager?.sendPrompt(text);
  });

  ipcMain.handle('agent:cancel-turn', async () => {
    await sessionManager?.cancelTurn();
  });

  ipcMain.handle('agent:set-mode', async (_event, modeId: string) => {
    await sessionManager?.setMode(modeId);
  });

  ipcMain.handle('agent:set-config-option', async (_event, configId: string, valueId: string) => {
    await sessionManager?.setConfigOption(configId, valueId);
  });

  ipcMain.handle('agent:respond-permission', async (_event, requestId: string, optionId: string) => {
    await sessionManager?.respondPermission(requestId, optionId);
  });

  // 配置管理
  ipcMain.handle('agent:get-config', () => config.load());
  ipcMain.handle('agent:save-config', async (_event, data) => config.save(data));
  ipcMain.handle('agent:get-api-key', async (_event, agentId: string) => config.getApiKey(agentId));
  ipcMain.handle('agent:set-api-key', async (_event, agentId: string, key: string) =>
    config.setApiKey(agentId, key),
  );
  ipcMain.handle('agent:get-permission-policy', async () => {
    const data = await config.load();
    return data.permissionPolicy;
  });
  ipcMain.handle('agent:set-permission-policy', async (_event, policy: PermissionPolicy) => {
    const data = await config.load();
    data.permissionPolicy = policy;
    await config.save(data);
    sessionManager?.setPermissionPolicy(policy);
  });

  // 预检与安装
  ipcMain.handle('agent:run-preflight', () => runPreflight(binaryManager, config, 'claude-acp'));
  ipcMain.handle('agent:install', async (_event, version: string) => binaryManager.install(version));
  ipcMain.handle('agent:uninstall', () => binaryManager.uninstall());
  ipcMain.handle('agent:get-latest-version', () => binaryManager.getLatestVersion());
}
```

- [ ] **Step 3: 扩展 preload.ts**

在 `electron/preload.ts` 的 `contextBridge.exposeInMainWorld('electronAPI', { ... })` 之后，新增：

```typescript
// 在 preload.ts 末尾追加：

contextBridge.exposeInMainWorld('agentAPI', {
  connect: (projectDir: string) => ipcRenderer.invoke('agent:connect', projectDir),
  disconnect: () => ipcRenderer.invoke('agent:disconnect'),
  sendPrompt: (text: string) => ipcRenderer.invoke('agent:send-prompt', text),
  cancelTurn: () => ipcRenderer.invoke('agent:cancel-turn'),
  setMode: (modeId: string) => ipcRenderer.invoke('agent:set-mode', modeId),
  setConfigOption: (configId: string, valueId: string) =>
    ipcRenderer.invoke('agent:set-config-option', configId, valueId),
  respondPermission: (requestId: string, optionId: string) =>
    ipcRenderer.invoke('agent:respond-permission', requestId, optionId),

  getConfig: () => ipcRenderer.invoke('agent:get-config'),
  saveConfig: (data: unknown) => ipcRenderer.invoke('agent:save-config', data),
  getApiKey: (agentId: string) => ipcRenderer.invoke('agent:get-api-key', agentId),
  setApiKey: (agentId: string, key: string) => ipcRenderer.invoke('agent:set-api-key', agentId, key),
  getPermissionPolicy: () => ipcRenderer.invoke('agent:get-permission-policy'),
  setPermissionPolicy: (policy: string) => ipcRenderer.invoke('agent:set-permission-policy', policy),

  runPreflight: () => ipcRenderer.invoke('agent:run-preflight'),
  installAgent: (version: string) => ipcRenderer.invoke('agent:install', version),
  uninstallAgent: () => ipcRenderer.invoke('agent:uninstall'),
  getLatestVersion: () => ipcRenderer.invoke('agent:get-latest-version'),

  onStatusChanged: (callback: (status: string) => void) => {
    const handler = (_event: unknown, status: string) => callback(status);
    ipcRenderer.on('agent:status', handler);
    return () => ipcRenderer.removeListener('agent:status', handler);
  },
  onEvent: (callback: (block: unknown) => void) => {
    const handler = (_event: unknown, block: unknown) => callback(block);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.removeListener('agent:event', handler);
  },
  onCapabilities: (callback: (caps: unknown) => void) => {
    const handler = (_event: unknown, caps: unknown) => callback(caps);
    ipcRenderer.on('agent:capabilities', handler);
    return () => ipcRenderer.removeListener('agent:capabilities', handler);
  },
});
```

- [ ] **Step 4: 在 main.ts 注册 IPC**

在 `electron/main.ts` 顶部添加 import，在 `app.whenReady()` 之前调用注册：

```typescript
// 在 main.ts 顶部 imports 区域添加：
import { registerAgentIpc } from './acp/ipc';

// 在 app.whenReady().then(createWindow) 之前添加：
registerAgentIpc(() => mainWindow);
```

- [ ] **Step 5: 在 electron-api.ts 中声明 AgentAPI**

在 `src/lib/electron-api.ts` 末尾的 `declare global` 中添加 `agentAPI`：

```typescript
// 在 src/lib/electron-api.ts 中，将 agent-api.ts 的 declare global 移到此处，或 import
// 最简方案：在此文件顶部添加
import type {} from './agent-api';
// agent-api.ts 中的 declare global 会自动合并
```

- [ ] **Step 6: 提交**

```bash
git add electron/acp/ipc.ts electron/preload.ts electron/main.ts src/lib/agent-api.ts src/lib/electron-api.ts
git commit -m "feat(agent): IPC 桥接层，连通 Main/Renderer 双向通信"
```

---

## Task 10: useAgentStore — 前端状态管理

**Files:**
- Create: `src/store/agent.ts`
- Test: `tests/agent-store.test.ts`

- [ ] **Step 1: 写 Store 测试**

```typescript
// tests/agent-store.test.ts
import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock window.agentAPI
const mockAgentAPI = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendPrompt: vi.fn(),
  cancelTurn: vi.fn(),
  setMode: vi.fn(),
  respondPermission: vi.fn(),
  onStatusChanged: vi.fn(() => vi.fn()),
  onEvent: vi.fn(() => vi.fn()),
  onCapabilities: vi.fn(() => vi.fn()),
};

vi.stubGlobal('window', { agentAPI: mockAgentAPI });

describe('useAgentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initial state is disconnected with empty messages', async () => {
    const { useAgentStore } = await import('../src/store/agent');
    const state = useAgentStore.getState();
    expect(state.status).toBe('disconnected');
    expect(state.messages).toEqual([]);
    expect(state.sessionId).toBeNull();
  });

  it('appendTextDelta appends to last assistant text block', async () => {
    const { useAgentStore } = await import('../src/store/agent');
    const store = useAgentStore.getState();

    // 模拟开始一个新 assistant message
    store.startAssistantMessage();
    store.appendTextDelta('Hello ');
    store.appendTextDelta('world');

    const state = useAgentStore.getState();
    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    if (lastMsg.role === 'assistant') {
      expect(lastMsg.blocks[0]).toEqual({ type: 'text', text: 'Hello world' });
    }
  });

  it('addToolCall adds a tool_call block', async () => {
    const { useAgentStore } = await import('../src/store/agent');
    const store = useAgentStore.getState();

    store.startAssistantMessage();
    store.addToolCall({
      toolCallId: 'tc1',
      title: 'read_text_file',
      kind: 'file',
      status: 'running',
    });

    const state = useAgentStore.getState();
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.role === 'assistant') {
      const tc = lastMsg.blocks.find((b) => b.type === 'tool_call');
      expect(tc).toBeDefined();
    }
  });

  it('addUserMessage adds user message', async () => {
    const { useAgentStore } = await import('../src/store/agent');
    useAgentStore.getState().addUserMessage('hi');
    const state = useAgentStore.getState();
    expect(state.messages[state.messages.length - 1]).toEqual({
      role: 'user',
      content: 'hi',
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/agent-store.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 useAgentStore**

```typescript
// src/store/agent.ts
import { create } from 'zustand';
import type {
  AgentMode,
  ConfigOption,
  ConnectionStatus,
  PermissionOption,
  PermissionPolicy,
} from '../../electron/acp/types';

// ─── 消息类型 ─────────────────────────────────────────────

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  text: string;
}

export interface ToolCallBlock {
  type: 'tool_call';
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  rawInput?: string;
  rawOutput?: string;
}

export interface PermissionBlock {
  type: 'permission_request';
  requestId: string;
  toolCall: unknown;
  options: PermissionOption[];
  response?: string;
}

export interface FileChangedBlock {
  type: 'file_changed';
  path: string;
  before: string | null;
  after: string;
}

export interface ErrorBlock {
  type: 'error';
  message: string;
}

export interface TurnCompleteBlock {
  type: 'turn_complete';
  stopReason: string;
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolCallBlock
  | PermissionBlock
  | FileChangedBlock
  | ErrorBlock
  | TurnCompleteBlock;

export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; blocks: ContentBlock[] };

// ─── Store ────────────────────────────────────────────────

interface AgentState {
  status: ConnectionStatus;
  sessionId: string | null;
  messages: AgentMessage[];
  modes: AgentMode[];
  currentMode: string;
  configOptions: ConfigOption[];
  sidebarOpen: boolean;
}

interface AgentActions {
  setStatus: (status: ConnectionStatus) => void;
  setSessionId: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setModes: (modes: AgentMode[]) => void;
  setCurrentMode: (mode: string) => void;
  setConfigOptions: (options: ConfigOption[]) => void;

  addUserMessage: (content: string) => void;
  startAssistantMessage: () => void;
  appendTextDelta: (text: string) => void;
  appendThinking: (text: string) => void;
  addToolCall: (tc: Omit<ToolCallBlock, 'type'>) => void;
  updateToolCall: (update: {
    toolCallId: string;
    title?: string;
    status?: string;
    rawInput?: string;
    rawOutput?: string;
    rawOutputAppend?: boolean;
  }) => void;
  addPermissionRequest: (pr: Omit<PermissionBlock, 'type'>) => void;
  resolvePermission: (requestId: string, optionId: string) => void;
  addFileChanged: (fc: { path: string; before: string | null; after: string }) => void;
  addError: (message: string) => void;
  markTurnComplete: (stopReason: string) => void;
  clearMessages: () => void;
  reset: () => void;
}

const initialState: AgentState = {
  status: 'disconnected',
  sessionId: null,
  messages: [],
  modes: [],
  currentMode: '',
  configOptions: [],
  sidebarOpen: false,
};

export const useAgentStore = create<AgentState & AgentActions>((set, get) => ({
  ...initialState,

  setStatus: (status) => set({ status }),
  setSessionId: (id) => set({ sessionId: id }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setModes: (modes) => set({ modes }),
  setCurrentMode: (mode) => set({ currentMode: mode }),
  setConfigOptions: (options) => set({ configOptions: options }),

  addUserMessage: (content) => {
    set((s) => ({ messages: [...s.messages, { role: 'user', content }] }));
  },

  startAssistantMessage: () => {
    set((s) => ({ messages: [...s.messages, { role: 'assistant', blocks: [] }] }));
  },

  appendTextDelta: (text) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return s;

      const blocks = [...last.blocks];
      const lastBlock = blocks[blocks.length - 1];

      if (lastBlock?.type === 'text') {
        blocks[blocks.length - 1] = { ...lastBlock, text: lastBlock.text + text };
      } else {
        blocks.push({ type: 'text', text });
      }

      messages[messages.length - 1] = { role: 'assistant', blocks };
      return { messages };
    });
  },

  appendThinking: (text) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return s;

      const blocks = [...last.blocks];
      const lastBlock = blocks[blocks.length - 1];

      if (lastBlock?.type === 'thinking') {
        blocks[blocks.length - 1] = { ...lastBlock, text: lastBlock.text + text };
      } else {
        blocks.push({ type: 'thinking', text });
      }

      messages[messages.length - 1] = { role: 'assistant', blocks };
      return { messages };
    });
  },

  addToolCall: (tc) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return s;

      const blocks = [...last.blocks, { type: 'tool_call' as const, ...tc }];
      messages[messages.length - 1] = { role: 'assistant', blocks };
      return { messages };
    });
  },

  updateToolCall: (update) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return s;

      const blocks = last.blocks.map((b) => {
        if (b.type !== 'tool_call' || b.toolCallId !== update.toolCallId) return b;
        const updated = { ...b };
        if (update.title !== undefined) updated.title = update.title;
        if (update.status !== undefined) updated.status = update.status;
        if (update.rawInput !== undefined) updated.rawInput = update.rawInput;
        if (update.rawOutput !== undefined) {
          if (update.rawOutputAppend) {
            updated.rawOutput = (updated.rawOutput || '') + update.rawOutput;
          } else {
            updated.rawOutput = update.rawOutput;
          }
        }
        return updated;
      });

      messages[messages.length - 1] = { role: 'assistant', blocks };
      return { messages };
    });
  },

  addPermissionRequest: (pr) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return s;

      const blocks = [...last.blocks, { type: 'permission_request' as const, ...pr }];
      messages[messages.length - 1] = { role: 'assistant', blocks };
      return { messages };
    });
  },

  resolvePermission: (requestId, optionId) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return s;

      const blocks = last.blocks.map((b) => {
        if (b.type !== 'permission_request' || b.requestId !== requestId) return b;
        return { ...b, response: optionId };
      });

      messages[messages.length - 1] = { role: 'assistant', blocks };
      return { messages };
    });
  },

  addFileChanged: (fc) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return s;

      const blocks = [...last.blocks, { type: 'file_changed' as const, ...fc }];
      messages[messages.length - 1] = { role: 'assistant', blocks };
      return { messages };
    });
  },

  addError: (message) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        const blocks = [...last.blocks, { type: 'error' as const, message }];
        messages[messages.length - 1] = { role: 'assistant', blocks };
      } else {
        messages.push({ role: 'assistant', blocks: [{ type: 'error', message }] });
      }
      return { messages };
    });
  },

  markTurnComplete: (stopReason) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return s;

      const blocks = [...last.blocks, { type: 'turn_complete' as const, stopReason }];
      messages[messages.length - 1] = { role: 'assistant', blocks };
      return { messages };
    });
  },

  clearMessages: () => set({ messages: [] }),
  reset: () => set(initialState),
}));
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/agent-store.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/agent.ts tests/agent-store.test.ts
git commit -m "feat(agent): useAgentStore 前端状态管理"
```

---

## Task 11: AgentSidebar Shell — 抽屉容器 + InputBar + StatusBar

**Files:**
- Create: `src/components/agent/AgentSidebar.tsx`
- Create: `src/components/agent/AgentSidebar.module.css`
- Create: `src/components/agent/InputBar.tsx`
- Create: `src/components/agent/StatusBar.tsx`
- Create: `src/components/agent/AgentHeader.tsx`

- [ ] **Step 1: 创建 AgentSidebar 容器**

```typescript
// src/components/agent/AgentSidebar.tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAgentStore } from '../../store/agent';
import { AgentHeader } from './AgentHeader';
import { MessageList } from './MessageList';
import { InputBar } from './InputBar';
import { StatusBar } from './StatusBar';
import styles from './AgentSidebar.module.css';

const MIN_WIDTH = 320;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 420;

export function AgentSidebar() {
  const open = useAgentStore((s) => s.sidebarOpen);
  const status = useAgentStore((s) => s.status);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resizingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;

    const startX = e.clientX;
    const startWidth = width;

    const onMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startX - moveEvent.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta)));
    };

    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  // IPC 事件监听
  useEffect(() => {
    if (typeof window.agentAPI === 'undefined') return;

    const unsubStatus = window.agentAPI.onStatusChanged((s) => {
      useAgentStore.getState().setStatus(s as ReturnType<typeof useAgentStore.getState>['status']);
    });

    const unsubEvent = window.agentAPI.onEvent((block) => {
      const store = useAgentStore.getState();
      const event = block as { type: string; [key: string]: unknown };

      switch (event.type) {
        case 'content_delta':
          store.appendTextDelta(event.text as string);
          break;
        case 'thinking':
          store.appendThinking(event.text as string);
          break;
        case 'tool_call':
          store.addToolCall(event as Parameters<typeof store.addToolCall>[0]);
          break;
        case 'tool_call_update':
          store.updateToolCall(event as Parameters<typeof store.updateToolCall>[0]);
          break;
        case 'turn_complete':
          store.markTurnComplete(event.stopReason as string);
          break;
        case 'permission_request':
          store.addPermissionRequest(event as Parameters<typeof store.addPermissionRequest>[0]);
          break;
        case 'file_changed':
          store.addFileChanged(event as Parameters<typeof store.addFileChanged>[0]);
          break;
        case 'error':
          store.addError(event.message as string);
          break;
      }
    });

    const unsubCaps = window.agentAPI.onCapabilities((caps) => {
      const c = caps as { modes?: unknown[]; configOptions?: unknown[] };
      const store = useAgentStore.getState();
      if (c.modes) store.setModes(c.modes as ReturnType<typeof store>['modes']);
      if (c.configOptions) store.setConfigOptions(c.configOptions as ReturnType<typeof store>['configOptions']);
    });

    return () => {
      unsubStatus();
      unsubEvent();
      unsubCaps();
    };
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className={styles.sidebar}
          style={{ width }}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          <div className={styles.resizeHandle} onMouseDown={handleResizeStart} />
          <div className={styles.content}>
            <AgentHeader />
            <MessageList />
            <InputBar />
            <StatusBar />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: 创建样式**

```css
/* src/components/agent/AgentSidebar.module.css */
.sidebar {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  background: #1C1C1E;
  border-left: 1px solid #38383A;
  display: flex;
  flex-direction: row;
}

.resizeHandle {
  width: 4px;
  cursor: col-resize;
  flex-shrink: 0;
  background: transparent;
  transition: background 0.15s;
}

.resizeHandle:hover {
  background: #0A84FF40;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
```

- [ ] **Step 3: 创建 AgentHeader**

```typescript
// src/components/agent/AgentHeader.tsx
import { X } from 'lucide-react';
import { useAgentStore } from '../../store/agent';

export function AgentHeader() {
  const status = useAgentStore((s) => s.status);
  const modes = useAgentStore((s) => s.modes);
  const currentMode = useAgentStore((s) => s.currentMode);
  const toggleSidebar = useAgentStore((s) => s.toggleSidebar);

  const statusColor =
    status === 'connected' || status === 'prompting'
      ? '#32D74B'
      : status === 'connecting'
        ? '#FFD60A'
        : '#636366';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid #38383A',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: statusColor,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Claude Code</span>

      {modes.length > 1 && (
        <select
          value={currentMode}
          onChange={(e) => {
            useAgentStore.getState().setCurrentMode(e.target.value);
            window.agentAPI?.setMode(e.target.value);
          }}
          style={{
            background: '#2C2C2E',
            color: '#EBEBF5',
            border: '1px solid #48484A',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 12,
          }}
        >
          {modes.map((m) => (
            <option key={m.modeId} value={m.modeId}>
              {m.name}
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        onClick={toggleSidebar}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#EBEBF599',
          padding: 4,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 创建 InputBar**

```typescript
// src/components/agent/InputBar.tsx
import { useCallback, useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';
import { useAgentStore } from '../../store/agent';

export function InputBar() {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const status = useAgentStore((s) => s.status);
  const isPrompting = status === 'prompting';
  const isConnected = status === 'connected' || status === 'prompting';

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !isConnected) return;

    useAgentStore.getState().addUserMessage(trimmed);
    useAgentStore.getState().startAssistantMessage();
    window.agentAPI?.sendPrompt(trimmed);
    setText('');
  }, [text, isConnected]);

  const handleCancel = useCallback(() => {
    window.agentAPI?.cancelTurn();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: '1px solid #38383A',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
        flexShrink: 0,
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isConnected ? '输入消息...' : '未连接'}
        disabled={!isConnected}
        rows={1}
        style={{
          flex: 1,
          resize: 'none',
          background: '#2C2C2E',
          color: '#EBEBF5',
          border: '1px solid #48484A',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 13,
          lineHeight: 1.5,
          maxHeight: 120,
          overflow: 'auto',
          outline: 'none',
        }}
      />
      {isPrompting ? (
        <button
          type="button"
          onClick={handleCancel}
          style={{
            background: '#FF453A',
            border: 'none',
            borderRadius: 8,
            padding: 8,
            cursor: 'pointer',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Square size={14} />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim() || !isConnected}
          style={{
            background: text.trim() && isConnected ? '#0A84FF' : '#48484A',
            border: 'none',
            borderRadius: 8,
            padding: 8,
            cursor: text.trim() && isConnected ? 'pointer' : 'not-allowed',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Send size={14} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 创建 StatusBar**

```typescript
// src/components/agent/StatusBar.tsx
import { useAgentStore } from '../../store/agent';

const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接中...',
  connected: '已连接 Claude Code',
  prompting: '思考中...',
};

export function StatusBar() {
  const status = useAgentStore((s) => s.status);

  return (
    <div
      style={{
        padding: '6px 16px',
        borderTop: '1px solid #38383A',
        fontSize: 11,
        color: '#EBEBF550',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}
    >
      <span>{STATUS_LABELS[status] || status}</span>
      {status === 'disconnected' && (
        <button
          type="button"
          onClick={() => {
            // 连接逻辑在 App.tsx 中处理（需要 projectDir）
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#0A84FF',
            fontSize: 11,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          重新连接
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: 创建 MessageList 占位**

```typescript
// src/components/agent/MessageList.tsx
import { useEffect, useRef } from 'react';
import { useAgentStore } from '../../store/agent';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';

export function MessageList() {
  const messages = useAgentStore((s) => s.messages);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScrollRef.current = atBottom;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {messages.length === 0 && (
        <div style={{ textAlign: 'center', color: '#EBEBF530', padding: 40, fontSize: 13 }}>
          开始与 Claude Code 对话
        </div>
      )}
      {messages.map((msg, i) =>
        msg.role === 'user' ? (
          <UserMessage key={i} content={msg.content} />
        ) : (
          <AssistantMessage key={i} blocks={msg.blocks} />
        ),
      )}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 7: 创建 UserMessage**

```typescript
// src/components/agent/UserMessage.tsx
export function UserMessage({ content }: { content: string }) {
  return (
    <div
      style={{
        alignSelf: 'flex-end',
        background: '#0A84FF',
        color: '#fff',
        borderRadius: '16px 16px 4px 16px',
        padding: '8px 14px',
        fontSize: 13,
        lineHeight: 1.5,
        maxWidth: '85%',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {content}
    </div>
  );
}
```

- [ ] **Step 8: 创建 AssistantMessage 占位**

```typescript
// src/components/agent/AssistantMessage.tsx
import type { ContentBlock } from '../../store/agent';
import { TextBlock } from './TextBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { PermissionBlock } from './PermissionBlock';
import { ErrorBlock } from './ErrorBlock';

export function AssistantMessage({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '95%' }}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return <TextBlock key={i} text={block.text} />;
          case 'thinking':
            return <ThinkingBlock key={i} text={block.text} />;
          case 'tool_call':
            return <ToolCallBlock key={i} block={block} />;
          case 'permission_request':
            return <PermissionBlock key={i} block={block} />;
          case 'error':
            return <ErrorBlock key={i} message={block.message} />;
          case 'file_changed':
          case 'turn_complete':
            return null; // file_changed 在 ToolCallBlock 中展示，turn_complete 不渲染
          default:
            return null;
        }
      })}
    </div>
  );
}
```

- [ ] **Step 9: 提交**

```bash
git add src/components/agent/
git commit -m "feat(agent): AgentSidebar 抽屉容器 + InputBar + StatusBar + Header"
```

---

## Task 12: 消息渲染 — TextBlock + ThinkingBlock + ErrorBlock

**Files:**
- Create: `src/components/agent/TextBlock.tsx`
- Create: `src/components/agent/ThinkingBlock.tsx`
- Create: `src/components/agent/ErrorBlock.tsx`

- [ ] **Step 1: 创建 TextBlock（Markdown + shiki）**

```typescript
// src/components/agent/TextBlock.tsx
import { useMemo } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

// 注意：shiki 的 rehype 插件是异步的，第一期先用简单的 dangerouslySetInnerHTML 方案
// 后续可升级为 @shikijs/rehype 做服务端高亮

export function TextBlock({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      const result = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeStringify, { allowDangerousHtml: true })
        .processSync(text);
      return String(result);
    } catch {
      return text;
    }
  }, [text]);

  return (
    <div
      className="agent-markdown"
      style={{ fontSize: 13, lineHeight: 1.6, color: '#EBEBF5' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

> 注意：需要在全局 CSS 中添加 `.agent-markdown` 样式来美化 Markdown 渲染输出（代码块、表格、列表等）。shiki 高亮将在后续步骤中增量集成为异步 rehype 插件或客户端 highlighter。

- [ ] **Step 2: 创建 ThinkingBlock**

```typescript
// src/components/agent/ThinkingBlock.tsx
import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: '#2C2C2E',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          background: 'none',
          border: 'none',
          color: '#EBEBF560',
          fontSize: 12,
          fontStyle: 'italic',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Thinking...
      </button>
      {expanded && (
        <div
          style={{
            padding: '0 12px 10px',
            fontSize: 12,
            lineHeight: 1.5,
            color: '#EBEBF540',
            fontStyle: 'italic',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 创建 ErrorBlock**

```typescript
// src/components/agent/ErrorBlock.tsx
import { AlertCircle } from 'lucide-react';

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      style={{
        background: '#FF453A1A',
        border: '1px solid #FF453A40',
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <AlertCircle size={16} style={{ color: '#FF453A', flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontSize: 13, color: '#FF6961', lineHeight: 1.5 }}>{message}</div>
    </div>
  );
}
```

- [ ] **Step 4: 提交**

```bash
git add src/components/agent/TextBlock.tsx src/components/agent/ThinkingBlock.tsx src/components/agent/ErrorBlock.tsx
git commit -m "feat(agent): TextBlock Markdown 渲染 + ThinkingBlock + ErrorBlock"
```

---

## Task 13: ToolCallBlock + DiffView — 工具调用卡片

**Files:**
- Create: `src/components/agent/ToolCallBlock.tsx`
- Create: `src/components/agent/DiffView.tsx`
- Create: `src/components/agent/PermissionBlock.tsx`

- [ ] **Step 1: 创建 DiffView**

```typescript
// src/components/agent/DiffView.tsx
import { useMemo } from 'react';
import { createPatch } from 'diff';

interface DiffViewProps {
  filePath: string;
  before: string;
  after: string;
}

interface DiffLine {
  type: 'add' | 'del' | 'normal' | 'header';
  content: string;
  oldNum?: number;
  newNum?: number;
}

function parsePatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)/);
      if (match) oldNum = parseInt(match[1], 10);
      const match2 = line.match(/\+(\d+)/);
      if (match2) newNum = parseInt(match2[1], 10);
      lines.push({ type: 'header', content: line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      lines.push({ type: 'add', content: line.slice(1), newNum: newNum++ });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      lines.push({ type: 'del', content: line.slice(1), oldNum: oldNum++ });
    } else if (line.startsWith(' ')) {
      lines.push({ type: 'normal', content: line.slice(1), oldNum: oldNum++, newNum: newNum++ });
    }
  }

  return lines;
}

const lineColors: Record<string, { bg: string; color: string }> = {
  add: { bg: '#32D74B15', color: '#32D74B' },
  del: { bg: '#FF453A15', color: '#FF453A' },
  normal: { bg: 'transparent', color: '#EBEBF580' },
  header: { bg: '#0A84FF10', color: '#0A84FF' },
};

export function DiffView({ filePath, before, after }: DiffViewProps) {
  const diffLines = useMemo(() => {
    const patch = createPatch(filePath, before, after, '', '', { context: 3 });
    return parsePatch(patch);
  }, [filePath, before, after]);

  return (
    <div
      style={{
        background: '#1A1A1C',
        borderRadius: 6,
        overflow: 'hidden',
        fontSize: 12,
        fontFamily: 'SF Mono, Menlo, monospace',
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          padding: '6px 12px',
          background: '#2C2C2E',
          color: '#EBEBF580',
          fontSize: 11,
          borderBottom: '1px solid #38383A',
        }}
      >
        {filePath}
      </div>
      <div style={{ overflowX: 'auto' }}>
        {diffLines.map((line, i) => {
          const style = lineColors[line.type];
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                background: style.bg,
                minHeight: 20,
              }}
            >
              <span
                style={{
                  width: 40,
                  textAlign: 'right',
                  padding: '0 6px',
                  color: '#EBEBF530',
                  userSelect: 'none',
                  flexShrink: 0,
                }}
              >
                {line.oldNum ?? ''}
              </span>
              <span
                style={{
                  width: 40,
                  textAlign: 'right',
                  padding: '0 6px',
                  color: '#EBEBF530',
                  userSelect: 'none',
                  flexShrink: 0,
                }}
              >
                {line.newNum ?? ''}
              </span>
              <span
                style={{
                  padding: '0 8px',
                  color: style.color,
                  whiteSpace: 'pre',
                }}
              >
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'header' ? '' : ' '}
                {line.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 ToolCallBlock**

```typescript
// src/components/agent/ToolCallBlock.tsx
import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText, Terminal, Loader2 } from 'lucide-react';
import type { ToolCallBlock as ToolCallBlockType } from '../../store/agent';

const TOOL_ICONS: Record<string, typeof FileText> = {
  read_text_file: FileText,
  write_text_file: FileText,
  create_terminal: Terminal,
  terminal_execute: Terminal,
  kill_terminal: Terminal,
};

export function ToolCallBlock({ block }: { block: ToolCallBlockType }) {
  const [inputExpanded, setInputExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(true);

  const Icon = TOOL_ICONS[block.title] || FileText;
  const isRunning = block.status === 'running';

  return (
    <div
      style={{
        background: '#2C2C2E',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #38383A',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid #38383A',
        }}
      >
        <Icon size={14} style={{ color: '#EBEBF560' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#EBEBF5', flex: 1 }}>
          {block.title}
        </span>
        {isRunning && <Loader2 size={14} style={{ color: '#0A84FF', animation: 'spin 1s linear infinite' }} />}
        {!isRunning && (
          <span style={{ fontSize: 11, color: '#32D74B' }}>done</span>
        )}
      </div>

      {/* Input */}
      {block.rawInput && (
        <div>
          <button
            type="button"
            onClick={() => setInputExpanded((e) => !e)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 12px',
              background: 'none',
              border: 'none',
              borderBottom: inputExpanded ? '1px solid #38383A' : 'none',
              color: '#EBEBF560',
              fontSize: 11,
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
          >
            {inputExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Input
          </button>
          {inputExpanded && (
            <pre
              style={{
                padding: '8px 12px',
                margin: 0,
                fontSize: 11,
                color: '#EBEBF580',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {block.rawInput}
            </pre>
          )}
        </div>
      )}

      {/* Output */}
      {block.rawOutput && (
        <div>
          <button
            type="button"
            onClick={() => setOutputExpanded((e) => !e)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 12px',
              background: 'none',
              border: 'none',
              borderBottom: outputExpanded ? '1px solid #38383A' : 'none',
              color: '#EBEBF560',
              fontSize: 11,
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
          >
            {outputExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Output
          </button>
          {outputExpanded && (
            <pre
              style={{
                padding: '8px 12px',
                margin: 0,
                fontSize: 11,
                color: '#EBEBF580',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 300,
                overflow: 'auto',
                background: '#1A1A1C',
              }}
            >
              {block.rawOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 创建 PermissionBlock**

```typescript
// src/components/agent/PermissionBlock.tsx
import { Shield } from 'lucide-react';
import type { PermissionBlock as PermissionBlockType } from '../../store/agent';
import { useAgentStore } from '../../store/agent';

export function PermissionBlock({ block }: { block: PermissionBlockType }) {
  const responded = Boolean(block.response);

  const handleRespond = (optionId: string) => {
    window.agentAPI?.respondPermission(block.requestId, optionId);
    useAgentStore.getState().resolvePermission(block.requestId, optionId);
  };

  return (
    <div
      style={{
        background: '#FFD60A15',
        border: '1px solid #FFD60A40',
        borderRadius: 8,
        padding: '10px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Shield size={14} style={{ color: '#FFD60A' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#FFD60A' }}>
          权限请求
        </span>
      </div>

      <div style={{ fontSize: 12, color: '#EBEBF580', marginBottom: 10 }}>
        {JSON.stringify(block.toolCall, null, 2)}
      </div>

      {!responded && (
        <div style={{ display: 'flex', gap: 8 }}>
          {block.options.map((opt) => (
            <button
              key={opt.optionId}
              type="button"
              onClick={() => handleRespond(opt.optionId)}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: opt.kind.startsWith('allow') ? '#32D74B' : '#FF453A',
                color: '#fff',
              }}
            >
              {opt.name}
            </button>
          ))}
        </div>
      )}

      {responded && (
        <span style={{ fontSize: 12, color: '#EBEBF550', fontStyle: 'italic' }}>
          已响应
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 提交**

```bash
git add src/components/agent/ToolCallBlock.tsx src/components/agent/DiffView.tsx src/components/agent/PermissionBlock.tsx
git commit -m "feat(agent): ToolCallBlock + DiffView + PermissionBlock 消息渲染"
```

---

## Task 14: AgentSettingsTab — Agent SDK 管理界面

**Files:**
- Create: `src/components/settings/AgentSettingsTab.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: 创建 AgentSettingsTab**

```typescript
// src/components/settings/AgentSettingsTab.tsx
import { useState, useEffect, useCallback } from 'react';
import { Bot, Eye, EyeOff, RefreshCw, Loader2, Download, Trash2 } from 'lucide-react';
import type { AgentConfigData, PreflightCheck, PermissionPolicy } from '../../../electron/acp/types';
import { Field, Input, Divider } from '../../ui';

const DEFAULT_AGENT_ENTRY = {
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

export function AgentSettingsTab() {
  const [config, setConfig] = useState<AgentConfigData | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [checks, setChecks] = useState<PreflightCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const agent = config?.agents?.['claude-acp'] ?? DEFAULT_AGENT_ENTRY;

  useEffect(() => {
    loadConfig();
    runChecks();
  }, []);

  const loadConfig = async () => {
    const data = await window.agentAPI.getConfig();
    setConfig(data);
    const key = await window.agentAPI.getApiKey('claude-acp');
    setApiKey(key);
  };

  const runChecks = async () => {
    setChecking(true);
    const results = await window.agentAPI.runPreflight();
    setChecks(results);
    setChecking(false);
  };

  const updateAgent = useCallback(
    (patch: Partial<typeof DEFAULT_AGENT_ENTRY>) => {
      if (!config) return;
      setConfig({
        ...config,
        agents: {
          ...config.agents,
          'claude-acp': { ...agent, ...patch },
        },
      });
    },
    [config, agent],
  );

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    await window.agentAPI.saveConfig(config);
    if (apiKey) {
      await window.agentAPI.setApiKey('claude-acp', apiKey);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleInstall = async () => {
    setBusyAction('install');
    await window.agentAPI.installAgent(agent.version);
    setBusyAction(null);
    await runChecks();
  };

  const handleUninstall = async () => {
    if (!confirm('确认卸载 claude-agent-acp？')) return;
    setBusyAction('uninstall');
    await window.agentAPI.uninstallAgent();
    setBusyAction(null);
    await runChecks();
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'pass': return <span style={{ color: '#32D74B' }}>✓</span>;
      case 'fail': return <span style={{ color: '#FF453A' }}>✗</span>;
      case 'warn': return <span style={{ color: '#FFD60A' }}>⚠</span>;
      case 'checking': return <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />;
      default: return null;
    }
  };

  if (!config) return <div style={{ color: '#EBEBF550', padding: 20 }}>加载中...</div>;

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Bot size={24} style={{ color: '#FF6B35' }} />
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Claude Code</h2>
          <p style={{ fontSize: 12, color: '#EBEBF560', margin: '2px 0 0' }}>
            ACP 适配器 · npx
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#EBEBF5' }}>
          <input
            type="checkbox"
            checked={agent.enabled}
            onChange={(e) => updateAgent({ enabled: e.target.checked })}
          />
          启用
        </label>
      </div>

      {/* 预检 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>状态检查</span>
          <button
            type="button"
            onClick={runChecks}
            disabled={checking}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0A84FF', padding: 0 }}
          >
            <RefreshCw size={14} style={checking ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {checks.map((check, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                background: '#2C2C2E',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              {statusIcon(check.status)}
              <span style={{ fontWeight: 500, minWidth: 120 }}>{check.label}</span>
              <span style={{ flex: 1, color: '#EBEBF580' }}>{check.message}</span>
              {check.fixAction === 'install' && (
                <button
                  type="button"
                  onClick={handleInstall}
                  disabled={busyAction !== null}
                  style={{
                    background: '#0A84FF',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '3px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {busyAction === 'install' ? '安装中...' : '安装'}
                </button>
              )}
              {check.fixAction === 'upgrade' && (
                <button
                  type="button"
                  onClick={handleInstall}
                  disabled={busyAction !== null}
                  style={{
                    background: '#FFD60A',
                    color: '#000',
                    border: 'none',
                    borderRadius: 4,
                    padding: '3px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  升级
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <Divider label="认证配置" />

      {/* 认证方式 */}
      <div style={{ display: 'flex', gap: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="radio"
            name="authMode"
            checked={agent.authMode === 'subscription'}
            onChange={() => updateAgent({ authMode: 'subscription' })}
          />
          官方订阅 (Max/Pro)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="radio"
            name="authMode"
            checked={agent.authMode === 'custom_api'}
            onChange={() => updateAgent({ authMode: 'custom_api' })}
          />
          自定义 API
        </label>
      </div>

      {agent.authMode === 'custom_api' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="API Key">
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EBEBF560', padding: 4 }}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
          <Field label="API Base URL">
            <Input
              value={agent.apiBaseUrl}
              onChange={(e) => updateAgent({ apiBaseUrl: e.target.value })}
              placeholder="https://api.anthropic.com"
            />
          </Field>
          <Field label="Model">
            <Input
              value={agent.model}
              onChange={(e) => updateAgent({ model: e.target.value })}
              placeholder="claude-sonnet-4-20250514"
            />
          </Field>
        </div>
      )}

      <Divider label="高级配置" />

      <Field label="环境变量">
        <textarea
          value={agent.envText}
          onChange={(e) => updateAgent({ envText: e.target.value })}
          placeholder="KEY=VALUE（每行一条）"
          rows={4}
          style={{
            width: '100%',
            background: '#2C2C2E',
            color: '#EBEBF5',
            border: '1px solid #48484A',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            fontFamily: 'SF Mono, Menlo, monospace',
            resize: 'vertical',
          }}
        />
      </Field>

      <Field label="JSON 配置">
        <textarea
          value={agent.configJson}
          onChange={(e) => updateAgent({ configJson: e.target.value })}
          placeholder="{}"
          rows={4}
          style={{
            width: '100%',
            background: '#2C2C2E',
            color: '#EBEBF5',
            border: '1px solid #48484A',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            fontFamily: 'SF Mono, Menlo, monospace',
            resize: 'vertical',
          }}
        />
      </Field>

      <Divider label="权限策略" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(['auto_approve', 'tiered', 'always_ask'] as PermissionPolicy[]).map((p) => (
          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="radio"
              name="permissionPolicy"
              checked={config.permissionPolicy === p}
              onChange={() => {
                setConfig({ ...config, permissionPolicy: p });
                window.agentAPI.setPermissionPolicy(p);
              }}
            />
            {p === 'auto_approve' && '自动批准所有操作'}
            {p === 'tiered' && '分级信任（读自动，写和终端需确认）'}
            {p === 'always_ask' && '每次操作都需确认'}
          </label>
        ))}
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          onClick={handleUninstall}
          disabled={busyAction !== null}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: '1px solid #FF453A40',
            background: 'transparent',
            color: '#FF453A',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={14} style={{ marginRight: 6 }} />
          卸载
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px',
            borderRadius: 8,
            border: 'none',
            background: saved ? '#32D74B' : '#0A84FF',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {saved ? '已保存 ✓' : saving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: 修改 Settings.tsx 添加 Agent Tab**

在 `src/pages/Settings.tsx` 中：

1. Import AgentSettingsTab：
```typescript
import { AgentSettingsTab } from '../components/settings/AgentSettingsTab';
```

2. 在 `SettingsTab` 类型中添加 `'agent'`：
```typescript
type SettingsTab = 'ai-config' | 'templates' | 'review' | 'tts' | 'agent';
```

3. 在 `TABS` 数组中添加：
```typescript
import { ArrowLeft, Bot, FileText, MessageSquare, Volume2, Cpu } from 'lucide-react';

// TABS 数组中追加：
{ id: 'agent', label: 'AI Agent', icon: Cpu },
```

4. 在 `renderTab` switch 中添加：
```typescript
case 'agent': return <AgentSettingsTab />;
```

5. 调整 `.content` 样式以适配 Agent Tab 双面板（当前 `max-width: 680px` 对于 Agent Tab 可能需要扩展）：

在 `Settings.module.css` 的 `.content` 中，将 `max-width: 680px` 保留（第一期 Agent 设置页不做双面板左右分栏——只有一个 Agent，直接在右侧内容区展示配置即可，左侧 Agent 列表在只有一个 Agent 时没有实际意义。双面板在第二期多 Agent 时再实现）。

- [ ] **Step 3: 提交**

```bash
git add src/components/settings/AgentSettingsTab.tsx src/pages/Settings.tsx
git commit -m "feat(agent): AgentSettingsTab Agent SDK 管理界面"
```

---

## Task 15: App 集成 — Toolbar 按钮 + 侧边栏接入

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/electron-api.ts`

- [ ] **Step 1: Toolbar 添加 Agent 按钮**

在 `src/components/Toolbar.tsx` 的右侧操作区（`<div className={styles.actions}>`）中，在导出按钮之前（或之后）添加 Agent 按钮：

```typescript
// 添加 import
import { BotMessageSquare } from 'lucide-react';
import { useAgentStore } from '../store/agent';

// 在 Toolbar 组件内：
const toggleAgent = useAgentStore((s) => s.toggleSidebar);
const agentStatus = useAgentStore((s) => s.status);

// 在右侧操作区 actions div 内，导出按钮之前添加：
<Button.Icon
  variant="ghost"
  aria-label="AI Agent"
  title="AI Agent (⌘⇧A)"
  onClick={toggleAgent}
>
  <BotMessageSquare
    size={16}
    style={{
      color: agentStatus === 'connected' || agentStatus === 'prompting' ? '#32D74B' : undefined,
    }}
  />
</Button.Icon>
```

- [ ] **Step 2: App.tsx 集成 AgentSidebar + 快捷键**

在 `src/App.tsx` 中：

1. Import：
```typescript
import { AgentSidebar } from './components/agent/AgentSidebar';
import { useAgentStore } from './store/agent';
```

2. 在 App 组件内的 `handleKeyDown` 中添加 `Cmd+Shift+A` 快捷键（在 `getAppShortcutCommand` 之前添加独立处理）：

```typescript
// 在 handleKeyDown 回调内，getAppShortcutCommand 调用之前：
if (event.metaKey && event.shiftKey && event.key === 'a') {
  event.preventDefault();
  useAgentStore.getState().toggleSidebar();
  return;
}
```

3. 在 return 的 JSX 中，`<Toolbar ... />` 之后、内容区之前（或之后），添加 AgentSidebar：

```tsx
{/* 在 </div> 最外层闭合标签之前添加 */}
<AgentSidebar />
```

4. 在项目打开（`openProject`）时自动连接 Agent：

在 `openProject` 的成功流程末尾（`setPage(...)` 之后）添加：

```typescript
// 自动连接 Agent（如果可用）
if (typeof window.agentAPI !== 'undefined') {
  window.agentAPI.connect(projectDir).catch(() => {
    // 连接失败静默忽略，用户可手动重连
  });
}
```

- [ ] **Step 3: 在 electron-api.ts 中引入 agent-api 类型**

在 `src/lib/electron-api.ts` 顶部添加：

```typescript
// 引入 AgentAPI 类型声明
import './agent-api';
```

- [ ] **Step 4: 验证编译**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npx tsc --noEmit
```

Expected: 无类型错误（或仅有可处理的错误）

- [ ] **Step 5: 提交**

```bash
git add src/components/Toolbar.tsx src/App.tsx src/lib/electron-api.ts
git commit -m "feat(agent): 集成 AgentSidebar 到主界面，Toolbar 按钮 + Cmd+Shift+A 快捷键"
```

---

## Task 16: 端到端连通 — 验证完整链路

**Files:** 无新文件，验证现有集成

- [ ] **Step 1: 运行全部单元测试**

```bash
npx vitest run tests/acp-types.test.ts tests/acp-config.test.ts tests/acp-client.test.ts tests/acp-fs-runtime.test.ts tests/acp-permission.test.ts tests/acp-preflight.test.ts tests/agent-store.test.ts
```

Expected: 全部 PASS

- [ ] **Step 2: 启动开发服务器验证 UI**

```bash
npm run dev
```

验证清单：
1. 应用正常启动，无 crash
2. Toolbar 右侧出现 Agent 按钮（BotMessageSquare 图标）
3. 点击按钮，右侧滑出 AgentSidebar 抽屉
4. 抽屉显示 "未连接" 状态
5. Cmd+Shift+A 可切换抽屉
6. 拖拽左边缘可调整宽度
7. Settings → Agent Tab 正常渲染预检状态

- [ ] **Step 3: 验证 Agent 连接（需要已安装 claude-agent-acp）**

1. 在 Settings → Agent Tab 配置 API Key
2. 保存配置
3. 打开一个项目
4. 抽屉中输入 "hello" 并发送
5. 观察是否收到 Claude Code 的流式响应

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat(agent): AI Agent ACP 集成完成，端到端验证通过"
```

---

## 附录：Markdown 全局样式

在 `src/ui/styles/` 或全局 CSS 中添加 `.agent-markdown` 样式（第一期基础版，后续可在 shiki 集成时增强）：

```css
/* 添加到合适的全局 CSS 文件中 */
.agent-markdown p { margin: 0 0 8px; }
.agent-markdown p:last-child { margin-bottom: 0; }
.agent-markdown pre {
  background: #1A1A1C;
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.agent-markdown code {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
}
.agent-markdown :not(pre) > code {
  background: #2C2C2E;
  padding: 2px 6px;
  border-radius: 4px;
}
.agent-markdown ul, .agent-markdown ol { padding-left: 20px; margin: 4px 0; }
.agent-markdown table { border-collapse: collapse; width: 100%; margin: 8px 0; }
.agent-markdown th, .agent-markdown td {
  border: 1px solid #38383A;
  padding: 6px 10px;
  text-align: left;
  font-size: 12px;
}
.agent-markdown th { background: #2C2C2E; font-weight: 600; }
.agent-markdown a { color: #0A84FF; text-decoration: none; }
.agent-markdown blockquote {
  border-left: 3px solid #48484A;
  padding-left: 12px;
  margin: 8px 0;
  color: #EBEBF580;
}
.agent-markdown h1, .agent-markdown h2, .agent-markdown h3 {
  margin: 12px 0 6px;
  font-weight: 600;
}
.agent-markdown h1 { font-size: 16px; }
.agent-markdown h2 { font-size: 15px; }
.agent-markdown h3 { font-size: 14px; }
```

此 CSS 需要在 Task 12 的 TextBlock 可正常工作之前加入项目。可以在 Task 12 的步骤中创建为独立 CSS 文件并 import。

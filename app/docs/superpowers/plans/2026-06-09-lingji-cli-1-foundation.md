# 灵机 CLI Plan 1 — 基座 + 项目/任务命令 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可用的 `lingji` 命令行工具，能连接已启动应用的 MCP 服务，查询当前项目、最近项目，以及任务的 status/list/cancel/wait。

**Architecture:** CLI 作为 MCP 客户端通过 Streamable HTTP 连接 `127.0.0.1:<port>/mcp`。端口由应用启动时写入的 `~/.lingji/mcp-endpoint.json` 发现。项目/任务命令复用既有 MCP 工具，仅新增两个极小的 headless 工具（`lingji_get_active_project`、`lingji_list_recent_projects`）。

**Tech Stack:** TypeScript（ESM）、`@modelcontextprotocol/sdk` client、esbuild 打包、Vitest（node 环境）。

参考 spec：`docs/superpowers/specs/2026-06-09-lingji-cli-design.md`（§5 命令面、§6 端口发现、§7 错误处理、§9.1 分解 Plan 1）。

---

## File Structure

新增/修改文件及职责：

- `electron/mcp/endpoint-file.ts`（新增）：写/删 `~/.lingji/mcp-endpoint.json`。单一职责：端点发现文件 I/O。
- `electron/mcp/server.ts`（修改）：在 `startMcpServer` 的 listen 回调写端点文件，在 `stopMcpServer` 关闭后删除。
- `electron/pipeline/tools/register.ts`（修改）：新增 `lingji_get_active_project`、`lingji_list_recent_projects` 两个 headless 工具。
- `cli/src/errors.ts`（新增）：`CliError`（带 code 与 exitCode）。
- `cli/src/endpoint.ts`（新增）：`resolveServerUrl`，解析服务地址（--server > 环境变量 > 端点文件 > 默认）。
- `cli/src/result.ts`（新增）：`parseToolResult`（解析 `{content:[{text}]}` 信封、`isError` 抛错）。不导入 SDK，便于纯函数单测。
- `cli/src/client.ts`（新增）：MCP 客户端连接（`connectClient`），调用 `parseToolResult`。
- `cli/src/args.ts`（新增）：极简参数解析。
- `cli/src/format.ts`（新增）：人类可读 / `--json` 输出格式化。
- `cli/src/commands/project.ts`（新增）：`project current/list/open` → 工具调用。
- `cli/src/commands/task.ts`（新增）：`task status/list/cancel/wait`（wait 轮询至终态）。
- `cli/src/index.ts`（新增）：入口，分发命令、处理「应用未启动」、退出码。
- `scripts/build-cli.cjs`（新增）：esbuild 打包 CLI 到 `dist-cli/lingji.mjs`。
- `package.json`（修改）：`bin.lingji` + `build:cli` 脚本。
- 测试：`tests/cli-endpoint-file.test.ts`、`tests/cli-endpoint.test.ts`、`tests/cli-client.test.ts`、`tests/cli-args.test.ts`、`tests/cli-format.test.ts`、`tests/cli-project-command.test.ts`、`tests/cli-task-command.test.ts`，并修改 `tests/pipeline-mcp-registration.test.ts`。

---

## Task 1: 端点发现文件模块

**Files:**
- Create: `electron/mcp/endpoint-file.ts`
- Test: `tests/cli-endpoint-file.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-endpoint-file.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeEndpointFile, removeEndpointFile } from '../electron/mcp/endpoint-file';

describe('endpoint-file', () => {
  it('writes endpoint json with url/port/pid/startedAt then removes it', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-ep-'));
    const file = path.join(dir, 'sub', 'mcp-endpoint.json');
    try {
      await writeEndpointFile(19820, file);
      expect(existsSync(file)).toBe(true);
      const info = JSON.parse(readFileSync(file, 'utf-8'));
      expect(info.url).toBe('http://127.0.0.1:19820/mcp');
      expect(info.port).toBe(19820);
      expect(typeof info.pid).toBe('number');
      expect(typeof info.startedAt).toBe('number');
      await removeEndpointFile(file);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removeEndpointFile is a no-op when file missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-ep-'));
    try {
      await expect(removeEndpointFile(path.join(dir, 'nope.json'))).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/cli-endpoint-file.test.ts`
Expected: FAIL（找不到模块 `../electron/mcp/endpoint-file`）。

- [ ] **Step 3: 实现模块**

```ts
// electron/mcp/endpoint-file.ts
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const LINGJI_DIR = join(homedir(), '.lingji');
export const ENDPOINT_FILE = join(LINGJI_DIR, 'mcp-endpoint.json');

export interface McpEndpointInfo {
  url: string;
  port: number;
  pid: number;
  startedAt: number;
}

/** 应用启动 MCP 服务后写入端点发现文件 */
export async function writeEndpointFile(
  port: number,
  file: string = ENDPOINT_FILE,
): Promise<void> {
  const info: McpEndpointInfo = {
    url: `http://127.0.0.1:${port}/mcp`,
    port,
    pid: process.pid,
    startedAt: Date.now(),
  };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(info, null, 2), 'utf-8');
}

/** 服务停止时删除端点文件（文件不存在时静默） */
export async function removeEndpointFile(
  file: string = ENDPOINT_FILE,
): Promise<void> {
  await rm(file, { force: true });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/cli-endpoint-file.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add electron/mcp/endpoint-file.ts tests/cli-endpoint-file.test.ts
git commit -m "feat(cli): MCP 端点发现文件读写模块"
```

---

## Task 2: 在 MCP 服务启停处接入端点文件

**Files:**
- Modify: `electron/mcp/server.ts`（listen 回调 + stopMcpServer）
- Test: `tests/cli-endpoint-file.test.ts`（追加源码断言）

源码断言测试（参照 `tests/mcp-tools.test.ts` 的 readFileSync 模式），因为真正启动 HTTP 服务不适合单测。

- [ ] **Step 1: 追加失败测试**

在 `tests/cli-endpoint-file.test.ts` 末尾追加：

```ts
import { readFileSync as readSrc } from 'node:fs';

describe('server.ts endpoint wiring', () => {
  it('startMcpServer writes and stopMcpServer removes the endpoint file', () => {
    const src = readSrc(new URL('../electron/mcp/server.ts', import.meta.url), 'utf8');
    expect(src).toContain("from './endpoint-file'");
    expect(src).toContain('writeEndpointFile(');
    expect(src).toContain('removeEndpointFile(');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-endpoint-file.test.ts`
Expected: FAIL（server.ts 尚未引用 endpoint-file）。

- [ ] **Step 3: 修改 server.ts**

在文件顶部 import 区加入：

```ts
import { writeEndpointFile, removeEndpointFile } from './endpoint-file';
```

在 `startMcpServer` 的 `listen` 回调内（`console.log` 之后、`resolve()` 之前）加入：

```ts
    httpServer!.listen(port, '127.0.0.1', () => {
      console.log(`[MCP] HTTP Server 已启动: http://127.0.0.1:${port}/mcp`);
      void writeEndpointFile(port).catch((err) =>
        console.error('[MCP] 写端点文件失败:', err),
      );
      resolve();
    });
```

在 `stopMcpServer` 中 `httpServer = null;` 之后加入：

```ts
    httpServer = null;
    void removeEndpointFile().catch(() => {});
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli-endpoint-file.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add electron/mcp/server.ts tests/cli-endpoint-file.test.ts
git commit -m "feat(cli): MCP 服务启停时写/删端点发现文件"
```

---

## Task 3: 新增 `lingji_get_active_project` 工具

**Files:**
- Modify: `electron/pipeline/tools/register.ts`
- Test: `tests/cli-active-project-tool.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-active-project-tool.test.ts
import { describe, it, expect } from 'vitest';
import { registerPipelineMcpTools } from '../electron/pipeline/tools/register';
import { setActiveProjectPath } from '../electron/pipeline/context';

class FakeMcpServer {
  tools = new Map<string, { def: unknown; handler: (args: unknown) => unknown }>();
  registerTool(name: string, def: unknown, handler: (args: unknown) => unknown): void {
    this.tools.set(name, { def, handler });
  }
}

function build(): FakeMcpServer {
  const server = new FakeMcpServer();
  registerPipelineMcpTools(
    server as unknown as Parameters<typeof registerPipelineMcpTools>[0],
    () => null,
    () => '/tmp/lingji-fake-userdata',
  );
  return server;
}

describe('lingji_get_active_project', () => {
  it('returns the active project path set via setActiveProjectPath', async () => {
    setActiveProjectPath('/tmp/some/project');
    const handler = build().tools.get('lingji_get_active_project')!.handler;
    const result = (await handler({})) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.projectPath).toBe('/tmp/some/project');
  });

  it('returns null when no active project', async () => {
    setActiveProjectPath(null);
    const handler = build().tools.get('lingji_get_active_project')!.handler;
    const result = (await handler({})) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.projectPath).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-active-project-tool.test.ts`
Expected: FAIL（`server.tools.get('lingji_get_active_project')` 为 undefined）。

- [ ] **Step 3: 实现**

在 `electron/pipeline/tools/register.ts` 顶部 import 区加入：

```ts
import { getActiveProjectPath } from '../context';
```

在 `registerPipelineMcpTools` 函数体内、`lingji_list_tasks` 注册块之后（`}` 前）加入：

```ts
  server.registerTool(
    'lingji_get_active_project',
    {
      title: '查询当前活动项目',
      description:
        '返回应用当前打开/活动的项目目录路径（由渲染进程 load-project 设置）；无活动项目时返回 null。CLI 默认项目即取此值。',
    },
    async () => {
      try {
        return jsonResult({ projectPath: getActiveProjectPath() });
      } catch (err) {
        return errorResult(pipelineErrorMessage(err), pipelineErrorCode(err));
      }
    },
  );
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli-active-project-tool.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/tools/register.ts tests/cli-active-project-tool.test.ts
git commit -m "feat(cli): lingji_get_active_project 工具"
```

---

## Task 4: 新增 `lingji_list_recent_projects` 工具

**Files:**
- Modify: `electron/pipeline/tools/register.ts`
- Test: `tests/cli-recent-projects-tool.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-recent-projects-tool.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { registerPipelineMcpTools } from '../electron/pipeline/tools/register';

class FakeMcpServer {
  tools = new Map<string, { def: unknown; handler: (args: unknown) => unknown }>();
  registerTool(name: string, def: unknown, handler: (args: unknown) => unknown): void {
    this.tools.set(name, { def, handler });
  }
}

describe('lingji_list_recent_projects', () => {
  it('returns recent projects from userData recent-projects.json', async () => {
    const userData = mkdtempSync(path.join(os.tmpdir(), 'lingji-ud-'));
    // 同时建一个真实项目目录，loadRecentProjects 会过滤掉不存在的 path
    const proj = mkdtempSync(path.join(os.tmpdir(), 'lingji-proj-'));
    try {
      writeFileSync(
        path.join(userData, 'recent-projects.json'),
        JSON.stringify([{ path: proj, name: 'demo', lastOpenedAt: 1 }]),
      );
      const server = new FakeMcpServer();
      registerPipelineMcpTools(
        server as unknown as Parameters<typeof registerPipelineMcpTools>[0],
        () => null,
        () => userData,
      );
      const handler = server.tools.get('lingji_list_recent_projects')!.handler;
      const result = (await handler({})) as { content: { text: string }[] };
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].name).toBe('demo');
      expect(parsed[0].path).toBe(proj);
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(proj, { recursive: true, force: true });
    }
  });
});
```

> 注：`loadRecentProjects` 的文件名常量为 `recent-projects.json`（见 `electron/recent-projects.ts` 的 `RECENT_PROJECTS_FILE`）。若实际常量名不同，按源码改测试里的文件名。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-recent-projects-tool.test.ts`
Expected: FAIL（工具未注册）。

- [ ] **Step 3: 实现**

在 `register.ts` 顶部 import 区加入：

```ts
import { loadRecentProjects } from '../../recent-projects';
```

在 `register.ts` 的 `lingji_get_active_project` 注册块之后加入：

```ts
  server.registerTool(
    'lingji_list_recent_projects',
    {
      title: '列出最近项目',
      description:
        '返回最近打开过的项目列表（每项含 path/name/lastOpenedAt）；已不存在的项目目录会被过滤。',
    },
    async () => {
      try {
        return jsonResult(await loadRecentProjects(getUserDataPath()));
      } catch (err) {
        return errorResult(pipelineErrorMessage(err), pipelineErrorCode(err));
      }
    },
  );
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli-recent-projects-tool.test.ts`
Expected: PASS（1 passed）。

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/tools/register.ts tests/cli-recent-projects-tool.test.ts
git commit -m "feat(cli): lingji_list_recent_projects 工具"
```

---

## Task 5: 更新工具注册数量断言

**Files:**
- Modify: `tests/pipeline-mcp-registration.test.ts`

`registerPipelineMcpTools` 现注册 9 个工具（原 7 + 新 2）。

- [ ] **Step 1: 修改测试期望**

把 `tests/pipeline-mcp-registration.test.ts` 中 `expected` 数组与数量断言改为：

```ts
    const expected = [
      'lingji_create_project',
      'lingji_open_project',
      'lingji_get_project_state',
      'lingji_get_settings',
      'lingji_get_task_status',
      'lingji_cancel_task',
      'lingji_list_tasks',
      'lingji_get_active_project',
      'lingji_list_recent_projects',
    ];
    for (const name of expected) {
      expect(server.tools.has(name)).toBe(true);
    }
    expect(server.tools.size).toBeGreaterThanOrEqual(9);
```

- [ ] **Step 2: 运行确认通过**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add tests/pipeline-mcp-registration.test.ts
git commit -m "test(cli): 注册工具数量更新为 9"
```

---

## Task 6: CLI 错误类型

**Files:**
- Create: `cli/src/errors.ts`

无独立测试（纯类型，被后续测试覆盖）。

- [ ] **Step 1: 实现**

```ts
// cli/src/errors.ts
/** CLI 内部错误：带错误码与进程退出码 */
export class CliError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add cli/src/errors.ts
git commit -m "feat(cli): CliError 类型"
```

---

## Task 7: 服务地址解析

**Files:**
- Create: `cli/src/endpoint.ts`
- Test: `tests/cli-endpoint.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-endpoint.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveServerUrl } from '../cli/src/endpoint';

describe('resolveServerUrl', () => {
  it('prefers --server flag and appends /mcp when missing', () => {
    expect(resolveServerUrl({ serverFlag: 'http://127.0.0.1:9000', env: {}, endpointFile: '/no' }))
      .toBe('http://127.0.0.1:9000/mcp');
    expect(resolveServerUrl({ serverFlag: 'http://127.0.0.1:9000/mcp', env: {}, endpointFile: '/no' }))
      .toBe('http://127.0.0.1:9000/mcp');
  });

  it('falls back to LINGJI_MCP_URL env', () => {
    expect(resolveServerUrl({ env: { LINGJI_MCP_URL: 'http://h:1/mcp' }, endpointFile: '/no' }))
      .toBe('http://h:1/mcp');
  });

  it('reads url from endpoint file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-rf-'));
    const file = path.join(dir, 'mcp-endpoint.json');
    try {
      writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:7777/mcp', port: 7777 }));
      expect(resolveServerUrl({ env: {}, endpointFile: file })).toBe('http://127.0.0.1:7777/mcp');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults to 19820 when nothing else resolves', () => {
    expect(resolveServerUrl({ env: {}, endpointFile: '/definitely/missing' }))
      .toBe('http://127.0.0.1:19820/mcp');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-endpoint.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// cli/src/endpoint.ts
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:19820/mcp';
const DEFAULT_ENDPOINT_FILE = join(homedir(), '.lingji', 'mcp-endpoint.json');

export interface ResolveOptions {
  serverFlag?: string;
  env?: Record<string, string | undefined>;
  endpointFile?: string;
}

/** 解析 MCP 服务地址：--server > LINGJI_MCP_URL > 端点文件 > 默认 */
export function resolveServerUrl(opts: ResolveOptions = {}): string {
  if (opts.serverFlag) return normalize(opts.serverFlag);
  const env = opts.env ?? process.env;
  if (env.LINGJI_MCP_URL) return normalize(env.LINGJI_MCP_URL);
  const file = opts.endpointFile ?? DEFAULT_ENDPOINT_FILE;
  if (existsSync(file)) {
    try {
      const info = JSON.parse(readFileSync(file, 'utf-8'));
      if (typeof info?.url === 'string') return info.url;
      if (typeof info?.port === 'number') return `http://127.0.0.1:${info.port}/mcp`;
    } catch {
      // 文件损坏则回退默认
    }
  }
  return DEFAULT_URL;
}

function normalize(url: string): string {
  const trimmed = url.replace(/\/$/, '');
  return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli-endpoint.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add cli/src/endpoint.ts tests/cli-endpoint.test.ts
git commit -m "feat(cli): 服务地址解析（flag/env/端点文件/默认）"
```

---

## Task 8: 结果解析 + MCP 客户端封装

**Files:**
- Create: `cli/src/result.ts`、`cli/src/client.ts`
- Test: `tests/cli-client.test.ts`

`parseToolResult` 放在不依赖 SDK 的 `result.ts`，便于纯函数单测（避免在单测中加载 MCP SDK 运行时）；`connectClient` 在 `client.ts` 依赖真实服务，仅手动验收覆盖。

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-client.test.ts
import { describe, it, expect } from 'vitest';
import { parseToolResult } from '../cli/src/result';

describe('parseToolResult', () => {
  it('parses JSON text content', () => {
    const r = { content: [{ type: 'text', text: JSON.stringify({ projectPath: '/p' }) }] };
    expect(parseToolResult(r)).toEqual({ projectPath: '/p' });
  });

  it('throws with code when isError', () => {
    const r = {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: '无效项目', code: 'invalid_project' }) }],
    };
    try {
      parseToolResult(r);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toBe('无效项目');
      expect(e.code).toBe('invalid_project');
    }
  });

  it('returns null for empty content', () => {
    expect(parseToolResult({ content: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-client.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 result.ts（纯解析，无 SDK）**

```ts
// cli/src/result.ts
import { CliError } from './errors';

/** 解析 MCP 工具返回的 { content:[{text}], isError } 信封 */
export function parseToolResult(result: unknown): unknown {
  const r = result as { content?: Array<{ text?: string }>; isError?: boolean };
  const text = r?.content?.[0]?.text;
  const data = text ? JSON.parse(text) : null;
  if (r?.isError) {
    const obj = (data ?? {}) as { error?: string; message?: string; code?: string };
    const msg = obj.error ?? obj.message ?? 'MCP 工具返回错误';
    throw new CliError(String(msg), obj.code ?? 'tool_error');
  }
  return data;
}
```

- [ ] **Step 4: 实现 client.ts（连接 + 调用）**

```ts
// cli/src/client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CliError } from './errors';
import { parseToolResult } from './result';

export interface ToolCaller {
  call(name: string, args?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/** 连接已启动应用的 MCP 服务，返回工具调用器 */
export async function connectClient(url: string): Promise<ToolCaller> {
  const client = new Client({ name: 'lingji-cli', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  try {
    await client.connect(transport);
  } catch {
    throw new CliError(
      `未发现运行中的灵机剪影 MCP 服务（${url}）。请先启动灵机剪影应用。`,
      'server_unreachable',
    );
  }
  return {
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      return parseToolResult(result);
    },
    async close() {
      await client.close();
    },
  };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/cli-client.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 6: 提交**

```bash
git add cli/src/result.ts cli/src/client.ts tests/cli-client.test.ts
git commit -m "feat(cli): MCP 客户端封装与结果信封解析"
```

---

## Task 9: 参数解析

**Files:**
- Create: `cli/src/args.ts`
- Test: `tests/cli-args.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-args.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../cli/src/args';

describe('parseArgs', () => {
  it('parses group/action/positionals', () => {
    const r = parseArgs(['task', 'status', 'abc123']);
    expect(r.group).toBe('task');
    expect(r.action).toBe('status');
    expect(r.positionals).toEqual(['abc123']);
  });

  it('parses boolean flags', () => {
    const r = parseArgs(['task', 'wait', 'id', '--json', '--wait']);
    expect(r.flags.json).toBe(true);
    expect(r.flags.wait).toBe(true);
    expect(r.positionals).toEqual(['id']);
  });

  it('parses value flags both --k v and --k=v', () => {
    expect(parseArgs(['task', 'list', '--project', '/p']).flags.project).toBe('/p');
    expect(parseArgs(['task', 'list', '--project=/p']).flags.project).toBe('/p');
  });

  it('treats trailing value flag without value as boolean true', () => {
    expect(parseArgs(['project', 'open', '--server']).flags.server).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-args.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// cli/src/args.ts
export interface ParsedArgs {
  group?: string;
  action?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/** 已知布尔开关（不吞掉后一个 token 作为值） */
const BOOLEAN_FLAGS = new Set(['wait', 'detach', 'json']);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(a);
    }
  }
  const [group, action, ...positionals] = rest;
  return { group, action, positionals, flags };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli-args.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add cli/src/args.ts tests/cli-args.test.ts
git commit -m "feat(cli): 极简参数解析"
```

---

## Task 10: 输出格式化

**Files:**
- Create: `cli/src/format.ts`
- Test: `tests/cli-format.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-format.test.ts
import { describe, it, expect } from 'vitest';
import { output } from '../cli/src/format';

describe('output', () => {
  it('returns pretty JSON when json=true', () => {
    expect(output({ a: 1 }, true)).toBe('{\n  "a": 1\n}');
  });

  it('returns string as-is when human and data is string', () => {
    expect(output('hello', false)).toBe('hello');
  });

  it('renders array of objects one line each', () => {
    const out = output([{ id: 'x', status: 'running' }], false);
    expect(out).toContain('id: x');
    expect(out).toContain('status: running');
  });

  it('renders null as (空)', () => {
    expect(output(null, false)).toBe('(空)');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-format.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// cli/src/format.ts
export function output(data: unknown, json: boolean): string {
  if (json) return JSON.stringify(data, null, 2);
  return humanize(data);
}

function humanize(data: unknown): string {
  if (data === null || data === undefined) return '(空)';
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) {
    if (data.length === 0) return '(空列表)';
    return data.map(humanizeItem).join('\n');
  }
  return humanizeItem(data);
}

function humanizeItem(item: unknown): string {
  if (item && typeof item === 'object') {
    return Object.entries(item as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatVal(v)}`)
      .join('  ');
  }
  return String(item);
}

function formatVal(v: unknown): string {
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli-format.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add cli/src/format.ts tests/cli-format.test.ts
git commit -m "feat(cli): 输出格式化（json / 人类可读）"
```

---

## Task 11: project 命令

**Files:**
- Create: `cli/src/commands/project.ts`
- Test: `tests/cli-project-command.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-project-command.test.ts
import { describe, it, expect } from 'vitest';
import { runProjectCommand } from '../cli/src/commands/project';
import type { ToolCaller } from '../cli/src/client';

function fakeClient(): ToolCaller & { calls: Array<{ name: string; args?: unknown }> } {
  const calls: Array<{ name: string; args?: unknown }> = [];
  return {
    calls,
    async call(name, args) {
      calls.push({ name, args });
      return { ok: true };
    },
    async close() {},
  };
}

describe('runProjectCommand', () => {
  it('current → lingji_get_active_project', async () => {
    const c = fakeClient();
    await runProjectCommand('current', [], c);
    expect(c.calls[0]).toEqual({ name: 'lingji_get_active_project', args: {} });
  });

  it('list → lingji_list_recent_projects', async () => {
    const c = fakeClient();
    await runProjectCommand('list', [], c);
    expect(c.calls[0].name).toBe('lingji_list_recent_projects');
  });

  it('open <path> → lingji_open_project with path', async () => {
    const c = fakeClient();
    await runProjectCommand('open', ['/my/proj'], c);
    expect(c.calls[0]).toEqual({ name: 'lingji_open_project', args: { path: '/my/proj' } });
  });

  it('open without path throws bad_args', async () => {
    const c = fakeClient();
    await expect(runProjectCommand('open', [], c)).rejects.toMatchObject({ code: 'bad_args' });
  });

  it('unknown action throws bad_args', async () => {
    const c = fakeClient();
    await expect(runProjectCommand('frob', [], c)).rejects.toMatchObject({ code: 'bad_args' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-project-command.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// cli/src/commands/project.ts
import type { ToolCaller } from '../client';
import { CliError } from '../errors';

export async function runProjectCommand(
  action: string | undefined,
  positionals: string[],
  client: ToolCaller,
): Promise<unknown> {
  switch (action) {
    case 'current':
      return client.call('lingji_get_active_project', {});
    case 'list':
      return client.call('lingji_list_recent_projects', {});
    case 'open': {
      const path = positionals[0];
      if (!path) throw new CliError('用法: lingji project open <path>', 'bad_args', 2);
      return client.call('lingji_open_project', { path });
    }
    default:
      throw new CliError(
        `未知 project 子命令: ${action ?? '(空)'}（支持 current/list/open）`,
        'bad_args',
        2,
      );
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli-project-command.test.ts`
Expected: PASS（5 passed）。

- [ ] **Step 5: 提交**

```bash
git add cli/src/commands/project.ts tests/cli-project-command.test.ts
git commit -m "feat(cli): project current/list/open 命令"
```

---

## Task 12: task 命令（含 wait 轮询）

**Files:**
- Create: `cli/src/commands/task.ts`
- Test: `tests/cli-task-command.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/cli-task-command.test.ts
import { describe, it, expect } from 'vitest';
import { runTaskCommand, waitForTask } from '../cli/src/commands/task';
import type { ToolCaller } from '../cli/src/client';

function recorder(responder?: (name: string, args?: unknown) => unknown) {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const client: ToolCaller = {
    async call(name, args) {
      calls.push({ name, args });
      return responder ? responder(name, args) : { ok: true };
    },
    async close() {},
  };
  return { client, calls };
}

describe('runTaskCommand', () => {
  it('status <id> → lingji_get_task_status', async () => {
    const { client, calls } = recorder();
    await runTaskCommand('status', ['t1'], {}, client);
    expect(calls[0]).toEqual({ name: 'lingji_get_task_status', args: { taskId: 't1' } });
  });

  it('list with --project filters', async () => {
    const { client, calls } = recorder();
    await runTaskCommand('list', [], { project: '/p' }, client);
    expect(calls[0]).toEqual({ name: 'lingji_list_tasks', args: { projectPath: '/p' } });
  });

  it('list without --project sends empty args', async () => {
    const { client, calls } = recorder();
    await runTaskCommand('list', [], {}, client);
    expect(calls[0]).toEqual({ name: 'lingji_list_tasks', args: {} });
  });

  it('cancel <id> → lingji_cancel_task', async () => {
    const { client, calls } = recorder();
    await runTaskCommand('cancel', ['t9'], {}, client);
    expect(calls[0]).toEqual({ name: 'lingji_cancel_task', args: { taskId: 't9' } });
  });

  it('status without id throws bad_args', async () => {
    const { client } = recorder();
    await expect(runTaskCommand('status', [], {}, client)).rejects.toMatchObject({ code: 'bad_args' });
  });
});

describe('waitForTask', () => {
  it('polls until terminal status', async () => {
    const statuses = ['running', 'running', 'succeeded'];
    let i = 0;
    const { client } = recorder(() => ({ taskId: 't', status: statuses[i++], progress: { percent: i * 30 } }));
    const updates: string[] = [];
    const result: any = await waitForTask('t', client, {
      sleep: async () => {},
      onUpdate: (t: any) => updates.push(t.status),
    });
    expect(result.status).toBe('succeeded');
    expect(updates).toEqual(['running', 'running', 'succeeded']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-task-command.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// cli/src/commands/task.ts
import type { ToolCaller } from '../client';
import { CliError } from '../errors';

const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

function requireId(positionals: string[]): string {
  const id = positionals[0];
  if (!id) throw new CliError('用法: lingji task <status|cancel|wait> <taskId>', 'bad_args', 2);
  return id;
}

export interface WaitOptions {
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onUpdate?: (task: unknown) => void;
}

/** 轮询任务状态直到终态 */
export async function waitForTask(
  taskId: string,
  client: ToolCaller,
  opts: WaitOptions = {},
): Promise<unknown> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const interval = opts.intervalMs ?? 1000;
  for (;;) {
    const task = (await client.call('lingji_get_task_status', { taskId })) as { status?: string };
    opts.onUpdate?.(task);
    if (task && typeof task.status === 'string' && TERMINAL.has(task.status)) {
      return task;
    }
    await sleep(interval);
  }
}

export async function runTaskCommand(
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean>,
  client: ToolCaller,
): Promise<unknown> {
  switch (action) {
    case 'status':
      return client.call('lingji_get_task_status', { taskId: requireId(positionals) });
    case 'list': {
      const projectPath = typeof flags.project === 'string' ? flags.project : undefined;
      return client.call('lingji_list_tasks', projectPath ? { projectPath } : {});
    }
    case 'cancel':
      return client.call('lingji_cancel_task', { taskId: requireId(positionals) });
    case 'wait':
      return waitForTask(requireId(positionals), client, {
        onUpdate: (t) => {
          const task = t as { status?: string; progress?: { percent?: number; phase?: string } };
          const pct = task.progress?.percent ?? 0;
          process.stderr.write(`[task] ${task.status} ${pct}% ${task.progress?.phase ?? ''}\n`);
        },
      });
    default:
      throw new CliError(
        `未知 task 子命令: ${action ?? '(空)'}（支持 status/list/cancel/wait）`,
        'bad_args',
        2,
      );
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli-task-command.test.ts`
Expected: PASS（6 passed）。

- [ ] **Step 5: 提交**

```bash
git add cli/src/commands/task.ts tests/cli-task-command.test.ts
git commit -m "feat(cli): task status/list/cancel/wait 命令"
```

---

## Task 13: CLI 入口

**Files:**
- Create: `cli/src/index.ts`

入口是集成胶水，逻辑已被各命令模块测试覆盖；此处仅装配与错误/退出码处理，手动验收在 Task 15。

- [ ] **Step 1: 实现**

```ts
// cli/src/index.ts
import { parseArgs } from './args';
import { resolveServerUrl } from './endpoint';
import { connectClient, type ToolCaller } from './client';
import { output } from './format';
import { runProjectCommand } from './commands/project';
import { runTaskCommand } from './commands/task';
import { CliError } from './errors';

const HELP = `灵机 CLI (lingji)

用法:
  lingji project current            显示应用当前活动项目
  lingji project list               列出最近项目
  lingji project open <path>        校验并显示项目状态
  lingji task status <id>           查询任务状态
  lingji task list [--project <p>]  列出任务
  lingji task cancel <id>           取消任务
  lingji task wait <id>             轮询任务直到完成

全局开关:
  --json                JSON 输出
  --server <url>        覆盖 MCP 服务地址
`;

async function dispatch(
  group: string,
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean>,
  client: ToolCaller,
): Promise<unknown> {
  switch (group) {
    case 'project':
      return runProjectCommand(action, positionals, client);
    case 'task':
      return runTaskCommand(action, positionals, flags, client);
    default:
      throw new CliError(`未知命令组: ${group}（支持 project/task）`, 'bad_args', 2);
  }
}

function fail(err: unknown, json: boolean): number {
  const e = err as CliError;
  const message = e?.message ?? String(err);
  if (json) {
    process.stderr.write(JSON.stringify({ error: message, code: e?.code }) + '\n');
  } else {
    process.stderr.write(`错误: ${message}\n`);
  }
  return typeof e?.exitCode === 'number' ? e.exitCode : 1;
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const json = parsed.flags.json === true;

  if (!parsed.group || parsed.group === 'help' || parsed.flags.help === true) {
    process.stdout.write(HELP);
    return 0;
  }

  const url = resolveServerUrl({
    serverFlag: typeof parsed.flags.server === 'string' ? parsed.flags.server : undefined,
  });

  let client: ToolCaller;
  try {
    client = await connectClient(url);
  } catch (err) {
    return fail(err, json);
  }

  try {
    const result = await dispatch(parsed.group, parsed.action, parsed.positionals, parsed.flags, client);
    process.stdout.write(output(result, json) + '\n');
    return 0;
  } catch (err) {
    return fail(err, json);
  } finally {
    await client.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`致命错误: ${err?.message ?? String(err)}\n`);
    process.exit(1);
  },
);
```

- [ ] **Step 2: 提交**

```bash
git add cli/src/index.ts
git commit -m "feat(cli): CLI 入口与命令分发"
```

---

## Task 14: 构建与 bin 接入

**Files:**
- Create: `scripts/build-cli.cjs`
- Modify: `package.json`

- [ ] **Step 1: 写构建脚本**

```js
// scripts/build-cli.cjs
const esbuild = require('esbuild');
const fs = require('node:fs');

esbuild
  .build({
    entryPoints: ['cli/src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    outfile: 'dist-cli/lingji.mjs',
    banner: { js: '#!/usr/bin/env node' },
  })
  .then(() => {
    fs.chmodSync('dist-cli/lingji.mjs', 0o755);
    console.log('[build-cli] dist-cli/lingji.mjs 构建完成');
  })
  .catch((err) => {
    console.error('[build-cli] 失败:', err);
    process.exit(1);
  });
```

- [ ] **Step 2: 修改 package.json**

在 `"scripts"` 中加入：

```json
    "build:cli": "node scripts/build-cli.cjs",
```

在顶层（`"main"` 附近）加入 `bin`：

```json
  "bin": {
    "lingji": "dist-cli/lingji.mjs"
  },
```

- [ ] **Step 3: 运行构建确认产物存在**

Run: `npm run build:cli && test -f dist-cli/lingji.mjs && echo BUILT`
Expected: 输出 `[build-cli] dist-cli/lingji.mjs 构建完成` 与 `BUILT`。

- [ ] **Step 4: 烟囱测试 help（不需应用运行）**

Run: `node dist-cli/lingji.mjs help`
Expected: 打印用法文本，退出码 0。

- [ ] **Step 5: 确认 dist-cli 不入库**

Run: `grep -q "dist-cli" .gitignore && echo IGNORED || echo "需要补 .gitignore"`
若输出 `需要补 .gitignore`，在 `.gitignore` 追加一行 `dist-cli/`。

- [ ] **Step 6: 提交**

```bash
git add scripts/build-cli.cjs package.json .gitignore
git commit -m "build(cli): esbuild 打包与 lingji bin 接入"
```

---

## Task 15: 全量测试 + 端到端手动验收

**Files:** 无（验证）

- [ ] **Step 1: 跑全部测试**

Run: `npm test`
Expected: 全绿，含本计划新增的 7 个 CLI 测试文件与更新后的注册测试。

- [ ] **Step 2: 启动应用（手动）**

在另一个终端：`npm run dev`，等待应用窗口出现（MCP 服务随之启动并写 `~/.lingji/mcp-endpoint.json`）。

- [ ] **Step 3: 验证端点文件**

Run: `cat ~/.lingji/mcp-endpoint.json`
Expected: 含 `url`/`port`/`pid`/`startedAt`。

- [ ] **Step 4: 验证命令**

```bash
node dist-cli/lingji.mjs project current
node dist-cli/lingji.mjs project list
node dist-cli/lingji.mjs task list --json
```
Expected:
- `project current`：应用打开了项目则显示其路径，否则 `projectPath: null`。
- `project list`：最近项目列表（或空列表）。
- `task list --json`：JSON 数组（可能为空）。

- [ ] **Step 5: 验证「应用未启动」错误**

关闭应用后：`node dist-cli/lingji.mjs project current`
Expected: stderr 输出「未发现运行中的灵机剪影 MCP 服务…请先启动灵机剪影应用。」，退出码非 0。

- [ ] **Step 6: 记录验收结果**

如实记录哪些命令验证通过、哪些跳过。若发现问题，回到对应 Task 修复。

---

## 完成定义

- 全部单测通过（`npm test`）。
- `lingji project current/list/open` 与 `lingji task status/list/cancel/wait` 可对运行中的应用工作。
- 应用未启动时给出明确中文提示并以非 0 退出。
- 未改动 `dist/`、`dist-electron/`、`release/`、`work/` 等产物目录；`dist-cli/` 已被忽略。

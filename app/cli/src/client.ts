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

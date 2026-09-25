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

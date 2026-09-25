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
  /** 声呐桥共享 token：扩展从此发现并复制进设置（仅 loopback 暴露）。 */
  sonarToken?: string;
}

/** 应用启动 MCP 服务后写入端点发现文件 */
export async function writeEndpointFile(
  port: number,
  file: string = ENDPOINT_FILE,
  sonarToken?: string,
): Promise<void> {
  const info: McpEndpointInfo = {
    url: `http://127.0.0.1:${port}/mcp`,
    port,
    pid: process.pid,
    startedAt: Date.now(),
    ...(sonarToken ? { sonarToken } : {}),
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

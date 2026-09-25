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

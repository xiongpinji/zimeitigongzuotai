/** Fail-closed boundary for the separate production MCP transport. */
import { timingSafeEqual } from 'node:crypto';

const TOKEN = /^[a-f0-9]{48}$/;

export function authorizeProductionMcpRequest(request: {
  remoteAddress?: unknown;
  origin?: unknown;
  tokenHeader?: unknown;
}, expectedToken: unknown): boolean {
  if (request.remoteAddress !== '127.0.0.1' && request.remoteAddress !== '::1') return false;
  // Production tools are for local MCP clients, not browser-origin traffic.
  if (request.origin !== undefined) return false;
  if (typeof expectedToken !== 'string' || !TOKEN.test(expectedToken) ||
      typeof request.tokenHeader !== 'string' || !TOKEN.test(request.tokenHeader)) return false;
  return timingSafeEqual(Buffer.from(request.tokenHeader), Buffer.from(expectedToken));
}
